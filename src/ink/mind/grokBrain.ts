import type { EventTrace } from '../../sim/events'
import type { Rng } from '../../sim/types'
import { INK_CONFIG, clockOf } from '../sim/config'
import { observationFor } from '../sim/observe'
import { ruleBrain } from '../sim/ruleBrain'
import type {
  InkBrains,
  InkState,
  Intent,
  IntentSource,
  MindId,
} from '../sim/types'
import { fridgeOf } from '../sim/world'
import { memoryLines } from './memory'
import { parseIntent } from './parse'
import { buildSystem, buildUser } from './prompt'

const DEFAULT_MODEL = 'grok-4.20-0309-non-reasoning'

export type InkBudgetState = {
  hour: number
  day: number
  maxPerHour: number
  maxPerDay: number
}

export type InkEngineState = {
  brain: 'rule' | 'grok'
  model: string
  llm: number
  fallback: number
  stale: number
  budget: InkBudgetState
  runId: string
  hourDecisions: number
}

export type DecideOk = {
  text: string
  latencyMs: number
  usage?: { promptTokens: number; completionTokens: number }
}

export type DecideFn = (body: {
  system: string
  user: string
  mindId: string
  tick: number
  signal?: AbortSignal
}) => Promise<DecideOk>

export type JournalFn = (record: Record<string, unknown>) => void

export function makeRunId(seed: number, d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `ink-${seed}-${y}${mo}${day}-${hh}${mm}`
}

function hourSlot(tick: number): number {
  return Math.floor(tick / INK_CONFIG.ticksPerHour)
}

function defaultDecide(body: {
  system: string
  user: string
  mindId: string
  tick: number
  signal?: AbortSignal
}): Promise<DecideOk> {
  return fetch('/api/ink/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      user: body.user,
      mindId: body.mindId,
      tick: body.tick,
    }),
    signal: body.signal,
  }).then(async (res) => {
    let json: Record<string, unknown> = {}
    try {
      json = (await res.json()) as Record<string, unknown>
    } catch {
      json = {}
    }
    if (!res.ok) {
      const err = typeof json.error === 'string' ? json.error : `http-${res.status}`
      throw Object.assign(new Error(err), { status: res.status, error: err })
    }
    const text = typeof json.text === 'string' ? json.text : ''
    const latencyMs = typeof json.latencyMs === 'number' ? json.latencyMs : 0
    const usageRaw = json.usage as { promptTokens?: number; completionTokens?: number } | undefined
    const usage =
      usageRaw && typeof usageRaw === 'object'
        ? {
            promptTokens: usageRaw.promptTokens ?? 0,
            completionTokens: usageRaw.completionTokens ?? 0,
          }
        : undefined
    return { text, latencyMs, ...(usage ? { usage } : {}) }
  })
}

function defaultJournal(record: Record<string, unknown>): void {
  void fetch('/api/ink/journal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  }).catch(() => {
    /* journal is best-effort */
  })
}

type Pending = {
  gen: number
  tick: number
  slot: number
  abort: AbortController
  stale: boolean
}

export interface GrokPumpDeps {
  runId: string
  seed: number
  model?: string
  getState: () => InkState
  getEvents: () => EventTrace
  applyIntent: (mindId: MindId, intent: Intent, source: IntentSource) => void
  isLive: () => boolean
  decideFn?: DecideFn
  journalFn?: JournalFn
}

export function createGrokPump(deps: GrokPumpDeps): {
  brains: InkBrains
  stats: () => InkEngineState
  setBudget: (b: InkBudgetState) => void
  setModel: (m: string) => void
  abortAll: () => void
  writeRunMeta: () => void
  inFlight: () => number
} {
  const decideFn = deps.decideFn ?? defaultDecide
  const journalFn = deps.journalFn ?? defaultJournal
  const systemByName = new Map<string, string>()
  const pending = new Map<MindId, Pending>()
  const appliedSlot = new Map<MindId, number>()
  const gen = { A: 0, B: 0 } as Record<MindId, number>
  let llm = 0
  let fallback = 0
  let stale = 0
  let hourDecisions = 0
  let hourSlotSeen = -1
  let budget: InkBudgetState = { hour: 0, day: 0, maxPerHour: 0, maxPerDay: 0 }
  let model = deps.model ?? DEFAULT_MODEL

  function systemFor(name: string): string {
    let s = systemByName.get(name)
    if (!s) {
      s = buildSystem(name)
      systemByName.set(name, s)
    }
    return s
  }

  function rollHour(tick: number): void {
    const slot = hourSlot(tick)
    if (slot !== hourSlotSeen) {
      hourSlotSeen = slot
      hourDecisions = 0
    }
  }

  function snapshotState(mindId: MindId): Record<string, unknown> {
    const state = deps.getState()
    const mind = state.minds[0].id === mindId ? state.minds[0] : state.minds[1]
    return {
      hunger: mind.hunger,
      energy: mind.energy,
      social: mind.social,
      money: mind.money,
      fridge: fridgeOf(state, mind),
      at: mind.at,
    }
  }

  function journal(partial: Record<string, unknown>, mindId: MindId): void {
    const state = deps.getState()
    const c = clockOf(state.tick)
    journalFn({
      runId: deps.runId,
      tick: state.tick,
      day: c.day,
      hour: c.hour,
      mindId,
      ...partial,
      state: snapshotState(mindId),
    })
  }

  function apply(
    mindId: MindId,
    intent: Intent,
    source: IntentSource,
    extra: Record<string, unknown> = {},
  ): void {
    const state = deps.getState()
    const slot = hourSlot(state.tick)
    rollHour(state.tick)
    appliedSlot.set(mindId, slot)
    hourDecisions += 1
    if (source === 'llm') llm += 1
    else if (source === 'fallback') fallback += 1
    deps.applyIntent(mindId, intent, source)
    journal(
      {
        source,
        action: intent.action,
        ...(intent.count !== undefined ? { count: intent.count } : {}),
        reason: intent.reason,
        stale: false,
        ...extra,
      },
      mindId,
    )
  }

  function fallbackNow(mindId: MindId, rng: Rng, extra: Record<string, unknown> = {}): void {
    const state = deps.getState()
    const obs = observationFor(state, mindId)
    const intent = ruleBrain.decide(obs, rng) ?? {
      action: 'wait' as const,
      reason: 'nothing to do',
    }
    apply(mindId, intent, 'fallback', extra)
  }

  function startRequest(mindId: MindId, rng: Rng): void {
    const state = deps.getState()
    const obs = observationFor(state, mindId)
    const mem = memoryLines(deps.getEvents().getAll(), mindId)
    const system = systemFor(obs.self.name)
    const user = buildUser(obs, mem)
    const abort = new AbortController()
    const nextGen = gen[mindId] + 1
    gen[mindId] = nextGen
    const req: Pending = {
      gen: nextGen,
      tick: state.tick,
      slot: hourSlot(state.tick),
      abort,
      stale: false,
    }
    pending.set(mindId, req)

    const issuedSlot = req.slot
    const issuedTick = req.tick
    void decideFn({
      system,
      user,
      mindId,
      tick: issuedTick,
      signal: abort.signal,
    })
      .then((result) => {
        const cur = pending.get(mindId)
        if (!cur || cur.gen !== nextGen) return
        pending.delete(mindId)
        if (cur.stale) {
          stale += 1
          journal(
            {
              source: 'llm',
              stale: true,
              error: 'late',
              raw: result.text,
              latencyMs: result.latencyMs,
              promptTokens: result.usage?.promptTokens,
              completionTokens: result.usage?.completionTokens,
            },
            mindId,
          )
          return
        }
        const nowSlot = hourSlot(deps.getState().tick)
        if (nowSlot !== issuedSlot) {
          stale += 1
          journal(
            {
              source: 'llm',
              stale: true,
              error: 'late',
              raw: result.text,
              latencyMs: result.latencyMs,
              promptTokens: result.usage?.promptTokens,
              completionTokens: result.usage?.completionTokens,
            },
            mindId,
          )
          return
        }
        if (appliedSlot.get(mindId) === nowSlot) return
        const parsed = parseIntent(result.text)
        if (!parsed.ok) {
          fallbackNow(mindId, rng, {
            error: parsed.error,
            raw: result.text,
            latencyMs: result.latencyMs,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
          })
          return
        }
        apply(mindId, parsed.intent, 'llm', {
          raw: result.text,
          latencyMs: result.latencyMs,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
        })
      })
      .catch((err: unknown) => {
        const cur = pending.get(mindId)
        if (!cur || cur.gen !== nextGen) return
        pending.delete(mindId)
        if (cur.stale) {
          stale += 1
          journal({ source: 'llm', stale: true, error: 'late' }, mindId)
          return
        }
        const nowSlot = hourSlot(deps.getState().tick)
        if (nowSlot !== issuedSlot) {
          stale += 1
          journal({ source: 'llm', stale: true, error: 'late' }, mindId)
          return
        }
        if (appliedSlot.get(mindId) === nowSlot) return
        const error =
          err && typeof err === 'object' && 'error' in err && typeof (err as { error: unknown }).error === 'string'
            ? (err as { error: string }).error
            : err instanceof Error
              ? err.message.slice(0, 80)
              : 'upstream'
        fallbackNow(mindId, rng, { error })
      })
  }

  function abandon(mindId: MindId): boolean {
    const cur = pending.get(mindId)
    if (!cur) return false
    cur.stale = true
    cur.abort.abort()
    pending.delete(mindId)
    return true
  }

  function decide(mindId: MindId, _obs: ReturnType<typeof observationFor>, rng: Rng): Intent | null {
    const had = abandon(mindId)
    if (had) {
      // The expired hour is gone; the mind spent it continuing its last action. Claiming
      // this hour with a fallback would set appliedSlot and make the reply we are about to
      // request undroppable-on-arrival, locking the LLM out for the rest of the run.
      stale += 1
      journal({ source: 'llm', stale: true, error: 'late' }, mindId)
    }
    if (deps.isLive()) startRequest(mindId, rng)
    return null
  }

  const brains: InkBrains = {
    A: {
      decide: (obs, rng) => decide('A', obs, rng),
    },
    B: {
      decide: (obs, rng) => decide('B', obs, rng),
    },
  }

  return {
    brains,
    stats: () => ({
      brain: 'grok',
      model,
      llm,
      fallback,
      stale,
      budget,
      runId: deps.runId,
      hourDecisions,
    }),
    setBudget: (b) => {
      budget = b
    },
    setModel: (m) => {
      model = m
    },
    abortAll: () => {
      abandon('A')
      abandon('B')
    },
    writeRunMeta: () => {
      journalFn({
        runId: deps.runId,
        type: 'run',
        seed: deps.seed,
        model,
        config: INK_CONFIG,
      })
    },
    inFlight: () => pending.size,
  }
}



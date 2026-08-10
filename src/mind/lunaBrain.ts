import type { Simulation } from '../sim/sim'
import type { ExternalIntentMeta, Intent, SimEvent } from '../sim/types'
import { anyNeedCritical } from '../sim/utilityBrain'
import { isLunaAgent, LUNA_AGENT_IDS } from './personas'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import { parseMindJson, resolveMindIntent } from './parse'
import {
  CodexProvider,
  MockProvider,
  probeSidecarHealth,
  type MindProvider,
} from './providers'

/** Cadence: min gap after a decision before the soft path. */
export const MIND_MIN_GAP_TICKS = 30
/** Cadence: hard refresh regardless of action state. */
export const MIND_HARD_GAP_TICKS = 120
/** Mock artificial delay (sim ticks) before posting a ready decision. */
export const MOCK_DELAY_TICKS = 3
/** Wall-clock timeout for a mind request → fallback. */
export const MIND_WALL_TIMEOUT_MS = 10_000
/**
 * Backstop: discard intents older than this many sim minutes after requestTick.
 * With auto-breathe this should rarely fire; ages > 45 mean the world raced ahead.
 */
export const MIND_STALE_TICKS = 45
/** Brief pause before retrying a 429 "still thinking" without a new decideCall. */
const LUNA_BUSY_RETRY_MS = 250

export type BrainMode = 'codex' | 'mock' | 'off'

export interface MindExchange {
  agentId: string
  tick: number
  system: string
  user: string
  rawResponse: string
  ok: boolean
}

export interface MindMeter {
  enabled: boolean
  agentIds: string[]
  /** inFlight + holds (inbox not yet applied). */
  pending: number
  /**
   * Wall-bound requests only (sidecar / delayed mock). Auto-breathe keys off this —
   * short mock holds do not throttle the sim.
   */
  thinking: number
  decisions: number
  fallbacks: number
  /** Intent discarded as too old relative to requestTick. */
  stales: number
  meanLatencyMs: number
  approxChars: number
  provider: string
  /** Actual dispatched decide requests (not cadence skips / 429 re-checks). */
  decideCalls: number
}

export interface LunaBrainOptions {
  /** Optional provider override (tests). */
  provider?: MindProvider
  /**
   * Mock-only: wall-frame delay for async decide (pacing tests).
   * Ignored when provider is supplied explicitly.
   */
  mockWallDelayFrames?: number
  /** Mock-only: wall-clock ms delay (browser breathe e2e). */
  mockWallDelayMs?: number
}

interface PendingHold {
  agentId: string
  readyTick: number
  intent: Intent
  meta: ExternalIntentMeta
  exchange: MindExchange
  requestTick: number
}

interface InFlight {
  agentId: string
  startedTick: number
  startedWall: number
  abort?: AbortController
}

export function parseBrainQuery(search: string): BrainMode {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const v = (q.get('brain') ?? '').toLowerCase()
  if (v === 'off') return 'off'
  if (v === 'mock') return 'mock'
  if (v === 'codex') return 'codex'
  return 'auto' as BrainMode // resolved async
}

/** 'auto' is internal until health probe settles. */
export type BrainModeOrAuto = BrainMode | 'auto'

export class LunaBrainService {
  private mode: BrainModeOrAuto
  private provider: MindProvider | null = null
  private lastDecisionTick = new Map<string, number>()
  private inFlight = new Map<string, InFlight>()
  private holds: PendingHold[] = []
  private lastExchange = new Map<string, MindExchange>()
  private decideCallCount = 0
  private totalLatency = 0
  private latencySamples = 0
  private totalApproxChars = 0
  private decisions = 0
  private fallbacks = 0
  private stales = 0
  private disposed = false

  constructor(mode: BrainModeOrAuto = 'auto', opts?: LunaBrainOptions) {
    this.mode = mode
    if (opts?.provider) {
      this.provider = opts.provider
      if (mode === 'auto') this.mode = 'mock'
      return
    }
    if (mode === 'mock') {
      this.provider = new MockProvider({
        wallDelayFrames: opts?.mockWallDelayFrames,
        wallDelayMs: opts?.mockWallDelayMs,
      })
    } else if (mode === 'codex') {
      this.provider = new CodexProvider()
    } else if (mode === 'off') {
      this.provider = null
    }
    // auto: probe later via init()
  }

  async init(): Promise<void> {
    if (this.provider && this.mode !== 'auto') return
    if (this.mode === 'off') {
      this.provider = null
      return
    }
    if (this.mode === 'mock') {
      this.provider = this.provider ?? new MockProvider()
      return
    }
    if (this.mode === 'codex') {
      this.provider = this.provider ?? new CodexProvider()
      return
    }
    // auto
    const ok = await probeSidecarHealth()
    if (this.disposed) return
    if (ok) {
      this.mode = 'codex'
      this.provider = new CodexProvider()
    } else {
      this.mode = 'mock'
      this.provider = new MockProvider()
    }
  }

  dispose(): void {
    this.disposed = true
    this.inFlight.clear()
    this.holds = []
  }

  getMode(): BrainMode {
    if (this.mode === 'auto') return 'mock'
    return this.mode
  }

  isEnabled(): boolean {
    return this.mode !== 'off' && this.provider !== null
  }

  /** Provider decide() invocations (for e2e: scrub must not add calls). */
  getDecideCallCount(): number {
    return this.decideCallCount
  }

  getLastExchange(agentId: string): MindExchange | undefined {
    return this.lastExchange.get(agentId)
  }

  getMeter(): MindMeter {
    const thinking = this.inFlight.size
    const pending = thinking + this.holds.length
    return {
      enabled: this.isEnabled(),
      agentIds: [...LUNA_AGENT_IDS],
      pending,
      thinking,
      decisions: this.decisions,
      fallbacks: this.fallbacks,
      stales: this.stales,
      meanLatencyMs:
        this.latencySamples > 0
          ? Math.round(this.totalLatency / this.latencySamples)
          : 0,
      approxChars: this.totalApproxChars,
      provider: this.provider?.name ?? 'off',
      decideCalls: this.decideCallCount,
    }
  }

  /**
   * Call after each live sim tick (or after each tick inside ffwd).
   * Posts ready holds; may kick off new async decisions.
   */
  onAfterTick(sim: Simulation): void {
    if (!this.isEnabled() || this.disposed) return
    if (this.mode === 'off' || !this.provider) return

    const tick = sim.state.tick

    // Flush holds whose readyTick has arrived
    const ready = this.holds.filter((h) => h.readyTick <= tick)
    this.holds = this.holds.filter((h) => h.readyTick > tick)
    for (const h of ready) {
      if (this.applyOrStale(sim, h.agentId, h.intent, h.meta, h.exchange, h.requestTick)) {
        this.lastDecisionTick.set(h.agentId, tick)
        this.lastExchange.set(h.agentId, h.exchange)
      }
    }

    // Wall-timeout in-flight
    const now = Date.now()
    for (const [agentId, flight] of [...this.inFlight.entries()]) {
      if (now - flight.startedWall >= MIND_WALL_TIMEOUT_MS) {
        this.inFlight.delete(agentId)
        this.fallbacks += 1
        sim.postMindFallback(
          agentId,
          { reason: 'wall timeout', latencyMs: MIND_WALL_TIMEOUT_MS },
          'Mind request timed out — continuing on instinct',
        )
      }
    }

    // Cadence: request decisions for luna agents
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.inFlight.has(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
      const agent = sim.state.agents.find((a) => a.id === agentId)
      if (!agent || !isLunaAgent(agentId)) continue

      const last = this.lastDecisionTick.get(agentId) ?? -MIND_HARD_GAP_TICKS
      const since = tick - last
      const finished =
        agent.action.kind === 'idle' ||
        (agent.action.kind !== 'sleep' && agent.actionTicks === 0 && !agent.action.path?.length)
      const urgent = anyNeedCritical(agent)
      const softOk = since >= MIND_MIN_GAP_TICKS && (finished || urgent)
      const hardOk = since >= MIND_HARD_GAP_TICKS
      if (!softOk && !hardOk) continue

      this.requestDecision(sim, agentId)
    }
  }

  private requestDecision(sim: Simulation, agentId: string): void {
    if (!this.provider) return
    const agent = sim.state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const tick = sim.state.tick
    const events: readonly SimEvent[] = sim.getEvents()
    const system = buildSystemPrompt(agentId)
    const user = buildUserPrompt(agent, sim.state, events)
    const provider = this.provider
    const providerName = provider.name

    // Mock sync: fully synchronous so ffwd interleaves decide → 3-tick hold → apply
    if (provider instanceof MockProvider && provider.preferSync()) {
      this.decideCallCount += 1
      const result = provider.decideSync({ system, user, agentId, tick })
      this.finishDecision(sim, agentId, system, user, result, providerName, tick)
      return
    }

    const flight: InFlight = {
      agentId,
      startedTick: tick,
      startedWall: Date.now(),
    }
    this.inFlight.set(agentId, flight)
    // Count only the initial dispatch of a logical decision (429 retries reuse it)
    this.decideCallCount += 1

    const run = async () => {
      // Retry loop for 429 "still thinking" — same flight, no extra decideCalls
      for (;;) {
        if (this.disposed) return
        if (this.inFlight.get(agentId) !== flight) return
        try {
          const result = await provider.decide({
            system,
            user,
            agentId,
            tick,
          })
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          this.inFlight.delete(agentId)
          this.finishDecision(sim, agentId, system, user, result, providerName, tick)
          return
        } catch (err) {
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          const code = (err as { code?: string })?.code
          if (code === 'LUNA_BUSY') {
            // Stay in-flight; re-check without counting a new decideCall
            await new Promise<void>((r) => setTimeout(r, LUNA_BUSY_RETRY_MS))
            continue
          }
          this.inFlight.delete(agentId)
          this.fallbacks += 1
          const msg = err instanceof Error ? err.message : String(err)
          sim.postMindFallback(
            agentId,
            { reason: 'provider error', error: msg },
            `Mind provider error: ${msg}`,
          )
          return
        }
      }
    }

    void run()
  }

  /**
   * Apply intent if fresh; otherwise emit mind:stale (not a generic fallback).
   * @returns true when applied
   */
  private applyOrStale(
    sim: Simulation,
    agentId: string,
    intent: Intent,
    meta: ExternalIntentMeta,
    exchange: MindExchange,
    requestTick: number,
  ): boolean {
    const age = sim.state.tick - requestTick
    if (age > MIND_STALE_TICKS) {
      this.stales += 1
      sim.postMindStale(
        agentId,
        {
          reason: 'stale intent',
          requestTick,
          applyTick: sim.state.tick,
          ageTicks: age,
          staleAfterTicks: MIND_STALE_TICKS,
          latencyMs: meta.latencyMs,
          approxChars: meta.approxChars,
        },
        `Mind intent arrived ${age} sim-min after observation (limit ${MIND_STALE_TICKS}) — discarded`,
      )
      this.lastExchange.set(agentId, exchange)
      return false
    }
    sim.postExternalIntent(agentId, intent, meta)
    this.decisions += 1
    return true
  }

  private finishDecision(
    sim: Simulation,
    agentId: string,
    system: string,
    user: string,
    result: { text: string; latencyMs: number; approxChars: number },
    providerName: string,
    requestTick: number,
  ): void {
    this.totalLatency += result.latencyMs
    this.latencySamples += 1
    this.totalApproxChars += result.approxChars

    const parsed = parseMindJson(result.text)
    const exchange: MindExchange = {
      agentId,
      tick: requestTick,
      system,
      user,
      rawResponse: result.text,
      ok: parsed.ok,
    }
    this.lastExchange.set(agentId, exchange)

    if (!parsed.ok) {
      this.fallbacks += 1
      sim.postMindFallback(
        agentId,
        {
          reason: 'validation error',
          error: parsed.error,
          latencyMs: result.latencyMs,
          approxChars: result.approxChars,
          raw: result.text.slice(0, 400),
        },
        `Mind validation failed: ${parsed.error}`,
      )
      return
    }

    const liveAgent = sim.state.agents.find((a) => a.id === agentId)
    if (!liveAgent) return
    const intent = resolveMindIntent(sim.state, liveAgent, parsed.raw)
    const meta: ExternalIntentMeta = {
      reasoning: parsed.raw.reasoning,
      source: 'luna',
      provider: providerName,
      latencyMs: result.latencyMs,
      approxChars: result.approxChars,
    }

    // Sync mock path keeps a short hold so ffwd interleaves apply mid-batch.
    // Async paths (codex / delayed mock) apply immediately subject to stale guard.
    const delay =
      providerName === 'mock' &&
      this.provider instanceof MockProvider &&
      this.provider.preferSync()
        ? MOCK_DELAY_TICKS
        : 0
    const readyTick = sim.state.tick + delay
    if (delay <= 0) {
      if (this.applyOrStale(sim, agentId, intent, meta, exchange, requestTick)) {
        this.lastDecisionTick.set(agentId, sim.state.tick)
      }
    } else {
      this.holds.push({
        agentId,
        readyTick,
        intent,
        meta,
        exchange,
        requestTick,
      })
    }
  }
}

/** Read ?brain= from window location (browser). */
export function brainModeFromLocation(): BrainModeOrAuto {
  if (typeof window === 'undefined') return 'off'
  const q = new URLSearchParams(window.location.search)
  const v = (q.get('brain') ?? '').toLowerCase()
  if (v === 'off') return 'off'
  if (v === 'mock') return 'mock'
  if (v === 'codex') return 'codex'
  return 'auto'
}

/**
 * Optional mock wall-clock delay from `?mindWallMs=` (breathe e2e).
 * Only applied when brain=mock.
 */
export function mockWallDelayMsFromLocation(): number {
  if (typeof window === 'undefined') return 0
  const q = new URLSearchParams(window.location.search)
  const raw = q.get('mindWallMs')
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(30_000, Math.floor(n))
}

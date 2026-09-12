import { EventTrace } from '../sim/events'
import { createRng } from '../sim/rng'
import type { SimEvent } from '../sim/types'
import type { Decider, DeciderInput, RecordedDecision } from './decider'
import { instinctBrain } from './instinctBrain'
import { lineageHash } from './hash'
import { buildSystemPrompt, buildUserPrompt, parseIntent } from './prompt'
import { traitStats } from './render/trajectories'
import { endSeason } from './season'
import { advanceTurn, observe } from './step'
import type {
  BrainFactory,
  LineageBrain,
  LineageConfig,
  LineageIntent,
  LineageState,
  LineageSummary,
  Turn,
} from './types'
import { STARVE_DEPART_REASON } from './types'
import { createHamlet, livingVillagers, mergeConfig } from './world'

export type { Decider, DeciderInput, RecordedDecision } from './decider'

export interface LineageMindStats {
  llm: number
  fallback: number
  invalid: number
  meanLatencyMs: number
}

export interface PromptSample {
  season: number
  day: number
  turn: Turn
  villagerId: string
  name: string
  system: string
  user: string
}

export interface LineageAsyncResult {
  state: LineageState
  events: SimEvent[]
  summary: LineageSummary
  decisions: RecordedDecision[]
  mind: LineageMindStats
  promptSamples: PromptSample[]
}

export interface RunLineageAsyncOpts {
  dna: boolean
  concurrency: number
  onDecision?: (d: RecordedDecision) => void
  fallbackBrain?: LineageBrain
  onPrompt?: (s: PromptSample) => void
  onDay?: (info: { season: number; day: number }) => void
  decisionSource?: 'llm' | 'mock'
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const n = Math.max(1, Math.min(limit, items.length))
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next
      if (i >= items.length) return
      next += 1
      out[i] = await fn(items[i]!, i)
    }
  }
  const workers: Promise<void>[] = []
  for (let w = 0; w < n; w++) workers.push(worker())
  await Promise.all(workers)
  return out
}

function frozenFactory(intents: Map<string, LineageIntent>): BrainFactory {
  return (v) => ({
    decide() {
      return intents.get(v.id) ?? { kind: 'idle', reason: 'I wait.' }
    },
  })
}

function isMindEvent(type: string): boolean {
  return type === 'mind:decision' || type === 'mind:fallback'
}

export async function runLineageAsync(
  config: Partial<LineageConfig> = {},
  decider: Decider,
  opts: RunLineageAsyncOpts,
): Promise<LineageAsyncResult> {
  const cfg = mergeConfig(config)
  const rng = createRng(cfg.seed)
  const fallbackRng = createRng((cfg.seed + 0x9e3779b9) >>> 0)
  const trace = new EventTrace()
  const state = createHamlet(cfg, rng, trace)
  const fallbackBrain = opts.fallbackBrain ?? instinctBrain
  const dna = opts.dna
  const concurrency = Math.max(1, opts.concurrency)
  const decisionSource = opts.decisionSource ?? 'llm'
  const decisions: RecordedDecision[] = []
  const promptSamples: PromptSample[] = []
  let llm = 0
  let fallback = 0
  let invalid = 0
  let latencySum = 0
  let latencyN = 0

  const capturePrompt = (input: DeciderInput) => {
    const wantDawn = state.season === 0 && state.day === 0 && state.turn === 0
    const wantDusk = state.season === 1 && state.day === 4 && state.turn === 2
    if (!wantDawn && !wantDusk) return
    const sample: PromptSample = {
      season: state.season,
      day: state.day,
      turn: state.turn,
      villagerId: input.villager.id,
      name: `${input.villager.givenName} ${input.villager.surname}`,
      system: input.system,
      user: input.user,
    }
    promptSamples.push(sample)
    opts.onPrompt?.(sample)
  }

  for (let s = 0; s < cfg.seasons; s++) {
    for (let d = 0; d < cfg.daysPerSeason; d++) {
      for (let t = 0; t < cfg.turnsPerDay; t++) {
        const living = livingVillagers(state)
        const inputs: DeciderInput[] = living.map((v) => {
          const obs = observe(state, v)
          const system = buildSystemPrompt(v, { dna }, state.lineage)
          const user = buildUserPrompt(obs, trace.getAll())
          return {
            villager: v,
            obs,
            system,
            user,
            season: state.season,
            day: state.day,
            turn: state.turn,
          }
        })
        if (inputs[0]) capturePrompt(inputs[0])

        const decided = await mapLimit(inputs, concurrency, async (input) => {
          let raw: string | undefined
          let latencyMs = 0
          let source: RecordedDecision['source'] = decisionSource
          let error: string | undefined
          let intent: LineageIntent
          try {
            const res = await decider.decide(input)
            if ('text' in res) {
              raw = res.text
              latencyMs = res.latencyMs
              const parsed = parseIntent(res.text, input.obs)
              if ('error' in parsed) {
                error = parsed.error
                source = 'fallback'
                invalid += 1
                intent = fallbackBrain.decide(input.obs, fallbackRng)
              } else {
                intent = parsed.intent
              }
            } else {
              error = res.error
              source = 'fallback'
              intent = fallbackBrain.decide(input.obs, fallbackRng)
            }
          } catch (err) {
            error = err instanceof Error ? err.message : String(err)
            source = 'fallback'
            intent = fallbackBrain.decide(input.obs, fallbackRng)
          }
          const rec: RecordedDecision = {
            season: input.season,
            day: input.day,
            turn: input.turn,
            villagerId: input.villager.id,
            intent,
            source,
            raw,
            error,
            latencyMs,
          }
          return rec
        })

        const intents = new Map<string, LineageIntent>()
        for (const rec of decided) {
          intents.set(rec.villagerId, rec.intent)
          decisions.push(rec)
          opts.onDecision?.(rec)
          if (rec.source === 'fallback') fallback += 1
          else llm += 1
          if (typeof rec.latencyMs === 'number') {
            latencySum += rec.latencyMs
            latencyN += 1
          }
          if (rec.source === 'fallback') {
            trace.append({
              tick: state.tick,
              type: 'mind:fallback',
              agentId: rec.villagerId,
              data: { villagerId: rec.villagerId, error: rec.error ?? 'fallback' },
            })
          } else {
            trace.append({
              tick: state.tick,
              type: 'mind:decision',
              agentId: rec.villagerId,
              data: {
                villagerId: rec.villagerId,
                source: rec.source,
                latencyMs: rec.latencyMs ?? 0,
              },
            })
          }
        }

        advanceTurn(state, frozenFactory(intents), rng, trace)
      }
      opts.onDay?.({ season: state.season, day: d })
    }
    if (endSeason(state, rng, trace)) break
  }

  const events = trace.getAll().slice()
  const stats = traitStats(state.lineage)
  const simEventCount = events.filter((e) => !isMindEvent(e.type)).length
  const summary: LineageSummary = {
    config: { ...state.config },
    seasons: state.season,
    generationsBorn: state.lineage.filter((r) => r.generation > 0).length,
    departuresByStarvation: events.filter((e) => {
      const reason = String(e.reason ?? e.data?.reason ?? '')
      return e.type === 'villager:departed' && reason === STARVE_DEPART_REASON
    }).length,
    traitMeansByGeneration: stats.traitMeansByGeneration,
    traitVarByGeneration: stats.traitVarByGeneration,
    hash: lineageHash(state),
    eventCount: simEventCount,
  }
  const mind: LineageMindStats = {
    llm,
    fallback,
    invalid,
    meanLatencyMs: latencyN > 0 ? latencySum / latencyN : 0,
  }
  return { state, events, summary, decisions, mind, promptSamples }
}

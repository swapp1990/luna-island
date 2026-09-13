import { EventTrace } from '../sim/events'
import { createRng } from '../sim/rng'
import type { SimEvent } from '../sim/types'
import { decisionKey, recordedBrainFactory, type RecordedDecision } from './decider'
import { lineageHash } from './hash'
import { endSeason } from './season'
import { advanceTurn } from './step'
import type { LineageConfig, LineageState } from './types'
import { createHamlet, livingVillagers, mergeConfig } from './world'

export type { RecordedDecision }

export interface TimelineResult {
  snapshots: LineageState[]
  events: SimEvent[]
  turnStarts: number[]
  hash: string
}

/**
 * Reconstruct every turn of a recorded run. snapshot[i] is the state villagers
 * saw before deciding turn i. turnStarts[i] is the event index at that moment.
 * A final snapshot (and a sentinel turnStarts entry at events.length) follows
 * the last season. Hash is lineageHash of the terminal state.
 */
export function replayTimeline(
  config: LineageConfig,
  decisions: readonly RecordedDecision[] = [],
): TimelineResult {
  const cfg = mergeConfig(config)
  const rng = createRng(cfg.seed)
  const trace = new EventTrace()
  const state = createHamlet(cfg, rng, trace)
  const brainFor = recordedBrainFactory(decisions)
  const byKey = new Map<string, RecordedDecision>()
  for (const d of decisions) {
    byKey.set(decisionKey(d.season, d.day, d.turn, d.villagerId), d)
  }

  const snapshots: LineageState[] = []
  const turnStarts: number[] = []

  for (let s = 0; s < cfg.seasons; s++) {
    for (let d = 0; d < cfg.daysPerSeason; d++) {
      for (let t = 0; t < cfg.turnsPerDay; t++) {
        snapshots.push(structuredClone(state))
        turnStarts.push(trace.length)
        if (byKey.size > 0) {
          for (const v of livingVillagers(state)) {
            const rec = byKey.get(decisionKey(state.season, state.day, state.turn, v.id))
            if (!rec) continue
            trace.append({
              tick: state.tick,
              type: rec.source === 'fallback' ? 'mind:fallback' : 'mind:decision',
              agentId: v.id,
              data: {
                villagerId: v.id,
                source: rec.source,
                latencyMs: rec.latencyMs ?? 0,
              },
            })
          }
        }
        advanceTurn(state, brainFor, rng, trace)
      }
    }
    if (endSeason(state, rng, trace)) break
  }

  snapshots.push(structuredClone(state))
  turnStarts.push(trace.length)

  return {
    snapshots,
    events: trace.getAll().slice(),
    turnStarts,
    hash: lineageHash(state),
  }
}

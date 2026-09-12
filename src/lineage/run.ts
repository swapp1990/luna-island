import { EventTrace } from '../sim/events'
import { createRng } from '../sim/rng'
import type { SimEvent } from '../sim/types'
import { lineageHash } from './hash'
import { instinctBrain } from './instinctBrain'
import { traitStats } from './render/trajectories'
import { endSeason } from './season'
import { advanceTurn } from './step'
import type {
  BrainFactory,
  LineageConfig,
  LineageState,
  LineageSummary,
} from './types'
import { DEFAULT_CONFIG, STARVE_DEPART_REASON } from './types'
import { createHamlet, mergeConfig } from './world'

export { DEFAULT_CONFIG, mergeConfig }
export { renderChronicle } from './render/chronicle'
export { renderCensus } from './render/census'
export { renderTree } from './render/tree'
export { renderTrajectories, traitStats } from './render/trajectories'
export { lineageHash } from './hash'

export interface LineageRunResult {
  state: LineageState
  events: SimEvent[]
  summary: LineageSummary
}

export function runLineage(
  config: Partial<LineageConfig> = {},
  brainFactory?: BrainFactory,
): LineageRunResult {
  const cfg = mergeConfig(config)
  const rng = createRng(cfg.seed)
  const trace = new EventTrace()
  const state = createHamlet(cfg, rng, trace)
  const brainFor: BrainFactory = brainFactory ?? (() => instinctBrain)

  for (let s = 0; s < cfg.seasons; s++) {
    for (let d = 0; d < cfg.daysPerSeason; d++) {
      for (let t = 0; t < cfg.turnsPerDay; t++) {
        advanceTurn(state, brainFor, rng, trace)
      }
    }
    if (endSeason(state, rng, trace)) break
  }

  const events = trace.getAll().slice()
  const stats = traitStats(state.lineage)
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
    eventCount: events.length,
  }
  return { state, events, summary }
}

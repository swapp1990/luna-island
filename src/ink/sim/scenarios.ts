import { INK_CONFIG } from './config'
import type { InkState } from './types'

/**
 * Named start states, so a question about one day can be asked without simulating the
 * four before it. A scenario only sets the clock, needs, money and fridges — it never
 * changes a world rule, and the minds are told nothing about how they got here.
 */
export type ScenarioId = 'friday'

const FRIDAY_TICK = 4 * 24 * INK_CONFIG.ticksPerHour + 6 * INK_CONFIG.ticksPerHour

/**
 * Friday 06:00 after a well-run week: rested, fed enough for now, a working wage banked,
 * and one meal left each. The low fridge is the point — a full one would answer the
 * weekend question before it is asked.
 */
function friday(state: InkState): void {
  state.tick = FRIDAY_TICK
  for (const mind of state.minds) {
    mind.hunger = 0.62
    mind.energy = 0.85
    mind.social = 0.58
    mind.money = 300
    mind.asleep = false
    mind.at = mind.home
    mind.path = []
    mind.current = null
    mind.busyUntilTick = 0
    mind.collapsedUntilTick = 0
    mind.collapseGraceUntilTick = 0
    mind.sufferedHours = 0
  }
  state.fridges['home-a'] = 1
  state.fridges['home-b'] = 1
}

const SCENARIOS: Record<ScenarioId, (state: InkState) => void> = { friday }

export function isScenarioId(v: string | null): v is ScenarioId {
  return v !== null && Object.prototype.hasOwnProperty.call(SCENARIOS, v)
}

export function applyScenario(state: InkState, id: ScenarioId): void {
  SCENARIOS[id](state)
}

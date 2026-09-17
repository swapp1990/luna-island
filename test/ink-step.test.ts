import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import { INK_CONFIG } from '../src/ink/sim/config'
import { applyIntent, advanceTick } from '../src/ink/sim/step'
import type { InkBrain, InkBrains, InkState, PlaceId } from '../src/ink/sim/types'
import { createWorld, PLACES } from '../src/ink/sim/world'

const waitBrain: InkBrain = {
  decide: () => ({ action: 'wait', reason: 'wait' }),
}
const nullBrain: InkBrain = { decide: () => null }
const sleepBrain: InkBrain = {
  decide: () => ({ action: 'sleep', reason: 'sleep' }),
}
const workBrain: InkBrain = {
  decide: () => ({ action: 'work', reason: 'work' }),
}

const waits: InkBrains = { A: waitBrain, B: waitBrain }
const sleepers: InkBrains = { A: sleepBrain, B: sleepBrain }
const keep: InkBrains = { A: nullBrain, B: nullBrain }

function putAt(state: InkState, id: 'A' | 'B', place: PlaceId): void {
  const mind = state.minds[id === 'A' ? 0 : 1]
  mind.at = place
  mind.pos = { ...PLACES[place].door }
  mind.path = []
}

function run(state: InkState, n: number, brains: InkBrains, events = new EventTrace(), rng = createRng(state.seed)) {
  for (let i = 0; i < n; i++) advanceTick(state, brains, events, rng)
  return events
}

describe('ink needs and wages', () => {
  it('decays hunger, energy, social at the hourly rates over 60 ticks while awake', () => {
    const state = createWorld(1)
    run(state, INK_CONFIG.ticksPerHour, waits)
    expect(state.minds[0].hunger).toBeCloseTo(1 - INK_CONFIG.hungerDecayAwake, 10)
    expect(state.minds[0].energy).toBeCloseTo(1 - INK_CONFIG.energyDecayAwake, 10)
    expect(state.minds[0].social).toBeCloseTo(1 - INK_CONFIG.socialDecay, 10)
    expect(state.minds[1].hunger).toBeCloseTo(1 - INK_CONFIG.hungerDecayAwake, 10)
  })

  it('flips hunger and energy rates while asleep', () => {
    const state = createWorld(1)
    state.minds[0].energy = 0.5
    state.minds[1].energy = 0.5
    run(state, INK_CONFIG.ticksPerHour, sleepers)
    expect(state.minds[0].asleep).toBe(true)
    expect(state.minds[0].hunger).toBeCloseTo(1 - INK_CONFIG.hungerDecayAsleep, 10)
    expect(state.minds[0].energy).toBeCloseTo(0.5 + INK_CONFIG.energyGainAsleep, 10)
  })

  it('raises social only when both minds are at center', () => {
    const together = createWorld(1)
    together.minds[0].social = 0.4
    together.minds[1].social = 0.4
    putAt(together, 'A', 'center')
    putAt(together, 'B', 'center')
    run(together, INK_CONFIG.ticksPerHour, waits)
    const expectedTogether = 0.4 - INK_CONFIG.socialDecay + INK_CONFIG.socialGainTogether
    expect(together.minds[0].social).toBeCloseTo(expectedTogether, 10)
    expect(together.minds[1].social).toBeCloseTo(expectedTogether, 10)

    const alone = createWorld(1)
    alone.minds[0].social = 0.4
    alone.minds[1].social = 0.4
    putAt(alone, 'A', 'center')
    putAt(alone, 'B', 'home-b')
    run(alone, INK_CONFIG.ticksPerHour, waits)
    expect(alone.minds[0].social).toBeCloseTo(0.4 - INK_CONFIG.socialDecay, 10)
    expect(alone.minds[1].social).toBeCloseTo(0.4 - INK_CONFIG.socialDecay, 10)
  })

  it('accrues wage only inside open hours while working at the workshop', () => {
    const open = createWorld(1)
    open.tick = 9 * INK_CONFIG.ticksPerHour
    putAt(open, 'A', 'work')
    const events = new EventTrace()
    applyIntent(open, 'A', { action: 'work', reason: 'work' }, 'rule', events)
    run(open, INK_CONFIG.ticksPerHour, keep, events)
    expect(open.minds[0].money).toBeCloseTo(INK_CONFIG.startMoney + INK_CONFIG.wagePerHour, 10)

    const closed = createWorld(1)
    closed.tick = 19 * INK_CONFIG.ticksPerHour
    putAt(closed, 'A', 'work')
    applyIntent(closed, 'A', { action: 'work', reason: 'work' }, 'rule', events)
    const money = closed.minds[0].money
    run(closed, INK_CONFIG.ticksPerHour, { A: workBrain, B: waitBrain }, events)
    expect(closed.minds[0].money).toBe(money)
  })

  it('pays nothing at 08:00 even if the mind is at work and trying to work', () => {
    const state = createWorld(1)
    state.tick = 8 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'work')
    const events = new EventTrace()
    applyIntent(state, 'A', { action: 'work', reason: 'work' }, 'rule', events)
    run(state, INK_CONFIG.ticksPerHour, keep, events)
    expect(state.minds[0].money).toBe(INK_CONFIG.startMoney)
  })
})

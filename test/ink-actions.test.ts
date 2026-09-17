import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { INK_CONFIG, TICKS_PER_DAY } from '../src/ink/sim/config'
import { applyIntent } from '../src/ink/sim/step'
import type { InkState, PlaceId } from '../src/ink/sim/types'
import { createWorld, PLACES } from '../src/ink/sim/world'

function putAt(state: InkState, id: 'A' | 'B', place: PlaceId): void {
  const mind = state.minds[id === 'A' ? 0 : 1]
  mind.at = place
  mind.pos = { ...PLACES[place].door }
  mind.path = []
}

function why(events: EventTrace): string {
  const fail = [...events.getAll()].reverse().find((e) => e.type === 'action:fail')
  return String(fail?.data?.why ?? fail?.reason ?? '')
}

function ok(events: EventTrace): boolean {
  return events.getAll().some((e) => e.type === 'action:ok')
}

function apply(state: InkState, action: Parameters<typeof applyIntent>[2]['action'], extra: Partial<Parameters<typeof applyIntent>[2]> = {}) {
  const events = new EventTrace()
  applyIntent(state, 'A', { action, reason: action, ...extra }, 'rule', events)
  return events
}

describe('ink action table', () => {
  it('go_market from home succeeds and go_home while already home fails', () => {
    const state = createWorld(1)
    const gone = apply(state, 'go_market')
    expect(ok(gone)).toBe(true)
    expect(state.minds[0].at).toBeNull()
    expect(state.minds[0].path.length).toBeGreaterThan(0)
    expect(state.minds[0].asleep).toBe(false)

    const home = createWorld(1)
    const stay = apply(home, 'go_home')
    expect(ok(stay)).toBe(false)
    expect(why(stay)).toMatch(/already at home-a/)
  })

  it('go_work, go_center succeed from home', () => {
    const a = createWorld(1)
    expect(ok(apply(a, 'go_work'))).toBe(true)
    const b = createWorld(1)
    expect(ok(apply(b, 'go_center'))).toBe(true)
  })

  it('sleep succeeds at home and fails at the market', () => {
    const home = createWorld(1)
    const slept = apply(home, 'sleep')
    expect(ok(slept)).toBe(true)
    expect(home.minds[0].asleep).toBe(true)

    const out = createWorld(1)
    putAt(out, 'A', 'market')
    const failed = apply(out, 'sleep')
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/not at home-a/)
    expect(out.minds[0].asleep).toBe(false)
  })

  it('a later intent wakes a sleeper', () => {
    const state = createWorld(1)
    apply(state, 'sleep')
    expect(state.minds[0].asleep).toBe(true)
    apply(state, 'wait')
    expect(state.minds[0].asleep).toBe(false)
  })

  it('eat succeeds at home with food and fails from an empty fridge', () => {
    const fed = createWorld(1)
    const before = fed.fridges['home-a']
    const hunger = fed.minds[0].hunger
    const eaten = apply(fed, 'eat')
    expect(ok(eaten)).toBe(true)
    expect(fed.fridges['home-a']).toBe(before - 1)
    expect(fed.minds[0].hunger).toBeCloseTo(Math.min(1, hunger + INK_CONFIG.mealHunger), 10)
    expect(fed.minds[0].busyUntilTick).toBe(fed.tick + INK_CONFIG.mealMinutes)

    const empty = createWorld(1)
    empty.fridges['home-a'] = 0
    const failed = apply(empty, 'eat')
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/fridge is empty/)
  })

  it('eat fails when not at home', () => {
    const state = createWorld(1)
    putAt(state, 'A', 'market')
    const failed = apply(state, 'eat')
    expect(why(failed)).toMatch(/not at home-a/)
  })

  it('buy succeeds at an open market', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'market')
    const events = apply(state, 'buy', { count: 3 })
    expect(ok(events)).toBe(true)
    expect(state.fridges['home-a']).toBe(INK_CONFIG.startMeals + 3)
    expect(state.minds[0].money).toBe(INK_CONFIG.startMoney - 3 * INK_CONFIG.mealPrice)
    const detail = events.getAll().find((e) => e.type === 'action:ok')?.data?.detail as { meals: number; cost: number }
    expect(detail).toEqual({ meals: 3, cost: 60 })
  })

  it('buy on a Saturday fails and names the weekend', () => {
    const state = createWorld(1)
    state.tick = 5 * TICKS_PER_DAY + 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'market')
    const failed = apply(state, 'buy')
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/Saturday/i)
  })

  it('buy with 12 money fails and names the price', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'market')
    state.minds[0].money = 12
    const failed = apply(state, 'buy')
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/a meal costs 20 and you have 12/)
    expect(state.fridges['home-a']).toBe(INK_CONFIG.startMeals)
    expect(state.minds[0].money).toBe(12)
  })

  it('buy 6 into a fridge holding 5 fails and names the capacity', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'market')
    state.fridges['home-a'] = 5
    const failed = apply(state, 'buy', { count: 6 })
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/holds 6 and already has 5/)
    expect(state.fridges['home-a']).toBe(5)
  })

  it('buy fails when not at the market', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    const failed = apply(state, 'buy')
    expect(why(failed)).toMatch(/not at the market/)
  })

  it('work at 19:00 fails and names the hour', () => {
    const state = createWorld(1)
    state.tick = 19 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'work')
    const failed = apply(state, 'work')
    expect(ok(failed)).toBe(false)
    expect(why(failed)).toMatch(/19:00/)
  })

  it('work while at the market fails', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'market')
    const failed = apply(state, 'work')
    expect(why(failed)).toMatch(/not at the workshop/)
  })

  it('work succeeds at the open workshop', () => {
    const state = createWorld(1)
    state.tick = 10 * INK_CONFIG.ticksPerHour
    putAt(state, 'A', 'work')
    expect(ok(apply(state, 'work'))).toBe(true)
  })

  it('socialize succeeds at center and fails at home', () => {
    const okState = createWorld(1)
    putAt(okState, 'A', 'center')
    expect(ok(apply(okState, 'socialize'))).toBe(true)

    const bad = createWorld(1)
    const failed = apply(bad, 'socialize')
    expect(why(failed)).toMatch(/not at the town centre/)
  })

  it('wait never fails', () => {
    const state = createWorld(1)
    expect(ok(apply(state, 'wait'))).toBe(true)
  })

  it('go while busy fails', () => {
    const state = createWorld(1)
    apply(state, 'eat')
    const failed = apply(state, 'go_market')
    expect(why(failed)).toMatch(/busy/)
    expect(state.minds[0].at).toBe('home-a')
  })
})

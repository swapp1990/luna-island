import { describe, expect, it } from 'vitest'
import { clockOf, INK_CONFIG } from '../src/ink/sim/config'
import { applyScenario, isScenarioId } from '../src/ink/sim/scenarios'
import { createWorld } from '../src/ink/sim/world'

describe('friday scenario', () => {
  it('starts the clock on Friday 06:00', () => {
    const state = createWorld(42)
    applyScenario(state, 'friday')
    const c = clockOf(state.tick)
    expect(c.dayName).toBe('Fri')
    expect(c.hour).toBe(6)
    expect(c.minute).toBe(0)
    expect(c.isWeekend).toBe(false)
  })

  it('leaves one meal in each fridge, which is less than the weekend needs', () => {
    const state = createWorld(42)
    applyScenario(state, 'friday')
    expect(state.fridges['home-a']).toBe(1)
    expect(state.fridges['home-b']).toBe(1)

    // Two days of decay against what a meal restores: the gap is what Friday has to close.
    const perDay = 16 * INK_CONFIG.hungerDecayAwake + 8 * INK_CONFIG.hungerDecayAsleep
    const weekendMeals = (2 * perDay) / INK_CONFIG.mealHunger
    expect(weekendMeals).toBeGreaterThan(state.fridges['home-a'])
    expect(weekendMeals).toBeLessThanOrEqual(INK_CONFIG.fridgeCapacity)
  })

  it('gives both minds money and leaves them at home, awake and uncollapsed', () => {
    const state = createWorld(42)
    applyScenario(state, 'friday')
    for (const mind of state.minds) {
      expect(mind.money).toBe(300)
      expect(mind.at).toBe(mind.home)
      expect(mind.asleep).toBe(false)
      expect(mind.collapsedUntilTick).toBe(0)
      expect(mind.path).toHaveLength(0)
    }
  })

  it('only recognises known scenario ids', () => {
    expect(isScenarioId('friday')).toBe(true)
    expect(isScenarioId('tuesday')).toBe(false)
    expect(isScenarioId(null)).toBe(false)
  })
})

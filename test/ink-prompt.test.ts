import { describe, expect, it } from 'vitest'
import { buildSystem, buildUser } from '../src/ink/mind/prompt'
import { INK_CONFIG } from '../src/ink/sim/config'
import { observationFor } from '../src/ink/sim/observe'
import { pathToPlace } from '../src/ink/sim/path'
import { createWorld, PLACES } from '../src/ink/sim/world'

const FORBIDDEN = [
  'should',
  'make sure',
  'remember to',
  'important',
  'try to',
  'strategy',
  'plan ahead',
  'stock up',
  'in advance',
  "don't forget",
  'goal',
  'score',
  'survive',
  'optimal',
  'best',
]

describe('ink prompt', () => {
  it('system prompt contains no forbidden word', () => {
    const sys = buildSystem('A')
    const lower = sys.toLowerCase()
    for (const word of FORBIDDEN) {
      expect(lower, `forbidden: ${word}`).not.toContain(word)
    }
  })

  it('facts change when INK_CONFIG mealPrice changes', () => {
    const base = buildSystem('A', INK_CONFIG)
    const flipped = buildSystem('A', { ...INK_CONFIG, mealPrice: 99 })
    expect(base).toContain(String(INK_CONFIG.mealPrice))
    expect(flipped).toContain('99')
    expect(base).not.toContain('99')
    expect(flipped).not.toBe(base)
    for (const p of Object.values(PLACES)) {
      expect(base).toContain(p.label)
    }
  })

  it('user message names the other mind location and no needs of the other mind', () => {
    const state = createWorld(1)
    state.minds[1]!.at = 'market'
    state.minds[1]!.pos = { ...PLACES.market.door }
    state.minds[1]!.hunger = 0.37
    state.minds[1]!.energy = 0.41
    state.minds[1]!.social = 0.43
    state.minds[0]!.hunger = 0.80
    state.minds[0]!.energy = 0.81
    state.minds[0]!.social = 0.82
    const obs = observationFor(state, 'A')
    const user = buildUser(obs, [])
    expect(user).toMatch(/B is at the market/)
    expect(user).not.toContain('0.37')
    expect(user).not.toContain('0.41')
    expect(user).not.toContain('0.43')
    expect(user).toContain('Fullness 0.80')
    expect(user).toContain('Nothing yet.')
  })

  it('a shut market renders its next opening', () => {
    const state = createWorld(1)
    state.tick = 5 * 1440 + 10 * 60
    const obs = observationFor(state, 'A')
    expect(obs.marketOpen).toBe(false)
    const user = buildUser(obs, ['12:00 you chose wait — waited'])
    expect(user).toMatch(/It is Saturday, 10:00/)
    expect(user).toMatch(/The market is shut/)
    expect(user).toMatch(/Monday 09:00/)
    expect(user).toContain('12:00 you chose wait — waited')
    expect(user).not.toContain('Nothing yet.')
  })

  it('walking renders destination and remaining minutes', () => {
    const state = createWorld(1)
    const mind = state.minds[0]!
    mind.path = pathToPlace(mind.pos, 'market')
    mind.at = null
    const obs = observationFor(state, 'A')
    const user = buildUser(obs, [])
    expect(user).toMatch(/walking to the market, about \d+ minutes away/)
  })
})

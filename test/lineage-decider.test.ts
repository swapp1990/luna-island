import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import { mockDecider, recordedBrainFactory } from '../src/lineage/decider'
import { instinctBrain } from '../src/lineage/instinctBrain'
import { parseIntent } from '../src/lineage/prompt'
import { observe } from '../src/lineage/step'
import type { LineageObservation, Traits, Villager } from '../src/lineage/types'
import { DEFAULT_CONFIG, TRAIT_NAMES } from '../src/lineage/types'
import { createHamlet, mergeConfig } from '../src/lineage/world'

function midTraits(): Traits {
  const t = {} as Traits
  for (const n of TRAIT_NAMES) t[n] = 0.5
  return t
}

function stubVillager(id: string, given: string, traits: Partial<Traits>): Villager {
  return {
    id,
    givenName: given,
    surname: 'Ashen',
    generation: 0,
    parents: null,
    genome: { a: [], b: [] },
    traits: { ...midTraits(), ...traits },
    satiety: 0.8,
    energy: 0.8,
    companionship: 0.8,
    grain: 5,
    standing: 0,
    room: 'hall',
    starvingTurns: 0,
    status: 'alive',
    courted: [],
    talkedWith: {},
  }
}

function stubObs(self: Villager, other: Villager): LineageObservation {
  const villagers = [self, other]
  return {
    self,
    others: [other],
    state: {
      config: DEFAULT_CONFIG,
      tick: 0,
      season: 0,
      day: 5,
      turn: 0,
      villagers,
      granary: 6,
      rules: ['granary-open'],
      proposals: [],
      lineage: [],
      granaryTakenToday: {},
    },
    facts: [],
  }
}

describe('lineage decider', () => {
  it('mockDecider high-generosity gives more often than low-generosity over 500 seeded draws', async () => {
    const other = stubVillager('v-1', 'Bel', {})
    const high = stubVillager('v-0', 'Tal', { generosity: 1 })
    const low = stubVillager('v-0', 'Tal', { generosity: 0 })
    const obsH = stubObs(high, other)
    const obsL = stubObs(low, other)
    const decH = mockDecider(createRng(11), true)
    const decL = mockDecider(createRng(11), true)
    let giveH = 0
    let giveL = 0
    let malformed = 0
    for (let i = 0; i < 500; i++) {
      const rH = await decH.decide({
        villager: high,
        obs: obsH,
        system: '',
        user: '',
        season: 0,
        day: 5,
        turn: 0,
      })
      const rL = await decL.decide({
        villager: low,
        obs: obsL,
        system: '',
        user: '',
        season: 0,
        day: 5,
        turn: 0,
      })
      if ('text' in rH) {
        if (rH.text === 'I will work') malformed += 1
        const p = parseIntent(rH.text, obsH)
        if ('intent' in p && p.intent.kind === 'give') giveH += 1
      }
      if ('text' in rL) {
        const p = parseIntent(rL.text, obsL)
        if ('intent' in p && p.intent.kind === 'give') giveL += 1
      }
    }
    expect(giveH).toBeGreaterThan(giveL)
    expect(malformed).toBeGreaterThan(5)
    expect(malformed).toBeLessThan(30)
  })

  it('recordedBrainFactory returns the recorded intent for a known key and instinct for a missing one', () => {
    const rng = createRng(4)
    const state = createHamlet(mergeConfig({ seed: 4 }), rng)
    const v = state.villagers[0]!
    const obs = observe(state, v)
    const recorded = {
      season: state.season,
      day: state.day,
      turn: state.turn,
      villagerId: v.id,
      intent: { kind: 'idle' as const, reason: 'recorded idle' },
      source: 'mock' as const,
    }
    const factory = recordedBrainFactory([recorded])
    expect(factory(v).decide(obs, createRng(1)).reason).toBe('recorded idle')

    state.turn = 1
    const obsMissing = observe(state, v)
    const a = createRng(9)
    const b = createRng(9)
    expect(factory(v).decide(obsMissing, a)).toEqual(instinctBrain.decide(obsMissing, b))
  })
})

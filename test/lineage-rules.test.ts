import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import type { LineageBrain, LineageIntent, Villager } from '../src/lineage/types'
import { DEFAULT_CONFIG } from '../src/lineage/types'
import { createHamlet, mergeConfig } from '../src/lineage/world'
import { advanceTurn } from '../src/lineage/step'

function brainFor(fn: (v: Villager) => LineageIntent): (v: Villager) => LineageBrain {
  return () => ({ decide: (obs) => fn(obs.self) })
}

function idle(): LineageIntent {
  return { kind: 'idle', reason: 'I wait.' }
}

describe('lineage rules', () => {
  it('granary-closed: eat with no own grain emits action:fail', () => {
    const events = new EventTrace()
    const rng = createRng(1)
    const state = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed: 1 }), rng, events)
    state.rules = ['granary-closed']
    for (const v of state.villagers) v.grain = 0
    advanceTurn(
      state,
      brainFor(() => ({ kind: 'eat', reason: 'I eat.' })),
      rng,
      events,
    )
    const fails = events.getAll().filter((e) => e.type === 'action:fail' && e.agentId === 'v-0')
    expect(fails.length).toBe(1)
  })

  it('ration-granary: second granary eat on the same day fails, first succeeds', () => {
    const events = new EventTrace()
    const rng = createRng(2)
    const state = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed: 2 }), rng, events)
    state.rules = ['granary-open', 'ration-granary']
    state.granary = 20
    for (const v of state.villagers) v.grain = 0
    const eatBrain = brainFor(() => ({ kind: 'eat', reason: 'I eat.' }))
    advanceTurn(state, eatBrain, rng, events)
    const first = events
      .getAll()
      .filter((e) => e.agentId === 'v-0' && (e.type === 'action:end' || e.type === 'action:fail'))
    expect(first.some((e) => e.type === 'action:end' && e.data?.kind === 'eat')).toBe(true)
    expect(first.some((e) => e.type === 'action:fail')).toBe(false)

    advanceTurn(state, eatBrain, rng, events)
    const ofV0 = events.getAll().filter((e) => e.agentId === 'v-0')
    const ends = ofV0.filter((e) => e.type === 'action:end' && e.data?.kind === 'eat')
    const fails = ofV0.filter((e) => e.type === 'action:fail')
    expect(ends.length).toBe(1)
    expect(fails.length).toBe(1)
  })

  it('a proposal with 2 votes is rejected at dusk; 3 for is adopted and enacts the rule', () => {
    const events = new EventTrace()
    const rng = createRng(3)
    const state = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed: 3 }), rng, events)

    const twoVotes: (v: Villager) => LineageBrain = () => ({
      decide: (obs) => {
        const v = obs.self
        if (obs.state.turn === 0 && v.id === 'v-0') {
          return {
            kind: 'propose',
            rule: 'granary-closed',
            text: 'Close the granary.',
            reason: 'I propose closing it.',
          }
        }
        if (obs.state.turn === 1 && (v.id === 'v-1' || v.id === 'v-2')) {
          const p = obs.state.proposals.find((x) => !x.resolved)
          return {
            kind: 'vote',
            proposalId: p?.id,
            choice: 'for',
            reason: 'I vote for.',
          }
        }
        return idle()
      },
    })

    advanceTurn(state, twoVotes, rng, events)
    advanceTurn(state, twoVotes, rng, events)
    advanceTurn(state, twoVotes, rng, events)

    const resolved = events.getAll().filter((e) => e.type === 'proposal:resolved')
    expect(resolved.length).toBe(1)
    expect(resolved[0]!.data?.result).toBe('rejected')
    expect(events.getAll().some((e) => e.type === 'rule:enacted')).toBe(false)
    expect(state.rules).toContain('granary-open')

    const events2 = new EventTrace()
    const rng2 = createRng(4)
    const state2 = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed: 4 }), rng2, events2)
    const threeFor: (v: Villager) => LineageBrain = () => ({
      decide: (obs) => {
        const v = obs.self
        if (obs.state.turn === 0 && v.id === 'v-0') {
          return {
            kind: 'propose',
            rule: 'ration-granary',
            text: 'Ration the granary.',
            reason: 'I propose a ration.',
          }
        }
        if (obs.state.turn === 1 && (v.id === 'v-1' || v.id === 'v-2' || v.id === 'v-3')) {
          const p = obs.state.proposals.find((x) => !x.resolved)
          return {
            kind: 'vote',
            proposalId: p?.id,
            choice: 'for',
            reason: 'I vote for.',
          }
        }
        return idle()
      },
    })
    advanceTurn(state2, threeFor, rng2, events2)
    advanceTurn(state2, threeFor, rng2, events2)
    advanceTurn(state2, threeFor, rng2, events2)
    const resolved2 = events2.getAll().filter((e) => e.type === 'proposal:resolved')
    expect(resolved2.length).toBe(1)
    expect(resolved2[0]!.data?.result).toBe('adopted')
    const enacted = events2.getAll().filter((e) => e.type === 'rule:enacted')
    expect(enacted.length).toBe(1)
    expect(enacted[0]!.data?.rule).toBe('ration-granary')
    expect(state2.rules).toContain('ration-granary')
    expect(state2.rules).toContain('granary-open')
  })
})

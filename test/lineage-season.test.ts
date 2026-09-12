import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import { DEFAULT_CONFIG, SEASON_DEPART_REASON } from '../src/lineage/types'
import { createHamlet, livingVillagers, mergeConfig } from '../src/lineage/world'
import { endSeason } from '../src/lineage/season'
import { runLineage } from '../src/lineage/run'

function hamlet(seed: number, mating: 'courtship' | 'random' = 'courtship') {
  const events = new EventTrace()
  const rng = createRng(seed)
  const state = createHamlet(mergeConfig({ ...DEFAULT_CONFIG, seed, mating }), rng, events)
  return { state, rng, events }
}

describe('lineage season', () => {
  it('endSeason refills the cohort, departs elders, and births generation+1', () => {
    const { state, rng, events } = hamlet(5)
    const previous = state.villagers.map((v) => v.id)
    const prevGen = state.villagers[0]!.generation
    endSeason(state, rng, events)

    const living = livingVillagers(state)
    expect(living.length).toBe(DEFAULT_CONFIG.cohortSize)
    for (const v of living) {
      expect(v.status).toBe('alive')
      expect(v.generation).toBe(prevGen + 1)
      expect(v.parents).not.toBeNull()
      expect(previous).toContain(v.parents![0])
      expect(previous).toContain(v.parents![1])
      expect(v.parents![0]).not.toBe(v.parents![1])
    }

    const departed = events.getAll().filter((e) => e.type === 'villager:departed')
    const departedIds = new Set(departed.map((e) => e.agentId))
    for (const id of previous) {
      expect(departedIds.has(id)).toBe(true)
    }
    for (const e of departed) {
      expect(e.reason ?? e.data?.reason).toBe(SEASON_DEPART_REASON)
    }
  })

  it('mutual courtship pairs appear as lineage:pair with weight 2', () => {
    const { state, rng, events } = hamlet(8)
    for (const v of state.villagers) {
      if (v.id !== 'v-0' && v.id !== 'v-1') v.status = 'departed'
    }
    const a = state.villagers.find((v) => v.id === 'v-0')!
    const b = state.villagers.find((v) => v.id === 'v-1')!
    a.courted = ['v-1']
    b.courted = ['v-0']
    endSeason(state, rng, events)
    const pairs = events.getAll().filter((e) => e.type === 'lineage:pair')
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    const mutual = pairs.find(
      (e) =>
        e.data?.weight === 2 &&
        ((e.data?.p1 === 'v-0' && e.data?.p2 === 'v-1') ||
          (e.data?.p1 === 'v-1' && e.data?.p2 === 'v-0')),
    )
    expect(mutual).toBeTruthy()
  })

  it("mating: 'random' never emits weight 2 even with courtships", () => {
    const { state, rng, events } = hamlet(8, 'random')
    for (const v of state.villagers) {
      if (v.id !== 'v-0' && v.id !== 'v-1') v.status = 'departed'
    }
    const a = state.villagers.find((v) => v.id === 'v-0')!
    const b = state.villagers.find((v) => v.id === 'v-1')!
    a.courted = ['v-1']
    b.courted = ['v-0']
    endSeason(state, rng, events)
    const pairs = events.getAll().filter((e) => e.type === 'lineage:pair')
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    for (const e of pairs) {
      expect(e.data?.weight).not.toBe(2)
    }
  })

  it('ids are unique across a multi-season run', () => {
    const { state } = runLineage({ ...DEFAULT_CONFIG, seasons: 3, seed: 12 })
    const ids = state.lineage.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(DEFAULT_CONFIG.cohortSize * 4)
  })
})

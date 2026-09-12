import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/lineage/types'
import { runLineage } from '../src/lineage/run'

describe('lineage determinism', () => {
  it('same default seed twice → identical hash, eventCount, trait means (3 seasons)', () => {
    const cfg = { ...DEFAULT_CONFIG, seasons: 3 }
    const a = runLineage(cfg)
    const b = runLineage(cfg)
    expect(a.summary.hash).toBe(b.summary.hash)
    expect(a.summary.eventCount).toBe(b.summary.eventCount)
    expect(a.summary.traitMeansByGeneration).toEqual(b.summary.traitMeansByGeneration)
  })

  it('seed 43 → different hash', () => {
    const a = runLineage({ ...DEFAULT_CONFIG, seasons: 3, seed: 42 })
    const b = runLineage({ ...DEFAULT_CONFIG, seasons: 3, seed: 43 })
    expect(a.summary.hash).not.toBe(b.summary.hash)
  })

  it("mating: 'random' with the same seed → different hash", () => {
    const court = runLineage({ ...DEFAULT_CONFIG, seasons: 3, seed: 42, mating: 'courtship' })
    const rand = runLineage({ ...DEFAULT_CONFIG, seasons: 3, seed: 42, mating: 'random' })
    expect(court.summary.hash).not.toBe(rand.summary.hash)
  })
})

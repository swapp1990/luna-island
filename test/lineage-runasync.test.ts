import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import { mockDecider, recordedBrainFactory } from '../src/lineage/decider'
import { runLineage } from '../src/lineage/run'
import { runLineageAsync } from '../src/lineage/runAsync'

describe('lineage runLineageAsync', () => {
  it('mock 2 seasons seed 42 replays with identical hash and eventCount', async () => {
    const cfg = { seed: 42, seasons: 2 }
    const result = await runLineageAsync(cfg, mockDecider(createRng(42), true), {
      dna: true,
      concurrency: 1,
      decisionSource: 'mock',
    })
    const replay = runLineage(cfg, recordedBrainFactory(result.decisions))
    expect(replay.summary.hash).toBe(result.summary.hash)
    expect(replay.summary.eventCount).toBe(result.summary.eventCount)

    const fallbacks = result.events.filter((e) => e.type === 'mind:fallback')
    for (const e of fallbacks) {
      expect(typeof e.data?.error).toBe('string')
      expect(String(e.data?.error).length).toBeGreaterThan(0)
    }

    const villagerTurns = result.events.filter((e) => e.type === 'action:start').length
    expect(result.mind.llm + result.mind.fallback).toBe(villagerTurns)
    expect(result.decisions.length).toBe(villagerTurns)

    const off = await runLineageAsync(cfg, mockDecider(createRng(42), false), {
      dna: false,
      concurrency: 1,
      decisionSource: 'mock',
    })
    expect(off.summary.hash).not.toBe(result.summary.hash)
  })
})

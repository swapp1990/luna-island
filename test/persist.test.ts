import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import {
  serializeSave,
  restoreSave,
  SaveFormatError,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'

describe('persistence serialize/restore', () => {
  it('round-trips hash at tick T and continues deterministically 500 ticks', () => {
    const original = new Simulation(42)
    original.advanceTicks(1500)
    const hashAtT = original.hash()
    const tickAtT = original.state.tick
    const archivesAtT = original.archives().length
    const eventsAtT = original.getEventCount()

    const save = serializeSave(original)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(save.tick).toBe(tickAtT)
    expect(save.seed).toBe(42)
    expect(save.dayArchives.length).toBe(archivesAtT)
    expect(save.events.length).toBe(eventsAtT)

    const restored = restoreSave(save)
    expect(restored.state.tick).toBe(tickAtT)
    expect(restored.hash()).toBe(hashAtT)
    expect(restored.archives().length).toBe(archivesAtT)
    expect(restored.getEventCount()).toBe(eventsAtT)

    original.advanceTicks(500)
    restored.advanceTicks(500)
    expect(restored.hash()).toBe(original.hash())
    expect(restored.getEventCount()).toBe(original.getEventCount())
  })

  it('rejects format-version mismatch cleanly', () => {
    const sim = new Simulation(7)
    sim.advanceTicks(100)
    const save = serializeSave(sim) as unknown as Record<string, unknown>
    save.formatVersion = 999

    expect(() => restoreSave(save)).toThrow(SaveFormatError)
    expect(() => restoreSave(save)).toThrow(/Unsupported save format version/)
  })

  it('rejects non-object / missing snapshot without half-loading', () => {
    expect(() => restoreSave(null)).toThrow(SaveFormatError)
    expect(() => restoreSave('nope')).toThrow(SaveFormatError)
    expect(() =>
      restoreSave({ formatVersion: 1, seed: 1, tick: 0 }),
    ).toThrow(SaveFormatError)
  })

  it('restored sim can seek archived day (stateAt)', () => {
    const sim = new Simulation(42)
    // Cross into Day 2 so Day 1 is archived
    sim.advanceTicks(1200)
    expect(sim.archives().some((a) => a.day === 1)).toBe(true)

    const restored = restoreSave(serializeSave(sim))
    const mid = restored.stateAt(500)
    const fresh = new Simulation(42)
    fresh.advanceTicks(500)
    expect(mid.hash()).toBe(fresh.hash())
  })
})

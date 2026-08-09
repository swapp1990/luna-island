import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'

describe('determinism', () => {
  it('same seed ⇒ same history after 4320 ticks', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(4320)
    b.advanceTicks(4320)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    const ea = a.getEvents()
    const eb = b.getEvents()
    expect(ea[ea.length - 1]).toEqual(eb[eb.length - 1])
  })

  it('different seed ⇒ different hash', () => {
    const a = new Simulation(42)
    const b = new Simulation(43)
    a.advanceTicks(1000)
    b.advanceTicks(1000)
    expect(a.hash()).not.toBe(b.hash())
  })

  it('seek correctness: stateAt matches fresh advance', () => {
    const simA = new Simulation(42)
    simA.advanceTicks(4320)
    const sought = simA.stateAt(2500)
    const fresh = new Simulation(42)
    fresh.advanceTicks(2500)
    expect(sought.hash()).toBe(fresh.hash())
  })

  it('snapshot round-trip then advance keeps hashes equal', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(1000)
    const snap = sim.snapshot()
    const restored = Simulation.fromSnapshot(snap)
    expect(restored.hash()).toBe(sim.hash())
    sim.advanceTicks(500)
    restored.advanceTicks(500)
    expect(restored.hash()).toBe(sim.hash())
  })
})

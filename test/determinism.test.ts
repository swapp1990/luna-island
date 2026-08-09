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

  it('after 3 days: needs valid, every agent acted with reason, every agent slept', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(4320) // 3 days

    expect(sim.state.agents.length).toBe(24)

    for (const agent of sim.state.agents) {
      for (const key of ['hunger', 'energy', 'social'] as const) {
        const v = agent.needs[key]
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }

    const events = sim.getEvents()
    for (const agent of sim.state.agents) {
      const starts = events.filter(
        (e) => e.agentId === agent.id && e.type === 'action:start',
      )
      expect(starts.length).toBeGreaterThanOrEqual(1)
      for (const s of starts) {
        expect(s.reason && s.reason.length > 0).toBe(true)
      }
      const slept = starts.some((e) => e.data?.kind === 'sleep')
      expect(slept).toBe(true)
    }
  })

  it('sleep flip-flop regression: ≤4 sleep starts per agent per sim-day over 3 days', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(4320) // 3 days
    const events = sim.getEvents()

    for (const agent of sim.state.agents) {
      // Day index from event tick: tick 0 = day 1 06:00; calendar day via toSimTime-like math
      const sleepStarts = events.filter(
        (e) =>
          e.agentId === agent.id &&
          e.type === 'action:start' &&
          e.data?.kind === 'sleep',
      )
      // Bucket by calendar day (tick + 360) / 1440
      const perDay = new Map<number, number>()
      for (const e of sleepStarts) {
        const day = Math.floor((e.tick + 360) / 1440) + 1
        perDay.set(day, (perDay.get(day) ?? 0) + 1)
      }
      for (const [day, count] of perDay) {
        expect(count, `${agent.id} day ${day} sleep starts`).toBeLessThanOrEqual(4)
      }
    }
  })
})

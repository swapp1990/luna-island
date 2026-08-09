import { describe, expect, it } from 'vitest'
import { Simulation, SNAPSHOT_INTERVAL } from '../src/sim/sim'
import { dayEndTick, dayStartTick, toSimTime } from '../src/sim/time'

const DAY = 1440
/** 3×1440 from Day1 06:00 lands on Day4 06:00 — three full calendar days archived. */
const THREE_DAYS = 3 * DAY // 4320

describe('day archive', () => {
  it('archives completed days with correct tick bounds after 3 sim-days', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(THREE_DAYS)

    const t = toSimTime(sim.state.tick)
    // tick 4320 = Day 4 06:00 (same "3 days" convention as determinism tests)
    expect(t.day).toBe(4)

    const archives = sim.archives()
    expect(archives.length).toBeGreaterThanOrEqual(2)

    const d1 = archives.find((a) => a.day === 1)
    const d2 = archives.find((a) => a.day === 2)
    expect(d1).toBeDefined()
    expect(d2).toBeDefined()

    expect(d1!.startTick).toBe(dayStartTick(1))
    expect(d1!.endTick).toBe(dayEndTick(1))
    expect(d1!.startTick).toBe(0)
    expect(d1!.endTick).toBe(dayStartTick(2) - 1)

    expect(d2!.startTick).toBe(dayStartTick(2))
    expect(d2!.endTick).toBe(dayEndTick(2))
    expect(d2!.startTick).toBe(1080)
    expect(d2!.endTick).toBe(dayStartTick(3) - 1)
  })

  it('prunes fine snapshots for archived days but keeps day-start pins', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(THREE_DAYS)

    const ticks = sim.snapshotTicks()
    const d1Start = dayStartTick(1)
    const d1End = dayEndTick(1)
    const d2Start = dayStartTick(2)
    const d2End = dayEndTick(2)

    // Day-start pins remain
    expect(ticks).toContain(d1Start)
    expect(ticks).toContain(d2Start)

    // No fine-grained snaps inside archived day interiors
    const fineInDay1 = ticks.filter(
      (t) => t > d1Start && t <= d1End && t % SNAPSHOT_INTERVAL === 0,
    )
    const fineInDay2 = ticks.filter(
      (t) => t > d2Start && t <= d2End && t % SNAPSHOT_INTERVAL === 0,
    )
    expect(fineInDay1).toEqual([])
    expect(fineInDay2).toEqual([])

    // Day 3 start must remain (archived by this point); current day may keep fine snaps
    const d3Start = dayStartTick(3)
    expect(ticks).toContain(d3Start)
  })

  it('stateAt mid-Day-1 matches fresh sim (hash) after archive prune', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(THREE_DAYS)

    // Mid Day 1: e.g. tick 500 (~14:20 on day 1)
    const mid = 500
    expect(toSimTime(mid).day).toBe(1)

    const sought = sim.stateAt(mid)
    const fresh = new Simulation(42)
    fresh.advanceTicks(mid)
    expect(sought.hash()).toBe(fresh.hash())
  })

  it('determinism double-run still green with archiving', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(THREE_DAYS)
    b.advanceTicks(THREE_DAYS)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    expect(a.archives()).toEqual(b.archives())
  })

  it('advanceTicksBatch equals advanceTicks', () => {
    const a = new Simulation(7)
    const b = new Simulation(7)
    a.advanceTicks(500)
    b.advanceTicksBatch(500)
    expect(a.hash()).toBe(b.hash())
  })
})

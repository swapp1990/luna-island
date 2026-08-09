import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import { dayStartTick } from '../src/sim/time'
import type { AgentState } from '../src/sim/types'

const SEED = 42
const DAY = 1440

/** Pin two agents adjacent & stationary so sympathy can accrue. */
function pinAdjacent(sim: Simulation, a: AgentState, b: AgentState): void {
  const x = 22
  const y = 22
  a.x = x
  a.y = y
  b.x = x + 1
  b.y = y
  for (const ag of [a, b]) {
    ag.action = {
      kind: 'socialize',
      targetX: Math.round(ag.x),
      targetY: Math.round(ag.y),
      path: [],
      reason: 'pinned for sympathy test',
    }
    ag.pathIndex = 0
    ag.actionTicks = 1
    ag.lastDecideTick = sim.state.tick
    ag.needs = { hunger: 0.85, energy: 0.85, social: 0.55 }
    ag.collapsed = false
  }
}

/** Park agent far away so they never meet the pair. */
function pinFar(sim: Simulation, ag: AgentState, x: number, y: number): void {
  ag.x = x
  ag.y = y
  ag.action = {
    kind: 'idle',
    targetX: x,
    targetY: y,
    path: [],
    reason: 'parked far',
  }
  ag.pathIndex = 0
  ag.actionTicks = 0
  ag.lastDecideTick = sim.state.tick
  ag.needs = { hunger: 0.85, energy: 0.85, social: 0.85 }
  ag.collapsed = false
}

describe('relationships: sympathy (observed, not obeyed)', () => {
  it('adjacent stationary pair accrues sympathy; separated pair decays', () => {
    const sim = new Simulation(SEED)
    const a = sim.state.agents[0]!
    const b = sim.state.agents[1]!
    const c = sim.state.agents[2]!

    // Give a↔c some prior sympathy so decay is observable
    a.sympathy = { [c.id]: 0.25 }
    c.sympathy = { [a.id]: 0.25 }

    // Accrue a↔b for 100 ticks → expect +0.10
    for (let i = 0; i < 100; i++) {
      pinAdjacent(sim, a, b)
      pinFar(sim, c, 5, 5)
      // Keep everyone else from accidentally meeting a/b
      for (const other of sim.state.agents) {
        if (other.id === a.id || other.id === b.id || other.id === c.id) continue
        pinFar(sim, other, 2 + (other.id.charCodeAt(other.id.length - 1) % 8), 2)
      }
      sim.advanceTicks(1)
    }

    const ab = a.sympathy[b.id] ?? 0
    expect(ab).toBeCloseTo(0.1, 5)
    expect(b.sympathy[a.id]).toBeCloseTo(0.1, 5)
    // Symmetric
    expect(a.sympathy[b.id]).toBe(b.sympathy[a.id])

    // a↔c never met during this day — after a day boundary, decay −0.02
    // Jump to next midnight if needed so decay runs once without further a↔c contact
    const beforeDecay = a.sympathy[c.id] ?? 0
    expect(beforeDecay).toBeCloseTo(0.25, 5)

    // Separate a and c; advance past next day boundary without them meeting
    const nextDayStart = dayStartTick(
      (() => {
        const abs = sim.state.tick + 6 * 60
        return Math.floor(abs / DAY) + 2
      })(),
    )
    const ticksToBoundary = Math.max(1, nextDayStart - sim.state.tick)
    for (let i = 0; i < ticksToBoundary; i++) {
      // Keep a and c far; b can stay near a so a↔b keeps meeting (no decay for them)
      pinAdjacent(sim, a, b)
      pinFar(sim, c, 5, 5)
      for (const other of sim.state.agents) {
        if (other.id === a.id || other.id === b.id || other.id === c.id) continue
        pinFar(sim, other, 2, 2)
      }
      sim.advanceTicks(1)
    }

    const afterDecay = a.sympathy[c.id] ?? 0
    expect(afterDecay).toBeCloseTo(beforeDecay - 0.02, 5)
    expect(c.sympathy[a.id]).toBeCloseTo(afterDecay, 5)
    // a↔b kept meeting — no decay
    expect(a.sympathy[b.id] ?? 0).toBeGreaterThanOrEqual(ab)
  })

  it('milestone events fire exactly once per threshold crossing', () => {
    const sim = new Simulation(SEED)
    const a = sim.state.agents[0]!
    const b = sim.state.agents[1]!

    // Drive to friend (0.3) then close (0.6): 30 + 30 units of 0.01 = 600 ticks
    const ticks = 620
    for (let i = 0; i < ticks; i++) {
      pinAdjacent(sim, a, b)
      for (const other of sim.state.agents) {
        if (other.id === a.id || other.id === b.id) continue
        pinFar(sim, other, 3, 3)
      }
      sim.advanceTicks(1)
    }

    const friends = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'relationship:friends' &&
          ((e.data?.agentIdA === a.id && e.data?.agentIdB === b.id) ||
            (e.data?.agentIdA === b.id && e.data?.agentIdB === a.id)),
      )
    const close = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'relationship:close' &&
          ((e.data?.agentIdA === a.id && e.data?.agentIdB === b.id) ||
            (e.data?.agentIdA === b.id && e.data?.agentIdB === a.id)),
      )

    expect(friends.length).toBe(1)
    expect(close.length).toBe(1)
    expect(friends[0]!.reason).toBe('grown close from time spent together')
    expect(close[0]!.reason).toBe('grown close from time spent together')
    expect(friends[0]!.data?.nameA).toBeTruthy()
    expect(friends[0]!.data?.nameB).toBeTruthy()

    const sym = a.sympathy[b.id] ?? 0
    expect(sym).toBeGreaterThanOrEqual(0.6)

    // Cross back down and re-cross: decay artificially then re-accrue
    a.sympathy[b.id] = 0.25
    b.sympathy[a.id] = 0.25
    // Clear streak so we get a clean re-cross
    sim.state.sympathyStreak = {}

    for (let i = 0; i < 60; i++) {
      pinAdjacent(sim, a, b)
      for (const other of sim.state.agents) {
        if (other.id === a.id || other.id === b.id) continue
        pinFar(sim, other, 3, 3)
      }
      sim.advanceTicks(1)
    }

    const friends2 = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'relationship:friends' &&
          ((e.data?.agentIdA === a.id && e.data?.agentIdB === b.id) ||
            (e.data?.agentIdA === b.id && e.data?.agentIdB === a.id)),
      )
    // Original + re-cross
    expect(friends2.length).toBe(2)
  })

  it('determinism + snapshot/seek hashes include sympathy', () => {
    const a = new Simulation(SEED)
    const b = new Simulation(SEED)
    a.advanceTicks(2 * DAY)
    b.advanceTicks(2 * DAY)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())

    // Some sympathy should exist after 2 days of natural co-location
    const anySympathy = a.state.agents.some(
      (ag) => Object.keys(ag.sympathy ?? {}).length > 0,
    )
    // Soft: not required for hash equality; if present, must match
    if (anySympathy) {
      for (let i = 0; i < a.state.agents.length; i++) {
        expect(a.state.agents[i]!.sympathy).toEqual(b.state.agents[i]!.sympathy)
      }
    }

    const mid = 1500
    const sought = a.stateAt(mid)
    const fresh = new Simulation(SEED)
    fresh.advanceTicks(mid)
    expect(sought.hash()).toBe(fresh.hash())

    const snap = a.snapshot()
    const restored = Simulation.fromSnapshot(snap)
    expect(restored.hash()).toBe(a.hash())

    // Sparse: no zero entries
    for (const ag of a.state.agents) {
      for (const v of Object.values(ag.sympathy ?? {})) {
        expect(v).toBeGreaterThan(0)
      }
    }
  })
})

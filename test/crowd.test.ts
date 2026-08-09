import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import {
  canRestoreThisTick,
  isSlotTile,
  isWalking,
  SOCIAL_PROXIMITY_SQ,
} from '../src/sim/spots'

const DAY = 1440
const SAMPLE = 60

function tileKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function hasNeighborWithin15(
  agent: { id: string; x: number; y: number },
  agents: Array<{ id: string; x: number; y: number }>,
): boolean {
  for (const o of agents) {
    if (o.id === agent.id) continue
    if (dist2(agent.x, agent.y, o.x, o.y) <= SOCIAL_PROXIMITY_SQ) return true
  }
  return false
}

describe('world rules (slots, proximity, occupancy)', () => {
  it('restorers stand on place slot tiles and concurrent ≤ slots (all place kinds)', () => {
    const sim = new Simulation(42)
    const maxDays = 3 * DAY

    for (let t = 0; t <= maxDays; t++) {
      if (t % SAMPLE === 0) {
        const world = sim.state
        const byPlace = new Map<string, number>()
        for (const a of world.agents) {
          const pid = a.action.targetPlaceId
          if (!pid) continue
          const place = world.places.find((p) => p.id === pid)
          if (!place) continue
          if (!canRestoreThisTick(world, a, place)) continue
          // Actively restoring ⇒ on a slot tile of that place
          expect(
            isSlotTile(world, place, a.x, a.y),
            `tick ${world.tick} agent ${a.id} restoring at ${place.id} off slot (${a.x},${a.y})`,
          ).toBe(true)
          byPlace.set(pid, (byPlace.get(pid) ?? 0) + 1)
        }
        for (const [pid, n] of byPlace) {
          const place = world.places.find((p) => p.id === pid)!
          expect(
            n,
            `tick ${world.tick} place ${pid} has ${n} restorers > slots ${place.slots}`,
          ).toBeLessThanOrEqual(place.slots)
        }
      }
      if (t < maxDays) sim.advanceTicks(1)
    }
  })

  it('when social need rises, another agent is within 1.5 tiles', () => {
    const sim = new Simulation(42)
    const maxDays = 3 * DAY
    // stepNeeds uses start-of-tick positions (before movement) — track those
    const prevSocial = new Map<string, number>()
    const prevPos = new Map<string, { x: number; y: number }>()
    for (const a of sim.state.agents) {
      prevSocial.set(a.id, a.needs.social)
      prevPos.set(a.id, { x: a.x, y: a.y })
    }

    let rises = 0
    for (let t = 0; t < maxDays; t++) {
      const startPos = sim.state.agents.map((a) => ({ id: a.id, x: a.x, y: a.y }))
      sim.advanceTicks(1)
      if ((t + 1) % SAMPLE !== 0) {
        for (const a of sim.state.agents) {
          prevSocial.set(a.id, a.needs.social)
          prevPos.set(a.id, { x: a.x, y: a.y })
        }
        continue
      }
      for (const a of sim.state.agents) {
        const before = prevSocial.get(a.id) ?? a.needs.social
        if (a.needs.social > before + 1e-9) {
          rises++
          // Needs ran against positions at the start of this tick
          const me = startPos.find((p) => p.id === a.id)!
          expect(
            hasNeighborWithin15(me, startPos),
            `tick ${sim.state.tick} agent ${a.id} social rose ${before}→${a.needs.social} with no neighbor within 1.5 at needs time`,
          ).toBe(true)
        }
        prevSocial.set(a.id, a.needs.social)
        prevPos.set(a.id, { x: a.x, y: a.y })
      }
    }
    expect(rises, 'expected some social regen over 3 days').toBeGreaterThanOrEqual(1)
  })

  it('≤ 1 stationary agent per tile over 3 days (sample every 60 ticks)', () => {
    const sim = new Simulation(42)
    const maxDays = 3 * DAY

    for (let t = 0; t <= maxDays; t++) {
      if (t % SAMPLE === 0) {
        const counts = new Map<string, number>()
        for (const a of sim.state.agents) {
          if (isWalking(a)) continue
          const k = tileKey(a.x, a.y)
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        for (const [k, n] of counts) {
          expect(n, `tick ${sim.state.tick} tile ${k} has ${n} stationary`).toBeLessThanOrEqual(1)
        }
      }
      if (t < maxDays) sim.advanceTicks(1)
    }
  })

  it('reservation / slot logic is deterministic (double-run hash equality)', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(3 * DAY)
    b.advanceTicks(3 * DAY)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
  })

  it('snapshot/seek hash equality still green', () => {
    const simA = new Simulation(42)
    simA.advanceTicks(3 * DAY)
    const sought = simA.stateAt(2500)
    const fresh = new Simulation(42)
    fresh.advanceTicks(2500)
    expect(sought.hash()).toBe(fresh.hash())
  })
})

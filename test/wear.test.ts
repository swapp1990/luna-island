// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { readFileSync } from 'node:fs'
import { NO_RECORDED_WORLDS, recordedWorldPaths } from './recordedWorlds'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Simulation, WEAR_CAP } from '../src/sim/sim'
import {
  restoreSave,
  serializeSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import type { AgentState, Tile } from '../src/sim/types'

function tileAt(sim: Simulation, x: number, y: number): Tile {
  return sim.state.tiles[y * sim.state.width + x]!
}

function wearAt(sim: Simulation, x: number, y: number): number {
  return tileAt(sim, x, y).wear ?? 0
}

function wearSignature(sim: Simulation): number[] {
  return sim.state.tiles.map((t) => t.wear ?? 0)
}

function findAdjacentWalkable(sim: Simulation): { from: Tile; to: Tile } {
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (const t of sim.state.tiles) {
    if (!t.walkable) continue
    for (const [dx, dy] of dirs) {
      const nx = t.x + dx
      const ny = t.y + dy
      if (nx < 0 || ny < 0 || nx >= sim.state.width || ny >= sim.state.height) {
        continue
      }
      const n = tileAt(sim, nx, ny)
      if (n.walkable) return { from: t, to: n }
    }
  }
  throw new Error('no adjacent walkable pair')
}

function parkOthers(
  sim: Simulation,
  keepId: string,
  reserved: Set<string>,
): void {
  const spots = sim.state.tiles.filter(
    (t) => t.walkable && !reserved.has(`${t.x},${t.y}`),
  )
  let i = 0
  for (const a of sim.state.agents) {
    if (a.id === keepId) continue
    const t = spots[i++]
    if (!t) break
    a.x = t.x
    a.y = t.y
    a.action = { kind: 'idle', reason: 'parked' }
    a.actionTicks = 0
    a.pathIndex = 0
    a.lastDecideTick = sim.state.tick
    a.needs.hunger = 0.6
    a.needs.energy = 0.6
    a.needs.social = 0.6
    a.collapsed = false
    a.inventory.food = 0
  }
}

function forceStep(
  sim: Simulation,
  from: Tile,
  to: Tile,
  opts?: { collapsed?: boolean },
): AgentState {
  const agent = sim.state.agents[0]!
  parkOthers(sim, agent.id, new Set([`${from.x},${from.y}`, `${to.x},${to.y}`]))
  agent.x = from.x
  agent.y = from.y
  agent.collapsed = !!opts?.collapsed
  agent.needs.hunger = opts?.collapsed ? 0.01 : 0.6
  agent.needs.energy = 0.6
  agent.needs.social = 0.6
  agent.lastDecideTick = sim.state.tick
  agent.action = {
    kind: 'wander',
    targetX: to.x,
    targetY: to.y,
    path: [[to.x, to.y]],
    reason: 'test wear step',
  }
  agent.pathIndex = 0
  agent.actionTicks = 0
  return agent
}

describe('wear paths', () => {
  it('increments on a completed step and not on a blocked or incomplete one', () => {
    const sim = new Simulation(42)
    const { from, to } = findAdjacentWalkable(sim)
    expect(wearAt(sim, to.x, to.y)).toBe(0)
    expect(to.wear).toBeUndefined()

    const walker = forceStep(sim, from, to)
    sim.advanceTicks(1)
    expect(Math.round(walker.x)).toBe(to.x)
    expect(Math.round(walker.y)).toBe(to.y)
    expect(wearAt(sim, to.x, to.y)).toBe(1)

    // Incomplete: collapsed crawl (×0.4) does not land in one tick.
    const next = findAdjacentWalkable(sim)
    const destWearBefore = wearAt(sim, next.to.x, next.to.y)
    const crawler = forceStep(sim, next.from, next.to, { collapsed: true })
    sim.advanceTicks(1)
    expect(Math.abs(crawler.x - next.to.x) + Math.abs(crawler.y - next.to.y)).toBeGreaterThan(
      0.2,
    )
    expect(wearAt(sim, next.to.x, next.to.y)).toBe(destWearBefore)

    // Blocked: destination unwalkable — no step onto that tile.
    const blocked = findAdjacentWalkable(sim)
    const blockedWear = wearAt(sim, blocked.to.x, blocked.to.y)
    forceStep(sim, blocked.from, blocked.to)
    blocked.to.walkable = false
    sim.advanceTicks(1)
    expect(wearAt(sim, blocked.to.x, blocked.to.y)).toBe(blockedWear)
  })

  it('caps at WEAR_CAP', () => {
    const sim = new Simulation(42)
    const { from, to } = findAdjacentWalkable(sim)
    to.wear = WEAR_CAP - 1
    const walker = forceStep(sim, from, to)
    sim.advanceTicks(1)
    expect(Math.round(walker.x)).toBe(to.x)
    expect(wearAt(sim, to.x, to.y)).toBe(WEAR_CAP)

    walker.x = from.x
    walker.y = from.y
    walker.lastDecideTick = sim.state.tick
    walker.action = {
      kind: 'wander',
      targetX: to.x,
      targetY: to.y,
      path: [[to.x, to.y]],
      reason: 'test wear cap',
    }
    walker.pathIndex = 0
    sim.advanceTicks(1)
    expect(wearAt(sim, to.x, to.y)).toBe(WEAR_CAP)
  })

  it('missing wear reads as 0 on old-save import', () => {
    const sim = new Simulation(7)
    const { from, to } = findAdjacentWalkable(sim)
    forceStep(sim, from, to)
    sim.advanceTicks(1)
    expect(wearAt(sim, to.x, to.y)).toBe(1)

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(SAVE_FORMAT_VERSION).toBe(5)
    for (const t of save.snapshot.state.tiles) {
      delete t.wear
    }
    for (const snap of [
      ...save.pinnedDayStartSnapshots,
      ...save.fineSnapshotRing,
    ]) {
      for (const t of snap.state.tiles) delete t.wear
    }

    const restored = restoreSave(save)
    expect(restored.state.tiles.every((t) => t.wear === undefined)).toBe(true)
    expect(wearSignature(restored).every((w) => w === 0)).toBe(true)
  })

  it('survives save round-trip and stateAt re-sim', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(400)
    const tickA = sim.state.tick
    const hashA = sim.hash()
    const wearA = wearSignature(sim)
    expect(wearA.some((w) => w > 0)).toBe(true)

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(5)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(hashA)
    expect(wearSignature(restored)).toEqual(wearA)

    sim.advanceTicks(400)
    const fork = sim.stateAt(tickA)
    expect(fork.hash()).toBe(hashA)
    expect(wearSignature(fork)).toEqual(wearA)
  })

  it('same seed double-run: identical wear and hash', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(800)
    b.advanceTicks(800)
    expect(a.hash()).toBe(b.hash())
    expect(wearSignature(a)).toEqual(wearSignature(b))
    expect(wearSignature(a).some((w) => w > 0)).toBe(true)
  })

  it('recorded soak worlds still import (no wear field)', (ctx) => {
    const files = recordedWorldPaths([
      'artifacts/soak-1787430602479-world.json',
      'artifacts/soak-1787452399090-world.json',
    ])
    if (files.length === 0) return ctx.skip(NO_RECORDED_WORLDS)
    for (const file of files) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        tick: number
        seed: number
        snapshot: { state: { agents: unknown[]; tiles: Tile[] } }
      }
      const sim = restoreSave(raw)
      expect(sim.state.tick).toBe(raw.tick)
      expect(sim.state.seed).toBe(raw.seed)
      expect(sim.state.agents.length).toBeGreaterThan(0)
      expect(sim.state.tiles.every((t) => (t.wear ?? 0) === 0)).toBe(true)
    }
  }, 120_000)
})

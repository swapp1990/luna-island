// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { readFileSync } from 'node:fs'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_INTERVAL,
  Simulation,
} from '../src/sim/sim'
import {
  FLOOR_SLEEP_FELT,
  PLACE_BUSY_THRESHOLD,
  crowdedTodayExamineLine,
  examineKnowledgeFor,
} from '../src/sim/examine'
import { dayStartTick, toSimTime } from '../src/sim/time'
import { slotTiles } from '../src/sim/spots'
import {
  feltConsequenceLines,
  formatNearbyPlaceLine,
  nearbyPlacesForObservation,
} from '../src/mind/knowledge'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'
import {
  restoreSave,
  serializeSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import type { ExternalIntentMeta, Place } from '../src/sim/types'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function parkFar(sim: Simulation, keep: ReadonlySet<string>): void {
  let x = 2
  let y = 2
  for (const a of sim.state.agents) {
    if (keep.has(a.id)) continue
    a.x = x
    a.y = y
    a.action = { kind: 'idle', reason: 'parked' }
    a.lastDecideTick = sim.state.tick
    a.employedAt = null
    a.workPhase = null
    a.pathIndex = 0
    x++
    if (x > 12) {
      x = 2
      y++
    }
  }
}

function putSleeping(
  sim: Simulation,
  agentId: string,
  place: Place,
  x: number,
  y: number,
  energy = 0.4,
): void {
  const agent = sim.state.agents.find((a) => a.id === agentId)!
  agent.x = x
  agent.y = y
  agent.homeId = place.id
  agent.collapsed = false
  agent.employedAt = null
  agent.workPhase = null
  agent.pathIndex = 0
  agent.actionTicks = 8
  agent.lastDecideTick = sim.state.tick
  agent.needs.energy = energy
  agent.actionStartNeeds = { ...agent.needs, energy }
  agent.action = {
    kind: 'sleep',
    targetPlaceId: place.id,
    targetX: x,
    targetY: y,
    path: [],
    reason: 'sleeping',
  }
}

function wakeNow(sim: Simulation, agentIds: readonly string[]): void {
  for (const id of agentIds) {
    const a = sim.state.agents.find((ag) => ag.id === id)!
    a.needs.energy = 0.95
    a.lastDecideTick = sim.state.tick
  }
  sim.advanceTicks(1)
}

function floorSleepFelts(sim: Simulation, agentId: string) {
  return sim.getEvents().filter(
    (e) =>
      e.agentId === agentId &&
      e.type === 'action:end' &&
      (e.data?.floorSleep === true || e.data?.felt === FLOOR_SLEEP_FELT),
  )
}

function occupyWell(sim: Simulation, occupantId: string): void {
  const well = sim.state.places.find((p) => p.kind === 'well')!
  const occupant = sim.state.agents.find((a) => a.id === occupantId)!
  occupant.x = well.x
  occupant.y = well.y
  occupant.action = {
    kind: 'drink',
    targetPlaceId: well.id,
    targetX: well.x,
    targetY: well.y,
    path: [],
    reason: 'drawing water',
  }
  occupant.pathIndex = 0
  occupant.actionTicks = 1
  occupant.lastDecideTick = sim.state.tick
}

function tryDrinkWell(sim: Simulation, agentId: string): void {
  const well = sim.state.places.find((p) => p.kind === 'well')!
  const agent = sim.state.agents.find((a) => a.id === agentId)!
  agent.x = well.x + 2
  agent.y = well.y
  agent.lastDecideTick = sim.state.tick - 40
  sim.postExternalIntent(
    agentId,
    {
      kind: 'drink',
      targetPlaceId: well.id,
      targetX: well.x,
      targetY: well.y,
      reason: 'I want water',
    },
    meta('I want water'),
  )
  sim.advanceTicks(1)
}

function blockedTodayFromEvents(sim: Simulation): Record<string, number> {
  const day = toSimTime(sim.state.tick).day
  const start = dayStartTick(day)
  const out: Record<string, number> = {}
  for (const e of sim.getEvents()) {
    if (e.type !== 'place:blocked') continue
    if (e.tick < start) continue
    const id = String(e.data?.placeId ?? '')
    if (!id) continue
    out[id] = (out[id] ?? 0) + 1
  }
  return out
}

describe('P5-5 crowding facts', () => {
  it('save format version is unchanged', () => {
    expect(SAVE_FORMAT_VERSION).toBe(5)
    expect(PLACE_BUSY_THRESHOLD).toBe(3)
    expect(FLOOR_SLEEP_FELT).toBe('the beds at home were full — slept on the floor')
    expect(crowdedTodayExamineLine(2)).toBeNull()
    expect(crowdedTodayExamineLine(3)).toBe(
      'It was crowded today — turned people away 3 times.',
    )
    expect(crowdedTodayExamineLine(7)).toBe(
      'It was crowded today — turned people away 7 times.',
    )
  })

  it('floor-sleep in a full home emits the felt line exactly once per night', () => {
    const sim = new Simulation(42)
    const home = sim.state.places.find((p) => p.kind === 'home')!
    home.slots = 1
    const tiles = slotTiles(sim.state, home)
    expect(tiles.length).toBeGreaterThanOrEqual(2)
    parkFar(sim, new Set(['agent-0', 'agent-1']))
    putSleeping(sim, 'agent-0', home, tiles[0]![0], tiles[0]![1])
    putSleeping(sim, 'agent-1', home, tiles[1]![0], tiles[1]![1])

    wakeNow(sim, ['agent-0', 'agent-1'])
    expect(floorSleepFelts(sim, 'agent-1')).toHaveLength(1)
    expect(floorSleepFelts(sim, 'agent-1')[0]!.data?.felt).toBe(FLOOR_SLEEP_FELT)
    expect(floorSleepFelts(sim, 'agent-0')).toHaveLength(0)

    const bedEnd = sim
      .getEvents()
      .filter((e) => e.agentId === 'agent-0' && e.type === 'action:end' && e.data?.kind === 'sleep')
      .at(-1)
    expect(String(bedEnd?.data?.felt ?? '')).toMatch(/slept in your bed/)
    expect(bedEnd?.data?.felt).not.toBe(FLOOR_SLEEP_FELT)

    const floor = sim.state.agents.find((a) => a.id === 'agent-1')!
    putSleeping(sim, 'agent-0', home, tiles[0]![0], tiles[0]![1])
    putSleeping(sim, 'agent-1', home, tiles[1]![0], tiles[1]![1])
    wakeNow(sim, ['agent-0', 'agent-1'])
    expect(floorSleepFelts(sim, 'agent-1')).toHaveLength(1)

    const user = buildUserPrompt(floor, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain(`- ${FLOOR_SLEEP_FELT}`)
    expect(user).not.toMatch(/could be upgraded|needs more room|you should upgrade/i)
  })

  it('a bed-slot sleeper alone emits no floor-sleep line', () => {
    const sim = new Simulation(42)
    const home = sim.state.places.find((p) => p.kind === 'home')!
    home.slots = 1
    const tiles = slotTiles(sim.state, home)
    parkFar(sim, new Set(['agent-0']))
    putSleeping(sim, 'agent-0', home, tiles[0]![0], tiles[0]![1])
    wakeNow(sim, ['agent-0'])
    expect(floorSleepFelts(sim, 'agent-0')).toHaveLength(0)
    const end = sim
      .getEvents()
      .filter((e) => e.agentId === 'agent-0' && e.type === 'action:end' && e.data?.kind === 'sleep')
      .at(-1)
    expect(String(end?.data?.felt ?? '')).toMatch(/slept in your bed/)
  })

  it('rough sleep outside any home keeps the ground felt line', () => {
    const sim = new Simulation(42)
    parkFar(sim, new Set(['agent-0']))
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.x = 2
    agent.y = 2
    agent.homeId = ''
    agent.lastDecideTick = sim.state.tick
    agent.needs.energy = 0.4
    agent.actionStartNeeds = { ...agent.needs, energy: 0.4 }
    agent.action = {
      kind: 'sleep',
      targetX: 2,
      targetY: 2,
      path: [],
      reason: 'sleeping rough',
    }
    agent.pathIndex = 0
    const onHome = sim.state.places.some(
      (p) => p.kind === 'home' && Math.max(Math.abs(p.x - 2), Math.abs(p.y - 2)) <= 1,
    )
    expect(onHome).toBe(false)
    wakeNow(sim, ['agent-0'])
    expect(floorSleepFelts(sim, 'agent-0')).toHaveLength(0)
    const end = sim
      .getEvents()
      .filter((e) => e.agentId === 'agent-0' && e.type === 'action:end' && e.data?.kind === 'sleep')
      .at(-1)
    expect(String(end?.data?.felt ?? '')).toMatch(/slept on the ground/)
    expect(end?.data?.felt).not.toBe(FLOOR_SLEEP_FELT)
  })

  it('a later night can emit again after the 21:00 night boundary', () => {
    const sim = new Simulation(42)
    const home = sim.state.places.find((p) => p.kind === 'home')!
    home.slots = 1
    const tiles = slotTiles(sim.state, home)
    parkFar(sim, new Set(['agent-0', 'agent-1']))
    putSleeping(sim, 'agent-0', home, tiles[0]![0], tiles[0]![1])
    putSleeping(sim, 'agent-1', home, tiles[1]![0], tiles[1]![1])
    wakeNow(sim, ['agent-0', 'agent-1'])
    expect(floorSleepFelts(sim, 'agent-1')).toHaveLength(1)

    const untilEvening = 900 - sim.state.tick
    expect(untilEvening).toBeGreaterThan(0)
    for (const a of sim.state.agents) {
      a.lastDecideTick = 1e9
      a.action = { kind: 'idle', reason: 'parked' }
      a.pathIndex = 0
    }
    sim.advanceTicks(untilEvening)
    expect(toSimTime(sim.state.tick).hour).toBe(21)

    parkFar(sim, new Set(['agent-0', 'agent-1']))
    putSleeping(sim, 'agent-0', home, tiles[0]![0], tiles[0]![1])
    putSleeping(sim, 'agent-1', home, tiles[1]![0], tiles[1]![1])
    wakeNow(sim, ['agent-0', 'agent-1'])
    expect(floorSleepFelts(sim, 'agent-1')).toHaveLength(2)
  })

  it('blocked-count map increments only on emitted place:blocked and matches the log', () => {
    const sim = new Simulation(42)
    const well = sim.state.places.find((p) => p.kind === 'well')!
    well.slots = 1
    parkFar(sim, new Set(['agent-0', 'agent-11']))
    occupyWell(sim, 'agent-11')
    tryDrinkWell(sim, 'agent-0')
    const afterFirst = sim.getEvents().filter((e) => e.type === 'place:blocked')
    expect(afterFirst).toHaveLength(1)
    expect(sim.state.placeBlockedToday?.[well.id]).toBe(1)

    occupyWell(sim, 'agent-11')
    tryDrinkWell(sim, 'agent-0')
    const afterRepeat = sim.getEvents().filter((e) => e.type === 'place:blocked')
    expect(sim.state.placeBlockedToday?.[well.id]).toBe(afterRepeat.length)

    parkFar(sim, new Set(['agent-0', 'agent-1']))
    occupyWell(sim, 'agent-1')
    tryDrinkWell(sim, 'agent-0')
    parkFar(sim, new Set(['agent-0', 'agent-2']))
    occupyWell(sim, 'agent-2')
    tryDrinkWell(sim, 'agent-0')
    const blocked = sim.getEvents().filter((e) => e.type === 'place:blocked')
    expect(blocked.length).toBeGreaterThanOrEqual(3)
    expect(sim.state.placeBlockedToday?.[well.id]).toBe(blocked.length)
    expect(sim.state.placeBlockedToday).toEqual(blockedTodayFromEvents(sim))
    for (const e of blocked) expect(e.data?.placeId).toBe(well.id)
  })

  it('busy appears at the threshold and not below; examine N is derived', () => {
    const sim = new Simulation(42)
    const well = sim.state.places.find((p) => p.kind === 'well')!
    well.slots = 1
    well.inventory.food = 8
    parkFar(sim, new Set(['agent-0', 'agent-1', 'agent-2', 'agent-11']))
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!

    occupyWell(sim, 'agent-11')
    tryDrinkWell(sim, 'agent-0')
    occupyWell(sim, 'agent-1')
    tryDrinkWell(sim, 'agent-0')
    mira.x = well.x + 1
    mira.y = well.y
    let row = nearbyPlacesForObservation(mira, sim.state, sim.getEvents()).find(
      (r) => r.place.id === well.id,
    )!
    expect(row.busy).toBe(false)
    expect(formatNearbyPlaceLine(row)).toMatch(/well \(8 food\)/)
    expect(formatNearbyPlaceLine(row)).not.toMatch(/\bbusy\b/)
    expect(
      examineKnowledgeFor(well, { placeBlockedToday: sim.state.placeBlockedToday }),
    ).not.toMatch(/crowded today/)

    occupyWell(sim, 'agent-2')
    tryDrinkWell(sim, 'agent-0')
    mira.x = well.x + 1
    mira.y = well.y
    row = nearbyPlacesForObservation(mira, sim.state, sim.getEvents()).find(
      (r) => r.place.id === well.id,
    )!
    expect(row.busy).toBe(true)
    expect(formatNearbyPlaceLine(row)).toMatch(/well \(8 food, busy\)/)
    const n = sim.state.placeBlockedToday![well.id]!
    expect(n).toBe(3)
    expect(examineKnowledgeFor(well, { placeBlockedToday: sim.state.placeBlockedToday })).toContain(
      `It was crowded today — turned people away ${n} times.`,
    )

    const user = buildUserPrompt(mira, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain('well (8 food, busy)')
    expect(user).not.toMatch(/could be upgraded|needs more room/i)
  })

  it('blocked-count map resets at day start; busy disappears until the threshold again', () => {
    const sim = new Simulation(42)
    const well = sim.state.places.find((p) => p.kind === 'well')!
    well.slots = 1
    parkFar(sim, new Set(['agent-0', 'agent-1', 'agent-2', 'agent-11']))
    occupyWell(sim, 'agent-11')
    tryDrinkWell(sim, 'agent-0')
    occupyWell(sim, 'agent-1')
    tryDrinkWell(sim, 'agent-0')
    occupyWell(sim, 'agent-2')
    tryDrinkWell(sim, 'agent-0')
    expect(sim.state.placeBlockedToday?.[well.id]).toBe(3)

    const untilDay2 = dayStartTick(2) - sim.state.tick
    sim.advanceTicks(untilDay2)
    expect(toSimTime(sim.state.tick).day).toBe(2)
    expect(sim.state.placeBlockedToday).toEqual({})
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.x = well.x + 1
    mira.y = well.y
    const row = nearbyPlacesForObservation(mira, sim.state, sim.getEvents()).find(
      (r) => r.place.id === well.id,
    )
    if (row) expect(formatNearbyPlaceLine(row)).not.toMatch(/\bbusy\b/)
  })

  it('save round-trip and stateAt re-sim preserve the daily blocked map', () => {
    const sim = new Simulation(42)
    const well = sim.state.places.find((p) => p.kind === 'well')!
    well.slots = 1
    parkFar(sim, new Set(['agent-0', 'agent-1', 'agent-2', 'agent-11']))
    occupyWell(sim, 'agent-11')
    tryDrinkWell(sim, 'agent-0')
    occupyWell(sim, 'agent-1')
    tryDrinkWell(sim, 'agent-0')
    occupyWell(sim, 'agent-2')
    tryDrinkWell(sim, 'agent-0')
    const toSnap = SNAPSHOT_INTERVAL - (sim.state.tick % SNAPSHOT_INTERVAL)
    sim.advanceTicks(toSnap === 0 ? SNAPSHOT_INTERVAL : toSnap)
    const tickA = sim.state.tick
    const hashA = sim.hash()
    const mapA = { ...sim.state.placeBlockedToday }

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(5)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(hashA)
    expect(restored.state.placeBlockedToday).toEqual(mapA)

    const fork = sim.stateAt(tickA)
    expect(fork.hash()).toBe(hashA)
    expect(fork.state.placeBlockedToday).toEqual(mapA)
    expect(restored.stateAt(tickA).hash()).toBe(hashA)
  })

  it('determinism double-run is exact', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(800)
    b.advanceTicks(800)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    expect(a.state.placeBlockedToday).toEqual(b.state.placeBlockedToday)
  })

  it('WORLD_RULES is unchanged: upgrade affordance already present, no crowding advice', () => {
    const sys = buildSystemPrompt('agent-0')
    expect(sys).toMatch(/Commissioning a kind you already own upgrades it/)
    expect(sys).not.toMatch(/could be upgraded/)
    expect(sys).not.toMatch(/needs more room/)
    expect(sys).not.toMatch(/you should upgrade/i)
  })

  it('feltConsequenceLines surfaces the floor-sleep line from data.felt', () => {
    const lines = feltConsequenceLines(
      'agent-0',
      [
        {
          seq: 1,
          tick: 100,
          type: 'action:end',
          agentId: 'agent-0',
          data: { kind: 'sleep', felt: FLOOR_SLEEP_FELT, floorSleep: true },
        },
      ],
      200,
      5,
    )
    expect(lines).toEqual([FLOOR_SLEEP_FELT])
  })

  it('recorded soak worlds still import', () => {
    for (const file of [
      'artifacts/soak-1787430602479-world.json',
      'artifacts/soak-1787452399090-world.json',
    ]) {
      const local = resolve(file)
      const fallback = resolve(
        'D:/MyProjects/Claude/luna-island',
        file,
      )
      let rawText: string
      try {
        rawText = readFileSync(local, 'utf8')
      } catch {
        rawText = readFileSync(fallback, 'utf8')
      }
      const raw = JSON.parse(rawText) as {
        tick: number
        seed: number
      }
      const loaded = restoreSave(raw)
      expect(loaded.state.tick).toBe(raw.tick)
      expect(loaded.state.seed).toBe(raw.seed)
      expect(loaded.state.agents.length).toBeGreaterThan(0)
      expect(loaded.state.placeBlockedToday ?? {}).toEqual({})
    }
  }, 120_000)
})

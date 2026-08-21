import { describe, expect, it } from 'vitest'
import {
  BUSH_STOCK_MAX,
  CLAIM_COST,
  Simulation,
  SPRING_STOCK_MAX,
  springRegrowInterval,
} from '../src/sim/sim'
import { occupantsOfPlace, reserveSpot, slotTiles } from '../src/sim/spots'
import { blockedFeltLine, examineKnowledgeFor, EXAMINE_BY_KIND } from '../src/sim/examine'
import { createRng } from '../src/sim/rng'
import {
  feltLineFromEvent,
  formatNearbyPlaceLine,
  nearbyPlacesForObservation,
} from '../src/mind/knowledge'
import { buildUserPrompt } from '../src/mind/prompt'
import { SAVE_FORMAT_VERSION } from '../src/sim/persist'
import type { ExternalIntentMeta, SimEvent } from '../src/sim/types'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function totalCoins(sim: Simulation): number {
  let sum = sim.state.treasury
  for (const a of sim.state.agents) sum += a.wallet
  return sum
}

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

function occupySpring(sim: Simulation, occupantId: string): void {
  const spring = sim.state.places.find((p) => p.kind === 'spring')
  if (!spring) throw new Error('no spring')
  const occupant = sim.state.agents.find((a) => a.id === occupantId)
  if (!occupant) throw new Error(`missing ${occupantId}`)
  occupant.x = spring.x
  occupant.y = spring.y
  occupant.action = {
    kind: 'forage',
    targetPlaceId: spring.id,
    targetX: spring.x,
    targetY: spring.y,
    path: [],
    reason: 'picking spring fruit',
  }
  occupant.pathIndex = 0
  occupant.actionTicks = 1
  occupant.lastDecideTick = sim.state.tick
}

function tryForageSpring(sim: Simulation, agentId: string): void {
  const spring = sim.state.places.find((p) => p.kind === 'spring')
  if (!spring) throw new Error('no spring')
  const agent = sim.state.agents.find((a) => a.id === agentId)
  if (!agent) throw new Error(`missing ${agentId}`)
  agent.lastDecideTick = sim.state.tick - 40
  sim.postExternalIntent(
    agentId,
    {
      kind: 'forage',
      targetPlaceId: spring.id,
      targetX: spring.x,
      targetY: spring.y,
      reason: 'I want the spring fruit',
    },
    meta('I want the spring fruit'),
  )
  sim.advanceTicks(1)
}

describe('P4-7 contested commons', () => {
  it('save format version is unchanged', () => {
    expect(SAVE_FORMAT_VERSION).toBe(5)
  })

  it('wild spring has exactly one slot tile; default/lean have none', () => {
    const wild = new Simulation(42, { preset: 'wild' })
    const springs = wild.state.places.filter((p) => p.kind === 'spring')
    expect(springs).toHaveLength(1)
    const spring = springs[0]!
    expect(spring.slots).toBe(1)
    expect(spring.inventory.food).toBe(SPRING_STOCK_MAX)
    expect(SPRING_STOCK_MAX).toBeGreaterThan(BUSH_STOCK_MAX)
    expect(slotTiles(wild.state, spring)).toHaveLength(1)
    expect(slotTiles(wild.state, spring)[0]).toEqual([spring.x, spring.y])
    expect(wild.state.owners[spring.id]).toBe('commons')

    const plaza = wild.state.places.find((p) => p.kind === 'plaza')!
    const dist = Math.hypot(spring.x - plaza.x, spring.y - plaza.y)
    expect(dist).toBeGreaterThanOrEqual(4)
    expect(dist).toBeLessThanOrEqual(8)

    const def = new Simulation(42)
    const lean = new Simulation(42, { preset: 'lean' })
    expect(def.state.places.some((p) => p.kind === 'spring')).toBe(false)
    expect(lean.state.places.some((p) => p.kind === 'spring')).toBe(false)
  })

  it('second agent cannot reserve the spring while occupied', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    parkFar(sim, new Set(['agent-0', 'agent-11']))
    occupySpring(sim, 'agent-11')
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.x = spring.x + 2
    mira.y = spring.y
    const rng = createRng(1)
    expect(reserveSpot(sim.state, spring, mira, rng)).toBeNull()
    const occ = occupantsOfPlace(sim.state, spring, mira.id)
    expect(occ.map((a) => a.id)).toContain('agent-11')
  })

  it('blocked emits place:blocked with occupant name and felt line', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    parkFar(sim, new Set(['agent-0', 'agent-11']))
    occupySpring(sim, 'agent-11')
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const wren = sim.state.agents.find((a) => a.id === 'agent-11')!
    expect(wren.name).toBe('Wren')
    mira.x = spring.x + 2
    mira.y = spring.y
    tryForageSpring(sim, 'agent-0')

    const blocked = sim.getEvents().filter((e) => e.type === 'place:blocked')
    expect(blocked).toHaveLength(1)
    const ev = blocked[0]!
    expect(ev.agentId).toBe('agent-0')
    expect(ev.data?.placeId).toBe(spring.id)
    expect(ev.data?.placeKind).toBe('spring')
    expect(ev.data?.occupantNames).toEqual(['Wren'])
    expect(ev.data?.occupantIds).toEqual(['agent-11'])
    expect(ev.reason && ev.reason.length > 0).toBe(true)
    expect(feltLineFromEvent(ev, 'agent-0')).toBe(
      'could not use the spring — Wren was in the only spot',
    )
    expect(mira.action.kind).not.toBe('forage')
    expect(mira.action.targetPlaceId).not.toBe(spring.id)
  })

  it('owner-exclusion felt line names the owner', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    parkFar(sim, new Set(['agent-0', 'agent-11']))
    occupySpring(sim, 'agent-11')
    sim.state.owners[spring.id] = 'agent-11'
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.x = spring.x + 2
    mira.y = spring.y
    tryForageSpring(sim, 'agent-0')

    const ev = sim.getEvents().find((e) => e.type === 'place:blocked')!
    expect(ev.data?.ownerId).toBe('agent-11')
    expect(ev.data?.ownerName).toBe('Wren')
    expect(feltLineFromEvent(ev, 'agent-0')).toBe(
      "could not use the spring — it is Wren's now",
    )
    expect(blockedFeltLine({
      label: 'spring',
      occupantNames: ['Wren'],
      ownerName: 'Wren',
      onlySpot: true,
    })).toBe("could not use the spring — it is Wren's now")
  })

  it('repeat-block collapse: identical occupant+place does not re-emit until the key changes', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    parkFar(sim, new Set(['agent-0', 'agent-11', 'agent-20']))
    occupySpring(sim, 'agent-11')
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.x = spring.x + 2
    mira.y = spring.y

    tryForageSpring(sim, 'agent-0')
    occupySpring(sim, 'agent-11')
    tryForageSpring(sim, 'agent-0')
    expect(sim.getEvents().filter((e) => e.type === 'place:blocked')).toHaveLength(1)

    const wren = sim.state.agents.find((a) => a.id === 'agent-11')!
    wren.x = 4
    wren.y = 4
    wren.action = { kind: 'idle', reason: 'left the spring' }
    wren.pathIndex = 0
    wren.lastDecideTick = sim.state.tick
    occupySpring(sim, 'agent-20')
    tryForageSpring(sim, 'agent-0')
    const blocked = sim.getEvents().filter((e) => e.type === 'place:blocked')
    expect(blocked).toHaveLength(2)
    expect(blocked[1]!.data?.occupantIds).toEqual(['agent-20'])
  })

  it('spring regrowth respects cap and a quarter of the bush interval', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    parkFar(sim, new Set())
    const interval = springRegrowInterval('wild')
    expect(interval).toBe(25)
    spring.inventory.food = 0
    sim.advanceTicks(interval)
    expect(spring.inventory.food).toBe(1)
    const grew = sim
      .getEvents()
      .filter((e) => e.type === 'goods:regrow' && e.data?.placeKind === 'spring')
    expect(grew.length).toBeGreaterThanOrEqual(1)
    spring.inventory.food = SPRING_STOCK_MAX
    const before = sim.getEvents().filter((e) => e.type === 'goods:regrow').length
    sim.advanceTicks(interval)
    const after = sim.getEvents().filter((e) => e.type === 'goods:regrow').length
    expect(spring.inventory.food).toBe(SPRING_STOCK_MAX)
    expect(after).toBe(before)
  })

  it('claim on the spring transfers ownership with coin conservation', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    expect(sim.state.owners[spring.id]).toBe('commons')
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = CLAIM_COST
    const coins0 = totalCoins(sim)
    expect(sim.claim('agent-0', spring.id)).toBe(true)
    expect(sim.state.owners[spring.id]).toBe('agent-0')
    expect(totalCoins(sim)).toBe(coins0)
    const claimed = sim.getEvents().find((e) => e.type === 'institution:claimed')
    expect(claimed?.data?.placeKind).toBe('spring')
  })

  it('examine names the owner; nearby observation line does too', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const spring = sim.state.places.find((p) => p.kind === 'spring')!
    const wren = sim.state.agents.find((a) => a.id === 'agent-11')!
    sim.state.owners[spring.id] = wren.id
    const text = examineKnowledgeFor(spring, {
      owners: sim.state.owners,
      agents: sim.state.agents,
    })
    expect(EXAMINE_BY_KIND.spring).toMatch(/one person fits/i)
    expect(EXAMINE_BY_KIND.spring).not.toMatch(/propose|vote|sanction|rule/i)
    expect(text).toContain(EXAMINE_BY_KIND.spring)
    expect(text).toContain('Wren')

    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.x = spring.x
    mira.y = spring.y
    const rows = nearbyPlacesForObservation(mira, sim.state, [])
    const springRow = rows.find((r) => r.place.id === spring.id)
    expect(springRow?.ownerName).toBe('Wren')
    expect(formatNearbyPlaceLine(springRow!)).toContain("Wren's")
    expect(formatNearbyPlaceLine(springRow!)).toMatch(/spring \(8 food, Wren's\)/)

    const prompt = buildUserPrompt(mira, sim.state, [])
    expect(prompt).toMatch(/spring \(8 food, Wren's\)/)
  })

  it('feltLineFromEvent reconstructs occupancy and owner-exclusion lines', () => {
    const occ: SimEvent = {
      seq: 1,
      tick: 10,
      type: 'place:blocked',
      agentId: 'agent-0',
      data: {
        placeKind: 'spring',
        occupantNames: ['Wren'],
        occupantIds: ['agent-11'],
        onlySpot: true,
        ownerId: 'commons',
      },
    }
    expect(feltLineFromEvent(occ, 'agent-0')).toBe(
      'could not use the spring — Wren was in the only spot',
    )
    const owned: SimEvent = {
      seq: 2,
      tick: 11,
      type: 'place:blocked',
      agentId: 'agent-0',
      data: {
        placeKind: 'spring',
        occupantNames: ['Wren'],
        occupantIds: ['agent-11'],
        ownerId: 'agent-11',
        ownerName: 'Wren',
        onlySpot: true,
      },
    }
    expect(feltLineFromEvent(owned, 'agent-0')).toBe(
      "could not use the spring — it is Wren's now",
    )
  })

  it('place:blocked volume on default 2000 ticks is bounded', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(2000)
    const events = sim.getEvents()
    const blocked = events.filter((e) => e.type === 'place:blocked')
    expect(blocked.length).toBeLessThan(events.length)
    expect(sim.stateAt(900).state.tick).toBe(900)
  })

  it('wild seed 42 hash is stable across two fresh runs (new world)', () => {
    const a = new Simulation(42, { preset: 'wild' })
    const b = new Simulation(42, { preset: 'wild' })
    const h0 = a.hash()
    expect(h0).toBe('94527801')
    expect(b.hash()).toBe(h0)
    a.advanceTicks(200)
    b.advanceTicks(200)
    expect(a.hash()).toBe(b.hash())
    const defA = new Simulation(42)
    const defB = new Simulation(42)
    expect(defA.hash()).toBe(defB.hash())
    const leanA = new Simulation(42, { preset: 'lean' })
    const leanB = new Simulation(42, { preset: 'lean' })
    expect(leanA.hash()).toBe(leanB.hash())
    console.log('P4_7_WILD_HASH_T0', h0)
    console.log('P4_7_WILD_HASH_T200', a.hash())
    console.log('P4_7_DEFAULT_HASH_T0', defA.hash())
    console.log('P4_7_LEAN_HASH_T0', leanA.hash())
  })
})

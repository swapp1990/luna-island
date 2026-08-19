import { describe, expect, it } from 'vitest'
import {
  BUILD_RECIPES,
  COMMISSION_COOLDOWN_TICKS,
  DRINK_SHORE_ENERGY,
  DRINK_WELL_ENERGY,
  GATHER_STOCK_MAX,
  GATHER_TICKS_PER_UNIT,
  MAX_ACTIVE_SITES,
  Simulation,
  isBuildableKind,
} from '../src/sim/sim'
import { adjacentToWater, isSlotTile, workplaceHasOpenJob } from '../src/sim/spots'
import { SLEEP_BED_ENERGY, SLEEP_GROUND_ENERGY } from '../src/sim/examine'
import { presetFacts } from '../src/sim/worldgen'
import type { BuildableKind, ExternalIntentMeta, Place } from '../src/sim/types'
import { emptyInventory } from '../src/sim/types'
import { STRATEGIC_ACTION_KINDS } from '../src/sim/utilityBrain'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function parkOthers(sim: Simulation, keepId: string): void {
  for (const a of sim.state.agents) {
    if (a.id === keepId) continue
    a.x = 2
    a.y = 2
    a.lastDecideTick = sim.state.tick
    a.action = { kind: 'idle', reason: 'parked' }
    a.actionTicks = 0
  }
}

function findForest(sim: Simulation): { x: number; y: number } {
  for (const t of sim.state.tiles) {
    if (t.kind === 'forest' && t.walkable) return { x: t.x, y: t.y }
  }
  throw new Error('no forest tile')
}

function findRockStand(sim: Simulation): {
  rock: { x: number; y: number }
  stand: { x: number; y: number }
} {
  for (const t of sim.state.tiles) {
    if (t.kind !== 'rock') continue
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    for (const [dx, dy] of dirs) {
      const n = sim.state.tiles[(t.y + dy) * sim.state.width + (t.x + dx)]
      if (n && n.walkable) {
        return { rock: { x: t.x, y: t.y }, stand: { x: n.x, y: n.y } }
      }
    }
  }
  throw new Error('no rock with walkable neighbor')
}

function findShore(sim: Simulation): { x: number; y: number } {
  for (const t of sim.state.tiles) {
    if (!t.walkable) continue
    if (adjacentToWater(sim.state, t.x, t.y)) return { x: t.x, y: t.y }
  }
  throw new Error('no shoreline tile')
}

function findOpenPlot(sim: Simulation): { x: number; y: number } {
  const w = sim.state.width
  const blocked = (hx: number, hy: number): boolean => {
    for (const p of sim.state.places) {
      if (
        p.kind === 'home' ||
        p.kind === 'construction-site' ||
        p.kind === 'farm' ||
        p.kind === 'stall' ||
        p.kind === 'storehouse' ||
        p.kind === 'plaza' ||
        p.kind === 'well'
      ) {
        if (Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy)) < 2) return true
      }
    }
    return false
  }
  for (let y = 2; y < sim.state.height - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const t = sim.state.tiles[y * w + x]!
      if (!t.walkable || t.kind === 'water' || t.kind === 'rock') continue
      if (blocked(x, y)) continue
      return { x, y }
    }
  }
  throw new Error('no open plot')
}

function forceComplete(sim: Simulation, site: Place, workerId: string): void {
  const worker = sim.state.agents.find((a) => a.id === workerId)!
  const c = site.construction
  if (!c) throw new Error('no construction spec')
  c.needs = {}
  c.progress = 0.999
  worker.collapsed = false
  worker.employedAt = null
  worker.workPhase = null
  worker.x = site.x
  worker.y = site.y
  worker.action = { kind: 'idle', reason: 'ready' }
  worker.lastDecideTick = sim.state.tick
  sim.postExternalIntent(
    workerId,
    {
      kind: 'work',
      targetPlaceId: site.id,
      targetX: site.x,
      targetY: site.y,
      reason: 'finish the build',
    },
    meta('finish the build'),
  )
  for (let i = 0; i < 10; i++) {
    sim.advanceTicks(1)
    if (site.kind !== 'construction-site') return
  }
  throw new Error(`site ${site.id} did not complete`)
}

describe('founding — recipes', () => {
  it('notice-board is cheapest; well is stone-heavy; home matches the old bill', () => {
    expect(isBuildableKind('home')).toBe(true)
    expect(isBuildableKind('plaza')).toBe(false)
    const kinds = Object.keys(BUILD_RECIPES) as BuildableKind[]
    expect(kinds).toEqual(
      expect.arrayContaining([
        'home',
        'farm',
        'well',
        'stall',
        'storehouse',
        'forestry',
        'quarry',
        'notice-board',
      ]),
    )
    const cost = (k: BuildableKind) => {
      const r = BUILD_RECIPES[k]
      return r.wood + r.stone + r.labourTicks / 100
    }
    for (const k of kinds) {
      if (k === 'notice-board') continue
      expect(cost(k), `${k} should cost more than notice-board`).toBeGreaterThan(
        cost('notice-board'),
      )
    }
    expect(BUILD_RECIPES['notice-board']).toEqual({ wood: 2, stone: 0, labourTicks: 60 })
    expect(BUILD_RECIPES.home).toEqual({ wood: 12, stone: 6, labourTicks: 900 })
    expect(BUILD_RECIPES.well.stone).toBeGreaterThan(BUILD_RECIPES.well.wood)
    expect(BUILD_RECIPES.well.stone).toBeGreaterThanOrEqual(12)
  })
})

describe('founding — commission refusals and caps', () => {
  it('unknown kind, unaffordable home, and tile-not-buildable are traced no-ops', () => {
    const unknownSim = new Simulation(42)
    expect(unknownSim.commission('agent-0', 'plaza')).toBe(false)
    expect(
      unknownSim.getEvents().some((e) => e.data?.why === 'unknown-kind'),
    ).toBe(true)
    expect(
      unknownSim.state.places.filter((p) => p.kind === 'construction-site'),
    ).toHaveLength(0)

    const broke = new Simulation(42)
    broke.state.agents.find((a) => a.id === 'agent-0')!.wallet = 0
    expect(broke.commission('agent-0', 'home')).toBe(false)
    expect(broke.getEvents().some((e) => e.data?.why === 'cannot-afford')).toBe(
      true,
    )

    const badTile = new Simulation(42)
    badTile.state.agents.find((a) => a.id === 'agent-0')!.wallet = 50
    expect(badTile.commission('agent-0', 'farm', 0, 0)).toBe(false)
    expect(
      badTile.getEvents().some((e) => e.data?.why === 'tile-not-buildable'),
    ).toBe(true)
  })

  it('notice-board is affordable with an empty wallet', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 0
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'notice-board', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.targetKind).toBe('notice-board')
    expect(site.construction?.needs).toEqual({ wood: 2 })
  })

  it('one active site per commissioner and island cap of 3', () => {
    const sim = new Simulation(42)
    const p0 = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'notice-board', p0.x, p0.y)).toBe(true)
    const p0b = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'stall', p0b.x, p0b.y)).toBe(false)
    expect(
      sim.getEvents().some((e) => e.data?.why === 'already-commissioning'),
    ).toBe(true)

    const p1 = findOpenPlot(sim)
    expect(sim.commission('agent-1', 'farm', p1.x, p1.y)).toBe(true)
    const p2 = findOpenPlot(sim)
    expect(sim.commission('agent-2', 'well', p2.x, p2.y)).toBe(true)
    expect(
      sim.state.places.filter((p) => p.kind === 'construction-site'),
    ).toHaveLength(MAX_ACTIVE_SITES)

    const p3 = findOpenPlot(sim)
    expect(sim.commission('agent-3', 'forestry', p3.x, p3.y)).toBe(false)
    expect(sim.getEvents().some((e) => e.data?.why === 'site-cap')).toBe(true)
  })

  it('failed commission then silent rejects for a day, then allowed again', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 0
    const starts = () =>
      sim
        .getEvents()
        .filter(
          (e) =>
            e.type === 'action:start' &&
            e.agentId === 'agent-0' &&
            e.data?.kind === 'commission',
        )
    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'I will build a house.' },
      meta('I will build a house.'),
    )
    sim.advanceTicks(1)
    expect(starts()).toHaveLength(1)
    expect(starts()[0]!.data?.ok).toBe(false)

    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'Trying again.' },
      meta('Trying again.'),
    )
    sim.advanceTicks(1)
    expect(starts()).toHaveLength(1)

    sim.advanceTicks(COMMISSION_COOLDOWN_TICKS)
    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'A day later.' },
      meta('A day later.'),
    )
    sim.advanceTicks(1)
    expect(starts().length).toBeGreaterThanOrEqual(2)
  })
})

describe('founding — completed kinds are working places', () => {
  const kinds: BuildableKind[] = [
    'home',
    'farm',
    'well',
    'stall',
    'storehouse',
    'forestry',
    'quarry',
    'notice-board',
  ]

  it.each(kinds)('completes %s into a working place of that kind', (kind) => {
    const sim = new Simulation(42)
    const commissioner = sim.state.agents.find((a) => a.id === 'agent-0')!
    commissioner.wallet = 50
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', kind, plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.targetKind).toBe(kind)
    forceComplete(sim, site, 'agent-3')
    expect(site.kind).toBe(kind)

    if (kind === 'home') {
      expect(site.slots).toBe(1)
      expect(site.jobSlots ?? 0).toBe(0)
      expect(sim.state.owners[site.id]).toBe('agent-0')
      expect(commissioner.homeId).toBe(site.id)
    } else {
      expect(sim.state.owners[site.id]).toBe('commons')
    }

    if (kind === 'farm') {
      expect(site.slots).toBe(2)
      expect(site.jobSlots).toBe(2)
      expect(site.wage).toBe(6)
      expect(site.production).toEqual({
        good: 'food',
        cycleWorkedTicks: 1440,
        yield: presetFacts(sim.state.preset).farmYield,
      })
      for (const a of sim.state.agents) {
        if (a.employedAt === site.id) a.employedAt = null
      }
      expect(workplaceHasOpenJob(sim.state, site)).toBe(true)
      parkOthers(sim, 'agent-5')
      const worker = sim.state.agents.find((a) => a.id === 'agent-5')!
      worker.employedAt = null
      worker.collapsed = false
      worker.x = site.x
      worker.y = site.y
      sim.postExternalIntent(
        'agent-5',
        {
          kind: 'work',
          targetPlaceId: site.id,
          targetX: site.x,
          targetY: site.y,
          reason: 'tend',
        },
        meta('tend'),
      )
      sim.advanceTicks(2)
      expect(worker.employedAt).toBe(site.id)
      expect(site.growth ?? 0).toBeGreaterThan(0)
    }

    if (kind === 'forestry') {
      expect(site.jobSlots).toBe(2)
      expect(site.production).toEqual({
        good: 'wood',
        cycleWorkedTicks: 960,
        yield: 6,
      })
    }
    if (kind === 'quarry') {
      expect(site.jobSlots).toBe(2)
      expect(site.production).toEqual({
        good: 'stone',
        cycleWorkedTicks: 1200,
        yield: 6,
      })
    }
    if (kind === 'stall') {
      expect(site.slots).toBe(4)
      expect(site.jobSlots).toBe(1)
      expect(site.wage).toBe(5)
      expect(site.price?.food).toBe(11)
      for (const a of sim.state.agents) {
        if (a.employedAt === site.id) a.employedAt = null
      }
      expect(workplaceHasOpenJob(sim.state, site)).toBe(true)
    }
    if (kind === 'storehouse') {
      expect(site.slots).toBe(2)
      expect(site.inventory).toEqual(emptyInventory())
    }
    if (kind === 'well') {
      expect(site.slots).toBe(2)
      const drinker = sim.state.agents.find((a) => a.id === 'agent-6')!
      drinker.collapsed = false
      drinker.needs.energy = 0.4
      const slot = isSlotTile(sim.state, site, site.x, site.y)
        ? { x: site.x, y: site.y }
        : { x: site.x, y: site.y }
      drinker.x = slot.x
      drinker.y = slot.y
      const jitter = drinker.needJitter.energy
      sim.postExternalIntent(
        'agent-6',
        {
          kind: 'drink',
          targetPlaceId: site.id,
          targetX: site.x,
          targetY: site.y,
          reason: 'drink',
        },
        meta('drink'),
      )
      sim.advanceTicks(1)
      const start = drinker.needs.energy
      sim.advanceTicks(4)
      expect(drinker.needs.energy).toBeGreaterThan(start)
      void jitter
    }
    if (kind === 'notice-board') {
      expect(site.slots).toBe(2)
    }
  })
})

describe('founding — gather', () => {
  it('yields wood from forest and stone from rock', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    parkOthers(sim, agent.id)
    const forest = findForest(sim)
    agent.x = forest.x
    agent.y = forest.y
    agent.inventory.wood = 0
    agent.collapsed = false
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'gather',
        targetX: forest.x,
        targetY: forest.y,
        reason: 'chop',
      },
      meta('chop'),
    )
    sim.advanceTicks(GATHER_TICKS_PER_UNIT + 2)
    expect(agent.inventory.wood).toBeGreaterThanOrEqual(1)
    expect(
      sim.getEvents().some(
        (e) =>
          e.type === 'goods:produced' &&
          e.data?.source === 'gather' &&
          e.data?.good === 'wood',
      ),
    ).toBe(true)

    const { rock, stand } = findRockStand(sim)
    const mason = sim.state.agents.find((a) => a.id === 'agent-3')!
    parkOthers(sim, mason.id)
    mason.x = stand.x
    mason.y = stand.y
    mason.inventory.stone = 0
    mason.collapsed = false
    mason.lastDecideTick = sim.state.tick
    sim.postExternalIntent(
      'agent-3',
      {
        kind: 'gather',
        targetX: rock.x,
        targetY: rock.y,
        reason: 'cut stone',
      },
      meta('cut stone'),
    )
    sim.advanceTicks(GATHER_TICKS_PER_UNIT + 2)
    expect(mason.inventory.stone).toBeGreaterThanOrEqual(1)
    expect(
      sim.getEvents().some(
        (e) =>
          e.type === 'goods:produced' &&
          e.data?.source === 'gather' &&
          e.data?.good === 'stone',
      ),
    ).toBe(true)
  })

  it('respects occupancy: two gatherers do not share a standing tile', () => {
    const sim = new Simulation(42)
    const forest = findForest(sim)
    const a = sim.state.agents.find((x) => x.id === 'agent-0')!
    const b = sim.state.agents.find((x) => x.id === 'agent-3')!
    for (const ag of sim.state.agents) {
      if (ag.id === a.id || ag.id === b.id) continue
      ag.x = 2
      ag.y = 2
      ag.lastDecideTick = sim.state.tick
      ag.action = { kind: 'idle', reason: 'parked' }
    }
    a.x = forest.x
    a.y = forest.y
    b.x = forest.x
    b.y = forest.y
    a.collapsed = false
    b.collapsed = false
    sim.postExternalIntent(
      'agent-0',
      { kind: 'gather', targetX: forest.x, targetY: forest.y, reason: 'a' },
      meta('a'),
    )
    sim.postExternalIntent(
      'agent-3',
      { kind: 'gather', targetX: forest.x, targetY: forest.y, reason: 'b' },
      meta('b'),
    )
    sim.advanceTicks(2)
    expect(a.action.kind).toBe('gather')
    expect(b.action.kind).toBe('gather')
    const ax = Math.round(a.x)
    const ay = Math.round(a.y)
    const bx = Math.round(b.x)
    const by = Math.round(b.y)
    expect(ax === bx && ay === by).toBe(false)
  })

  it('depletes a tile and regrows on the bush interval', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    parkOthers(sim, agent.id)
    const forest = findForest(sim)
    const tile = sim.state.tiles[forest.y * sim.state.width + forest.x]!
    tile.gatherStock = 1
    agent.x = forest.x
    agent.y = forest.y
    agent.inventory.wood = 0
    agent.collapsed = false
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'gather',
        targetX: forest.x,
        targetY: forest.y,
        reason: 'last tree',
      },
      meta('last tree'),
    )
    sim.advanceTicks(GATHER_TICKS_PER_UNIT + 3)
    expect(tile.gatherStock).toBe(0)
    expect(agent.inventory.wood).toBe(1)
    expect(agent.action.kind).not.toBe('gather')

    const interval = presetFacts(sim.state.preset).bushRegrowInterval
    const until = interval - (sim.state.tick % interval)
    sim.advanceTicks(until === 0 ? interval : until)
    expect(tile.gatherStock).toBe(1)
    expect(
      sim.getEvents().some(
        (e) =>
          e.type === 'goods:regrow' &&
          e.data?.good === 'wood' &&
          e.data?.tileX === forest.x &&
          e.data?.tileY === forest.y,
      ),
    ).toBe(true)
    expect(GATHER_STOCK_MAX).toBe(6)
  })
})

describe('founding — shoreline drink and sleeping rough', () => {
  it('shore drink works and is weaker than a well', () => {
    const sim = new Simulation(42)
    const well = sim.state.places.find((p) => p.kind === 'well')!
    const a = sim.state.agents.find((x) => x.id === 'agent-0')!
    const b = sim.state.agents.find((x) => x.id === 'agent-3')!
    for (const ag of sim.state.agents) {
      if (ag.id === a.id || ag.id === b.id) continue
      ag.x = 2
      ag.y = 2
      ag.lastDecideTick = sim.state.tick
      ag.action = { kind: 'idle', reason: 'parked' }
    }
    a.collapsed = false
    b.collapsed = false
    a.needs.energy = 0.4
    b.needs.energy = 0.4
    a.x = well.x
    a.y = well.y
    const shore = findShore(sim)
    b.x = shore.x
    b.y = shore.y

    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'drink',
        targetPlaceId: well.id,
        targetX: well.x,
        targetY: well.y,
        reason: 'well',
      },
      meta('well'),
    )
    sim.postExternalIntent(
      'agent-3',
      { kind: 'drink', targetX: shore.x, targetY: shore.y, reason: 'shore' },
      meta('shore'),
    )
    sim.advanceTicks(1)
    const wellStart = a.needs.energy
    const shoreStart = b.needs.energy
    sim.advanceTicks(4)
    const wellGain = a.needs.energy - wellStart
    const shoreGain = b.needs.energy - shoreStart
    expect(wellGain).toBeGreaterThan(0)
    expect(shoreGain).toBeGreaterThan(0)
    expect(shoreGain).toBeLessThan(wellGain)
    expect(DRINK_SHORE_ENERGY).toBeLessThan(DRINK_WELL_ENERGY)
  })

  it('sleeping rough is 60% of bed restore', () => {
    expect(SLEEP_GROUND_ENERGY / SLEEP_BED_ENERGY).toBeCloseTo(0.6, 5)
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    parkOthers(sim, agent.id)
    agent.needs.energy = 0.2
    const jitter = agent.needJitter.energy
    sim.postExternalIntent(
      'agent-0',
      { kind: 'sleep', reason: 'rough' },
      meta('rough'),
    )
    sim.advanceTicks(1)
    expect(agent.action.kind).toBe('sleep')
    expect(agent.action.targetPlaceId).toBeUndefined()
    const start = agent.needs.energy
    sim.advanceTicks(40)
    const expected = clamp01(start + 40 * SLEEP_GROUND_ENERGY * jitter)
    expect(agent.needs.energy).toBeCloseTo(expected, 5)
    expect(agent.needs.energy).toBeLessThan(
      start + 40 * SLEEP_BED_ENERGY * jitter - 0.01,
    )
  })
})

describe('founding — mind boundary', () => {
  it('gather is not a strategic verb; commission still is', () => {
    expect(STRATEGIC_ACTION_KINDS.has('gather')).toBe(false)
    expect(STRATEGIC_ACTION_KINDS.has('deliver')).toBe(false)
    expect(STRATEGIC_ACTION_KINDS.has('commission')).toBe(true)
  })
})

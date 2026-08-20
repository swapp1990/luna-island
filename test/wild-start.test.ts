import { describe, expect, it } from 'vitest'
import { BUILD_RECIPES, GATHER_TICKS_PER_UNIT, Simulation } from '../src/sim/sim'
import { SAVE_FORMAT_VERSION, restoreSave, serializeSave } from '../src/sim/persist'
import { presetFacts, resolveWorldPreset } from '../src/sim/worldgen'
import { STRATEGIC_ACTION_KINDS } from '../src/sim/utilityBrain'
import { adjacentToWater } from '../src/sim/spots'
import type { BuildableKind, ExternalIntentMeta } from '../src/sim/types'

const BUILDABLE: BuildableKind[] = [
  'home',
  'farm',
  'well',
  'stall',
  'storehouse',
  'forestry',
  'quarry',
  'notice-board',
]

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function parkOthers(sim: Simulation, keepId: string): void {
  for (const a of sim.state.agents) {
    if (a.id === keepId) continue
    a.x = 2
    a.y = 2
    a.lastDecideTick = sim.state.tick
    a.action = { kind: 'idle', reason: 'parked' }
    a.employedAt = null
    a.workPhase = null
  }
}

function findForest(sim: Simulation): { x: number; y: number } {
  for (const t of sim.state.tiles) {
    if (t.kind === 'forest' && t.walkable) return { x: t.x, y: t.y }
  }
  throw new Error('no forest tile')
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

function placesByKind(sim: Simulation): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of sim.state.places) {
    out[p.kind] = (out[p.kind] ?? 0) + 1
  }
  return out
}

describe('wild preset', () => {
  it('resolves alongside default/lean', () => {
    expect(resolveWorldPreset('wild')).toBe('wild')
    expect(resolveWorldPreset('lean')).toBe('lean')
    expect(resolveWorldPreset('default')).toBe('default')
    expect(presetFacts('wild')).toEqual({
      bushes: 10,
      bushRegrowInterval: 100,
      farmYield: 14,
      spawnFood: 2,
    })
  })

  it('spawns plaza + bushes + one spring — zero of the 8 buildable kinds', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    expect(sim.state.preset).toBe('wild')
    expect(sim.state.agents).toHaveLength(24)
    const counts = placesByKind(sim)
    expect(counts.plaza).toBe(1)
    expect(counts['berry-bush']).toBe(10)
    expect(counts.spring).toBe(1)
    for (const k of BUILDABLE) {
      expect(counts[k] ?? 0, k).toBe(0)
    }
    expect(
      sim.state.places.every(
        (p) => p.kind === 'plaza' || p.kind === 'berry-bush' || p.kind === 'spring',
      ),
    ).toBe(true)
  })

  it('starting kit is identical across agents', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const kits = sim.state.agents.map((a) => ({
      food: a.inventory.food,
      wood: a.inventory.wood,
      stone: a.inventory.stone,
      wallet: a.wallet,
    }))
    expect(kits.length).toBe(24)
    for (const k of kits) {
      expect(k).toEqual({ food: 2, wood: 0, stone: 0, wallet: 20 })
    }
    expect(new Set(kits.map((k) => JSON.stringify(k))).size).toBe(1)
  })

  it('agents spawn on distinct walkable grass near the plaza', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const seen = new Set<string>()
    for (const a of sim.state.agents) {
      const x = Math.round(a.x)
      const y = Math.round(a.y)
      const key = `${x},${y}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
      const t = sim.state.tiles[y * sim.state.width + x]!
      expect(t.walkable).toBe(true)
      expect(t.kind).toBe('grass')
      expect(a.homeId).toBe('')
      const dist = Math.hypot(x - plaza.x, y - plaza.y)
      expect(dist).toBeLessThanOrEqual(12)
    }
  })

  it('same seed ⇒ same hash; default and wild differ', () => {
    const a = new Simulation(42, { preset: 'wild' })
    const b = new Simulation(42, { preset: 'wild' })
    expect(a.hash()).toBe(b.hash())
    a.advanceTicks(400)
    b.advanceTicks(400)
    expect(a.hash()).toBe(b.hash())
    const d = new Simulation(42)
    expect(d.hash()).not.toBe(new Simulation(42, { preset: 'wild' }).hash())
  })

  it('wild save/restore stays v5 and hash-identical', () => {
    const sim = new Simulation(7, { preset: 'wild' })
    sim.advanceTicks(80)
    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(SAVE_FORMAT_VERSION).toBe(5)
    const restored = restoreSave(save)
    expect(restored.state.preset).toBe('wild')
    expect(restored.hash()).toBe(sim.hash())
    expect(restored.state.agents).toHaveLength(24)
  })
})

describe('deposit-to-site', () => {
  it('fills a bill from gathered goods with no storehouse and completes', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    expect(sim.state.places.some((p) => p.kind === 'storehouse')).toBe(false)
    expect(STRATEGIC_ACTION_KINDS.has('deliver')).toBe(false)

    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    parkOthers(sim, agent.id)
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'notice-board', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.needs).toEqual({ wood: BUILD_RECIPES['notice-board'].wood })

    const forest = findForest(sim)
    agent.x = forest.x
    agent.y = forest.y
    agent.inventory.wood = 0
    agent.collapsed = false
    sim.postExternalIntent(
      'agent-0',
      { kind: 'gather', targetX: forest.x, targetY: forest.y, reason: 'chop' },
      meta('chop'),
    )
    for (let i = 0; i < GATHER_TICKS_PER_UNIT * 3 + 4; i++) {
      parkOthers(sim, agent.id)
      sim.advanceTicks(1)
    }
    expect(agent.inventory.wood).toBeGreaterThanOrEqual(2)

    agent.x = site.x
    agent.y = site.y
    agent.action = { kind: 'idle', reason: 'at site' }
    agent.lastDecideTick = sim.state.tick
    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'deliver',
        targetPlaceId: site.id,
        targetX: site.x,
        targetY: site.y,
        reason: 'drop wood',
      },
      meta('drop wood'),
    )
    sim.advanceTicks(4)
    expect(site.inventory.wood).toBeGreaterThanOrEqual(2)
    expect(agent.inventory.wood).toBeLessThan(2)
    expect(
      sim.getEvents().some(
        (e) =>
          e.type === 'goods:transfer' &&
          e.data?.good === 'wood' &&
          e.data?.toId === site.id &&
          e.data?.fromKind === 'agent',
      ),
    ).toBe(true)

    const worker = sim.state.agents.find((a) => a.id === 'agent-3')!
    parkOthers(sim, worker.id)
    worker.collapsed = false
    worker.employedAt = null
    worker.workPhase = null
    worker.needs.hunger = 0.9
    worker.needs.energy = 0.9
    worker.needs.social = 0.9
    worker.x = site.x
    worker.y = site.y
    worker.lastDecideTick = sim.state.tick
    sim.postExternalIntent(
      'agent-3',
      {
        kind: 'work',
        targetPlaceId: site.id,
        targetX: site.x,
        targetY: site.y,
        reason: 'raise the board',
      },
      meta('raise the board'),
    )
    const labour = BUILD_RECIPES['notice-board'].labourTicks
    for (let i = 0; i < labour + 30; i++) {
      if (site.kind !== 'construction-site') break
      parkOthers(sim, worker.id)
      worker.collapsed = false
      worker.lastDecideTick = sim.state.tick
      sim.advanceTicks(1)
    }
    expect(site.kind).toBe('notice-board')
    expect(site.construction).toBeUndefined()
    expect(sim.state.places.some((p) => p.kind === 'storehouse')).toBe(false)
  })

  it('shore drink still works in wild (no well)', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    expect(sim.state.places.some((p) => p.kind === 'well')).toBe(false)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    parkOthers(sim, agent.id)
    let shore: { x: number; y: number } | null = null
    for (const t of sim.state.tiles) {
      if (!t.walkable) continue
      if (adjacentToWater(sim.state, t.x, t.y)) {
        shore = { x: t.x, y: t.y }
        break
      }
    }
    expect(shore).not.toBeNull()
    agent.x = shore!.x
    agent.y = shore!.y
    agent.collapsed = false
    agent.needs.energy = 0.4
    sim.postExternalIntent(
      'agent-0',
      { kind: 'drink', targetX: shore!.x, targetY: shore!.y, reason: 'shore' },
      meta('shore'),
    )
    sim.advanceTicks(1)
    const start = agent.needs.energy
    sim.advanceTicks(4)
    expect(agent.needs.energy).toBeGreaterThan(start)
  })
})

function measureSurvival(preset: 'wild' | 'default', days = 10) {
  const sim = new Simulation(42, { preset })
  const perDay: Array<{
    day: number
    meanHunger: number
    meanEnergy: number
    collapsedNow: number
  }> = []
  let collapses = 0
  let recoveries = 0
  const startEvents = sim.getEventCount()
  for (let d = 1; d <= days; d++) {
    const before = sim.getEventCount()
    sim.advanceTicks(1440)
    for (const e of sim.getEvents().slice(before)) {
      if (e.type === 'agent:collapsed') collapses++
      else if (e.type === 'agent:recovered') recoveries++
    }
    let hunger = 0
    let energy = 0
    let collapsedNow = 0
    for (const a of sim.state.agents) {
      hunger += a.needs.hunger
      energy += a.needs.energy
      if (a.collapsed) collapsedNow++
    }
    const n = sim.state.agents.length
    perDay.push({
      day: d,
      meanHunger: hunger / n,
      meanEnergy: energy / n,
      collapsedNow,
    })
  }
  const deaths = sim
    .getEvents()
    .slice(startEvents)
    .filter((e) => e.type === 'agent:died' || e.type === 'agent:dead').length
  return {
    preset,
    agents: sim.state.agents.length,
    collapses,
    recoveries,
    deaths,
    perDay,
    placesByKind: placesByKind(sim),
  }
}

describe('wild survivability (10 sim-days, utility brain)', () => {
  it('wild and default: zero deaths; wild is not a mass-collapse', () => {
    const wild = measureSurvival('wild', 10)
    const def = measureSurvival('default', 10)
    console.log('SURVIVAL_WILD', JSON.stringify(wild))
    console.log('SURVIVAL_DEFAULT', JSON.stringify(def))
    expect(wild.agents).toBe(24)
    expect(def.agents).toBe(24)
    expect(wild.deaths).toBe(0)
    expect(def.deaths).toBe(0)
    expect(wild.collapses).toBeLessThanOrEqual(8)
    expect(wild.placesByKind.plaza).toBe(1)
    expect(wild.placesByKind['berry-bush']).toBe(10)
    expect(wild.placesByKind.spring).toBe(1)
  }, 180_000)
})

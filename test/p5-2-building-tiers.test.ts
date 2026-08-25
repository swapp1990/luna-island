// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { readFileSync } from 'node:fs'
import { NO_RECORDED_WORLDS, recordedWorldPaths } from './recordedWorlds'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILD_RECIPES,
  MAX_ACTIVE_SITES,
  MAX_PLACE_LEVEL,
  Simulation,
  SNAPSHOT_INTERVAL,
  placeLevel,
  upgradeRuleLine,
} from '../src/sim/sim'
import {
  restoreSave,
  serializeSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import { emptyInventory, type ExternalIntentMeta, type Place } from '../src/sim/types'
import { formatNearbyPlaceLine } from '../src/mind/knowledge'
import { buildSystemPrompt } from '../src/mind/prompt'
import { examineKnowledgeFor } from '../src/sim/examine'
import { UtilityBrain, makeObservation } from '../src/sim/utilityBrain'
import { createRng } from '../src/sim/rng'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function forceComplete(sim: Simulation, site: Place, workerId: string): void {
  const worker = sim.state.agents.find((a) => a.id === workerId)!
  const c = site.construction
  if (!c) throw new Error('no construction spec')
  const siteId = site.id
  c.needs = {}
  c.progress = 0.999
  for (const a of sim.state.agents) {
    if (a.id === workerId) continue
    a.x = 2
    a.y = 2
    a.lastDecideTick = sim.state.tick
    a.action = { kind: 'idle', reason: 'parked' }
  }
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
  for (let i = 0; i < 12; i++) {
    sim.advanceTicks(1)
    const live = sim.state.places.find((p) => p.id === siteId)
    if (!live || live.kind !== 'construction-site') return
  }
  throw new Error(`site ${siteId} did not complete`)
}

describe('P5-2 building tiers', () => {
  it('missing level reads as 1; MAX_PLACE_LEVEL is 3', () => {
    const sim = new Simulation(42)
    const home = sim.state.places.find((p) => p.kind === 'home')!
    expect(home.level).toBeUndefined()
    expect(placeLevel(home)).toBe(1)
    expect(placeLevel(undefined)).toBe(1)
    expect(MAX_PLACE_LEVEL).toBe(3)
  })

  it('upgrade commission on an owned kind creates a site with upgradeOf and a level-scaled bill', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    const recipe = BUILD_RECIPES.forestry
    expect(sim.commission(agent.id, 'forestry')).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.upgradeOf).toBe(forestry.id)
    expect(site.construction?.targetKind).toBe('forestry')
    expect(site.construction?.needs).toEqual({
      wood: recipe.wood,
      stone: recipe.stone,
    })
    const chebyshev = Math.max(
      Math.abs(site.x - forestry.x),
      Math.abs(site.y - forestry.y),
    )
    expect(chebyshev).toBeGreaterThanOrEqual(1)
    expect(chebyshev).toBeLessThanOrEqual(2)
  })

  it('L2→3 bill is 2× the recipe; completion increments level and preserves inventory/owner/jobs', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const worker = sim.state.agents.find((a) => a.id === 'agent-1')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    forestry.level = 2
    forestry.inventory.wood = 9
    forestry.inventory.food = 2
    worker.employedAt = forestry.id
    worker.workPhase = 'tend'
    const slotsBefore = forestry.slots
    const yieldBefore = forestry.production!.yield
    const recipe = BUILD_RECIPES.forestry

    expect(sim.commission(agent.id, 'forestry')).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.upgradeOf).toBe(forestry.id)
    expect(site.construction?.needs).toEqual({
      wood: recipe.wood * 2,
      stone: recipe.stone * 2,
    })

    forceComplete(sim, site, 'agent-2')
    expect(sim.state.places.find((p) => p.id === site.id)).toBeUndefined()
    expect(placeLevel(forestry)).toBe(3)
    expect(forestry.inventory.wood).toBe(9)
    expect(forestry.inventory.food).toBe(2)
    expect(sim.state.owners[forestry.id]).toBe(agent.id)
    expect(worker.employedAt).toBe(forestry.id)
    expect(forestry.slots).toBe(slotsBefore + 1)
    expect(forestry.production!.yield).toBe(yieldBefore + 1)

    const done = sim
      .getEvents()
      .filter((e) => e.type === 'construction:completed')
      .at(-1)
    expect(done?.data?.upgradeOf).toBe(forestry.id)
    expect(done?.data?.level).toBe(3)
    expect(done?.reason).toMatch(/forestry was raised to level 3/)
  })

  it('level 1→2 adds one slot and +1 production yield', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    const slotsBefore = forestry.slots
    const yieldBefore = forestry.production!.yield
    expect(sim.commission(agent.id, 'forestry')).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    forceComplete(sim, site, 'agent-2')
    expect(placeLevel(forestry)).toBe(2)
    expect(forestry.slots).toBe(slotsBefore + 1)
    expect(forestry.production!.yield).toBe(yieldBefore + 1)
  })

  it('max-level refuses honestly and is a no-op', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    forestry.level = 3
    const sitesBefore = sim.state.places.filter((p) => p.kind === 'construction-site').length
    expect(sim.commission(agent.id, 'forestry')).toBe(false)
    expect(
      sim.state.places.filter((p) => p.kind === 'construction-site'),
    ).toHaveLength(sitesBefore)
    const ev = sim
      .getEvents()
      .filter((e) => e.type === 'construction:commission-refused')
      .at(-1)
    expect(ev?.data?.why).toBe('max-level')
    expect(String(ev?.data?.felt)).toMatch(/already at level 3/)
    expect(String(ev?.data?.felt)).not.toMatch(/\d+ wood/)
    expect(placeLevel(forestry)).toBe(3)
  })

  it('a non-owner can upgrade a commons notice-board and cannot bypass MAX_ACTIVE_SITES', () => {
    const sim = new Simulation(42)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    expect(sim.state.owners[board.id]).toBe('commons')
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    expect(sim.state.owners[board.id]).not.toBe(agent.id)

    expect(sim.commission(agent.id, 'notice-board')).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.upgradeOf).toBe(board.id)
    expect(site.construction?.needs).toEqual({ wood: BUILD_RECIPES['notice-board'].wood })

    forceComplete(sim, site, 'agent-2')
    expect(placeLevel(board)).toBe(2)
    expect(sim.state.owners[board.id]).toBe('commons')

    const cap = new Simulation(42)
    const openPlot = (): { x: number; y: number } => {
      for (let y = 2; y < cap.state.height - 2; y++) {
        for (let x = 2; x < cap.state.width - 2; x++) {
          const t = cap.state.tiles[y * cap.state.width + x]!
          if (!t.walkable || t.kind === 'water' || t.kind === 'rock') continue
          const close = cap.state.places.some(
            (p) =>
              (p.kind === 'home' ||
                p.kind === 'construction-site' ||
                p.kind === 'farm' ||
                p.kind === 'stall' ||
                p.kind === 'storehouse' ||
                p.kind === 'plaza' ||
                p.kind === 'well') &&
              Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 2,
          )
          if (!close) return { x, y }
        }
      }
      throw new Error('no open plot')
    }
    const p0 = openPlot()
    expect(cap.commission('agent-0', 'farm', p0.x, p0.y)).toBe(true)
    const p1 = openPlot()
    expect(cap.commission('agent-1', 'stall', p1.x, p1.y)).toBe(true)
    const p2 = openPlot()
    expect(cap.commission('agent-2', 'storehouse', p2.x, p2.y)).toBe(true)
    expect(
      cap.state.places.filter((p) => p.kind === 'construction-site'),
    ).toHaveLength(MAX_ACTIVE_SITES)
    expect(cap.commission('agent-3', 'notice-board')).toBe(false)
    const capEv = cap
      .getEvents()
      .filter((e) => e.type === 'construction:commission-refused')
      .at(-1)
    expect(capEv?.data?.why).toBe('site-cap')
  })

  it('owning a different kind still founds a new site, not an upgrade', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    const quarry = sim.state.places.find((p) => p.kind === 'quarry')!
    expect(sim.state.owners[quarry.id]).not.toBe(agent.id)
    const w = sim.state.width
    let plot: { x: number; y: number } | null = null
    for (let y = 2; y < sim.state.height - 2 && !plot; y++) {
      for (let x = 2; x < w - 2; x++) {
        const t = sim.state.tiles[y * w + x]!
        if (!t.walkable || t.kind === 'water' || t.kind === 'rock') continue
        const close = sim.state.places.some(
          (p) =>
            (p.kind === 'home' ||
              p.kind === 'construction-site' ||
              p.kind === 'farm' ||
              p.kind === 'stall' ||
              p.kind === 'storehouse' ||
              p.kind === 'plaza' ||
              p.kind === 'well') &&
            Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 2,
        )
        if (!close) {
          plot = { x, y }
          break
        }
      }
    }
    expect(plot).toBeTruthy()
    expect(sim.commission(agent.id, 'stall', plot!.x, plot!.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    expect(site.construction?.targetKind).toBe('stall')
    expect(site.construction?.upgradeOf).toBeUndefined()
  })

  it('level survives save round-trip and stateAt re-sim', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    expect(sim.commission(agent.id, 'forestry')).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    forceComplete(sim, site, 'agent-2')
    expect(placeLevel(forestry)).toBe(2)
    const toSnap = SNAPSHOT_INTERVAL - (sim.state.tick % SNAPSHOT_INTERVAL)
    sim.advanceTicks(toSnap === 0 ? SNAPSHOT_INTERVAL : toSnap)
    const tickA = sim.state.tick
    const hashA = sim.hash()
    expect(placeLevel(sim.state.places.find((p) => p.id === forestry.id)!)).toBe(2)

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(SAVE_FORMAT_VERSION).toBe(5)
    const restored = restoreSave(save)
    const restForest = restored.state.places.find((p) => p.id === forestry.id)!
    expect(placeLevel(restForest)).toBe(2)
    expect(restored.hash()).toBe(hashA)

    const fork = sim.stateAt(tickA)
    expect(fork.hash()).toBe(hashA)
    expect(placeLevel(fork.state.places.find((p) => p.id === forestry.id)!)).toBe(2)
    const restoredFork = restored.stateAt(tickA)
    expect(restoredFork.hash()).toBe(hashA)
  })

  it('recorded soak worlds still import (no level field)', (ctx) => {
    const files = recordedWorldPaths([
      'artifacts/soak-1787430602479-world.json',
      'artifacts/soak-1787452399090-world.json',
    ])
    if (files.length === 0) return ctx.skip(NO_RECORDED_WORLDS)
    for (const file of files) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        tick: number
        seed: number
        snapshot: { state: { agents: unknown[]; places: Place[] } }
      }
      const loaded = restoreSave(raw)
      expect(loaded.state.tick).toBe(raw.tick)
      expect(loaded.state.seed).toBe(raw.seed)
      expect(loaded.state.agents.length).toBeGreaterThan(0)
      expect(loaded.state.places.every((p) => (p.level ?? 1) === 1)).toBe(true)
    }
  }, 120_000)

  it('nearby and examine compactly tag places above level 1', () => {
    const forestry = {
      id: 'for-0',
      kind: 'forestry' as const,
      x: 4,
      y: 4,
      slots: 3,
      inventory: emptyInventory(),
      level: 2,
    }
    expect(
      formatNearbyPlaceLine({
        place: forestry,
        unfamiliar: false,
        dist2: 1,
        ownerName: 'Ode',
      }),
    ).toBe("forestry (lv 2, empty, Ode's)")
    expect(examineKnowledgeFor(forestry)).toMatch(/\(lv 2\)/)
    const l1 = { ...forestry, level: undefined }
    expect(
      formatNearbyPlaceLine({
        place: l1,
        unfamiliar: false,
        dist2: 1,
      }),
    ).toBe('forestry (empty)')
  })

  it('WORLD_RULES states the upgrade affordance once, with no advice', () => {
    const line = upgradeRuleLine()
    const sys = buildSystemPrompt('agent-0')
    expect(sys).toContain(line)
    expect(line).toMatch(/Commissioning a kind you already own upgrades it/)
    expect(line).toMatch(/max 3/)
    expect(line).toMatch(/slot/)
    expect(line).not.toMatch(/should/i)
    expect(line).not.toMatch(/you might/i)
    expect(line).not.toMatch(/consider/i)
  })

  it('UtilityBrain still does not commission upgrades', () => {
    const sim = new Simulation(42)
    const brain = new UtilityBrain()
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const forestry = sim.state.places.find((p) => p.kind === 'forestry')!
    sim.state.owners[forestry.id] = agent.id
    agent.wallet = 80
    agent.needs.hunger = 0.9
    agent.needs.energy = 0.9
    agent.needs.social = 0.9
    const rng = createRng(1)
    for (let i = 0; i < 40; i++) {
      const obs = makeObservation(agent, sim.state)
      const intent = brain.decide(obs, rng)
      expect(intent.kind).not.toBe('commission')
    }
    const src = readFileSync(resolve('src/sim/utilityBrain.ts'), 'utf8')
    expect(src).not.toMatch(/upgrade/i)
    expect(src).toContain('!agentOwnsAnyPlace(world, self.id)')
  })
})

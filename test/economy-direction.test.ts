import { describe, expect, it } from 'vitest'
import { restoreSave, serializeSave } from '../src/sim/persist'
import { Simulation } from '../src/sim/sim'
import { pickOpenWorkplace } from '../src/sim/spots'
import type { BuildableKind } from '../src/sim/types'

function freePlot(sim: Simulation, kind: BuildableKind): { x: number; y: number } {
  for (let y = 1; y < sim.state.height - 1; y++) {
    for (let x = 1; x < sim.state.width - 1; x++) {
      if (sim.validateBuildPlacement(kind, x, y).ok) return { x, y }
    }
  }
  throw new Error(`no free ${kind} plot`)
}

function freePathTile(sim: Simulation): { x: number; y: number } {
  for (let y = 0; y < sim.state.height; y++) {
    for (let x = 0; x < sim.state.width; x++) {
      if (sim.validatePathPlacement(x, y).ok) return { x, y }
    }
  }
  throw new Error('no free path tile')
}

describe('economy and player direction', () => {
  it('lets the player designate all three producer types', () => {
    const sim = new Simulation(1201)
    const ids: string[] = []
    for (const kind of ['farm', 'forestry', 'quarry'] as const) {
      const plot = freePlot(sim, kind)
      const result = sim.issuePlayerCommand({ type: 'build', placeKind: kind, ...plot })
      expect(result.ok).toBe(true)
      ids.push(result.placeId!)
    }
    const targets = sim.state.places
      .filter((place) => ids.includes(place.id))
      .map((place) => place.construction?.targetKind)
    expect(targets).toEqual(['farm', 'forestry', 'quarry'])
  })

  it('records paths, priorities, site rank, and stock filters in deterministic replay and saves', () => {
    const sim = new Simulation(1202)
    const path = freePathTile(sim)
    expect(sim.issuePlayerCommand({ type: 'paint-path', ...path, enabled: true }).ok).toBe(true)
    expect(sim.state.tiles[path.y * sim.state.width + path.x]!.path).toBe(true)

    const plot = freePlot(sim, 'farm')
    const built = sim.issuePlayerCommand({ type: 'build', placeKind: 'farm', ...plot })
    expect(built.ok).toBe(true)
    expect(sim.issuePlayerCommand({
      type: 'set-construction-priority',
      placeId: built.placeId!,
      priority: 3,
    }).ok).toBe(true)
    expect(sim.issuePlayerCommand({ type: 'set-work-priority', category: 'food', level: 3 }).ok).toBe(true)
    expect(sim.issuePlayerCommand({ type: 'set-work-priority', category: 'wood', level: 0 }).ok).toBe(true)

    const store = sim.state.places.find((place) => place.kind === 'storehouse')!
    expect(sim.issuePlayerCommand({
      type: 'set-stockpile-filter',
      placeId: store.id,
      good: 'wood',
      enabled: false,
    }).ok).toBe(true)

    expect(sim.state.workPriorities).toMatchObject({ food: 3, wood: 0 })
    expect(sim.state.places.find((place) => place.id === built.placeId)?.construction?.priority).toBe(3)
    expect(store.storageFilters?.wood).toBe(false)
    expect(sim.getPlayerCommandLog().map((entry) => entry.command.type)).toEqual([
      'paint-path',
      'build',
      'set-construction-priority',
      'set-work-priority',
      'set-work-priority',
      'set-stockpile-filter',
    ])

    const hash = sim.hash()
    expect(sim.stateAt(sim.state.tick).hash()).toBe(hash)
    expect(restoreSave(serializeSave(sim)).hash()).toBe(hash)
  })

  it('uses town priorities to staff urgent work and treats priority zero as off', () => {
    const sim = new Simulation(42)
    for (const agent of sim.state.agents) agent.employedAt = null
    const agent = sim.state.agents[0]!

    sim.issuePlayerCommand({ type: 'set-work-priority', category: 'food', level: 3 })
    sim.issuePlayerCommand({ type: 'set-work-priority', category: 'stone', level: 2 })
    expect(pickOpenWorkplace(sim.state, agent)?.kind).toMatch(/farm|stall/)

    sim.issuePlayerCommand({ type: 'set-work-priority', category: 'food', level: 0 })
    sim.issuePlayerCommand({ type: 'set-work-priority', category: 'stone', level: 3 })
    expect(pickOpenWorkplace(sim.state, agent)?.kind).toBe('quarry')
  })

  it('prevents a production haul when the only storehouse blocks that good', () => {
    const sim = new Simulation(1204)
    const forestry = sim.state.places.find((place) => place.kind === 'forestry')!
    const store = sim.state.places.find((place) => place.kind === 'storehouse')!
    const worker = sim.state.agents[0]!
    for (const agent of sim.state.agents) agent.employedAt = null
    worker.employedAt = forestry.id
    worker.x = forestry.x
    worker.y = forestry.y
    worker.action = {
      kind: 'work',
      targetPlaceId: forestry.id,
      targetX: forestry.x,
      targetY: forestry.y,
      reason: 'Filter acceptance test',
    }
    worker.actionTicks = 0
    worker.lastDecideTick = sim.state.tick
    worker.workPhase = 'tend'
    worker.needs = { hunger: 1, energy: 1, social: 1 }
    forestry.inventory.wood = 5

    sim.issuePlayerCommand({
      type: 'set-stockpile-filter',
      placeId: store.id,
      good: 'wood',
      enabled: false,
    })
    sim.advanceTicks(1)
    expect(forestry.inventory.wood).toBe(5)
    expect(worker.inventory.wood).toBe(0)

    sim.issuePlayerCommand({
      type: 'set-stockpile-filter',
      placeId: store.id,
      good: 'wood',
      enabled: true,
    })
    worker.employedAt = forestry.id
    worker.x = forestry.x
    worker.y = forestry.y
    worker.action = {
      kind: 'work',
      targetPlaceId: forestry.id,
      targetX: forestry.x,
      targetY: forestry.y,
      reason: 'Filter acceptance test',
    }
    worker.actionTicks = 0
    worker.pathIndex = 0
    worker.lastDecideTick = sim.state.tick
    worker.workPhase = 'tend'
    sim.advanceTicks(1)
    expect(forestry.inventory.wood).toBe(0)
    expect(worker.inventory.wood).toBe(5)
    expect(worker.haulDropoffId).toBe(store.id)
  })
})

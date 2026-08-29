import { describe, expect, it } from 'vitest'
import { isWalkable } from '../src/sim/pathfind'
import { Simulation } from '../src/sim/sim'
import type { AgentState, Place } from '../src/sim/types'

function findSchoolPlot(sim: Simulation): { x: number; y: number } {
  for (let y = 1; y < sim.state.height - 6; y++) {
    for (let x = 1; x < sim.state.width - 8; x++) {
      const check = sim.validateBlueprintPlacement('school', x, y)
      if (check.ok) return { x, y }
    }
  }
  throw new Error('no school plot')
}

function placeSchool(sim: Simulation): Place {
  const plot = findSchoolPlot(sim)
  const result = sim.issuePlayerCommand({
    type: 'place-blueprint',
    blueprintId: 'school',
    x: plot.x,
    y: plot.y,
  })
  expect(result.ok).toBe(true)
  const site = sim.state.places.find((p) => p.id === result.placeId)
  if (!site?.structure) throw new Error('missing site')
  return site
}

function pinWorker(agent: AgentState, site: Place, x: number, y: number, tick: number): void {
  agent.x = x
  agent.y = y
  agent.employedAt = site.id
  agent.action = { kind: 'work', targetPlaceId: site.id, targetX: x, targetY: y, reason: 'scripted build' }
  agent.action.path = undefined
  agent.pathIndex = 0
  agent.actionTicks = 1
  agent.workPhase = 'tend'
  agent.lastDecideTick = tick
  agent.collapsed = false
  agent.needs = { hunger: 0.9, energy: 0.9, social: 0.9 }
}

describe('blueprint construction engine', () => {
  it('stocks cells in row-major order', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    site.inventory.wood = 1
    site.inventory.stone = 1
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]?.state).toBe('stocked')
    expect(site.structure!.cells[1]?.state).toBe('planned')
    site.inventory.wood = 1
    site.inventory.stone = 1
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]?.state).toBe('stocked')
    expect(site.structure!.cells[1]?.state).toBe('stocked')
    expect(site.structure!.cells[2]?.state).toBe('planned')
    expect(site.construction?.needs.wood).toBe(36 - 2)
    expect(site.construction?.needs.stone).toBe(19 - 2)
  })

  it('routes work to the nearest stocked cell and flips wall walkability', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    // Stock only the two opposite top-row walls.
    site.structure!.cells[0]!.state = 'stocked'
    site.structure!.cells[6]!.state = 'stocked'
    site.construction!.needs = { wood: 34, stone: 17 }
    const a = sim.state.agents[0]!
    const b = sim.state.agents[1]!
    pinWorker(a, site, originX + 2, originY + 1, sim.state.tick)
    pinWorker(b, site, originX + 4, originY + 1, sim.state.tick)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.workedTicks).toBeGreaterThan(0)
    expect(site.structure!.cells[6]!.workedTicks).toBeGreaterThan(0)
    expect(site.structure!.cells[0]!.workedTicks + site.structure!.cells[6]!.workedTicks).toBe(2)

    site.structure!.cells[6]!.state = 'planned'
    site.structure!.cells[6]!.workedTicks = 0
    pinWorker(a, site, site.x, site.y, sim.state.tick)
    site.structure!.cells[0]!.workedTicks = 29
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.state).toBe('built')
    expect(isWalkable(sim.state, originX, originY)).toBe(false)
    expect(site.construction!.progress).toBeCloseTo(1 / 35, 10)
  })

  it('defers wall completion while the tile is occupied', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    site.structure!.cells[0]!.state = 'stocked'
    site.structure!.cells[0]!.workedTicks = 29
    const worker = sim.state.agents[0]!
    const blocker = sim.state.agents[1]!
    pinWorker(worker, site, site.x, site.y, sim.state.tick)
    pinWorker(blocker, site, originX, originY, sim.state.tick)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.state).toBe('stocked')
    expect(site.structure!.cells[0]!.workedTicks).toBe(29)
    blocker.x = originX - 1
    blocker.y = originY - 1
    pinWorker(worker, site, site.x, site.y, sim.state.tick)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.state).toBe('built')
    expect(isWalkable(sim.state, originX, originY)).toBe(false)
  })

  it('cancels with a refund and restores walkable tiles', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    const store = sim.state.places.find((p) => p.kind === 'storehouse')!
    const before = store.inventory.wood
    site.inventory.wood = 4
    site.inventory.stone = 0
    site.structure!.cells[0]!.state = 'built'
    const tile = sim.state.tiles[originY * sim.state.width + originX]!
    tile.walkable = false
    const cancelled = sim.issuePlayerCommand({ type: 'cancel-construction', placeId: site.id })
    expect(cancelled.ok).toBe(true)
    expect(sim.state.places.some((p) => p.id === site.id)).toBe(false)
    expect(store.inventory.wood).toBe(before + 4)
    expect(isWalkable(sim.state, originX, originY)).toBe(true)
  })

  it('replays mid-build state from snapshots', () => {
    const sim = new Simulation(77)
    const site = placeSchool(sim)
    site.inventory.wood = 8
    site.inventory.stone = 8
    sim.issuePlayerCommand({ type: 'set-work-priority', category: 'build', level: 3 })
    sim.advanceTicks(20)
    const at = sim.state.tick
    expect(sim.stateAt(at).hash()).toBe(sim.hash())
    const replayed = sim.stateAt(at).state.places.find((p) => p.id === site.id)
    const stocked = replayed?.structure?.cells.filter((c) => c && c.state !== 'planned').length ?? 0
    expect(stocked).toBeGreaterThan(0)
  })
})

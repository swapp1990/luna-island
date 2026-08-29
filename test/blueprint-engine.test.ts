import { describe, expect, it } from 'vitest'
import { SCHOOL_BLUEPRINT, STAGE_COSTS, cellDone } from '../src/sim/blueprints'
import { isWalkable } from '../src/sim/pathfind'
import { Simulation } from '../src/sim/sim'
import type { AgentState, Place, StructureCell } from '../src/sim/types'

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

function setCell(cell: StructureCell, stageIndex: number, stageState: StructureCell['stageState'], workedTicks = 0): void {
  cell.stageIndex = stageIndex
  cell.stageState = stageState
  cell.workedTicks = workedTicks
}

function parkOthers(sim: Simulation, keep: AgentState[]): void {
  const keepIds = new Set(keep.map((agent) => agent.id))
  for (const agent of sim.state.agents) {
    if (keepIds.has(agent.id)) continue
    agent.action = { kind: 'idle', reason: 'parked' }
    agent.employedAt = null
    agent.workPhase = null
    agent.lastDecideTick = sim.state.tick
  }
}

describe('blueprint construction engine', () => {
  it('stocks the next unlockable stage of the lowest-index eligible cell', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    site.inventory.wood = 0
    site.inventory.stone = 1
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]?.stageState).toBe('stocked')
    expect(site.structure!.cells[0]?.staged?.stone).toBeUndefined()
    expect(site.structure!.cells[0]?.stageIndex).toBe(0)
    expect(site.structure!.cells[1]?.stageState).toBe('pending')
    site.inventory.stone = 1
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]?.stageState).toBe('stocked')
    expect(site.structure!.cells[1]?.stageState).toBe('stocked')
    expect(site.structure!.cells[1]?.staged?.stone).toBeUndefined()
    expect(site.structure!.cells[2]?.stageState).toBe('pending')
    expect(site.construction?.needs.wood).toBe(90)
    expect(site.construction?.needs.stone).toBe(18)
  })

  it('routes work to the nearest stocked stage and flips walkability at wall frame', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    setCell(site.structure!.cells[0]!, 1, 'stocked', 0)
    setCell(site.structure!.cells[6]!, 1, 'stocked', 0)
    site.construction!.needs = { wood: 88, stone: 18 }
    const a = sim.state.agents[0]!
    const b = sim.state.agents[1]!
    pinWorker(a, site, originX, originY + 1, sim.state.tick)
    pinWorker(b, site, originX + 6, originY + 1, sim.state.tick)
    parkOthers(sim, [a, b])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.workedTicks).toBeGreaterThan(0)
    expect(site.structure!.cells[6]!.workedTicks).toBeGreaterThan(0)
    expect(site.structure!.cells[0]!.workedTicks + site.structure!.cells[6]!.workedTicks).toBe(2)

    setCell(site.structure!.cells[6]!, 0, 'pending', 0)
    pinWorker(a, site, originX, originY + 1, sim.state.tick)
    parkOthers(sim, [a])
    setCell(site.structure!.cells[0]!, 1, 'stocked', STAGE_COSTS.frame.labourTicks - 1)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.stageIndex).toBe(2)
    expect(site.structure!.cells[0]!.stageState).toBe('pending')
    expect(isWalkable(sim.state, originX, originY)).toBe(false)
    expect(site.construction!.progress).toBeCloseTo(2 / 110, 10)
  })

  it('defers wall frame completion while the tile is occupied', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    setCell(site.structure!.cells[0]!, 1, 'stocked', STAGE_COSTS.frame.labourTicks - 1)
    const worker = sim.state.agents[0]!
    const blocker = sim.state.agents[1]!
    pinWorker(worker, site, originX, originY + 1, sim.state.tick)
    pinWorker(blocker, site, originX, originY, sim.state.tick)
    parkOthers(sim, [worker, blocker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.stageIndex).toBe(1)
    expect(site.structure!.cells[0]!.stageState).toBe('stocked')
    expect(site.structure!.cells[0]!.workedTicks).toBe(STAGE_COSTS.frame.labourTicks - 1)
    blocker.x = originX - 1
    blocker.y = originY - 1
    pinWorker(worker, site, originX, originY + 1, sim.state.tick)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.stageIndex).toBe(2)
    expect(isWalkable(sim.state, originX, originY)).toBe(false)
  })

  it('keeps door and floor tiles walkable after their frame stage', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    setCell(site.structure!.cells[3]!, 1, 'stocked', STAGE_COSTS.frame.labourTicks - 1)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, originX + 3, originY + 1, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[3]!.stageIndex).toBe(2)
    expect(isWalkable(sim.state, originX + 3, originY)).toBe(true)
  })

  it('refuses to stock a roof stage before the envelope is complete', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    parkOthers(sim, [])
    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      const spec = SCHOOL_BLUEPRINT.cells[i]
      const rec = site.structure!.cells[i]
      if (!spec || !rec) continue
      if (spec.kind === 'floor') setCell(rec, 1, 'pending', 0)
      else setCell(rec, 2, 'stocked', 0)
    }
    const floorRoof = site.structure!.cells[8]!
    site.inventory.wood = 40
    site.inventory.stone = 0
    sim.advanceTicks(1)
    expect(floorRoof.stageIndex).toBe(1)
    expect(floorRoof.stageState).toBe('pending')
  })

  it('does not apply work to a prematurely stocked roof while the envelope is incomplete', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      const rec = site.structure!.cells[i]
      if (rec) setCell(rec, 0, 'pending', 0)
    }
    const roofCell = site.structure!.cells[8]!
    setCell(roofCell, 1, 'stocked', 3)
    setCell(site.structure!.cells[6]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    pinWorker(worker, site, originX + 6, originY + 1, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(roofCell.stageIndex).toBe(1)
    expect(roofCell.stageState).toBe('stocked')
    expect(roofCell.workedTicks).toBe(3)
    expect(site.structure!.cells[6]!.workedTicks).toBeGreaterThan(0)
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
    setCell(site.structure!.cells[0]!, 3, 'built', 8)
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
    const started = replayed?.structure?.cells.filter((c) => c && derivedStarted(c)).length ?? 0
    expect(started).toBeGreaterThan(0)
  })

  it('progress is built stages over total stages', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    setCell(site.structure!.cells[0]!, 0, 'stocked', STAGE_COSTS.foundation.labourTicks - 1)
    const worker = sim.state.agents[0]!
    const originX = site.structure!.originX
    const originY = site.structure!.originY
    pinWorker(worker, site, originX, originY, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.stageIndex).toBe(1)
    expect(cellDone(SCHOOL_BLUEPRINT, 0, site.structure!.cells[0]!)).toBe(false)
    expect(site.construction!.progress).toBeCloseTo(1 / 110, 10)
  })
})

function derivedStarted(cell: StructureCell): boolean {
  return !(cell.stageIndex === 0 && cell.stageState === 'pending')
}

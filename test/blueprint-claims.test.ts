import { describe, expect, it } from 'vitest'
import {
  CLAIM_STALE_TICKS,
  SCHOOL_BLUEPRINT,
  STAGE_COSTS,
  cellStandCandidates,
  makePlannedStructure,
  stageAllowsOnCell,
  unstockedStagesBill,
} from '../src/sim/blueprints'
import { Simulation } from '../src/sim/sim'
import { emptyInventory } from '../src/sim/types'
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

function setCell(
  cell: StructureCell,
  stageIndex: number,
  stageState: StructureCell['stageState'],
  workedTicks = 0,
): void {
  cell.stageIndex = stageIndex
  cell.stageState = stageState
  cell.workedTicks = workedTicks
}

function parkOthers(sim: Simulation, keep: AgentState[]): void {
  const keepIds = new Set(keep.map((agent) => agent.id))
  let slot = 0
  for (const agent of sim.state.agents) {
    if (keepIds.has(agent.id)) continue
    agent.action = { kind: 'idle', reason: 'parked' }
    agent.employedAt = null
    agent.workPhase = null
    agent.lastDecideTick = sim.state.tick
    agent.inventory = emptyInventory()
    agent.x = 2 + (slot % 3)
    agent.y = 2 + Math.floor(slot / 3)
    agent.action.path = undefined
    slot += 1
  }
}

describe('blueprint cell claims and piles', () => {
  it('assigns exclusive claims in deterministic nearest-index order', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    setCell(site.structure!.cells[1]!, 0, 'stocked', 0)
    const a = sim.state.agents[0]!
    const b = sim.state.agents[1]!
    pinWorker(a, site, ox, oy + 1, sim.state.tick)
    pinWorker(b, site, ox + 1, oy + 1, sim.state.tick)
    parkOthers(sim, [a, b])
    sim.advanceTicks(1)
    const c0 = site.structure!.cells[0]!
    const c1 = site.structure!.cells[1]!
    expect(c0.claimedBy).toBeTruthy()
    expect(c1.claimedBy).toBeTruthy()
    expect(c0.claimedBy).not.toBe(c1.claimedBy)
    expect(new Set([c0.claimedBy, c1.claimedBy])).toEqual(new Set([a.id, b.id]))
  })

  it('does not apply work two tiles away and retargets to an adjacent stand tile', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, ox + 2, oy, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.workedTicks).toBe(0)
    expect(site.structure!.cells[0]!.claimedBy).toBe(worker.id)
    const tx = worker.action.targetX ?? worker.x
    const ty = worker.action.targetY ?? worker.y
    const dx = Math.abs(Math.round(tx) - ox)
    const dy = Math.abs(Math.round(ty) - oy)
    expect(dx + dy === 1 || (dx === 0 && dy === 0)).toBe(true)
  })

  it(`releases a stale claim at exactly ${CLAIM_STALE_TICKS} ticks without work`, () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, ox, oy + 1, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.claimedBy).toBe(worker.id)
    pinWorker(worker, site, ox + 4, oy + 4, sim.state.tick)
    site.structure!.cells[0]!.claimTick = sim.state.tick - (CLAIM_STALE_TICKS - 1)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.claimedBy).toBeUndefined()
    const released = sim.getEvents().filter((e) => e.type === 'structure:claim-released')
    expect(released.some((e) => e.reason === 'stale claim')).toBe(true)
  })

  it('releases a claim when the worker is vacated', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, ox, oy + 1, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.claimedBy).toBe(worker.id)
    const vacated = sim.issuePlayerCommand({ type: 'set-work-priority', category: 'build', level: 3 })
    expect(vacated.ok).toBe(true)
    expect(site.structure!.cells[0]!.claimedBy).toBeUndefined()
    expect(sim.getEvents().some((e) => e.type === 'structure:claim-released')).toBe(true)
  })

  it('releases a claim when the claimant is removed', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, ox, oy + 1, sim.state.tick)
    parkOthers(sim, [worker])
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.claimedBy).toBe(worker.id)
    const goneId = worker.id
    sim.state.agents = sim.state.agents.filter((a) => a.id !== goneId)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.claimedBy).toBeUndefined()
    expect(
      sim.getEvents().some((e) => e.type === 'structure:claim-released' && e.reason === 'agent gone'),
    ).toBe(true)
  })

  it('1-stone foundation stocks with empty staged after one tick', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    parkOthers(sim, [])
    site.inventory.wood = 0
    site.inventory.stone = 1
    sim.advanceTicks(1)
    const first = site.structure!.cells[0]!
    expect(first.stageState).toBe('stocked')
    expect(first.staged?.stone).toBeUndefined()
    expect(first.staged?.wood).toBeUndefined()
    expect(site.structure!.cells[1]!.stageState).toBe('pending')
    expect(site.construction?.needs.stone).toBe(19)
  })

  it('multi-unit stage keeps partial staged then stocks and clears on the covering tick', () => {
    const planned = makePlannedStructure(SCHOOL_BLUEPRINT, 0, 0).cells
    const prepaid = planned.map((cell, i) => {
      if (i !== 0 || !cell) return cell
      return { ...cell, staged: { stone: 1 } }
    })
    const origStone = STAGE_COSTS.foundation.stone
    STAGE_COSTS.foundation.stone = 2
    try {
      const full = unstockedStagesBill(SCHOOL_BLUEPRINT, planned)
      const reduced = unstockedStagesBill(SCHOOL_BLUEPRINT, prepaid)
      expect(reduced.stone).toBe(full.stone - 1)
      expect(reduced.wood).toBe(full.wood)

      const sim = new Simulation(42)
      const site = placeSchool(sim)
      parkOthers(sim, [])
      expect(site.construction?.needs.stone).toBe(40)
      site.inventory.wood = 0
      site.inventory.stone = 1
      sim.advanceTicks(1)
      const first = site.structure!.cells[0]!
      expect(first.stageState).toBe('pending')
      expect(first.staged?.stone).toBe(1)
      expect(site.construction?.needs.stone).toBe(39)
      expect(site.structure!.cells[1]!.stageState).toBe('pending')
      site.inventory.stone = 1
      sim.advanceTicks(1)
      expect(first.stageState).toBe('stocked')
      expect(first.staged?.stone).toBeUndefined()
      expect(site.structure!.cells[1]!.stageState).toBe('pending')
      expect(site.construction?.needs.stone).toBe(38)
    } finally {
      STAGE_COSTS.foundation.stone = origStone
    }
  })

  it('pending-only site chooses no 3×3 or pending-cell work target', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    parkOthers(sim, [])
    site.inventory = emptyInventory()
    if (site.construction) site.construction.needs = {}
    const worker = sim.state.agents[0]!
    worker.inventory = emptyInventory()
    const farX = Math.max(1, ox - 6)
    const farY = Math.max(1, oy - 6)
    pinWorker(worker, site, farX, farY, sim.state.tick)
    worker.lastDecideTick = sim.state.tick + 10_000
    sim.advanceTicks(1)
    expect(site.structure!.cells.every((cell) => !cell?.claimedBy)).toBe(true)
    expect(site.structure!.cells[0]!.workedTicks).toBe(0)
    const tx = Math.round(worker.action.targetX ?? worker.x)
    const ty = Math.round(worker.action.targetY ?? worker.y)
    expect(tx).toBe(farX)
    expect(ty).toBe(farY)
    expect(tx === site.x && ty === site.y).toBe(false)
    const pendingStands = new Set(
      cellStandCandidates(ox, oy, SCHOOL_BLUEPRINT.width, 0, stageAllowsOnCell('foundation')).map(
        ([x, y]) => `${x},${y}`,
      ),
    )
    expect(pendingStands.has(`${tx},${ty}`)).toBe(false)
  })

  it('retargets work from a generic 3×3 slot to a claimable cell stand and applies no work there', () => {
    const sim = new Simulation(42)
    const site = placeSchool(sim)
    const ox = site.structure!.originX
    const oy = site.structure!.originY
    setCell(site.structure!.cells[0]!, 0, 'stocked', 0)
    const worker = sim.state.agents[0]!
    pinWorker(worker, site, site.x, site.y, sim.state.tick)
    parkOthers(sim, [worker])
    const before = site.structure!.cells[0]!.workedTicks
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.workedTicks).toBe(before)
    expect(site.structure!.cells[0]!.claimedBy).toBe(worker.id)
    const tx = Math.round(worker.action.targetX ?? worker.x)
    const ty = Math.round(worker.action.targetY ?? worker.y)
    const legal = new Set(
      cellStandCandidates(ox, oy, SCHOOL_BLUEPRINT.width, 0, stageAllowsOnCell('foundation')).map(
        ([x, y]) => `${x},${y}`,
      ),
    )
    expect(legal.has(`${site.x},${site.y}`)).toBe(false)
    expect(legal.has(`${tx},${ty}`)).toBe(true)

    pinWorker(worker, site, ox, oy + 1, sim.state.tick)
    setCell(site.structure!.cells[0]!, 0, 'stocked', STAGE_COSTS.foundation.labourTicks - 1)
    setCell(site.structure!.cells[1]!, 0, 'stocked', 0)
    sim.advanceTicks(1)
    expect(site.structure!.cells[0]!.stageIndex).toBe(1)
    expect(site.structure!.cells[0]!.stageState).toBe('pending')
    delete site.structure!.cells[0]!.claimedBy
    delete site.structure!.cells[1]!.claimedBy
    site.inventory = emptyInventory()
    worker.inventory = emptyInventory()
    pinWorker(worker, site, site.x, site.y, sim.state.tick)
    worker.lastDecideTick = sim.state.tick + 10_000
    const ticks1 = site.structure!.cells[1]!.workedTicks
    sim.advanceTicks(1)
    expect(site.structure!.cells[1]!.workedTicks).toBe(ticks1)
    expect(site.structure!.cells[1]!.claimedBy).toBe(worker.id)
    const tx2 = Math.round(worker.action.targetX ?? worker.x)
    const ty2 = Math.round(worker.action.targetY ?? worker.y)
    const legal1 = new Set(
      cellStandCandidates(ox, oy, SCHOOL_BLUEPRINT.width, 1, stageAllowsOnCell('foundation')).map(
        ([x, y]) => `${x},${y}`,
      ),
    )
    expect(legal1.has(`${site.x},${site.y}`)).toBe(false)
    expect(legal1.has(`${tx2},${ty2}`)).toBe(true)
  })

  it('same seed + 3 workers + stockSite ⇒ identical hash', () => {
    const run = (seed: number) => {
      const sim = new Simulation(seed)
      const plot = findSchoolPlot(sim)
      const placed = sim.issuePlayerCommand({
        type: 'place-blueprint',
        blueprintId: 'school',
        x: plot.x,
        y: plot.y,
      })
      const site = sim.state.places.find((p) => p.id === placed.placeId)!
      sim.issuePlayerCommand({ type: 'debug-stock-site', placeId: site.id })
      const crew = sim.state.agents.slice(0, 3)
      const ox = site.structure!.originX
      const oy = site.structure!.originY
      parkOthers(sim, crew)
      crew.forEach((agent, i) => {
        pinWorker(agent, site, ox + i, oy + 1, sim.state.tick)
      })
      sim.advanceTicks(80)
      return sim
    }
    const a = run(42)
    const b = run(42)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    expect(STAGE_COSTS.foundation.stone).toBe(1)
    expect(SCHOOL_BLUEPRINT.id).toBe('school')
  })
})

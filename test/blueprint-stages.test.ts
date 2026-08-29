import { describe, expect, it } from 'vitest'
import {
  SCHOOL_BLUEPRINT,
  STAGE_COSTS,
  blueprintBill,
  cellDone,
  cellPipeline,
  cloneStructure,
  countBuiltStages,
  derivedCellState,
  makePlannedStructure,
  migrateStructureCell,
  nextStockableIndex,
  roofUnlocked,
  structurePhase,
} from '../src/sim/blueprints'
import type { Blueprint } from '../src/sim/blueprints'
import type { PlaceStructure, StructureCell } from '../src/sim/types'

function billFromTables(bp: Blueprint) {
  let wood = 0
  let stone = 0
  let labourTicks = 0
  for (let i = 0; i < bp.cells.length; i++) {
    if (!bp.cells[i]) continue
    for (const stage of cellPipeline(bp, i)) {
      wood += STAGE_COSTS[stage].wood
      stone += STAGE_COSTS[stage].stone
      labourTicks += STAGE_COSTS[stage].labourTicks
    }
  }
  return { wood, stone, labourTicks }
}

describe('blueprint stage model', () => {
  it('computes school totals from the stage tables', () => {
    const expected = billFromTables(SCHOOL_BLUEPRINT)
    expect(blueprintBill(SCHOOL_BLUEPRINT)).toEqual(expected)
    expect(expected).toEqual({ wood: 90, stone: 20, labourTicks: 966 })
    let foundations = 0
    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      if (cellPipeline(SCHOOL_BLUEPRINT, i).includes('foundation')) foundations += 1
    }
    expect(foundations).toBe(20)
  })

  it('enforces per-cell pipeline order', () => {
    expect(cellPipeline(SCHOOL_BLUEPRINT, 0)).toEqual(['foundation', 'frame', 'wall', 'roof'])
    expect(cellPipeline(SCHOOL_BLUEPRINT, 3)).toEqual(['foundation', 'frame', 'door', 'roof'])
    expect(cellPipeline(SCHOOL_BLUEPRINT, 8)).toEqual(['floor', 'roof'])
    const structure = makePlannedStructure(SCHOOL_BLUEPRINT, 0, 0)
    expect(nextStockableIndex(structure, SCHOOL_BLUEPRINT)).toBe(0)
    const first = structure.cells[0]!
    first.stageState = 'stocked'
    expect(nextStockableIndex(structure, SCHOOL_BLUEPRINT)).toBe(1)
    first.stageState = 'built'
    first.stageIndex = 0
    expect(cellDone(SCHOOL_BLUEPRINT, 0, first)).toBe(false)
    first.stageIndex = 1
    first.stageState = 'pending'
    expect(nextStockableIndex(structure, SCHOOL_BLUEPRINT)).toBe(0)
  })

  it('blocks roof stages until every wall and door envelope is complete', () => {
    const structure = makePlannedStructure(SCHOOL_BLUEPRINT, 0, 0)
    expect(roofUnlocked(structure, SCHOOL_BLUEPRINT)).toBe(false)
    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      const spec = SCHOOL_BLUEPRINT.cells[i]
      const rec = structure.cells[i]
      if (!spec || !rec) continue
      if (spec.kind === 'wall' || spec.kind === 'door') {
        rec.stageIndex = 2
        rec.stageState = 'stocked'
      } else {
        rec.stageIndex = 1
        rec.stageState = 'pending'
      }
    }
    expect(roofUnlocked(structure, SCHOOL_BLUEPRINT)).toBe(false)
    expect(nextStockableIndex(structure, SCHOOL_BLUEPRINT)).toBe(-1)

    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      const spec = SCHOOL_BLUEPRINT.cells[i]
      const rec = structure.cells[i]
      if (!spec || !rec) continue
      if (spec.kind === 'wall' || spec.kind === 'door') {
        rec.stageIndex = 3
        rec.stageState = 'pending'
      }
    }
    expect(roofUnlocked(structure, SCHOOL_BLUEPRINT)).toBe(true)
    expect(nextStockableIndex(structure, SCHOOL_BLUEPRINT)).toBe(0)
  })

  it('migrates 3-state cells onto the current pipeline', () => {
    const planned = migrateStructureCell({ state: 'planned', workedTicks: 0 }, SCHOOL_BLUEPRINT, 0)
    expect(planned).toEqual({ stageIndex: 0, stageState: 'pending', workedTicks: 0 })
    const stocked = migrateStructureCell({ state: 'stocked', workedTicks: 4 }, SCHOOL_BLUEPRINT, 0)
    expect(stocked).toEqual({ stageIndex: 0, stageState: 'stocked', workedTicks: 4 })
    const pipe = cellPipeline(SCHOOL_BLUEPRINT, 0)
    const built = migrateStructureCell({ state: 'built', workedTicks: 30 }, SCHOOL_BLUEPRINT, 0)
    expect(built).toEqual({
      stageIndex: pipe.length - 1,
      stageState: 'built',
      workedTicks: STAGE_COSTS[pipe[pipe.length - 1]!].labourTicks,
    })
    const old: PlaceStructure = {
      blueprintId: 'school',
      originX: 2,
      originY: 4,
      cells: [
        { state: 'planned', workedTicks: 0 } as unknown as StructureCell,
        { state: 'stocked', workedTicks: 3 } as unknown as StructureCell,
      ],
    }
    const migrated = cloneStructure({
      ...old,
      cells: SCHOOL_BLUEPRINT.cells.map((cell, i) => {
        if (!cell) return null
        if (i === 0) return { state: 'planned', workedTicks: 0 } as unknown as StructureCell
        if (i === 1) return { state: 'stocked', workedTicks: 3 } as unknown as StructureCell
        if (i === 2) return { state: 'built', workedTicks: 30 } as unknown as StructureCell
        return { state: 'planned', workedTicks: 0 } as unknown as StructureCell
      }),
    })!
    expect(migrated.cells[0]).toEqual({ stageIndex: 0, stageState: 'pending', workedTicks: 0 })
    expect(migrated.cells[1]).toEqual({ stageIndex: 0, stageState: 'stocked', workedTicks: 3 })
    expect(migrated.cells[2]?.stageState).toBe('built')
    expect(migrated.cells[2]?.stageIndex).toBe(cellPipeline(SCHOOL_BLUEPRINT, 2).length - 1)
    expect(derivedCellState(migrated.cells[0]!)).toBe('planned')
    expect(derivedCellState(migrated.cells[1]!)).toBe('stocked')
    expect(derivedCellState(migrated.cells[2]!)).toBe('built')
  })

  it('loads 7-2b cells without claimedBy or staged', () => {
    const raw = { stageIndex: 1, stageState: 'stocked' as const, workedTicks: 3 }
    const migrated = migrateStructureCell(raw, SCHOOL_BLUEPRINT, 0)
    expect(migrated).toEqual({ stageIndex: 1, stageState: 'stocked', workedTicks: 3 })
    expect(migrated?.claimedBy).toBeUndefined()
    expect(migrated?.staged).toBeUndefined()
    const kept = migrateStructureCell(
      { ...raw, claimedBy: 'a1', claimTick: 9, staged: { wood: 1 } },
      SCHOOL_BLUEPRINT,
      0,
    )
    expect(kept?.claimedBy).toBe('a1')
    expect(kept?.claimTick).toBe(9)
    expect(kept?.staged).toEqual({ wood: 1 })
  })

  it('counts progress as built stages over total stages', () => {
    const structure = makePlannedStructure(SCHOOL_BLUEPRINT, 0, 0)
    const total = countBuiltStages(SCHOOL_BLUEPRINT, structure.cells)
    expect(total.built).toBe(0)
    expect(total.total).toBeGreaterThan(35)
    structure.cells[0]!.stageIndex = 1
    structure.cells[0]!.stageState = 'pending'
    const one = countBuiltStages(SCHOOL_BLUEPRINT, structure.cells)
    expect(one.built).toBe(1)
    expect(one.built / one.total).toBeCloseTo(1 / total.total, 10)
    expect(structurePhase(structure, SCHOOL_BLUEPRINT)).toBe('foundation')
  })

  it('walks foundation → frame → walls → roofing → done without regression on mixed cells', () => {
    const structure = makePlannedStructure(SCHOOL_BLUEPRINT, 0, 0)
    const envelope: number[] = []
    const floors: number[] = []
    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      const spec = SCHOOL_BLUEPRINT.cells[i]
      if (!spec || !structure.cells[i]) continue
      if (spec.kind === 'floor') floors.push(i)
      else envelope.push(i)
    }
    expect(envelope).toHaveLength(20)

    const setAt = (index: number, stageIndex: number, stageState: StructureCell['stageState']) => {
      const rec = structure.cells[index]!
      rec.stageIndex = stageIndex
      rec.stageState = stageState
      rec.workedTicks = 0
    }
    const seen: string[] = []
    const note = () => {
      const phase = structurePhase(structure, SCHOOL_BLUEPRINT)
      if (seen[seen.length - 1] !== phase) seen.push(phase)
      return phase
    }

    expect(note()).toBe('foundation')

    // Ten envelope cells race ahead to walls; ten still on footings. Floors already tamped.
    for (const i of floors) setAt(i, 1, 'pending')
    for (const i of envelope.slice(0, 10)) setAt(i, 2, 'stocked')
    expect(note()).toBe('foundation')

    // Majority of envelope has left foundation — course is frame even with walls already rising.
    setAt(envelope[10]!, 1, 'stocked')
    expect(note()).toBe('frame')

    // Straggler floors still tamping must not pull the course back.
    for (const i of floors) setAt(i, 0, 'stocked')
    expect(note()).toBe('frame')

    // Majority have finished the frame.
    for (const i of envelope.slice(0, 11)) setAt(i, 2, 'stocked')
    expect(note()).toBe('walls')
    for (const i of floors) setAt(i, 0, 'stocked')
    expect(note()).toBe('walls')

    // Roof gate: last envelope cells still on walls, some already waiting on roof.
    for (const i of envelope.slice(0, 18)) setAt(i, 3, 'pending')
    expect(note()).toBe('walls')

    for (const i of envelope) setAt(i, 3, 'pending')
    expect(note()).toBe('roofing')
    for (const i of floors) setAt(i, 0, 'stocked')
    expect(note()).toBe('roofing')

    for (let i = 0; i < SCHOOL_BLUEPRINT.cells.length; i++) {
      if (structure.cells[i]) setAt(i, 3, 'built')
    }
    expect(note()).toBe('done')
    expect(seen).toEqual(['foundation', 'frame', 'walls', 'roofing', 'done'])
  })
})

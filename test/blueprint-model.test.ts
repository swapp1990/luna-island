import { describe, expect, it } from 'vitest'
import {
  BLUEPRINTS,
  SCHOOL_BLUEPRINT,
  blueprintBill,
  cellsFromAscii,
  totalStructureCells,
  validateBlueprint,
} from '../src/sim/blueprints'
import type { Blueprint } from '../src/sim/blueprints'

describe('blueprint model', () => {
  it('validates the school and matches the published bill', () => {
    expect(validateBlueprint(SCHOOL_BLUEPRINT)).toEqual([])
    expect(SCHOOL_BLUEPRINT.width).toBe(7)
    expect(SCHOOL_BLUEPRINT.height).toBe(5)
    expect(SCHOOL_BLUEPRINT.cells).toHaveLength(35)
    expect(totalStructureCells(SCHOOL_BLUEPRINT)).toBe(35)
    expect(blueprintBill(SCHOOL_BLUEPRINT)).toEqual({ wood: 90, stone: 20, labourTicks: 966 })
  })

  it('registers only valid blueprints', () => {
    expect(Object.keys(BLUEPRINTS)).toEqual(['school'])
    expect(BLUEPRINTS.school).toBe(SCHOOL_BLUEPRINT)
    for (const bp of Object.values(BLUEPRINTS)) {
      expect(validateBlueprint(bp)).toEqual([])
    }
  })

  it('rejects a blueprint with no door', () => {
    const mutant: Blueprint = {
      ...SCHOOL_BLUEPRINT,
      id: 'no-door',
      cells: SCHOOL_BLUEPRINT.cells.map((cell) =>
        cell?.kind === 'door' ? { kind: 'wall', roof: cell.roof } : cell,
      ),
    }
    expect(validateBlueprint(mutant)).toContain('blueprint needs at least one door')
  })

  it('rejects a length mismatch', () => {
    const mutant: Blueprint = {
      ...SCHOOL_BLUEPRINT,
      id: 'short',
      cells: SCHOOL_BLUEPRINT.cells.slice(0, 10),
    }
    expect(validateBlueprint(mutant)).toContain('cells length does not match width*height')
  })

  it('rejects an unreachable floor and a disconnected shape', () => {
    const unreachable = cellsFromAscii([
      'WWWDWWW',
      'W.....W',
      'WWWWWWW',
      'W.....W',
      'WWWWWWW',
    ])
    const mutant: Blueprint = {
      id: 'walled-room',
      name: 'Walled',
      resultKind: 'school',
      ...unreachable,
    }
    const errors = validateBlueprint(mutant)
    expect(errors.some((e) => e.includes('reachable') || e.includes('connected'))).toBe(true)
  })

  it('rejects a disconnected pair of cells', () => {
    const shape = cellsFromAscii([
      'D  ',
      '   ',
      '  W',
    ])
    const mutant: Blueprint = {
      id: 'split',
      name: 'Split',
      resultKind: 'school',
      ...shape,
    }
    expect(validateBlueprint(mutant)).toContain('shape is not orthogonally connected')
  })
})

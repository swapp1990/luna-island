import { describe, expect, it } from 'vitest'
import { SCHOOL_BLUEPRINT, makePlannedStructure, summarizeStructure } from '../src/sim/blueprints'
import { emptyInventory } from '../src/sim/types'
import type { Place } from '../src/sim/types'

describe('structure HUD summary', () => {
  it('counts planned cells and remaining bill on a fresh site', () => {
    const structure = makePlannedStructure(SCHOOL_BLUEPRINT, 4, 8)
    const place: Place = {
      id: 'site-1',
      kind: 'construction-site',
      x: 7,
      y: 10,
      slots: 4,
      inventory: emptyInventory(),
      construction: { needs: { wood: 36, stone: 19 }, progress: 0, consumeTicks: 0, targetKind: 'school' },
      structure,
    }
    const row = summarizeStructure(place)
    expect(row).toEqual({
      placeId: 'site-1',
      blueprintId: 'school',
      state: 'building',
      cells: { planned: 35, stocked: 0, built: 0, total: 35 },
      remaining: { wood: 36, stone: 19 },
    })
  })
})

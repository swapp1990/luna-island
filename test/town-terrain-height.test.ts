import { describe, expect, it } from 'vitest'
import { groundHeight, RELIEF_AMPLITUDE, terrainRelief, TILE_BASE_Y } from '../src/town/terrainHeight'

describe('terrain relief (V3 micro-relief height function)', () => {
  it('is exactly zero on water, every tile', () => {
    for (const [x, y] of [
      [0, 0],
      [5, 12],
      [-3, 47],
      [23, 23],
    ] as Array<[number, number]>) {
      expect(terrainRelief(x, y, 'water')).toBe(0)
      expect(groundHeight(x, y, 'water')).toBe(TILE_BASE_Y.water)
    }
  })

  it('stays within ±RELIEF_AMPLITUDE for land kinds', () => {
    for (const kind of ['sand', 'grass', 'forest', 'rock'] as const) {
      for (let x = 0; x < 20; x++) {
        for (let y = 0; y < 20; y++) {
          const r = terrainRelief(x, y, kind)
          expect(Math.abs(r)).toBeLessThanOrEqual(RELIEF_AMPLITUDE)
        }
      }
    }
  })

  it('is deterministic: same tile, same kind ⇒ same relief every call', () => {
    const a = terrainRelief(17, 9, 'grass')
    const b = terrainRelief(17, 9, 'grass')
    expect(a).toBe(b)
  })

  it('varies across tiles (not a flat constant)', () => {
    const values = new Set<number>()
    for (let x = 0; x < 12; x++) values.add(terrainRelief(x, 0, 'grass'))
    expect(values.size).toBeGreaterThan(1)
  })

  it('groundHeight = base + relief, buildings and terrain share one function', () => {
    const g = groundHeight(4, 4, 'sand')
    expect(g).toBeCloseTo(TILE_BASE_Y.sand + terrainRelief(4, 4, 'sand'), 12)
  })
})

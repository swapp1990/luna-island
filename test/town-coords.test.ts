import { describe, expect, it } from 'vitest'
import { ISLAND_TILES, TILE_METRES } from '../src/town/constants'
import {
  footprintMetres,
  footprintTiles,
  metresToTiles,
  tileToWorld,
  tilesToMetres,
  worldToTile,
} from '../src/town/coords'

const W = ISLAND_TILES
const H = ISLAND_TILES

describe('tile ↔ world transform', () => {
  it('is exactly ×3 metres per tile', () => {
    expect(TILE_METRES).toBe(3)
    expect(tilesToMetres(1)).toBe(3)
    expect(tilesToMetres(3)).toBe(9)
    expect(metresToTiles(9)).toBe(3)
    const a = tileToWorld(10, 4, W, H)
    const b = tileToWorld(11, 4, W, H)
    expect(b.x - a.x).toBe(TILE_METRES)
    expect(b.z - a.z).toBe(0)
    const c = tileToWorld(10, 5, W, H)
    expect(c.z - a.z).toBe(TILE_METRES)
  })

  it('round-trips both directions', () => {
    for (const [tx, ty] of [
      [0, 0],
      [23, 24],
      [47, 47],
      [12.5, 8.25],
    ] as Array<[number, number]>) {
      const w = tileToWorld(tx, ty, W, H)
      const back = worldToTile(w.x, w.z, W, H)
      expect(back.tx).toBeCloseTo(tx, 10)
      expect(back.ty).toBeCloseTo(ty, 10)
    }
  })

  it('centres the island on the origin', () => {
    const mid = (W - 1) / 2
    const o = tileToWorld(mid, mid, W, H)
    expect(o.x).toBeCloseTo(0, 10)
    expect(o.z).toBeCloseTo(0, 10)
    const corner = tileToWorld(0, 0, W, H)
    expect(corner.x).toBeCloseTo(-mid * TILE_METRES, 10)
  })

  it('maps footprints to metres at ×3', () => {
    expect(footprintTiles('home')).toEqual({ w: 3, d: 3 })
    expect(footprintMetres('home')).toEqual({ w: 9, d: 9 })
    expect(footprintTiles('construction-site')).toEqual({ w: 3, d: 3 })
    expect(footprintMetres('farm')).toEqual({ w: 9, d: 9 })
    expect(footprintTiles('well')).toEqual({ w: 2, d: 2 })
    expect(footprintMetres('well')).toEqual({ w: 6, d: 6 })
    expect(footprintTiles('spring')).toEqual({ w: 1, d: 1 })
    expect(footprintMetres('spring')).toEqual({ w: 3, d: 3 })
    expect(footprintMetres('plaza')).toEqual({ w: 15, d: 15 })
  })
})

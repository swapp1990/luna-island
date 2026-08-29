import { describe, expect, it } from 'vitest'
import type { WorldState } from '../src/sim/types'
import {
  buildTreeExclusionSet,
  isTileExcluded,
  prospectiveFootprintHitsTrees,
  prospectivePathHitsTrees,
  treesForTile,
} from '../src/town/treePlan'

describe('tree placement (V2)', () => {
  it('produces 1–3 deterministic instances per tile', () => {
    for (let x = 0; x < 30; x++) {
      const specs = treesForTile(x, 5)
      expect(specs.length).toBeGreaterThanOrEqual(1)
      expect(specs.length).toBeLessThanOrEqual(3)
      for (const s of specs) {
        expect([0, 1, 2]).toContain(s.variant)
        expect(s.scale).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic: same tile ⇒ identical spec list every call', () => {
    const a = treesForTile(11, 22)
    const b = treesForTile(11, 22)
    expect(a).toEqual(b)
  })

  it('varies across tiles (jitter is not constant)', () => {
    const counts = new Set(Array.from({ length: 25 }, (_, x) => treesForTile(x, 0).length))
    expect(counts.size).toBeGreaterThan(1)
    const offsets = new Set(Array.from({ length: 25 }, (_, x) => treesForTile(x, 1)[0]!.offsetX))
    expect(offsets.size).toBeGreaterThan(1)
  })

  it('excludes place footprints (+1 tile buffer) and path tiles', () => {
    const places = [{ x: 10, y: 10, kind: 'home' as const }] // 3x3 footprint → buffer to 5x5-ish
    const paths = [{ x: 30, y: 30 }]
    const set = buildTreeExclusionSet(places, paths)
    expect(isTileExcluded(10, 10, set)).toBe(true) // centre
    expect(isTileExcluded(11, 11, set)).toBe(true) // within footprint
    expect(isTileExcluded(12, 10, set)).toBe(true) // +1 tile buffer
    expect(isTileExcluded(20, 20, set)).toBe(false) // far away
    expect(isTileExcluded(30, 30, set)).toBe(true) // path tile
  })

  it('rejects prospective sites and paths that would cover rendered trees', () => {
    const tiles = Array.from({ length: 25 }, (_, index) => ({
      x: index % 5,
      y: Math.floor(index / 5),
      kind: index === 12 ? 'forest' as const : 'grass' as const,
      walkable: true,
      elevation: 0,
    }))
    const world = { width: 5, height: 5, tiles, places: [] } as unknown as WorldState
    expect(prospectiveFootprintHitsTrees(world, 2, 2)).toBe(true)
    expect(prospectivePathHitsTrees(world, 2, 2)).toBe(true)
    expect(prospectiveFootprintHitsTrees(world, 0, 0)).toBe(false)
    expect(prospectivePathHitsTrees(world, 0, 0)).toBe(false)
  })
})

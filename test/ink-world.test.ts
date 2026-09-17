import { describe, expect, it } from 'vitest'
import { wobblePolyline } from '../src/ink/render/ink'
import { pathToPlace, pathToPlaceLength, shortestPath } from '../src/ink/sim/path'
import type { PlaceId } from '../src/ink/sim/types'
import {
  PLACE_IDS,
  PLACES,
  ROAD_EDGES,
  ROAD_NODES,
  createWorld,
  dist,
  nodeById,
} from '../src/ink/sim/world'

const DOORS: Record<PlaceId, { x: number; y: number }> = {
  'home-a': { x: 13, y: 18 },
  'home-b': { x: 13, y: 38 },
  market: { x: 53, y: 16 },
  center: { x: 53, y: 32 },
  work: { x: 76, y: 28 },
}

const RECTS: Record<PlaceId, { x: number; y: number; w: number; h: number }> = {
  'home-a': { x: 6, y: 6, w: 14, h: 12 },
  'home-b': { x: 6, y: 38, w: 14, h: 12 },
  market: { x: 44, y: 4, w: 18, h: 12 },
  center: { x: 44, y: 32, w: 18, h: 12 },
  work: { x: 76, y: 20, w: 18, h: 16 },
}

describe('ink world layout', () => {
  it('pins door coordinates and rects from the spec', () => {
    for (const id of PLACE_IDS) {
      expect(PLACES[id].door).toEqual(DOORS[id])
      expect(PLACES[id].rect).toEqual(RECTS[id])
    }
  })

  it('has a connected road graph of junctions plus doors', () => {
    expect(ROAD_NODES.map((n) => n.id).sort()).toEqual(
      ['door-center', 'door-home-a', 'door-home-b', 'door-market', 'n-13-28', 'n-53-28', 'n-76-28', 'n-8-28'].sort(),
    )
    const ids = new Set(ROAD_NODES.map((n) => n.id))
    for (const [a, b] of ROAD_EDGES) {
      expect(ids.has(a)).toBe(true)
      expect(ids.has(b)).toBe(true)
      expect(dist(nodeById(a), nodeById(b))).toBeGreaterThan(0)
    }
  })

  it('reaches every place from every other', () => {
    for (const from of PLACE_IDS) {
      for (const to of PLACE_IDS) {
        if (from === to) continue
        const path = pathToPlace(PLACES[from].door, to)
        expect(path.length, `${from} → ${to}`).toBeGreaterThan(0)
        const last = path[path.length - 1]!
        expect(last).toEqual(PLACES[to].door)
        expect(pathToPlaceLength(from, to)).toBeGreaterThan(0)
      }
    }
  })

  it('has symmetric path lengths', () => {
    for (const a of PLACE_IDS) {
      for (const b of PLACE_IDS) {
        const ab = pathToPlaceLength(a, b)
        const ba = pathToPlaceLength(b, a)
        expect(ab).toBeCloseTo(ba, 10)
      }
    }
  })

  it('breaks equal-cost ties without RNG (same path twice)', () => {
    const a = shortestPath(PLACES['home-a'].door, PLACES.market.door)
    const b = shortestPath(PLACES['home-a'].door, PLACES.market.door)
    expect(a).toEqual(b)
  })

  it('wobble polylines are identical for the same seed and shape id', () => {
    const a = wobblePolyline(42, 'b-market-n', 44, 4, 62, 4, 3, 0.6)
    const b = wobblePolyline(42, 'b-market-n', 44, 4, 62, 4, 3, 0.6)
    const c = wobblePolyline(42, 'b-market-s', 44, 4, 62, 4, 3, 0.6)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('spawns two minds at their home doors with starting stocks', () => {
    const state = createWorld(42)
    expect(state.tick).toBe(6 * 60)
    expect(state.minds[0].id).toBe('A')
    expect(state.minds[1].id).toBe('B')
    expect(state.minds[0].at).toBe('home-a')
    expect(state.minds[1].at).toBe('home-b')
    expect(state.minds[0].pos).toEqual(PLACES['home-a'].door)
    expect(state.minds[1].pos).toEqual(PLACES['home-b'].door)
    expect(state.fridges['home-a']).toBe(2)
    expect(state.fridges['home-b']).toBe(2)
    expect(state.minds[0].money).toBe(200)
  })
})

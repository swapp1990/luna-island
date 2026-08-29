import type { PlaceKind } from '../sim/types'
import { TILE_METRES } from './constants'

/** Island half-extent in metres for a world `width` tiles on a side. */
export function islandHalfMetres(width: number): number {
  return (width * TILE_METRES) / 2
}

/**
 * Sim tile (x, y) → world metres (x, z). Origin at the island centre so the
 * strategy camera's ±half clamps match the god shell. Scale is exactly ×3.
 */
export function tileToWorld(
  tx: number,
  ty: number,
  width: number,
  height: number,
): { x: number; z: number } {
  return {
    x: (tx - (width - 1) / 2) * TILE_METRES,
    z: (ty - (height - 1) / 2) * TILE_METRES,
  }
}

/** Inverse of `tileToWorld`. */
export function worldToTile(
  x: number,
  z: number,
  width: number,
  height: number,
): { tx: number; ty: number } {
  return {
    tx: x / TILE_METRES + (width - 1) / 2,
    ty: z / TILE_METRES + (height - 1) / 2,
  }
}

export function tilesToMetres(tiles: number): number {
  return tiles * TILE_METRES
}

export function metresToTiles(metres: number): number {
  return metres / TILE_METRES
}

/**
 * Placeholder footprint in tiles. Discrete 3×3 kinds match `spots.ts`;
 * others are the odd size covering `PLACE_RADIUS`.
 */
export function footprintTiles(kind: PlaceKind): { w: number; d: number } {
  switch (kind) {
    case 'home':
    case 'farm':
    case 'construction-site':
    case 'stall':
    case 'storehouse':
      return { w: 3, d: 3 }
    case 'plaza':
      return { w: 5, d: 5 }
    case 'well':
    case 'berry-bush':
    case 'forestry':
    case 'quarry':
    case 'notice-board':
      return { w: 2, d: 2 }
    case 'spring':
      return { w: 1, d: 1 }
  }
}

export function footprintMetres(kind: PlaceKind): { w: number; d: number } {
  const t = footprintTiles(kind)
  return { w: t.w * TILE_METRES, d: t.d * TILE_METRES }
}

/** Plausible metres of height for a placeholder; construction is half-height. */
export function placeholderHeight(kind: PlaceKind): number {
  switch (kind) {
    case 'home':
      return 6
    case 'storehouse':
      return 7
    case 'stall':
      return 3.2
    case 'well':
      return 2.2
    case 'farm':
      return 1.8
    case 'forestry':
      return 2.5
    case 'quarry':
      return 2.2
    case 'notice-board':
      return 2.4
    case 'berry-bush':
      return 1.6
    case 'spring':
      return 0.9
    case 'plaza':
      return 0.35
    case 'construction-site':
      return 3
  }
}

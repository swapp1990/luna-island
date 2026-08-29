/**
 * One source of truth for "how tall is the ground here" — terrain mesh,
 * buildings, and trees all sample this so nothing floats or buries. Pure
 * (no three.js), so it's directly unit-testable.
 *
 * V3: presentation-layer relief only. The sim's flat tile model is
 * untouched — this never feeds back into gameplay.
 */
import type { TerrainKind } from '../sim/types'
import { hashTile } from './hash'

/** Flat base Y per terrain kind, metres. Water sits below ground level. */
export const TILE_BASE_Y: Record<TerrainKind, number> = {
  water: -0.22,
  sand: 0.06,
  grass: 0.14,
  forest: 0.18,
  rock: 0.48,
}

/** Micro-relief amplitude cap, metres. */
export const RELIEF_AMPLITUDE = 0.15

const RELIEF_SALT = 0x51a7c0de

/**
 * Deterministic vertical-only noise for tile (tx, ty), in [-RELIEF_AMPLITUDE,
 * RELIEF_AMPLITUDE]. Always exactly 0 on water so the shoreline never gaps
 * against the water plane.
 */
export function terrainRelief(tx: number, ty: number, kind: TerrainKind): number {
  if (kind === 'water') return 0
  const h = hashTile(tx, ty, RELIEF_SALT) / 4294967296 // [0, 1)
  return (h * 2 - 1) * RELIEF_AMPLITUDE
}

/** Base + relief for tile (tx, ty) of kind `kind`. The single ground-height API. */
export function groundHeight(tx: number, ty: number, kind: TerrainKind): number {
  return TILE_BASE_Y[kind] + terrainRelief(tx, ty, kind)
}

/**
 * Pure tree-placement math for V2 — which forest tiles get trees, and the
 * deterministic per-tile jitter (variant/position/yaw/scale). No three.js,
 * so this is directly unit-testable; `trees.ts` turns it into InstancedMesh.
 */
import type { Place, PlaceKind, Tile, WorldState } from '../sim/types'
import { TILE_METRES } from './constants'
import { footprintTiles } from './coords'
import { hashTile, seededRng } from './hash'

const TREE_SALT = 0x7ee5a1

export interface TreeInstanceSpec {
  variant: 0 | 1 | 2
  /** Offset within the tile, metres, local to tile centre. */
  offsetX: number
  offsetZ: number
  yawDeg: number
  scale: number
}

/** 1–3 jittered instances for one forest tile, fully deterministic in (tx, ty). */
export function treesForTile(tx: number, ty: number): TreeInstanceSpec[] {
  const rng = seededRng(hashTile(tx, ty, TREE_SALT))
  const count = 1 + Math.floor(rng() * 3) // 1..3
  const out: TreeInstanceSpec[] = []
  for (let i = 0; i < count; i++) {
    const variant = Math.floor(rng() * 3) as 0 | 1 | 2
    const offsetX = (rng() - 0.5) * TILE_METRES * 0.8
    const offsetZ = (rng() - 0.5) * TILE_METRES * 0.8
    const yawDeg = rng() * 360
    const scale = 0.82 + rng() * 0.36 // ±18% jitter
    out.push({ variant, offsetX, offsetZ, yawDeg, scale })
  }
  return out
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`
}

/**
 * Tiles trees must never occupy: every place's footprint + a 1-tile buffer
 * around it, plus any wear/village path tile.
 */
export function buildTreeExclusionSet(
  places: ReadonlyArray<Pick<Place, 'x' | 'y' | 'kind'>>,
  pathTiles: ReadonlyArray<Pick<Tile, 'x' | 'y'>>,
): Set<string> {
  const set = new Set<string>()
  for (const p of places) {
    const fp = footprintTiles(p.kind as PlaceKind) // already in tile units
    const hw = Math.floor(fp.w / 2) + 1 // +1 tile buffer past the footprint edge
    const hd = Math.floor(fp.d / 2) + 1
    const cx = Math.round(p.x)
    const cy = Math.round(p.y)
    for (let dy = -hd; dy <= hd; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        set.add(tileKey(cx + dx, cy + dy))
      }
    }
  }
  for (const t of pathTiles) set.add(tileKey(t.x, t.y))
  return set
}

export function isTileExcluded(x: number, y: number, exclusion: ReadonlySet<string>): boolean {
  return exclusion.has(tileKey(x, y))
}

/**
 * True when the simulation's 3x3 construction footprint would cover a tree
 * that is actually present in the rendered forest. The town surface uses
 * this as an additional visual-clearance rule instead of allowing a valid
 * mechanical site to disappear inside static tree instances.
 */
export function prospectiveFootprintHitsTrees(world: WorldState, x: number, y: number): boolean {
  const exclusion = buildTreeExclusionSet(
    world.places,
    world.tiles.filter((tile) => tile.path),
  )
  const cx = Math.round(x)
  const cy = Math.round(y)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) continue
      const tile = world.tiles[ty * world.width + tx]
      if (tile?.kind !== 'forest' || isTileExcluded(tx, ty, exclusion)) continue
      if (treesForTile(tx, ty).length > 0) return true
    }
  }
  return false
}

/** A painted path is one tile wide, so its visual obstacle check is smaller. */
export function prospectivePathHitsTrees(world: WorldState, x: number, y: number): boolean {
  const tx = Math.round(x)
  const ty = Math.round(y)
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return false
  const tile = world.tiles[ty * world.width + tx]
  if (tile?.kind !== 'forest') return false
  const exclusion = buildTreeExclusionSet(
    world.places,
    world.tiles.filter((candidate) => candidate.path),
  )
  return !isTileExcluded(tx, ty, exclusion) && treesForTile(tx, ty).length > 0
}

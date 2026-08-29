import * as THREE from 'three'
import type { TerrainKind, WorldState } from '../sim/types'
import type { AssetCache } from './assets'
import { TILE_METRES } from './constants'
import type { AssetEntry } from './manifest'
import { decideYawDeg, footprintFitScale } from './placement'
import { groundHeight } from './terrainHeight'

/** Facing targets for V1: plaza centres + every wear/village-path tile. */
export function buildFacingCandidates(world: WorldState): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (const p of world.places) {
    if (p.kind === 'plaza') pts.push({ x: p.x, y: p.y })
  }
  for (const t of world.tiles) {
    if (t.path) pts.push({ x: t.x, y: t.y })
  }
  return pts
}

export interface FittedInstance {
  object: THREE.Object3D
  /** Uniform XZ-fit scale (before any stage-specific Y override). */
  scale: number
  yawDeg: number
  bounds: THREE.Box3
}

/**
 * V1: instantiate a manifest GLB scaled to fit its footprint (uniform, capped
 * at 1×), facing the nearest plaza/path tile (else a deterministic hash
 * yaw), and anchored to the terrain surface at the footprint centre.
 */
export function instantiateFitted(
  cache: AssetCache,
  entry: AssetEntry,
  placeId: string,
  tileX: number,
  tileY: number,
  footprintTilesWH: { w: number; d: number },
  tileKind: TerrainKind,
  facingCandidates: ReadonlyArray<{ x: number; y: number }>,
  /**
   * Extra cap (metres) from the nearest neighbouring place — the sim's tile
   * layout doesn't guarantee neighbours are spaced a full nominal footprint
   * apart, so the fit also respects real elbow room, not just the nominal
   * per-kind footprint table.
   */
  neighborCapM?: number,
): FittedInstance | null {
  const bounds = cache.bounds(entry.file)
  const obj = cache.instantiate(entry)
  if (!obj || !bounds) return null

  const nominalW = footprintTilesWH.w * TILE_METRES
  const nominalD = footprintTilesWH.d * TILE_METRES
  const footprintM = {
    w: neighborCapM !== undefined ? Math.min(nominalW, neighborCapM) : nominalW,
    d: neighborCapM !== undefined ? Math.min(nominalD, neighborCapM) : nominalD,
  }
  const size = { x: bounds.max.x - bounds.min.x, z: bounds.max.z - bounds.min.z }
  const scale = footprintFitScale(size, footprintM)
  const yawDeg = decideYawDeg(placeId, tileX, tileY, facingCandidates, 4)

  obj.scale.setScalar(scale)
  obj.rotation.y = THREE.MathUtils.degToRad(yawDeg)
  const groundY = groundHeight(tileX, tileY, tileKind)
  obj.position.y = groundY - bounds.min.y * scale

  return { object: obj, scale, yawDeg, bounds }
}

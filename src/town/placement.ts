/**
 * Pure placement math for V1 (footprint fit + facing). No three.js — bounds
 * and footprints come in as plain numbers so this is directly unit-testable.
 */
import { hashString } from './hash'

const CARDINALS = [0, 90, 180, 270] as const
export type CardinalYaw = (typeof CARDINALS)[number]

/**
 * Uniform scale so the asset's XZ bounds fit inside the place's footprint
 * (contain-fit on the tighter axis). Never upscales — small assets like the
 * well don't balloon past their real-world size.
 */
export function footprintFitScale(
  assetSize: { x: number; z: number },
  footprint: { w: number; d: number },
): number {
  const sx = footprint.w / Math.max(assetSize.x, 1e-6)
  const sz = footprint.d / Math.max(assetSize.z, 1e-6)
  return Math.min(1, sx, sz)
}

/** Deterministic cardinal yaw (deg) from a hash of the place id — same world, same look. */
export function fallbackYawDeg(placeId: string): CardinalYaw {
  const h = hashString(placeId, 0xfaced)
  return CARDINALS[h % 4]!
}

/** Snap an arbitrary direction (dx, dz) to the nearest of 0/90/180/270 facing it. */
export function snapYawTowardDeg(dx: number, dz: number): CardinalYaw {
  if (dx === 0 && dz === 0) return 0
  // three.js convention: rotation.y = 0 faces +Z (local forward -Z after PI flip
  // is asset-authoring dependent; what matters here is a stable, deterministic
  // mapping from direction to one of the four cardinals).
  const angle = (Math.atan2(dx, dz) * 180) / Math.PI // (-180, 180]
  const norm = ((angle % 360) + 360) % 360
  const idx = Math.round(norm / 90) % 4
  return CARDINALS[idx]!
}

export interface NearbyTarget {
  x: number
  y: number
  /** Manhattan-ish distance in tiles from the place. */
  dist: number
}

/**
 * Pick the nearest plaza/wear-path tile within `radiusTiles`, if any. Callers
 * pass in pre-filtered candidate tiles (plaza centres + path==true tiles);
 * this just does the nearest-within-radius selection deterministically
 * (ties broken by scan order, which callers make deterministic).
 */
export function nearestWithinRadius(
  fromX: number,
  fromY: number,
  candidates: ReadonlyArray<{ x: number; y: number }>,
  radiusTiles: number,
): NearbyTarget | null {
  let best: NearbyTarget | null = null
  for (const c of candidates) {
    const dx = c.x - fromX
    const dy = c.y - fromY
    const dist = Math.hypot(dx, dy)
    if (dist > radiusTiles) continue
    if (!best || dist < best.dist) best = { x: c.x, y: c.y, dist }
  }
  return best
}

/**
 * Full facing decision for a place: face the nearest plaza/wear-path tile
 * within a few tiles (snapped to cardinal), else a deterministic hash yaw.
 */
export function decideYawDeg(
  placeId: string,
  fromX: number,
  fromY: number,
  candidates: ReadonlyArray<{ x: number; y: number }>,
  radiusTiles: number,
): CardinalYaw {
  const target = nearestWithinRadius(fromX, fromY, candidates, radiusTiles)
  if (target) return snapYawTowardDeg(target.x - fromX, target.y - fromY)
  return fallbackYawDeg(placeId)
}

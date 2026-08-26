/**
 * Pure grip-pose math for the god hand. No three.js — unit-tested against
 * prop radius, then applied as joint Euler angles in `hand.ts`.
 *
 * Pose `t` is 0 = idle open (slight rest curl + splay) … 1 = closed around
 * the held prop. Closed joint angles are derived from the prop's radius, not
 * its kind: a pebble interpolates almost to a fist, a boulder stays wide.
 */
import { clamp } from './feel'

/** Rest curl (rad). Enough to kill the starfish; not a grip. */
export const IDLE_CURL = { mcp: 0.1, pip: 0.2, dip: 0.14 } as const

/** Near-fist curl (rad) used when wrapping a pebble-scale radius. */
export const FIST_CURL = { mcp: 0.88, pip: 1.12, dip: 0.72 } as const

/**
 * Wide wrap used when the held radius is boulder-scale. Still a *grip* —
 * slightly past idle — so the fingers read as holding, not hovering.
 */
export const WIDE_CURL = { mcp: 0.42, pip: 0.32, dip: 0.18 } as const

export const IDLE_THUMB = { cmc: 0.12, ip: 0.08, add: 0 } as const
export const FIST_THUMB = { cmc: 0.88, ip: 0.78, add: 0.38 } as const
export const WIDE_THUMB = { cmc: 0.28, ip: 0.18, add: 0.08 } as const

/** Index → little, radians of Y-splay at the finger root. */
export const IDLE_SPLAY = [-0.34, -0.1, 0.14, 0.4] as const
/** Adducted fist — gaps stay open on purpose. */
export const FIST_SPLAY = [-0.18, -0.04, 0.08, 0.24] as const
/** Abducted wrap around a boulder-scale sphere. */
export const WIDE_SPLAY = [-0.46, -0.14, 0.18, 0.5] as const

/** Radii (metres) that pin the close-factor ends. Between them, lerp. */
export const CLOSE_RADIUS_MIN = 0.08
export const CLOSE_RADIUS_MAX = 0.85

export interface JointCurl {
  mcp: number
  pip: number
  dip: number
}

export interface FingerPose extends JointCurl {
  splay: number
}

export interface ThumbPose {
  cmc: number
  ip: number
  add: number
}

export interface HandPose {
  fingers: FingerPose[]
  thumb: ThumbPose
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpCurl(a: JointCurl, b: JointCurl, t: number): JointCurl {
  return {
    mcp: lerp(a.mcp, b.mcp, t),
    pip: lerp(a.pip, b.pip, t),
    dip: lerp(a.dip, b.dip, t),
  }
}

/**
 * 1 = wrap as a fist (pebble-scale), 0 = wrap wide (boulder-scale).
 * Driven only by radius so a new prop size just works.
 */
export function radiusCloseFactor(radius: number): number {
  const r = Math.max(0, radius)
  return clamp(1 - (r - CLOSE_RADIUS_MIN) / (CLOSE_RADIUS_MAX - CLOSE_RADIUS_MIN), 0, 1)
}

/** Joint angles the fingers should sit at when pose t = 1 around `radius`. */
export function closedCurlForRadius(radius: number): JointCurl {
  return lerpCurl(WIDE_CURL, FIST_CURL, radiusCloseFactor(radius))
}

export function closedThumbForRadius(radius: number): ThumbPose {
  const f = radiusCloseFactor(radius)
  return {
    cmc: lerp(WIDE_THUMB.cmc, FIST_THUMB.cmc, f),
    ip: lerp(WIDE_THUMB.ip, FIST_THUMB.ip, f),
    add: lerp(WIDE_THUMB.add, FIST_THUMB.add, f),
  }
}

function closedSplayForRadius(radius: number, i: number): number {
  return lerp(WIDE_SPLAY[i]!, FIST_SPLAY[i]!, radiusCloseFactor(radius))
}

/**
 * Full pose at grip `t` ∈ [0, 1] around a sphere of `radius` metres
 * (the held prop's collider radius, or a stand-in when empty).
 */
export function handPoseAt(t: number, radius: number): HandPose {
  const k = clamp(t, 0, 1)
  const closed = closedCurlForRadius(radius)
  const fingers: FingerPose[] = IDLE_SPLAY.map((splay, i) => ({
    mcp: lerp(IDLE_CURL.mcp, closed.mcp, k),
    pip: lerp(IDLE_CURL.pip, closed.pip, k),
    dip: lerp(IDLE_CURL.dip, closed.dip, k),
    splay: lerp(splay, closedSplayForRadius(radius, i), k),
  }))
  const thumbClosed = closedThumbForRadius(radius)
  return {
    fingers,
    thumb: {
      cmc: lerp(IDLE_THUMB.cmc, thumbClosed.cmc, k),
      ip: lerp(IDLE_THUMB.ip, thumbClosed.ip, k),
      add: lerp(IDLE_THUMB.add, thumbClosed.add, k),
    },
  }
}

/** Default stand-in radius when posing a closed empty hand (rock-sized). */
export const EMPTY_CLOSED_RADIUS = 0.3

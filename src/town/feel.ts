/**
 * Pure camera feel helpers — clamps, damping, eye. Node-testable, no three.js.
 * Adapted from the parked god shell; hand/throw helpers are not carried over.
 */

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PAN_MARGIN,
  CAMERA_PITCH_MAX_DEG,
  CAMERA_PITCH_MIN_DEG,
  CAMERA_TARGET_Y,
  ISLAND_HALF,
} from './constants'

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

/** Framerate-independent exponential smoothing: `1 - exp(-k*dt)`. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (dt <= 0) return current
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function shortestAngleDeg(from: number, to: number): number {
  let d = (to - from) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export function dampAngleDeg(current: number, target: number, lambda: number, dt: number): number {
  return current + shortestAngleDeg(current, target) * (1 - Math.exp(-lambda * Math.max(0, dt)))
}

export interface CameraPose {
  yaw: number
  pitch: number
  dist: number
  tx: number
  tz: number
  /** Look-at height. Missing ⇒ CAMERA_TARGET_Y (town default). */
  ty?: number
}

/** Override the island-sized town clamps (gallery inspect uses a tight band). */
export interface CameraLimits {
  distMin: number
  distMax: number
  panLimit: number
  pitchMin: number
  pitchMax: number
}

const TOWN_LIMITS: CameraLimits = {
  distMin: CAMERA_DIST_MIN,
  distMax: CAMERA_DIST_MAX,
  panLimit: ISLAND_HALF + CAMERA_PAN_MARGIN,
  pitchMin: CAMERA_PITCH_MIN_DEG,
  pitchMax: CAMERA_PITCH_MAX_DEG,
}

export function lookY(pose: CameraPose): number {
  return pose.ty ?? CAMERA_TARGET_Y
}

export function clampPitchDeg(pitch: number, lim: CameraLimits = TOWN_LIMITS): number {
  return clamp(pitch, lim.pitchMin, lim.pitchMax)
}

export function clampDist(dist: number, lim: CameraLimits = TOWN_LIMITS): number {
  return clamp(dist, lim.distMin, lim.distMax)
}

export function clampTarget(
  tx: number,
  tz: number,
  lim: CameraLimits = TOWN_LIMITS,
): { tx: number; tz: number } {
  return { tx: clamp(tx, -lim.panLimit, lim.panLimit), tz: clamp(tz, -lim.panLimit, lim.panLimit) }
}

export function clampCamera(pose: CameraPose, lim: CameraLimits = TOWN_LIMITS): CameraPose {
  const t = clampTarget(pose.tx, pose.tz, lim)
  return {
    yaw: pose.yaw,
    pitch: clampPitchDeg(pose.pitch, lim),
    dist: clampDist(pose.dist, lim),
    tx: t.tx,
    tz: t.tz,
    ty: pose.ty,
  }
}

export function dampCamera(
  current: CameraPose,
  target: CameraPose,
  lambda: number,
  dt: number,
  lim: CameraLimits = TOWN_LIMITS,
): CameraPose {
  const t = clampCamera(target, lim)
  const panned = clampTarget(damp(current.tx, t.tx, lambda, dt), damp(current.tz, t.tz, lambda, dt), lim)
  const next: CameraPose = {
    yaw: dampAngleDeg(current.yaw, t.yaw, lambda, dt),
    pitch: clampPitchDeg(damp(current.pitch, t.pitch, lambda, dt), lim),
    dist: clampDist(damp(current.dist, t.dist, lambda, dt), lim),
    tx: panned.tx,
    tz: panned.tz,
  }
  if (t.ty !== undefined || current.ty !== undefined) {
    next.ty = damp(lookY(current), lookY(t), lambda, dt)
  }
  return next
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** World-space camera eye matching `camera.ts` applyPose (Y-up, yaw around Y). */
export function cameraEye(pose: CameraPose): Vec3 {
  const pitch = (pose.pitch * Math.PI) / 180
  const yaw = (pose.yaw * Math.PI) / 180
  const horiz = pose.dist * Math.cos(pitch)
  return {
    x: pose.tx + Math.sin(yaw) * horiz,
    y: lookY(pose) + pose.dist * Math.sin(pitch),
    z: pose.tz + Math.cos(yaw) * horiz,
  }
}

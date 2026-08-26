/**
 * Pure feel helpers — throw transfer, camera clamps/damping, hand lift.
 * Importable from node tests without three.js or rapier.
 */

import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_FOV,
  CAMERA_PAN_MARGIN,
  CAMERA_PITCH_MAX_DEG,
  CAMERA_PITCH_MIN_DEG,
  CAMERA_TARGET_Y,
  HAND_LIFT_MAX,
  HAND_LIFT_MIN,
  HAND_LIFT_PER_DELTA,
  HAND_MESH_TOP,
  HAND_SCALE_DIST,
  HAND_SCALE_MAX,
  ISLAND_HALF,
  THROW_DROP_SPEED,
  THROW_MASS_EXP,
  THROW_MAX_TRANSFER,
  THROW_MIN_TRANSFER,
  THROW_TRANSFER,
  VIEW_MARGIN,
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

export function throwTransfer(mass: number): number {
  const m = Math.max(mass, 1e-6)
  return clamp(THROW_TRANSFER / Math.pow(m, THROW_MASS_EXP), THROW_MIN_TRANSFER, THROW_MAX_TRANSFER)
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export function vecLen(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

/**
 * Mass-dependent release velocity. Sub-threshold hand speed yields exactly
 * zero added velocity so a still hand is a drop, not a weak throw.
 */
export function releaseVelocity(handVel: Vec3, mass: number): Vec3 {
  const speed = vecLen(handVel)
  if (speed < THROW_DROP_SPEED) return { x: 0, y: 0, z: 0 }
  const t = throwTransfer(mass)
  return { x: handVel.x * t, y: handVel.y * t, z: handVel.z * t }
}

export interface CameraPose {
  yaw: number
  pitch: number
  dist: number
  tx: number
  tz: number
}

export function clampPitchDeg(pitch: number): number {
  return clamp(pitch, CAMERA_PITCH_MIN_DEG, CAMERA_PITCH_MAX_DEG)
}

export function clampDist(dist: number): number {
  return clamp(dist, CAMERA_DIST_MIN, CAMERA_DIST_MAX)
}

export function clampTarget(tx: number, tz: number): { tx: number; tz: number } {
  const lim = ISLAND_HALF + CAMERA_PAN_MARGIN
  return { tx: clamp(tx, -lim, lim), tz: clamp(tz, -lim, lim) }
}

export function clampCamera(pose: CameraPose): CameraPose {
  const t = clampTarget(pose.tx, pose.tz)
  return {
    yaw: pose.yaw,
    pitch: clampPitchDeg(pose.pitch),
    dist: clampDist(pose.dist),
    tx: t.tx,
    tz: t.tz,
  }
}

export function dampCamera(current: CameraPose, target: CameraPose, lambda: number, dt: number): CameraPose {
  const t = clampCamera(target)
  const panned = clampTarget(
    damp(current.tx, t.tx, lambda, dt),
    damp(current.tz, t.tz, lambda, dt),
  )
  return {
    yaw: dampAngleDeg(current.yaw, t.yaw, lambda, dt),
    pitch: clampPitchDeg(damp(current.pitch, t.pitch, lambda, dt)),
    dist: clampDist(damp(current.dist, t.dist, lambda, dt)),
    tx: panned.tx,
    tz: panned.tz,
  }
}

export function accumulateLift(lift: number, wheelDeltaY: number, maxLift: number = HAND_LIFT_MAX): number {
  const hi = Math.min(HAND_LIFT_MAX, Math.max(HAND_LIFT_MIN, maxLift))
  return clamp(lift + wheelDeltaY * HAND_LIFT_PER_DELTA, HAND_LIFT_MIN, hi)
}

export function clampLift(lift: number, maxLift: number = HAND_LIFT_MAX): number {
  const hi = Math.min(HAND_LIFT_MAX, Math.max(HAND_LIFT_MIN, maxLift))
  return clamp(lift, HAND_LIFT_MIN, hi)
}

/**
 * World-space camera eye matching `camera.ts` applyPose (Y-up, yaw around Y,
 * pitch from the horizon). Pure so tests can project without three.js.
 */
export function cameraEye(pose: CameraPose): Vec3 {
  const pitch = (pose.pitch * Math.PI) / 180
  const yaw = (pose.yaw * Math.PI) / 180
  const horiz = pose.dist * Math.cos(pitch)
  return {
    x: pose.tx + Math.sin(yaw) * horiz,
    y: CAMERA_TARGET_Y + pose.dist * Math.sin(pitch),
    z: pose.tz + Math.cos(yaw) * horiz,
  }
}

export interface NdcPoint {
  x: number
  y: number
  /** True when the point is behind the camera near plane. */
  behind: boolean
}

/** Distance-compensated hand scale matching `hand.ts`. */
export function handScale(camDist: number): number {
  return clamp(camDist / HAND_SCALE_DIST, 1, HAND_SCALE_MAX)
}

/**
 * Metres of drawn hand (mesh top × scale, plus held radius) above the group
 * origin. Camera yield and the lift ceiling both key off this, not the grip.
 */
export function handBoundsLift(camDist: number, heldRadius: number = 0): number {
  return HAND_MESH_TOP * handScale(camDist) + Math.max(0, heldRadius)
}

/** World point at the top of what is drawn for this hand. */
export function handFramePoint(origin: Vec3, camDist: number, heldRadius: number = 0): Vec3 {
  return { x: origin.x, y: origin.y + handBoundsLift(camDist, heldRadius), z: origin.z }
}

/**
 * Project a world point to NDC using the same lookAt + perspective the
 * strategy camera uses (three.js world matrix, WebGL clip). Independent of
 * near/far for x/y. Used to keep the hand bounds on screen — the hand is the phase.
 */
export function projectToNdc(
  world: Vec3,
  pose: CameraPose,
  aspect: number,
  fovDeg: number = CAMERA_FOV,
): NdcPoint {
  const eye = cameraEye(pose)
  const tx = pose.tx
  const ty = CAMERA_TARGET_Y
  const tz = pose.tz
  let zx = eye.x - tx
  let zy = eye.y - ty
  let zz = eye.z - tz
  const zlen = Math.hypot(zx, zy, zz) || 1
  zx /= zlen
  zy /= zlen
  zz /= zlen
  // x = up × z
  let xx = zz
  let xy = 0
  let xz = -zx
  const xlen = Math.hypot(xx, xy, xz) || 1
  xx /= xlen
  xy /= xlen
  xz /= xlen
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  const px = world.x - eye.x
  const py = world.y - eye.y
  const pz = world.z - eye.z
  const camX = xx * px + xy * py + xz * pz
  const camY = yx * px + yy * py + yz * pz
  const camZ = zx * px + zy * py + zz * pz

  const fov = (fovDeg * Math.PI) / 180
  const sy = 1 / Math.tan(fov / 2)
  const sx = sy / Math.max(1e-6, aspect)
  const w = -camZ
  if (w <= 1e-6) return { x: 0, y: 0, behind: true }
  return { x: (sx * camX) / w, y: (sy * camY) / w, behind: camZ >= 0 }
}

export function ndcInView(p: NdcPoint, margin: number = VIEW_MARGIN): boolean {
  if (p.behind) return false
  const lim = 1 - margin
  return Math.abs(p.x) <= lim && Math.abs(p.y) <= lim
}

/**
 * Nudge dist (then pitch) just enough that `point` (the hand's drawn top)
 * sits inside the viewport. Used when lift already sits at the frustum
 * ceiling and the point is still out — typically a high hill under a close,
 * shallow camera. Returns the original pose when nothing is needed. Never
 * leaves the legal band.
 */
export function yieldCameraToGrip(
  pose: CameraPose,
  grip: Vec3,
  aspect: number,
  margin: number = VIEW_MARGIN,
): CameraPose {
  const boxed = clampCamera(pose)
  if (ndcInView(projectToNdc(grip, boxed, aspect), margin)) return boxed

  const tryPose = (dist: number, pitch: number): boolean =>
    ndcInView(projectToNdc(grip, { ...boxed, dist, pitch }, aspect), margin)

  let dist = boxed.dist
  if (!tryPose(CAMERA_DIST_MAX, boxed.pitch)) {
    dist = CAMERA_DIST_MAX
  } else {
    let lo = boxed.dist
    let hi = CAMERA_DIST_MAX
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) * 0.5
      if (tryPose(mid, boxed.pitch)) hi = mid
      else lo = mid
    }
    dist = hi
  }
  let pitch = boxed.pitch
  if (!tryPose(dist, boxed.pitch)) {
    if (tryPose(dist, CAMERA_PITCH_MAX_DEG)) {
      let lo = boxed.pitch
      let hi = CAMERA_PITCH_MAX_DEG
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) * 0.5
        if (tryPose(dist, mid)) hi = mid
        else lo = mid
      }
      pitch = hi
    } else {
      pitch = CAMERA_PITCH_MAX_DEG
      dist = CAMERA_DIST_MAX
    }
  }
  return clampCamera({ ...boxed, dist, pitch })
}

/**
 * Highest lift (metres above `groundY`) at which the hand *bounds* at (x, z)
 * stay inside the viewport with `margin`. `extraY` is the drawn top above the
 * group origin (mesh × scale + held radius). Absolute cap remains HAND_LIFT_MAX.
 *
 * World rule: usable lift is whatever the current frustum can actually
 * contain. Zoom out to reach higher; zoom in and the hand lowers. The camera
 * pitch band is left alone so later assets keep a fixed elevation.
 */
export function usableLiftMax(
  pose: CameraPose,
  groundY: number,
  x: number,
  z: number,
  aspect: number,
  margin: number = VIEW_MARGIN,
  extraY: number = 0,
): number {
  const inView = (lift: number): boolean => {
    const top = { x, y: groundY + lift + extraY, z }
    const framed = yieldCameraToGrip(pose, top, aspect, margin)
    return ndcInView(projectToNdc(top, framed, aspect), margin)
  }
  if (!inView(HAND_LIFT_MIN)) return HAND_LIFT_MIN
  if (inView(HAND_LIFT_MAX)) return HAND_LIFT_MAX
  let lo = HAND_LIFT_MIN
  let hi = HAND_LIFT_MAX
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5
    if (inView(mid)) lo = mid
    else hi = mid
  }
  return lo
}

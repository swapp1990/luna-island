import * as THREE from 'three'
import {
  GRAB_OMEGA,
  GREY_HAND,
  HAND_FORCE_MAX,
  HAND_GRAB_RADIUS,
  HAND_GRIP_LOCAL_Y,
  HAND_HOVER_HEIGHT,
  HAND_HOVER_HYSTERESIS,
  HAND_LIFT_MAX,
  HAND_SCALE_DIST,
  HAND_SCALE_MAX,
  VIEW_MARGIN,
  HELD_ANGULAR_DAMPING,
  MEADOW,
  THROW_HISTORY_S,
  THROW_SPIN,
} from './constants'
import {
  accumulateLift,
  clamp,
  clampLift,
  handBoundsLift,
  handFramePoint,
  releaseVelocity,
  usableLiftMax,
  vecLen,
  type CameraPose,
} from './feel'
import {
  EMPTY_CLOSED_RADIUS,
  handPoseAt,
} from './handPose'
import type { IslandHandle } from './island'
import type { Prop, PropsHandle } from './props'

export type HandMode = 'idle' | 'hover' | 'carry'

export interface HandState {
  x: number
  y: number
  z: number
  lift: number
  state: HandMode
  hoverId: string | null
  heldId: string | null
}

export interface HandHandle {
  group: THREE.Group
  getState: () => HandState
  lift: () => number
  holding: () => Prop | null
  /** Drawn top of the hand (group origin + mesh extent + held radius). */
  framePoint: () => { x: number; y: number; z: number }
  moveTo: (x: number, z: number, lift?: number) => void
  grabNearest: (kind?: string) => string | null
  release: () => void
  throwTo: (x: number, z: number, power?: number) => void
  throwWithHandVelocity: (
    vx: number,
    vy: number,
    vz: number,
  ) => { kind: string; mass: number; handSpeed: number; releaseSpeed: number } | null
  applyCarry: () => void
  onWheel: (deltaY: number, shift: boolean) => boolean
  bind: (el: HTMLElement, camera: THREE.Camera, island: IslandHandle) => () => void
  update: (
    dt: number,
    now: number,
    island: IslandHandle,
    props: PropsHandle,
    camera: THREE.Camera,
    pose: CameraPose,
  ) => void
  /** DEV: force the grip pose 0 (open) → 1 (closed). null returns to live state. */
  setHandPose: (t: number | null) => void
  counters: { grabs: number; throws: number }
  dispose: () => void
}

interface Sample {
  t: number
  x: number
  y: number
  z: number
}

interface Bone {
  joint: THREE.Object3D
  tip: THREE.Object3D
}

interface Digit {
  root: THREE.Object3D
  bones: Bone[]
}

const PALM_LEN = 1.12
const PALM_KN_W = 1.28
const PALM_WR_W = 0.76
const PALM_HEEL_T = 0.3
const PALM_TIP_T = 0.16
const PALM_CUP = 0.09
const WRIST_LEN = 0.52
const WRIST_END_W = 0.5

const FINGER_DEFS = [
  { lens: [0.44, 0.33, 0.26], radii: [0.15, 0.132, 0.112], x: -0.48, y: 0.07, z: 0.5 },
  { lens: [0.5, 0.38, 0.28], radii: [0.156, 0.138, 0.116], x: -0.16, y: 0.08, z: 0.54 },
  { lens: [0.46, 0.34, 0.25], radii: [0.148, 0.13, 0.11], x: 0.16, y: 0.07, z: 0.5 },
  { lens: [0.34, 0.25, 0.18], radii: [0.122, 0.108, 0.092], x: 0.48, y: 0.04, z: 0.34 },
] as const

const THUMB_DEF = {
  lens: [0.42, 0.34],
  radii: [0.168, 0.142],
  x: -0.62,
  y: 0.08,
  z: -0.04,
} as const

const POSE_CLOSE_K = 14
const POSE_OPEN_K = 52

function setEmissive(obj: THREE.Object3D, color: number, intensity: number) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined
    if (mat && 'emissive' in mat) {
      mat.emissive.setHex(color)
      mat.emissiveIntensity = intensity
    }
  })
}

function trackGeo(geos: THREE.BufferGeometry[], geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geos.push(geo)
  return geo
}

function geoTris(geo: THREE.BufferGeometry): number {
  const idx = geo.getIndex()
  if (idx) return idx.count / 3
  return geo.getAttribute('position').count / 3
}

/** Flattened tapered wrist stub — arm direction, not a pipe or a brick. */
function makeWristGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(WRIST_END_W * 0.5, PALM_WR_W * 0.5, WRIST_LEN, 8)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position!
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.58)
  }
  geo.computeVertexNormals()
  return geo
}

/** Tapered, cupped palm slab. Wider at the knuckles, thicker at the heel. */
function makePalmGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1, 7, 2, 9)
  const pos = geo.attributes.position!
  for (let i = 0; i < pos.count; i++) {
    const x0 = pos.getX(i)
    const y0 = pos.getY(i)
    const z0 = pos.getZ(i)
    const v = z0 + 0.5
    const width = PALM_WR_W + (PALM_KN_W - PALM_WR_W) * v
    const thick = PALM_HEEL_T + (PALM_TIP_T - PALM_HEEL_T) * v
    const cup =
      PALM_CUP * Math.cos(Math.min(1, Math.abs(x0) * 2) * Math.PI * 0.5) * Math.sin(Math.PI * v)
    const corner = Math.abs(x0) * 2 * Math.abs(z0) * 2
    let x = x0 * width * (1 - 0.14 * corner)
    let y = y0 * thick * (1 - 0.1 * Math.abs(x0) * 2) - (y0 > 0 ? cup : cup * 0.22)
    const z = z0 * PALM_LEN + (1 - (x0 * 2) * (x0 * 2)) * v * 0.05
    // Thenar bulge on the radial/proximal corner so the thumb has somewhere to sit.
    if (x0 < 0 && v < 0.55) {
      const thenar = (1 - v / 0.55) * -x0 * 2
      x -= thenar * 0.12
      y += thenar * 0.04
    }
    pos.setXYZ(i, x, y, z)
  }
  geo.computeVertexNormals()
  return geo
}

function makeBone(
  parent: THREE.Object3D,
  len: number,
  radius: number,
  tipRadius: number,
  mat: THREE.Material,
  geos: THREE.BufferGeometry[],
): Bone {
  const joint = new THREE.Object3D()
  parent.add(joint)
  const knuckle = new THREE.Mesh(trackGeo(geos, new THREE.SphereGeometry(radius * 1.08, 7, 5)), mat)
  knuckle.castShadow = false
  joint.add(knuckle)
  const midR = (radius + tipRadius) * 0.5
  const cylLen = Math.max(0.04, len - midR * 0.9)
  const cap = new THREE.Mesh(trackGeo(geos, new THREE.CapsuleGeometry(midR, cylLen, 3, 7)), mat)
  cap.rotation.x = Math.PI / 2
  cap.position.z = len * 0.5
  cap.castShadow = false
  joint.add(cap)
  const tip = new THREE.Object3D()
  tip.position.z = len
  joint.add(tip)
  return { joint, tip }
}

function makeDigit(
  parent: THREE.Object3D,
  def: { lens: readonly number[]; radii: readonly number[]; x: number; y: number; z: number },
  mat: THREE.Material,
  geos: THREE.BufferGeometry[],
): Digit {
  const root = new THREE.Object3D()
  root.position.set(def.x, def.y, def.z)
  parent.add(root)
  const bones: Bone[] = []
  let attach: THREE.Object3D = root
  for (let i = 0; i < def.lens.length; i++) {
    const r0 = def.radii[i]!
    const r1 = def.radii[i + 1] ?? r0 * 0.88
    const bone = makeBone(attach, def.lens[i]!, r0, r1, mat, geos)
    bones.push(bone)
    attach = bone.tip
  }
  return { root, bones }
}

export function createHand(scene: THREE.Scene): HandHandle {
  const group = new THREE.Group()
  group.name = 'god-hand'
  const mat = new THREE.MeshStandardMaterial({
    color: GREY_HAND,
    roughness: 0.5,
    metalness: 0.04,
  })
  const geos: THREE.BufferGeometry[] = []

  const palmRoot = new THREE.Object3D()
  palmRoot.name = 'palm'
  group.add(palmRoot)

  const palm = new THREE.Mesh(trackGeo(geos, makePalmGeometry()), mat)
  palm.castShadow = false
  palmRoot.add(palm)

  const wrist = new THREE.Mesh(trackGeo(geos, makeWristGeometry()), mat)
  wrist.castShadow = false
  wrist.position.z = -(PALM_LEN * 0.5) - WRIST_LEN * 0.42
  palmRoot.add(wrist)

  const fingers: Digit[] = FINGER_DEFS.map((def) => makeDigit(palmRoot, def, mat, geos))
  const thumb = makeDigit(palmRoot, THUMB_DEF, mat, geos)
  // Opposed ~56° off the palm plane, aimed toward the fingers — not a fifth digit.
  thumb.root.rotation.order = 'ZYX'
  thumb.root.rotation.z = 1.05
  thumb.root.rotation.y = 0.42
  thumb.root.rotation.x = 0.12

  let triCount = 0
  for (const g of geos) triCount += geoTris(g)
  group.userData.triangleCount = triCount

  // Geometry lies in XZ facing +Y so aligning local Y to the terrain normal
  // keeps a closed ring on the ground (a XY ring mapped that way stood on edge
  // and read as a 180° arc).
  const ringGeo = new THREE.RingGeometry(0.72, 1.12, 40)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xc4c6cc,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = 2
  scene.add(ring)

  const stalkGeo = new THREE.CylinderGeometry(1, 1, 1, 8)
  const stalkMat = new THREE.MeshBasicMaterial({
    color: 0xb0b3ba,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const stalk = new THREE.Mesh(stalkGeo, stalkMat)
  stalk.renderOrder = 2
  scene.add(stalk)

  const blobGeo = new THREE.CircleGeometry(1, 22)
  blobGeo.rotateX(-Math.PI / 2)
  const blobMat = new THREE.MeshBasicMaterial({
    color: 0x5c5e62,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  })
  const blob = new THREE.Mesh(blobGeo, blobMat)
  blob.renderOrder = 1
  scene.add(blob)

  group.traverse((o) => {
    o.raycast = () => {}
  })
  scene.add(group)

  const ndc = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hit = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const look = new THREE.Quaternion()
  const tmpN = new THREE.Vector3()

  let groundX: number = MEADOW.x
  let groundZ: number = MEADOW.z
  let lift = HAND_HOVER_HEIGHT
  let hoverId: string | null = null
  let heldId: string | null = null
  let pose = 0
  let poseTarget = 0
  let poseOverride: number | null = null
  let scripted = false
  let pointerX = 0
  let pointerY = 0
  const history: Sample[] = []
  const counters = { grabs: 0, throws: 0 }
  let held: Prop | null = null
  let lastProps: PropsHandle | null = null
  let lastIsland: IslandHandle | null = null
  let lastPose: CameraPose | null = null
  let lastAspect = 16 / 9
  let lastCamDist = 42
  const gripLocal = new THREE.Vector3(0, HAND_GRIP_LOCAL_Y, 0.06)
  const gripWorld = new THREE.Vector3()

  const gripT = () => (poseOverride !== null ? poseOverride : pose)

  const poseRig = () => {
    const radius = held?.radius ?? EMPTY_CLOSED_RADIUS
    const p = handPoseAt(gripT(), radius)
    for (let i = 0; i < fingers.length; i++) {
      const d = fingers[i]!
      const a = p.fingers[i]!
      d.root.rotation.y = a.splay
      d.bones[0]!.joint.rotation.x = -a.mcp
      d.bones[1]!.joint.rotation.x = -a.pip
      d.bones[2]!.joint.rotation.x = -a.dip
    }
    const th = p.thumb
    thumb.bones[0]!.joint.rotation.x = -th.cmc
    thumb.bones[0]!.joint.rotation.y = th.add
    thumb.bones[1]!.joint.rotation.x = -th.ip
  }

  const grip = () => {
    gripWorld.copy(gripLocal).applyQuaternion(group.quaternion).add(group.position)
    return { x: gripWorld.x, y: gripWorld.y, z: gripWorld.z }
  }

  const framePoint = () =>
    handFramePoint(
      { x: group.position.x, y: group.position.y, z: group.position.z },
      lastCamDist,
      held?.radius ?? 0,
    )

  const liftCeiling = (island: IslandHandle, pose: CameraPose, aspect: number): number => {
    const gy = island.heightAt(groundX, groundZ)
    const extra = handBoundsLift(lastCamDist, held?.radius ?? 0)
    return usableLiftMax(pose, gy, groundX, groundZ, aspect, VIEW_MARGIN, extra)
  }

  const projectPointer = (camera: THREE.Camera, island: IslandHandle, el: HTMLElement) => {
    if (scripted) return
    const rect = el.getBoundingClientRect()
    ndc.x = ((pointerX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((pointerY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObject(island.mesh, false)
    if (hits[0]) {
      groundX = hits[0].point.x
      groundZ = hits[0].point.z
    } else if (raycaster.ray.intersectPlane(plane, hit)) {
      groundX = hit.x
      groundZ = hit.z
    }
  }

  const placeHand = (island: IslandHandle, dt: number) => {
    const n = island.normalAt(groundX, groundZ)
    const gy = island.heightAt(groundX, groundZ)
    const y = gy + lift
    group.position.set(groundX, y, groundZ)
    tmpN.set(n.x, n.y, n.z)
    const q = new THREE.Quaternion().setFromUnitVectors(up, tmpN)
    look.slerp(q, 1 - Math.exp(-8 * dt))
    group.quaternion.copy(look)

    poseRig()

    const vis = clamp(lastCamDist / HAND_SCALE_DIST, 1, HAND_SCALE_MAX)
    group.scale.setScalar(vis)

    ring.position.set(groundX, gy + 0.045, groundZ)
    tmpN.set(n.x, n.y, n.z)
    ring.quaternion.setFromUnitVectors(up, tmpN)
    const ringS = clamp(lastCamDist * 0.028, 0.85, 2.8)
    ring.scale.set(ringS, 1, ringS)
    const lifted = lift - HAND_HOVER_HEIGHT
    ringMat.opacity = heldId ? 0.72 : 0.3 + Math.min(0.4, Math.abs(lifted) * 0.12)

    const stalkH = Math.max(0.05, y - gy)
    const stalkR = clamp(lastCamDist * 0.0036, 0.055, 0.3)
    stalk.visible = stalkH > 0.55
    stalk.position.set(groundX, gy + stalkH * 0.5, groundZ)
    stalk.scale.set(stalkR, stalkH, stalkR)
    stalkMat.opacity = THREE.MathUtils.clamp((stalkH - 0.55) / 3.2, 0, 0.5)

    blob.position.set(groundX, gy + 0.03, groundZ)
    blob.quaternion.setFromUnitVectors(up, tmpN)
    const blobS = (0.85 + lift * 0.16) * (ringS * 0.55)
    blob.scale.set(blobS, 1, blobS)
    blobMat.opacity = 0.24 / (1 + Math.max(0, lift - 0.4) * 0.38)
  }

  const pickHover = (props: PropsHandle): Prop | null => {
    const g = grip()
    const reach = HAND_GRAB_RADIUS
    let best: Prop | null = null
    let bestD = reach
    if (hoverId) {
      const cur = props.get(hoverId)
      if (cur) {
        const p = cur.currPos
        const d = Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z) - cur.radius
        if (d < reach + HAND_HOVER_HYSTERESIS) {
          best = cur
          bestD = d
        }
      }
    }
    for (const p of props.list()) {
      if (heldId && p.id === heldId) continue
      const pos = p.currPos
      const d = Math.hypot(pos.x - g.x, pos.y - g.y, pos.z - g.z) - p.radius
      if (d < bestD - 0.04 || (best && d < bestD && p.id < best.id && Math.abs(d - bestD) < 0.08)) {
        if (d < reach) {
          best = p
          bestD = d
        }
      }
    }
    return best
  }

  const highlight = (props: PropsHandle, id: string | null) => {
    if (hoverId && hoverId !== id) {
      const prev = props.get(hoverId)
      if (prev) setEmissive(prev.mesh, 0x000000, 0)
    }
    hoverId = id
    if (id) {
      const p = props.get(id)
      if (p) setEmissive(p.mesh, 0xf2f4f8, 0.85)
    }
  }

  const grabProp = (prop: Prop) => {
    held = prop
    heldId = prop.id
    counters.grabs += 1
    poseTarget = 1
    prop.body.setAngularDamping(HELD_ANGULAR_DAMPING)
    prop.body.wakeUp()
    if (lastProps && hoverId && hoverId !== prop.id) {
      const prev = lastProps.get(hoverId)
      if (prev) setEmissive(prev.mesh, 0x000000, 0)
    }
    hoverId = null
    setEmissive(prop.mesh, 0x000000, 0)
  }

  const velocityFromHistory = (now: number) => {
    const g = grip()
    let oldest = history[0]
    for (const s of history) {
      if (now - s.t <= THROW_HISTORY_S) {
        oldest = s
        break
      }
    }
    if (!oldest) return { x: 0, y: 0, z: 0 }
    const dt = Math.max(1 / 120, now - oldest.t)
    return {
      x: (g.x - oldest.x) / dt,
      y: (g.y - oldest.y) / dt,
      z: (g.z - oldest.z) / dt,
    }
  }

  const releaseWith = (vel: { x: number; y: number; z: number }, spinFrom?: { x: number; y: number; z: number }) => {
    if (!held) return
    const prop = held
    const added = vecLen(vel) > 0
    if (added) counters.throws += 1
    prop.body.resetForces(true)
    prop.body.setLinvel(vel, true)
    const hv = spinFrom ?? vel
    prop.body.setAngvel(
      {
        x: hv.z * THROW_SPIN,
        y: hv.x * 0.15,
        z: -hv.x * THROW_SPIN,
      },
      true,
    )
    prop.body.setAngularDamping(prop.restAngDamp)
    held = null
    heldId = null
    // Snap open on the same frame the prop leaves — not a slow lerp.
    poseTarget = 0
    if (poseOverride === null) {
      pose = 0
      poseRig()
    }
  }

  const release = () => {
    if (!held) return
    const now = history.length ? history[history.length - 1]!.t : 0
    const hv = velocityFromHistory(now)
    const vel = releaseVelocity(hv, held.mass)
    releaseWith(vel, hv)
  }

  const grabNearest = (kind?: string): string | null => {
    const g = grip()
    let best: Prop | null = null
    let bestD = Infinity
    const propsRef = lastProps
    if (!propsRef) return null
    for (const p of propsRef.list()) {
      if (kind && p.kind !== kind) continue
      const d = Math.hypot(p.currPos.x - g.x, p.currPos.y - g.y, p.currPos.z - g.z)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    if (!best) return null
    if (held) release()
    grabProp(best)
    return best.id
  }

  /**
   * Ballistic solve for tests/aiming — bypasses releaseVelocity / the mass
   * curve. Use throwWithHandVelocity to exercise the real player path.
   */
  const throwTo = (x: number, z: number, power = 1) => {
    if (!held) grabNearest()
    if (!held || !lastIsland) return
    const p = held.body.translation()
    const destY = lastIsland.heightAt(x, z) + held.radius
    const dx = x - p.x
    const dz = z - p.z
    const dy = destY - p.y
    const dist = Math.hypot(dx, dz)
    const t = Math.min(2.5, Math.max(0.4, 0.5 + dist / (16 * Math.max(0.35, power))))
    const vx = dx / t
    const vz = dz / t
    const vy = dy / t + 4.905 * t
    releaseWith({ x: vx, y: vy, z: vz }, { x: vx, y: vy, z: vz })
  }

  /** Release the held prop through the REAL player path: releaseVelocity(handVel, mass). */
  const throwWithHandVelocity = (vx: number, vy: number, vz: number) => {
    if (!held) return null
    const kind = held.kind
    const mass = held.mass
    const hv = { x: vx, y: vy, z: vz }
    const handSpeed = vecLen(hv)
    const vel = releaseVelocity(hv, mass)
    const releaseSpeed = vecLen(vel)
    releaseWith(vel, hv)
    return { kind, mass, handSpeed, releaseSpeed }
  }

  const applyCarry = () => {
    if (!held) return
    const g = grip()
    const body = held.body
    body.resetForces(true)
    const pos = body.translation()
    const vel = body.linvel()
    const w = GRAB_OMEGA
    const ax = w * w * (g.x - pos.x) - 2 * w * vel.x
    const ay = w * w * (g.y - pos.y) - 2 * w * vel.y
    const az = w * w * (g.z - pos.z) - 2 * w * vel.z
    let fx = held.mass * ax
    let fy = held.mass * ay
    let fz = held.mass * az
    const flen = Math.hypot(fx, fy, fz)
    if (flen > HAND_FORCE_MAX) {
      const s = HAND_FORCE_MAX / flen
      fx *= s
      fy *= s
      fz *= s
    }
    body.addForce({ x: fx, y: fy, z: fz }, true)
    body.setAngularDamping(HELD_ANGULAR_DAMPING)
  }

  const onWheel = (deltaY: number, shift: boolean): boolean => {
    if (held && !shift) {
      const maxL =
        lastPose && lastIsland ? liftCeiling(lastIsland, lastPose, lastAspect) : HAND_LIFT_MAX
      lift = accumulateLift(lift, deltaY, maxL)
      return true
    }
    return false
  }

  const moveTo = (x: number, z: number, nextLift?: number) => {
    scripted = true
    groundX = x
    groundZ = z
    if (nextLift !== undefined) {
      // Debug teleport: honour the requested lift (absolute cap only). Player
      // wheel still uses the frustum+yield ceiling; the camera yields to frame it.
      lift = clampLift(nextLift, HAND_LIFT_MAX)
    }
    if (lastIsland) placeHand(lastIsland, 1 / 60)
  }

  const setHandPose = (t: number | null) => {
    if (t === null) {
      poseOverride = null
    } else {
      poseOverride = clamp(t, 0, 1)
      pose = poseOverride
    }
    poseRig()
  }

  const bind = (el: HTMLElement, camera: THREE.Camera, island: IslandHandle): (() => void) => {
    el.style.cursor = 'none'
    const onMove = (e: PointerEvent) => {
      if (scripted && (e.movementX !== 0 || e.movementY !== 0)) scripted = false
      pointerX = e.clientX
      pointerY = e.clientY
      if (!scripted) projectPointer(camera, island, el)
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      pointerX = e.clientX
      pointerY = e.clientY
      if (!scripted) projectPointer(camera, island, el)
      if (lastProps) {
        const target = pickHover(lastProps)
        if (target) grabProp(target)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      release()
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }

  const update = (
    dt: number,
    now: number,
    island: IslandHandle,
    props: PropsHandle,
    camera: THREE.Camera,
    camPose: CameraPose,
  ) => {
    lastProps = props
    lastIsland = island
    lastPose = camPose
    lastAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : lastAspect
    lastCamDist = camera.position.distanceTo(group.position)
    if (held) {
      lift = clampLift(lift, liftCeiling(island, camPose, lastAspect))
    } else {
      lift += (HAND_HOVER_HEIGHT - lift) * (1 - Math.exp(-6 * dt))
    }

    if (poseOverride === null) {
      const k = poseTarget < pose - 0.02 ? POSE_OPEN_K : POSE_CLOSE_K
      pose += (poseTarget - pose) * (1 - Math.exp(-k * dt))
    }

    placeHand(island, dt)

    const g = grip()
    history.push({ t: now, x: g.x, y: g.y, z: g.z })
    while (history.length && now - history[0]!.t > THROW_HISTORY_S + 0.05) history.shift()

    if (held) {
      poseTarget = 1
      highlight(props, null)
      hoverId = null
    } else {
      const h = pickHover(props)
      highlight(props, h ? h.id : null)
      poseTarget = 0
    }
  }

  poseRig()

  return {
    group,
    getState: () => {
      const g = grip()
      const state: HandMode = heldId ? 'carry' : hoverId ? 'hover' : 'idle'
      return {
        x: g.x,
        y: g.y,
        z: g.z,
        lift,
        state,
        hoverId,
        heldId,
      }
    },
    lift: () => lift,
    holding: () => held,
    framePoint,
    moveTo,
    grabNearest,
    release,
    throwTo,
    throwWithHandVelocity,
    applyCarry,
    onWheel,
    bind,
    update,
    setHandPose,
    counters,
    dispose: () => {
      scene.remove(group)
      scene.remove(ring)
      scene.remove(stalk)
      scene.remove(blob)
      for (const g of geos) g.dispose()
      ringGeo.dispose()
      stalkGeo.dispose()
      blobGeo.dispose()
      mat.dispose()
      ringMat.dispose()
      stalkMat.dispose()
      blobMat.dispose()
    },
  }
}

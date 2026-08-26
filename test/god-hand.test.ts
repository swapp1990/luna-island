import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  CAMERA_TARGET_Y,
  GREY_HAND,
  HAND_HOVER_HEIGHT,
  HAND_LIFT_MAX,
  HAND_LIFT_MIN,
  HAND_MESH_TOP,
  MEADOW,
  PROP_DEFS,
  VIEW_MARGIN,
} from '../src/god/constants'
import { createHand } from '../src/god/hand'
import {
  closedCurlForRadius,
  handPoseAt,
  IDLE_CURL,
  radiusCloseFactor,
} from '../src/god/handPose'
import {
  accumulateLift,
  handBoundsLift,
  ndcInView,
  projectToNdc,
  usableLiftMax,
  yieldCameraToGrip,
  type CameraPose,
} from '../src/god/feel'

describe('god hand lift clamp', () => {
  it('keeps wheel accumulation inside [HAND_LIFT_MIN, HAND_LIFT_MAX]', () => {
    let lift = 1.15
    const deltas = [100, -100, 800, -3000, 0, 50, -50, 1e6, -1e6, 240, -12]
    for (const d of deltas) {
      lift = accumulateLift(lift, d)
      expect(lift).toBeGreaterThanOrEqual(HAND_LIFT_MIN)
      expect(lift).toBeLessThanOrEqual(HAND_LIFT_MAX)
    }
    expect(accumulateLift(HAND_LIFT_MIN, 4000)).toBe(HAND_LIFT_MIN)
    expect(accumulateLift(HAND_LIFT_MAX, -4000)).toBe(HAND_LIFT_MAX)
  })
})

/** Yield once, then again with scale at the yielded dist (hand grows with distance). */
function containTop(
  pose: CameraPose,
  groundY: number,
  lift: number,
  aspect: number,
  heldRadius: number,
) {
  const extra0 = handBoundsLift(pose.dist, heldRadius)
  const p0 = { x: pose.tx, y: groundY + lift + extra0, z: pose.tz }
  const f1 = yieldCameraToGrip(pose, p0, aspect, VIEW_MARGIN)
  const extra1 = handBoundsLift(f1.dist, heldRadius)
  const top = { x: pose.tx, y: groundY + lift + extra1, z: pose.tz }
  const framed = yieldCameraToGrip(pose, top, aspect, VIEW_MARGIN)
  return { framed, top, ndc: projectToNdc(top, framed, aspect), extra: extra1 }
}

describe('god hand screen containment', () => {
  const aspects = [16 / 9, 4 / 3]
  const dists = [15, 18, 22, 30, 42, 50, 65, 80]
  const pitches = [35, 36, 42, 48, 55, 62]
  const yaws = [0, 38, 90, 180, 270]
  const grounds = [CAMERA_TARGET_Y, MEADOW.height]

  it('keeps the hand bounds in-view with margin across the legal camera band', () => {
    let poses = 0
    let minUsable = Infinity
    let worst: { dist: number; pitch: number; usable: number } | null = null
    for (const aspect of aspects) {
      for (const dist of dists) {
        for (const pitch of pitches) {
          for (const yaw of yaws) {
            for (const groundY of grounds) {
              const pose: CameraPose = { yaw, pitch, dist, tx: 4, tz: -8 }
              const extra = handBoundsLift(dist, 0)
              const usable = usableLiftMax(pose, groundY, pose.tx, pose.tz, aspect, VIEW_MARGIN, extra)
              poses += 1
              if (usable < minUsable) {
                minUsable = usable
                worst = { dist, pitch, usable }
              }
              expect(usable).toBeGreaterThanOrEqual(HAND_LIFT_MIN)
              const steps = 6
              for (let s = 0; s <= steps; s++) {
                const lift = HAND_LIFT_MIN + ((usable - HAND_LIFT_MIN) * s) / steps
                const { ndc } = containTop(pose, groundY, lift, aspect, 0)
                expect(ndcInView(ndc, VIEW_MARGIN)).toBe(true)
              }
            }
          }
        }
      }
    }
    expect(poses).toBe(aspects.length * dists.length * pitches.length * yaws.length * grounds.length)
    expect(worst).not.toBeNull()
    console.log(
      `containment sweep ${poses} poses; min usable lift ${minUsable.toFixed(2)} m at dist=${worst!.dist} pitch=${worst!.pitch}`,
    )
  })

  it('yields camera so a high-ground hand top still stays framed', () => {
    const pose: CameraPose = { yaw: 0, pitch: 35, dist: 15, tx: 4, tz: -8 }
    const groundY = 8
    const lift = HAND_HOVER_HEIGHT
    const extra = handBoundsLift(pose.dist, 0)
    const top = { x: pose.tx, y: groundY + lift + extra, z: pose.tz }
    const aspect = 16 / 9
    expect(ndcInView(projectToNdc(top, pose, aspect), VIEW_MARGIN)).toBe(false)
    const { ndc, framed } = containTop(pose, groundY, lift, aspect, 0)
    expect(ndcInView(ndc, VIEW_MARGIN)).toBe(true)
    expect(framed.dist).toBeGreaterThanOrEqual(pose.dist)
  })

  it('keeps the whole hand in frame at dist 26, pitch 42, lift 9 (held rock)', () => {
    const pose: CameraPose = { yaw: 210, pitch: 42, dist: 26, tx: 4, tz: -16 }
    const groundY = MEADOW.height
    const lift = 9
    const heldRadius = PROP_DEFS.rock.size
    const aspect = 16 / 9
    const { ndc, framed, extra } = containTop(pose, groundY, lift, aspect, heldRadius)
    expect(ndcInView(ndc, VIEW_MARGIN)).toBe(true)
    expect(ndc.y).toBeLessThanOrEqual(1 - VIEW_MARGIN)
    expect(ndc.behind).toBe(false)
    console.log(
      `lift-9 case extraY=${extra.toFixed(2)} yielded dist=${framed.dist.toFixed(2)} pitch=${framed.pitch.toFixed(1)} ndc.y=${ndc.y.toFixed(3)}`,
    )
  })
})

describe('god hand grip pose', () => {
  const pebbleR = PROP_DEFS.pebble.size * 0.5
  const rockR = PROP_DEFS.rock.size * 0.5
  const boulderR = PROP_DEFS.boulder.size * 0.5

  it('closes more for a pebble than a rock, more for a rock than a boulder', () => {
    expect(pebbleR).toBeLessThan(rockR)
    expect(rockR).toBeLessThan(boulderR)
    expect(radiusCloseFactor(pebbleR)).toBeGreaterThan(radiusCloseFactor(rockR))
    expect(radiusCloseFactor(rockR)).toBeGreaterThan(radiusCloseFactor(boulderR))
    const p = closedCurlForRadius(pebbleR)
    const r = closedCurlForRadius(rockR)
    const b = closedCurlForRadius(boulderR)
    expect(p.mcp).toBeGreaterThan(r.mcp)
    expect(r.mcp).toBeGreaterThan(b.mcp)
    expect(p.pip).toBeGreaterThan(b.pip)
  })

  it('idle is slightly curled, not a starfish, and t=0 ignores radius', () => {
    expect(IDLE_CURL.mcp).toBeGreaterThan(0.08)
    expect(IDLE_CURL.mcp).toBeLessThan(0.45)
    const a = handPoseAt(0, pebbleR)
    const b = handPoseAt(0, boulderR)
    expect(a.fingers[0]!.mcp).toBeCloseTo(b.fingers[0]!.mcp, 5)
    expect(a.fingers[0]!.splay).not.toBe(a.fingers[3]!.splay)
  })

  it('splay keeps finger gaps: little is the most abducted', () => {
    const open = handPoseAt(0, rockR)
    expect(open.fingers[3]!.splay).toBeGreaterThan(open.fingers[2]!.splay)
    expect(open.fingers[2]!.splay).toBeGreaterThan(open.fingers[1]!.splay)
    expect(open.fingers[1]!.splay).toBeGreaterThan(open.fingers[0]!.splay)
  })

  it('closed boulder abducts more than a closed pebble', () => {
    const pebble = handPoseAt(1, pebbleR)
    const boulder = handPoseAt(1, boulderR)
    expect(boulder.fingers[0]!.splay).toBeLessThan(pebble.fingers[0]!.splay)
    expect(boulder.fingers[3]!.splay).toBeGreaterThan(pebble.fingers[3]!.splay)
  })
})

describe('god hand rig', () => {
  it('builds a parented greybox rig with one material and a thumb', () => {
    const scene = new THREE.Scene()
    const h = createHand(scene)
    const palm = h.group.getObjectByName('palm')
    expect(palm).toBeTruthy()
    expect(h.group.children.length).toBeGreaterThan(0)

    const mats = new Set<THREE.Material>()
    let meshCount = 0
    h.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        meshCount += 1
        const mat = m.material as THREE.MeshStandardMaterial
        mats.add(mat)
        expect(mat.map).toBeNull()
        expect(mat.color.getHex()).toBe(GREY_HAND)
      }
    })
    expect(mats.size).toBe(1)
    expect(meshCount).toBeGreaterThan(10)
    expect(typeof h.setHandPose).toBe('function')

    h.setHandPose(0)
    h.group.updateMatrixWorld(true)
    const open = new THREE.Box3().setFromObject(h.group)
    h.setHandPose(1)
    h.group.updateMatrixWorld(true)
    const closed = new THREE.Box3().setFromObject(h.group)
    // Thumb + wrist extend the silhouette past a palm plate.
    expect(open.max.x - open.min.x).toBeGreaterThan(1.1)
    expect(open.max.z - open.min.z).toBeGreaterThan(1.4)
    expect(open.max.y).toBeLessThanOrEqual(HAND_MESH_TOP)
    expect(closed.max.y).toBeLessThanOrEqual(HAND_MESH_TOP)
    const tris = h.group.userData.triangleCount as number
    expect(tris).toBeGreaterThan(200)
    expect(tris).toBeLessThan(8000)
    console.log(
      `hand rig meshes=${meshCount} tris=${tris} openY=${open.max.y.toFixed(2)} closedY=${closed.max.y.toFixed(2)} spanX=${(open.max.x - open.min.x).toFixed(2)} spanZ=${(open.max.z - open.min.z).toFixed(2)}`,
    )
    h.dispose()
  })
})

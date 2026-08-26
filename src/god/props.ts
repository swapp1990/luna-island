import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import {
  BOOT_CLEARANCE,
  BOOT_COUNTS,
  BOOT_MAX_SLOPE,
  BOOT_MIN_HEIGHT,
  FREE_ANGULAR_DAMPING,
  FREE_LINEAR_DAMPING,
  GREY_PROP,
  ISLAND_HALF,
  ISLAND_SEED,
  MEADOW,
  PROP_DEFS,
  REST_DAMP_SPEED,
  SLEEP_ANGVEL,
  SLEEP_LINVEL,
  SLEEP_STILL_TICKS,
  type PropKind,
} from './constants'
import { slopeGradient } from './islandHeight'
import { createRng } from './rng'
import type { IslandHandle } from './island'

export interface Prop {
  id: string
  kind: PropKind
  mass: number
  mesh: THREE.Object3D
  body: RAPIER.RigidBody
  prevPos: THREE.Vector3
  currPos: THREE.Vector3
  prevQuat: THREE.Quaternion
  currQuat: THREE.Quaternion
  restAngDamp: number
  radius: number
  sinking: number
  splashed: boolean
  stillTicks: number
}

export interface PropsHandle {
  list: () => Prop[]
  get: (id: string) => Prop | undefined
  awakeCount: () => number
  storePrev: () => void
  syncBodies: () => void
  interpolate: (alpha: number) => void
  spawn: (kind: PropKind, x: number, y: number, z: number, id?: string, cairnRank?: number) => Prop
  spawnBoot: () => void
  spawnMany: (n: number, kind?: PropKind) => void
  stress: (n: number) => void
  snap: () => void
  sleepAllSlow: () => void
  rescueWet: () => void
  sleepResting: (heldId: string | null) => void
  remove: (id: string) => void
  clear: () => void
  dispose: () => void
}

function greyMat(tint = 0): THREE.MeshStandardMaterial {
  const c = new THREE.Color(GREY_PROP)
  if (tint !== 0) c.offsetHSL(0, 0, tint)
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.78,
    metalness: 0.04,
  })
}

function quatFromEuler(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

let seq = 0
function nextId(kind: PropKind): string {
  seq += 1
  return `${kind}-${seq}`
}

export function createProps(
  scene: THREE.Scene,
  world: RAPIER.World,
  R: typeof RAPIER,
  island: IslandHandle,
): PropsHandle {
  const props: Prop[] = []
  const byId = new Map<string, Prop>()
  const geos: THREE.BufferGeometry[] = []
  let hullFallbackLogged = false

  const CAIRN = [
    { r: 0.48, h: 0.2 },
    { r: 0.4, h: 0.17 },
    { r: 0.32, h: 0.15 },
    { r: 0.24, h: 0.13 },
  ] as const

  const rockGeo = (kind: PropKind): THREE.IcosahedronGeometry => {
    const r = PROP_DEFS[kind].size * 0.5
    return new THREE.IcosahedronGeometry(r, kind === 'pebble' ? 0 : 1)
  }

  const makeMesh = (
    kind: PropKind,
    cairnRank = 0,
    sharedRock?: THREE.IcosahedronGeometry,
  ): { root: THREE.Object3D; radius: number } => {
    const def = PROP_DEFS[kind]
    const mat = greyMat(kind === 'pebble' ? 0.06 : kind === 'boulder' ? -0.05 : 0)
    if (kind === 'pebble' || kind === 'rock' || kind === 'boulder') {
      const r = def.size * 0.5
      const geo = sharedRock ?? rockGeo(kind)
      if (!sharedRock) geos.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return { root: mesh, radius: r }
    }
    if (kind === 'log') {
      const r = 0.2
      const geo = new THREE.CylinderGeometry(r, r, def.size, 8)
      geos.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return { root: mesh, radius: r }
    }
    if (kind === 'cairn') {
      const stone = CAIRN[cairnRank % 4]!
      const r = stone.r
      const h = stone.h
      const geo = new THREE.CylinderGeometry(r, r * 1.05, h, 10)
      geos.push(geo)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      return { root: mesh, radius: Math.max(r, h * 0.5) }
    }
    const group = new THREE.Group()
    const trunkH = 2.7
    const trunkR = 0.2
    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.85, trunkR, trunkH, 7)
    const crownGeo = new THREE.ConeGeometry(0.95, 2.1, 7)
    geos.push(trunkGeo, crownGeo)
    const trunk = new THREE.Mesh(trunkGeo, mat)
    trunk.position.y = trunkH * 0.5
    trunk.castShadow = true
    trunk.receiveShadow = true
    const crown = new THREE.Mesh(crownGeo, greyMat(-0.04))
    crown.position.y = trunkH + 0.7
    crown.castShadow = true
    crown.receiveShadow = true
    group.add(trunk, crown)
    return { root: group, radius: 1.1 }
  }

  const makeBody = (
    kind: PropKind,
    x: number,
    y: number,
    z: number,
    cairnRank = 0,
    rockGeoForHull?: THREE.IcosahedronGeometry,
  ): RAPIER.RigidBody => {
    const def = PROP_DEFS[kind]
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(FREE_LINEAR_DAMPING)
      .setAngularDamping(FREE_ANGULAR_DAMPING)
      .setCcdEnabled(kind === 'boulder' || kind === 'log' || kind === 'pebble')
      .setCanSleep(true)
    const body = world.createRigidBody(desc)

    const friction = def.friction
    const rest = def.restitution
    const events = R.ActiveEvents.CONTACT_FORCE_EVENTS
    const threshold = 220

    if (kind === 'pebble' || kind === 'rock' || kind === 'boulder') {
      const geo = rockGeoForHull ?? rockGeo(kind)
      const pts = new Float32Array(geo.attributes.position!.array as Float32Array)
      let col = R.ColliderDesc.convexHull(pts)
      if (!col) {
        if (!hullFallbackLogged) {
          console.warn(`god: convex hull failed for ${kind} — falling back to ball`)
          hullFallbackLogged = true
        }
        col = R.ColliderDesc.ball(def.size * 0.5)
      }
      col
        .setMass(def.mass)
        .setFriction(friction)
        .setRestitution(rest)
        .setActiveEvents(events)
        .setContactForceEventThreshold(threshold)
      world.createCollider(col, body)
    } else if (kind === 'log') {
      const col = R.ColliderDesc.cylinder(def.size * 0.5, 0.2)
        .setMass(def.mass)
        .setFriction(friction)
        .setRestitution(rest)
        .setActiveEvents(events)
        .setContactForceEventThreshold(threshold)
      world.createCollider(col, body)
      body.setRotation(quatFromEuler(0, 0.4, Math.PI / 2), true)
    } else if (kind === 'cairn') {
      const stone = CAIRN[cairnRank % 4]!
      const r = stone.r
      const h = stone.h
      const col = R.ColliderDesc.cylinder(h * 0.5, r)
        .setMass(def.mass)
        .setFriction(friction)
        .setRestitution(rest)
        .setActiveEvents(events)
        .setContactForceEventThreshold(threshold)
      world.createCollider(col, body)
    } else {
      const trunk = R.ColliderDesc.cylinder(1.35, 0.2)
        .setMass(3)
        .setTranslation(0, 1.35, 0)
        .setFriction(friction)
        .setRestitution(rest)
        .setActiveEvents(events)
        .setContactForceEventThreshold(threshold)
      const crown = R.ColliderDesc.cone(1.05, 0.95)
        .setMass(9)
        .setTranslation(0, 3.4, 0)
        .setFriction(friction)
        .setRestitution(rest)
        .setActiveEvents(events)
        .setContactForceEventThreshold(threshold)
      world.createCollider(trunk, body)
      world.createCollider(crown, body)
    }
    return body
  }

  const spawn = (kind: PropKind, x: number, y: number, z: number, id?: string, cairnRank = 0): Prop => {
    const def = PROP_DEFS[kind]
    const pid = id ?? nextId(kind)
    let sharedRock: THREE.IcosahedronGeometry | undefined
    if (kind === 'pebble' || kind === 'rock' || kind === 'boulder') {
      sharedRock = rockGeo(kind)
      geos.push(sharedRock)
    }
    const { root, radius } = makeMesh(kind, cairnRank, sharedRock)
    root.position.set(x, y, z)
    scene.add(root)
    const body = makeBody(kind, x, y, z, cairnRank, sharedRock)
    body.userData = pid
    const t = body.translation()
    const q = body.rotation()
    const prop: Prop = {
      id: pid,
      kind,
      mass: def.mass,
      mesh: root,
      body,
      prevPos: new THREE.Vector3(t.x, t.y, t.z),
      currPos: new THREE.Vector3(t.x, t.y, t.z),
      prevQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w),
      currQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w),
      restAngDamp: FREE_ANGULAR_DAMPING,
      radius,
      sinking: -1,
      splashed: false,
      stillTicks: 0,
    }
    props.push(prop)
    byId.set(pid, prop)
    return prop
  }

  const groundY = (x: number, z: number, radius: number): number => {
    return island.heightAt(x, z) + radius + 0.06
  }

  const footprint = (kind: PropKind): number => {
    if (kind === 'log') return 1.35
    if (kind === 'snag') return 1.15
    if (kind === 'boulder') return PROP_DEFS.boulder.size * 0.5 + 0.2
    if (kind === 'cairn') return 0.55
    return PROP_DEFS[kind].size * 0.5 + 0.1
  }

  const pickLand = (
    rng: ReturnType<typeof createRng>,
    preferMeadow: boolean,
    kind: PropKind,
    reserved: Array<{ x: number; z: number; r: number }>,
  ): { x: number; z: number } => {
    const need = footprint(kind)
    const occupies = (x: number, z: number): boolean => {
      for (const p of props) {
        if (Math.hypot(p.currPos.x - x, p.currPos.z - z) < need + p.radius + BOOT_CLEARANCE) return true
      }
      for (const r of reserved) {
        if (Math.hypot(r.x - x, r.z - z) < need + r.r + BOOT_CLEARANCE) return true
      }
      return false
    }
    const ok = (x: number, z: number): boolean => {
      const h = island.heightAt(x, z)
      if (h < BOOT_MIN_HEIGHT) return false
      if (slopeGradient(x, z) > BOOT_MAX_SLOPE) return false
      return !occupies(x, z)
    }
    for (let i = 0; i < 80; i++) {
      let x: number
      let z: number
      if (preferMeadow) {
        const a = rng.float(0, Math.PI * 2)
        const r = Math.sqrt(rng.next()) * MEADOW.radius * 0.55
        x = MEADOW.x + Math.cos(a) * r
        z = MEADOW.z + Math.sin(a) * r
      } else {
        x = rng.float(-ISLAND_HALF * 0.55, ISLAND_HALF * 0.55)
        z = rng.float(-ISLAND_HALF * 0.55, ISLAND_HALF * 0.55)
      }
      if (ok(x, z)) return { x, z }
    }
    for (let i = 0; i < 24; i++) {
      const x = MEADOW.x + rng.float(-6, 6)
      const z = MEADOW.z + rng.float(-6, 6)
      if (ok(x, z)) return { x, z }
    }
    return { x: MEADOW.x + rng.float(-2, 2), z: MEADOW.z + rng.float(-2, 2) }
  }

  const spawnBoot = () => {
    seq = 0
    const rng = createRng(ISLAND_SEED + 17)
    const cairnSpots: Array<[number, number]> = [
      [MEADOW.x - 3.6, MEADOW.z + 1.4],
      [MEADOW.x + 4.2, MEADOW.z - 1.2],
      [MEADOW.x + 0.6, MEADOW.z + 4.4],
    ]
    const logSpots: Array<[number, number]> = []
    for (let i = 0; i < BOOT_COUNTS.log; i++) {
      const a = (i / BOOT_COUNTS.log) * Math.PI * 2 + 0.35
      logSpots.push([MEADOW.x + Math.cos(a) * 7.4, MEADOW.z + Math.sin(a) * 7.4])
    }
    const reserved = [
      ...cairnSpots.map(([x, z]) => ({ x, z, r: 0.7 })),
      ...logSpots.map(([x, z]) => ({ x, z, r: 1.4 })),
    ]
    const place = (kind: PropKind, n: number, meadow: boolean) => {
      for (let i = 0; i < n; i++) {
        const p = pickLand(rng, meadow, kind, reserved)
        const r = kind === 'snag' ? 0.05 : kind === 'log' ? 0.22 : PROP_DEFS[kind].size * 0.5
        const y = groundY(p.x, p.z, r)
        const prop = spawn(kind, p.x, y, p.z)
        if (kind === 'log') {
          prop.body.setRotation(quatFromEuler(0, rng.float(0, Math.PI), Math.PI / 2), true)
        }
      }
    }
    place('pebble', BOOT_COUNTS.pebble, false)
    place('rock', BOOT_COUNTS.rock, true)
    place('boulder', BOOT_COUNTS.boulder, false)
    for (let i = 0; i < logSpots.length; i++) {
      let [x, z] = logSpots[i]!
      if (slopeGradient(x, z) > BOOT_MAX_SLOPE || island.heightAt(x, z) < BOOT_MIN_HEIGHT) {
        const p = pickLand(rng, true, 'log', reserved)
        x = p.x
        z = p.z
      }
      const prop = spawn('log', x, groundY(x, z, 0.22), z)
      const a = (i / BOOT_COUNTS.log) * Math.PI * 2 + 0.35
      prop.body.setRotation(quatFromEuler(0, a + Math.PI / 2, Math.PI / 2), true)
    }
    // Three cairn stacks of 4 distinct stones, axis-aligned, with a rest gap.
    for (const [cx, cz] of cairnSpots) {
      let y = island.heightAt(cx, cz) + 0.03
      for (let i = 0; i < 4; i++) {
        const stone = CAIRN[i]!
        y += stone.h * 0.5
        spawn('cairn', cx, y, cz, undefined, i)
        y += stone.h * 0.5 + 0.028
      }
    }
    const snagSpots: Array<[number, number]> = [
      [-16, 7],
      [-7, 14],
      [20, -5],
      [12, 10],
    ]
    for (const [sx0, sz0] of snagSpots) {
      let sx = sx0
      let sz = sz0
      let placed = false
      for (let k = 0; k < 16; k++) {
        const h = island.heightAt(sx, sz)
        if (h >= BOOT_MIN_HEIGHT && slopeGradient(sx, sz) <= BOOT_MAX_SLOPE) {
          spawn('snag', sx, h + 0.04, sz)
          placed = true
          break
        }
        sx *= 0.86
        sz *= 0.86
      }
      if (!placed) {
        const p = pickLand(rng, true, 'snag', reserved)
        spawn('snag', p.x, island.heightAt(p.x, p.z) + 0.04, p.z)
      }
    }
  }

  const remove = (id: string) => {
    const prop = byId.get(id)
    if (!prop) return
    scene.remove(prop.mesh)
    prop.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.material && !Array.isArray(mesh.material)) mesh.material.dispose()
    })
    world.removeRigidBody(prop.body)
    byId.delete(id)
    const i = props.indexOf(prop)
    if (i >= 0) props.splice(i, 1)
  }

  const clear = () => {
    while (props.length) remove(props[0]!.id)
  }

  const spawnMany = (n: number, kind?: PropKind) => {
    const rng = createRng((seq + 1) * 997)
    for (let i = 0; i < n; i++) {
      const k = kind ?? (['rock', 'pebble', 'log'] as const)[i % 3]!
      const p = pickLand(rng, true, k, [])
      const r = k === 'log' ? 0.25 : PROP_DEFS[k].size * 0.5
      spawn(k, p.x, groundY(p.x, p.z, r) + rng.float(0.2, 1.4), p.z)
    }
  }

  const snap = () => {
    for (const p of props) {
      const t = p.body.translation()
      const q = p.body.rotation()
      p.currPos.set(t.x, t.y, t.z)
      p.currQuat.set(q.x, q.y, q.z, q.w)
      p.prevPos.copy(p.currPos)
      p.prevQuat.copy(p.currQuat)
      p.mesh.position.copy(p.currPos)
      p.mesh.quaternion.copy(p.currQuat)
    }
  }

  const sleepAllSlow = () => {
    for (const p of props) {
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      p.body.sleep()
      p.stillTicks = SLEEP_STILL_TICKS
    }
  }

  const rescueWet = () => {
    let n = 0
    for (const p of props) {
      const t = p.body.translation()
      const h = island.heightAt(t.x, t.z)
      if (t.y >= 0.45 && h >= BOOT_MIN_HEIGHT * 0.7) continue
      const a = n * 1.7
      n += 1
      const x = MEADOW.x + Math.cos(a) * 3.2
      const z = MEADOW.z + Math.sin(a) * 3.2
      const y = island.heightAt(x, z) + p.radius + 0.1
      p.body.setTranslation({ x, y, z }, false)
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      p.body.sleep()
      p.splashed = false
      p.sinking = -1
      p.stillTicks = SLEEP_STILL_TICKS
    }
  }

  const sleepResting = (heldId: string | null) => {
    for (const p of props) {
      if (heldId && p.id === heldId) {
        p.stillTicks = 0
        p.body.setLinearDamping(FREE_LINEAR_DAMPING)
        continue
      }
      if (p.sinking >= 0) {
        p.stillTicks = 0
        continue
      }
      const v = p.body.linvel()
      const w = p.body.angvel()
      const speed = Math.hypot(v.x, v.y, v.z)
      const ang = Math.hypot(w.x, w.y, w.z)
      if (speed < REST_DAMP_SPEED) {
        p.body.setLinearDamping(FREE_LINEAR_DAMPING + 2.4)
        p.body.setAngularDamping(FREE_ANGULAR_DAMPING + 2.8)
      } else {
        p.body.setLinearDamping(FREE_LINEAR_DAMPING)
        p.body.setAngularDamping(p.restAngDamp)
      }
      if (speed < SLEEP_LINVEL && ang < SLEEP_ANGVEL) {
        p.stillTicks += 1
        if (p.stillTicks >= SLEEP_STILL_TICKS) {
          p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
          p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
          p.body.sleep()
        }
      } else {
        p.stillTicks = 0
      }
    }
  }

  const stress = (n: number) => {
    const rng = createRng(4242)
    for (let i = 0; i < n; i++) {
      const k: PropKind = i % 5 === 0 ? 'boulder' : i % 3 === 0 ? 'log' : 'rock'
      const x = rng.float(-12, 12)
      const z = rng.float(-12, 12)
      const prop = spawn(k, x, 16 + (i % 7) * 0.35, z)
      prop.body.setLinvel({ x: rng.float(-2, 2), y: rng.float(-1, 0), z: rng.float(-2, 2) }, true)
    }
  }

  return {
    list: () => props,
    get: (id) => byId.get(id),
    awakeCount: () => {
      let n = 0
      for (const p of props) if (!p.body.isSleeping()) n += 1
      return n
    },
    storePrev: () => {
      for (const p of props) {
        p.prevPos.copy(p.currPos)
        p.prevQuat.copy(p.currQuat)
      }
    },
    syncBodies: () => {
      for (const p of props) {
        const t = p.body.translation()
        const q = p.body.rotation()
        p.currPos.set(t.x, t.y, t.z)
        p.currQuat.set(q.x, q.y, q.z, q.w)
      }
    },
    interpolate: (alpha: number) => {
      const a = Math.min(1, Math.max(0, alpha))
      for (const p of props) {
        p.mesh.position.lerpVectors(p.prevPos, p.currPos, a)
        p.mesh.quaternion.slerpQuaternions(p.prevQuat, p.currQuat, a)
      }
    },
    spawn,
    spawnBoot,
    spawnMany,
    stress,
    snap,
    sleepAllSlow,
    rescueWet,
    sleepResting,
    remove,
    clear,
    dispose: () => {
      clear()
      for (const g of geos) g.dispose()
    },
  }
}

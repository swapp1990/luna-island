import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import {
  DENT_FORCE_MIN,
  DENT_MAX,
  DENT_MIN_SPACING,
  DUST_LIFE,
  IMPACT_FORCE_MIN,
  IMPACT_NORMAL_SPEED,
  SPLASH_SINK_S,
} from './constants'
import type { IslandHandle } from './island'
import type { PropsHandle } from './props'

export interface ImpactHandle {
  counters: { impacts: number; splashes: number }
  drain: (events: RAPIER.EventQueue, world: RAPIER.World, props: PropsHandle) => void
  checkWater: (props: PropsHandle, island: IslandHandle, dt: number) => void
  update: (dt: number) => void
  reset: () => void
  dispose: () => void
}

interface Particle {
  life: number
  max: number
  vx: number
  vy: number
  vz: number
}

interface Ripple {
  life: number
  max: number
  mesh: THREE.Mesh
}

export function createImpact(scene: THREE.Scene): ImpactHandle {
  const counters = { impacts: 0, splashes: 0 }
  const cooldown = new Map<string, number>()

  const dustCount = 420
  const dustGeo = new THREE.BufferGeometry()
  const dustPos = new Float32Array(dustCount * 3)
  const dustCol = new Float32Array(dustCount * 3)
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3))
  const dustMat = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const dust = new THREE.Points(dustGeo, dustMat)
  dust.frustumCulled = false
  scene.add(dust)
  const particles: Particle[] = []
  for (let i = 0; i < dustCount; i++) {
    particles.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0 })
    dustPos[i * 3 + 1] = -20
  }

  let dustCursor = 0
  const spawnDust = (x: number, y: number, z: number, mag: number, splash: boolean) => {
    const n = splash ? 28 : Math.min(22, 6 + Math.floor(mag / 80))
    for (let i = 0; i < n; i++) {
      const idx = dustCursor
      const p = particles[idx]!
      dustCursor = (dustCursor + 1) % dustCount
      p.max = splash ? 0.7 : DUST_LIFE
      p.life = p.max
      const a = Math.random() * Math.PI * 2
      const s = (splash ? 2.4 : 1.1) * (0.3 + mag / 800)
      p.vx = Math.cos(a) * s
      p.vz = Math.sin(a) * s
      p.vy = (splash ? 3.2 : 1.6) * (0.4 + Math.random())
      dustPos[idx * 3] = x
      dustPos[idx * 3 + 1] = y + 0.05
      dustPos[idx * 3 + 2] = z
      const g = splash ? 0.72 : 0.55 + Math.random() * 0.12
      dustCol[idx * 3] = g
      dustCol[idx * 3 + 1] = g
      dustCol[idx * 3 + 2] = splash ? 0.78 : g * 0.95
    }
  }

  // Phase 2 promotes this to committed tile state.
  const dentGeo = new THREE.CircleGeometry(0.7, 12)
  dentGeo.rotateX(-Math.PI / 2)
  const dentMat = new THREE.MeshBasicMaterial({
    color: 0x3a3b3e,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  })
  const dents = new THREE.InstancedMesh(dentGeo, dentMat, DENT_MAX)
  dents.renderOrder = 1
  dents.frustumCulled = false
  scene.add(dents)
  const dummy = new THREE.Object3D()
  let dentCount = 0
  let dentCursor = 0
  const dentAt: Array<{ x: number; z: number }> = []

  const spawnDent = (x: number, y: number, z: number, mag: number) => {
    for (const d of dentAt) {
      if (Math.hypot(d.x - x, d.z - z) < DENT_MIN_SPACING) return
    }
    const s = Math.min(2.4, 0.7 + mag / 900)
    dummy.position.set(x, y + 0.03, z)
    dummy.scale.set(s, 1, s)
    dummy.updateMatrix()
    dents.setMatrixAt(dentCursor, dummy.matrix)
    if (dentAt.length < DENT_MAX) dentAt.push({ x, z })
    else dentAt[dentCursor] = { x, z }
    dentCursor = (dentCursor + 1) % DENT_MAX
    dentCount = Math.min(DENT_MAX, dentCount + 1)
    dents.count = dentCount
    dents.instanceMatrix.needsUpdate = true
  }

  const ripples: Ripple[] = []
  const rippleGeo = new THREE.RingGeometry(0.2, 0.45, 24)
  rippleGeo.rotateX(-Math.PI / 2)
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xc5ccd4,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const spawnRipple = (x: number, z: number, mag: number) => {
    const mesh = new THREE.Mesh(rippleGeo, rippleMat.clone())
    mesh.position.set(x, 0.02, z)
    const s = 0.6 + Math.min(2.5, mag / 400)
    mesh.scale.setScalar(s)
    scene.add(mesh)
    ripples.push({ life: 0.85, max: 0.85, mesh })
  }

  const drain = (events: RAPIER.EventQueue, world: RAPIER.World, props: PropsHandle) => {
    events.drainContactForceEvents((ev) => {
      const mag = ev.totalForceMagnitude()
      if (mag < IMPACT_FORCE_MIN) return
      const c1 = world.getCollider(ev.collider1())
      const c2 = world.getCollider(ev.collider2())
      const b1 = c1.parent()
      const b2 = c2.parent()
      if (!b1 || !b2) return
      const id1 = typeof b1.userData === 'string' ? b1.userData : ''
      const id2 = typeof b2.userData === 'string' ? b2.userData : ''
      const prop = props.get(id1) ?? props.get(id2)
      const otherIsTerrain = id1 === 'terrain' || id2 === 'terrain'
      if (!prop) return
      const v = prop.body.linvel()
      const n = ev.maxForceDirection()
      const vn = Math.abs(v.x * n.x + v.y * n.y + v.z * n.z)
      // Rolling/sliding has high tangential speed and is not an impact.
      if (vn < IMPACT_NORMAL_SPEED) return
      const now = performance.now()
      const last = cooldown.get(prop.id) ?? 0
      if (now - last < 120) return
      cooldown.set(prop.id, now)
      counters.impacts += 1
      const t = prop.body.translation()
      spawnDust(t.x, t.y - prop.radius * 0.4, t.z, mag, false)
      if (otherIsTerrain && mag >= DENT_FORCE_MIN && vn > 2.2 && t.y > 0.4) {
        spawnDent(t.x, t.y - prop.radius, t.z, mag)
      }
    })
    events.drainCollisionEvents(() => {
      /* contact forces own the juice */
    })
  }

  const checkWater = (props: PropsHandle, island: IslandHandle, dt: number) => {
    const doomed: string[] = []
    for (const p of props.list()) {
      const t = p.body.translation()
      const terrain = island.heightAt(t.x, t.z)
      const inWater = t.y < 0.12 && terrain < 0.12
      if (inWater && !p.splashed) {
        p.splashed = true
        p.sinking = SPLASH_SINK_S
        counters.splashes += 1
        spawnDust(t.x, 0.05, t.z, 200 + p.mass * 20, true)
        spawnRipple(t.x, t.z, 80 + p.mass * 18)
        p.body.setLinearDamping(2.8)
        const v = p.body.linvel()
        p.body.setLinvel({ x: v.x * 0.25, y: Math.min(v.y, -0.6), z: v.z * 0.25 }, true)
      }
      if (p.sinking >= 0) {
        p.sinking -= dt
        p.body.applyImpulse({ x: 0, y: -p.mass * 0.08, z: 0 }, true)
        if (p.sinking <= 0 || t.y < -6) doomed.push(p.id)
      } else if (t.y < -8) {
        doomed.push(p.id)
      }
    }
    for (const id of doomed) props.remove(id)
  }

  const update = (dt: number) => {
    let used = 0
    for (let i = 0; i < dustCount; i++) {
      const p = particles[i]!
      if (p.life <= 0) {
        dustPos[i * 3 + 1] = -20
        continue
      }
      p.life -= dt
      p.vy -= 6 * dt
      dustPos[i * 3] += p.vx * dt
      dustPos[i * 3 + 1] += p.vy * dt
      dustPos[i * 3 + 2] += p.vz * dt
      used += 1
    }
    dustGeo.attributes.position!.needsUpdate = true
    dustGeo.attributes.color!.needsUpdate = true
    dustMat.opacity = used > 0 ? 0.85 : 0

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!
      r.life -= dt
      const t = 1 - r.life / r.max
      r.mesh.scale.setScalar(r.mesh.scale.x + dt * 3.2)
      const mat = r.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 0.7 * (1 - t)
      if (r.life <= 0) {
        scene.remove(r.mesh)
        mat.dispose()
        ripples.splice(i, 1)
      }
    }
  }

  const reset = () => {
    counters.impacts = 0
    counters.splashes = 0
    cooldown.clear()
    for (const p of particles) p.life = 0
    for (const r of ripples) {
      scene.remove(r.mesh)
      ;(r.mesh.material as THREE.Material).dispose()
    }
    ripples.length = 0
    dentCount = 0
    dentCursor = 0
    dentAt.length = 0
    dents.count = 0
    dents.instanceMatrix.needsUpdate = true
  }

  return {
    counters,
    drain,
    checkWater,
    update,
    reset,
    dispose: () => {
      reset()
      scene.remove(dust)
      scene.remove(dents)
      dustGeo.dispose()
      dustMat.dispose()
      dentGeo.dispose()
      dentMat.dispose()
      rippleGeo.dispose()
      rippleMat.dispose()
    },
  }
}

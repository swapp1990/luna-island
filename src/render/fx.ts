import * as THREE from 'three'
import type { Burst } from './actionLanguage'
import { BURST_WINDOW } from './actionLanguage'

/** Pool size for short-lived juice particles. */
const POOL = 96
const CHIP_TTL = 450
const SPARK_TTL = 180
const STAR_TTL = 700
const BURST_TTL = 550
const BURST_SLOTS = 24
const PARTS_PER_BURST = 6

export type ParticleKind = 'wood' | 'stone' | 'spark' | 'dust' | 'star' | 'green' | 'coin'

export interface SpawnOpts {
  /** Sim-time clock in ms (`(tick + alpha) * 1000`). Required for replay-safe juice. */
  now?: number
  /** Deterministic seed (event.seq or hashed agent+tick). */
  seed?: number
}

export interface BurstSite {
  x: number
  y: number
  z: number
  other?: { x: number; y: number; z: number }
  place?: { x: number; y: number; z: number }
}

interface Particle {
  mesh: THREE.Mesh
  kind: ParticleKind
  born: number
  ttl: number
  vx: number
  vy: number
  vz: number
  active: boolean
  spin: number
}

export interface FxHandle {
  root: THREE.Group
  update: (now: number) => void
  puffWoodChips: (x: number, y: number, z: number, n?: number, opts?: SpawnOpts) => void
  puffStoneChips: (x: number, y: number, z: number, n?: number, opts?: SpawnOpts) => void
  spark: (x: number, y: number, z: number, opts?: SpawnOpts) => void
  knockDust: (x: number, y: number, z: number, opts?: SpawnOpts) => void
  sparkleBurst: (x: number, y: number, z: number, opts?: SpawnOpts) => void
  greenBurst: (x: number, y: number, z: number, opts?: SpawnOpts) => void
  /** Event-derived bursts — same (bursts, tick, alpha) ⇒ same layout. */
  syncBursts: (
    bursts: Burst[],
    sites: Map<string, BurstSite>,
    tick: number,
    alpha: number,
  ) => void
  activeCount: () => number
  dispose: () => void
}

/** Deterministic 0..1 from (seq, index). */
export function seqUnit(seq: number, i: number): number {
  let x = (Math.imul(seq, 1664525) + Math.imul(i + 1, 1013904223)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return (x >>> 0) / 4294967296
}

function triGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const s = 0.045
  const verts = new Float32Array([0, s, 0, -s * 0.7, -s * 0.5, 0, s * 0.7, -s * 0.5, 0])
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  g.computeVertexNormals()
  return g
}

export function createFx(scene: THREE.Scene): FxHandle {
  const root = new THREE.Group()
  root.name = 'fx'
  scene.add(root)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(obj: T): T => {
    disposables.push(obj)
    return obj
  }

  const chipGeo = track(triGeo())
  const sparkGeo = track(new THREE.SphereGeometry(0.03, 5, 4))
  const starGeo = track(new THREE.OctahedronGeometry(0.05, 0))
  const dustGeo = track(new THREE.SphereGeometry(0.035, 5, 4))

  const mats: Record<ParticleKind, THREE.MeshBasicMaterial> = {
    wood: track(new THREE.MeshBasicMaterial({ color: 0x6b4423, transparent: true, depthWrite: false })),
    stone: track(new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, depthWrite: false })),
    spark: track(
      new THREE.MeshBasicMaterial({
        color: 0xffe080,
        transparent: true,
        depthWrite: false,
      }),
    ),
    dust: track(
      new THREE.MeshBasicMaterial({
        color: 0xc9b58a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    ),
    star: track(
      new THREE.MeshBasicMaterial({
        color: 0xfff2a8,
        transparent: true,
        depthWrite: false,
      }),
    ),
    green: track(
      new THREE.MeshBasicMaterial({
        color: 0x6fbf7a,
        transparent: true,
        depthWrite: false,
      }),
    ),
    coin: track(
      new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        transparent: true,
        depthWrite: false,
      }),
    ),
  }

  const pool: Particle[] = []
  for (let i = 0; i < POOL; i++) {
    const mesh = new THREE.Mesh(chipGeo, mats.wood)
    mesh.visible = false
    mesh.renderOrder = 50
    root.add(mesh)
    pool.push({
      mesh,
      kind: 'wood',
      born: 0,
      ttl: CHIP_TTL,
      vx: 0,
      vy: 0,
      vz: 0,
      active: false,
      spin: 0,
    })
  }

  let lastNow = 0

  const take = (): Particle | null => {
    let oldest: Particle | null = null
    for (const p of pool) {
      if (!p.active) return p
      if (!oldest || p.born < oldest.born) oldest = p
    }
    return oldest
  }

  const spawn = (
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    now: number,
    ttl: number,
    seed: number,
  ) => {
    const p = take()
    if (!p) return
    p.active = true
    p.kind = kind
    p.born = now
    p.ttl = ttl
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.spin = (seqUnit(seed, 20) - 0.5) * 12
    p.mesh.geometry =
      kind === 'spark' || kind === 'coin'
        ? sparkGeo
        : kind === 'star'
          ? starGeo
          : kind === 'dust'
            ? dustGeo
            : chipGeo
    p.mesh.material = mats[kind]
    p.mesh.position.set(x, y, z)
    p.mesh.scale.set(1, 1, 1)
    p.mesh.rotation.set(seqUnit(seed, 21) * 3, seqUnit(seed, 22) * 3, seqUnit(seed, 23) * 3)
    p.mesh.visible = true
    mats[kind].opacity = kind === 'dust' ? 0.55 : 1
  }

  const clock = (opts?: SpawnOpts): { now: number; seed: number } => ({
    now: opts?.now ?? lastNow,
    seed: opts?.seed ?? 1,
  })

  const puffWoodChips = (x: number, y: number, z: number, n = 4, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    for (let i = 0; i < n; i++) {
      const u = seqUnit(seed, i)
      const v = seqUnit(seed, i + 40)
      const w = seqUnit(seed, i + 80)
      spawn(
        'wood',
        x + (u - 0.5) * 0.15,
        y + v * 0.1,
        z + (w - 0.5) * 0.15,
        (u - 0.5) * 1.4,
        0.8 + v * 1.2,
        (w - 0.5) * 1.4,
        now,
        CHIP_TTL,
        seed + i,
      )
    }
  }

  const puffStoneChips = (x: number, y: number, z: number, n = 3, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    for (let i = 0; i < n; i++) {
      const u = seqUnit(seed, i)
      const v = seqUnit(seed, i + 40)
      const w = seqUnit(seed, i + 80)
      spawn(
        'stone',
        x + (u - 0.5) * 0.12,
        y + v * 0.08,
        z + (w - 0.5) * 0.12,
        (u - 0.5) * 1.2,
        0.6 + v * 1.0,
        (w - 0.5) * 1.2,
        now,
        CHIP_TTL,
        seed + i,
      )
    }
  }

  const spark = (x: number, y: number, z: number, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    spawn(
      'spark',
      x,
      y,
      z,
      (seqUnit(seed, 0) - 0.5) * 0.4,
      0.5 + seqUnit(seed, 1) * 0.6,
      (seqUnit(seed, 2) - 0.5) * 0.4,
      now,
      SPARK_TTL,
      seed,
    )
  }

  const knockDust = (x: number, y: number, z: number, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    for (let i = 0; i < 3; i++) {
      const u = seqUnit(seed, i)
      const v = seqUnit(seed, i + 10)
      spawn(
        'dust',
        x + (u - 0.5) * 0.2,
        y,
        z + (v - 0.5) * 0.2,
        (u - 0.5) * 0.3,
        0.15 + v * 0.25,
        (seqUnit(seed, i + 20) - 0.5) * 0.3,
        now,
        400,
        seed + i,
      )
    }
  }

  const sparkleBurst = (x: number, y: number, z: number, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    const n = 8 + Math.floor(seqUnit(seed, 0) * 5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seqUnit(seed, i + 1) * 0.3
      const sp = 0.9 + seqUnit(seed, i + 2) * 1.1
      spawn(
        'star',
        x,
        y + 0.3,
        z,
        Math.cos(a) * sp,
        0.8 + seqUnit(seed, i + 3) * 1.4,
        Math.sin(a) * sp,
        now,
        STAR_TTL,
        seed + i,
      )
    }
  }

  const greenBurst = (x: number, y: number, z: number, opts?: SpawnOpts) => {
    const { now, seed } = clock(opts)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      spawn(
        'green',
        x,
        y + 0.4,
        z,
        Math.cos(a) * 0.7,
        0.5 + seqUnit(seed, i) * 0.9,
        Math.sin(a) * 0.7,
        now,
        BURST_TTL,
        seed + i,
      )
    }
  }

  // Event-derived burst layer (replay / photo visible — no spawn-once memory)
  const burstRoot = new THREE.Group()
  burstRoot.name = 'fx-bursts'
  root.add(burstRoot)
  type BurstPart = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }
  const burstParts: BurstPart[] = []
  for (let s = 0; s < BURST_SLOTS * PARTS_PER_BURST; s++) {
    const mat = track(
      new THREE.MeshBasicMaterial({
        color: 0xc9b58a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    )
    const mesh = new THREE.Mesh(dustGeo, mat)
    mesh.visible = false
    mesh.renderOrder = 51
    burstRoot.add(mesh)
    burstParts.push({ mesh, mat })
  }

  const hideBurstParts = () => {
    for (const p of burstParts) {
      p.mesh.visible = false
    }
  }

  const placeBurstPart = (
    idx: number,
    geo: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    scale: number,
    opacity: number,
    rot: number,
  ) => {
    const p = burstParts[idx]
    if (!p) return
    p.mesh.geometry = geo
    p.mat.color.setHex(color)
    p.mat.opacity = opacity
    p.mesh.position.set(x, y, z)
    p.mesh.scale.set(scale, scale, scale)
    p.mesh.rotation.set(rot, rot * 0.7, rot * 1.3)
    p.mesh.visible = opacity > 0.02
  }

  const syncBursts = (
    bursts: Burst[],
    sites: Map<string, BurstSite>,
    tick: number,
    alpha: number,
  ) => {
    hideBurstParts()
    const a = Math.max(0, Math.min(1, alpha))
    let slot = 0
    for (const b of bursts) {
      if (slot >= BURST_SLOTS) break
      const site = sites.get(b.agentId)
      if (!site) {
        slot++
        continue
      }
      const age = b.ageTicks + a
      const life = 1 - age / (BURST_WINDOW + 1)
      if (life <= 0) {
        slot++
        continue
      }
      const rot0 = (b.seq % 8) * (Math.PI / 4)
      const base = slot * PARTS_PER_BURST
      if (b.kind === 'dust-puff') {
        for (let i = 0; i < PARTS_PER_BURST; i++) {
          const ang = rot0 + (i / PARTS_PER_BURST) * Math.PI * 2
          const rad = 0.12 + age * 0.18
          placeBurstPart(
            base + i,
            dustGeo,
            0xc9b58a,
            site.x + Math.cos(ang) * rad,
            site.y + 0.08 + age * 0.12,
            site.z + Math.sin(ang) * rad,
            0.7 + life * 0.8,
            life * 0.55,
            rot0 + i,
          )
        }
      } else if (b.kind === 'sparkle') {
        for (let i = 0; i < PARTS_PER_BURST; i++) {
          const ang = rot0 + (i / PARTS_PER_BURST) * Math.PI * 2
          const rise = 0.25 + age * 0.28
          placeBurstPart(
            base + i,
            starGeo,
            0xfff2a8,
            site.x + Math.cos(ang) * 0.16,
            site.y + rise,
            site.z + Math.sin(ang) * 0.16,
            0.55 + life * 0.7,
            life,
            rot0 + i * 0.4,
          )
        }
      } else if (b.kind === 'coin-glint') {
        const ox = site.other ? (site.x + site.other.x) / 2 : site.x
        const oy = site.other ? (site.y + site.other.y) / 2 : site.y
        const oz = site.other ? (site.z + site.other.z) / 2 : site.z
        for (let i = 0; i < 4; i++) {
          const ang = rot0 + (i / 4) * Math.PI * 2
          const rad = 0.08 + age * 0.1
          placeBurstPart(
            base + i,
            sparkGeo,
            0xffd24a,
            ox + Math.cos(ang) * rad,
            oy + 0.35 + Math.sin(age * 2 + i) * 0.06,
            oz + Math.sin(ang) * rad,
            0.7 + life * 0.5,
            life,
            rot0 + i,
          )
        }
      } else if (b.kind === 'shimmer') {
        const px = site.place?.x ?? site.x
        const py = (site.place?.y ?? site.y) + 0.45
        const pz = site.place?.z ?? site.z
        for (let i = 0; i < PARTS_PER_BURST; i++) {
          const ang = rot0 + (i / PARTS_PER_BURST) * Math.PI * 2 + age * 0.7
          placeBurstPart(
            base + i,
            starGeo,
            0xb8e0ff,
            px + Math.cos(ang) * 0.22,
            py + Math.sin(age + i) * 0.08,
            pz + Math.sin(ang) * 0.22,
            0.5 + life * 0.6,
            life * 0.9,
            rot0 + i * 0.5,
          )
        }
      }
      void tick
      slot++
    }
  }

  const update = (now: number) => {
    // Scrub / pause: don't invent a wall-clock step
    let dt = 0.016
    if (lastNow > 0) {
      const raw = (now - lastNow) / 1000
      if (raw < 0 || raw > 0.5) dt = 0
      else dt = Math.min(0.05, raw)
    }
    lastNow = now
    for (const p of pool) {
      if (!p.active) continue
      const age = now - p.born
      if (age >= p.ttl) {
        p.active = false
        p.mesh.visible = false
        continue
      }
      p.mesh.position.x += p.vx * dt
      p.mesh.position.y += p.vy * dt
      p.mesh.position.z += p.vz * dt
      p.vy -= 3.2 * dt
      p.mesh.rotation.z += p.spin * dt
      const life = 1 - age / p.ttl
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, life) * (p.kind === 'dust' ? 0.55 : 1)
      const s = 0.6 + life * 0.6
      p.mesh.scale.set(s, s, s)
    }
  }

  const activeCount = () => {
    let n = 0
    for (const p of pool) if (p.active) n++
    return n
  }

  const dispose = () => {
    scene.remove(root)
    for (const d of disposables) d.dispose()
  }

  return {
    root,
    update,
    puffWoodChips,
    puffStoneChips,
    spark,
    knockDust,
    sparkleBurst,
    greenBurst,
    syncBursts,
    activeCount,
    dispose,
  }
}

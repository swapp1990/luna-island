import * as THREE from 'three'

/** Pool size for short-lived juice particles. */
const POOL = 96
const CHIP_TTL = 450
const SPARK_TTL = 180
const STAR_TTL = 700
const BURST_TTL = 550

export type ParticleKind = 'wood' | 'stone' | 'spark' | 'dust' | 'star' | 'green'

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
  puffWoodChips: (x: number, y: number, z: number, n?: number) => void
  puffStoneChips: (x: number, y: number, z: number, n?: number) => void
  spark: (x: number, y: number, z: number) => void
  knockDust: (x: number, y: number, z: number) => void
  sparkleBurst: (x: number, y: number, z: number) => void
  greenBurst: (x: number, y: number, z: number) => void
  activeCount: () => number
  dispose: () => void
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
    p.spin = (Math.random() - 0.5) * 12
    p.mesh.geometry = kind === 'spark' ? sparkGeo : kind === 'star' ? starGeo : kind === 'dust' ? dustGeo : chipGeo
    p.mesh.material = mats[kind]
    p.mesh.position.set(x, y, z)
    p.mesh.scale.set(1, 1, 1)
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
    p.mesh.visible = true
    mats[kind].opacity = kind === 'dust' ? 0.55 : 1
  }

  const puffWoodChips = (x: number, y: number, z: number, n = 4) => {
    const now = performance.now()
    for (let i = 0; i < n; i++) {
      spawn(
        'wood',
        x + (Math.random() - 0.5) * 0.15,
        y + Math.random() * 0.1,
        z + (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 1.4,
        0.8 + Math.random() * 1.2,
        (Math.random() - 0.5) * 1.4,
        now,
        CHIP_TTL,
      )
    }
  }

  const puffStoneChips = (x: number, y: number, z: number, n = 3) => {
    const now = performance.now()
    for (let i = 0; i < n; i++) {
      spawn(
        'stone',
        x + (Math.random() - 0.5) * 0.12,
        y + Math.random() * 0.08,
        z + (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 1.2,
        0.6 + Math.random() * 1.0,
        (Math.random() - 0.5) * 1.2,
        now,
        CHIP_TTL,
      )
    }
  }

  const spark = (x: number, y: number, z: number) => {
    const now = performance.now()
    spawn(
      'spark',
      x,
      y,
      z,
      (Math.random() - 0.5) * 0.4,
      0.5 + Math.random() * 0.6,
      (Math.random() - 0.5) * 0.4,
      now,
      SPARK_TTL,
    )
  }

  const knockDust = (x: number, y: number, z: number) => {
    const now = performance.now()
    for (let i = 0; i < 3; i++) {
      spawn(
        'dust',
        x + (Math.random() - 0.5) * 0.2,
        y,
        z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.3,
        0.15 + Math.random() * 0.25,
        (Math.random() - 0.5) * 0.3,
        now,
        400,
      )
    }
  }

  const sparkleBurst = (x: number, y: number, z: number) => {
    const now = performance.now()
    const n = 8 + Math.floor(Math.random() * 5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3
      const sp = 0.9 + Math.random() * 1.1
      spawn(
        'star',
        x,
        y + 0.3,
        z,
        Math.cos(a) * sp,
        0.8 + Math.random() * 1.4,
        Math.sin(a) * sp,
        now,
        STAR_TTL,
      )
    }
  }

  const greenBurst = (x: number, y: number, z: number) => {
    const now = performance.now()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      spawn(
        'green',
        x,
        y + 0.4,
        z,
        Math.cos(a) * 0.7,
        0.5 + Math.random() * 0.9,
        Math.sin(a) * 0.7,
        now,
        BURST_TTL,
      )
    }
  }

  const update = (now: number) => {
    const dt = lastNow > 0 ? Math.min(0.05, (now - lastNow) / 1000) : 0.016
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
    activeCount,
    dispose,
  }
}

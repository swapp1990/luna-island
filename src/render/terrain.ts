import * as THREE from 'three'
import type { Place, TerrainKind, WorldState } from '../sim/types'

export interface TerrainHandle {
  root: THREE.Group
  dispose: () => void
}

const HEIGHTS: Record<Exclude<TerrainKind, 'water'>, number> = {
  sand: 0.12,
  grass: 0.2,
  forest: 0.22,
  rock: 0.55,
}

const COLORS: Record<TerrainKind, number> = {
  water: 0x3f7fae,
  sand: 0xe2cf9a,
  grass: 0x7fae5e,
  forest: 0x5f9147,
  rock: 0x7a7a7a,
}

/** Render-only mulberry32 from tile coords — never touches sim rng. */
function tileRng(x: number, y: number, salt: number): () => number {
  let a = ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildTerrain(scene: THREE.Scene, world: WorldState): TerrainHandle {
  const root = new THREE.Group()
  root.name = 'terrain'
  scene.add(root)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(obj: T): T => {
    disposables.push(obj)
    return obj
  }

  // Water: single plane
  {
    const geo = track(new THREE.PlaneGeometry(world.width + 4, world.height + 4))
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: COLORS.water,
        transparent: true,
        opacity: 0.82,
        roughness: 0.35,
        metalness: 0.05,
      }),
    )
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(world.width / 2 - 0.5, 0.06, world.height / 2 - 0.5)
    mesh.receiveShadow = true
    root.add(mesh)
  }

  // Collect tile positions per kind (excluding water)
  const byKind: Record<Exclude<TerrainKind, 'water'>, Array<{ x: number; y: number; elev: number }>> = {
    sand: [],
    grass: [],
    forest: [],
    rock: [],
  }

  for (const tile of world.tiles) {
    if (tile.kind === 'water') continue
    byKind[tile.kind].push({ x: tile.x, y: tile.y, elev: tile.elevation })
  }

  for (const kind of Object.keys(byKind) as Array<Exclude<TerrainKind, 'water'>>) {
    const list = byKind[kind]
    if (list.length === 0) continue
    const h = HEIGHTS[kind]
    const boxGeo = track(new THREE.BoxGeometry(1, h, 1))
    // Do NOT set vertexColors — breaks InstancedMesh.setColorAt
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: COLORS[kind],
        roughness: kind === 'rock' ? 0.9 : 0.85,
        metalness: 0,
      }),
    )
    const inst = new THREE.InstancedMesh(boxGeo, mat, list.length)
    inst.castShadow = kind === 'rock' || kind === 'forest'
    inst.receiveShadow = true
    const dummy = new THREE.Object3D()
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!
      dummy.position.set(t.x, h / 2, t.y)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
    root.add(inst)
  }

  // Trees on forest tiles
  {
    const forests = byKind.forest
    if (forests.length > 0) {
      const trunkGeo = track(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 6))
      const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x8a5a38, roughness: 0.9 }))
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, forests.length)
      trunkInst.castShadow = true

      const coneGeo = track(new THREE.ConeGeometry(0.35, 0.7, 7))
      const coneMat = track(new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.85 }))
      const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, forests.length)
      coneInst.castShadow = true

      const dummy = new THREE.Object3D()
      for (let i = 0; i < forests.length; i++) {
        const t = forests[i]!
        const rnd = tileRng(t.x, t.y, 42)
        const scale = 0.75 + rnd() * 0.5
        const rot = rnd() * Math.PI * 2
        const baseY = HEIGHTS.forest

        dummy.position.set(t.x, baseY + 0.175 * scale, t.y)
        dummy.rotation.set(0, rot, 0)
        dummy.scale.set(scale, scale, scale)
        dummy.updateMatrix()
        trunkInst.setMatrixAt(i, dummy.matrix)

        dummy.position.set(t.x, baseY + 0.35 * scale + 0.25 * scale, t.y)
        dummy.rotation.set(0, rot + 0.3, 0)
        dummy.scale.set(scale, scale, scale)
        dummy.updateMatrix()
        coneInst.setMatrixAt(i, dummy.matrix)
      }
      trunkInst.instanceMatrix.needsUpdate = true
      coneInst.instanceMatrix.needsUpdate = true
      root.add(trunkInst)
      root.add(coneInst)
    }
  }

  // Rocks on rock tiles
  {
    const rocks = byKind.rock
    if (rocks.length > 0) {
      const rockGeo = track(new THREE.DodecahedronGeometry(0.28, 0))
      const rockMat = track(new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 0.95 }))
      const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length)
      rockInst.castShadow = true
      rockInst.receiveShadow = true
      const dummy = new THREE.Object3D()
      for (let i = 0; i < rocks.length; i++) {
        const t = rocks[i]!
        const rnd = tileRng(t.x, t.y, 99)
        const s = 0.6 + rnd() * 0.8
        dummy.position.set(t.x + (rnd() - 0.5) * 0.2, HEIGHTS.rock + 0.15 * s, t.y + (rnd() - 0.5) * 0.2)
        dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI)
        dummy.scale.set(s, s * 0.7, s)
        dummy.updateMatrix()
        rockInst.setMatrixAt(i, dummy.matrix)
      }
      rockInst.instanceMatrix.needsUpdate = true
      root.add(rockInst)
    }
  }

  // Places
  for (const place of world.places) {
    addPlace(root, place, track)
  }

  const dispose = () => {
    scene.remove(root)
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        // geometries/materials tracked
      }
    })
    for (const d of disposables) d.dispose()
  }

  return { root, dispose }
}

function addPlace(
  root: THREE.Group,
  place: Place,
  track: <T extends { dispose: () => void }>(obj: T) => T,
): void {
  const baseY = 0.22
  if (place.kind === 'home') {
    const group = new THREE.Group()
    group.position.set(place.x, 0, place.y)

    const bodyGeo = track(new THREE.BoxGeometry(0.7, 0.45, 0.7))
    const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.85 }))
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = baseY + 0.225
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    const roofGeo = track(new THREE.ConeGeometry(0.55, 0.35, 4))
    const roofMat = track(new THREE.MeshStandardMaterial({ color: 0xb85c38, roughness: 0.8 }))
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.y = baseY + 0.45 + 0.15
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)

    root.add(group)
  } else if (place.kind === 'well') {
    const geo = track(new THREE.CylinderGeometry(0.28, 0.32, 0.35, 10))
    const mat = track(new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(place.x, baseY + 0.175, place.y)
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  } else if (place.kind === 'plaza') {
    const geo = track(new THREE.CylinderGeometry(1.4, 1.4, 0.06, 24))
    const mat = track(new THREE.MeshStandardMaterial({ color: 0xd4c9b0, roughness: 0.95 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(place.x, baseY + 0.02, place.y)
    mesh.receiveShadow = true
    root.add(mesh)
  } else if (place.kind === 'berry-bush') {
    const geo = track(new THREE.SphereGeometry(0.28, 8, 6))
    const mat = track(new THREE.MeshStandardMaterial({ color: 0x3d7a45, roughness: 0.8 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(place.x, baseY + 0.2, place.y)
    mesh.scale.set(1, 0.75, 1)
    mesh.castShadow = true
    root.add(mesh)

    // berries
    const berryGeo = track(new THREE.SphereGeometry(0.05, 5, 4))
    const berryMat = track(new THREE.MeshStandardMaterial({ color: 0xb83a4a, roughness: 0.6 }))
    for (let i = 0; i < 3; i++) {
      const berry = new THREE.Mesh(berryGeo, berryMat)
      const a = (i / 3) * Math.PI * 2
      berry.position.set(place.x + Math.cos(a) * 0.15, baseY + 0.28, place.y + Math.sin(a) * 0.15)
      root.add(berry)
    }
  }
}

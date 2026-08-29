/**
 * Construction-stage meshes (pad / timber frame / rising clip).
 * Shared by the live town and the /gallery inspector.
 */
import * as THREE from 'three'
import { hashString, seededRng } from './hash'

const PAD_DIRT = 0x6e5b44
const PAD_DIRT_DRY = 0x8a7358
const PILE_TIMBER = 0x5c4a34
const PILE_TIMBER_LIGHT = 0x6e5b44
const PILE_STONE = 0x8c8578
const PILE_STONE_DARK = 0x6e675c
const FRAME_OAK = 0x4a3826
const FRAME_OAK_LIGHT = 0x5c5142
const TWINE = 0xc9b896
const IRON = 0x2e2a26

export interface FrameOpts {
  /** Roof pitch in degrees. Steeper (church) vs shallow (stall). */
  roofPitchDeg?: number
}

function addBox(
  g: THREE.Group,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d)
  geos.push(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.rotation.y = rotY
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

function addCyl(
  g: THREE.Group,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  rTop: number,
  rBot: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
  rotX = 0,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, 6)
  geos.push(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.rotation.z = rotZ
  mesh.rotation.x = rotX
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

const Y_UP = new THREE.Vector3(0, 1, 0)

function addBeam(
  g: THREE.Group,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  thick = 0.1,
): THREE.Mesh {
  const dx = x1 - x0
  const dy = y1 - y0
  const dz = z1 - z0
  const len = Math.hypot(dx, dy, dz) || 0.01
  const geo = new THREE.BoxGeometry(thick, len, thick)
  geos.push(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  mesh.quaternion.setFromUnitVectors(Y_UP, new THREE.Vector3(dx / len, dy / len, dz / len))
  mesh.castShadow = true
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

/** Stage 1: cleared packed-dirt pad, corner stakes, timber + stone piles. */
export function buildPadStage(
  placeId: string,
  footprintM: { w: number; d: number },
  geosOwned: THREE.BufferGeometry[],
  matsOwned: THREE.Material[],
): THREE.Group {
  const g = new THREE.Group()
  const rng = seededRng(hashString(placeId, 0xbeef))
  const w = footprintM.w
  const d = footprintM.d

  const dirtMat = new THREE.MeshStandardMaterial({ color: PAD_DIRT, roughness: 0.96 })
  const dirtDry = new THREE.MeshStandardMaterial({ color: PAD_DIRT_DRY, roughness: 0.97 })
  const oak = new THREE.MeshStandardMaterial({ color: PILE_TIMBER, roughness: 0.88 })
  const oakL = new THREE.MeshStandardMaterial({ color: PILE_TIMBER_LIGHT, roughness: 0.9 })
  const stone = new THREE.MeshStandardMaterial({ color: PILE_STONE, roughness: 0.95 })
  const stoneD = new THREE.MeshStandardMaterial({ color: PILE_STONE_DARK, roughness: 0.95 })
  const twine = new THREE.MeshStandardMaterial({ color: TWINE, roughness: 0.8 })
  matsOwned.push(dirtMat, dirtDry, oak, oakL, stone, stoneD, twine)

  const padGeo = new THREE.BoxGeometry(w * 0.96, 0.08, d * 0.96)
  geosOwned.push(padGeo)
  const pad = new THREE.Mesh(padGeo, dirtMat)
  pad.position.y = 0.03
  pad.receiveShadow = true
  g.add(pad)
  // Disturbed edge ring
  const ringGeo = new THREE.BoxGeometry(w * 1.04, 0.03, d * 1.04)
  geosOwned.push(ringGeo)
  const ring = new THREE.Mesh(ringGeo, dirtDry)
  ring.position.y = 0.012
  ring.receiveShadow = true
  g.add(ring)

  const hw = w / 2 - 0.12
  const hd = d / 2 - 0.12
  const stakeH = 1.05
  for (const [sx, sz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ] as Array<[number, number]>) {
    addBox(g, geosOwned, oak, 0.07, stakeH, 0.07, sx, stakeH / 2, sz)
  }
  // Twine around the four stakes at ~0.85 m
  const twY = 0.82
  const twR = 0.012
  const segs: Array<[number, number, number, number]> = [
    [-hw, -hd, hw, -hd],
    [hw, -hd, hw, hd],
    [hw, hd, -hw, hd],
    [-hw, hd, -hw, -hd],
  ]
  for (const [x0, z0, x1, z1] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const geo = new THREE.CylinderGeometry(twR, twR, len, 4)
    geosOwned.push(geo)
    const mesh = new THREE.Mesh(geo, twine)
    mesh.position.set((x0 + x1) / 2, twY, (z0 + z1) / 2)
    mesh.rotation.z = Math.PI / 2
    mesh.rotation.y = Math.atan2(z1 - z0, x1 - x0)
    g.add(mesh)
  }

  // Timber pile — stacked logs, readable at inspect distance
  const logLen = Math.min(3.4, Math.max(2.2, w * 0.52))
  for (let row = 0; row < 4; row++) {
    const count = 5 - row
    for (let i = 0; i < count; i++) {
      const y = 0.12 + row * 0.18
      const z = -d * 0.28 + (i - (count - 1) / 2) * 0.2
      const x = -w * 0.28 + (rng() - 0.5) * 0.12
      addCyl(g, geosOwned, rng() > 0.45 ? oak : oakL, 0.09, 0.1, logLen, x, y, z, 0, Math.PI / 2)
    }
  }
  // Second timber crib on the far side
  for (let row = 0; row < 3; row++) {
    const count = 3 - row
    for (let i = 0; i < count; i++) {
      const y = 0.12 + row * 0.18
      const x = w * 0.08 + (i - (count - 1) / 2) * 0.2
      const z = -d * 0.34 + (rng() - 0.5) * 0.08
      addCyl(g, geosOwned, oakL, 0.07, 0.08, logLen * 0.72, x, y, z, Math.PI / 2, 0)
    }
  }

  // Stone pile
  for (let i = 0; i < 14; i++) {
    const sw = 0.3 + rng() * 0.36
    const sh = 0.18 + rng() * 0.24
    const sd = 0.24 + rng() * 0.3
    const x = w * 0.28 + (rng() - 0.5) * 0.7
    const z = d * 0.24 + (rng() - 0.5) * 0.55
    addBox(g, geosOwned, rng() > 0.5 ? stone : stoneD, sw, sh, sd, x, 0.08 + sh / 2, z, rng() * 0.9)
  }
  // Marker crate
  addBox(g, geosOwned, oak, 0.55, 0.38, 0.4, w * 0.18, 0.08 + 0.19, -d * 0.08)

  return g
}

/** Stage 2: posts, braces, wall-plates, rafters — a building skeleton, not a box. */
export function buildFrameStage(
  footprintM: { w: number; d: number },
  eaveH: number,
  geosOwned: THREE.BufferGeometry[],
  matsOwned: THREE.Material[],
  opts?: FrameOpts,
): THREE.Group {
  const g = new THREE.Group()
  const oak = new THREE.MeshStandardMaterial({ color: FRAME_OAK, roughness: 0.82 })
  const oakL = new THREE.MeshStandardMaterial({ color: FRAME_OAK_LIGHT, roughness: 0.85 })
  const iron = new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.55 })
  matsOwned.push(oak, oakL, iron)

  const postSize = 0.18
  const w = footprintM.w
  const d = footprintM.d
  const hw = w / 2 - postSize
  const hd = d / 2 - postSize
  const eave = Math.max(1.8, eaveH)
  const pitch = ((opts?.roofPitchDeg ?? 48) * Math.PI) / 180
  const ridgeAlongX = w >= d
  const halfSpan = ridgeAlongX ? d / 2 : w / 2
  const ridgeRise = Math.tan(pitch) * halfSpan
  const ridgeH = eave + Math.min(3.2, ridgeRise)

  const corners: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]
  for (const [px, pz] of corners) {
    addBox(g, geosOwned, oak, postSize, eave, postSize, px, eave / 2, pz)
  }
  // Mid-span posts on the long sides
  if (w > 5) {
    addBox(g, geosOwned, oak, postSize, eave, postSize, 0, eave / 2, -hd)
    addBox(g, geosOwned, oak, postSize, eave, postSize, 0, eave / 2, hd)
  }
  if (d > 5) {
    addBox(g, geosOwned, oak, postSize, eave, postSize, -hw, eave / 2, 0)
    addBox(g, geosOwned, oak, postSize, eave, postSize, hw, eave / 2, 0)
  }

  // Wall plates
  addBox(g, geosOwned, oakL, w - postSize, postSize, postSize, 0, eave, -hd)
  addBox(g, geosOwned, oakL, w - postSize, postSize, postSize, 0, eave, hd)
  addBox(g, geosOwned, oakL, postSize, postSize, d - postSize, -hw, eave, 0)
  addBox(g, geosOwned, oakL, postSize, postSize, d - postSize, hw, eave, 0)

  // Knee braces: diagonal from post to plate
  for (const [px, pz] of corners) {
    const ix = px > 0 ? -0.7 : 0.7
    const iz = pz > 0 ? -0.7 : 0.7
    addBeam(g, geosOwned, oakL, px, eave - 0.75, pz, px + ix, eave, pz, 0.08)
    addBeam(g, geosOwned, oakL, px, eave - 0.75, pz, px, eave, pz + iz, 0.08)
  }

  // Ridge + rafters that actually meet the ridge
  if (ridgeAlongX) {
    addBeam(g, geosOwned, oak, -hw, ridgeH, 0, hw, ridgeH, 0, postSize)
    const xs = w > 6 ? [-hw * 0.75, -hw * 0.25, hw * 0.25, hw * 0.75] : [-hw * 0.55, 0, hw * 0.55]
    for (const x of xs) {
      addBeam(g, geosOwned, oakL, x, eave, -hd, x, ridgeH, 0, 0.09)
      addBeam(g, geosOwned, oakL, x, eave, hd, x, ridgeH, 0, 0.09)
    }
  } else {
    addBeam(g, geosOwned, oak, 0, ridgeH, -hd, 0, ridgeH, hd, postSize)
    const zs = d > 6 ? [-hd * 0.75, -hd * 0.25, hd * 0.25, hd * 0.75] : [-hd * 0.55, 0, hd * 0.55]
    for (const z of zs) {
      addBeam(g, geosOwned, oakL, -hw, eave, z, 0, ridgeH, z, 0.09)
      addBeam(g, geosOwned, oakL, hw, eave, z, 0, ridgeH, z, 0.09)
    }
  }

  // Scaffold plank on one eave + a simple ladder
  addBox(g, geosOwned, oakL, w * 0.6, 0.05, 0.28, 0, eave + 0.08, -hd - 0.22)
  const ladderX = hw + 0.28
  addBox(g, geosOwned, oak, 0.06, eave + 0.3, 0.06, ladderX, (eave + 0.3) / 2, -0.18)
  addBox(g, geosOwned, oak, 0.06, eave + 0.3, 0.06, ladderX, (eave + 0.3) / 2, 0.18)
  for (let i = 1; i <= 5; i++) {
    const y = (i / 6) * eave
    addBox(g, geosOwned, oakL, 0.06, 0.05, 0.4, ladderX, y, 0)
  }

  return g
}

/** Clone materials so clipping planes don't leak onto the shared glTF cache. */
export function uniquifyMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone())
    else o.material = o.material.clone()
  })
}

/** World-space Y clip so a finished building "rises" without squash. */
export function applyWorldClipY(root: THREE.Object3D, worldY: number): void {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -worldY)
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      m.clippingPlanes = [plane]
      m.clipShadows = true
      m.needsUpdate = true
    }
  })
}

/** Plank deck hiding the clip slice. */
export function buildRisingDeck(
  footprintM: { w: number; d: number },
  y: number,
  geosOwned: THREE.BufferGeometry[],
  matsOwned: THREE.Material[],
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(footprintM.w * 0.9, 0.07, footprintM.d * 0.9)
  const mat = new THREE.MeshStandardMaterial({ color: FRAME_OAK_LIGHT, roughness: 0.88 })
  geosOwned.push(geo)
  matsOwned.push(mat)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = y
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

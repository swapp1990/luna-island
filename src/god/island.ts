import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { BEACH_END, BEACH_START, ISLAND_HALF, SEA_COLOR } from './constants'
import {
  authoredNormalAt,
  buildHeightfield,
  heightAt,
  normalAt,
  type HeightfieldData,
} from './islandHeight'

export interface IslandHandle {
  mesh: THREE.Mesh
  sea: THREE.Mesh
  data: HeightfieldData
  heightAt: (x: number, z: number) => number
  normalAt: (x: number, z: number) => { x: number; y: number; z: number }
  dispose: () => void
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** True greys only. Height + slope + beach ring so the form reads at 80 m. */
function greyFor(h: number, slope: number, x: number, z: number): THREE.Color {
  const r = Math.hypot(x, z)
  const beach = smoothstep(BEACH_START - 1.5, BEACH_END - 0.4, r)
  // Peaks light, meadow mid, steep faces dark. Range ~0.28–0.66 so fog at
  // 80 m still leaves hill A / hill B / meadow / beach as distinct bands.
  let g = 0.38 + h * 0.026 - slope * 0.55
  g = g * (1 - beach * 0.45) + 0.56 * beach
  g = Math.min(0.68, Math.max(0.26, g))
  return new THREE.Color(g, g, g)
}

export function createIsland(scene: THREE.Scene): IslandHandle {
  const data = buildHeightfield()
  const { nrows, ncols, heights, cell } = data

  const vertCount = nrows * ncols
  const positions = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)
  const indices: number[] = []

  for (let col = 0; col < ncols; col++) {
    for (let row = 0; row < nrows; row++) {
      const i = col * nrows + row
      const x = -ISLAND_HALF + col * cell
      const z = -ISLAND_HALF + row * cell
      const y = heights[i]!
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      if (col < ncols - 1 && row < nrows - 1) {
        const a = i
        const b = i + 1
        const c = (col + 1) * nrows + row
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }
  }

  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const n = authoredNormalAt(x, z)
    normals[i * 3] = n.x
    normals[i * 3 + 1] = n.y
    normals[i * 3 + 2] = n.z
    const slope = Math.hypot(n.x, n.z) / Math.max(n.y, 1e-6)
    const c = greyFor(y, slope, x, z)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setIndex(indices)
  geo.computeBoundingSphere()

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.03,
    flatShading: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  mesh.castShadow = true
  mesh.name = 'island'
  scene.add(mesh)

  // A disc, not a quad — no corners — with enough rings that some vertices
  // sit inside the frustum (a 2-triangle 8 km plane had every vertex beyond
  // the far plane and clipped to a rectangle). Radius sits past CAMERA_FAR.
  const seaGeo = new THREE.CircleGeometry(3200, 64)
  seaGeo.rotateX(-Math.PI / 2)
  const seaMat = new THREE.MeshStandardMaterial({
    color: SEA_COLOR,
    roughness: 0.48,
    metalness: 0.04,
    depthWrite: true,
  })
  const sea = new THREE.Mesh(seaGeo, seaMat)
  sea.position.y = 0
  sea.receiveShadow = true
  sea.frustumCulled = false
  sea.name = 'sea'
  scene.add(sea)

  return {
    mesh,
    sea,
    data,
    heightAt: (x, z) => heightAt(data, x, z),
    normalAt: (x, z) => normalAt(data, x, z),
    dispose: () => {
      scene.remove(mesh)
      scene.remove(sea)
      geo.dispose()
      mat.dispose()
      seaGeo.dispose()
      seaMat.dispose()
    },
  }
}

export function createIslandCollider(
  world: RAPIER.World,
  R: {
    RigidBodyDesc: typeof RAPIER.RigidBodyDesc
    ColliderDesc: typeof RAPIER.ColliderDesc
    ActiveEvents: typeof RAPIER.ActiveEvents
  },
  data: HeightfieldData,
): RAPIER.RigidBody {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 0, 0))
  // Rapier WASM treats nrows/ncols as *cell* counts; heights is (cells+1)^2.
  const desc = R.ColliderDesc.heightfield(
    data.nrows - 1,
    data.ncols - 1,
    data.heights,
    { x: data.scaleX, y: data.scaleY, z: data.scaleZ },
  )
    .setFriction(0.94)
    .setRestitution(0.02)
    .setContactForceEventThreshold(80)
    .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
  world.createCollider(desc, body)
  body.userData = 'terrain'
  return body
}

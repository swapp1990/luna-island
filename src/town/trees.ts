import * as THREE from 'three'
import type { WorldState } from '../sim/types'
import type { AssetCache } from './assets'
import { tileToWorld } from './coords'
import { TREE_FILES } from './manifest'
import { groundHeight } from './terrainHeight'
import { buildTreeExclusionSet, isTileExcluded, treesForTile } from './treePlan'

export interface TreesHandle {
  root: THREE.Group
  /** Total placed tree instances (island-wide). */
  count: () => number
  /** InstancedMesh draw calls contributed by trees (variant × submesh). */
  drawCalls: () => number
  dispose: () => void
}

interface Planned {
  x: number
  y: number
  z: number
  yawDeg: number
  scale: number
}

/**
 * V2: forest tiles get 1–3 trees each, deterministic per tile. One
 * InstancedMesh per (variant × submesh) — cheap regardless of tree count.
 */
export async function createTrees(
  scene: THREE.Scene,
  world: WorldState,
  cache: AssetCache,
): Promise<TreesHandle> {
  await cache.preload([...TREE_FILES])

  const root = new THREE.Group()
  root.name = 'trees'

  const pathTiles = world.tiles.filter((t) => t.path)
  const exclusion = buildTreeExclusionSet(world.places, pathTiles)

  const plannedByVariant: Planned[][] = TREE_FILES.map(() => [])
  let total = 0

  for (const tile of world.tiles) {
    if (tile.kind !== 'forest') continue
    if (isTileExcluded(tile.x, tile.y, exclusion)) continue
    const specs = treesForTile(tile.x, tile.y)
    const w = tileToWorld(tile.x, tile.y, world.width, world.height)
    const baseY = groundHeight(tile.x, tile.y, tile.kind)
    for (const s of specs) {
      plannedByVariant[s.variant]!.push({
        x: w.x + s.offsetX,
        z: w.z + s.offsetZ,
        y: baseY,
        yawDeg: s.yawDeg,
        scale: s.scale,
      })
      total += 1
    }
  }

  const meshes: THREE.InstancedMesh[] = []
  const dummy = new THREE.Object3D()

  for (let v = 0; v < TREE_FILES.length; v++) {
    const file = TREE_FILES[v]!
    const list = plannedByVariant[v]!
    const subs = cache.submeshes(file)
    if (!subs || subs.length === 0 || list.length === 0) continue
    const bounds = cache.bounds(file)
    const minY = bounds ? bounds.min.y : 0

    for (const sub of subs) {
      const inst = new THREE.InstancedMesh(sub.geometry, sub.material, list.length)
      inst.castShadow = true
      inst.receiveShadow = true
      for (let i = 0; i < list.length; i++) {
        const p = list[i]!
        dummy.position.set(p.x, p.y - minY * p.scale, p.z)
        dummy.rotation.set(0, THREE.MathUtils.degToRad(p.yawDeg), 0)
        dummy.scale.setScalar(p.scale)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
      root.add(inst)
      meshes.push(inst)
    }
  }

  scene.add(root)

  return {
    root,
    count: () => total,
    drawCalls: () => meshes.length,
    dispose: () => {
      scene.remove(root)
      // Submesh geometries/materials are owned by the asset cache — it
      // disposes them; InstancedMesh itself owns no extra GPU resources
      // beyond the instance matrix buffer, which GC reclaims with the mesh.
      meshes.length = 0
    },
  }
}

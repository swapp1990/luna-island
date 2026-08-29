import * as THREE from 'three'
import type { Tile, WorldState } from '../sim/types'
import { TILE_METRES } from './constants'
import { tileToWorld } from './coords'
import { tileHash01 } from './hash'
import { groundHeight, TILE_BASE_Y, terrainRelief } from './terrainHeight'

/**
 * Style-bible palette (specs/manor-slice-assets.md) — V3 ground colours.
 * Grass gets deterministic dry patches; forest floor reads darker than
 * canopy; water is a believable cool blue-green, not near-black.
 */
const GRASS = new THREE.Color('#7A8F4A')
const GRASS_DRY = new THREE.Color('#9AA05A')
const FOREST_FLOOR = new THREE.Color('#43542f')
const SAND = new THREE.Color('#B5A488')
const ROCK = new THREE.Color('#8C8578')
const WATER = new THREE.Color('#3E7E74')
const WATER_SHALLOW = new THREE.Color('#5FA79A')

/** V4: dirt-road wear blend, dry (light-worn) → packed (heavy-worn). */
const DIRT_DRY = new THREE.Color('#B5A488')
const DIRT_WORN = new THREE.Color('#6E5B44')

const DRY_PATCH_SALT = 0x9a115c11
/** Wear count (P5-1 `tile.wear`) at which the road blend fully saturates. */
const WEAR_SATURATE = 380
/** Radius (tiles) of the boot-time "packed dirt" baseline around plaza/well. */
const BASELINE_RADIUS = 2

export interface TerrainHandle {
  root: THREE.Group
  /** Re-derive tile colours from current wear — call as the sim runs (V4). */
  refreshWear: (world: WorldState) => void
  dispose: () => void
}

function baseColorFor(tile: Tile): THREE.Color {
  switch (tile.kind) {
    case 'grass': {
      const t = tileHash01(tile.x, tile.y, DRY_PATCH_SALT)
      const amt = t > 0.58 ? (t - 0.58) / 0.42 : 0
      return GRASS.clone().lerp(GRASS_DRY, amt)
    }
    case 'forest':
      return FOREST_FLOOR.clone()
    case 'sand':
      return SAND.clone()
    case 'rock':
      return ROCK.clone()
    case 'water':
      return WATER.clone()
  }
}

function buildBaselinePacked(world: WorldState): Set<string> {
  const set = new Set<string>()
  const centres = world.places.filter((p) => p.kind === 'plaza' || p.kind === 'well')
  for (const c of centres) {
    const cx = Math.round(c.x)
    const cy = Math.round(c.y)
    for (let dy = -BASELINE_RADIUS; dy <= BASELINE_RADIUS; dy++) {
      for (let dx = -BASELINE_RADIUS; dx <= BASELINE_RADIUS; dx++) {
        if (Math.hypot(dx, dy) > BASELINE_RADIUS + 0.5) continue
        set.add(`${cx + dx},${cy + dy}`)
      }
    }
  }
  return set
}

/** Wear fraction 0..1 driving the road blend — path corridors read as fully packed. */
function wear01For(tile: Tile, baseline: ReadonlySet<string>): number {
  if (tile.path) return 1
  if (baseline.has(`${tile.x},${tile.y}`)) return 0.65
  const w = tile.wear ?? 0
  return Math.min(1, w / WEAR_SATURATE)
}

function applyWear(base: THREE.Color, wear01: number): THREE.Color {
  if (wear01 <= 0) return base
  const dirt = DIRT_DRY.clone().lerp(DIRT_WORN, wear01)
  return base.clone().lerp(dirt, Math.min(1, wear01 * 1.1))
}

function tileColor(tile: Tile, baseline: ReadonlySet<string>): THREE.Color {
  return applyWear(baseColorFor(tile), wear01For(tile, baseline))
}

/** Land-kind neighbour used for relief (water tiles never contribute — flattens the shoreline). */
function reliefKindNeighbor(neighbors: Array<Tile | undefined>): Tile['kind'] | null {
  for (const t of neighbors) {
    if (t && t.kind !== 'water') return t.kind
  }
  return null
}

export function createTerrain(scene: THREE.Scene, world: WorldState): TerrainHandle {
  const root = new THREE.Group()
  root.name = 'terrain'
  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []

  const { width, height } = world
  const cornersW = width + 1
  const cornersH = height + 1
  const tileAt = (x: number, y: number): Tile | undefined =>
    x < 0 || y < 0 || x >= width || y >= height ? undefined : world.tiles[y * width + x]

  // --- Corner grid: shared vertices so land is one continuous heightfield,
  // never disjoint floating tiles with gaps at the seams.
  const cornerPos = new Float32Array(cornersW * cornersH * 3)
  const cornerColor = new Float32Array(cornersW * cornersH * 3)
  /** Per-corner contributing tile coords, for cheap wear re-colouring later. */
  const cornerTiles: Array<Array<{ x: number; y: number }>> = new Array(cornersW * cornersH)

  const cIdx = (i: number, j: number) => j * cornersW + i
  for (let j = 0; j < cornersH; j++) {
    for (let i = 0; i < cornersW; i++) {
      const neighbors = [
        tileAt(i - 1, j - 1),
        tileAt(i, j - 1),
        tileAt(i - 1, j),
        tileAt(i, j),
      ]
      const present = neighbors.filter((t): t is Tile => t !== undefined)
      const w = tileToWorld(i - 0.5, j - 0.5, width, height)

      let baseY = TILE_BASE_Y.grass
      let relief = 0
      const reliefKind = reliefKindNeighbor(neighbors)
      if (present.length > 0) {
        baseY = present.reduce((s, t) => s + TILE_BASE_Y[t.kind], 0) / present.length
      }
      if (reliefKind) {
        relief = terrainRelief(i, j, reliefKind)
      }
      const ci = cIdx(i, j)
      cornerPos[ci * 3] = w.x
      cornerPos[ci * 3 + 1] = baseY + relief
      cornerPos[ci * 3 + 2] = w.z
      cornerTiles[ci] = present.map((t) => ({ x: t.x, y: t.y }))
    }
  }

  const baseline = buildBaselinePacked(world)
  const paintCornerColors = () => {
    for (let ci = 0; ci < cornerTiles.length; ci++) {
      const tiles = cornerTiles[ci]!
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (const ref of tiles) {
        const t = tileAt(ref.x, ref.y)
        if (!t) continue
        const c = tileColor(t, baseline)
        r += c.r
        g += c.g
        b += c.b
        n += 1
      }
      if (n === 0) {
        r = GRASS.r
        g = GRASS.g
        b = GRASS.b
        n = 1
      }
      cornerColor[ci * 3] = r / n
      cornerColor[ci * 3 + 1] = g / n
      cornerColor[ci * 3 + 2] = b / n
    }
  }
  paintCornerColors()

  // Index buffer: one quad (2 tris) per non-water tile; water shows through.
  const indices: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = world.tiles[y * width + x]!
      if (t.kind === 'water') continue
      const a = cIdx(x, y)
      const b = cIdx(x + 1, y)
      const c = cIdx(x + 1, y + 1)
      const d = cIdx(x, y + 1)
      // Winding must produce a +Y-facing normal (camera looks down at it) —
      // (a,b,c)/(a,c,d) works out to -Y and back-face-culls the whole
      // terrain invisible, which is what made every ground-colour change
      // do nothing: we were seeing the water plane through it the whole time.
      indices.push(a, c, b, a, d, c)
    }
  }

  const landGeo = new THREE.BufferGeometry()
  landGeo.setAttribute('position', new THREE.BufferAttribute(cornerPos, 3))
  landGeo.setAttribute('color', new THREE.BufferAttribute(cornerColor, 3))
  landGeo.setIndex(indices)
  landGeo.computeVertexNormals()
  geos.push(landGeo)
  const landMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  })
  mats.push(landMat)
  const land = new THREE.Mesh(landGeo, landMat)
  land.receiveShadow = true
  land.castShadow = false
  root.add(land)

  // Water: a large plane past the tile rim (island edge never reads as a "sea
  // wall") plus a slightly lighter shallow ring at the shoreline tiles.
  const waterGeo = new THREE.PlaneGeometry(islandSpan(width) * 3.2, islandSpan(height) * 3.2)
  waterGeo.rotateX(-Math.PI / 2)
  geos.push(waterGeo)
  const waterMat = new THREE.MeshStandardMaterial({
    color: WATER,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
  })
  mats.push(waterMat)
  const water = new THREE.Mesh(waterGeo, waterMat)
  water.position.y = TILE_BASE_Y.water
  water.receiveShadow = true
  root.add(water)

  const shallow: Array<{ x: number; y: number }> = []
  for (const t of world.tiles) {
    if (t.kind !== 'water') continue
    const nx = [t.x + 1, t.x - 1, t.x, t.x]
    const ny = [t.y, t.y, t.y + 1, t.y - 1]
    for (let k = 0; k < 4; k++) {
      const n = tileAt(nx[k]!, ny[k]!)
      if (n && n.kind !== 'water') {
        shallow.push({ x: t.x, y: t.y })
        break
      }
    }
  }
  if (shallow.length > 0) {
    const sGeo = new THREE.PlaneGeometry(TILE_METRES * 1.02, TILE_METRES * 1.02)
    sGeo.rotateX(-Math.PI / 2)
    geos.push(sGeo)
    const sMat = new THREE.MeshStandardMaterial({
      color: WATER_SHALLOW,
      roughness: 0.4,
      metalness: 0.04,
      transparent: true,
      opacity: 0.86,
    })
    mats.push(sMat)
    const sInst = new THREE.InstancedMesh(sGeo, sMat, shallow.length)
    sInst.receiveShadow = true
    const dummy = new THREE.Object3D()
    for (let i = 0; i < shallow.length; i++) {
      const s = shallow[i]!
      const w = tileToWorld(s.x, s.y, width, height)
      dummy.position.set(w.x, TILE_BASE_Y.water + 0.03, w.z)
      dummy.updateMatrix()
      sInst.setMatrixAt(i, dummy.matrix)
    }
    sInst.instanceMatrix.needsUpdate = true
    root.add(sInst)
  }

  // Player-designated paths need to read as an intentional logistics graph,
  // even where the shared terrain vertices blend them into the plaza. A thin
  // inset decal keeps the organic wear blend while giving each commanded tile
  // an unmistakable packed-earth centre.
  const pathRoot = new THREE.Group()
  pathRoot.name = 'player-paths'
  const pathGeo = new THREE.PlaneGeometry(TILE_METRES * 0.86, TILE_METRES * 0.86)
  pathGeo.rotateX(-Math.PI / 2)
  geos.push(pathGeo)
  const pathMat = new THREE.MeshBasicMaterial({
    color: 0x5f4935,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  mats.push(pathMat)
  const pathMeshes = new Map<string, THREE.Mesh>()
  const bootPathKeys = new Set(
    world.tiles.filter((tile) => tile.path).map((tile) => `${tile.x},${tile.y}`),
  )
  const syncPathDecals = (activeWorld: WorldState): void => {
    const wanted = new Set<string>()
    for (const tile of activeWorld.tiles) {
      if (!tile.path) continue
      const key = `${tile.x},${tile.y}`
      // Worldgen paths already have the organic wear treatment. The stronger
      // inset is reserved for paths the player paints after boot.
      if (bootPathKeys.has(key)) continue
      wanted.add(key)
      if (pathMeshes.has(key)) continue
      const mesh = new THREE.Mesh(pathGeo, pathMat)
      const at = tileToWorld(tile.x, tile.y, activeWorld.width, activeWorld.height)
      mesh.position.set(at.x, groundHeight(tile.x, tile.y, tile.kind) + 0.075, at.z)
      mesh.renderOrder = 4
      pathMeshes.set(key, mesh)
      pathRoot.add(mesh)
    }
    for (const [key, mesh] of pathMeshes) {
      if (wanted.has(key)) continue
      pathRoot.remove(mesh)
      pathMeshes.delete(key)
    }
  }
  syncPathDecals(world)
  root.add(pathRoot)

  scene.add(root)
  return {
    root,
    refreshWear: (nextWorld: WorldState) => {
      // Re-paint corner colours in place from the current tile wear/path
      // state — cheap (one pass over the corner grid), called as the sim
      // advances so roads visibly tread in over days (V4).
      for (let j = 0; j < cornersH; j++) {
        for (let i = 0; i < cornersW; i++) {
          const ci = cIdx(i, j)
          const tiles = cornerTiles[ci]!
          let r = 0
          let g = 0
          let b = 0
          let n = 0
          for (const ref of tiles) {
            const t =
              ref.x < 0 || ref.y < 0 || ref.x >= nextWorld.width || ref.y >= nextWorld.height
                ? undefined
                : nextWorld.tiles[ref.y * nextWorld.width + ref.x]
            if (!t) continue
            const c = tileColor(t, baseline)
            r += c.r
            g += c.g
            b += c.b
            n += 1
          }
          if (n === 0) continue
          cornerColor[ci * 3] = r / n
          cornerColor[ci * 3 + 1] = g / n
          cornerColor[ci * 3 + 2] = b / n
        }
      }
      const attr = landGeo.getAttribute('color') as THREE.BufferAttribute
      attr.needsUpdate = true
      syncPathDecals(nextWorld)
    },
    dispose: () => {
      scene.remove(root)
      for (const g of geos) g.dispose()
      for (const m of mats) m.dispose()
    },
  }
}

function islandSpan(tiles: number): number {
  return tiles * TILE_METRES
}

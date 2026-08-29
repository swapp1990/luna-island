import * as THREE from 'three'
import type { Place, PlaceKind, TerrainKind, WorldState } from '../sim/types'
import type { AssetCache } from './assets'
import { buildFacingCandidates, instantiateFitted } from './buildingFit'
import type { CompletionFxHandle } from './completionFx'
import { TILE_METRES } from './constants'
import { footprintMetres, footprintTiles, placeholderHeight, tileToWorld } from './coords'
import { risingHeight01, stageForProgress } from './constructionPlan'
import { buildStructureVisuals, structureVisualSignature } from './structureVisuals'
import {
  applyWorldClipY,
  buildFrameStage,
  buildPadStage,
  uniquifyMaterials,
} from './constructionVisuals'
import { decidePlaceRender, resolveManifest } from './manifest'
import { hideDressHelpers } from './materialDress'
import { groundHeight } from './terrainHeight'

export interface PlaceListItem {
  id: string
  kind: string
  level?: number
  x: number
  z: number
  asset: 'gltf' | 'placeholder'
  /** XZ-fit scale actually applied (V1) — 1 for placeholders/procedural stages. */
  scale: number
  /** Measured world-space XZ half-extents of the actual rendered geometry (QA: interpenetration checks). */
  halfExtent: { x: number; z: number }
}

export interface PlacesHandle {
  root: THREE.Group
  list: () => PlaceListItem[]
  /** Render object for selection/highlight. The object may be replaced as its build stage changes. */
  objectFor: (placeId: string) => THREE.Object3D | null
  instanceStats: () => { loaded: number; fallback: number }
  /** Re-sync visuals from the current world (new places, kind/level/stage changes). Cheap — call every applied tick. */
  update: (world: WorldState) => void
  dispose: () => void
}

const KIND_GREY: Record<PlaceKind, number> = {
  home: 0x8a8a8a,
  school: 0x8a8a8a,
  farm: 0x6e5b44, // tilled soil (style bible)
  well: 0x909090,
  plaza: 0xb5a488, // packed dirt
  stall: 0x868482,
  storehouse: 0x8c8c8c,
  forestry: 0x5c5142, // weathered oak
  quarry: 0x8c8578, // fieldstone
  'construction-site': 0x7a7a7a,
  'notice-board': 0x858585,
  'berry-bush': 0x4a5f35, // shrub green
  spring: 0x5fa79a, // shallow water
}

/**
 * Kinds that are GROUND FEATURES, not structures: while they have no glTF
 * asset they render as a thin tinted pad on the terrain, never a grey slab.
 * (Boxes-as-buildings was the single worst offender in the P7-1a look review.)
 */
const GROUND_KINDS = new Set<PlaceKind>(['plaza', 'farm', 'spring'])
/** Bushy kinds render as a low green blob instead of a slab. */
const BUSH_KINDS = new Set<PlaceKind>(['berry-bush'])

function makePlaceholder(
  kind: PlaceKind,
  geosOwned: THREE.BufferGeometry[],
  matsOwned: THREE.Material[],
  neighborCapM: number,
): THREE.Object3D {
  const nominal = footprintMetres(kind)
  const w = Math.min(nominal.w, neighborCapM)
  const d = Math.min(nominal.d, neighborCapM)
  const mat = new THREE.MeshStandardMaterial({
    color: KIND_GREY[kind],
    roughness: 0.72,
    metalness: 0,
  })
  matsOwned.push(mat)

  if (kind === 'forestry') {
    const group = new THREE.Group()
    group.name = 'procedural-forestry-camp'
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x725030, roughness: 0.84 })
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x485d38, roughness: 0.9 })
    matsOwned.push(timberMat, roofMat)
    const postGeo = new THREE.BoxGeometry(0.16, 2.15, 0.16)
    const roofGeo = new THREE.BoxGeometry(Math.min(w, 3.1), 0.18, Math.min(d, 2.45))
    const logGeo = new THREE.CylinderGeometry(0.16, 0.19, 1.9, 8)
    geosOwned.push(postGeo, roofGeo, logGeo)
    for (const [x, z] of [[-1.15, -0.82], [1.15, -0.82], [-1.15, 0.82], [1.15, 0.82]] as Array<[number, number]>) {
      const post = new THREE.Mesh(postGeo, timberMat)
      post.position.set(x, 1.08, z)
      post.castShadow = true
      group.add(post)
    }
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.y = 2.18
    roof.rotation.z = 0.07
    roof.castShadow = true
    group.add(roof)
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(logGeo, timberMat)
      log.rotation.z = Math.PI / 2
      log.position.set(-0.25 + (i % 2) * 0.38, 0.2 + Math.floor(i / 2) * 0.3, 0.9)
      log.castShadow = true
      group.add(log)
    }
    return group
  }

  if (kind === 'quarry') {
    const group = new THREE.Group()
    group.name = 'procedural-quarry-yard'
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8f8879, roughness: 0.94 })
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x60452c, roughness: 0.86 })
    matsOwned.push(stoneMat, timberMat)
    const stoneGeo = new THREE.IcosahedronGeometry(0.52, 1)
    const beamGeo = new THREE.BoxGeometry(0.15, 2.45, 0.15)
    const crossGeo = new THREE.BoxGeometry(2.05, 0.15, 0.15)
    geosOwned.push(stoneGeo, beamGeo, crossGeo)
    for (let i = 0; i < 5; i++) {
      const stone = new THREE.Mesh(stoneGeo, stoneMat)
      stone.scale.set(1 + (i % 2) * 0.35, 0.62 + (i % 3) * 0.12, 0.82)
      stone.position.set(-0.9 + (i % 3) * 0.78, 0.32, -0.45 + Math.floor(i / 3) * 0.78)
      stone.rotation.y = i * 0.7
      stone.castShadow = true
      group.add(stone)
    }
    for (const x of [-0.92, 0.92]) {
      const beam = new THREE.Mesh(beamGeo, timberMat)
      beam.position.set(x, 1.24, 0.82)
      beam.castShadow = true
      group.add(beam)
    }
    const cross = new THREE.Mesh(crossGeo, timberMat)
    cross.position.set(0, 2.35, 0.82)
    cross.castShadow = true
    group.add(cross)
    return group
  }

  if (GROUND_KINDS.has(kind)) {
    // Flat tinted pad hugging the terrain — a ground feature, not a building.
    const geo = new THREE.BoxGeometry(w, 0.07, d)
    geosOwned.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = 0.05
    mesh.castShadow = false
    mesh.receiveShadow = true
    return mesh
  }

  if (BUSH_KINDS.has(kind)) {
    // Low green blob — reads as vegetation at every distance.
    const r = Math.min(w, d) * 0.45
    const geo = new THREE.IcosahedronGeometry(r, 1)
    geosOwned.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.y = 0.62
    mesh.position.y = r * 0.5
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  const h = placeholderHeight(kind)
  const geo = new THREE.BoxGeometry(w, h, d)
  geosOwned.push(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Nearest other place, centre-to-centre, in metres. The sim's tile layout
 * doesn't guarantee neighbours are a full nominal footprint apart (e.g. the
 * plaza hub packs the well/notice-board/stall close), so V1's footprint fit
 * also respects this — real elbow room, not just the nominal table.
 */
function nearestNeighborMetres(place: Place, world: WorldState): number {
  let best = Infinity
  for (const other of world.places) {
    if (other.id === place.id) continue
    const d = Math.hypot(other.x - place.x, other.y - place.y) * TILE_METRES
    if (d < best) best = d
  }
  return best
}

function tileKindAt(world: WorldState, x: number, y: number): TerrainKind {
  const tx = Math.min(world.width - 1, Math.max(0, Math.round(x)))
  const ty = Math.min(world.height - 1, Math.max(0, Math.round(y)))
  return world.tiles[ty * world.width + tx]!.kind
}

interface Rendered {
  signature: string
  kind: string
  asset: 'gltf' | 'placeholder'
  scale: number
  group: THREE.Group
}

function signatureFor(place: Place, world: WorldState): string {
  if (place.structure) return structureVisualSignature(place)
  if (place.kind === 'construction-site') {
    const progress = place.construction?.progress ?? 0
    const stage = stageForProgress(progress)
    const bucket = stage === 'rising' ? Math.round(progress * 50) : stage
    return `construction:${stage}:${bucket}`
  }
  const workers = world.agents.filter((agent) => agent.employedAt === place.id).length
  const growthBucket = place.kind === 'farm' ? Math.max(0, Math.min(4, Math.floor((place.growth ?? 0) * 5))) : 0
  const stockBucket = place.kind === 'storehouse'
    ? Math.max(0, Math.min(6, Math.ceil(Object.values(place.inventory).reduce((sum, value) => sum + (value ?? 0), 0) / 8)))
    : 0
  return `${place.kind}:${place.level ?? 1}:g${growthBucket}:s${stockBucket}:w${workers > 0 ? 1 : 0}`
}

export async function createPlaces(
  scene: THREE.Scene,
  world: WorldState,
  cache: AssetCache,
  files: string[],
  fx?: CompletionFxHandle,
): Promise<PlacesHandle> {
  await cache.preload(files)

  const root = new THREE.Group()
  root.name = 'places'
  const rendered = new Map<string, Rendered>()
  const geosOwned: THREE.BufferGeometry[] = []
  const matsOwned: THREE.Material[] = []
  const statusTextures = new Map<string, THREE.CanvasTexture>()
  const statusMaterials = new Map<string, THREE.SpriteMaterial>()
  let loaded = 0
  let fallback = 0
  let facingCandidates = buildFacingCandidates(world)
  let currentWorld = world

  const dressBox = (
    parent: THREE.Group,
    size: [number, number, number],
    position: [number, number, number],
    color: number,
  ): void => {
    const geometry = new THREE.BoxGeometry(...size)
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.76 })
    geosOwned.push(geometry)
    matsOwned.push(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
  }

  const decorateWorldState = (place: Place, group: THREE.Group, activeWorld: WorldState): void => {
    const level = Math.max(1, place.level ?? 1)
    for (let tier = 2; tier <= level; tier++) {
      const side = tier === 2 ? -1 : 1
      dressBox(group, [0.12, 1.9 + tier * 0.25, 0.12], [side * 1.35, 1.05 + tier * 0.12, -1.15], 0x5f4325)
      dressBox(group, [0.72, 0.38, 0.08], [side * 1.02, 1.65 + tier * 0.25, -1.15], tier === 2 ? 0xd4a84f : 0x70b887)
    }

    if (place.kind === 'farm') {
      const rows = Math.max(0, Math.min(5, Math.ceil((place.growth ?? 0) * 5)))
      for (let row = 0; row < rows; row++) {
        const z = -1.15 + row * 0.56
        const height = 0.12 + (place.growth ?? 0) * 0.34
        dressBox(group, [2.8, height, 0.16], [0, height / 2 + 0.08, z], row < 2 ? 0x6f9b42 : 0x91b950)
      }
    }

    if (place.kind === 'storehouse') {
      const stock = Object.values(place.inventory).reduce((sum, value) => sum + (value ?? 0), 0)
      const crates = Math.max(0, Math.min(6, Math.ceil(stock / 8)))
      for (let i = 0; i < crates; i++) {
        const col = i % 3
        const row = Math.floor(i / 3)
        dressBox(group, [0.48, 0.42, 0.48], [-0.58 + col * 0.58, 0.24 + row * 0.44, 1.35], 0x9a6a35)
      }
    }

    const workers = activeWorld.agents.filter((agent) => agent.employedAt === place.id).length
    if (place.production && workers > 0 && place.kind !== 'farm') {
      for (let i = 0; i < 3; i++) {
        const geometry = new THREE.SphereGeometry(0.18 + i * 0.05, 8, 6)
        const material = new THREE.MeshBasicMaterial({ color: 0xd8d1bd, transparent: true, opacity: 0.28 - i * 0.05, depthWrite: false })
        geosOwned.push(geometry)
        matsOwned.push(material)
        const smoke = new THREE.Mesh(geometry, material)
        smoke.position.set(0.72 + i * 0.12, 2.3 + i * 0.48, -0.55)
        group.add(smoke)
      }
    }
  }

  const statusKey = (place: Place, activeWorld: WorldState): string | null => {
    const workers = activeWorld.agents.filter((agent) => agent.employedAt === place.id).length
    if (place.kind === 'construction-site') {
      if (workers === 0) return 'builders'
      const missing = (place.construction?.needs.wood ?? 0) > (place.inventory.wood ?? 0)
        || (place.construction?.needs.stone ?? 0) > (place.inventory.stone ?? 0)
      if (missing) return 'materials'
    }
    if (place.production && workers === 0) return 'workers'
    return null
  }

  const statusMaterial = (key: string): THREE.SpriteMaterial => {
    const cached = statusMaterials.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = 112
    canvas.height = 112
    const ctx = canvas.getContext('2d')!
    const text = key === 'materials' ? 'MAT' : key === 'builders' ? 'BLD' : 'JOB'
    ctx.beginPath()
    ctx.arc(56, 56, 43, 0, Math.PI * 2)
    ctx.fillStyle = key === 'materials' ? '#a36b2d' : '#a13f35'
    ctx.fill()
    ctx.lineWidth = 7
    ctx.strokeStyle = '#f1d7a3'
    ctx.stroke()
    ctx.fillStyle = '#fff7df'
    ctx.font = 'bold 27px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 56, 57)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    statusTextures.set(key, texture)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    statusMaterials.set(key, material)
    return material
  }

  const syncStatusMarker = (place: Place, group: THREE.Group, activeWorld: WorldState): void => {
    const key = statusKey(place, activeWorld)
    let marker = group.getObjectByName('actionable-status') as THREE.Sprite | undefined
    if (!key) {
      if (marker) marker.visible = false
      return
    }
    if (!marker) {
      marker = new THREE.Sprite(statusMaterial(key))
      marker.name = 'actionable-status'
      marker.scale.set(1.55, 1.55, 1.55)
      marker.position.set(0, 5.2, 0)
      marker.renderOrder = 120
      group.add(marker)
    } else if (marker.userData.statusKey !== key) {
      marker.material = statusMaterial(key)
    }
    marker.userData.statusKey = key
    marker.visible = true
  }

  function buildVisual(
    place: Place,
    activeWorld: WorldState,
  ): { group: THREE.Group; asset: 'gltf' | 'placeholder'; scale: number } {
    const group = new THREE.Group()
    const tileKind = tileKindAt(activeWorld, place.x, place.y)
    const groundY = groundHeight(place.x, place.y, tileKind)
    group.position.y = groundY
    // Safety factor < 1/sqrt(2) so even a diagonal (45°) neighbour pair,
    // each independently capped by their own nearest distance, can never
    // sum to a real AABB overlap on both axes at once.
    const neighborCapM = nearestNeighborMetres(place, activeWorld) * 0.62

    if (place.structure) {
      group.add(buildStructureVisuals(place, geosOwned, matsOwned))
      return { group, asset: 'placeholder', scale: 1 }
    }

    if (place.kind === 'construction-site') {
      const nominalFootprintM = footprintMetres('construction-site')
      const cap = Math.min(nominalFootprintM.w, nominalFootprintM.d, neighborCapM)
      const footprintM = { w: cap, d: cap }
      const progress = place.construction?.progress ?? 0
      const stage = stageForProgress(progress)
      const targetKind = (place.construction?.targetKind ?? 'home') as PlaceKind

      if (stage === 'pad') {
        group.add(buildPadStage(place.id, footprintM, geosOwned, matsOwned))
        return { group, asset: 'placeholder', scale: 1 }
      }
      if (stage === 'frame') {
        const eaveH = Math.max(2.2, placeholderHeight(targetKind) * 0.55)
        group.add(buildFrameStage(footprintM, eaveH, geosOwned, matsOwned))
        return { group, asset: 'placeholder', scale: 1 }
      }

      // rising: scaffold stays, finished GLB is world-Y clipped (not squashed).
      const eaveH = Math.max(2.2, placeholderHeight(targetKind) * 0.55)
      group.add(buildFrameStage(footprintM, eaveH, geosOwned, matsOwned))
      const entry = resolveManifest(targetKind, 1)
      if (entry && cache.fileAvailable(entry.file)) {
        const fitted = instantiateFitted(
          cache,
          entry,
          place.id,
          place.x,
          place.y,
          footprintTiles('construction-site'),
          tileKind,
          facingCandidates,
          neighborCapM,
        )
        if (fitted) {
          uniquifyMaterials(fitted.object)
          hideDressHelpers(fitted.object)
          const h = (fitted.bounds.max.y - fitted.bounds.min.y) * fitted.scale
          const clipLocal = h * risingHeight01(progress)
          applyWorldClipY(fitted.object, groundY + clipLocal)
          fitted.object.position.y = -fitted.bounds.min.y * fitted.scale
          group.add(fitted.object)
          return { group, asset: 'gltf', scale: fitted.scale }
        }
      }
      return { group, asset: 'placeholder', scale: 1 }
    }

    const entry = resolveManifest(place.kind, place.level)
    const available = entry ? cache.fileAvailable(entry.file) : false
    const decision = decidePlaceRender(place.kind, place.level, available)
    if (decision === 'gltf' && entry) {
      const fitted = instantiateFitted(
        cache,
        entry,
        place.id,
        place.x,
        place.y,
        footprintTiles(place.kind),
        tileKind,
        facingCandidates,
        neighborCapM,
      )
      if (fitted) {
        // Object anchored in world Y already (buildingFit samples groundHeight
        // itself); undo the group's own groundY offset so it isn't applied twice.
        fitted.object.position.y -= groundY
        group.add(fitted.object)
        return { group, asset: 'gltf', scale: fitted.scale }
      }
    }
    group.add(makePlaceholder(place.kind, geosOwned, matsOwned, neighborCapM))
    return { group, asset: 'placeholder', scale: 1 }
  }

  function upsert(place: Place, activeWorld: WorldState, isBoot: boolean): void {
    const sig = signatureFor(place, activeWorld)
    const prev = rendered.get(place.id)
    if (prev && prev.signature === sig) {
      syncStatusMarker(place, prev.group, activeWorld)
      return
    }

    const wasCompleting = !isBoot && prev !== undefined && prev.kind === 'construction-site' && place.kind !== 'construction-site'

    if (prev) {
      root.remove(prev.group)
      if (prev.asset === 'gltf') loaded -= 1
      else fallback -= 1
    }

    const { group, asset, scale } = buildVisual(place, activeWorld)
    decorateWorldState(place, group, activeWorld)
    group.userData.placeId = place.id
    const w = tileToWorld(place.x, place.y, activeWorld.width, activeWorld.height)
    group.position.x = w.x
    group.position.z = w.z
    syncStatusMarker(place, group, activeWorld)
    root.add(group)
    rendered.set(place.id, { signature: sig, kind: place.kind, asset, scale, group })
    if (asset === 'gltf') loaded += 1
    else fallback += 1

    if (wasCompleting) {
      fx?.spawnDustPuff(w.x, group.position.y + 1, w.z)
    }
  }

  for (const place of world.places) {
    upsert(place, world, true)
  }

  scene.add(root)

  return {
    root,
    list: () => {
      const rows: PlaceListItem[] = []
      for (const place of currentWorld.places) {
        const r = rendered.get(place.id)
        if (!r) continue
        const w = tileToWorld(place.x, place.y, currentWorld.width, currentWorld.height)
        const box = new THREE.Box3().setFromObject(r.group)
        const halfExtent = { x: (box.max.x - box.min.x) / 2, z: (box.max.z - box.min.z) / 2 }
        const row: PlaceListItem = { id: place.id, kind: r.kind, x: w.x, z: w.z, asset: r.asset, scale: r.scale, halfExtent }
        if (place.level !== undefined) row.level = place.level
        rows.push(row)
      }
      return rows
    },
    objectFor: (placeId) => rendered.get(placeId)?.group ?? null,
    instanceStats: () => ({ loaded, fallback }),
    update: (nextWorld: WorldState) => {
      currentWorld = nextWorld
      facingCandidates = buildFacingCandidates(nextWorld)
      const seen = new Set<string>()
      for (const place of nextWorld.places) {
        seen.add(place.id)
        upsert(place, nextWorld, false)
      }
      for (const id of Array.from(rendered.keys())) {
        if (!seen.has(id)) {
          const r = rendered.get(id)!
          root.remove(r.group)
          if (r.asset === 'gltf') loaded -= 1
          else fallback -= 1
          rendered.delete(id)
        }
      }
    },
    dispose: () => {
      scene.remove(root)
      for (const g of geosOwned) g.dispose()
      for (const m of matsOwned) m.dispose()
      for (const material of statusMaterials.values()) material.dispose()
      for (const texture of statusTextures.values()) texture.dispose()
    },
  }
}

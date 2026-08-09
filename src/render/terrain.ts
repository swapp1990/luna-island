import * as THREE from 'three'
import type { Place, TerrainKind, WorldState } from '../sim/types'

export interface TerrainHandle {
  root: THREE.Group
  /** Show N berry dots on each bush from place inventory stock (0–6). */
  updateBushStock: (places: Place[]) => void
  /** Scale farm crops by growth; show stall/storehouse crates; sync dynamic sites. */
  updateEconomyVisuals: (places: Place[]) => void
  dispose: () => void
}

/** Materials pile + frame stages for a construction site (render-only). */
interface SiteVisual {
  group: THREE.Group
  frameLow: THREE.Object3D
  frameMid: THREE.Object3D
  frameHigh: THREE.Object3D
  pile: THREE.Object3D[]
}

const HEIGHTS: Record<Exclude<TerrainKind, 'water'>, number> = {
  sand: 0.12,
  grass: 0.2,
  forest: 0.22,
  rock: 0.55,
}

/** Rock terrace band heights (low / mid / high) — reads as a hill, not a slab. */
const ROCK_HEIGHTS = [0.55, 0.8, 1.05] as const
const ROCK_LOWER = 0x837c72 // warm stone lower
const ROCK_UPPER = 0x9a938a // warm stone upper

const COLORS: Record<TerrainKind, number> = {
  water: 0x3f7fae,
  sand: 0xe2cf9a,
  grass: 0x7fae5e,
  forest: 0x5f9147,
  rock: ROCK_LOWER,
}

const FOREST_GROUND = 0x4a7a38 // slightly darker — reads as forest without a tree
const PATH_COLOR = 0xc9b58a // packed dirt
const PLAZA_STONE = 0xcfc6b3
const FOLIAGE_A = 0x2f6b3a
const FOLIAGE_B = 0x3d7d46
const BOULDER_A = 0x8a8f98
const BOULDER_B = 0x6f747c
const BUSH_GREEN = 0x4e9b47
const BERRY_RED = 0xd95d67
const SHALLOW_WATER = 0x5fa3c9
const DEEP_WATER = 0x3f7fae
/** Match scene.ts Fog far so the water edge sits past the horizon fade. */
const FOG_FAR = 120

/** Map rock elevation → terrace band index 0..2. */
function rockBandIndex(elev: number, minE: number, maxE: number): number {
  if (maxE <= minE) return 1
  const u = (elev - minE) / (maxE - minE)
  if (u < 1 / 3) return 0
  if (u < 2 / 3) return 1
  return 2
}

function rockTileHeight(elev: number, minE: number, maxE: number): number {
  return ROCK_HEIGHTS[rockBandIndex(elev, minE, maxE)]!
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

/** Deterministic [0,1) hash for sparse decoration decisions. */
function tileHash01(x: number, y: number, salt: number): number {
  return tileRng(x, y, salt)()
}

function isLandAdjacentWater(world: WorldState, x: number, y: number): boolean {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (const [dx, dy] of dirs) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue
    const t = world.tiles[ny * world.width + nx]!
    if (t.kind !== 'water') return true
  }
  return false
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

  // Water: deep base plane (extends past fog far so horizon is seamless) + shallow shoreline quads
  {
    const waterSize = Math.max(world.width, world.height) + FOG_FAR * 2
    const geo = track(new THREE.PlaneGeometry(waterSize, waterSize))
    const mat = track(
      new THREE.MeshStandardMaterial({
        color: DEEP_WATER,
        transparent: true,
        opacity: 0.82,
        roughness: 0.35,
        metalness: 0.05,
      }),
    )
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(world.width / 2 - 0.5, 0.04, world.height / 2 - 0.5)
    mesh.receiveShadow = true
    root.add(mesh)

    const shallowTiles: Array<{ x: number; y: number }> = []
    for (const tile of world.tiles) {
      if (tile.kind !== 'water') continue
      if (isLandAdjacentWater(world, tile.x, tile.y)) {
        shallowTiles.push({ x: tile.x, y: tile.y })
      }
    }
    if (shallowTiles.length > 0) {
      const sGeo = track(new THREE.PlaneGeometry(1.02, 1.02))
      const sMat = track(
        new THREE.MeshStandardMaterial({
          color: SHALLOW_WATER,
          transparent: true,
          opacity: 0.88,
          roughness: 0.4,
          metalness: 0.04,
        }),
      )
      const sInst = new THREE.InstancedMesh(sGeo, sMat, shallowTiles.length)
      sInst.receiveShadow = true
      const dummy = new THREE.Object3D()
      for (let i = 0; i < shallowTiles.length; i++) {
        const t = shallowTiles[i]!
        dummy.position.set(t.x, 0.065, t.y)
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        sInst.setMatrixAt(i, dummy.matrix)
      }
      sInst.instanceMatrix.needsUpdate = true
      root.add(sInst)
    }
  }

  // Collect land tiles
  type LandTile = { x: number; y: number; elev: number; kind: Exclude<TerrainKind, 'water'>; path?: boolean }
  const land: LandTile[] = []
  const byKind: Record<Exclude<TerrainKind, 'water'>, LandTile[]> = {
    sand: [],
    grass: [],
    forest: [],
    rock: [],
  }

  for (const tile of world.tiles) {
    if (tile.kind === 'water') continue
    const entry: LandTile = {
      x: tile.x,
      y: tile.y,
      elev: tile.elevation,
      kind: tile.kind,
      path: tile.path,
    }
    land.push(entry)
    byKind[tile.kind].push(entry)
  }

  // Ground boxes — path tiles get packed-dirt color over any walkable kind
  {
    const pathTiles = land.filter((t) => t.path)
    const nonPath = land.filter((t) => !t.path)

    // Non-path by kind (forest ground slightly darker). Rock is terraced separately.
    for (const kind of Object.keys(byKind) as Array<Exclude<TerrainKind, 'water'>>) {
      if (kind === 'rock') continue
      const list = nonPath.filter((t) => t.kind === kind)
      if (list.length === 0) continue
      const h = HEIGHTS[kind]
      const boxGeo = track(new THREE.BoxGeometry(1, h, 1))
      const color = kind === 'forest' ? FOREST_GROUND : COLORS[kind]
      const mat = track(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.85,
          metalness: 0,
        }),
      )
      const inst = new THREE.InstancedMesh(boxGeo, mat, list.length)
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

    // Rock: 2–3 elevation bands (heights 0.55 / 0.8 / 1.05), warm stone palette
    {
      const rocks = nonPath.filter((t) => t.kind === 'rock')
      if (rocks.length > 0) {
        let minE = Infinity
        let maxE = -Infinity
        for (const t of rocks) {
          if (t.elev < minE) minE = t.elev
          if (t.elev > maxE) maxE = t.elev
        }
        const bands: LandTile[][] = [[], [], []]
        for (const t of rocks) {
          bands[rockBandIndex(t.elev, minE, maxE)]!.push(t)
        }
        for (let bi = 0; bi < 3; bi++) {
          const list = bands[bi]!
          if (list.length === 0) continue
          const h = ROCK_HEIGHTS[bi]!
          // lower two bands cooler-warm; top band lighter warm stone
          const color = bi >= 2 ? ROCK_UPPER : ROCK_LOWER
          const boxGeo = track(new THREE.BoxGeometry(1, h, 1))
          const mat = track(
            new THREE.MeshStandardMaterial({
              color,
              roughness: 0.9,
              metalness: 0,
            }),
          )
          const inst = new THREE.InstancedMesh(boxGeo, mat, list.length)
          inst.castShadow = true
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
      }
    }

    // Path tiles as packed-dirt boxes (slightly lower than grass so they read)
    if (pathTiles.length > 0) {
      const h = 0.18
      const boxGeo = track(new THREE.BoxGeometry(1, h, 1))
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: PATH_COLOR,
          roughness: 0.92,
          metalness: 0,
        }),
      )
      const inst = new THREE.InstancedMesh(boxGeo, mat, pathTiles.length)
      inst.receiveShadow = true
      const dummy = new THREE.Object3D()
      for (let i = 0; i < pathTiles.length; i++) {
        const t = pathTiles[i]!
        dummy.position.set(t.x, h / 2, t.y)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
      root.add(inst)
    }
  }

  // Trees on ~45% of forest tiles (deterministic), scale 0.7–1.3, two foliage greens
  {
    const forests = byKind.forest
    const treeTiles = forests.filter((t) => tileHash01(t.x, t.y, 42) < 0.45)
    if (treeTiles.length > 0) {
      const trunkGeo = track(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 6))
      const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x8a5a38, roughness: 0.9 }))
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeTiles.length)
      trunkInst.castShadow = true

      const coneGeo = track(new THREE.ConeGeometry(0.35, 0.7, 7))
      // Two foliage materials via two instanced meshes split by hash
      const foliageA: typeof treeTiles = []
      const foliageB: typeof treeTiles = []
      for (const t of treeTiles) {
        if (tileHash01(t.x, t.y, 43) < 0.5) foliageA.push(t)
        else foliageB.push(t)
      }

      const dummy = new THREE.Object3D()
      for (let i = 0; i < treeTiles.length; i++) {
        const t = treeTiles[i]!
        const rnd = tileRng(t.x, t.y, 42)
        const scale = 0.7 + rnd() * 0.6 // 0.7–1.3
        const yaw = (rnd() - 0.5) * 0.6 // tiny random yaw
        const baseY = HEIGHTS.forest

        dummy.position.set(t.x, baseY + 0.175 * scale, t.y)
        dummy.rotation.set(0, yaw, 0)
        dummy.scale.set(scale, scale, scale)
        dummy.updateMatrix()
        trunkInst.setMatrixAt(i, dummy.matrix)
      }
      trunkInst.instanceMatrix.needsUpdate = true
      root.add(trunkInst)

      const placeFoliage = (list: typeof treeTiles, color: number) => {
        if (list.length === 0) return
        const mat = track(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }))
        const inst = new THREE.InstancedMesh(coneGeo, mat, list.length)
        inst.castShadow = true
        for (let i = 0; i < list.length; i++) {
          const t = list[i]!
          const rnd = tileRng(t.x, t.y, 42)
          const scale = 0.7 + rnd() * 0.6
          const yaw = (rnd() - 0.5) * 0.6 + 0.3
          const baseY = HEIGHTS.forest
          dummy.position.set(t.x, baseY + 0.35 * scale + 0.25 * scale, t.y)
          dummy.rotation.set(0, yaw, 0)
          dummy.scale.set(scale, scale, scale)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
        }
        inst.instanceMatrix.needsUpdate = true
        root.add(inst)
      }
      placeFoliage(foliageA, FOLIAGE_A)
      placeFoliage(foliageB, FOLIAGE_B)
    }
  }

  // Rocks: terraced terrain already drawn; ~15% get a boulder (no trees here)
  {
    const rocks = byKind.rock
    let minE = Infinity
    let maxE = -Infinity
    for (const t of rocks) {
      if (t.elev < minE) minE = t.elev
      if (t.elev > maxE) maxE = t.elev
    }
    const boulderTiles = rocks.filter((t) => tileHash01(t.x, t.y, 99) < 0.15)
    if (boulderTiles.length > 0) {
      const rockGeo = track(new THREE.DodecahedronGeometry(0.28, 0))
      const bouldersA = boulderTiles.filter((t) => tileHash01(t.x, t.y, 100) < 0.5)
      const bouldersB = boulderTiles.filter((t) => tileHash01(t.x, t.y, 100) >= 0.5)

      const placeBoulders = (list: typeof boulderTiles, color: number) => {
        if (list.length === 0) return
        const mat = track(new THREE.MeshStandardMaterial({ color, roughness: 0.95 }))
        const inst = new THREE.InstancedMesh(rockGeo, mat, list.length)
        inst.castShadow = true
        inst.receiveShadow = true
        const dummy = new THREE.Object3D()
        for (let i = 0; i < list.length; i++) {
          const t = list[i]!
          const rnd = tileRng(t.x, t.y, 99)
          const s = 0.5 + rnd() * 0.5 // 0.5–1.0
          const baseH = rockTileHeight(t.elev, minE, maxE)
          dummy.position.set(
            t.x + (rnd() - 0.5) * 0.2,
            baseH + 0.15 * s,
            t.y + (rnd() - 0.5) * 0.2,
          )
          dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI)
          dummy.scale.set(s, s * 0.7, s)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
        }
        inst.instanceMatrix.needsUpdate = true
        root.add(inst)
      }
      placeBoulders(bouldersA, BOULDER_A)
      placeBoulders(bouldersB, BOULDER_B)
    }
  }

  // Places — berry meshes keyed by place id for stock-driven visibility
  const bushBerries = new Map<string, THREE.Mesh[]>()
  const farmCrops = new Map<string, THREE.Object3D[]>()
  const stallCrates = new Map<string, THREE.Mesh[]>()
  const storeCrates = new Map<string, THREE.Mesh[]>()
  const siteVisuals = new Map<string, SiteVisual>()
  const dynamicHomes = new Map<string, THREE.Group>()
  const staticIds = new Set(world.places.map((p) => p.id))
  const plaza = world.places.find((p) => p.kind === 'plaza')
  for (const place of world.places) {
    addPlace(root, place, track, plaza, bushBerries, farmCrops, stallCrates, storeCrates, siteVisuals)
  }

  const updateBushStock = (places: Place[]) => {
    for (const place of places) {
      if (place.kind !== 'berry-bush') continue
      const berries = bushBerries.get(place.id)
      if (!berries) continue
      const stock = Math.max(0, Math.min(6, Math.floor(place.inventory?.food ?? 0)))
      for (let i = 0; i < berries.length; i++) {
        berries[i]!.visible = i < stock
      }
    }
  }

  const syncDynamicPlaces = (places: Place[]) => {
    const liveIds = new Set(places.map((p) => p.id))
    // Remove dynamic visuals for places that vanished
    for (const id of [...siteVisuals.keys()]) {
      if (!liveIds.has(id)) {
        const v = siteVisuals.get(id)!
        root.remove(v.group)
        siteVisuals.delete(id)
      }
    }
    for (const id of [...dynamicHomes.keys()]) {
      if (!liveIds.has(id)) {
        root.remove(dynamicHomes.get(id)!)
        dynamicHomes.delete(id)
      }
    }
    for (const place of places) {
      if (place.kind === 'construction-site') {
        if (!siteVisuals.has(place.id)) {
          const vis = buildSiteVisual(place, track, plaza)
          root.add(vis.group)
          siteVisuals.set(place.id, vis)
        }
        const vis = siteVisuals.get(place.id)!
        const prog = place.construction?.progress ?? 0
        vis.frameLow.visible = prog < 1
        vis.frameMid.visible = prog >= 1 / 3 && prog < 1
        vis.frameHigh.visible = prog >= 2 / 3 && prog < 1
        const remaining =
          (place.construction?.needs?.wood ?? 0) +
          (place.construction?.needs?.stone ?? 0)
        const pileN = Math.min(vis.pile.length, Math.ceil(remaining / 3))
        for (let i = 0; i < vis.pile.length; i++) {
          vis.pile[i]!.visible = i < pileN
        }
      } else if (place.kind === 'home' && !staticIds.has(place.id)) {
        // Completed private house: remove site visual, add home mesh once
        if (siteVisuals.has(place.id)) {
          root.remove(siteVisuals.get(place.id)!.group)
          siteVisuals.delete(place.id)
        }
        if (!dynamicHomes.has(place.id)) {
          const g = buildHomeMesh(place, track, plaza)
          root.add(g)
          dynamicHomes.set(place.id, g)
        }
      }
    }
  }

  const updateEconomyVisuals = (places: Place[]) => {
    updateBushStock(places)
    syncDynamicPlaces(places)
    for (const place of places) {
      if (place.kind === 'farm') {
        const crops = farmCrops.get(place.id)
        if (!crops) continue
        const g = Math.max(0, Math.min(1, place.growth ?? 0))
        // Scale crops with growth; keep a tiny minimum so empty plots still read
        const s = 0.15 + g * 0.85
        for (const crop of crops) {
          crop.scale.set(s, s, s)
          crop.visible = g > 0.02 || (place.inventory?.food ?? 0) > 0
          if ((place.inventory?.food ?? 0) > 0 && g < 0.02) {
            // Ready harvest piles: full size green even after growth reset
            crop.scale.set(1, 1, 1)
            crop.visible = true
          }
        }
      }
      if (place.kind === 'stall') {
        const crates = stallCrates.get(place.id)
        if (!crates) continue
        const stock = Math.max(0, Math.floor(place.inventory?.food ?? 0))
        // Show up to 8 crates proportional to stock
        const n = Math.min(crates.length, Math.ceil(stock / 2))
        for (let i = 0; i < crates.length; i++) {
          crates[i]!.visible = i < n
        }
      }
      if (place.kind === 'storehouse') {
        const crates = storeCrates.get(place.id)
        if (!crates) continue
        const stock =
          Math.max(0, Math.floor(place.inventory?.wood ?? 0)) +
          Math.max(0, Math.floor(place.inventory?.stone ?? 0))
        const n = Math.min(crates.length, Math.ceil(stock / 2))
        for (let i = 0; i < crates.length; i++) {
          crates[i]!.visible = i < n
        }
      }
    }
  }

  // Initial stock visibility
  updateEconomyVisuals(world.places)

  const dispose = () => {
    scene.remove(root)
    root.traverse(() => {
      // geometries/materials tracked
    })
    for (const d of disposables) d.dispose()
    bushBerries.clear()
    farmCrops.clear()
    stallCrates.clear()
    storeCrates.clear()
    siteVisuals.clear()
    dynamicHomes.clear()
  }

  return { root, updateBushStock, updateEconomyVisuals, dispose }
}

function buildHomeMesh(
  place: Place,
  track: <T extends { dispose: () => void }>(obj: T) => T,
  plaza: Place | undefined,
  opts?: { wide?: boolean; chimney?: boolean },
): THREE.Group {
  const baseY = 0.22
  const group = new THREE.Group()
  group.position.set(place.x, 0, place.y)
  if (plaza) {
    const dx = plaza.x - place.x
    const dz = plaza.y - place.y
    group.rotation.y = Math.atan2(dx, dz)
  }
  const w = opts?.wide ? 1.0 : 0.7
  const d = opts?.wide ? 0.85 : 0.7
  const bodyGeo = track(new THREE.BoxGeometry(w, 0.45, d))
  const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.85 }))
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = baseY + 0.225
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const roofGeo = track(new THREE.ConeGeometry(opts?.wide ? 0.7 : 0.55, 0.35, 4))
  const roofMat = track(new THREE.MeshStandardMaterial({ color: 0xb85c38, roughness: 0.8 }))
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.y = baseY + 0.45 + 0.15
  roof.rotation.y = Math.PI / 4
  roof.castShadow = true
  group.add(roof)

  if (opts?.chimney !== false && !opts?.wide) {
    const chimGeo = track(new THREE.BoxGeometry(0.12, 0.28, 0.12))
    const chimMat = track(new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.9 }))
    const chim = new THREE.Mesh(chimGeo, chimMat)
    chim.position.set(0.22, baseY + 0.55, -0.15)
    chim.castShadow = true
    group.add(chim)
  }
  return group
}

function buildSiteVisual(
  place: Place,
  track: <T extends { dispose: () => void }>(obj: T) => T,
  plaza: Place | undefined,
): SiteVisual {
  const baseY = 0.22
  const group = new THREE.Group()
  group.position.set(place.x, 0, place.y)
  if (plaza) {
    const dx = plaza.x - place.x
    const dz = plaza.y - place.y
    group.rotation.y = Math.atan2(dx, dz)
  }
  const woodMat = track(new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 }))
  const postGeo = track(new THREE.BoxGeometry(0.08, 0.55, 0.08))
  // <⅓ timber frame outline
  const frameLow = new THREE.Group()
  for (const [ox, oz] of [
    [-0.35, -0.35],
    [0.35, -0.35],
    [-0.35, 0.35],
    [0.35, 0.35],
  ] as Array<[number, number]>) {
    const post = new THREE.Mesh(postGeo, woodMat)
    post.position.set(ox, baseY + 0.28, oz)
    post.castShadow = true
    frameLow.add(post)
  }
  group.add(frameLow)
  // <⅔ walls
  const frameMid = new THREE.Group()
  const wallGeo = track(new THREE.BoxGeometry(0.7, 0.35, 0.06))
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0xb8956a, roughness: 0.88 }))
  for (const [ox, oz, ry] of [
    [0, -0.35, 0],
    [0, 0.35, 0],
    [-0.35, 0, Math.PI / 2],
    [0.35, 0, Math.PI / 2],
  ] as Array<[number, number, number]>) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(ox, baseY + 0.2, oz)
    wall.rotation.y = ry
    wall.castShadow = true
    frameMid.add(wall)
  }
  frameMid.visible = false
  group.add(frameMid)
  // roof stage
  const frameHigh = new THREE.Group()
  const roofGeo = track(new THREE.ConeGeometry(0.5, 0.28, 4))
  const roofMat = track(new THREE.MeshStandardMaterial({ color: 0xb85c38, roughness: 0.8 }))
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.y = baseY + 0.55
  roof.rotation.y = Math.PI / 4
  roof.castShadow = true
  frameHigh.add(roof)
  frameHigh.visible = false
  group.add(frameHigh)

  const pile: THREE.Object3D[] = []
  const pileGeo = track(new THREE.BoxGeometry(0.18, 0.12, 0.18))
  const pileMat = track(new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 0.9 }))
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(pileGeo, pileMat)
    m.position.set(0.55 + (i % 3) * 0.2, baseY + 0.06, 0.4 + Math.floor(i / 3) * 0.2)
    m.castShadow = true
    group.add(m)
    pile.push(m)
  }
  return { group, frameLow, frameMid, frameHigh, pile }
}

function addPlace(
  root: THREE.Group,
  place: Place,
  track: <T extends { dispose: () => void }>(obj: T) => T,
  plaza: Place | undefined,
  bushBerries: Map<string, THREE.Mesh[]>,
  farmCrops: Map<string, THREE.Object3D[]>,
  stallCrates: Map<string, THREE.Mesh[]>,
  storeCrates: Map<string, THREE.Mesh[]>,
  siteVisuals: Map<string, SiteVisual>,
): void {
  const baseY = 0.22
  if (place.kind === 'home') {
    root.add(buildHomeMesh(place, track, plaza))
  } else if (place.kind === 'well') {
    const group = new THREE.Group()
    group.position.set(place.x, 0, place.y)

    // Stone cylinder
    const geo = track(new THREE.CylinderGeometry(0.28, 0.32, 0.4, 12))
    const mat = track(new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = baseY + 0.2
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)

    // Wooden A-frame: two dark beams + tiny pitched roof
    const beamMat = track(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }))
    const beamGeo = track(new THREE.BoxGeometry(0.06, 0.55, 0.06))
    const beamL = new THREE.Mesh(beamGeo, beamMat)
    beamL.position.set(-0.22, baseY + 0.55, 0)
    beamL.rotation.z = 0.25
    beamL.castShadow = true
    group.add(beamL)
    const beamR = new THREE.Mesh(beamGeo, beamMat)
    beamR.position.set(0.22, baseY + 0.55, 0)
    beamR.rotation.z = -0.25
    beamR.castShadow = true
    group.add(beamR)

    // Tiny pitched roof (two slats)
    const roofMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.85 }))
    const slatGeo = track(new THREE.BoxGeometry(0.55, 0.04, 0.28))
    const slatL = new THREE.Mesh(slatGeo, roofMat)
    slatL.position.set(0, baseY + 0.82, 0)
    slatL.rotation.z = 0.35
    slatL.castShadow = true
    group.add(slatL)
    const slatR = new THREE.Mesh(slatGeo, roofMat)
    slatR.position.set(0, baseY + 0.82, 0)
    slatR.rotation.z = -0.35
    slatR.castShadow = true
    group.add(slatR)

    root.add(group)
  } else if (place.kind === 'plaza') {
    // Light-stone disc flush with grass top (half-thickness + tiny epsilon, no gap shadow)
    const discH = 0.06
    const plazaY = HEIGHTS.grass + discH / 2 + 0.002
    const geo = track(new THREE.CylinderGeometry(2.5, 2.5, discH, 32))
    const mat = track(new THREE.MeshStandardMaterial({ color: PLAZA_STONE, roughness: 0.95 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(place.x, plazaY, place.y)
    mesh.receiveShadow = true
    root.add(mesh)

    // Scattered flat stone slabs on the disc surface
    const slabGeo = track(new THREE.BoxGeometry(0.45, 0.04, 0.35))
    const slabMat = track(new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.92 }))
    const offsets: Array<[number, number, number]> = [
      [1.2, 0.8, 0.2],
      [-1.0, 1.1, 0.7],
      [0.6, -1.4, -0.4],
      [-1.3, -0.7, 1.1],
      [1.5, -0.5, -0.9],
    ]
    const slabY = plazaY + discH / 2 + 0.02
    for (const [ox, oz, yaw] of offsets) {
      const slab = new THREE.Mesh(slabGeo, slabMat)
      slab.position.set(place.x + ox, slabY, place.y + oz)
      slab.rotation.y = yaw
      slab.receiveShadow = true
      root.add(slab)
    }
  } else if (place.kind === 'berry-bush') {
    // Cluster of 3 overlapping low spheres + up to 6 berry dots (stock-driven)
    const bushMat = track(new THREE.MeshStandardMaterial({ color: BUSH_GREEN, roughness: 0.75 }))
    const offsets: Array<[number, number, number]> = [
      [0, 0, 1],
      [0.18, 0.12, 0.85],
      [-0.16, 0.1, 0.9],
    ]
    for (const [ox, oz, sy] of offsets) {
      const geo = track(new THREE.SphereGeometry(0.32, 10, 8))
      const mesh = new THREE.Mesh(geo, bushMat)
      mesh.position.set(place.x + ox, baseY + 0.22 * sy, place.y + oz)
      mesh.scale.set(1, 0.7 * sy, 1)
      mesh.castShadow = true
      root.add(mesh)
    }

    const berryGeo = track(new THREE.SphereGeometry(0.045, 6, 5))
    const berryMat = track(new THREE.MeshStandardMaterial({ color: BERRY_RED, roughness: 0.55 }))
    const rnd = tileRng(place.x, place.y, 77)
    const berryCount = 6 // full stock = 6 dots; visibility driven by inventory
    const berries: THREE.Mesh[] = []
    for (let i = 0; i < berryCount; i++) {
      const a = (i / berryCount) * Math.PI * 2 + rnd() * 0.4
      const elev = 0.15 + rnd() * 0.25
      const r = 0.18 + rnd() * 0.12
      const berry = new THREE.Mesh(berryGeo, berryMat)
      berry.position.set(
        place.x + Math.cos(a) * r,
        baseY + elev,
        place.y + Math.sin(a) * r,
      )
      root.add(berry)
      berries.push(berry)
    }
    bushBerries.set(place.id, berries)
  } else if (place.kind === 'farm') {
    // Tilled dark-soil tiles (3×3) + simple green crop cones scaled by growth
    const soilGeo = track(new THREE.BoxGeometry(0.92, 0.06, 0.92))
    const soilMat = track(
      new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.95 }),
    )
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const soil = new THREE.Mesh(soilGeo, soilMat)
        soil.position.set(place.x + dx, HEIGHTS.grass + 0.03, place.y + dy)
        soil.receiveShadow = true
        root.add(soil)
      }
    }
    const cropGeo = track(new THREE.ConeGeometry(0.12, 0.35, 5))
    const cropMat = track(
      new THREE.MeshStandardMaterial({ color: 0x5aaf4a, roughness: 0.8 }),
    )
    const crops: THREE.Object3D[] = []
    // 5 crop positions in the plot
    const cropOffsets: Array<[number, number]> = [
      [0, 0],
      [0.55, 0.4],
      [-0.5, 0.45],
      [0.45, -0.5],
      [-0.55, -0.4],
    ]
    for (const [ox, oz] of cropOffsets) {
      const crop = new THREE.Mesh(cropGeo, cropMat)
      crop.position.set(place.x + ox, HEIGHTS.grass + 0.12, place.y + oz)
      crop.castShadow = true
      crop.visible = false
      root.add(crop)
      crops.push(crop)
    }
    farmCrops.set(place.id, crops)
  } else if (place.kind === 'stall') {
    // Small canopy + crates (crate count reflects stock)
    const group = new THREE.Group()
    group.position.set(place.x, 0, place.y)
    if (plaza) {
      const dx = plaza.x - place.x
      const dz = plaza.y - place.y
      group.rotation.y = Math.atan2(dx, dz)
    }

    // Counter / table
    const tableGeo = track(new THREE.BoxGeometry(0.9, 0.35, 0.55))
    const tableMat = track(
      new THREE.MeshStandardMaterial({ color: 0xa67c52, roughness: 0.85 }),
    )
    const table = new THREE.Mesh(tableGeo, tableMat)
    table.position.y = baseY + 0.18
    table.castShadow = true
    table.receiveShadow = true
    group.add(table)

    // Canopy posts + awning
    const postGeo = track(new THREE.BoxGeometry(0.06, 0.7, 0.06))
    const postMat = track(
      new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }),
    )
    for (const [ox, oz] of [
      [-0.4, -0.22],
      [0.4, -0.22],
      [-0.4, 0.22],
      [0.4, 0.22],
    ] as Array<[number, number]>) {
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(ox, baseY + 0.45, oz)
      post.castShadow = true
      group.add(post)
    }
    const awningGeo = track(new THREE.BoxGeometry(1.05, 0.05, 0.7))
    const awningMat = track(
      new THREE.MeshStandardMaterial({ color: 0xc45c3e, roughness: 0.75 }),
    )
    const awning = new THREE.Mesh(awningGeo, awningMat)
    awning.position.y = baseY + 0.82
    awning.castShadow = true
    group.add(awning)

    root.add(group)

    // Crates in front of stall (stock-driven visibility)
    const crateGeo = track(new THREE.BoxGeometry(0.22, 0.18, 0.22))
    const crateMat = track(
      new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.88 }),
    )
    const crates: THREE.Mesh[] = []
    const crateOffsets: Array<[number, number]> = [
      [0.35, 0.55],
      [0.6, 0.55],
      [0.1, 0.7],
      [0.85, 0.7],
      [-0.15, 0.55],
      [1.05, 0.55],
      [0.35, 0.85],
      [0.6, 0.85],
    ]
    for (const [ox, oz] of crateOffsets) {
      const crate = new THREE.Mesh(crateGeo, crateMat)
      crate.position.set(place.x + ox - 0.4, baseY + 0.09, place.y + oz - 0.2)
      crate.castShadow = true
      crate.visible = false
      root.add(crate)
      crates.push(crate)
    }
    stallCrates.set(place.id, crates)
  } else if (place.kind === 'forestry') {
    // Log piles + stumps at forest edge
    const logMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
    const logGeo = track(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 8))
    const offsets: Array<[number, number, number]> = [
      [0.25, 0.15, 0.4],
      [-0.2, 0.25, -0.3],
      [0.1, -0.3, 1.1],
    ]
    for (const [ox, oz, yaw] of offsets) {
      const log = new THREE.Mesh(logGeo, logMat)
      log.position.set(place.x + ox, baseY + 0.1, place.y + oz)
      log.rotation.z = Math.PI / 2
      log.rotation.y = yaw
      log.castShadow = true
      root.add(log)
    }
    const stumpGeo = track(new THREE.CylinderGeometry(0.14, 0.16, 0.18, 8))
    const stumpMat = track(new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.92 }))
    for (const [ox, oz] of [
      [-0.4, -0.15],
      [0.45, 0.3],
    ] as Array<[number, number]>) {
      const stump = new THREE.Mesh(stumpGeo, stumpMat)
      stump.position.set(place.x + ox, baseY + 0.09, place.y + oz)
      stump.castShadow = true
      stump.receiveShadow = true
      root.add(stump)
    }
  } else if (place.kind === 'quarry') {
    // Chiseled stone blocks + rubble at rock base
    const blockMat = track(new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.92 }))
    const sizes: Array<[number, number, number, number, number]> = [
      [0.35, 0.22, 0.28, 0.2, 0.15],
      [0.28, 0.18, 0.3, -0.25, 0.2],
      [0.22, 0.15, 0.22, 0.1, -0.3],
      [0.18, 0.12, 0.2, -0.15, -0.2],
    ]
    for (const [sx, sy, sz, ox, oz] of sizes) {
      const geo = track(new THREE.BoxGeometry(sx, sy, sz))
      const block = new THREE.Mesh(geo, blockMat)
      block.position.set(place.x + ox, baseY + sy / 2, place.y + oz)
      block.castShadow = true
      block.receiveShadow = true
      root.add(block)
    }
  } else if (place.kind === 'storehouse') {
    // Wider barn, no chimney; crate stacks for wood/stone stock
    const barn = buildHomeMesh(place, track, plaza, { wide: true, chimney: false })
    root.add(barn)
    const crateGeo = track(new THREE.BoxGeometry(0.2, 0.16, 0.2))
    const crateMat = track(
      new THREE.MeshStandardMaterial({ color: 0x7a5a2a, roughness: 0.88 }),
    )
    const crates: THREE.Mesh[] = []
    const crateOffsets: Array<[number, number]> = [
      [0.55, 0.35],
      [0.8, 0.35],
      [0.55, 0.55],
      [0.8, 0.55],
      [0.3, 0.45],
      [1.05, 0.45],
      [0.55, 0.75],
      [0.8, 0.75],
    ]
    for (const [ox, oz] of crateOffsets) {
      const crate = new THREE.Mesh(crateGeo, crateMat)
      crate.position.set(place.x + ox - 0.5, baseY + 0.08, place.y + oz - 0.2)
      crate.castShadow = true
      crate.visible = false
      root.add(crate)
      crates.push(crate)
    }
    storeCrates.set(place.id, crates)
  } else if (place.kind === 'construction-site') {
    const vis = buildSiteVisual(place, track, plaza)
    root.add(vis.group)
    siteVisuals.set(place.id, vis)
  }
}

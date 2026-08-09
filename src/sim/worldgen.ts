import { createRng } from './rng'
import type { Place, TerrainKind, Tile, WorldState } from './types'

const WIDTH = 48
const HEIGHT = 48

/** Integer hash of (x, y, salt) → [0,1). Seeded via salt mixing. */
function hash2(x: number, y: number, salt: number): number {
  let n = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n = (n ^ (n >>> 16)) >>> 0
  return n / 4294967296
}

function valueNoise2D(x: number, y: number, salt: number, freq: number): number {
  const fx = x * freq
  const fy = y * freq
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const sx = fx - x0
  const sy = fy - y0
  // Smoothstep
  const u = sx * sx * (3 - 2 * sx)
  const v = sy * sy * (3 - 2 * sy)
  const a = hash2(x0, y0, salt)
  const b = hash2(x1, y0, salt)
  const c = hash2(x0, y1, salt)
  const d = hash2(x1, y1, salt)
  const ab = a + (b - a) * u
  const cd = c + (d - c) * u
  return ab + (cd - ab) * v
}

function fbm2(x: number, y: number, salt: number): number {
  // 2 octaves of value noise
  const o0 = valueNoise2D(x, y, salt, 0.08)
  const o1 = valueNoise2D(x, y, salt + 101, 0.16)
  return o0 * 0.65 + o1 * 0.35
}

function idx(x: number, y: number): number {
  return y * WIDTH + x
}

function classify(elevation: number, forestNoise: number): { kind: TerrainKind; walkable: boolean } {
  if (elevation < 0.3) return { kind: 'water', walkable: false }
  if (elevation < 0.36) return { kind: 'sand', walkable: true }
  // Raised threshold shrinks rock to a small hill (≤ ~8% of land; seed 42 ≈ 1–2%)
  if (elevation > 0.80) return { kind: 'rock', walkable: false }
  // Higher threshold keeps forest ≤ ~25% of land (was a tree-wall at 0.55)
  if (forestNoise > 0.68) return { kind: 'forest', walkable: true }
  return { kind: 'grass', walkable: true }
}

function largestGrassRegion(tiles: Tile[]): Array<[number, number]> {
  const visited = new Uint8Array(WIDTH * HEIGHT)
  let best: Array<[number, number]> = []

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y)
      if (visited[i]) continue
      const t = tiles[i]!
      if (t.kind !== 'grass') {
        visited[i] = 1
        continue
      }
      const region: Array<[number, number]> = []
      const stack: Array<[number, number]> = [[x, y]]
      visited[i] = 1
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        region.push([cx, cy])
        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue
          const ni = idx(nx, ny)
          if (visited[ni]) continue
          if (tiles[ni]!.kind !== 'grass') {
            visited[ni] = 1
            continue
          }
          visited[ni] = 1
          stack.push([nx, ny])
        }
      }
      if (region.length > best.length) best = region
    }
  }
  return best
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT
}

function isWalkableGrass(tiles: Tile[], x: number, y: number): boolean {
  if (!inBounds(x, y)) return false
  const t = tiles[idx(x, y)]!
  return t.walkable && t.kind === 'grass'
}

/** BFS corridor over walkable tiles; marks every tile on the path (incl. ends). */
function bfsCorridor(
  tiles: Tile[],
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): Array<[number, number]> | null {
  if (!inBounds(sx, sy) || !inBounds(gx, gy)) return null
  if (!tiles[idx(sx, sy)]!.walkable || !tiles[idx(gx, gy)]!.walkable) return null
  if (sx === gx && sy === gy) return [[sx, sy]]

  const visited = new Uint8Array(WIDTH * HEIGHT)
  const parent = new Int32Array(WIDTH * HEIGHT)
  parent.fill(-1)
  const qx: number[] = [sx]
  const qy: number[] = [sy]
  visited[idx(sx, sy)] = 1
  let head = 0
  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  let found = false
  while (head < qx.length) {
    const cx = qx[head]!
    const cy = qy[head]!
    head++
    if (cx === gx && cy === gy) {
      found = true
      break
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inBounds(nx, ny)) continue
      const ni = idx(nx, ny)
      if (visited[ni]) continue
      if (!tiles[ni]!.walkable) continue
      visited[ni] = 1
      parent[ni] = idx(cx, cy)
      qx.push(nx)
      qy.push(ny)
    }
  }
  if (!found) return null
  const path: Array<[number, number]> = []
  let ci = idx(gx, gy)
  const startI = idx(sx, sy)
  while (ci !== startI) {
    path.push([ci % WIDTH, (ci / WIDTH) | 0])
    ci = parent[ci]!
    if (ci < 0) return null
  }
  path.push([sx, sy])
  path.reverse()
  return path
}

/** Mark village footpaths from each home to plaza and plaza to well. */
function markPathCorridor(tiles: Tile[], plazaX: number, plazaY: number, places: Place[]): void {
  const paint = (path: Array<[number, number]> | null) => {
    if (!path) return
    for (const [x, y] of path) {
      const t = tiles[idx(x, y)]!
      if (t.walkable) t.path = true
    }
  }

  for (const p of places) {
    if (p.kind === 'home') {
      paint(bfsCorridor(tiles, p.x, p.y, plazaX, plazaY))
    }
  }
  const well = places.find((p) => p.kind === 'well')
  if (well) {
    paint(bfsCorridor(tiles, plazaX, plazaY, well.x, well.y))
  }
}

export function generateWorld(seed: number): WorldState {
  const rng = createRng(seed)
  // Derive noise salts from rng so seed fully controls island
  const elevSalt = (rng.int(0xffffffff) ^ (seed * 0x9e3779b9)) >>> 0
  const forestSalt = (rng.int(0xffffffff) ^ 0x85ebca6b) >>> 0

  const cx = (WIDTH - 1) / 2
  const cy = (HEIGHT - 1) / 2
  const maxDist = Math.sqrt(cx * cx + cy * cy)

  const tiles: Tile[] = new Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const dx = (x - cx) / maxDist
      const dy = (y - cy) / maxDist
      const radial = 1 - Math.sqrt(dx * dx + dy * dy)
      const noise = fbm2(x, y, elevSalt)
      // Combine radial falloff with noise
      const elevation = Math.max(0, Math.min(1, radial * 0.72 + noise * 0.38 - 0.05))
      const forestNoise = fbm2(x + 50, y + 50, forestSalt)
      const { kind, walkable } = classify(elevation, forestNoise)
      tiles[idx(x, y)] = { x, y, kind, walkable, elevation }
    }
  }

  // Village placement
  const grassRegion = largestGrassRegion(tiles)
  const places: Place[] = []
  if (grassRegion.length === 0) {
    return {
      seed,
      tick: 0,
      width: WIDTH,
      height: HEIGHT,
      tiles,
      places,
      agents: [],
      treasury: 200,
      owners: {},
    }
  }

  // Centroid of largest grass region
  let sx = 0
  let sy = 0
  for (const [x, y] of grassRegion) {
    sx += x
    sy += y
  }
  const gcx = Math.round(sx / grassRegion.length)
  const gcy = Math.round(sy / grassRegion.length)

  // Snap plaza to nearest grass in region
  let plazaX = gcx
  let plazaY = gcy
  {
    let bestD = Infinity
    for (const [x, y] of grassRegion) {
      const d = (x - gcx) * (x - gcx) + (y - gcy) * (y - gcy)
      if (d < bestD) {
        bestD = d
        plazaX = x
        plazaY = y
      }
    }
  }

  places.push({
    id: 'plaza-0',
    kind: 'plaza',
    x: plazaX,
    y: plazaY,
    slots: 12,
    inventory: { food: 0 },
  })

  // Clear 2-tile radius around plaza (force grass walkable, keep non-water)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = plazaX + dx
      const py = plazaY + dy
      if (!inBounds(px, py)) continue
      const t = tiles[idx(px, py)]!
      if (t.kind === 'water') continue
      t.kind = 'grass'
      t.walkable = true
    }
  }

  // Well adjacent to plaza (prefer +1,0 then others)
  const wellOffsets: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]
  let wellPlaced = false
  for (const [ox, oy] of wellOffsets) {
    const wx = plazaX + ox
    const wy = plazaY + oy
    if (isWalkableGrass(tiles, wx, wy)) {
      places.push({
        id: 'well-0',
        kind: 'well',
        x: wx,
        y: wy,
        slots: 2,
        inventory: { food: 0 },
      })
      wellPlaced = true
      break
    }
  }
  if (!wellPlaced) {
    places.push({
      id: 'well-0',
      kind: 'well',
      x: plazaX,
      y: plazaY,
      slots: 2,
      inventory: { food: 0 },
    })
  }

  // 10 homes on a ring radius 4–7 (expand outer radius if needed), Chebyshev spacing ≥ 2
  const occupied = new Set<string>()
  occupied.add(`${plazaX},${plazaY}`)
  for (const p of places) occupied.add(`${p.x},${p.y}`)

  const chebyshev = (ax: number, ay: number, bx: number, by: number) =>
    Math.max(Math.abs(ax - bx), Math.abs(ay - by))

  const homeTooClose = (hx: number, hy: number): boolean => {
    for (const p of places) {
      if (p.kind !== 'home') continue
      if (chebyshev(p.x, p.y, hx, hy) < 2) return true
    }
    return false
  }

  let homeCount = 0
  // Expand outer radius before giving up (4–7, then 4–8, … up to 4–14)
  for (let maxR = 7; maxR <= 14 && homeCount < 10; maxR++) {
    const homeCandidates: Array<[number, number]> = []
    for (let r = 4; r <= maxR; r++) {
      for (let angle = 0; angle < 48; angle++) {
        const rad = (angle / 48) * Math.PI * 2
        const hx = Math.round(plazaX + Math.cos(rad) * r)
        const hy = Math.round(plazaY + Math.sin(rad) * r)
        if (!isWalkableGrass(tiles, hx, hy)) continue
        const key = `${hx},${hy}`
        if (occupied.has(key)) continue
        homeCandidates.push([hx, hy])
      }
    }
    // Deterministic order: sort by angle then distance
    homeCandidates.sort((a, b) => {
      const aa = Math.atan2(a[1] - plazaY, a[0] - plazaX)
      const ab = Math.atan2(b[1] - plazaY, b[0] - plazaX)
      if (aa !== ab) return aa - ab
      const da = (a[0] - plazaX) ** 2 + (a[1] - plazaY) ** 2
      const db = (b[0] - plazaX) ** 2 + (b[1] - plazaY) ** 2
      return da - db
    })
    const seenHomes = new Set<string>()
    for (const [hx, hy] of homeCandidates) {
      if (homeCount >= 10) break
      const key = `${hx},${hy}`
      if (seenHomes.has(key) || occupied.has(key)) continue
      seenHomes.add(key)
      if (homeTooClose(hx, hy)) continue
      // slots = residents; finalized in spawnAgents once agents are assigned
      places.push({
        id: `home-${homeCount}`,
        kind: 'home',
        x: hx,
        y: hy,
        slots: 3,
        inventory: { food: 0 },
      })
      occupied.add(key)
      homeCount++
    }
  }

  // Fallback: fill remaining homes from grass region via rng (still spaced)
  if (homeCount < 10) {
    const shuffled = grassRegion.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      const tmp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = tmp
    }
    for (const [hx, hy] of shuffled) {
      if (homeCount >= 10) break
      const key = `${hx},${hy}`
      if (occupied.has(key)) continue
      if (!isWalkableGrass(tiles, hx, hy)) continue
      if (homeTooClose(hx, hy)) continue
      const dist = Math.sqrt((hx - plazaX) ** 2 + (hy - plazaY) ** 2)
      if (dist < 4 || dist > 14) continue
      places.push({
        id: `home-${homeCount}`,
        kind: 'home',
        x: hx,
        y: hy,
        slots: 3,
        inventory: { food: 0 },
      })
      occupied.add(key)
      homeCount++
    }
  }

  // Footpaths: BFS corridor home→plaza and plaza→well; mark tiles path:true
  markPathCorridor(tiles, plazaX, plazaY, places)

  // 8 berry-bushes on grass/forest, 4–12 tiles from plaza
  const bushCandidates: Array<[number, number]> = []
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const t = tiles[idx(x, y)]!
      if (t.kind !== 'grass' && t.kind !== 'forest') continue
      const dist = Math.sqrt((x - plazaX) ** 2 + (y - plazaY) ** 2)
      if (dist < 4 || dist > 12) continue
      const key = `${x},${y}`
      if (occupied.has(key)) continue
      bushCandidates.push([x, y])
    }
  }
  // Shuffle with rng, pick 8 with spacing
  for (let i = bushCandidates.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = bushCandidates[i]!
    bushCandidates[i] = bushCandidates[j]!
    bushCandidates[j] = tmp
  }
  let bushCount = 0
  for (const [bx, by] of bushCandidates) {
    if (bushCount >= 8) break
    let tooClose = false
    for (const p of places) {
      if (p.kind !== 'berry-bush') continue
      if (Math.abs(p.x - bx) + Math.abs(p.y - by) < 2) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    places.push({
      id: `bush-${bushCount}`,
      kind: 'berry-bush',
      x: bx,
      y: by,
      slots: 2,
      inventory: { food: 6 },
    })
    occupied.add(`${bx},${by}`)
    bushCount++
  }

  const owners: Record<string, 'commons'> = {}
  for (const p of places) {
    owners[p.id] = 'commons'
  }

  return {
    seed,
    tick: 0,
    width: WIDTH,
    height: HEIGHT,
    tiles,
    places,
    agents: [],
    treasury: 200,
    owners,
  }
}

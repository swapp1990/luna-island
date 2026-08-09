import type { WorldState } from './types'

function idx(x: number, y: number, width: number): number {
  return y * width + x
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h
}

export function isWalkable(world: WorldState, x: number, y: number): boolean {
  if (!inBounds(x, y, world.width, world.height)) return false
  return world.tiles[idx(x, y, world.width)]!.walkable
}

/** Movement cost: path tiles preferred (0.7), other walkable 1.0. */
function tileCost(world: WorldState, x: number, y: number): number {
  const t = world.tiles[idx(x, y, world.width)]!
  return t.path ? 0.7 : 1.0
}

/**
 * Weighted Dijkstra over walkable tiles (path tiles cost 0.7). Returns waypoints
 * from the first step after start through the goal (empty if already at goal).
 * Null if unreachable. Deterministic via fixed neighbor order + stable index ties.
 */
export function findPath(
  world: WorldState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Array<[number, number]> | null {
  const w = world.width
  const h = world.height
  const sx = Math.round(fromX)
  const sy = Math.round(fromY)
  const gx = Math.round(toX)
  const gy = Math.round(toY)

  if (!isWalkable(world, gx, gy)) return null
  if (sx === gx && sy === gy) return []

  if (!isWalkable(world, sx, sy)) {
    // Start may be slightly off a walkable tile — try nearest walkable
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (isWalkable(world, sx + dx, sy + dy)) {
          return findPath(world, sx + dx, sy + dy, gx, gy)
        }
      }
    }
    return null
  }

  const n = w * h
  const dist = new Float64Array(n)
  dist.fill(Infinity)
  const parent = new Int32Array(n)
  parent.fill(-1)
  const closed = new Uint8Array(n)

  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]

  // Binary min-heap of (cost, index) pairs; stale entries skipped on pop
  // Interleaved: [cost0, idx0, cost1, idx1, ...]
  const heap: number[] = []
  const heapPush = (cost: number, i: number) => {
    heap.push(cost, i)
    let j = (heap.length >> 1) - 1
    while (j > 0) {
      const p = (j - 1) >> 1
      const jc = heap[j * 2]!
      const pc = heap[p * 2]!
      if (pc < jc || (pc === jc && heap[p * 2 + 1]! <= heap[j * 2 + 1]!)) break
      // swap entries p <-> j
      const tc = heap[p * 2]!
      const ti = heap[p * 2 + 1]!
      heap[p * 2] = heap[j * 2]!
      heap[p * 2 + 1] = heap[j * 2 + 1]!
      heap[j * 2] = tc
      heap[j * 2 + 1] = ti
      j = p
    }
  }
  const heapPop = (): { cost: number; i: number } => {
    const cost = heap[0]!
    const i = heap[1]!
    const lastC = heap[heap.length - 2]!
    const lastI = heap[heap.length - 1]!
    heap.length -= 2
    if (heap.length === 0) return { cost, i }
    heap[0] = lastC
    heap[1] = lastI
    let j = 0
    const count = heap.length >> 1
    for (;;) {
      const l = j * 2 + 1
      const r = l + 1
      if (l >= count) break
      let best = l
      if (
        r < count &&
        (heap[r * 2]! < heap[l * 2]! ||
          (heap[r * 2]! === heap[l * 2]! && heap[r * 2 + 1]! < heap[l * 2 + 1]!))
      ) {
        best = r
      }
      const jc = heap[j * 2]!
      const bc = heap[best * 2]!
      if (jc < bc || (jc === bc && heap[j * 2 + 1]! <= heap[best * 2 + 1]!)) break
      const tc = heap[j * 2]!
      const ti = heap[j * 2 + 1]!
      heap[j * 2] = heap[best * 2]!
      heap[j * 2 + 1] = heap[best * 2 + 1]!
      heap[best * 2] = tc
      heap[best * 2 + 1] = ti
      j = best
    }
    return { cost, i }
  }

  const startI = idx(sx, sy, w)
  dist[startI] = 0
  heapPush(0, startI)

  let found = false
  while (heap.length > 0) {
    const { cost: popCost, i: bestI } = heapPop()
    if (popCost !== dist[bestI] || closed[bestI]) continue // stale or already settled
    closed[bestI] = 1

    const cx = bestI % w
    const cy = (bestI / w) | 0
    if (cx === gx && cy === gy) {
      found = true
      break
    }

    const bestD = dist[bestI]!
    for (const [dx, dy] of dirs) {
      const nx = cx + dx
      const ny = cy + dy
      if (!inBounds(nx, ny, w, h)) continue
      const ni = idx(nx, ny, w)
      if (closed[ni]) continue
      if (!world.tiles[ni]!.walkable) continue
      const nd = bestD + tileCost(world, nx, ny)
      if (nd < dist[ni]!) {
        dist[ni] = nd
        parent[ni] = bestI
        heapPush(nd, ni)
      }
    }
  }

  if (!found) return null

  // Reconstruct path goal → start, then reverse, drop start
  const rev: Array<[number, number]> = []
  let ci = idx(gx, gy, w)
  while (ci !== startI) {
    const cx = ci % w
    const cy = (ci / w) | 0
    rev.push([cx, cy])
    ci = parent[ci]!
    if (ci < 0) return null
  }
  rev.reverse()
  return rev
}

/** True if every remaining waypoint is still walkable. */
export function pathStillValid(
  world: WorldState,
  path: Array<[number, number]>,
  pathIndex: number,
): boolean {
  for (let i = pathIndex; i < path.length; i++) {
    const [x, y] = path[i]!
    if (!isWalkable(world, x, y)) return false
  }
  return true
}

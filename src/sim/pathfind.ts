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

/**
 * BFS path over walkable tiles. Returns waypoints from the first step after
 * start through the goal (empty if already at goal). Null if unreachable.
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
    // by searching adjacent; if still bad, fail.
    let found = false
    for (let dy = -1; dy <= 1 && !found; dy++) {
      for (let dx = -1; dx <= 1 && !found; dx++) {
        if (isWalkable(world, sx + dx, sy + dy)) {
          return findPath(world, sx + dx, sy + dy, gx, gy)
        }
      }
    }
    return null
  }

  const visited = new Uint8Array(w * h)
  const parent = new Int32Array(w * h)
  parent.fill(-1)

  const qx: number[] = [sx]
  const qy: number[] = [sy]
  visited[idx(sx, sy, w)] = 1
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
      if (!inBounds(nx, ny, w, h)) continue
      const ni = idx(nx, ny, w)
      if (visited[ni]) continue
      if (!world.tiles[ni]!.walkable) continue
      visited[ni] = 1
      parent[ni] = idx(cx, cy, w)
      qx.push(nx)
      qy.push(ny)
    }
  }

  if (!found) return null

  // Reconstruct path goal → start, then reverse, drop start
  const rev: Array<[number, number]> = []
  let ci = idx(gx, gy, w)
  const startI = idx(sx, sy, w)
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

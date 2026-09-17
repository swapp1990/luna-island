import type { PlaceId, Vec2 } from './types'
import {
  PLACES,
  ROAD_EDGES,
  ROAD_NODES,
  dist,
  nodeById,
} from './world'

const EPS = 1e-6

interface GraphNode {
  id: string
  x: number
  y: number
}

function keyOf(x: number, y: number): string {
  return `${x.toFixed(4)},${y.toFixed(4)}`
}

function isNear(a: Vec2, b: Vec2, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
}

function existingNodeAt(p: Vec2): GraphNode | null {
  for (const n of ROAD_NODES) {
    if (isNear(p, n, 1e-4)) return { id: n.id, x: n.x, y: n.y }
  }
  return null
}

function pointOnSeg(p: Vec2, a: Vec2, b: Vec2): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return dist(p, a) <= 1e-4
  const t = (apx * abx + apy * aby) / len2
  if (t < -1e-4 || t > 1 + 1e-4) return false
  const proj = { x: a.x + t * abx, y: a.y + t * aby }
  return dist(p, proj) <= 1e-3
}

function addUndirected(adj: Map<string, { to: string; w: number }[]>, a: string, b: string, w: number): void {
  const la = adj.get(a) ?? []
  const lb = adj.get(b) ?? []
  la.push({ to: b, w })
  lb.push({ to: a, w })
  adj.set(a, la)
  adj.set(b, lb)
}

function dijkstra(nodes: GraphNode[], adj: Map<string, { to: string; w: number }[]>, start: string, goal: string): string[] | null {
  const distMap = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const unused = new Set(nodes.map((n) => n.id))
  distMap.set(start, 0)
  prev.set(start, null)

  while (unused.size > 0) {
    let best: string | null = null
    let bestD = Infinity
    for (const id of unused) {
      const d = distMap.get(id) ?? Infinity
      if (d < bestD || (d === bestD && (best === null || id < best))) {
        best = id
        bestD = d
      }
    }
    if (best === null || bestD === Infinity) break
    unused.delete(best)
    if (best === goal) break
    const edges = adj.get(best) ?? []
    for (const e of edges) {
      const nd = bestD + e.w
      const cur = distMap.get(e.to) ?? Infinity
      const curPrev = prev.get(e.to)
      if (nd < cur - EPS || (Math.abs(nd - cur) <= EPS && (curPrev == null || best < curPrev))) {
        distMap.set(e.to, nd)
        prev.set(e.to, best)
      }
    }
  }

  if (!prev.has(goal) && goal !== start) return null
  const out: string[] = []
  let cur: string | null = goal
  while (cur) {
    out.push(cur)
    cur = prev.get(cur) ?? null
  }
  out.reverse()
  if (out[0] !== start) return null
  return out
}

function ensurePoint(nodes: GraphNode[], adj: Map<string, { to: string; w: number }[]>, p: Vec2, role: 'from' | 'to'): GraphNode {
  const existing = existingNodeAt(p)
  if (existing) {
    if (!nodes.some((n) => n.id === existing.id)) nodes.push(existing)
    return existing
  }
  const id = `${role}:${keyOf(p.x, p.y)}`
  const node: GraphNode = { id, x: p.x, y: p.y }
  nodes.push(node)
  for (const [aId, bId] of ROAD_EDGES) {
    const a = nodeById(aId)
    const b = nodeById(bId)
    if (pointOnSeg(p, a, b)) {
      addUndirected(adj, id, a.id, dist(p, a))
      addUndirected(adj, id, b.id, dist(p, b))
      return node
    }
  }
  // Snap to nearest node if we drifted off a segment.
  let nearest = ROAD_NODES[0]!
  let best = dist(p, nearest)
  for (const n of ROAD_NODES) {
    const d = dist(p, n)
    if (d < best || (d === best && n.id < nearest.id)) {
      nearest = n
      best = d
    }
  }
  addUndirected(adj, id, nearest.id, best)
  return node
}

function baseGraph(): { nodes: GraphNode[]; adj: Map<string, { to: string; w: number }[]> } {
  const nodes: GraphNode[] = ROAD_NODES.map((n) => ({ id: n.id, x: n.x, y: n.y }))
  const adj = new Map<string, { to: string; w: number }[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const [a, b] of ROAD_EDGES) {
    const na = nodeById(a)
    const nb = nodeById(b)
    addUndirected(adj, a, b, dist(na, nb))
  }
  return { nodes, adj }
}

/** Polyline from `from` to `to`, including `to`, excluding `from` when coincident. */
export function shortestPath(from: Vec2, to: Vec2): Vec2[] {
  if (isNear(from, to, 1e-4)) return []
  const { nodes, adj } = baseGraph()
  const start = ensurePoint(nodes, adj, from, 'from')
  const goal = ensurePoint(nodes, adj, to, 'to')
  const ids = dijkstra(nodes, adj, start.id, goal.id)
  if (!ids) return [{ x: to.x, y: to.y }]
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const pts: Vec2[] = []
  for (const id of ids) {
    const n = byId.get(id)!
    pts.push({ x: n.x, y: n.y })
  }
  if (pts.length > 0 && isNear(pts[0]!, from, 1e-4)) pts.shift()
  if (pts.length === 0 || !isNear(pts[pts.length - 1]!, to, 1e-4)) pts.push({ x: to.x, y: to.y })
  return pts
}

export function pathToPlace(from: Vec2, dest: PlaceId): Vec2[] {
  return shortestPath(from, PLACES[dest].door)
}

export function pathLength(pts: Vec2[], origin?: Vec2): number {
  let n = 0
  let prev = origin
  for (const p of pts) {
    if (prev) n += dist(prev, p)
    prev = p
  }
  return n
}

export function pathToPlaceLength(fromPlace: PlaceId, toPlace: PlaceId): number {
  const a = PLACES[fromPlace].door
  const b = PLACES[toPlace].door
  const poly = shortestPath(a, b)
  return pathLength(poly, a)
}

/** Advance `units` along remaining polyline. Mutates pos and path. */
export function advanceWalk(pos: Vec2, path: Vec2[], units: number): void {
  let remaining = units
  while (remaining > EPS && path.length > 0) {
    const next = path[0]!
    const d = dist(pos, next)
    if (d <= remaining + EPS) {
      pos.x = next.x
      pos.y = next.y
      path.shift()
      remaining -= d
    } else if (d > EPS) {
      const t = remaining / d
      pos.x += (next.x - pos.x) * t
      pos.y += (next.y - pos.y) * t
      remaining = 0
    } else {
      path.shift()
    }
  }
}



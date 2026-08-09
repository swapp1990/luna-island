import { findPath, isWalkable } from './pathfind'
import type { AgentState, Place, PlaceKind, Rng, WorldState } from './types'

/** Base reservation radii (euclidean) for place kinds. Home uses discrete 3×3. */
export const PLACE_RADIUS: Record<PlaceKind, number> = {
  plaza: 2.5,
  'berry-bush': 1.2,
  well: 1.2,
  home: 1.0,
}

const NEIGHBOR8: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

const CARDINAL: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function key(x: number, y: number): string {
  return `${x},${y}`
}

/** True while the agent still has path waypoints to walk. */
export function isWalking(agent: AgentState): boolean {
  const path = agent.action.path
  return !!path && agent.pathIndex < path.length
}

export function isStanding(agent: AgentState): boolean {
  return !isWalking(agent)
}

/** Walkable tiles within place region at baseRadius + extra (euclidean, or chebyshev for home). */
export function candidatesForPlace(
  world: WorldState,
  place: Place,
  extraRadius = 0,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (place.kind === 'home') {
    const maxD = 1 + extraRadius
    for (let dy = -maxD; dy <= maxD; dy++) {
      for (let dx = -maxD; dx <= maxD; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) > maxD) continue
        const x = place.x + dx
        const y = place.y + dy
        if (isWalkable(world, x, y)) out.push([x, y])
      }
    }
    return out
  }

  const r = PLACE_RADIUS[place.kind] + extraRadius
  const rCeil = Math.ceil(r)
  for (let dy = -rCeil; dy <= rCeil; dy++) {
    for (let dx = -rCeil; dx <= rCeil; dx++) {
      const x = place.x + dx
      const y = place.y + dy
      if (!isWalkable(world, x, y)) continue
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d <= r + 1e-9) out.push([x, y])
    }
  }
  return out
}

/**
 * Tiles blocked for a new reservation: other agents' reserved destinations
 * and tiles occupied by non-walking agents.
 */
export function buildBlockedTiles(
  world: WorldState,
  excludeAgentId: string,
): Set<string> {
  const blocked = new Set<string>()
  for (const other of world.agents) {
    if (other.id === excludeAgentId) continue
    const a = other.action
    if (
      a.kind !== 'idle' &&
      a.targetX !== undefined &&
      a.targetY !== undefined
    ) {
      blocked.add(key(Math.round(a.targetX), Math.round(a.targetY)))
    }
    if (isStanding(other)) {
      blocked.add(key(Math.round(other.x), Math.round(other.y)))
    }
  }
  return blocked
}

/**
 * Pick a free destination near a place. Prefers nearest free candidate to the
 * agent; widens radius by +1 up to +3; then falls back to free walkable
 * neighbors of the region edge.
 */
export function reserveSpot(
  world: WorldState,
  place: Place,
  agent: AgentState,
  rng: Rng,
): { x: number; y: number } {
  const blocked = buildBlockedTiles(world, agent.id)
  const ax = agent.x
  const ay = agent.y

  const pickNearest = (cands: Array<[number, number]>): [number, number] | null => {
    const free = cands.filter(([x, y]) => !blocked.has(key(x, y)))
    if (free.length === 0) return null
    let bestD = Infinity
    const nearest: Array<[number, number]> = []
    for (const [x, y] of free) {
      const d = (x - ax) * (x - ax) + (y - ay) * (y - ay)
      if (d < bestD - 1e-12) {
        bestD = d
        nearest.length = 0
        nearest.push([x, y])
      } else if (Math.abs(d - bestD) <= 1e-12) {
        nearest.push([x, y])
      }
    }
    return rng.pick(nearest)
  }

  for (let extra = 0; extra <= 3; extra++) {
    const picked = pickNearest(candidatesForPlace(world, place, extra))
    if (picked) return { x: picked[0], y: picked[1] }
  }

  // Fallback: free walkable neighbors of the max-radius region edge
  const region = candidatesForPlace(world, place, 3)
  const regionSet = new Set(region.map(([x, y]) => key(x, y)))
  const edgeNeighbors: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const [x, y] of region) {
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx
      const ny = y + dy
      const k = key(nx, ny)
      if (seen.has(k) || regionSet.has(k)) continue
      seen.add(k)
      if (!isWalkable(world, nx, ny)) continue
      if (blocked.has(k)) continue
      edgeNeighbors.push([nx, ny])
    }
  }
  if (edgeNeighbors.length > 0) {
    const p = rng.pick(edgeNeighbors)
    return { x: p[0], y: p[1] }
  }

  // Last resort: place tile if walkable, else agent tile
  if (isWalkable(world, place.x, place.y)) return { x: place.x, y: place.y }
  return { x: Math.round(agent.x), y: Math.round(agent.y) }
}

/**
 * Deterministic bed tile for a home resident: home tile + neighbors ordered
 * by fixed offset list, assigned by resident index among agents sharing homeId.
 */
export function bedSlotForAgent(
  world: WorldState,
  agent: AgentState,
  home: Place,
): { x: number; y: number } {
  const residents = world.agents
    .filter((a) => a.homeId === home.id)
    .map((a) => a.id)
    .sort()
  const residentIndex = Math.max(0, residents.indexOf(agent.id))

  const slots: Array<[number, number]> = []
  for (const [dx, dy] of NEIGHBOR8) {
    const x = home.x + dx
    const y = home.y + dy
    if (isWalkable(world, x, y)) slots.push([x, y])
  }
  if (slots.length === 0) return { x: home.x, y: home.y }
  const slot = slots[residentIndex % slots.length]!
  return { x: slot[0], y: slot[1] }
}

/** Concurrent eat reservations for a berry bush (including walkers). */
export function countBushEaters(
  world: WorldState,
  bushId: string,
  excludeAgentId?: string,
): number {
  let n = 0
  for (const a of world.agents) {
    if (excludeAgentId && a.id === excludeAgentId) continue
    if (a.action.kind === 'eat' && a.action.targetPlaceId === bushId) n++
  }
  return n
}

const BUSH_CAPACITY = 2

/**
 * Nearest berry bush with a free eat slot (< 2 reservations). If all full,
 * returns nearest anyway. `crowded` is true when the chosen bush is not the
 * nearest overall (near ones were at capacity).
 */
export function pickBushForAgent(
  world: WorldState,
  agent: AgentState,
): { bush: Place | null; crowded: boolean } {
  const bushes = world.places.filter((p) => p.kind === 'berry-bush')
  if (bushes.length === 0) return { bush: null, crowded: false }

  const sorted = bushes.slice().sort((a, b) => {
    const da = (a.x - agent.x) ** 2 + (a.y - agent.y) ** 2
    const db = (b.x - agent.x) ** 2 + (b.y - agent.y) ** 2
    if (da !== db) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const nearest = sorted[0]!
  for (const bush of sorted) {
    if (countBushEaters(world, bush.id, agent.id) < BUSH_CAPACITY) {
      return { bush, crowded: bush.id !== nearest.id }
    }
  }
  return { bush: nearest, crowded: false }
}

/** Adjacent free tiles (cardinal) within plaza radius for social milling. */
export function millCandidates(
  world: WorldState,
  agent: AgentState,
  plaza: Place,
): Array<[number, number]> {
  const blocked = buildBlockedTiles(world, agent.id)
  // Own standing tile is free for leaving; do not block re-entry to self
  const r = PLACE_RADIUS.plaza
  const out: Array<[number, number]> = []
  const ax = Math.round(agent.x)
  const ay = Math.round(agent.y)
  for (const [dx, dy] of CARDINAL) {
    const x = ax + dx
    const y = ay + dy
    if (!isWalkable(world, x, y)) continue
    const ddx = x - plaza.x
    const ddy = y - plaza.y
    if (Math.sqrt(ddx * ddx + ddy * ddy) > r + 1e-9) continue
    if (blocked.has(key(x, y))) continue
    out.push([x, y])
  }
  return out
}

/** Adjacent free tiles for co-standing nudge (any walkable neighbor). */
export function nudgeCandidates(
  world: WorldState,
  agent: AgentState,
): Array<[number, number]> {
  const blocked = buildBlockedTiles(world, agent.id)
  const ax = Math.round(agent.x)
  const ay = Math.round(agent.y)
  const out: Array<[number, number]> = []
  for (const [dx, dy] of CARDINAL) {
    const x = ax + dx
    const y = ay + dy
    if (!isWalkable(world, x, y)) continue
    if (blocked.has(key(x, y))) continue
    out.push([x, y])
  }
  // Also try diagonals if cardinals full
  if (out.length === 0) {
    for (const [dx, dy] of NEIGHBOR8) {
      if (dx === 0 && dy === 0) continue
      if (dx === 0 || dy === 0) continue // already tried cardinal
      const x = ax + dx
      const y = ay + dy
      if (!isWalkable(world, x, y)) continue
      if (blocked.has(key(x, y))) continue
      out.push([x, y])
    }
  }
  return out
}

/** Extend current action with a short path to (tx,ty) — no new events. */
export function extendPathTo(
  world: WorldState,
  agent: AgentState,
  tx: number,
  ty: number,
): void {
  agent.action.targetX = tx
  agent.action.targetY = ty
  const path = findPath(world, agent.x, agent.y, tx, ty)
  agent.action.path = path ?? []
  agent.pathIndex = 0
}

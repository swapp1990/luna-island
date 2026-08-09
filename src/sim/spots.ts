import { findPath, isWalkable } from './pathfind'
import type { AgentState, Place, PlaceKind, Rng, WorldState } from './types'

/** Base footprint radii (euclidean) for place kinds. Home uses discrete 3×3. */
export const PLACE_RADIUS: Record<PlaceKind, number> = {
  plaza: 2.5,
  'berry-bush': 1.2,
  well: 1.2,
  home: 1.0,
}

/** Actions that restore a need while using a place. */
const RESTORE_KINDS = new Set(['sleep', 'eat', 'drink', 'socialize'])

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

/** Social proximity gate: another agent within 1.5 tiles. */
export const SOCIAL_PROXIMITY = 1.5
export const SOCIAL_PROXIMITY_SQ = SOCIAL_PROXIMITY * SOCIAL_PROXIMITY

/** Walkable tiles within place footprint (slot tiles) — no radius widening. */
export function slotTiles(
  world: WorldState,
  place: Place,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (place.kind === 'home') {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = place.x + dx
        const y = place.y + dy
        if (isWalkable(world, x, y)) out.push([x, y])
      }
    }
    return out
  }

  const r = PLACE_RADIUS[place.kind]
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

/** True if (x,y) is a slot tile of the place. */
export function isSlotTile(
  world: WorldState,
  place: Place,
  x: number,
  y: number,
): boolean {
  const tx = Math.round(x)
  const ty = Math.round(y)
  if (place.kind === 'home') {
    return Math.max(Math.abs(tx - place.x), Math.abs(ty - place.y)) <= 1 &&
      isWalkable(world, tx, ty)
  }
  const dx = tx - place.x
  const dy = ty - place.y
  if (Math.sqrt(dx * dx + dy * dy) > PLACE_RADIUS[place.kind] + 1e-9) return false
  return isWalkable(world, tx, ty)
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

/** Agents currently targeting this place for a restore action (incl. walkers). */
export function countPlaceUsers(
  world: WorldState,
  placeId: string,
  excludeAgentId?: string,
): number {
  let n = 0
  for (const a of world.agents) {
    if (excludeAgentId && a.id === excludeAgentId) continue
    if (!RESTORE_KINDS.has(a.action.kind)) continue
    if (a.action.targetPlaceId === placeId) n++
  }
  return n
}

/** Free (unblocked) slot tiles within the place footprint. */
export function freeSlotTiles(
  world: WorldState,
  place: Place,
  excludeAgentId: string,
): Array<[number, number]> {
  const blocked = buildBlockedTiles(world, excludeAgentId)
  return slotTiles(world, place).filter(([x, y]) => !blocked.has(key(x, y)))
}

/** True when place has free slot tiles and concurrent users < slots. */
export function placeHasCapacity(
  world: WorldState,
  place: Place,
  excludeAgentId?: string,
): boolean {
  if (countPlaceUsers(world, place.id, excludeAgentId) >= place.slots) return false
  if (!excludeAgentId) {
    // Without an agent, still need at least one walkable slot tile
    return slotTiles(world, place).length > 0
  }
  return freeSlotTiles(world, place, excludeAgentId).length > 0
}

/**
 * Pick a free slot tile for a place reservation. No ring-widening beyond
 * footprint — if full, returns null (brain picks next place or wanders).
 * Optional preferred tile is used when free.
 */
export function reserveSpot(
  world: WorldState,
  place: Place,
  agent: AgentState,
  rng: Rng,
  preferred?: { x: number; y: number },
): { x: number; y: number } | null {
  if (countPlaceUsers(world, place.id, agent.id) >= place.slots) return null

  const free = freeSlotTiles(world, place, agent.id)
  if (free.length === 0) return null

  if (preferred) {
    const px = Math.round(preferred.x)
    const py = Math.round(preferred.y)
    if (free.some(([x, y]) => x === px && y === py)) {
      return { x: px, y: py }
    }
  }

  const ax = agent.x
  const ay = agent.y
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
  const picked = rng.pick(nearest)
  return { x: picked[0], y: picked[1] }
}

/**
 * Deterministic bed tile for a home resident: home tile + neighbors ordered
 * by fixed offset list, assigned by resident index among agents sharing homeId.
 * Prefers unblocked tiles so adjacent homes don't share a standing tile.
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

  const blocked = buildBlockedTiles(world, agent.id)
  const free = slots.filter(([x, y]) => !blocked.has(key(x, y)))
  const pool = free.length > 0 ? free : slots
  const slot = pool[residentIndex % pool.length]!
  return { x: slot[0], y: slot[1] }
}

/**
 * Nearest place of `kind` with free capacity. `crowded` is true when the
 * chosen place is not the nearest overall (near ones were full).
 */
export function pickPlaceForAgent(
  world: WorldState,
  agent: AgentState,
  kind: PlaceKind,
): { place: Place | null; crowded: boolean } {
  const list = world.places.filter((p) => p.kind === kind)
  if (list.length === 0) return { place: null, crowded: false }

  const sorted = list.slice().sort((a, b) => {
    const da = (a.x - agent.x) ** 2 + (a.y - agent.y) ** 2
    const db = (b.x - agent.x) ** 2 + (b.y - agent.y) ** 2
    if (da !== db) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const nearest = sorted[0]!
  for (const place of sorted) {
    if (placeHasCapacity(world, place, agent.id)) {
      return { place, crowded: place.id !== nearest.id }
    }
  }
  return { place: null, crowded: false }
}

/**
 * Prefer free slot tiles within SOCIAL_PROXIMITY of another current-or-inbound
 * socializer; else free tile nearest plaza center. Returns null if no free slots.
 */
export function pickSocialSlot(
  world: WorldState,
  agent: AgentState,
  plaza: Place,
  rng: Rng,
): { x: number; y: number } | null {
  if (!placeHasCapacity(world, plaza, agent.id)) return null
  const free = freeSlotTiles(world, plaza, agent.id)
  if (free.length === 0) return null

  // Positions of other socializers (standing or inbound targets)
  const anchors: Array<{ x: number; y: number }> = []
  for (const other of world.agents) {
    if (other.id === agent.id) continue
    if (other.action.kind !== 'socialize') continue
    if (
      other.action.targetX !== undefined &&
      other.action.targetY !== undefined
    ) {
      anchors.push({ x: other.action.targetX, y: other.action.targetY })
    }
    if (isStanding(other)) {
      anchors.push({ x: other.x, y: other.y })
    }
  }

  const nearCluster: Array<[number, number]> = []
  for (const [x, y] of free) {
    for (const a of anchors) {
      const dx = x - a.x
      const dy = y - a.y
      if (dx * dx + dy * dy <= SOCIAL_PROXIMITY_SQ + 1e-9) {
        nearCluster.push([x, y])
        break
      }
    }
  }

  const pool = nearCluster.length > 0 ? nearCluster : free
  // Among pool: prefer nearest to plaza center (stable cluster core)
  let bestD = Infinity
  const nearest: Array<[number, number]> = []
  for (const [x, y] of pool) {
    const d = (x - plaza.x) ** 2 + (y - plaza.y) ** 2
    if (d < bestD - 1e-12) {
      bestD = d
      nearest.length = 0
      nearest.push([x, y])
    } else if (Math.abs(d - bestD) <= 1e-12) {
      nearest.push([x, y])
    }
  }
  const picked = rng.pick(nearest)
  return { x: picked[0], y: picked[1] }
}

/**
 * Standing restorers at a place on slot tiles, ordered by agent list index.
 * Only the first `place.slots` may apply restore this tick.
 */
export function canRestoreThisTick(
  world: WorldState,
  agent: AgentState,
  place: Place,
): boolean {
  if (!isStanding(agent)) return false
  if (!isSlotTile(world, place, agent.x, agent.y)) return false

  // Collect standing restorers on slot tiles for this place, by world agent index
  const restorers: number[] = []
  for (let i = 0; i < world.agents.length; i++) {
    const a = world.agents[i]!
    if (!RESTORE_KINDS.has(a.action.kind)) continue
    if (a.action.targetPlaceId !== place.id) continue
    if (!isStanding(a)) continue
    if (!isSlotTile(world, place, a.x, a.y)) continue
    restorers.push(i)
  }
  // Already sorted by index ascending
  const myIndex = world.agents.indexOf(agent)
  const allowed = restorers.slice(0, place.slots)
  return allowed.includes(myIndex)
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

/** Nearest other agent within SOCIAL_PROXIMITY (render/UI only). */
export function nearestAgentWithin(
  agent: AgentState,
  agents: readonly AgentState[],
  maxDist = SOCIAL_PROXIMITY,
): AgentState | null {
  const maxSq = maxDist * maxDist
  let best: AgentState | null = null
  let bestD = Infinity
  for (const other of agents) {
    if (other.id === agent.id) continue
    const dx = other.x - agent.x
    const dy = other.y - agent.y
    const d = dx * dx + dy * dy
    if (d <= maxSq + 1e-9 && d < bestD) {
      bestD = d
      best = other
    }
  }
  return best
}

import { INK_CONFIG } from './config'
import type { HomeId, InkState, Mind, MindId, PlaceDef, PlaceId, Vec2 } from './types'

export const WORLD_SIZE = { width: 100, height: 60 } as const

export const PLACES: Record<PlaceId, PlaceDef> = {
  'home-a': { id: 'home-a', label: "A's house", rect: { x: 6, y: 6, w: 14, h: 12 }, door: { x: 13, y: 18 } },
  'home-b': { id: 'home-b', label: "B's house", rect: { x: 6, y: 38, w: 14, h: 12 }, door: { x: 13, y: 38 } },
  market: { id: 'market', label: 'Market', rect: { x: 44, y: 4, w: 18, h: 12 }, door: { x: 53, y: 16 } },
  center: { id: 'center', label: 'Town centre', rect: { x: 44, y: 32, w: 18, h: 12 }, door: { x: 53, y: 32 } },
  work: { id: 'work', label: 'Workshop', rect: { x: 76, y: 20, w: 18, h: 16 }, door: { x: 76, y: 28 } },
}

export const PLACE_IDS: readonly PlaceId[] = ['home-a', 'home-b', 'market', 'center', 'work']

export type RoadNodeId =
  | 'n-8-28'
  | 'n-13-28'
  | 'n-53-28'
  | 'n-76-28'
  | 'door-home-a'
  | 'door-home-b'
  | 'door-market'
  | 'door-center'

export interface RoadNode {
  id: RoadNodeId
  x: number
  y: number
}

export const ROAD_NODES: readonly RoadNode[] = [
  { id: 'n-8-28', x: 8, y: 28 },
  { id: 'n-13-28', x: 13, y: 28 },
  { id: 'n-53-28', x: 53, y: 28 },
  { id: 'n-76-28', x: 76, y: 28 },
  { id: 'door-home-a', x: 13, y: 18 },
  { id: 'door-home-b', x: 13, y: 38 },
  { id: 'door-market', x: 53, y: 16 },
  { id: 'door-center', x: 53, y: 32 },
]

export const ROAD_EDGES: readonly [RoadNodeId, RoadNodeId][] = [
  ['n-8-28', 'n-13-28'],
  ['n-13-28', 'n-53-28'],
  ['n-53-28', 'n-76-28'],
  ['n-13-28', 'door-home-a'],
  ['n-13-28', 'door-home-b'],
  ['n-53-28', 'door-market'],
  ['n-53-28', 'door-center'],
]

export const PLACE_DOOR_NODE: Record<PlaceId, RoadNodeId> = {
  'home-a': 'door-home-a',
  'home-b': 'door-home-b',
  market: 'door-market',
  center: 'door-center',
  work: 'n-76-28',
}

export const ROAD_SEGMENTS: readonly { a: Vec2; b: Vec2 }[] = ROAD_EDGES.map(([a, b]) => {
  const na = ROAD_NODES.find((n) => n.id === a)!
  const nb = ROAD_NODES.find((n) => n.id === b)!
  return { a: { x: na.x, y: na.y }, b: { x: nb.x, y: nb.y } }
})

export function placePhrase(place: PlaceId): string {
  switch (place) {
    case 'home-a':
      return 'home-a'
    case 'home-b':
      return 'home-b'
    case 'market':
      return 'the market'
    case 'center':
      return 'the town centre'
    case 'work':
      return 'the workshop'
  }
}

export function findMind(state: InkState, id: MindId): Mind {
  return state.minds[0].id === id ? state.minds[0] : state.minds[1]
}

export function otherMind(state: InkState, id: MindId): Mind {
  return state.minds[0].id === id ? state.minds[1] : state.minds[0]
}

export function isHomeId(place: PlaceId): place is HomeId {
  return place === 'home-a' || place === 'home-b'
}

export function fridgeOf(state: InkState, mind: Mind): number {
  return isHomeId(mind.home) ? state.fridges[mind.home] : 0
}

export function setFridge(state: InkState, mind: Mind, n: number): void {
  if (isHomeId(mind.home)) state.fridges[mind.home] = n
}

export function nodeById(id: RoadNodeId): RoadNode {
  return ROAD_NODES.find((n) => n.id === id)!
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps = 0.05): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return dist(p, a) <= eps
  const t = (apx * abx + apy * aby) / len2
  if (t < -1e-6 || t > 1 + 1e-6) return false
  const proj = { x: a.x + t * abx, y: a.y + t * aby }
  return dist(p, proj) <= eps
}

export function pointInRect(p: Vec2, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x - 1e-6 && p.x <= r.x + r.w + 1e-6 && p.y >= r.y - 1e-6 && p.y <= r.y + r.h + 1e-6
}

export function isOnRoadGraph(mind: Mind): boolean {
  if (mind.at) {
    const place = PLACES[mind.at]
    return dist(mind.pos, place.door) <= 0.05 || pointInRect(mind.pos, place.rect)
  }
  return ROAD_SEGMENTS.some((s) => pointOnSegment(mind.pos, s.a, s.b, 0.08))
}

export function placeAtDoor(pos: Vec2, eps = 0.05): PlaceId | null {
  for (const id of PLACE_IDS) {
    if (dist(pos, PLACES[id].door) <= eps) return id
  }
  return null
}

function makeMind(id: MindId, name: string, home: HomeId): Mind {
  const door = PLACES[home].door
  return {
    id,
    name,
    home,
    at: home,
    pos: { x: door.x, y: door.y },
    path: [],
    hunger: 1,
    energy: 1,
    social: 1,
    money: INK_CONFIG.startMoney,
    busyUntilTick: 0,
    collapsedUntilTick: 0,
    collapseGraceUntilTick: 0,
    asleep: false,
    current: null,
    sufferedHours: 0,
  }
}

export function createWorld(seed: number): InkState {
  return {
    tick: INK_CONFIG.startTick,
    seed,
    minds: [makeMind('A', 'A', 'home-a'), makeMind('B', 'B', 'home-b')],
    fridges: { 'home-a': INK_CONFIG.startMeals, 'home-b': INK_CONFIG.startMeals },
    seq: 0,
  }
}

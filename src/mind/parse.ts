import type { ActionKind, AgentState, Intent, Place, WorldState } from '../sim/types'
import { pickPlaceForAgent, placeHasCapacity } from '../sim/spots'

const ACTION_KINDS = new Set<ActionKind>([
  'idle',
  'walk',
  'sleep',
  'eat',
  'drink',
  'socialize',
  'wander',
  'forage',
  'work',
  'buy',
  'commission',
])

export interface MindIntentJson {
  action: string
  target?: string
  reasoning: string
}

export type ParseMindResult =
  | { ok: true; intent: Intent; raw: MindIntentJson }
  | { ok: false; error: string }

/** Strip markdown fences and extract first {...} JSON object. */
export function extractJsonObject(text: string): string | null {
  let s = text.trim()
  // Strip ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function parseMindJson(text: string): ParseMindResult {
  const jsonStr = extractJsonObject(text)
  if (!jsonStr) {
    return { ok: false, error: 'no JSON object in response' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(jsonStr)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'JSON root must be object' }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.action !== 'string') {
    return { ok: false, error: 'missing action string' }
  }
  if (typeof obj.reasoning !== 'string') {
    return { ok: false, error: 'missing reasoning string' }
  }
  if (!ACTION_KINDS.has(obj.action as ActionKind)) {
    return { ok: false, error: `unknown action: ${obj.action}` }
  }
  if (obj.reasoning.length > 160) {
    return { ok: false, error: 'reasoning exceeds 160 chars' }
  }
  if (obj.target !== undefined && typeof obj.target !== 'string') {
    return { ok: false, error: 'target must be string' }
  }
  // Build a partial — target resolution needs world
  return {
    ok: true,
    intent: {
      kind: obj.action as ActionKind,
      reason: obj.reasoning,
    },
    raw: {
      action: obj.action,
      target: typeof obj.target === 'string' ? obj.target : undefined,
      reasoning: obj.reasoning,
    },
  }
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function pickNearestPlace(
  world: WorldState,
  agent: AgentState,
  kind: string,
  requireCapacity: boolean,
): Place | null {
  const list = world.places.filter((p) => p.kind === kind)
  let best: Place | null = null
  let bestD = Infinity
  for (const p of list) {
    if (requireCapacity && !placeHasCapacity(world, p, agent.id)) continue
    const d = dist2(agent.x, agent.y, p.x, p.y)
    if (d < bestD || (d === bestD && best && p.id < best.id)) {
      best = p
      bestD = d
    }
  }
  // Fallback: ignore capacity if none free
  if (!best && requireCapacity) {
    return pickNearestPlace(world, agent, kind, false)
  }
  return best
}

const PLACE_KINDS = new Set([
  'home',
  'berry-bush',
  'well',
  'plaza',
  'farm',
  'stall',
  'forestry',
  'quarry',
  'storehouse',
  'construction-site',
])

/**
 * Resolve model {action,target,reasoning} into a sim Intent with place/coords.
 */
export function resolveMindIntent(
  world: WorldState,
  agent: AgentState,
  raw: MindIntentJson,
): Intent {
  const kind = raw.action as ActionKind
  const reason = raw.reasoning
  const target = raw.target?.trim()

  // Agent name → socialize near them
  if (target) {
    const other = world.agents.find(
      (a) => a.name.toLowerCase() === target.toLowerCase(),
    )
    if (other) {
      return {
        kind: kind === 'idle' || kind === 'walk' ? 'socialize' : kind,
        targetX: Math.round(other.x),
        targetY: Math.round(other.y),
        reason,
      }
    }
  }

  // Place kind → nearest matching place
  let place: Place | null = null
  if (target && PLACE_KINDS.has(target)) {
    place = pickNearestPlace(world, agent, target, true)
  }

  // Defaults by action when no/invalid target
  if (!place) {
    switch (kind) {
      case 'sleep':
        place =
          world.places.find((p) => p.id === agent.homeId) ??
          pickNearestPlace(world, agent, 'home', true)
        break
      case 'forage':
        place = pickNearestPlace(world, agent, 'berry-bush', true)
        break
      case 'drink':
        place = pickNearestPlace(world, agent, 'well', true)
        break
      case 'socialize':
        place = pickNearestPlace(world, agent, 'plaza', true)
        break
      case 'buy':
        place = pickNearestPlace(world, agent, 'stall', true)
        break
      case 'work': {
        if (agent.employedAt) {
          place = world.places.find((p) => p.id === agent.employedAt) ?? null
        }
        if (!place) {
          place =
            pickNearestPlace(world, agent, 'farm', true) ??
            pickNearestPlace(world, agent, 'forestry', true) ??
            pickNearestPlace(world, agent, 'quarry', true) ??
            pickNearestPlace(world, agent, 'stall', true)
        }
        break
      }
      case 'eat':
      case 'idle':
      case 'wander':
      case 'walk':
      case 'commission':
        break
      default:
        break
    }
  }

  // Prefer pickPlaceForAgent for capacity-aware slot when we have a kind
  if (place && (kind === 'forage' || kind === 'drink' || kind === 'socialize')) {
    const alt = pickPlaceForAgent(world, agent, place.kind)
    if (alt.place) place = alt.place
  }

  if (kind === 'wander' || kind === 'idle' || kind === 'eat' || kind === 'commission') {
    return {
      kind,
      reason,
      targetX: kind === 'wander' ? Math.round(agent.x + 1) : undefined,
      targetY: kind === 'wander' ? Math.round(agent.y) : undefined,
    }
  }

  if (!place) {
    return { kind: 'wander', reason, targetX: Math.round(agent.x), targetY: Math.round(agent.y) }
  }

  return {
    kind,
    targetPlaceId: place.id,
    targetX: place.x,
    targetY: place.y,
    reason,
  }
}

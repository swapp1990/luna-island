import type {
  ActionKind,
  AgentState,
  Intent,
  Place,
  PlaceKind,
  VoteChoice,
  WorldState,
} from '../sim/types'
import {
  pickGatherResource,
  pickPlaceForAgent,
  pickShoreStand,
  placeHasCapacity,
} from '../sim/spots'

const ACTION_KINDS = new Set<ActionKind>([
  'idle',
  'walk',
  'sleep',
  'eat',
  'drink',
  'socialize',
  'wander',
  'forage',
  'gather',
  'deliver',
  'work',
  'buy',
  'commission',
  'propose',
  'vote',
  'sanction',
  'claim',
  'examine',
  'give',
])

export interface MindIntentJson {
  action: string
  target?: string
  reasoning: string
  text?: string
  choice?: string
  reason?: string
  ruleId?: string
}

export type ParseMindResult =
  | { ok: true; intent: Intent; raw: MindIntentJson }
  | { ok: false; error: string }

export type ParseReflectionResult =
  | { ok: true; notes: string[]; learned: string[] }
  | { ok: false; error: string }

export type ParseSayResult =
  | { ok: true; say: string; done: boolean }
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
  const action = obj.action as ActionKind
  if (action === 'propose') {
    if (typeof obj.text !== 'string') {
      return { ok: false, error: 'propose requires text string' }
    }
    const text = obj.text.trim()
    if (text.length === 0) return { ok: false, error: 'propose text empty' }
    if (text.length > 200) return { ok: false, error: 'propose text exceeds 200 chars' }
  } else if (action === 'vote') {
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      return { ok: false, error: 'vote requires target proposal id' }
    }
    if (obj.choice !== 'yes' && obj.choice !== 'no') {
      return { ok: false, error: 'vote requires choice yes|no' }
    }
  } else if (action === 'sanction') {
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      return { ok: false, error: 'sanction requires target name' }
    }
    if (typeof obj.reason !== 'string') {
      return { ok: false, error: 'sanction requires reason string' }
    }
    const censure = obj.reason.trim()
    if (censure.length === 0) return { ok: false, error: 'sanction reason empty' }
    if (censure.length > 120) return { ok: false, error: 'sanction reason exceeds 120 chars' }
    if (obj.ruleId !== undefined && typeof obj.ruleId !== 'string') {
      return { ok: false, error: 'ruleId must be string' }
    }
  } else if (action === 'claim') {
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      return { ok: false, error: 'claim requires target place' }
    }
  } else if (action === 'examine') {
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      return { ok: false, error: 'examine requires target place' }
    }
  } else if (action === 'give') {
    if (typeof obj.target !== 'string' || obj.target.trim().length === 0) {
      return { ok: false, error: 'give requires target villager name' }
    }
  }
  // Build a partial — target resolution needs world
  return {
    ok: true,
    intent: {
      kind: action,
      reason: obj.reasoning,
    },
    raw: {
      action: obj.action,
      target: typeof obj.target === 'string' ? obj.target : undefined,
      reasoning: obj.reasoning,
      text: typeof obj.text === 'string' ? obj.text : undefined,
      choice: typeof obj.choice === 'string' ? obj.choice : undefined,
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
      ruleId: typeof obj.ruleId === 'string' ? obj.ruleId : undefined,
    },
  }
}

/**
 * Parse conversation turn: {"say":"…","done":bool} — say ≤140 chars.
 */
export function parseSayJson(text: string): ParseSayResult {
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
  if (typeof obj.say !== 'string') {
    return { ok: false, error: 'missing say string' }
  }
  const say = obj.say.trim()
  if (say.length === 0) {
    return { ok: false, error: 'empty say' }
  }
  if (say.length > 140) {
    return { ok: false, error: 'say exceeds 140 chars' }
  }
  if (typeof obj.done !== 'boolean') {
    return { ok: false, error: 'missing done boolean' }
  }
  return { ok: true, say, done: obj.done }
}

/**
 * Parse nightly reflection: {"notes":["…","…"]} — 1–3 notes, each ≤120 chars.
 */
export function parseReflectionJson(text: string): ParseReflectionResult {
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
  if (!Array.isArray(obj.notes)) {
    return { ok: false, error: 'missing notes array' }
  }
  const notes: string[] = []
  for (const n of obj.notes) {
    if (typeof n !== 'string') {
      return { ok: false, error: 'note must be string' }
    }
    const trimmed = n.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length > 120) {
      return { ok: false, error: 'note exceeds 120 chars' }
    }
    notes.push(trimmed)
  }
  if (notes.length < 1 || notes.length > 3) {
    return { ok: false, error: 'need 1–3 notes' }
  }
  const learned: string[] = []
  if (obj.learned !== undefined) {
    if (!Array.isArray(obj.learned)) {
      return { ok: false, error: 'learned must be array' }
    }
    for (const n of obj.learned) {
      if (typeof n !== 'string') {
        return { ok: false, error: 'learned item must be string' }
      }
      const trimmed = n.trim()
      if (!trimmed) continue
      if (trimmed.length > 120) {
        return { ok: false, error: 'learned exceeds 120 chars' }
      }
      learned.push(trimmed)
      if (learned.length >= 2) break
    }
  }
  return { ok: true, notes, learned }
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
  'notice-board',
  'spring',
])

const BUILDABLE_KINDS = new Set<PlaceKind>([
  'home',
  'farm',
  'well',
  'stall',
  'storehouse',
  'forestry',
  'quarry',
  'notice-board',
])

const PLACE_ALIASES: Record<string, string> = {
  board: 'notice-board',
  'notice board': 'notice-board',
  'town board': 'notice-board',
  'notice-board': 'notice-board',
  bush: 'berry-bush',
  bushes: 'berry-bush',
  'berry bush': 'berry-bush',
  site: 'construction-site',
  'construction site': 'construction-site',
}

function resolvePlaceKindTarget(raw: string): string {
  const key = raw.trim().toLowerCase()
  return PLACE_ALIASES[key] ?? key
}

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

  if (kind === 'propose') {
    return {
      kind: 'propose',
      reason,
      text: (raw.text ?? '').trim().slice(0, 200),
    }
  }

  if (kind === 'vote') {
    const choice: VoteChoice = raw.choice === 'no' ? 'no' : 'yes'
    return {
      kind: 'vote',
      reason,
      proposalId: target ?? '',
      choice,
    }
  }

  if (kind === 'sanction') {
    const other = target
      ? world.agents.find((a) => a.name.toLowerCase() === target.toLowerCase())
      : undefined
    return {
      kind: 'sanction',
      reason,
      targetAgentId: other?.id ?? '',
      text: (raw.reason ?? '').trim().slice(0, 120),
      ruleId: raw.ruleId?.trim() || undefined,
    }
  }

  // Agent name → socialize near them (or give food / walk toward them)
  if (target) {
    const other = world.agents.find(
      (a) => a.name.toLowerCase() === target.toLowerCase(),
    )
    if (other) {
      if (kind === 'give') {
        return {
          kind: 'give',
          reason,
          targetAgentId: other.id,
          targetX: Math.round(other.x),
          targetY: Math.round(other.y),
        }
      }
      return {
        kind: kind === 'idle' || kind === 'walk' ? 'socialize' : kind,
        targetX: Math.round(other.x),
        targetY: Math.round(other.y),
        reason,
        ...(kind !== 'socialize' && kind !== 'idle' && kind !== 'walk'
          ? { targetAgentId: other.id }
          : {}),
      }
    }
  }

  if (kind === 'give') {
    return {
      kind: 'give',
      reason,
      targetAgentId: '',
      targetX: Math.round(agent.x),
      targetY: Math.round(agent.y),
    }
  }

  // Place kind → nearest matching place
  let place: Place | null = null
  const kindTarget = target ? resolvePlaceKindTarget(target) : ''
  if (kindTarget && PLACE_KINDS.has(kindTarget)) {
    place = pickNearestPlace(world, agent, kindTarget, true)
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
      case 'gather':
      case 'deliver':
        break
      case 'claim':
        if (target && !PLACE_KINDS.has(kindTarget)) {
          place = world.places.find((p) => p.id === target) ?? null
        }
        break
      case 'examine':
        if (!place && target) {
          place = world.places.find((p) => p.id === target) ?? null
        }
        if (!place) {
          place = pickNearestPlace(world, agent, 'notice-board', true)
        }
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

  if (kind === 'commission') {
    // Unknown targets stay unknown — sim refuses with a menu felt line.
    // Missing target still defaults to home (legacy minds).
    const buildKind =
      kindTarget.length === 0
        ? 'home'
        : BUILDABLE_KINDS.has(kindTarget as PlaceKind)
          ? (kindTarget as PlaceKind)
          : kindTarget
    return { kind: 'commission', reason, placeKind: buildKind }
  }

  if (kind === 'gather') {
    const prefer =
      kindTarget === 'forest' || target?.toLowerCase() === 'forest'
        ? 'forest'
        : kindTarget === 'rock' ||
            target?.toLowerCase() === 'rock' ||
            target?.toLowerCase() === 'stone'
          ? 'rock'
          : undefined
    const tile = pickGatherResource(world, agent, prefer)
    if (!tile) {
      return { kind: 'wander', reason, targetX: Math.round(agent.x), targetY: Math.round(agent.y) }
    }
    return { kind: 'gather', reason, targetX: tile.x, targetY: tile.y }
  }

  if (kind === 'deliver') {
    if (!place || place.kind !== 'construction-site') {
      place = pickNearestPlace(world, agent, 'construction-site', true)
    }
    if (!place) {
      return { kind: 'wander', reason, targetX: Math.round(agent.x), targetY: Math.round(agent.y) }
    }
    return {
      kind: 'deliver',
      reason,
      targetPlaceId: place.id,
      targetX: place.x,
      targetY: place.y,
    }
  }

  if (kind === 'wander' || kind === 'idle' || kind === 'eat') {
    return {
      kind,
      reason,
      targetX: kind === 'wander' ? Math.round(agent.x + 1) : undefined,
      targetY: kind === 'wander' ? Math.round(agent.y) : undefined,
    }
  }

  if (kind === 'drink' && !place) {
    const shore = pickShoreStand(world, agent)
    if (shore) {
      return { kind: 'drink', reason, targetX: shore.x, targetY: shore.y }
    }
  }

  if (kind === 'claim') {
    if (!place) {
      return { kind: 'wander', reason, targetX: Math.round(agent.x), targetY: Math.round(agent.y) }
    }
    return {
      kind: 'claim',
      reason,
      targetPlaceId: place.id,
      targetX: place.x,
      targetY: place.y,
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

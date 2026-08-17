/**
 * Replay-safe action language: posture / glyph / prop / burst descriptors.
 * Pure data — no three.js, no DOM. Renderer applies these; tests assert them.
 */
import type { AgentState, SimEvent } from '../sim/types'

/** Trailing window for event-derived bursts and residual examine lean. */
export const BURST_WINDOW = 4

/** Matches sim `need:critical` threshold (src/sim/sim.ts checkCritical). */
export const CRITICAL_NEED = 0.15

export type PostureKind =
  | 'standing'
  | 'fallen'
  | 'lying'
  | 'lean-in'
  | 'sitting'
  | 'working'
  | 'walking'
  | 'socializing'

export type GlyphKind = 'collapsed' | 'hunger' | 'energy' | 'social' | 'examine' | 'sleep'

export type PropKind = 'berry' | 'mug'

export type BurstKind = 'dust-puff' | 'sparkle' | 'coin-glint' | 'shimmer'

export interface AgentVisual {
  posture: PostureKind
  glyph: GlyphKind | null
  prop: PropKind | null
}

export interface Burst {
  agentId: string
  kind: BurstKind
  ageTicks: number
  seq: number
  /** Payee / partner for coin-glint midpoint. */
  otherId?: string
  /** Examine target for shimmer. */
  placeId?: string
}

export interface DescribeOpts {
  /** Active speech bubble suppresses the glyph (talk already has a channel). */
  speechActive?: boolean
  /** Trailing-window events — residual examine lean after the verb completes. */
  events?: readonly SimEvent[]
}

interface ActionRow {
  posture: PostureKind
  glyph?: GlyphKind
  prop?: PropKind
}

/** Unregistered kinds fall through to standing / no glyph / no prop. */
const ACTION_TABLE: Partial<Record<string, ActionRow>> = {
  sleep: { posture: 'lying', glyph: 'sleep' },
  examine: { posture: 'lean-in', glyph: 'examine' },
  eat: { posture: 'sitting', prop: 'berry' },
  drink: { posture: 'sitting', prop: 'mug' },
  work: { posture: 'working' },
  socialize: { posture: 'socializing' },
  walk: { posture: 'walking' },
  wander: { posture: 'walking' },
}

export function isTraveling(agent: AgentState): boolean {
  const path = agent.action.path
  return !!(path && path.length > 0 && agent.pathIndex < path.length)
}

function eventAge(ev: SimEvent, tick: number): number {
  return tick - ev.tick
}

function hasRecentEvent(
  events: readonly SimEvent[] | undefined,
  agentId: string,
  type: string,
  tick: number,
): SimEvent | null {
  if (!events) return null
  let best: SimEvent | null = null
  for (const ev of events) {
    if (ev.type !== type || ev.agentId !== agentId) continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > BURST_WINDOW) continue
    if (!best || ev.seq > best.seq) best = ev
  }
  return best
}

function criticalGlyph(agent: AgentState): GlyphKind | null {
  const n = agent.needs
  if (n.hunger < CRITICAL_NEED) return 'hunger'
  if (n.energy < CRITICAL_NEED) return 'energy'
  if (n.social < CRITICAL_NEED) return 'social'
  return null
}

function pickGlyph(
  agent: AgentState,
  tableGlyph: GlyphKind | null,
  recentExamine: boolean,
  speechActive: boolean,
): GlyphKind | null {
  if (speechActive) return null
  if (agent.collapsed) return 'collapsed'
  const crit = criticalGlyph(agent)
  if (crit) return crit
  if (tableGlyph === 'examine' || recentExamine) return 'examine'
  if (tableGlyph === 'sleep') return 'sleep'
  return null
}

/**
 * What the pixels should say about this agent at `tick`.
 * Collapsed / sleep / examine / eat are posture-first; unregistered kinds stand.
 */
export function describeAgent(
  agent: AgentState,
  tick: number,
  opts?: DescribeOpts,
): AgentVisual {
  const speechActive = opts?.speechActive === true
  const recentExamineEv = hasRecentEvent(opts?.events, agent.id, 'discovery:examined', tick)
  const recentExamine = !!recentExamineEv
  const recentCollapse = hasRecentEvent(opts?.events, agent.id, 'agent:collapsed', tick)
  const recentRecover = hasRecentEvent(opts?.events, agent.id, 'agent:recovered', tick)
  const collapseFromTrace =
    !!recentCollapse && (!recentRecover || recentCollapse.seq > recentRecover.seq)
  const traveling = isTraveling(agent)
  const kind = agent.action.kind
  const row = ACTION_TABLE[kind]

  // State or a collapse event in the trailing window (trace wins when
  // stateAt and the live log disagree on an archived tick). A later
  // recover in the same window cancels the residual fall.
  if (agent.collapsed || collapseFromTrace) {
    return {
      posture: 'fallen',
      glyph: speechActive ? null : 'collapsed',
      prop: null,
    }
  }

  if (!traveling && row && kind === 'sleep') {
    return {
      posture: 'lying',
      glyph: pickGlyph(agent, 'sleep', false, speechActive),
      prop: null,
    }
  }

  if (!traveling && row && (kind === 'eat' || kind === 'drink')) {
    return {
      posture: 'sitting',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: row.prop ?? null,
    }
  }

  if (!traveling && row && kind === 'work') {
    return {
      posture: 'working',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    }
  }

  // Examine leans even while walking toward the target (table: examine → lean-in).
  // Residual window covers the same-tick redecide after completeExamine.
  if (kind === 'examine' || recentExamine) {
    return {
      posture: 'lean-in',
      glyph: pickGlyph(agent, 'examine', recentExamine, speechActive),
      prop: null,
    }
  }

  if (!traveling && row && kind === 'socialize') {
    return {
      posture: 'socializing',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    }
  }

  if (traveling) {
    return {
      posture: 'walking',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    }
  }

  // Unregistered kinds (propose/vote/…) and idle: stand.
  return {
    posture: 'standing',
    glyph: pickGlyph(agent, null, recentExamine, speechActive),
    prop: null,
  }
}

function strData(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = data?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function partyId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw === 'treasury') return undefined
  return raw
}

function burstFromEvent(ev: SimEvent, tick: number): Burst | null {
  const age = eventAge(ev, tick)
  if (age < 0 || age > BURST_WINDOW) return null
  const data = ev.data as Record<string, unknown> | undefined

  if (ev.type === 'agent:collapsed' && ev.agentId) {
    return { agentId: ev.agentId, kind: 'dust-puff', ageTicks: age, seq: ev.seq }
  }
  if (ev.type === 'agent:recovered' && ev.agentId) {
    return { agentId: ev.agentId, kind: 'sparkle', ageTicks: age, seq: ev.seq }
  }
  if (ev.type === 'coins:transfer') {
    const from = partyId(data?.from)
    const to = partyId(data?.to)
    const agentId = ev.agentId ?? to ?? from
    if (!agentId) return null
    const otherId = agentId === from ? to : from
    return {
      agentId,
      kind: 'coin-glint',
      ageTicks: age,
      seq: ev.seq,
      ...(otherId ? { otherId } : {}),
    }
  }
  if (ev.type === 'discovery:examined' && ev.agentId) {
    const placeId = strData(data, 'target')
    return {
      agentId: ev.agentId,
      kind: 'shimmer',
      ageTicks: age,
      seq: ev.seq,
      ...(placeId ? { placeId } : {}),
    }
  }
  return null
}

/**
 * Event-anchored bursts in the trailing window. ≤1 per agent (latest seq wins).
 * Same (events, tick) ⇒ same descriptors — seq is the seed, no RNG.
 */
export function describeBursts(events: readonly SimEvent[], tick: number): Burst[] {
  const byAgent = new Map<string, Burst>()
  for (const ev of events) {
    const burst = burstFromEvent(ev, tick)
    if (!burst) continue
    const prev = byAgent.get(burst.agentId)
    if (!prev || burst.seq >= prev.seq) byAgent.set(burst.agentId, burst)
  }
  return [...byAgent.values()].sort((a, b) => a.seq - b.seq)
}

/** Path destination for the selected-agent ground marker. */
export function describeDestination(agent: AgentState): { x: number; y: number } | null {
  if (!isTraveling(agent)) return null
  const path = agent.action.path
  if (path && path.length > 0) {
    const last = path[path.length - 1]!
    return { x: last[0], y: last[1] }
  }
  if (agent.action.targetX != null && agent.action.targetY != null) {
    return { x: agent.action.targetX, y: agent.action.targetY }
  }
  return null
}

export const GLYPH_EMOJI: Record<GlyphKind, string> = {
  collapsed: '❗',
  hunger: '🍖',
  energy: '😴',
  social: '💬',
  examine: '🔍',
  sleep: '💤',
}

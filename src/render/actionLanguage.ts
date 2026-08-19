/**
 * Replay-safe action language: posture / glyph / prop / burst / staging descriptors.
 * Pure data — no three.js, no DOM. Renderer applies these; tests assert them.
 */
import type { AgentState, SimEvent } from '../sim/types'

/** Trailing window for event-derived bursts and residual examine lean. */
export const BURST_WINDOW = 4

/** Trailing window for mind:say speech bubbles (tick-based, photo-safe). */
export const SAY_WINDOW = 8

/** Trailing window for construction:commissioned ceremony + scroll prop. */
export const COMMISSION_WINDOW = 6

/** Max visible chars in a speech bubble before ellipsis. */
export const SAY_MAX_CHARS = 60

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

export type PropKind = 'berry' | 'mug' | 'scroll'

export type BurstKind = 'dust-puff' | 'sparkle' | 'coin-glint' | 'shimmer'

export interface AgentVisual {
  posture: PostureKind
  glyph: GlyphKind | null
  prop: PropKind | null
  /**
   * When glyph is `examine`, hover it over this place instead of the agent.
   * Null/undefined → agent-anchored (legacy glyphs).
   */
  glyphPlaceId?: string | null
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

export interface SpeechBubble {
  agentId: string
  text: string
  ageTicks: number
  seq: number
  partnerId?: string
}

export interface CommissionCeremony {
  agentId: string
  placeId: string
  ageTicks: number
  seq: number
}

/** Render-side facing cue — never mutates sim state. */
export type FacingTarget =
  | { kind: 'agent'; id: string }
  | { kind: 'place'; id: string }

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
  gather: { posture: 'working' },
  deliver: { posture: 'working' },
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
  window = BURST_WINDOW,
): SimEvent | null {
  if (!events) return null
  let best: SimEvent | null = null
  for (const ev of events) {
    if (ev.type !== type || ev.agentId !== agentId) continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > window) continue
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
  // Interaction staging: examine glyph on the target beats ambient critical needs.
  if (tableGlyph === 'examine' || recentExamine) return 'examine'
  const crit = criticalGlyph(agent)
  if (crit) return crit
  if (tableGlyph === 'sleep') return 'sleep'
  return null
}

function strData(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = data?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function partyId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw === 'treasury') return undefined
  return raw
}

/** Truncate utterance for on-screen bubble (ASCII ellipsis — headless-safe). */
export function truncateSay(text: string, max = SAY_MAX_CHARS): string {
  const t = text
    .trim()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2026/g, '...')
  if (t.length <= max) return t
  if (max <= 3) return '...'
  return `${t.slice(0, max - 3)}...`
}

/**
 * Event-derived speech bubbles. Latest mind:say per agent within SAY_WINDOW wins.
 * Sheep template replies also land as mind:say with text — same channel.
 */
export function describeSpeechBubbles(
  events: readonly SimEvent[],
  tick: number,
): SpeechBubble[] {
  const byAgent = new Map<string, SpeechBubble>()
  for (const ev of events) {
    if (ev.type !== 'mind:say' || !ev.agentId) continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > SAY_WINDOW) continue
    const data = ev.data as Record<string, unknown> | undefined
    const raw = strData(data, 'text')
    if (!raw) continue
    const bubble: SpeechBubble = {
      agentId: ev.agentId,
      text: truncateSay(raw),
      ageTicks: age,
      seq: ev.seq,
      ...(strData(data, 'partnerId') ? { partnerId: strData(data, 'partnerId') } : {}),
    }
    const prev = byAgent.get(ev.agentId)
    if (!prev || bubble.seq >= prev.seq) byAgent.set(ev.agentId, bubble)
  }
  return [...byAgent.values()].sort((a, b) => a.seq - b.seq)
}

export function speechTextFor(
  events: readonly SimEvent[] | undefined,
  agentId: string,
  tick: number,
): string | null {
  if (!events) return null
  const hit = describeSpeechBubbles(events, tick).find((b) => b.agentId === agentId)
  return hit?.text ?? null
}

/** Examine target place id during the action or residual burst window. */
export function examineTargetId(
  agent: AgentState,
  tick: number,
  events?: readonly SimEvent[],
): string | null {
  if (agent.action.kind === 'examine') {
    const tid = agent.action.targetPlaceId
    if (tid) return tid
  }
  const ev = hasRecentEvent(events, agent.id, 'discovery:examined', tick)
  return ev ? (strData(ev.data as Record<string, unknown> | undefined, 'target') ?? null) : null
}

/**
 * Commission ceremonies in the trailing window (one per place, latest seq).
 */
export function describeCommissionCeremonies(
  events: readonly SimEvent[],
  tick: number,
): CommissionCeremony[] {
  const byPlace = new Map<string, CommissionCeremony>()
  for (const ev of events) {
    if (ev.type !== 'construction:commissioned' || !ev.agentId) continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > COMMISSION_WINDOW) continue
    const placeId = strData(ev.data as Record<string, unknown> | undefined, 'placeId')
    if (!placeId) continue
    const row: CommissionCeremony = {
      agentId: ev.agentId,
      placeId,
      ageTicks: age,
      seq: ev.seq,
    }
    const prev = byPlace.get(placeId)
    if (!prev || row.seq >= prev.seq) byPlace.set(placeId, row)
  }
  return [...byPlace.values()].sort((a, b) => a.seq - b.seq)
}

function commissionForAgent(
  events: readonly SimEvent[] | undefined,
  agentId: string,
  tick: number,
): CommissionCeremony | null {
  if (!events) return null
  let best: CommissionCeremony | null = null
  for (const c of describeCommissionCeremonies(events, tick)) {
    if (c.agentId !== agentId) continue
    if (!best || c.seq > best.seq) best = c
  }
  return best
}

/**
 * Conversation partner from say-events in SAY_WINDOW (speaker or addressee).
 * Latest involving this agent wins.
 */
export function conversationPartnerId(
  events: readonly SimEvent[] | undefined,
  agentId: string,
  tick: number,
): string | null {
  if (!events) return null
  let bestSeq = -1
  let partner: string | null = null
  for (const ev of events) {
    if (ev.type !== 'mind:say') continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > SAY_WINDOW) continue
    const data = ev.data as Record<string, unknown> | undefined
    const other = strData(data, 'partnerId')
    if (ev.agentId === agentId && other) {
      if (ev.seq >= bestSeq) {
        bestSeq = ev.seq
        partner = other
      }
    } else if (other === agentId && ev.agentId) {
      if (ev.seq >= bestSeq) {
        bestSeq = ev.seq
        partner = ev.agentId
      }
    }
  }
  return partner
}

function tradePartnerId(
  events: readonly SimEvent[] | undefined,
  agentId: string,
  tick: number,
): string | null {
  if (!events) return null
  let best: SimEvent | null = null
  for (const ev of events) {
    if (ev.type !== 'coins:transfer') continue
    const age = eventAge(ev, tick)
    if (age < 0 || age > BURST_WINDOW) continue
    const data = ev.data as Record<string, unknown> | undefined
    const from = partyId(data?.from)
    const to = partyId(data?.to)
    if (agentId !== from && agentId !== to) continue
    if (!best || ev.seq > best.seq) best = ev
  }
  if (!best) return null
  const data = best.data as Record<string, unknown> | undefined
  const from = partyId(data?.from)
  const to = partyId(data?.to)
  if (agentId === from) return to ?? null
  if (agentId === to) return from ?? null
  return null
}

/**
 * Facing target resolution (render-only).
 * Priority: conversation partner > examine target > commission site > trade partner > none.
 * Callers must not apply this while the agent is pathing (path yaw wins).
 */
export function describeFacingTarget(
  agent: AgentState,
  tick: number,
  opts?: DescribeOpts,
): FacingTarget | null {
  const events = opts?.events
  const partner = conversationPartnerId(events, agent.id, tick)
  if (partner) return { kind: 'agent', id: partner }

  const examineId = examineTargetId(agent, tick, events)
  if (examineId) return { kind: 'place', id: examineId }

  const commission = commissionForAgent(events, agent.id, tick)
  if (commission) return { kind: 'place', id: commission.placeId }

  const trade = tradePartnerId(events, agent.id, tick)
  if (trade) return { kind: 'agent', id: trade }

  return null
}

function withGlyphPlace(
  visual: AgentVisual,
  agent: AgentState,
  tick: number,
  events: readonly SimEvent[] | undefined,
): AgentVisual {
  if (visual.glyph !== 'examine') return visual
  const placeId = examineTargetId(agent, tick, events)
  return placeId ? { ...visual, glyphPlaceId: placeId } : visual
}

function withCommissionScroll(
  visual: AgentVisual,
  agent: AgentState,
  tick: number,
  events: readonly SimEvent[] | undefined,
): AgentVisual {
  if (visual.prop === 'berry' || visual.prop === 'mug') return visual
  const commission = commissionForAgent(events, agent.id, tick)
  if (!commission) return visual
  return { ...visual, prop: 'scroll' }
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
  const events = opts?.events
  const speechActive =
    opts?.speechActive === true || speechTextFor(events, agent.id, tick) !== null
  const recentExamineEv = hasRecentEvent(events, agent.id, 'discovery:examined', tick)
  const recentExamine = !!recentExamineEv
  const recentCollapse = hasRecentEvent(events, agent.id, 'agent:collapsed', tick)
  const recentRecover = hasRecentEvent(events, agent.id, 'agent:recovered', tick)
  const collapseFromTrace =
    !!recentCollapse && (!recentRecover || recentCollapse.seq > recentRecover.seq)
  const traveling = isTraveling(agent)
  const kind = agent.action.kind
  const row = ACTION_TABLE[kind]

  const finish = (visual: AgentVisual): AgentVisual =>
    withCommissionScroll(withGlyphPlace(visual, agent, tick, events), agent, tick, events)

  // State or a collapse event in the trailing window (trace wins when
  // stateAt and the live log disagree on an archived tick). A later
  // recover in the same window cancels the residual fall.
  if (agent.collapsed || collapseFromTrace) {
    return finish({
      posture: 'fallen',
      glyph: speechActive ? null : 'collapsed',
      prop: null,
    })
  }

  if (!traveling && row && kind === 'sleep') {
    return finish({
      posture: 'lying',
      glyph: pickGlyph(agent, 'sleep', false, speechActive),
      prop: null,
    })
  }

  if (!traveling && row && (kind === 'eat' || kind === 'drink')) {
    return finish({
      posture: 'sitting',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: row.prop ?? null,
    })
  }

  if (
    !traveling &&
    row &&
    (kind === 'work' || kind === 'gather' || kind === 'deliver')
  ) {
    return finish({
      posture: 'working',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    })
  }

  // Examine leans even while walking toward the target (table: examine → lean-in).
  // Residual window covers the same-tick redecide after completeExamine.
  if (kind === 'examine' || recentExamine) {
    return finish({
      posture: 'lean-in',
      glyph: pickGlyph(agent, 'examine', recentExamine, speechActive),
      prop: null,
    })
  }

  if (!traveling && row && kind === 'socialize') {
    return finish({
      posture: 'socializing',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    })
  }

  if (traveling) {
    return finish({
      posture: 'walking',
      glyph: pickGlyph(agent, null, recentExamine, speechActive),
      prop: null,
    })
  }

  // Unregistered kinds (propose/vote/…) and idle: stand.
  return finish({
    posture: 'standing',
    glyph: pickGlyph(agent, null, recentExamine, speechActive),
    prop: null,
  })
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

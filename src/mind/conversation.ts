/**
 * Conversation engine (app-side mind layer).
 * Eligibility, turn order, cooldowns — no world mechanics; only posts says via sim.
 */

import type { Simulation } from '../sim/sim'
import type { AgentState, SayRecord, SimEvent, WorldState } from '../sim/types'
import { isStanding, SOCIAL_PROXIMITY_SQ } from '../sim/spots'
import { toSimTime } from '../sim/time'
import { anyNeedCritical } from '../sim/utilityBrain'
import { isLunaAgent, LUNA_AGENT_IDS } from './personas'
import { episodicMemories, standingFacts } from './memory'
import { personaFor } from './personas'

/** Same-pair cooldown: 4 sim-hours. */
export const PAIR_COOLDOWN_TICKS = 4 * 60
/** Per-agent any-partner cooldown: 1 sim-hour. */
export const AGENT_COOLDOWN_TICKS = 60
/** Max turns per conversation (strict alternation). */
export const MAX_CONVERSATION_TURNS = 4
/** Island-wide concurrent conversations (P3-2c). */
export const MAX_ACTIVE_CONVERSATIONS = 2
/** Graceful end text on invalid JSON (no fallback storm). */
export const TRAILS_OFF = '…(trails off)'

export interface ConversationTurnLine {
  agentId: string
  name: string
  text: string
}

export interface ActiveConversation {
  id: string
  agentIdA: string
  agentIdB: string
  /** Next speaker for the upcoming turn. */
  nextSpeakerId: string
  /** 0-based turn index of the next utterance. */
  nextTurn: number
  transcript: ConversationTurnLine[]
  startedTick: number
  /** True while a turn is queued / in-flight / held for the next speaker. */
  turnInFlight: boolean
  /** Last applied utterance text (for episodic on end). */
  lastText: string
  /** True once a done:true utterance has been posted or held. */
  closed: boolean
  /** True when one side is a UtilityBrain sheep (template replies). */
  mixed: boolean
}

export interface ConversationEndResult {
  conversationId: string
  agentIdA: string
  agentIdB: string
  lastText: string
  startedTick: number
  endTick: number
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/**
 * Continuation rule (P3-2c): both stationary within 1.5 tiles, no urgent need.
 * Action kind does not matter — chatting over a meal is village life.
 * Movement (walking) or any need < 0.15 ends the conversation.
 */
export function conversationContinues(a: AgentState, b: AgentState): boolean {
  if (!isStanding(a) || !isStanding(b)) return false
  if (dist2(a.x, a.y, b.x, b.y) > SOCIAL_PROXIMITY_SQ + 1e-9) return false
  if (anyNeedCritical(a) || anyNeedCritical(b)) return false
  return true
}

/**
 * @deprecated Prefer conversationContinues for active chats.
 * Kept name used by older call sites; maps to stationary-only (not action-gated).
 */
export function participantConversationOk(agent: AgentState): boolean {
  return isStanding(agent)
}

/**
 * Eligibility for starting a new conversation.
 * - mind↔mind or mind↔sheep (never sheep↔sheep)
 * - both standing, within proximity, at least one socializing
 * - cooldowns
 */
export function pairEligible(
  a: AgentState,
  b: AgentState,
  tick: number,
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
): boolean {
  const aLuna = isLunaAgent(a.id)
  const bLuna = isLunaAgent(b.id)
  // Need at least one mind; never sheep↔sheep
  if (!aLuna && !bLuna) return false
  if (!isStanding(a) || !isStanding(b)) return false
  if (a.action.kind !== 'socialize' && b.action.kind !== 'socialize') return false
  if (dist2(a.x, a.y, b.x, b.y) > SOCIAL_PROXIMITY_SQ + 1e-9) return false

  const lastPair = pairLastEnd.get(pairKey(a.id, b.id))
  if (lastPair != null && tick - lastPair < PAIR_COOLDOWN_TICKS) return false
  const lastA = agentLastEnd.get(a.id)
  if (lastA != null && tick - lastA < AGENT_COOLDOWN_TICKS) return false
  const lastB = agentLastEnd.get(b.id)
  if (lastB != null && tick - lastB < AGENT_COOLDOWN_TICKS) return false
  return true
}

export function isMixedPair(a: AgentState, b: AgentState): boolean {
  return isLunaAgent(a.id) !== isLunaAgent(b.id)
}

/**
 * First speaker:
 * - mind↔sheep: always the mind (sheeps never initiate)
 * - mind↔mind: lower sympathy toward the other (ties: id ascending)
 */
export function firstSpeakerId(a: AgentState, b: AgentState): string {
  const aLuna = isLunaAgent(a.id)
  const bLuna = isLunaAgent(b.id)
  if (aLuna && !bLuna) return a.id
  if (bLuna && !aLuna) return b.id
  const symA = a.sympathy?.[b.id] ?? 0
  const symB = b.sympathy?.[a.id] ?? 0
  if (symA < symB) return a.id
  if (symB < symA) return b.id
  return a.id < b.id ? a.id : b.id
}

export function makeConversationId(
  tick: number,
  agentIdA: string,
  agentIdB: string,
): string {
  const [lo, hi] = agentIdA < agentIdB ? [agentIdA, agentIdB] : [agentIdB, agentIdA]
  return `conv-${tick}-${lo}-${hi}`
}

export interface EligiblePair {
  a: AgentState
  b: AgentState
  key: string
  mixed: boolean
}

/**
 * Collect eligible pairs not involving busy agents, respecting mind↔mind cap.
 * Deterministic sort by pair key.
 */
export function findEligiblePairs(
  world: WorldState,
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
  busyAgentIds: ReadonlySet<string>,
  opts: { allowMindMind: boolean },
): EligiblePair[] {
  const tick = world.tick
  const agents = world.agents
  const candidates: EligiblePair[] = []

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!
      const b = agents[j]!
      if (busyAgentIds.has(a.id) || busyAgentIds.has(b.id)) continue
      if (!pairEligible(a, b, tick, pairLastEnd, agentLastEnd)) continue
      const mixed = isMixedPair(a, b)
      if (!mixed && !opts.allowMindMind) continue
      // mind↔sheep: require the mind side to be socializing (mind initiates intent)
      if (mixed) {
        const mind = isLunaAgent(a.id) ? a : b
        if (mind.action.kind !== 'socialize') continue
      }
      candidates.push({ a, b, key: pairKey(a.id, b.id), mixed })
    }
  }
  candidates.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  return candidates
}

/**
 * First eligible pair (backward-compatible helper).
 */
export function findEligiblePair(
  world: WorldState,
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
  busyAgentIds: ReadonlySet<string> = new Set(),
  opts: { allowMindMind: boolean } = { allowMindMind: true },
): { a: AgentState; b: AgentState } | null {
  const list = findEligiblePairs(world, pairLastEnd, agentLastEnd, busyAgentIds, opts)
  if (list.length === 0) return null
  const best = list[0]!
  return { a: best.a, b: best.b }
}

export function startConversation(
  sim: Simulation,
  a: AgentState,
  b: AgentState,
): ActiveConversation {
  const speaker = firstSpeakerId(a, b)
  const id = makeConversationId(sim.state.tick, a.id, b.id)
  // Ticker "are talking" derives from first mind:say (turn 0) — no extra log.
  void sim
  return {
    id,
    agentIdA: a.id,
    agentIdB: b.id,
    nextSpeakerId: speaker,
    nextTurn: 0,
    transcript: [],
    startedTick: sim.state.tick,
    turnInFlight: false,
    lastText: '',
    closed: false,
    mixed: isMixedPair(a, b),
  }
}

/** Partner id for a speaker in this conversation. */
export function partnerOf(conv: ActiveConversation, speakerId: string): string {
  return speakerId === conv.agentIdA ? conv.agentIdB : conv.agentIdA
}

/**
 * Memory lines of the speaker that mention the partner's name (up to 3).
 */
export function partnerMentionMemories(
  speakerId: string,
  partnerName: string,
  events: readonly SimEvent[],
  mindNoteLog: WorldState['mindNoteLog'],
): string[] {
  const name = partnerName.trim()
  if (!name) return []
  const lower = name.toLowerCase()
  const lines: string[] = []
  // Reflections that mention partner
  for (let i = mindNoteLog.length - 1; i >= 0 && lines.length < 3; i--) {
    const rec = mindNoteLog[i]!
    if (rec.agentId !== speakerId) continue
    for (let j = rec.notes.length - 1; j >= 0 && lines.length < 3; j--) {
      const n = rec.notes[j]!
      if (n.toLowerCase().includes(lower)) lines.push(n)
    }
  }
  // Episodics that mention partner
  const ep = episodicMemories(speakerId, events)
  for (let i = ep.length - 1; i >= 0 && lines.length < 3; i--) {
    if (ep[i]!.text.toLowerCase().includes(lower)) lines.push(ep[i]!.text)
  }
  return lines.slice(0, 3)
}

const GROUNDING =
  'GROUNDING: Cite only facts present in your observation and memories. Never invent numbers, events, or possessions.'

const SAY_CONTRACT = `RESPONSE CONTRACT — reply with ONLY one JSON object, no markdown:
{"say":"<≤140 chars, in your voice, first person, to your partner>","done":<bool>}
Set done:true when you want to end the chat (or after a natural close). Keep it short and in character.`

export function buildConversationSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}\n\n${GROUNDING}\n\n${SAY_CONTRACT}`
}

export function buildConversationUserPrompt(
  speaker: AgentState,
  partner: AgentState,
  world: WorldState,
  events: readonly SimEvent[],
  transcript: ConversationTurnLine[],
): string {
  const t = toSimTime(world.tick)
  const sym = Math.round((speaker.sympathy?.[partner.id] ?? 0) * 100) / 100
  const mentions = partnerMentionMemories(
    speaker.id,
    partner.name,
    events,
    world.mindNoteLog ?? [],
  )
  const standing = standingFacts(speaker, world).slice(0, 3)
  const needs = `hunger ${Math.round(speaker.needs.hunger * 100)}% energy ${Math.round(speaker.needs.energy * 100)}% social ${Math.round(speaker.needs.social * 100)}%`
  const transcriptLines =
    transcript.length === 0
      ? '(conversation just started — you speak first)'
      : transcript.map((l) => `${l.name}: "${l.text}"`).join('\n')

  const lines = [
    `Time: Day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`,
    `You are speaking with ${partner.name} (sympathy ${sym}).`,
    `Your needs: ${needs}`,
    `Standing facts:`,
    ...standing.map((s) => `- ${s}`),
    `Memories about ${partner.name}:`,
    ...(mentions.length ? mentions.map((m) => `- ${m}`) : ['- (none yet)']),
    `Transcript so far:`,
    transcriptLines,
    `Reply ONLY {"say":"…","done":true|false}.`,
  ]
  return lines.join('\n')
}

/** Register cooldowns after a conversation ends. */
export function applyCooldowns(
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
  agentIdA: string,
  agentIdB: string,
  endTick: number,
): void {
  pairLastEnd.set(pairKey(agentIdA, agentIdB), endTick)
  agentLastEnd.set(agentIdA, endTick)
  agentLastEnd.set(agentIdB, endTick)
}

/** All luna agent ids (for tests / bridge). */
export function lunaIds(): readonly string[] {
  return LUNA_AGENT_IDS
}

/** Rebuild conversation list for UI from sayLog. */
export function conversationsForAgent(
  agentId: string,
  sayLog: readonly SayRecord[],
  agents: readonly AgentState[],
): Array<{
  conversationId: string
  partnerId: string
  partnerName: string
  startedTick: number
  turns: Array<{ agentId: string; name: string; text: string; tick: number; turn: number }>
}> {
  const byId = new Map<
    string,
    {
      conversationId: string
      partnerId: string
      partnerName: string
      startedTick: number
      turns: Array<{
        agentId: string
        name: string
        text: string
        tick: number
        turn: number
      }>
    }
  >()
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  for (const s of sayLog) {
    if (s.agentId !== agentId && s.partnerId !== agentId) continue
    let row = byId.get(s.conversationId)
    if (!row) {
      const partnerId = s.agentId === agentId ? s.partnerId : s.agentId
      row = {
        conversationId: s.conversationId,
        partnerId,
        partnerName: nameOf(partnerId),
        startedTick: s.tick,
        turns: [],
      }
      byId.set(s.conversationId, row)
    }
    row.turns.push({
      agentId: s.agentId,
      name: nameOf(s.agentId),
      text: s.text,
      tick: s.tick,
      turn: s.turn,
    })
    if (s.tick < row.startedTick) row.startedTick = s.tick
  }

  const list = [...byId.values()]
  for (const c of list) {
    c.turns.sort((a, b) => a.turn - b.turn || a.tick - b.tick)
  }
  list.sort((a, b) => b.startedTick - a.startedTick)
  return list
}

/**
 * Conversation engine (app-side mind layer).
 * Eligibility, turn order, cooldowns — no world mechanics; only posts says via sim.
 */

import type { Simulation } from '../sim/sim'
import type { AgentState, SayRecord, SimEvent, WorldState } from '../sim/types'
import { isStanding, SOCIAL_PROXIMITY_SQ } from '../sim/spots'
import { toSimTime } from '../sim/time'
import { isLunaAgent, LUNA_AGENT_IDS } from './personas'
import { episodicMemories, standingFacts } from './memory'
import { personaFor } from './personas'

/** Same-pair cooldown: 4 sim-hours. */
export const PAIR_COOLDOWN_TICKS = 4 * 60
/** Per-agent any-partner cooldown: 1 sim-hour. */
export const AGENT_COOLDOWN_TICKS = 60
/** Max turns per conversation (strict alternation). */
export const MAX_CONVERSATION_TURNS = 4
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
}

export interface ConversationEndResult {
  conversationId: string
  agentIdA: string
  agentIdB: string
  lastText: string
  startedTick: number
  endTick: number
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

/** Participant still valid for an active conversation. */
export function participantConversationOk(agent: AgentState): boolean {
  return isStanding(agent) && agent.action.kind === 'socialize'
}

/**
 * Eligibility for starting a new conversation between two luna agents.
 */
export function pairEligible(
  a: AgentState,
  b: AgentState,
  tick: number,
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
): boolean {
  if (!isLunaAgent(a.id) || !isLunaAgent(b.id)) return false
  if (!isStanding(a) || !isStanding(b)) return false
  if (a.action.kind !== 'socialize' && b.action.kind !== 'socialize') return false
  // At least one socialize (checked); both stationary (checked)
  if (dist2(a.x, a.y, b.x, b.y) > SOCIAL_PROXIMITY_SQ + 1e-9) return false

  const lastPair = pairLastEnd.get(pairKey(a.id, b.id))
  if (lastPair != null && tick - lastPair < PAIR_COOLDOWN_TICKS) return false
  const lastA = agentLastEnd.get(a.id)
  if (lastA != null && tick - lastA < AGENT_COOLDOWN_TICKS) return false
  const lastB = agentLastEnd.get(b.id)
  if (lastB != null && tick - lastB < AGENT_COOLDOWN_TICKS) return false
  return true
}

/**
 * First speaker = agent with lower sympathy toward the other (more reason to reach out).
 * Ties broken by agent id ascending.
 */
export function firstSpeakerId(a: AgentState, b: AgentState): string {
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

/**
 * Find the best eligible pair (deterministic: sort by pair key).
 * Returns null if none or if active already exists (caller enforces max-one).
 */
export function findEligiblePair(
  world: WorldState,
  pairLastEnd: Map<string, number>,
  agentLastEnd: Map<string, number>,
): { a: AgentState; b: AgentState } | null {
  const tick = world.tick
  const luna = world.agents.filter((ag) => isLunaAgent(ag.id))
  const candidates: Array<{ a: AgentState; b: AgentState; key: string }> = []
  for (let i = 0; i < luna.length; i++) {
    for (let j = i + 1; j < luna.length; j++) {
      const a = luna[i]!
      const b = luna[j]!
      if (!pairEligible(a, b, tick, pairLastEnd, agentLastEnd)) continue
      candidates.push({ a, b, key: pairKey(a.id, b.id) })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  const best = candidates[0]!
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

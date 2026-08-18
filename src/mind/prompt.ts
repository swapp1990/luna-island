import type { AgentState, MindNoteRecord, Place, SimEvent, WorldState } from '../sim/types'
import { toSimTime } from '../sim/time'
import { proposalTally } from '../sim/sim'
import { personaFor } from './personas'
import {
  memoryLinesForPrompt,
  standingFacts,
  standingGoals,
} from './memory'
import {
  feltConsequenceLines,
  formatNearbyPlaceLine,
  formatUnfamiliarPlaceFact,
  knowledgeLinesForPrompt,
  nearbyPlacesForObservation,
} from './knowledge'

const ACTION_KINDS = [
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
  'propose',
  'vote',
  'sanction',
  'claim',
  'examine',
] as const

const GROUNDING =
  'GROUNDING: Cite only facts present in your observation and memories. Never invent numbers, events, or possessions.'

const WORLD_RULES = `WORLD RULES (scaffold only — you choose what to do):
- Time: 1 tick = 1 sim minute; day 06:00 start; night 21:00–06:00.
- Needs 0..1: hunger, energy, social decay over time; critical near 0.
- One standing agent per tile; using a place = stand on a free slot tile.
- You feel your needs. The world contains places and things whose workings you learn by living, examining, and listening.
- You cannot invent new action kinds or break occupancy/economy rules.`

const RESPONSE_CONTRACT = `RESPONSE CONTRACT — reply with ONLY one JSON object, no markdown:
{"action":"<ActionKind>","target":"<optional place kind or agent name>","reasoning":"<≤160 chars, first person>"}
ActionKind is one of: ${ACTION_KINDS.join(', ')}.
target examples: home, berry-bush, well, plaza, farm, stall, forestry, quarry, storehouse, notice-board, or a villager name.
propose needs "text"; vote needs target and "choice"; sanction needs target and "reason"; claim needs target; examine needs target.
When nothing is urgent, act on who you are.`

export function buildSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}\n\n${GROUNDING}\n\n${WORLD_RULES}\n\n${RESPONSE_CONTRACT}`
}

/** Need below this is a warning — slack framing only when all needs are ≥ this. */
export const NEED_WARNING_THRESHOLD = 0.25

function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100)
}

export function needsAreComfortable(needs: {
  hunger: number
  energy: number
  social: number
}): boolean {
  return (
    needs.hunger >= NEED_WARNING_THRESHOLD &&
    needs.energy >= NEED_WARNING_THRESHOLD &&
    needs.social >= NEED_WARNING_THRESHOLD
  )
}

function nearbyAgents(
  self: AgentState,
  world: WorldState,
  radius = 6,
): Array<{ name: string; sympathy: number; action: string }> {
  const r2 = radius * radius
  const out: Array<{ name: string; sympathy: number; action: string; d: number }> =
    []
  for (const a of world.agents) {
    if (a.id === self.id) continue
    const dx = a.x - self.x
    const dy = a.y - self.y
    const d = dx * dx + dy * dy
    if (d > r2) continue
    out.push({
      name: a.name,
      sympathy: Math.round((self.sympathy?.[a.id] ?? 0) * 100) / 100,
      action: a.action.kind,
      d,
    })
  }
  out.sort((a, b) => a.d - b.d)
  return out.slice(0, 6).map(({ name, sympathy, action }) => ({
    name,
    sympathy,
    action,
  }))
}

function placeKindLabel(p: Place): string {
  return p.kind
}

function clipObs(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/** Compact civic facts — display only; no verdict about whether rules are kept. */
function civicObservationLines(
  _agent: AgentState,
  world: WorldState,
  recentEvents: readonly SimEvent[],
): string[] {
  const lines: string[] = []
  const open = (world.proposals ?? []).filter((p) => p.status === 'open')
  if (open.length > 0) {
    lines.push('Open proposals:')
    for (const p of open) {
      const tally = proposalTally(p)
      const left = Math.max(0, p.closesTick - world.tick)
      const proposer = world.agents.find((a) => a.id === p.proposerId)?.name ?? p.proposerId
      lines.push(
        `- ${p.id} by ${proposer}: "${clipObs(p.text, 80)}" yes ${tally.yes} / no ${tally.no} · ${left} min left`,
      )
    }
  }
  const active = (world.rules ?? []).filter((r) => r.active).slice(0, 5)
  if (active.length > 0) {
    lines.push('Posted rules:')
    for (const r of active) {
      const who = world.agents.find((a) => a.id === r.proposerId)?.name ?? r.proposerId
      lines.push(`- ${r.id} (${who}): "${clipObs(r.text, 80)}"`)
    }
  }
  const sanctions = recentEvents
    .filter((e) => e.type === 'institution:sanctioned')
    .slice(-3)
  if (sanctions.length > 0) {
    lines.push('Recent sanctions:')
    for (const e of sanctions) {
      const from = String(e.data?.agentName ?? e.agentId ?? 'someone')
      const to = String(e.data?.targetName ?? e.data?.targetId ?? 'someone')
      const why = clipObs(String(e.data?.reason ?? ''), 80)
      lines.push(`- ${from} → ${to}: "${why}"`)
    }
  }
  return lines
}

export function buildUserPrompt(
  agent: AgentState,
  world: WorldState,
  recentEvents: readonly SimEvent[],
  mindNoteLog?: readonly MindNoteRecord[],
): string {
  const t = toSimTime(world.tick)
  const stall = world.places.find((p) => p.kind === 'stall')
  const stock = stall?.inventory?.food ?? 0
  const job = agent.employedAt
    ? world.places.find((p) => p.id === agent.employedAt)
    : null
  const near = nearbyAgents(agent, world)
  const inv = agent.inventory ?? { food: 0, wood: 0, stone: 0 }
  const events = recentEvents
    .filter((e) => e.agentId === agent.id)
    .slice(-10)
    .map((e) => {
      const reason = e.reason ? ` — ${e.reason}` : ''
      return `@${e.tick} ${e.type}${reason}`
    })

  const standing = standingFacts(agent, world)
  const noteLog = mindNoteLog ?? world.mindNoteLog ?? []
  const memories = memoryLinesForPrompt(agent.id, recentEvents, noteLog, 8)
  const known = knowledgeLinesForPrompt(agent.id, recentEvents, noteLog, 6)
  const felt = feltConsequenceLines(agent.id, recentEvents, world.tick, 5)
  const nearbyPlaces = nearbyPlacesForObservation(agent, world, recentEvents)
  const civic = civicObservationLines(agent, world, recentEvents)
  const unfamiliar = nearbyPlaces.filter((p) => p.unfamiliar)
  const goals = standingGoals(agent.id, noteLog)
  const slack = needsAreComfortable(agent.needs)

  const lines = [
    `Time: Day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} (tick ${world.tick})`,
    ...(slack ? ['Your needs are comfortable; nothing is urgent.'] : []),
    `Needs: hunger ${pct(agent.needs.hunger)}% energy ${pct(agent.needs.energy)}% social ${pct(agent.needs.social)}%${agent.collapsed ? ' COLLAPSED' : ''}`,
    `Wallet: ${agent.wallet} coins | Inventory: food ${inv.food} wood ${inv.wood} stone ${inv.stone}`,
    `Job: ${job ? `${placeKindLabel(job)} (${job.wage ?? 0}/day)` : 'unemployed'}`,
    `Current action: ${agent.action.kind}${agent.action.targetPlaceId ? ` @${agent.action.targetPlaceId}` : ''} — ${agent.action.reason}`,
    `Stall stock: ${stock}`,
    `Nearby: ${near.length ? near.map((n) => `${n.name}(sym ${n.sympathy}, ${n.action})`).join('; ') : 'none'}`,
    `Nearby places: ${
      nearbyPlaces.length
        ? nearbyPlaces.map(formatNearbyPlaceLine).join('; ')
        : 'none'
    }`,
    ...(unfamiliar.length
      ? [
          `Never examined: ${unfamiliar
            .map((r) => formatUnfamiliarPlaceFact(agent, r.place, world))
            .join(', ')}`,
        ]
      : []),
    `Standing facts:`,
    ...standing.map((s) => `- ${s}`),
    ...(goals.length ? ['Goals:', ...goals.map((g) => `- ${g}`)] : []),
    ...civic,
    `Recently felt:`,
    ...(felt.length ? felt.map((f) => `- ${f}`) : ['- (nothing yet)']),
    `Known:`,
    ...(known.length ? known.map((k) => `- ${k}`) : ['- (nothing yet)']),
    `Your memories:`,
    ...(memories.length ? memories.map((m) => `- ${m}`) : ['- (none yet)']),
    `Recent trace:`,
    ...(events.length ? events : ['(none)']),
    `Available actions: ${ACTION_KINDS.join(', ')}`,
  ]
  return lines.join('\n')
}

/** Reflection system prompt: persona + contract for nightly notes. */
export function buildReflectionSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}

${GROUNDING}

You are reflecting on your day before sleep. Reply ONLY with one JSON object, no markdown:
{"notes":["…","…"],"learned":["…up to 2 short world-facts you now believe…"]}
Rules: 1–3 notes; each ≤120 characters; first person ("I"); concrete facts from today's events and intentions for tomorrow. No invented possessions or numbers.
learned: 0–2 short world-facts distilled from what you felt, examined, or were told — not laws, beliefs.`
}

/** Compact day-trace lines for reflection (agent's own events that day, incl. mind:say as partner). */
export function buildReflectionUserPrompt(
  agentId: string,
  events: readonly SimEvent[],
  day: number,
): string {
  const dayLines: string[] = []
  for (const e of events) {
    const asPartner =
      e.type === 'mind:say' && e.data?.partnerId === agentId
    if (e.agentId !== agentId && !asPartner) continue
    const t = toSimTime(e.tick)
    if (t.day !== day) continue
    if (e.type === 'mind:say') {
      const text = String(e.data?.text ?? '')
      const who =
        e.agentId === agentId
          ? 'I said'
          : `${String(e.data?.agentName ?? e.agentId)} said`
      dayLines.push(`${pad2(t.hour)}:${pad2(t.minute)} 💬 ${who}: "${text}"`)
      continue
    }
    const reason = e.reason ? ` — ${e.reason}` : ''
    dayLines.push(
      `${pad2(t.hour)}:${pad2(t.minute)} ${e.type}${reason}`,
    )
  }
  // Cap to keep prompt small
  const clipped =
    dayLines.length > 40
      ? [...dayLines.slice(0, 10), '…', ...dayLines.slice(-29)]
      : dayLines
  return `Here are today's events for you (Day ${day}):\n${
    clipped.length ? clipped.join('\n') : '(quiet day — little happened)'
  }\n\nReply ONLY {"notes":["…"],"learned":["…"]}.`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Rough token estimate (~4 chars/token). Keep prompt ≤ ~1500 tokens. */
export function approxTokens(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 4)
}

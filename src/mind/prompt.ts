import type { AgentState, MindNoteRecord, Place, SimEvent, WorldState } from '../sim/types'
import { toSimTime } from '../sim/time'
import {
  buildableMenuLine,
  COLLAPSE_VIEW_RADIUS,
  GATHER_CARRY,
  PROPOSE_COST,
  proposalTally,
} from '../sim/sim'
import { coinPhrase } from '../sim/costs'
import { REFLECT_MARKER, SLACK_MARKER } from './promptMarkers'
import { personaFor } from './personas'
import {
  declaredIntentions,
  memoryLinesForPrompt,
  standingFacts,
  standingGoals,
} from './memory'
import {
  compass8,
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
] as const

const GROUNDING =
  'GROUNDING: Cite only facts present in your observation and memories. Never invent numbers, events, or possessions.'

function worldRulesText(): string {
  return `WORLD RULES (scaffold only — you choose what to do):
- Time: 1 tick = 1 sim minute; day 06:00 start; night 21:00–06:00.
- Needs 0..1: hunger, energy, social decay over time; critical near 0.
- One standing agent per tile; using a place = stand on a free slot tile.
- Commissioning marks a construction site on buildable ground; no materials in hand are needed to commission.
- ${buildableMenuLine()}
- A site accepts deliveries over many trips, from anyone; you can carry at most ${GATHER_CARRY.cap} of a good per trip; working at the site builds while it holds materials.
- Wood comes from forest tiles; stone from rock tiles (gather).
- Water can be drunk at the shore; a well restores more.
- Sleeping without a roof rests you less.
- An adjacent villager may give food to someone who has collapsed.
- You feel your needs. The world contains places and things whose workings you learn by living, examining, and listening.
- You cannot invent new action kinds or break occupancy/economy rules.`
}

const RESPONSE_CONTRACT = `RESPONSE CONTRACT — reply with ONLY one JSON object, no markdown:
{"action":"<ActionKind>","target":"<optional place kind or agent name>","reasoning":"<≤160 chars, first person>"}
ActionKind is one of: ${ACTION_KINDS.join(', ')}.
target examples: home, berry-bush, spring, well, plaza, farm, stall, forestry, quarry, storehouse, notice-board, forest, rock, or a villager name.
propose needs "text" (the rule you want posted); vote needs target and "choice"; sanction needs target and "text" (the censure to post publicly — separate from your own "reasoning"); claim needs target; examine needs target; commission needs target (place kind); gather needs target (forest or rock); deliver needs target (construction-site) when you carry wood or stone it still needs; give needs target (collapsed villager name) when you carry food and stand beside them.
When nothing is urgent, act on who you are.`

export function buildSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}\n\n${GROUNDING}\n\n${worldRulesText()}\n\n${RESPONSE_CONTRACT}`
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

function formatNearbyAgentLine(
  self: AgentState,
  other: AgentState,
): string {
  const sympathy = Math.round((self.sympathy?.[other.id] ?? 0) * 100) / 100
  if (other.collapsed) {
    const dx = other.x - self.x
    const dy = other.y - self.y
    const dist = Math.max(1, Math.round(Math.hypot(dx, dy)))
    const dir = compass8(dx, dy)
    return `${other.name} (COLLAPSED, ${dist} tiles ${dir})`
  }
  return `${other.name}(sym ${sympathy}, ${other.action.kind})`
}

/**
 * Nearby agents within radius 6 (cap 6), plus any collapsed villager within
 * COLLAPSE_VIEW_RADIUS — collapse is loud even outside the normal bubble.
 */
function nearbyAgentLines(self: AgentState, world: WorldState): string[] {
  const normalR2 = 6 * 6
  const collapseR2 = COLLAPSE_VIEW_RADIUS * COLLAPSE_VIEW_RADIUS
  const normal: Array<{ a: AgentState; d: number }> = []
  const collapsedExtra: Array<{ a: AgentState; d: number }> = []
  for (const a of world.agents) {
    if (a.id === self.id) continue
    const dx = a.x - self.x
    const dy = a.y - self.y
    const d = dx * dx + dy * dy
    if (a.collapsed && d <= collapseR2) {
      collapsedExtra.push({ a, d })
      continue
    }
    if (d <= normalR2) normal.push({ a, d })
  }
  normal.sort((x, y) => x.d - y.d)
  collapsedExtra.sort((x, y) => x.d - y.d)
  const picked = new Map<string, AgentState>()
  for (const row of collapsedExtra) picked.set(row.a.id, row.a)
  for (const row of normal.slice(0, 6)) {
    if (!picked.has(row.a.id)) picked.set(row.a.id, row.a)
  }
  const ordered = [...picked.values()].sort((a, b) => {
    const da = (a.x - self.x) ** 2 + (a.y - self.y) ** 2
    const db = (b.x - self.x) ** 2 + (b.y - self.y) ** 2
    if (da !== db) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return ordered.map((a) => formatNearbyAgentLine(self, a))
}

/** Plaza news: one line naming who is collapsed and roughly where. */
function collapsePlazaNews(
  self: AgentState,
  world: WorldState,
): string | null {
  const collapsed = world.agents.filter((a) => a.collapsed && a.id !== self.id)
  if (collapsed.length === 0) return null
  const plaza = world.places.find((p) => p.kind === 'plaza')
  if (!plaza) return null
  const onPlaza =
    Math.max(Math.abs(self.x - plaza.x), Math.abs(self.y - plaza.y)) <= 2
  if (!onPlaza) return null
  const first = [...collapsed].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )[0]!
  const dx = first.x - plaza.x
  const dy = first.y - plaza.y
  const dist = Math.max(1, Math.round(Math.hypot(dx, dy)))
  const dir = compass8(dx, dy)
  const extra =
    collapsed.length > 1 ? ` (+${collapsed.length - 1} more)` : ''
  return `News: ${first.name} is collapsed ~${dist} tiles ${dir} of the plaza${extra}`
}

function placeKindLabel(p: Place): string {
  return p.kind
}

/** Order-preserving, case-insensitive dedupe. */
function dedupeLines(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const key = line.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
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
  const board = world.places.find((p) => p.kind === 'notice-board')
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
  } else if (board) {
    // Present-tense civic state. The same fact sits in the board's examine text,
    // but there it reads as documentation and never moved a mind; an open
    // proposal in THIS block is what produced votes (probe G6).
    // Was cost-framed ("posting one costs 2 coins") — the only board mention a
    // mind ever saw, which read as a price tag rather than an affordance and
    // measurably suppressed origination. State the affordance; name a price
    // only when there is one.
    lines.push(
      PROPOSE_COST > 0
        ? `Open proposals: none posted (anyone may post one, ${coinPhrase(PROPOSE_COST)})`
        : 'Open proposals: none posted (anyone may post one, free)',
    )
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
  const job = agent.employedAt
    ? world.places.find((p) => p.id === agent.employedAt)
    : null
  const near = nearbyAgentLines(agent, world)
  const news = collapsePlazaNews(agent, world)
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
  // Nightly reflection goals, plus any plan declared during the day. Without
  // the second source a talk→escalate arc dies at the next tick boundary.
  const goals = dedupeLines([
    ...standingGoals(agent.id, noteLog),
    ...declaredIntentions(agent.id, recentEvents, world.tick),
  ]).slice(0, 4)
  const slack = needsAreComfortable(agent.needs)

  const lines = [
    `Time: Day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} (tick ${world.tick})`,
    ...(slack ? [SLACK_MARKER] : []),
    `Needs: hunger ${pct(agent.needs.hunger)}% energy ${pct(agent.needs.energy)}% social ${pct(agent.needs.social)}%${agent.collapsed ? ' COLLAPSED' : ''}`,
    `Wallet: ${agent.wallet} coins | Inventory: food ${inv.food} wood ${inv.wood} stone ${inv.stone}`,
    `Job: ${job ? `${placeKindLabel(job)} (${job.wage ?? 0}/day)` : 'unemployed'}`,
    `Current action: ${agent.action.kind}${agent.action.targetPlaceId ? ` @${agent.action.targetPlaceId}` : ''} — ${agent.action.reason}`,
    `Nearby: ${near.length ? near.join('; ') : 'none'}`,
    ...(news ? [news] : []),
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

${REFLECT_MARKER}. Reply ONLY with one JSON object, no markdown:
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

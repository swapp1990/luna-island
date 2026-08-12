import type { AgentState, MindNoteRecord, Place, SimEvent, WorldState } from '../sim/types'
import { toSimTime } from '../sim/time'
import { CLAIM_COST, marketPriceFromStock, PROPOSE_COST, proposalTally } from '../sim/sim'
import { personaFor } from './personas'
import {
  memoryLinesForPrompt,
  standingFacts,
} from './memory'

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
] as const

const GROUNDING =
  'GROUNDING: Cite only facts present in your observation and memories. Never invent numbers, events, or possessions.'

const WORLD_RULES = `WORLD RULES (scaffold only — you choose what to do):
- Time: 1 tick = 1 sim minute; day 06:00 start; night 21:00–06:00.
- Needs 0..1: hunger, energy, social decay over time; critical near 0.
- One standing agent per tile; using a place = stand on a free slot tile.
- Eat carried food; forage berry-bushes; buy food at stall for coins.
- Work workplaces (farm/stall/forestry/quarry/sites) for wages; haul goods.
- Sleep at home on a bed slot; drink at well; socialize near others (plaza).
- Commission a private home costs 30 coins when you can afford it.
- Social recharge needs another agent within ~1.5 tiles.
- Civic mechanisms exist and anyone may use them: propose (2 coins) posts agent-authored text for a day; vote records a yes or no on an open proposal; sanction (1 coin) posts a public censure; claim (15 coins) transfers a commons place to the claimer. Posted rules may be followed or broken. Breaking may draw sanctions from others.
- You cannot invent new action kinds or break occupancy/economy rules.`

const RESPONSE_CONTRACT = `RESPONSE CONTRACT — reply with ONLY one JSON object, no markdown:
{"action":"<ActionKind>","target":"<optional place kind or agent name>","reasoning":"<≤160 chars, first person>"}
ActionKind is one of: ${ACTION_KINDS.join(', ')}.
target examples: home, berry-bush, well, plaza, farm, stall, forestry, quarry, storehouse, or a villager name.
Civic extras when used: propose needs "text" (≤200); vote needs target=<proposal id> and "choice":"yes"|"no"; sanction needs target=<name> and "reason" (≤120) and optional "ruleId"; claim needs target=<place kind or id>.
If unsure, prefer a safe need-serving action (eat/forage/sleep/work).`

export function buildSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}\n\n${GROUNDING}\n\n${WORLD_RULES}\n\n${RESPONSE_CONTRACT}`
}

function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100)
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
  agent: AgentState,
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
  if (agent.wallet >= PROPOSE_COST) {
    lines.push(`You can afford the proposal fee (${PROPOSE_COST} coins).`)
  }
  if (agent.wallet >= CLAIM_COST) {
    lines.push(`You can afford the claim fee (${CLAIM_COST} coins).`)
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
  const price = marketPriceFromStock(stock)
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
  const civic = civicObservationLines(agent, world, recentEvents)

  const lines = [
    `Time: Day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} (tick ${world.tick})`,
    `Needs: hunger ${pct(agent.needs.hunger)}% energy ${pct(agent.needs.energy)}% social ${pct(agent.needs.social)}%${agent.collapsed ? ' COLLAPSED' : ''}`,
    `Wallet: ${agent.wallet} coins | Inventory: food ${inv.food} wood ${inv.wood} stone ${inv.stone}`,
    `Job: ${job ? `${placeKindLabel(job)} (${job.wage ?? 0}/day)` : 'unemployed'}`,
    `Current action: ${agent.action.kind}${agent.action.targetPlaceId ? ` @${agent.action.targetPlaceId}` : ''} — ${agent.action.reason}`,
    `Market: food price ${price}, stall stock ${stock}`,
    `Nearby: ${near.length ? near.map((n) => `${n.name}(sym ${n.sympathy}, ${n.action})`).join('; ') : 'none'}`,
    `Standing facts:`,
    ...standing.map((s) => `- ${s}`),
    ...civic,
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
{"notes":["…","…"]}
Rules: 1–3 notes; each ≤120 characters; first person ("I"); concrete facts from today's events and intentions for tomorrow. No invented possessions or numbers.`
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
  }\n\nReply ONLY {"notes":["…"]}.`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Rough token estimate (~4 chars/token). Keep prompt ≤ ~1500 tokens. */
export function approxTokens(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 4)
}

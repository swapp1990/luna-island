import type { AgentState, Place, SimEvent, WorldState } from '../sim/types'
import { toSimTime } from '../sim/time'
import { marketPriceFromStock } from '../sim/sim'
import { personaFor } from './personas'

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
] as const

const WORLD_RULES = `WORLD RULES (scaffold only — you choose what to do):
- Time: 1 tick = 1 sim minute; day 06:00 start; night 21:00–06:00.
- Needs 0..1: hunger, energy, social decay over time; critical near 0.
- One standing agent per tile; using a place = stand on a free slot tile.
- Eat carried food; forage berry-bushes; buy food at stall for coins.
- Work workplaces (farm/stall/forestry/quarry/sites) for wages; haul goods.
- Sleep at home on a bed slot; drink at well; socialize near others (plaza).
- Commission a private home costs 30 coins when you can afford it.
- Social recharge needs another agent within ~1.5 tiles.
- You cannot invent new action kinds or break occupancy/economy rules.`

const RESPONSE_CONTRACT = `RESPONSE CONTRACT — reply with ONLY one JSON object, no markdown:
{"action":"<ActionKind>","target":"<optional place kind or agent name>","reasoning":"<≤160 chars, first person>"}
ActionKind is one of: ${ACTION_KINDS.join(', ')}.
target examples: home, berry-bush, well, plaza, farm, stall, forestry, quarry, storehouse, or a villager name.
If unsure, prefer a safe need-serving action (eat/forage/sleep/work).`

export function buildSystemPrompt(agentId: string): string {
  const persona = personaFor(agentId) ?? 'You are a villager on Luna Island.'
  return `${persona}\n\n${WORLD_RULES}\n\n${RESPONSE_CONTRACT}`
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

export function buildUserPrompt(
  agent: AgentState,
  world: WorldState,
  recentEvents: readonly SimEvent[],
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

  const lines = [
    `Time: Day ${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} (tick ${world.tick})`,
    `Needs: hunger ${pct(agent.needs.hunger)}% energy ${pct(agent.needs.energy)}% social ${pct(agent.needs.social)}%${agent.collapsed ? ' COLLAPSED' : ''}`,
    `Wallet: ${agent.wallet} coins | Inventory: food ${inv.food} wood ${inv.wood} stone ${inv.stone}`,
    `Job: ${job ? `${placeKindLabel(job)} (${job.wage ?? 0}/day)` : 'unemployed'}`,
    `Current action: ${agent.action.kind}${agent.action.targetPlaceId ? ` @${agent.action.targetPlaceId}` : ''} — ${agent.action.reason}`,
    `Market: food price ${price}, stall stock ${stock}`,
    `Nearby: ${near.length ? near.map((n) => `${n.name}(sym ${n.sympathy}, ${n.action})`).join('; ') : 'none'}`,
    `Recent trace:`,
    ...(events.length ? events : ['(none)']),
    `Available actions: ${ACTION_KINDS.join(', ')}`,
  ]
  return lines.join('\n')
}

/** Rough token estimate (~4 chars/token). Keep prompt ≤ ~1200 tokens. */
export function approxTokens(system: string, user: string): number {
  return Math.ceil((system.length + user.length) / 4)
}

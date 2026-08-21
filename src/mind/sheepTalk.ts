/**
 * Deterministic, state-grounded sheep conversation replies.
 * Zero LLM — template pool selected by seeded hash (conversationId + turn + agentId).
 * Lives in mind/ (not sim/) so sim purity is preserved.
 */

import type { AgentState, WorldState } from '../sim/types'

/** Max utterance length (matches mind say contract). */
const MAX_SAY = 140

export interface SheepTalkContext {
  sheep: AgentState
  partner: AgentState
  world: WorldState
  conversationId: string
  turn: number
}

export interface SheepTemplate {
  id: string
  /** True only when every fact the template asserts holds now. */
  predicate: (ctx: SheepTalkContext) => boolean
  /** Fill slots from real state at utterance time. */
  text: (ctx: SheepTalkContext) => string
}

function clip(s: string): string {
  if (s.length <= MAX_SAY) return s
  return s.slice(0, MAX_SAY - 1) + '…'
}

function jobPlace(sheep: AgentState, world: WorldState) {
  if (!sheep.employedAt) return null
  return world.places.find((p) => p.id === sheep.employedAt) ?? null
}

function nearestBush(sheep: AgentState, world: WorldState) {
  let best: { stock: number; dist2: number } | null = null
  for (const p of world.places) {
    if (p.kind !== 'berry-bush') continue
    const dx = p.x - sheep.x
    const dy = p.y - sheep.y
    const d2 = dx * dx + dy * dy
    const stock = p.inventory?.food ?? 0
    if (!best || d2 < best.dist2) best = { stock, dist2: d2 }
  }
  return best
}

function stallFoodPrice(world: WorldState): number | null {
  const stall = world.places.find((p) => p.kind === 'stall')
  if (!stall) return null
  const price = stall.price?.food
  return typeof price === 'number' ? price : null
}

/** FNV-1a 32-bit — no Math.random. */
export function sheepTalkHash(conversationId: string, turn: number, agentId: string): number {
  const seed = `${conversationId}|${turn}|${agentId}`
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * ~14 grounded templates. Predicates gate inclusion; text slots use live state.
 */
export const SHEEP_TEMPLATES: readonly SheepTemplate[] = [
  {
    id: 'sympathy-greeting',
    predicate: (ctx) => (ctx.sheep.sympathy?.[ctx.partner.id] ?? 0) >= 0.3,
    text: (ctx) =>
      clip(
        `Good to see you, ${ctx.partner.name} — always glad when a familiar face stops by.`,
      ),
  },
  {
    id: 'job-wage',
    predicate: (ctx) => {
      const job = jobPlace(ctx.sheep, ctx.world)
      return !!job && (job.wage ?? 0) > 0
    },
    text: (ctx) => {
      const job = jobPlace(ctx.sheep, ctx.world)!
      const wage = job.wage ?? 0
      return clip(
        `${wage} coins a day at the ${job.kind}, if you're looking.`,
      )
    },
  },
  {
    id: 'work-activity',
    predicate: (ctx) =>
      ctx.sheep.action.kind === 'work' && !!jobPlace(ctx.sheep, ctx.world),
    text: (ctx) => {
      const job = jobPlace(ctx.sheep, ctx.world)!
      return clip(`Long shift at the ${job.kind} — my back's done.`)
    },
  },
  {
    id: 'hunger-low',
    predicate: (ctx) => ctx.sheep.needs.hunger < 0.4,
    text: () => clip(`Haven't eaten since morning — belly's talking louder than I am.`),
  },
  {
    id: 'eating-now',
    predicate: (ctx) => ctx.sheep.action.kind === 'eat',
    text: () => clip(`Catch me mid-bite — join if you've got something to share.`),
  },
  {
    id: 'drinking-now',
    predicate: (ctx) => ctx.sheep.action.kind === 'drink',
    text: () => clip(`Just wetting my throat at the well — hot day for it.`),
  },
  {
    id: 'energy-low',
    predicate: (ctx) => ctx.sheep.needs.energy < 0.35,
    text: () => clip(`I'm running on fumes — could sleep standing up.`),
  },
  {
    id: 'empty-bush',
    predicate: (ctx) => {
      const bush = nearestBush(ctx.sheep, ctx.world)
      return bush != null && bush.stock === 0
    },
    text: (ctx) => {
      const bush = nearestBush(ctx.sheep, ctx.world)
      const stock = bush?.stock ?? 0
      return clip(
        stock === 0
          ? `The nearest berry bush is picked clean.`
          : `The nearest berry bush has ${stock} food left.`,
      )
    },
  },
  {
    id: 'food-dear',
    predicate: (ctx) => {
      const price = stallFoodPrice(ctx.world)
      return price != null && price >= 8
    },
    text: (ctx) => {
      const price = stallFoodPrice(ctx.world)!
      return clip(`Food's dear at the stall today — ${price} a unit.`)
    },
  },
  {
    id: 'wallet-thin',
    predicate: (ctx) => ctx.sheep.wallet < 3,
    text: () => clip(`Purse is thin this week — watching every coin.`),
  },
  {
    id: 'socializing',
    predicate: (ctx) => ctx.sheep.action.kind === 'socialize',
    text: () => clip(`Nice to linger at the plaza and hear the village hum.`),
  },
  {
    id: 'foraging',
    predicate: (ctx) => ctx.sheep.action.kind === 'forage',
    text: () => clip(`Out for berries if any are left on the bushes.`),
  },
  {
    id: 'unemployed',
    predicate: (ctx) => !ctx.sheep.employedAt,
    text: () => clip(`No job just now — taking whatever work turns up.`),
  },
  {
    id: 'neighborly-default',
    predicate: () => true,
    text: (ctx) =>
      clip(`Fair day, ${ctx.partner.name} — village keeps us busy either way.`),
  },
]

/**
 * Eligible templates for this sheep state (predicates true only).
 * Always non-empty: neighborly-default has predicate true.
 */
export function eligibleSheepTemplates(ctx: SheepTalkContext): SheepTemplate[] {
  return SHEEP_TEMPLATES.filter((t) => t.predicate(ctx))
}

/**
 * Pick one template deterministically and render its text.
 * Never asserts a false predicate (selection is only among eligible).
 */
export function selectSheepReply(ctx: SheepTalkContext): {
  templateId: string
  text: string
  done: boolean
} {
  const eligible = eligibleSheepTemplates(ctx)
  const h = sheepTalkHash(ctx.conversationId, ctx.turn, ctx.sheep.id)
  const pick = eligible[h % eligible.length]!
  // Shape: mind → sheep → mind → sheep(done). Sheep closes on turn 3 (max 4).
  const done = ctx.turn >= 3
  return {
    templateId: pick.id,
    text: pick.text(ctx),
    done,
  }
}

/** Exposed for tests: assert no false-predicate selection over a matrix. */
export function assertTemplateGrounding(ctx: SheepTalkContext): void {
  for (const t of SHEEP_TEMPLATES) {
    if (t.predicate(ctx)) {
      const text = t.text(ctx)
      if (!text || text.length > MAX_SAY) {
        throw new Error(`template ${t.id} produced empty/overlong text`)
      }
    }
  }
  const reply = selectSheepReply(ctx)
  const chosen = SHEEP_TEMPLATES.find((t) => t.id === reply.templateId)
  if (!chosen || !chosen.predicate(ctx)) {
    throw new Error(`selected template ${reply.templateId} fails predicate`)
  }
}

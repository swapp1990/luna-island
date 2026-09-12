import type { Rng } from '../sim/types'
import { bandOf } from './genome'
import { instinctBrain } from './instinctBrain'
import type {
  Band,
  BrainFactory,
  LineageActKind,
  LineageBrain,
  LineageIntent,
  LineageObservation,
  Turn,
  Villager,
} from './types'
import { compareVillagerId } from './types'
import { fullName } from './world'

export interface DeciderInput {
  villager: Villager
  obs: LineageObservation
  system: string
  user: string
  season: number
  day: number
  turn: Turn
}

export interface RecordedDecision {
  season: number
  day: number
  turn: Turn
  villagerId: string
  intent: LineageIntent
  source: 'llm' | 'fallback' | 'replay' | 'mock'
  raw?: string
  error?: string
  latencyMs?: number
}

export interface Decider {
  decide(
    input: DeciderInput,
  ): Promise<{ text: string; latencyMs: number } | { fallback: true; error: string }>
}

export function decisionKey(season: number, day: number, turn: Turn, villagerId: string): string {
  return `${season}|${day}|${turn}|${villagerId}`
}

/** Replay a recorded run: never calls an API. Missing keys fall back to instinct. */
export function recordedBrainFactory(decisions: readonly RecordedDecision[]): BrainFactory {
  const map = new Map<string, LineageIntent>()
  for (const d of decisions) {
    map.set(decisionKey(d.season, d.day, d.turn, d.villagerId), { ...d.intent })
  }
  return (v: Villager): LineageBrain => ({
    decide(obs, rng) {
      const key = decisionKey(obs.state.season, obs.state.day, obs.state.turn, v.id)
      const intent = map.get(key)
      if (intent) return intent
      return instinctBrain.decide(obs, rng)
    },
  })
}

function bandP(band: Band, dna: boolean, low: number, mid: number, high: number): number {
  if (!dna) return mid
  if (band === 'high') return high
  if (band === 'low') return low
  return mid
}

function lowestStanding(others: Villager[]): Villager | undefined {
  if (others.length === 0) return undefined
  let best = others[0]!
  for (let i = 1; i < others.length; i++) {
    const o = others[i]!
    if (o.standing < best.standing) best = o
    else if (o.standing === best.standing && compareVillagerId(o.id, best.id) < 0) best = o
  }
  return best
}

function mostTalkedWith(self: Villager, others: Villager[]): Villager | undefined {
  let best: Villager | undefined
  let bestN = 0
  for (const o of others) {
    const n = self.talkedWith[o.id] ?? 0
    if (n > bestN || (n === bestN && n > 0 && best && compareVillagerId(o.id, best.id) < 0)) {
      bestN = n
      best = o
    }
  }
  return bestN > 0 ? best : undefined
}

function jsonAct(
  action: LineageActKind,
  extra: Record<string, unknown>,
  reason: string,
): string {
  const body: Record<string, unknown> = { action, reason }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) body[k] = v
  }
  return JSON.stringify(body)
}

/**
 * Test fixture: returns JSON derived from trait bands so the pipeline and
 * expression report can be tested without a network. Not a production brain.
 */
export function mockDecider(rng: Rng, dna = true): Decider {
  return {
    async decide(input) {
      if (rng.next() < 0.03) return { text: 'I will work', latencyMs: 0 }
      const { villager, obs } = input
      const others = obs.others.filter((o) => o.status === 'alive' && o.id !== villager.id)
      const t = villager.traits

      if (villager.satiety < 0.3 && villager.grain >= 1) {
        return {
          text: jsonAct('eat', {}, "I'm hungry and there is food."),
          latencyMs: 0,
        }
      }
      if (villager.energy < 0.25) {
        return { text: jsonAct('rest', {}, "I'm worn out; I rest."), latencyMs: 0 }
      }

      const pGive = bandP(bandOf(t.generosity), dna, 0.05, 0.2, 0.5)
      if (others.length > 0 && villager.grain >= 2 && rng.next() < pGive) {
        const target = lowestStanding(others)!
        return {
          text: jsonAct(
            'give',
            { target: fullName(target), amount: 1 },
            'I give because I can spare it.',
          ),
          latencyMs: 0,
        }
      }

      const pVoice = bandP(bandOf(t.voice), dna, 0.02, 0.1, 0.3)
      if (rng.next() < pVoice) {
        const open = obs.state.proposals.filter((p) => p.resolved === undefined)
        open.sort((a, b) => a.openedTick - b.openedTick || a.id.localeCompare(b.id))
        const proposal = open[0]
        if (proposal) {
          return {
            text: jsonAct(
              'vote',
              { proposalId: proposal.id, choice: 'for' },
              'I vote for this.',
            ),
            latencyMs: 0,
          }
        }
        return {
          text: jsonAct(
            'propose',
            { rule: 'ration-granary', text: 'Ration the granary.' },
            'I put the granary rule to the hamlet.',
          ),
          latencyMs: 0,
        }
      }

      const pShun = bandP(bandOf(t.temper), dna, 0.01, 0.08, 0.25)
      if (others.length > 0 && rng.next() < pShun) {
        const target = rng.pick(others)
        return {
          text: jsonAct(
            'shun',
            { target: fullName(target), text: 'I turn away.' },
            'I shun them.',
          ),
          latencyMs: 0,
        }
      }

      const thriftHigh = dna ? bandOf(t.thrift) === 'high' : false
      if (thriftHigh && villager.grain > 3) {
        return {
          text: jsonAct('store', { amount: 1 }, 'I store what I do not need.'),
          latencyMs: 0,
        }
      }

      const socBand = dna ? bandOf(t.sociability) : 'mid'
      const courtFrom = socBand === 'high' ? 3 : socBand === 'mid' ? 6 : Infinity
      const most = mostTalkedWith(villager, others)
      if (obs.state.day >= courtFrom && most) {
        return {
          text: jsonAct(
            'court',
            { target: fullName(most) },
            'I want to court them.',
          ),
          latencyMs: 0,
        }
      }

      // Talk when grain is already in hand; otherwise forage/work so the
      // hamlet does not starve before season's end (a talk-only tail exits).
      if (villager.grain > 2 && others.length > 0) {
        const target = rng.pick(others)
        return {
          text: jsonAct(
            'talk',
            { target: fullName(target), text: 'The day is long.' },
            'I talk.',
          ),
          latencyMs: 0,
        }
      }
      const boldHigh = dna ? bandOf(t.boldness) === 'high' : false
      if (boldHigh) {
        return { text: jsonAct('forage', {}, 'I forage the woods.'), latencyMs: 0 }
      }
      return { text: jsonAct('work', {}, 'I work the fields.'), latencyMs: 0 }
    },
  }
}

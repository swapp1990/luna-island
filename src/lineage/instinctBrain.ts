import type { Rng } from '../sim/types'
import type {
  LineageBrain,
  LineageIntent,
  LineageObservation,
  Proposal,
  Villager,
} from './types'
import { compareVillagerId } from './types'
import { hasRule } from './world'

/**
 * Trait-blind on purpose: this is the Phase A null baseline. The instinct
 * brain may read needs, grain, standing, room, rules, granary, talkedWith,
 * and others' public fields (id, status, grain, standing, room). It MUST NOT
 * read genome, traits, or any DNA text — those exist so Phase B's LLM can
 * express them. If constitution traits still move under this brain, that is
 * the world selecting; if disposition traits move, that is drift.
 */
export class InstinctBrain implements LineageBrain {
  decide(obs: LineageObservation, rng: Rng): LineageIntent {
    const { self, others, state } = obs
    const livingOthers = others.filter((o) => o.status === 'alive')
    const granaryReachable =
      hasRule(state, 'granary-open') &&
      state.granary >= 1 &&
      !(hasRule(state, 'ration-granary') && (state.granaryTakenToday[self.id] ?? 0) >= 1)

    if (self.satiety < 0.3 && (self.grain >= 1 || granaryReachable)) {
      return { kind: 'eat', reason: "I'm hungry and there is food." }
    }
    if (self.energy < 0.25) {
      return { kind: 'rest', reason: "I'm worn out; I rest." }
    }
    if (self.satiety < 0.5 && self.grain < 1) {
      if (state.config.harvestYield >= 0.6) {
        return { kind: 'work', reason: 'I need grain, so I work.' }
      }
      return { kind: 'forage', reason: 'I need grain, so I forage.' }
    }
    if (self.companionship < 0.3 && livingOthers.length > 0) {
      const target = pickTalkTarget(self, livingOthers, rng)
      return {
        kind: 'talk',
        target: target.id,
        text: rng.pick(TALK_LINES as string[]),
        reason: 'I need company.',
      }
    }

    const mostTalked = mostTalkedWith(self, livingOthers)
    if (state.day >= 6 && self.courted.length === 0 && mostTalked) {
      return {
        kind: 'court',
        target: mostTalked.id,
        reason: 'I want to court them.',
      }
    }

    if (self.grain > 4) {
      return {
        kind: 'store',
        amount: self.grain - 3,
        reason: 'I have more grain than I need.',
      }
    }

    const open = state.proposals.filter(
      (p) => !p.resolved && p.votes[self.id] === undefined,
    )
    if (open.length > 0 && rng.next() < 0.1) {
      const proposal = open[0]!
      return {
        kind: 'vote',
        proposalId: proposal.id,
        choice: voteChoice(self, proposal),
        reason: 'I will vote on this.',
      }
    }
    if (open.length === 0 && rng.next() < 0.03) {
      if (hasRule(state, 'granary-closed')) {
        return {
          kind: 'propose',
          rule: 'granary-open',
          text: 'Open the granary again.',
          reason: 'I put the granary rule to the hamlet.',
        }
      }
      if (state.granary < state.config.cohortSize) {
        return {
          kind: 'propose',
          rule: 'ration-granary',
          text: 'Ration the granary.',
          reason: 'I put the granary rule to the hamlet.',
        }
      }
      return { kind: 'idle', reason: 'I wait.' }
    }

    return { kind: 'work', reason: 'I work the fields.' }
  }
}

export const instinctBrain = new InstinctBrain()

const TALK_LINES: readonly string[] = [
  'The day is long.',
  'The wind has a bite.',
  'Grain is grain.',
  'I slept well enough.',
  'The light is kind today.',
  'We go on.',
  'I saw a bird at dawn.',
  'My hands are busy.',
  'The path is dry.',
  'I think of the coast.',
  'A quiet hour helps.',
  'Tomorrow will come.',
  'I keep my share.',
  'The work is ordinary.',
]

function pickTalkTarget(self: Villager, others: Villager[], rng: Rng): Villager {
  const keys = Object.keys(self.talkedWith)
  if (keys.length === 0) return rng.pick(others)
  return highestTalked(self, others) ?? rng.pick(others)
}

function mostTalkedWith(self: Villager, others: Villager[]): Villager | undefined {
  const best = highestTalked(self, others)
  if (!best) return undefined
  if ((self.talkedWith[best.id] ?? 0) <= 0) return undefined
  return best
}

function highestTalked(self: Villager, others: Villager[]): Villager | undefined {
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

function voteChoice(self: Villager, proposal: Proposal): 'for' | 'against' {
  const starvingAdjacent = self.satiety < 0.3 || self.starvingTurns > 0
  if (starvingAdjacent && proposal.rule === 'granary-open') return 'for'
  return 'against'
}

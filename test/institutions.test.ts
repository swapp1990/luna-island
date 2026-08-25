import { describe, expect, it } from 'vitest'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { readFileSync } from 'node:fs'
import { NO_RECORDED_WORLDS, recordedWorldPaths } from './recordedWorlds'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'
import {
  ASSEMBLY_DURATION_TICKS,
  CLAIM_COST,
  MAX_OPEN_PROPOSALS,
  PROPOSE_COST,
  PROPOSAL_QUORUM,
  PROPOSAL_WINDOW_TICKS,
  SANCTION_COST,
  SHEEP_SYMPATHY_YES,
  assemblyWindowFor,
  bindingTally,
  Simulation,
  VOTE_COST,
  isSheepAgent,
  proposalTally,
} from '../src/sim/sim'
import {
  restoreSave,
  serializeSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import type {
  ActionKind,
  ExternalIntentMeta,
  Intent,
  Proposal,
  Rule,
  WorldState,
} from '../src/sim/types'
import { emptyInventory } from '../src/sim/types'
import { parseMindJson, resolveMindIntent } from '../src/mind/parse'
import { coinPhrase } from '../src/sim/costs'
import { EXAMINE_BY_KIND, examineKnowledgeFor, villageCensusLine } from '../src/sim/examine'
import { inPlazaRadius } from '../src/sim/spots'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'
import { fnv1aHex, stableStringify } from '../src/sim/stableStringify'

const SEED = 42

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function totalCoins(sim: Simulation): number {
  let sum = sim.state.treasury
  for (const a of sim.state.agents) sum += a.wallet
  return sum
}

function fund(sim: Simulation, agentId: string, amount: number): void {
  const agent = sim.state.agents.find((a) => a.id === agentId)
  if (!agent) throw new Error(`missing ${agentId}`)
  const need = amount - agent.wallet
  if (need > 0) {
    const ok = sim.transferCoins('treasury', agentId, need, 'test fund')
    expect(ok).toBe(true)
  }
}

function stripRules(state: WorldState): WorldState {
  return { ...state, rules: [] }
}

function boxAround(sim: Simulation, cx: number, cy: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= sim.state.width || y >= sim.state.height) continue
      const tile = sim.state.tiles[y * sim.state.width + x]
      if (!tile) continue
      tile.walkable = false
      tile.kind = 'rock'
    }
  }
}

function parkAgent(
  a: { x: number; y: number; action: { kind: string; reason: string; path?: unknown }; pathIndex: number },
  x: number,
  y: number,
): void {
  a.x = x
  a.y = y
  a.action = { kind: 'idle', reason: 'parked' }
  a.pathIndex = 0
}

function behaviorHash(sim: Simulation): string {
  return fnv1aHex(stableStringify(stripRules(sim.state)))
}

describe('institution mechanics', () => {
  it('propose fee conserves coins and records the proposal', () => {
    const sim = new Simulation(SEED)
    const before = totalCoins(sim)
    fund(sim, 'agent-0', PROPOSE_COST)
    expect(totalCoins(sim)).toBe(before)

    const ok = sim.propose('agent-0', 'Share the well after dusk')
    expect(ok).toBe(true)
    expect(totalCoins(sim)).toBe(before)
    expect(sim.state.proposals).toHaveLength(1)
    const p = sim.state.proposals[0]!
    expect(p.proposerId).toBe('agent-0')
    expect(p.text).toBe('Share the well after dusk')
    expect(p.status).toBe('open')
    expect(p.closesTick).toBe(p.createdTick + PROPOSAL_WINDOW_TICKS)
    expect(p.text.length).toBeLessThanOrEqual(200)
    const ev = sim.getEvents().find((e) => e.type === 'institution:proposed')
    expect(ev).toBeTruthy()
    expect(ev!.agentId).toBe('agent-0')
  })

  it('proposal limits: one open per proposer, max 2 island-wide; refusal is a no-op', () => {
    const sim = new Simulation(SEED)
    fund(sim, 'agent-0', PROPOSE_COST * 3)
    fund(sim, 'agent-1', PROPOSE_COST * 2)
    fund(sim, 'agent-2', PROPOSE_COST)

    expect(sim.propose('agent-0', 'First')).toBe(true)
    expect(sim.propose('agent-0', 'Second from same')).toBe(false)
    expect(sim.state.proposals).toHaveLength(1)

    expect(sim.propose('agent-1', 'Other')).toBe(true)
    expect(sim.state.proposals.filter((p) => p.status === 'open')).toHaveLength(
      MAX_OPEN_PROPOSALS,
    )

    const coins = totalCoins(sim)
    expect(sim.propose('agent-2', 'Third should refuse')).toBe(false)
    expect(sim.state.proposals).toHaveLength(2)
    expect(totalCoins(sim)).toBe(coins)
    const refused = sim.getEvents().filter((e) => e.type === 'institution:propose-refused')
    expect(refused.length).toBeGreaterThanOrEqual(2)
  })

  it('one vote per villager; closed / missing / double votes refuse', () => {
    const sim = new Simulation(SEED)
    fund(sim, 'agent-0', PROPOSE_COST)
    sim.propose('agent-0', 'A rule')
    const id = sim.state.proposals[0]!.id

    expect(sim.vote('agent-1', id, 'yes')).toBe(true)
    expect(sim.vote('agent-1', id, 'no')).toBe(false)
    expect(sim.state.proposals[0]!.votes['agent-1']).toBe('yes')

    expect(sim.vote('agent-2', 'prop-missing', 'yes')).toBe(false)
    const refused = sim.getEvents().filter((e) => e.type === 'institution:vote-refused')
    expect(refused.length).toBeGreaterThanOrEqual(2)
  })

  it('passage counts binding votes only; advisory votes are recorded, not decisive', () => {
    const sim = new Simulation(SEED)
    const minds = sim.state.agents.filter((a) => !isSheepAgent(a.id)).map((a) => a.id)
    const sheep = sim.state.agents.filter((a) => isSheepAgent(a.id)).map((a) => a.id)
    expect(minds.length).toBeGreaterThanOrEqual(PROPOSAL_QUORUM + 1)

    fund(sim, 'agent-0', PROPOSE_COST)
    sim.propose('agent-0', 'Pass me')
    const id = sim.state.proposals[0]!.id

    // Quorum of binding yes votes, and every sheep in the world voting no.
    const yesVoters = minds.filter((m) => m !== 'agent-0').slice(0, PROPOSAL_QUORUM)
    for (const v of yesVoters) expect(sim.vote(v, id, 'yes')).toBe(true)
    for (const v of sheep) expect(sim.vote(v, id, 'no')).toBe(true)

    const p = sim.state.proposals[0]!
    p.closesTick = sim.state.tick
    sim.advanceTicks(1)
    // A landslide of advisory noes does not defeat it.
    expect(sim.state.proposals[0]!.status).toBe('passed')
    expect(sim.state.rules).toHaveLength(1)
    expect(sim.state.rules[0]!.text).toBe('Pass me')

    const closed = sim.getEvents().find((e) => e.type === 'institution:closed')
    expect(closed?.data?.status).toBe('passed')
    // The reported verdict is the binding count...
    expect(closed?.data?.yes).toBe(PROPOSAL_QUORUM)
    expect(closed?.data?.no).toBe(0)
    // ...with everyone's opinion preserved alongside it.
    expect(closed?.data?.allNo).toBe(sheep.length)
    expect(bindingTally(sim.state.proposals[0]!).total).toBe(PROPOSAL_QUORUM)
    expect(proposalTally(sim.state.proposals[0]!).total).toBe(
      PROPOSAL_QUORUM + sheep.length,
    )
  })

  it('below binding quorum fails even when advisory support is overwhelming', () => {
    const sim = new Simulation(SEED)
    const minds = sim.state.agents.filter((a) => !isSheepAgent(a.id)).map((a) => a.id)
    const sheep = sim.state.agents.filter((a) => isSheepAgent(a.id)).map((a) => a.id)

    fund(sim, 'agent-0', PROPOSE_COST)
    sim.propose('agent-0', 'Fail me')
    const id = sim.state.proposals[0]!.id

    // One short of quorum among those who decide; the whole village says yes.
    for (const v of minds.filter((m) => m !== 'agent-0').slice(0, PROPOSAL_QUORUM - 1)) {
      expect(sim.vote(v, id, 'yes')).toBe(true)
    }
    for (const v of sheep) expect(sim.vote(v, id, 'yes')).toBe(true)

    const p = sim.state.proposals[0]!
    p.closesTick = sim.state.tick
    sim.advanceTicks(1)
    expect(sim.state.proposals[0]!.status).toBe('failed')
    expect(sim.state.rules).toHaveLength(0)
  })

  it('a tie or a binding majority against fails', () => {
    const sim = new Simulation(SEED)
    const minds = sim.state.agents
      .filter((a) => !isSheepAgent(a.id))
      .map((a) => a.id)
      .filter((m) => m !== 'agent-0')

    fund(sim, 'agent-0', PROPOSE_COST)
    sim.propose('agent-0', 'Split me')
    const id = sim.state.proposals[0]!.id
    // Quorum met, evenly split → yes > no is false.
    const half = Math.max(1, Math.ceil(PROPOSAL_QUORUM / 2))
    for (const v of minds.slice(0, half)) expect(sim.vote(v, id, 'yes')).toBe(true)
    for (const v of minds.slice(half, half * 2)) expect(sim.vote(v, id, 'no')).toBe(true)

    const p = sim.state.proposals[0]!
    p.closesTick = sim.state.tick
    sim.advanceTicks(1)
    expect(sim.state.proposals[0]!.status).toBe('failed')
    expect(sim.state.rules).toHaveLength(0)
  })

  it('sheep vote in person at the plaza during the assembly window; absence is silence', () => {
    const sim = new Simulation(SEED)
    fund(sim, 'agent-0', PROPOSE_COST)
    sim.propose('agent-0', 'Sheep please')
    const id = sim.state.proposals[0]!.id
    const g = sim.state.gatherings![0]!
    expect(g.kind).toBe('assembly')
    expect(g.subjectId).toBe(id)
    expect(g.placeId).toBe(sim.state.places.find((p) => p.kind === 'plaza')!.id)
    expect(g.startTick).toBe(720)
    expect(g.endTick).toBe(720 + ASSEMBLY_DURATION_TICKS)

    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const sheep = sim.state.agents.filter((a) => isSheepAgent(a.id))
    expect(sheep.length).toBeGreaterThanOrEqual(8)
    for (let i = 0; i < sheep.length; i++) {
      const a = sheep[i]!
      if (!a.sympathy) a.sympathy = {}
      a.sympathy['agent-0'] = i % 2 === 0 ? SHEEP_SYMPATHY_YES : 0
    }

    sim.advanceTicks(g.startTick - 1 - sim.state.tick)
    expect(sim.state.tick).toBe(g.startTick - 1)

    const atPlaza = [sheep[0]!, sheep[1]!]
    const far = sheep[2]!
    const keep = new Set(atPlaza.map((a) => a.id))
    for (const a of sim.state.agents) {
      if (keep.has(a.id)) {
        parkAgent(a, plaza.x, plaza.y)
        a.needs = { hunger: 0.9, energy: 0.9, social: 0.9 }
        a.collapsed = false
      } else {
        parkAgent(a, 2, 2)
      }
    }
    boxAround(sim, 2, 2, 2)

    sim.advanceTicks(2)

    const p = sim.state.proposals[0]!
    expect(p.id).toBe(id)
    expect(p.votes[atPlaza[0]!.id]).toBe('yes')
    expect(p.votes[atPlaza[1]!.id]).toBe('no')
    expect(p.votes[far.id]).toBeUndefined()
    expect(inPlazaRadius(far.x, far.y, plaza)).toBe(false)

    const sheepVotes = sim
      .getEvents()
      .filter((e) => e.type === 'institution:voted' && e.data?.sheep === true)
    expect(sheepVotes.length).toBe(2)

    for (const a of sim.state.agents) {
      if (!isSheepAgent(a.id) && a.id !== 'agent-0') {
        expect(p.votes[a.id]).toBeUndefined()
      }
    }

    const simB = new Simulation(SEED)
    fund(simB, 'agent-0', PROPOSE_COST)
    simB.propose('agent-0', 'Sheep please')
    const plazaB = simB.state.places.find((pl) => pl.kind === 'plaza')!
    const sheepB = simB.state.agents.filter((a) => isSheepAgent(a.id))
    for (let i = 0; i < sheepB.length; i++) {
      const a = sheepB[i]!
      if (!a.sympathy) a.sympathy = {}
      a.sympathy['agent-0'] = i % 2 === 0 ? SHEEP_SYMPATHY_YES : 0
    }
    const gB = simB.state.gatherings![0]!
    simB.advanceTicks(gB.startTick - 1 - simB.state.tick)
    const atPlazaB = [sheepB[0]!, sheepB[1]!]
    const keepB = new Set(atPlazaB.map((a) => a.id))
    for (const a of simB.state.agents) {
      if (keepB.has(a.id)) {
        parkAgent(a, plazaB.x, plazaB.y)
        a.needs = { hunger: 0.9, energy: 0.9, social: 0.9 }
        a.collapsed = false
      } else {
        parkAgent(a, 2, 2)
      }
    }
    boxAround(simB, 2, 2, 2)
    simB.advanceTicks(2)
    expect(simB.state.proposals[0]!.votes).toEqual(p.votes)
  })

  it('claim transfers commons only; sanction records + fee, no target effect', () => {
    const sim = new Simulation(SEED)
    const farm = sim.state.places.find((p) => p.kind === 'farm')!
    expect(sim.state.owners[farm.id]).toBe('commons')
    const coins0 = totalCoins(sim)
    fund(sim, 'agent-0', CLAIM_COST)
    expect(totalCoins(sim)).toBe(coins0)

    expect(sim.claim('agent-0', farm.id)).toBe(true)
    expect(sim.state.owners[farm.id]).toBe('agent-0')
    expect(totalCoins(sim)).toBe(coins0)
    const own = sim.getEvents().find((e) => e.type === 'ownership:transfer' && e.reason === 'claimed it')
    expect(own).toBeTruthy()

    // Already private — refuse, coins unchanged
    fund(sim, 'agent-1', CLAIM_COST)
    const coins1 = totalCoins(sim)
    expect(sim.claim('agent-1', farm.id)).toBe(false)
    expect(sim.state.owners[farm.id]).toBe('agent-0')
    expect(totalCoins(sim)).toBe(coins1)

    // Sanction: fee only, target wallet / needs unchanged
    fund(sim, 'agent-11', SANCTION_COST)
    const target = sim.state.agents.find((a) => a.id === 'agent-4')!
    const wallet = target.wallet
    const needs = { ...target.needs }
    const coins2 = totalCoins(sim)
    expect(sim.sanction('agent-11', 'agent-4', 'Took the east farm', 'no-such-rule')).toBe(
      true,
    )
    expect(totalCoins(sim)).toBe(coins2)
    const after = sim.state.agents.find((a) => a.id === 'agent-4')!
    expect(after.wallet).toBe(wallet)
    expect(after.needs).toEqual(needs)
    const ev = sim.getEvents().find((e) => e.type === 'institution:sanctioned')
    expect(ev).toBeTruthy()
    expect(ev!.data?.targetId).toBe('agent-4')
    expect(ev!.data?.reason).toBe('Took the east farm')
    expect(ev!.reason && ev!.reason.length > 0).toBe(true)
  })
})

describe('institution determinism + persist v5', () => {
  const plan: Array<{ atTick: number; agentId: string; intent: Intent; reasoning: string }> = [
    {
      atTick: 20,
      agentId: 'agent-0',
      intent: {
        kind: 'propose',
        text: 'No hoarding at the stall',
        reason: 'I will post this.',
      },
      reasoning: 'I will post this.',
    },
    {
      atTick: 30,
      agentId: 'agent-1',
      intent: { kind: 'vote', proposalId: 'PENDING', choice: 'yes', reason: 'I vote yes.' },
      reasoning: 'I vote yes.',
    },
    {
      atTick: 40,
      agentId: 'agent-11',
      intent: {
        kind: 'sanction',
        targetAgentId: 'agent-4',
        text: 'Was rude at the well',
        reason: 'I will censure Ode.',
      },
      reasoning: 'I will censure Ode.',
    },
    {
      atTick: 50,
      agentId: 'agent-2',
      intent: { kind: 'claim', targetPlaceId: 'PENDING_FARM', reason: 'I claim a farm.' },
      reasoning: 'I claim a farm.',
    },
  ]

  function runScripted(sim: Simulation, until: number): void {
    const farm = sim.state.places.find((p) => p.kind === 'farm')!
    let postedId = ''
    for (let t = 0; t < until; t++) {
      const next = plan.find((p) => p.atTick === sim.state.tick)
      if (next) {
        const intent = { ...next.intent }
        if (intent.kind === 'vote') {
          postedId = sim.state.proposals[0]?.id ?? postedId
          intent.proposalId = postedId
        }
        if (intent.kind === 'claim') intent.targetPlaceId = farm.id
        sim.postExternalIntent(next.agentId, intent, meta(next.reasoning))
      }
      sim.advanceTicks(1)
    }
  }

  it('scripted propose/vote/sanction/claim: double-run hash + stateAt seek', () => {
    const a = new Simulation(SEED)
    runScripted(a, 200)
    const b = new Simulation(SEED)
    runScripted(b, 200)
    expect(a.hash()).toBe(b.hash())
    expect(a.stateAt(200).hash()).toBe(a.hash())
    expect(a.stateAt(80).hash()).toBe(
      (() => {
        const mid = new Simulation(SEED)
        runScripted(mid, 80)
        return mid.hash()
      })(),
    )
    expect(a.getEvents().some((e) => e.type === 'institution:proposed')).toBe(true)
    expect(a.getEvents().some((e) => e.type === 'institution:voted')).toBe(true)
    expect(a.getEvents().some((e) => e.type === 'institution:sanctioned')).toBe(true)
    expect(a.getEvents().some((e) => e.reason === 'claimed it')).toBe(true)
  })

  it('save v5 round-trip + v4..v1 loads', () => {
    const sim = new Simulation(SEED)
    runScripted(sim, 120)
    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(save.formatVersion).toBe(5)
    expect(save.snapshot.state.proposals.length).toBeGreaterThan(0)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(sim.hash())
    expect(restored.state.proposals).toEqual(sim.state.proposals)

    const stripInst = (s: (typeof save.snapshot)) => ({
      ...s,
      state: {
        ...s.state,
        proposals: undefined as unknown as Proposal[],
        rules: undefined as unknown as Rule[],
      },
    })

    for (const ver of [4, 3, 2, 1] as const) {
      const older = {
        ...save,
        formatVersion: ver,
        snapshot: stripInst(save.snapshot),
        pinnedDayStartSnapshots: save.pinnedDayStartSnapshots.map(stripInst),
        fineSnapshotRing: save.fineSnapshotRing.map(stripInst),
      }
      const r = restoreSave(older)
      expect(r.state.proposals).toEqual([])
      expect(r.state.rules).toEqual([])
    }
  })
})

describe('no-enforcement: rules never change action mechanics', () => {
  const kinds: ActionKind[] = [
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
  ]

  it('same intents produce equal behavior hashes with vs without an active rule', () => {
    const rule: Rule = {
      id: 'r-dummy',
      text: 'Nobody may eat, work, forage, buy, sleep, or walk.',
      proposerId: 'agent-0',
      enactedTick: 0,
      active: true,
    }

    function drive(withRule: boolean): Simulation {
      const sim = new Simulation(SEED)
      if (withRule) sim.state.rules.push({ ...rule })
      // Script the same intents on Mira
      const sequence: Array<{ at: number; kind: ActionKind }> = [
        { at: 10, kind: 'wander' },
        { at: 20, kind: 'forage' },
        { at: 40, kind: 'eat' },
        { at: 60, kind: 'drink' },
        { at: 80, kind: 'work' },
        { at: 100, kind: 'idle' },
      ]
      for (let t = 0; t < 130; t++) {
        const step = sequence.find((s) => s.at === sim.state.tick)
        if (step) {
          sim.postExternalIntent(
            'agent-0',
            { kind: step.kind, reason: `do ${step.kind}` },
            meta(`do ${step.kind}`),
          )
        }
        sim.advanceTicks(1)
      }
      return sim
    }

    const withR = drive(true)
    const without = drive(false)
    expect(behaviorHash(withR)).toBe(behaviorHash(without))
    expect(withR.state.rules).toHaveLength(1)
    expect(without.state.rules).toHaveLength(0)
    // Full hashes differ only by the rules field
    expect(withR.hash()).not.toBe(without.hash())

    // Every pre-institution action kind still starts (none blocked by the dummy rule)
    const started = new Set(
      withR
        .getEvents()
        .filter((e) => e.type === 'action:start' && e.agentId === 'agent-0')
        .map((e) => e.data?.kind as string),
    )
    for (const k of kinds) {
      if (k === 'buy' || k === 'commission' || k === 'sleep' || k === 'socialize' || k === 'walk') {
        continue
      }
      expect(started.has(k), `kind ${k} should still execute`).toBe(true)
    }
  })
})

describe('prompt neutrality + parse', () => {
  it('system prompt has no imperative usage nudges', () => {
    const sys = buildSystemPrompt('agent-0')
    const forbidden = [
      /you should propose/i,
      /you should vote/i,
      /you should obey/i,
      /you must obey/i,
      /you must follow/i,
      /you should rebel/i,
      /vote yes/i,
      /you ought to propose/i,
      /please propose/i,
      /please vote/i,
    ]
    for (const re of forbidden) {
      expect(sys, `matched ${re}`).not.toMatch(re)
    }
    // Mechanics live in the world now — system prompt only names the verbs
    expect(sys).not.toMatch(/anyone may/i)
    expect(sys).not.toMatch(/2 coins/)
    expect(sys).not.toMatch(/may be followed or broken/i)
    expect(sys).toMatch(
      /You feel your needs\. The world contains places and things whose workings you learn by living, examining, and listening\./,
    )
  })

  it('parse accepts civic actions and rejects invalid payloads', () => {
    const sim = new Simulation(SEED)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!

    const okP = parseMindJson(
      JSON.stringify({
        action: 'propose',
        text: 'Share tools at the plaza',
        reasoning: 'I will post this.',
      }),
    )
    expect(okP.ok).toBe(true)
    if (okP.ok) {
      const intent = resolveMindIntent(sim.state, mira, okP.raw)
      expect(intent.kind).toBe('propose')
      expect(intent.text).toBe('Share tools at the plaza')
    }

    const badP = parseMindJson(
      JSON.stringify({ action: 'propose', reasoning: 'no text field' }),
    )
    expect(badP.ok).toBe(false)

    const badVote = parseMindJson(
      JSON.stringify({
        action: 'vote',
        target: 'prop-x',
        choice: 'maybe',
        reasoning: 'hmm',
      }),
    )
    expect(badVote.ok).toBe(false)

    const okS = parseMindJson(
      JSON.stringify({
        action: 'sanction',
        target: 'Ode',
        reason: 'Broke the posted rule',
        reasoning: 'I will censure Ode.',
      }),
    )
    expect(okS.ok).toBe(true)
    if (okS.ok) {
      const intent = resolveMindIntent(sim.state, mira, okS.raw)
      expect(intent.kind).toBe('sanction')
      expect(intent.targetAgentId).toBe('agent-4')
      expect(intent.text).toBe('Broke the posted rule')
    }

    const okC = parseMindJson(
      JSON.stringify({
        action: 'claim',
        target: 'farm',
        reasoning: 'I will claim a farm.',
      }),
    )
    expect(okC.ok).toBe(true)
    if (okC.ok) {
      const intent = resolveMindIntent(sim.state, mira, okC.raw)
      expect(intent.kind).toBe('claim')
      const claimed = sim.state.places.find((p) => p.id === intent.targetPlaceId)
      expect(claimed?.kind).toBe('farm')
    }
  })

  it('observations include open tallies, rules, sanctions (no fee explanations)', () => {
    const sim = new Simulation(SEED)
    fund(sim, 'agent-0', 20)
    sim.propose('agent-0', 'Quiet nights at the plaza')
    sim.vote('agent-1', sim.state.proposals[0]!.id, 'yes')
    sim.state.rules.push({
      id: 'r1',
      text: 'Be kind at the well',
      proposerId: 'agent-1',
      enactedTick: 0,
      active: true,
    })
    sim.sanction('agent-0', 'agent-4', 'Spoke over Tama')
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const user = buildUserPrompt(agent, sim.state, sim.getEvents())
    expect(user).toContain('Open proposals:')
    expect(user).toContain('yes')
    expect(user).toContain('Posted rules:')
    expect(user).toContain('Be kind at the well')
    expect(user).toContain('Recent sanctions:')
    expect(user).not.toContain('You can afford the proposal fee')
    expect(user).not.toContain('You can afford the claim fee')
  })
})

describe('proposal tally helper', () => {
  it('counts yes/no/total', () => {
    const p: Proposal = {
      id: 'p',
      proposerId: 'a',
      text: 't',
      createdTick: 0,
      closesTick: 10,
      votes: { a: 'yes', b: 'yes', c: 'no' },
      status: 'open',
    }
    expect(proposalTally(p)).toEqual({ yes: 2, no: 1, total: 3 })
  })
})

/**
 * Regressions for the origination investigation (plans Addendum 3). Each of
 * these was measured as a silent behaviour loss, not a crash — the trace showed
 * nothing wrong while civic actions vanished.
 */
describe('civic affordances (origination fixes)', () => {
  it('a free propose still posts — the zero-fee path must not fall through the transfer gate', () => {
    const sim = new Simulation(42)
    const before = sim.state.agents.find((a) => a.id === 'agent-0')!.wallet
    expect(PROPOSE_COST).toBe(0)
    expect(sim.propose('agent-0', 'The spring is a commons — no one may block others.')).toBe(true)
    expect(sim.state.proposals.filter((pr) => pr.status === 'open').length).toBe(1)
    // transferCoins rejects amount<=0, so a 0 fee must skip payment entirely
    // rather than be read as "could not pay".
    expect(sim.state.agents.find((a) => a.id === 'agent-0')!.wallet).toBe(before)
    expect(
      sim.getEvents().some((e) => e.type === 'institution:propose-refused'),
    ).toBe(false)
  })

  it('a broke villager can originate — the fee was the whole gate', () => {
    const sim = new Simulation(7)
    const agent = sim.state.agents.find((a) => a.id === 'agent-1')!
    if (agent.wallet > 0) {
      sim.transferCoins('agent-1', 'treasury', agent.wallet, 'test drain')
    }
    expect(agent.wallet).toBe(0)
    expect(sim.propose('agent-1', 'Everyone gets a fair turn at the spring.')).toBe(true)
  })

  it('voting is free and stays symmetric with proposing', () => {
    expect(VOTE_COST).toBe(PROPOSE_COST)
    const sim = new Simulation(42)
    expect(sim.propose('agent-0', 'Share the spring.')).toBe(true)
    const id = sim.state.proposals.filter((pr) => pr.status === 'open')[0]!.id
    const before = sim.state.agents.find((a) => a.id === 'agent-1')!.wallet
    expect(sim.vote('agent-1', id, 'yes')).toBe(true)
    expect(sim.state.agents.find((a) => a.id === 'agent-1')!.wallet).toBe(before)
  })

  it('the board menu is generated from the fee constants, never a stale literal', () => {
    const text = EXAMINE_BY_KIND['notice-board']
    expect(text).toContain(coinPhrase(PROPOSE_COST))
    expect(text).toContain(coinPhrase(SANCTION_COST))
    expect(text).toContain(coinPhrase(CLAIM_COST))
    // The old copy hardcoded "2 coins" for propose; if the constant is 0 the
    // menu must say so rather than quoting a price the sim never charges.
    if (PROPOSE_COST === 0) expect(text).not.toMatch(/propose \(\d+ coins?\)/)
    expect(text).toContain(
      'Proposals are weighed at a plaza assembly on their closing eve.',
    )
  })

  it('sanction accepts "text", and recovers a censure written into "reasoning"', () => {
    const sim = new Simulation(42)
    const world = sim.state
    const wren = world.agents.find((a) => a.name === 'Wren')!

    // Preferred field, matching propose.
    const viaText = parseMindJson(
      JSON.stringify({
        action: 'sanction',
        target: wren.name,
        text: 'Wren has kept others from the spring.',
        reasoning: 'I will not let this stand.',
      }),
    )
    expect(viaText.ok).toBe(true)

    // The measured failure: censure written into "reasoning", "reason" absent.
    // This used to be a parse-fail — the sanction was recorded as nothing.
    const viaReasoning = parseMindJson(
      JSON.stringify({
        action: 'sanction',
        target: wren.name,
        reasoning: 'I will post a censure: Wren has kept others from the spring.',
      }),
    )
    expect(viaReasoning.ok).toBe(true)
    if (!viaReasoning.ok) return
    const intent = resolveMindIntent(
      world,
      world.agents.find((a) => a.id === 'agent-0')!,
      viaReasoning.raw,
    )
    expect(intent.kind).toBe('sanction')
    if (intent.kind !== 'sanction') return
    expect(intent.targetAgentId).toBe(wren.id)
    expect(intent.text ?? '').not.toHaveLength(0)
    expect((intent.text ?? '').length).toBeLessThanOrEqual(120)
  })

  it('a sanction with no censure text anywhere is still refused', () => {
    const r = parseMindJson(JSON.stringify({ action: 'sanction', target: 'Wren' }))
    expect(r.ok).toBe(false)
  })
})

describe('assemblies + census (P5-4)', () => {
  it('assembly window is the last evening before close; fallback is first 18:00', () => {
    // Posted at Day 1 06:00, closes Day 2 06:00 → last evening is Day 1 18:00–20:00
    expect(assemblyWindowFor(0, 1440)).toEqual({ startTick: 720, endTick: 840 })
    // Posted after 18:00; close is next day after 18:00 → that next evening
    const late = assemblyWindowFor(800, 800 + 1440)
    expect(late.startTick).toBe(2160)
    expect(late.endTick).toBe(2280)
    // Close before any 18:00 exists → first available 18:00
    expect(assemblyWindowFor(0, 100).startTick).toBe(720)
  })

  it('propose schedules a gathering with correct window math and reason', () => {
    const sim = new Simulation(SEED)
    expect(sim.propose('agent-0', 'Share the well after dusk')).toBe(true)
    const p = sim.state.proposals[0]!
    const g = sim.state.gatherings![0]!
    const win = assemblyWindowFor(p.createdTick, p.closesTick)
    expect(g).toMatchObject({
      kind: 'assembly',
      subjectId: p.id,
      startTick: win.startTick,
      endTick: win.endTick,
    })
    const ev = sim.getEvents().find((e) => e.type === 'gathering:scheduled')
    expect(ev?.data?.subjectId).toBe(p.id)
    expect(ev?.data?.startTick).toBe(win.startTick)
    expect(ev?.reason).toMatch(/assembly is scheduled at the plaza/)
    expect(ev?.reason).toContain('Share the well after dusk')
  })

  it('gathering expires after endTick and reports attendance', () => {
    const sim = new Simulation(SEED)
    sim.propose('agent-0', 'Weigh me')
    const g0 = sim.state.gatherings![0]!
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const sheep = sim.state.agents.filter((a) => isSheepAgent(a.id))
    sim.advanceTicks(g0.startTick - 1 - sim.state.tick)
    const keep = new Set([sheep[0]!.id, sheep[1]!.id])
    for (const a of sim.state.agents) {
      if (keep.has(a.id)) {
        parkAgent(a, plaza.x, plaza.y)
        a.needs = { hunger: 0.95, energy: 0.95, social: 0.95 }
        a.collapsed = false
      } else {
        parkAgent(a, 2, 2)
      }
    }
    boxAround(sim, 2, 2, 2)
    sim.advanceTicks(g0.endTick - sim.state.tick)
    expect(sim.state.tick).toBe(g0.endTick)
    expect(sim.state.gatherings ?? []).toHaveLength(0)
    const ended = sim.getEvents().find((e) => e.type === 'gathering:ended')
    expect(ended).toBeTruthy()
    expect(ended!.data?.attendance).toBe(2)
    expect(ended!.reason).toMatch(/2 villagers attended/)
    const started = sim.getEvents().find((e) => e.type === 'gathering:started')
    expect(started).toBeTruthy()
    expect(started!.reason).toMatch(/has gathered at the plaza/)
  })

  it('census line derives from places; adding a place changes the count', () => {
    const sim = new Simulation(SEED)
    const before = villageCensusLine(sim.state.places)
    expect(before).toMatch(/^The village holds:/)
    expect(before).toContain('notice-board')
    const homes = sim.state.places.filter((p) => p.kind === 'home').length
    expect(before).toContain(`${homes} homes`)
    sim.state.places.push({
      id: 'home-census-extra',
      kind: 'home',
      x: 3,
      y: 3,
      slots: 2,
      inventory: emptyInventory(),
    })
    const after = villageCensusLine(sim.state.places)
    expect(after).toContain(`${homes + 1} homes`)
    expect(after).not.toBe(before)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const examined = examineKnowledgeFor(board, { places: sim.state.places })
    expect(examined).toContain(after!)
    expect(examined).toContain(
      'Proposals are weighed at a plaza assembly on their closing eve.',
    )
  })

  it('assembly observation lines render only in their windows; census when near the board', () => {
    const sim = new Simulation(SEED)
    sim.propose('agent-0', 'Quiet nights at the plaza')
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const g = sim.state.gatherings![0]!

    mira.x = board.x
    mira.y = board.y
    let user = buildUserPrompt(mira, sim.state, sim.getEvents())
    expect(user).toContain(
      'An assembly gathers at the plaza at 18:00 to weigh "Quiet nights at the plaza"',
    )
    expect(user).not.toContain('The assembly is gathered at the plaza NOW')
    expect(user).toMatch(/The village holds:/)

    sim.advanceTicks(g.startTick - sim.state.tick)
    user = buildUserPrompt(mira, sim.state, sim.getEvents())
    expect(user).toContain('The assembly is gathered at the plaza NOW')
    expect(user).toContain('"Quiet nights at the plaza" is being weighed')
    expect(user).not.toContain('An assembly gathers at the plaza at 18:00')

    sim.advanceTicks(g.endTick - sim.state.tick)
    user = buildUserPrompt(mira, sim.state, sim.getEvents())
    expect(user).not.toContain('An assembly gathers at the plaza at 18:00')
    expect(user).not.toContain('The assembly is gathered at the plaza NOW')

    mira.x = 0
    mira.y = 0
    const far = buildUserPrompt(mira, sim.state, sim.getEvents())
    const census = villageCensusLine(sim.state.places)!
    expect(far).not.toContain(census)
  })

  it('save and stateAt round-trip gatherings', () => {
    const sim = new Simulation(SEED)
    sim.postExternalIntent(
      'agent-0',
      { kind: 'propose', text: 'Round trip the assembly', reason: 'I will post this.' },
      meta('I will post this.'),
    )
    sim.advanceTicks(5)
    expect(sim.state.gatherings?.length).toBe(1)
    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(5)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(sim.hash())
    expect(restored.state.gatherings).toEqual(sim.state.gatherings)
    const fork = sim.stateAt(sim.state.tick)
    expect(fork.hash()).toBe(sim.hash())
    expect(fork.state.gatherings).toEqual(sim.state.gatherings)
  })

  it('recorded soak worlds still import (missing gatherings ⇒ none scheduled)', (ctx) => {
    const files = recordedWorldPaths([
      'artifacts/soak-1787430602479-world.json',
      'artifacts/soak-1787452399090-world.json',
    ])
    if (files.length === 0) return ctx.skip(NO_RECORDED_WORLDS)
    for (const file of files) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        tick: number
        seed: number
      }
      const loaded = restoreSave(raw)
      expect(loaded.state.tick).toBe(raw.tick)
      expect(loaded.state.seed).toBe(raw.seed)
      expect(loaded.state.gatherings ?? []).toEqual([])
    }
  }, 120_000)

  it('binding votes stay valid from anywhere; no attendance gate on minds', () => {
    const sim = new Simulation(SEED)
    sim.propose('agent-0', 'Minds may vote from the woods')
    const id = sim.state.proposals[0]!.id
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const mind = sim.state.agents.find((a) => a.id === 'agent-1')!
    mind.x = plaza.x + 12
    mind.y = plaza.y + 12
    expect(inPlazaRadius(mind.x, mind.y, plaza)).toBe(false)
    expect(sim.vote('agent-1', id, 'yes')).toBe(true)
    expect(sim.state.proposals[0]!.votes['agent-1']).toBe('yes')
  })
})

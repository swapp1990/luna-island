import type { EventTrace } from '../sim/events'
import type { Rng } from '../sim/types'
import type {
  LineageActKind,
  LineageBrain,
  LineageIntent,
  LineageObservation,
  LineageState,
  Room,
  Turn,
  Villager,
} from './types'
import { STARVE_DEPART_REASON, TURN_NAMES } from './types'
import {
  addRule,
  clamp01,
  findVillager,
  grain1,
  hasRule,
  livingVillagers,
  removeRule,
} from './world'

const ACT_ROOM: Record<LineageActKind, Room | null> = {
  work: 'fields',
  forage: 'woods',
  rest: 'homes',
  eat: null,
  store: 'hall',
  withdraw: 'hall',
  give: null,
  talk: null,
  court: null,
  propose: 'hall',
  vote: 'hall',
  shun: null,
  idle: null,
}

export function advanceTurn(
  state: LineageState,
  brainFor: (v: Villager) => LineageBrain,
  rng: Rng,
  events: EventTrace,
): void {
  events.append({
    tick: state.tick,
    type: 'turn:start',
    data: { turn: state.turn, name: TURN_NAMES[state.turn] },
  })

  const living = livingVillagers(state)
  for (const v of living) {
    const obs = observe(state, v)
    const intent = brainFor(v).decide(obs, rng)
    const reason = intent.reason && intent.reason.length > 0 ? intent.reason : 'I act.'
    events.append({
      tick: state.tick,
      type: 'action:start',
      agentId: v.id,
      data: intentData(intent),
      reason,
    })
    resolveAct(state, v, intent, rng, events)
  }

  decayNeeds(state, events)
  applyStarving(state, events)

  if (state.turn === 2) resolveProposals(state, events)

  advanceClock(state, events)
}

function intentData(intent: LineageIntent): Record<string, unknown> {
  const data: Record<string, unknown> = { kind: intent.kind }
  if (intent.target !== undefined) data.target = intent.target
  if (intent.amount !== undefined) data.amount = intent.amount
  if (intent.text !== undefined) data.text = intent.text
  if (intent.rule !== undefined) data.rule = intent.rule
  if (intent.proposalId !== undefined) data.proposalId = intent.proposalId
  if (intent.choice !== undefined) data.choice = intent.choice
  return data
}

function observe(state: LineageState, self: Villager): LineageObservation {
  const others = livingVillagers(state).filter((v) => v.id !== self.id)
  return {
    self,
    others,
    state,
    facts: [
      `It is ${TURN_NAMES[state.turn]} of day ${state.day}.`,
      `The granary holds ${grain1(state.granary)} grain.`,
      `Rules in force: ${state.rules.join(', ') || 'none'}.`,
    ],
  }
}

function setActRoom(v: Villager, kind: LineageActKind): void {
  const room = ACT_ROOM[kind]
  if (room !== null) v.room = room
}

function fail(events: EventTrace, state: LineageState, v: Villager, why: string): void {
  events.append({
    tick: state.tick,
    type: 'action:fail',
    agentId: v.id,
    reason: why,
    data: { reason: why },
  })
}

function ok(
  events: EventTrace,
  state: LineageState,
  v: Villager,
  data: Record<string, unknown>,
): void {
  events.append({
    tick: state.tick,
    type: 'action:end',
    agentId: v.id,
    data,
  })
}

function takeFromGranary(state: LineageState, v: Villager): string | null {
  if (!hasRule(state, 'granary-open')) return 'granary is closed'
  if (state.granary < 1) return 'granary is empty'
  if (hasRule(state, 'ration-granary') && (state.granaryTakenToday[v.id] ?? 0) >= 1) {
    return 'daily ration already taken'
  }
  state.granary -= 1
  state.granaryTakenToday[v.id] = (state.granaryTakenToday[v.id] ?? 0) + 1
  return null
}

function resolveAct(
  state: LineageState,
  v: Villager,
  intent: LineageIntent,
  rng: Rng,
  events: EventTrace,
): void {
  setActRoom(v, intent.kind)
  switch (intent.kind) {
    case 'work': {
      const gained = state.config.harvestYield * (0.85 + 0.3 * v.traits.industry)
      v.grain += gained
      v.energy = clamp01(v.energy - 0.2)
      ok(events, state, v, { kind: 'work', grainDelta: gained, room: v.room })
      return
    }
    case 'forage': {
      const found = rng.next() < 0.5
      if (found) v.grain += 1
      v.energy = clamp01(v.energy - 0.1)
      ok(events, state, v, { kind: 'forage', grainDelta: found ? 1 : 0, found })
      return
    }
    case 'rest': {
      v.energy = clamp01(v.energy + 0.5)
      ok(events, state, v, { kind: 'rest', energy: v.energy })
      return
    }
    case 'eat': {
      if (v.grain >= 1) {
        v.grain -= 1
        v.satiety = clamp01(v.satiety + 0.5)
        ok(events, state, v, { kind: 'eat', source: 'own', satiety: v.satiety })
        return
      }
      const err = takeFromGranary(state, v)
      if (err) {
        fail(
          events,
          state,
          v,
          err === 'granary is closed' ? 'granary closed' : 'no grain to eat',
        )
        return
      }
      v.satiety = clamp01(v.satiety + 0.5)
      ok(events, state, v, { kind: 'eat', source: 'granary', satiety: v.satiety })
      return
    }
    case 'store': {
      const amount = intent.amount !== undefined ? intent.amount : v.grain
      if (amount <= 0 || v.grain <= 0) {
        fail(events, state, v, 'no grain to store')
        return
      }
      const moved = amount > v.grain ? v.grain : amount
      v.grain -= moved
      state.granary += moved
      ok(events, state, v, { kind: 'store', amount: moved, granary: state.granary })
      return
    }
    case 'withdraw': {
      const amount = intent.amount !== undefined ? intent.amount : 1
      if (amount <= 0) {
        fail(events, state, v, 'nothing to withdraw')
        return
      }
      if (!hasRule(state, 'granary-open')) {
        fail(events, state, v, 'granary is closed')
        return
      }
      if (state.granary < amount) {
        fail(events, state, v, 'granary is empty')
        return
      }
      if (hasRule(state, 'ration-granary') && (state.granaryTakenToday[v.id] ?? 0) >= 1) {
        fail(events, state, v, 'daily ration already taken')
        return
      }
      state.granary -= amount
      v.grain += amount
      state.granaryTakenToday[v.id] = (state.granaryTakenToday[v.id] ?? 0) + amount
      ok(events, state, v, { kind: 'withdraw', amount, granary: state.granary })
      return
    }
    case 'give': {
      const target = intent.target ? findVillager(state, intent.target) : undefined
      if (!target || target.status !== 'alive') {
        fail(events, state, v, 'target departed')
        return
      }
      const amount = intent.amount !== undefined ? intent.amount : 1
      if (amount <= 0 || v.grain < amount) {
        fail(events, state, v, 'no grain to give')
        return
      }
      v.grain -= amount
      target.grain += amount
      v.standing += 1
      target.companionship = clamp01(target.companionship + 0.1)
      ok(events, state, v, { kind: 'give', target: target.id, amount })
      events.append({
        tick: state.tick,
        type: 'give',
        agentId: v.id,
        data: { to: target.id, amount },
      })
      return
    }
    case 'talk': {
      const target = intent.target ? findVillager(state, intent.target) : undefined
      if (!target || target.status !== 'alive') {
        fail(events, state, v, 'target departed')
        return
      }
      const text = (intent.text ?? '').slice(0, 140)
      v.companionship = clamp01(v.companionship + 0.3)
      target.companionship = clamp01(target.companionship + 0.3)
      v.talkedWith[target.id] = (v.talkedWith[target.id] ?? 0) + 1
      target.talkedWith[v.id] = (target.talkedWith[v.id] ?? 0) + 1
      ok(events, state, v, { kind: 'talk', target: target.id, text })
      events.append({
        tick: state.tick,
        type: 'speech',
        agentId: v.id,
        data: { to: target.id, text },
      })
      return
    }
    case 'court': {
      const target = intent.target ? findVillager(state, intent.target) : undefined
      if (!target || target.status !== 'alive') {
        fail(events, state, v, 'target departed')
        return
      }
      if (!v.courted.includes(target.id)) v.courted.push(target.id)
      ok(events, state, v, { kind: 'court', target: target.id })
      events.append({
        tick: state.tick,
        type: 'court',
        agentId: v.id,
        data: { to: target.id },
      })
      return
    }
    case 'propose': {
      if (!intent.rule) {
        fail(events, state, v, 'no rule to propose')
        return
      }
      const proposal = {
        id: `p-${state.proposals.length}`,
        rule: intent.rule,
        by: v.id,
        text: intent.text ?? intent.rule,
        openedTick: state.tick,
        votes: {} as Record<string, 'for' | 'against'>,
      }
      state.proposals.push(proposal)
      ok(events, state, v, { kind: 'propose', proposalId: proposal.id, rule: proposal.rule })
      events.append({
        tick: state.tick,
        type: 'proposal:open',
        agentId: v.id,
        data: { id: proposal.id, rule: proposal.rule, text: proposal.text },
      })
      return
    }
    case 'vote': {
      const p = intent.proposalId
        ? state.proposals.find((x) => x.id === intent.proposalId)
        : state.proposals.find((x) => x.resolved === undefined)
      if (!p || p.resolved) {
        fail(events, state, v, 'not at the hall')
        return
      }
      if (p.votes[v.id] !== undefined) {
        fail(events, state, v, 'already voted')
        return
      }
      const choice = intent.choice ?? 'against'
      p.votes[v.id] = choice
      ok(events, state, v, { kind: 'vote', proposalId: p.id, choice })
      events.append({
        tick: state.tick,
        type: 'vote',
        agentId: v.id,
        data: { proposalId: p.id, choice, rule: p.rule },
      })
      return
    }
    case 'shun': {
      const target = intent.target ? findVillager(state, intent.target) : undefined
      if (!target || target.status !== 'alive') {
        fail(events, state, v, 'target departed')
        return
      }
      target.standing -= 1
      const text = (intent.text ?? '').slice(0, 140)
      ok(events, state, v, { kind: 'shun', target: target.id, text })
      events.append({
        tick: state.tick,
        type: 'shun',
        agentId: v.id,
        data: { to: target.id, text },
      })
      return
    }
    case 'idle':
    default:
      ok(events, state, v, { kind: 'idle' })
  }
}

function decayNeeds(state: LineageState, events: EventTrace): void {
  for (const v of livingVillagers(state)) {
    const oldSat = v.satiety
    const oldEn = v.energy
    const oldCo = v.companionship
    v.satiety = clamp01(v.satiety - 0.12 * (0.85 + 0.3 * v.traits.metabolism))
    v.energy = clamp01(v.energy - 0.15 * (1.15 - 0.3 * v.traits.stamina))
    v.companionship = clamp01(v.companionship - 0.06 * (0.85 + 0.3 * v.traits.sociability))
    emitCritical(events, state, v, 'satiety', oldSat, v.satiety)
    emitCritical(events, state, v, 'energy', oldEn, v.energy)
    emitCritical(events, state, v, 'companionship', oldCo, v.companionship)
  }
}

function emitCritical(
  events: EventTrace,
  state: LineageState,
  v: Villager,
  need: string,
  oldV: number,
  newV: number,
): void {
  if (oldV >= 0.15 && newV < 0.15) {
    events.append({
      tick: state.tick,
      type: 'need:critical',
      agentId: v.id,
      data: { need, value: newV },
    })
  }
}

function applyStarving(state: LineageState, events: EventTrace): void {
  for (const v of livingVillagers(state)) {
    if (v.satiety === 0) {
      v.starvingTurns += 1
      events.append({
        tick: state.tick,
        type: 'villager:starving',
        agentId: v.id,
        data: { starvingTurns: v.starvingTurns },
      })
      if (v.starvingTurns >= 4) {
        depart(state, v, STARVE_DEPART_REASON, events)
      }
    } else {
      v.starvingTurns = 0
    }
  }
}

export function depart(
  state: LineageState,
  v: Villager,
  reason: string,
  events: EventTrace,
): void {
  v.status = 'departed'
  const rec = state.lineage.find((r) => r.id === v.id)
  if (rec) rec.departedReason = reason
  events.append({
    tick: state.tick,
    type: 'villager:departed',
    agentId: v.id,
    reason,
    data: { reason },
  })
}

function resolveProposals(state: LineageState, events: EventTrace): void {
  const open = state.proposals.filter((p) => p.resolved === undefined)
  open.sort((a, b) => (a.openedTick - b.openedTick) || a.id.localeCompare(b.id))
  for (const p of open) {
    let forN = 0
    let againstN = 0
    let cast = 0
    for (const choice of Object.values(p.votes)) {
      cast += 1
      if (choice === 'for') forN += 1
      else againstN += 1
    }
    const adopted = cast >= 3 && forN > againstN
    p.resolved = adopted ? 'adopted' : 'rejected'
    events.append({
      tick: state.tick,
      type: 'proposal:resolved',
      agentId: p.by,
      data: { id: p.id, rule: p.rule, result: p.resolved, for: forN, against: againstN, cast },
    })
    if (!adopted) continue
    if (p.rule === 'granary-open') {
      removeRule(state, 'granary-closed')
      addRule(state, 'granary-open')
    } else if (p.rule === 'granary-closed') {
      removeRule(state, 'granary-open')
      addRule(state, 'granary-closed')
    } else {
      addRule(state, p.rule)
    }
    events.append({
      tick: state.tick,
      type: 'rule:enacted',
      agentId: p.by,
      data: { rule: p.rule, proposalId: p.id },
    })
    const proposer = findVillager(state, p.by)
    if (proposer && proposer.status === 'alive') proposer.standing += 1
  }
}

function advanceClock(state: LineageState, events: EventTrace): void {
  state.tick += 1
  const nextTurn = state.turn + 1
  if (nextTurn >= state.config.turnsPerDay) {
    state.turn = 0
    state.day += 1
    state.granaryTakenToday = {}
    if (state.day < state.config.daysPerSeason) {
      events.append({
        tick: state.tick,
        type: 'day:start',
        data: { day: state.day },
      })
    }
  } else {
    state.turn = nextTurn as Turn
  }
}

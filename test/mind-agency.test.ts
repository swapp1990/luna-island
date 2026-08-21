import { describe, expect, it } from 'vitest'
import { Simulation, COMMISSION_COOLDOWN_TICKS } from '../src/sim/sim'
import {
  UtilityBrain,
  STRATEGIC_ACTION_KINDS,
  makeObservation,
} from '../src/sim/utilityBrain'
import { slotTiles } from '../src/sim/spots'
import { isWalkable } from '../src/sim/pathfind'
import { createRng } from '../src/sim/rng'
import type { ExternalIntentMeta } from '../src/sim/types'
import {
  approxTokens,
  buildSystemPrompt,
  buildUserPrompt,
  NEED_WARNING_THRESHOLD,
  needsAreComfortable,
} from '../src/mind/prompt'
import { standingGoals } from '../src/mind/memory'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

describe('prompt reframe (P3-14 A1)', () => {
  it('safe-default line is absent; slack identity line is present', () => {
    const sys = buildSystemPrompt('agent-0')
    expect(sys).not.toMatch(/If unsure, prefer a safe need-serving action/)
    expect(sys).not.toMatch(/eat\/forage\/sleep\/work/)
    expect(sys).toContain('When nothing is urgent, act on who you are.')
  })

  it('Never examined section renders with distance+direction', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    agent.x = board.x - 3
    agent.y = board.y
    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toMatch(/Never examined:/)
    expect(user).toMatch(
      /notice-board \(\d+ tiles [NSEW]{1,2}(?:, on the plaza)?; [^)]+\)/,
    )
    expect(user).not.toMatch(/mysterious/i)
    expect(user).not.toMatch(/you're curious/i)
  })

  it('Goals section carries reflection intentions from the latest night', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    sim.postMindNotes(
      'agent-0',
      ['I worked the farm.', 'Tomorrow I will look at the notice board.'],
      { provider: 'mock', latencyMs: 1 },
    )
    sim.advanceTicks(1)
    // Older night, then a newer batch that replaces goals
    sim.postMindNotes(
      'agent-0',
      ['I will commission a house.', 'I should visit the quarry.'],
      { provider: 'mock', latencyMs: 1 },
    )
    sim.advanceTicks(1)

    const goals = standingGoals('agent-0', sim.state.mindNoteLog)
    expect(goals).toEqual(['I will commission a house.', 'I should visit the quarry.'])
    expect(goals).not.toContain('Tomorrow I will look at the notice board.')

    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain('Goals:')
    expect(user).toContain('I will commission a house.')
    expect(user).toContain('I should visit the quarry.')
    const goalsBlock = user.slice(user.indexOf('Goals:'), user.indexOf('Recently felt:'))
    expect(goalsBlock).not.toContain('Tomorrow I will look at the notice board.')
  })

  it('slack line appears iff no need is below the warning threshold', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.needs.hunger = 0.8
    agent.needs.energy = 0.8
    agent.needs.social = 0.8
    expect(needsAreComfortable(agent.needs)).toBe(true)
    const slack = buildUserPrompt(agent, sim.state, [], sim.state.mindNoteLog)
    expect(slack).toContain('Your needs are comfortable; nothing is urgent.')
    expect(slack.indexOf('Your needs are comfortable')).toBeLessThan(slack.indexOf('Needs:'))

    agent.needs.hunger = NEED_WARNING_THRESHOLD - 0.01
    const tight = buildUserPrompt(agent, sim.state, [], sim.state.mindNoteLog)
    expect(tight).not.toContain('Your needs are comfortable; nothing is urgent.')
  })

  it('fattest civic+memory fixture stays under the ~1500 token guard', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.needs.hunger = 0.8
    agent.needs.energy = 0.8
    agent.needs.social = 0.8
    sim.state.proposals.push({
      id: 'p-fat',
      proposerId: 'agent-1',
      text: 'Share the stall on lean days so no one walks hungry past the plaza.',
      createdTick: 0,
      closesTick: 1440,
      votes: { 'agent-1': 'yes', 'agent-2': 'no' },
      status: 'open',
    })
    sim.state.rules.push({
      id: 'r-fat',
      text: 'Be kind at the well after dusk.',
      proposerId: 'agent-2',
      enactedTick: 0,
      active: true,
    })
    sim.postMindNotes(
      'agent-0',
      [
        'Tomorrow I will examine the notice board.',
        'I will save coins for a house.',
        'I should talk with Joss at the plaza.',
      ],
      { provider: 'mock', latencyMs: 1 },
      ['The board is where people post rules.', 'Berries fill me when I eat them.'],
    )
    sim.advanceTicks(1)
    const sys = buildSystemPrompt('agent-0')
    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    const tokens = approxTokens(sys, user)
    expect(tokens).toBeLessThanOrEqual(1500)
  })
})

describe('examine from adjacency (P3-14 A3)', () => {
  it('occupied slots + adjacent agent → discovery:examined fires', () => {
    const sim = new Simulation(42)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const slots = slotTiles(sim.state, board)
    expect(slots.length).toBeGreaterThanOrEqual(2)
    const occupiers = [
      sim.state.agents.find((a) => a.id === 'agent-3')!,
      sim.state.agents.find((a) => a.id === 'agent-5')!,
    ]
    occupiers.forEach((o, i) => {
      const [sx, sy] = slots[i]!
      o.x = sx
      o.y = sy
      o.action = {
        kind: 'work',
        targetPlaceId: board.id,
        targetX: sx,
        targetY: sy,
        reason: 'occupying a slot',
      }
      o.actionTicks = 1
    })

    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const stand = [
      [board.x + 1, board.y],
      [board.x - 1, board.y],
      [board.x, board.y + 1],
      [board.x, board.y - 1],
    ].find(([x, y]) => isWalkable(sim.state, x, y))
    expect(stand).toBeTruthy()
    agent.x = stand![0]
    agent.y = stand![1]
    agent.action = { kind: 'idle', reason: 'looking' }

    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'examine',
        targetPlaceId: board.id,
        targetX: board.x,
        targetY: board.y,
        reason: 'I will look at the board.',
      },
      meta('I will look at the board.'),
    )
    let examined = false
    for (let i = 0; i < 8; i++) {
      sim.advanceTicks(1)
      if (sim.getEvents().some((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0')) {
        examined = true
        break
      }
    }
    expect(examined).toBe(true)
    const start = sim
      .getEvents()
      .find((e) => e.type === 'action:start' && e.agentId === 'agent-0' && e.data?.kind === 'examine')
    expect(start?.reason).not.toMatch(/Place was full/)
  })

  it('distant agent still walks first', () => {
    const sim = new Simulation(42)
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    let placed = false
    for (let y = 0; y < sim.state.height && !placed; y++) {
      for (let x = 0; x < sim.state.width && !placed; x++) {
        if (!isWalkable(sim.state, x, y)) continue
        const d = Math.hypot(x - board.x, y - board.y)
        if (d < 8) continue
        agent.x = x
        agent.y = y
        placed = true
      }
    }
    expect(placed).toBe(true)
    agent.action = { kind: 'idle', reason: 'far away' }

    sim.postExternalIntent(
      'agent-0',
      {
        kind: 'examine',
        targetPlaceId: board.id,
        targetX: board.x,
        targetY: board.y,
        reason: 'I will walk over and look.',
      },
      meta('I will walk over and look.'),
    )
    sim.advanceTicks(1)
    expect(agent.action.kind).toBe('examine')
    expect((agent.action.path?.length ?? 0) > 0 || agent.pathIndex > 0).toBe(true)
    expect(
      sim.getEvents().some((e) => e.type === 'discovery:examined' && e.agentId === 'agent-0'),
    ).toBe(false)
  })
})

describe('commission cooldown (P3-14 A3 / P4-3)', () => {
  it('second identical refusal arms ~240 ticks of silent rejects, then allowed again', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 0

    const starts = () =>
      sim
        .getEvents()
        .filter(
          (e) =>
            e.type === 'action:start' &&
            e.agentId === 'agent-0' &&
            e.data?.kind === 'commission',
        )

    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'I will build a house.' },
      meta('I will build a house.'),
    )
    sim.advanceTicks(1)
    expect(starts()).toHaveLength(1)
    expect(starts()[0]!.data?.ok).toBe(false)

    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'Trying again.' },
      meta('Trying again.'),
    )
    sim.advanceTicks(1)
    expect(starts()).toHaveLength(2)

    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'Spam.' },
      meta('Spam.'),
    )
    sim.advanceTicks(1)
    expect(starts()).toHaveLength(2)

    sim.advanceTicks(COMMISSION_COOLDOWN_TICKS)
    sim.postExternalIntent(
      'agent-0',
      { kind: 'commission', reason: 'After the silence.' },
      meta('After the silence.'),
    )
    sim.advanceTicks(1)
    expect(starts().length).toBeGreaterThanOrEqual(3)
  })
})

describe('strategic-verb gating (P3-14 A2)', () => {
  it('utility suggestions for a Luna agent never include the 6 strategic verbs; sheep unaffected', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(240)
    const luna = sim.state.agents.find((a) => a.id === 'agent-0')!
    const sheep = sim.state.agents.find((a) => a.id === 'agent-3')!
    const home = luna.homeId
    for (const a of sim.state.agents.slice(0, 4)) {
      a.homeId = home
      a.collapsed = false
      a.wallet = 50
      a.needs.hunger = 0.9
      a.needs.energy = 0.9
      a.needs.social = 0.9
    }

    const minded = new UtilityBrain(new Set(['agent-0']))
    const open = new UtilityBrain()
    const rngA = createRng(99)
    const rngB = createRng(99)

    const lunaIntent = minded.decide(makeObservation(luna, sim.state), rngA)
    expect(STRATEGIC_ACTION_KINDS.has(lunaIntent.kind)).toBe(false)

    const sheepIntent = open.decide(makeObservation(sheep, sim.state), rngB)
    expect(sheepIntent.kind).toBe('commission')

    // Simulation-wired brain: Luna utility path never starts commission
    const tickBefore = sim.state.tick
    luna.lastDecideTick = sim.state.tick - 40
    luna.action = { kind: 'idle', reason: 'ready' }
    sim.advanceTicks(30)
    const lunaStarts = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'action:start' &&
          e.agentId === 'agent-0' &&
          e.data?.kind === 'commission' &&
          e.tick > tickBefore,
      )
    expect(lunaStarts).toHaveLength(0)
  })
})

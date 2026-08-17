import { describe, expect, it } from 'vitest'
import {
  BURST_WINDOW,
  CRITICAL_NEED,
  describeAgent,
  describeBursts,
  describeDestination,
  type AgentVisual,
} from '../src/render/actionLanguage'
import type { AgentState, Needs, SimEvent } from '../src/sim/types'

function needs(partial: Partial<Needs> = {}): Needs {
  return {
    hunger: partial.hunger ?? 0.8,
    energy: partial.energy ?? 0.8,
    social: partial.social ?? 0.8,
  }
}

function agent(partial: Partial<AgentState> = {}): AgentState {
  const n = partial.needs ?? needs()
  const base: AgentState = {
    id: 'agent-0',
    name: 'Mira',
    color: '#e08a5b',
    x: 10,
    y: 10,
    homeId: 'home-0',
    needs: n,
    action: { kind: 'idle', reason: 'test' },
    needJitter: needs(),
    actionTicks: 3,
    lastDecideTick: 0,
    pathIndex: 0,
    criticalFired: { hunger: false, energy: false, social: false },
    actionStartNeeds: n,
    inventory: { food: 1, wood: 0, stone: 0 },
    wallet: 10,
    collapsed: false,
    employedAt: null,
    workedTicks: 0,
    daysIdleOnJob: 0,
    workPhase: null,
    haulAmount: 0,
    haulGood: null,
    haulSourceId: null,
    haulDropoffId: null,
    sympathy: {},
  }
  return { ...base, ...partial, needs: partial.needs ?? n }
}

function ev(partial: Partial<SimEvent> & Pick<SimEvent, 'tick' | 'type'>): SimEvent {
  return {
    seq: partial.seq ?? partial.tick,
    agentId: partial.agentId,
    data: partial.data,
    reason: partial.reason ?? '',
    ...partial,
  }
}

function vis(v: AgentVisual): string {
  return `${v.posture}/${v.glyph ?? 'none'}/${v.prop ?? 'none'}`
}

describe('action language registry', () => {
  it('later recover in the same window cancels residual fall', () => {
    const v = describeAgent(
      agent({ collapsed: false, action: { kind: 'idle', reason: 'up' } }),
      24,
      {
        events: [
          ev({ tick: 20, seq: 4, type: 'agent:collapsed', agentId: 'agent-0' }),
          ev({ tick: 24, seq: 5, type: 'agent:recovered', agentId: 'agent-0' }),
        ],
      },
    )
    expect(v.posture).toBe('standing')
    expect(v.glyph).toBeNull()
  })

  it('collapse event in window → fallen + ❗ even if state.collapsed is false', () => {
    const v = describeAgent(
      agent({ collapsed: false, action: { kind: 'wander', reason: 'go' } }),
      20,
      {
        events: [ev({ tick: 20, seq: 4, type: 'agent:collapsed', agentId: 'agent-0' })],
      },
    )
    expect(v.posture).toBe('fallen')
    expect(v.glyph).toBe('collapsed')
  })

  it('collapsed → fallen + ❗', () => {
    const v = describeAgent(agent({ collapsed: true, action: { kind: 'idle', reason: 'down' } }), 100)
    expect(v.posture).toBe('fallen')
    expect(v.glyph).toBe('collapsed')
    expect(v.prop).toBeNull()
  })

  it('sleep (performing) → lying + 💤', () => {
    const v = describeAgent(
      agent({ action: { kind: 'sleep', reason: 'rest', targetX: 10, targetY: 10 } }),
      100,
    )
    expect(v.posture).toBe('lying')
    expect(v.glyph).toBe('sleep')
    expect(v.prop).toBeNull()
  })

  it('examine (performing) → lean-in + 🔍', () => {
    const v = describeAgent(
      agent({ action: { kind: 'examine', reason: 'look', targetPlaceId: 'farm-0' } }),
      100,
    )
    expect(v.posture).toBe('lean-in')
    expect(v.glyph).toBe('examine')
    expect(v.prop).toBeNull()
  })

  it('eat (performing) → sitting + berry prop', () => {
    const v = describeAgent(agent({ action: { kind: 'eat', reason: 'meal' } }), 100)
    expect(v.posture).toBe('sitting')
    expect(v.glyph).toBeNull()
    expect(v.prop).toBe('berry')
  })

  it('drink (performing) → sitting + mug prop', () => {
    const v = describeAgent(agent({ action: { kind: 'drink', reason: 'well' } }), 100)
    expect(v.posture).toBe('sitting')
    expect(v.prop).toBe('mug')
  })

  it('unknown / unregistered kind → standing / null / null', () => {
    const v = describeAgent(
      agent({ action: { kind: 'propose', reason: 'civic' } }),
      100,
    )
    expect(vis(v)).toBe('standing/none/none')
    const vote = describeAgent(agent({ action: { kind: 'vote', reason: 'yea' } }), 100)
    expect(vote.posture).toBe('standing')
    expect(vote.glyph).toBeNull()
    expect(vote.prop).toBeNull()
  })

  it('glyph priority: collapsed beats critical beats examine', () => {
    const collapsedCritExam = describeAgent(
      agent({
        collapsed: true,
        needs: needs({ hunger: CRITICAL_NEED - 0.01 }),
        action: { kind: 'examine', reason: 'look' },
      }),
      50,
    )
    expect(collapsedCritExam.posture).toBe('fallen')
    expect(collapsedCritExam.glyph).toBe('collapsed')

    const critExam = describeAgent(
      agent({
        needs: needs({ hunger: CRITICAL_NEED - 0.01 }),
        action: { kind: 'examine', reason: 'look' },
      }),
      50,
    )
    expect(critExam.posture).toBe('lean-in')
    expect(critExam.glyph).toBe('hunger')

    const examOnly = describeAgent(
      agent({ action: { kind: 'examine', reason: 'look' } }),
      50,
    )
    expect(examOnly.glyph).toBe('examine')
  })

  it('glyph priority: critical beats sleep; examine beats sleep when both apply via events', () => {
    const sleepyHungry = describeAgent(
      agent({
        needs: needs({ energy: CRITICAL_NEED - 0.02 }),
        action: { kind: 'sleep', reason: 'nap' },
      }),
      10,
    )
    expect(sleepyHungry.posture).toBe('lying')
    expect(sleepyHungry.glyph).toBe('energy')
  })

  it('speech bubble suppression flag nulls the glyph', () => {
    const down = describeAgent(
      agent({ collapsed: true }),
      10,
      { speechActive: true },
    )
    expect(down.posture).toBe('fallen')
    expect(down.glyph).toBeNull()

    const exam = describeAgent(
      agent({ action: { kind: 'examine', reason: 'look' } }),
      10,
      { speechActive: true },
    )
    expect(exam.posture).toBe('lean-in')
    expect(exam.glyph).toBeNull()

    const sleep = describeAgent(
      agent({ action: { kind: 'sleep', reason: 'rest' } }),
      10,
      { speechActive: true },
    )
    expect(sleep.glyph).toBeNull()
  })

  it('traveling examine walks but keeps 🔍; residual examine event leans after complete', () => {
    const walking = describeAgent(
      agent({
        action: {
          kind: 'examine',
          reason: 'going',
          path: [
            [10, 10],
            [12, 12],
          ],
        },
        pathIndex: 0,
      }),
      20,
    )
    expect(walking.posture).toBe('lean-in')
    expect(walking.glyph).toBe('examine')

    const residual = describeAgent(
      agent({ action: { kind: 'idle', reason: 'looked' } }),
      40,
      {
        events: [
          ev({
            tick: 38,
            seq: 9,
            type: 'discovery:examined',
            agentId: 'agent-0',
            data: { target: 'farm-0' },
          }),
        ],
      },
    )
    expect(residual.posture).toBe('lean-in')
    expect(residual.glyph).toBe('examine')

    const residualWhileWalking = describeAgent(
      agent({
        action: {
          kind: 'walk',
          reason: 'off again',
          path: [
            [10, 10],
            [11, 11],
          ],
        },
        pathIndex: 0,
      }),
      40,
      {
        events: [
          ev({
            tick: 38,
            seq: 9,
            type: 'discovery:examined',
            agentId: 'agent-0',
            data: { target: 'farm-0' },
          }),
        ],
      },
    )
    expect(residualWhileWalking.posture).toBe('lean-in')
    expect(residualWhileWalking.glyph).toBe('examine')
  })

  it('describeDestination only while traveling', () => {
    const idle = describeDestination(agent())
    expect(idle).toBeNull()
    const dest = describeDestination(
      agent({
        action: {
          kind: 'walk',
          reason: 'go',
          path: [
            [4, 5],
            [8, 9],
          ],
          targetX: 8,
          targetY: 9,
        },
        pathIndex: 0,
      }),
    )
    expect(dest).toEqual({ x: 8, y: 9 })
  })
})

describe('action language bursts', () => {
  const events: SimEvent[] = [
    ev({ tick: 10, seq: 1, type: 'agent:collapsed', agentId: 'agent-6' }),
    ev({ tick: 12, seq: 2, type: 'agent:recovered', agentId: 'agent-6' }),
    ev({
      tick: 20,
      seq: 3,
      type: 'coins:transfer',
      agentId: 'agent-1',
      data: { from: 'agent-1', to: 'agent-2', amount: 4 },
    }),
    ev({
      tick: 21,
      seq: 4,
      type: 'discovery:examined',
      agentId: 'agent-0',
      data: { target: 'notice-board-0' },
    }),
    ev({ tick: 100, seq: 5, type: 'agent:collapsed', agentId: 'agent-3' }),
  ]

  it('derives bursts only inside the trailing window', () => {
    const at21 = describeBursts(events, 21)
    expect(at21.map((b) => b.kind).sort()).toEqual(['coin-glint', 'shimmer'])
    const at14 = describeBursts(events, 14)
    expect(at14).toHaveLength(1)
    expect(at14[0]).toMatchObject({
      agentId: 'agent-6',
      kind: 'sparkle',
      ageTicks: 2,
      seq: 2,
    })
    const at9 = describeBursts(events, 9)
    expect(at9).toEqual([])
    const stale = describeBursts(events, 21 + BURST_WINDOW + 1)
    expect(stale).toEqual([])
  })

  it('≤1 burst per agent — latest seq wins', () => {
    const both = [
      ev({ tick: 10, seq: 1, type: 'agent:collapsed', agentId: 'a' }),
      ev({ tick: 11, seq: 2, type: 'agent:recovered', agentId: 'a' }),
    ]
    const out = describeBursts(both, 11)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('sparkle')
    expect(out[0]!.seq).toBe(2)
  })

  it('same events + tick → identical descriptors (seq-seeded, no RNG)', () => {
    const a = describeBursts(events, 21)
    const b = describeBursts(events, 21)
    expect(a).toEqual(b)
    expect(a[0]!.seq).toBe(3)
    expect(a.find((x) => x.kind === 'shimmer')?.placeId).toBe('notice-board-0')
    expect(a.find((x) => x.kind === 'coin-glint')?.otherId).toBe('agent-2')
  })

  it('ageTicks is tick - event.tick', () => {
    const out = describeBursts(
      [ev({ tick: 10, seq: 7, type: 'agent:collapsed', agentId: 'agent-6' })],
      13,
    )
    expect(out[0]!.ageTicks).toBe(3)
  })
})

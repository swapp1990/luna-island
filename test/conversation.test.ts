import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import {
  serializeSave,
  restoreSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import { LunaBrainService } from '../src/mind/lunaBrain'
import { MockProvider, type MindPrompt } from '../src/mind/providers'
import { MindDispatchQueue } from '../src/mind/dispatchQueue'
import { episodicMemories } from '../src/mind/memory'
import { parseSayJson } from '../src/mind/parse'
import {
  AGENT_COOLDOWN_TICKS,
  firstSpeakerId,
  MAX_CONVERSATION_TURNS,
  PAIR_COOLDOWN_TICKS,
  TRAILS_OFF,
} from '../src/mind/conversation'
import { LUNA_AGENT_IDS } from '../src/mind/personas'
import { buildReflectionUserPrompt } from '../src/mind/prompt'

/** Force two agents into socialize-standing adjacency for eligibility. */
function forceSocialPair(sim: Simulation, idA: string, idB: string): void {
  const a = sim.state.agents.find((x) => x.id === idA)!
  const b = sim.state.agents.find((x) => x.id === idB)!
  const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
  a.x = plaza.x
  a.y = plaza.y
  b.x = plaza.x + 1
  b.y = plaza.y
  a.action = {
    kind: 'socialize',
    targetPlaceId: plaza.id,
    targetX: plaza.x,
    targetY: plaza.y,
    reason: 'test socialize',
  }
  b.action = {
    kind: 'socialize',
    targetPlaceId: plaza.id,
    targetX: plaza.x + 1,
    targetY: plaza.y,
    reason: 'test socialize',
  }
  a.action.path = undefined
  b.action.path = undefined
  a.pathIndex = 0
  b.pathIndex = 0
}

describe('say record/replay (P3-2)', () => {
  it('scripted sayLog → stateAt/fork hash-identical; save v4 round-trip; v3/v2/v1 load', () => {
    const sim = new Simulation(42)
    const plan: Array<{
      atTick: number
      conversationId: string
      agentId: string
      partnerId: string
      turn: number
      text: string
      done: boolean
    }> = [
      {
        atTick: 40,
        conversationId: 'conv-40-agent-0-agent-1',
        agentId: 'agent-0',
        partnerId: 'agent-1',
        turn: 0,
        text: 'Hello Joss.',
        done: false,
      },
      {
        atTick: 50,
        conversationId: 'conv-40-agent-0-agent-1',
        agentId: 'agent-1',
        partnerId: 'agent-0',
        turn: 1,
        text: 'Hey Mira — good to see you.',
        done: true,
      },
    ]
    let pi = 0
    const target = 200
    for (let t = 0; t < target; t++) {
      const next = plan[pi]
      if (next && sim.state.tick === next.atTick) {
        sim.postSay(
          next.conversationId,
          next.agentId,
          next.partnerId,
          next.turn,
          next.text,
          next.done,
        )
        pi++
      }
      sim.advanceTicks(1)
    }

    expect(sim.state.sayLog.length).toBe(2)
    const says = sim.getEvents().filter((e) => e.type === 'mind:say')
    expect(says.length).toBe(2)
    expect(says[0]!.data?.text).toBe('Hello Joss.')
    expect(says[0]!.reason).toBeUndefined()

    const liveHash = sim.hash()
    expect(sim.stateAt(target).hash()).toBe(liveHash)
    expect(sim.stateAt(100).hash()).toBe(
      (() => {
        const fresh = new Simulation(42)
        let p = 0
        for (let t = 0; t < 100; t++) {
          const next = plan[p]
          if (next && fresh.state.tick === next.atTick) {
            fresh.postSay(
              next.conversationId,
              next.agentId,
              next.partnerId,
              next.turn,
              next.text,
              next.done,
            )
            p++
          }
          fresh.advanceTicks(1)
        }
        return fresh.hash()
      })(),
    )

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(4)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(save.snapshot.state.sayLog.length).toBe(2)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(liveHash)
    expect(restored.state.sayLog).toEqual(sim.state.sayLog)

    // v3 load (no sayLog) upgrades
    const strip = (s: (typeof save.snapshot)) => ({
      ...s,
      state: {
        ...s.state,
        sayLog: undefined as unknown as [],
      },
    })
    const v3 = {
      ...save,
      formatVersion: 3,
      snapshot: strip(save.snapshot),
      pinnedDayStartSnapshots: save.pinnedDayStartSnapshots.map(strip),
      fineSnapshotRing: save.fineSnapshotRing.map(strip),
    }
    const fromV3 = restoreSave(v3)
    expect(fromV3.state.sayLog).toEqual([])
    expect(fromV3.state.tick).toBe(sim.state.tick)

    // v2 / v1 still load
    for (const ver of [2, 1] as const) {
      const older = {
        ...save,
        formatVersion: ver,
        snapshot: {
          ...save.snapshot,
          state: {
            ...save.snapshot.state,
            externalIntentLog: ver === 1 ? undefined : save.snapshot.state.externalIntentLog,
            mindNoteLog: undefined,
            sayLog: undefined,
            mindStats: ver === 1 ? undefined : save.snapshot.state.mindStats,
          },
        },
      }
      const r = restoreSave(older)
      expect(r.state.sayLog).toEqual([])
      expect(r.state.mindNoteLog).toEqual([])
    }
  })
})

describe('conversation lifecycle (P3-2)', () => {
  it('eligibility → alternating turns → done; each utterance = one dispatch', async () => {
    const mind = new LunaBrainService('mock')
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(30)
    forceSocialPair(sim, 'agent-0', 'agent-1')

    // Keep them socializing while conversation runs (force after step so eligibility holds)
    let turns = 0
    for (let i = 0; i < 80 && turns < 8; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
      turns = sim.getEvents().filter((e) => e.type === 'mind:say').length
    }

    const says = sim.getEvents().filter((e) => e.type === 'mind:say')
    expect(says.length).toBeGreaterThanOrEqual(1)
    // Per-conversation turn cap
    const byConv = new Map<string, typeof says>()
    for (const s of says) {
      const id = String(s.data?.conversationId ?? '')
      const list = byConv.get(id) ?? []
      list.push(s)
      byConv.set(id, list)
    }
    for (const list of byConv.values()) {
      expect(list.length).toBeLessThanOrEqual(MAX_CONVERSATION_TURNS)
      // Alternating speakers within a conversation
      if (list.length >= 2) {
        expect(list[0]!.agentId).not.toBe(list[1]!.agentId)
      }
      expect(list[list.length - 1]!.data?.done).toBe(true)
    }
    // Conversation ended
    expect(mind.getActiveConversation()).toBeNull()

    // Each utterance was one dispatch (decideCalls include decisions + says)
    const convCalls = mind.getDecideCallCount()
    expect(convCalls).toBeGreaterThanOrEqual(says.length)
  })

  it('pair + per-agent cooldowns respected; max-one-active enforced', async () => {
    const mind = new LunaBrainService('mock')
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(10)
    forceSocialPair(sim, 'agent-0', 'agent-1')

    for (let i = 0; i < 100; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
      if (mind.getActiveConversation() === null && sim.state.sayLog.length > 0) break
    }
    // Drain mock holds + inbox so the closing say is applied before cooldown asserts
    for (let i = 0; i < 10; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    expect(sim.state.sayLog.length).toBeGreaterThan(0)
    expect(mind.getActiveConversation()).toBeNull()
    const pairSays = () =>
      sim.state.sayLog.filter(
        (s) =>
          (s.agentId === 'agent-0' && s.partnerId === 'agent-1') ||
          (s.agentId === 'agent-1' && s.partnerId === 'agent-0'),
      )
    const afterFirst = pairSays().length
    const convIds = new Set(pairSays().map((s) => s.conversationId))
    expect(convIds.size).toBe(1)

    // Immediately re-eligible geometrically, but cooldown should block same pair
    for (let i = 0; i < 20; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
    }
    expect(new Set(pairSays().map((s) => s.conversationId)).size).toBe(1)
    expect(pairSays().length).toBe(afterFirst)

    // Advance past agent cooldown but not pair cooldown — still blocked for same pair
    sim.advanceTicks(AGENT_COOLDOWN_TICKS + 5)
    for (let i = 0; i < 15; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
    }
    expect(new Set(pairSays().map((s) => s.conversationId)).size).toBe(1)

    // Past pair cooldown — can talk again
    sim.advanceTicks(PAIR_COOLDOWN_TICKS)
    for (let i = 0; i < 80; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
    }
    expect(new Set(pairSays().map((s) => s.conversationId)).size).toBeGreaterThan(1)
  })

  it('interruption ends cleanly; invalid JSON trails off without fallback', async () => {
    const provider = new MockProvider()
    const orig = provider.decideSync.bind(provider)
    provider.decideSync = (prompt: MindPrompt) => {
      if (prompt.kind === 'conversation') {
        return { text: '%%%', latencyMs: 1, approxChars: 10 }
      }
      return orig(prompt)
    }

    const mind = new LunaBrainService('mock', { provider })
    await mind.init()
    const sim = new Simulation(7)
    sim.advanceTicks(5)
    forceSocialPair(sim, 'agent-0', 'agent-1')
    for (let i = 0; i < 40; i++) {
      sim.advanceTicks(1)
      forceSocialPair(sim, 'agent-0', 'agent-1')
      mind.onAfterTick(sim)
    }
    const says = sim.getEvents().filter((e) => e.type === 'mind:say')
    expect(says.length).toBeGreaterThanOrEqual(1)
    expect(says.some((e) => e.data?.text === TRAILS_OFF)).toBe(true)
    expect(sim.getEvents().filter((e) => e.type === 'mind:fallback').length).toBe(0)
    expect(mind.getActiveConversation()).toBeNull()

    // Interruption path: start real conversation then walk away
    const mind2 = new LunaBrainService('mock')
    await mind2.init()
    const sim2 = new Simulation(11)
    sim2.advanceTicks(5)
    for (let i = 0; i < 25; i++) {
      sim2.advanceTicks(1)
      forceSocialPair(sim2, 'agent-0', 'agent-1')
      mind2.onAfterTick(sim2)
      if (mind2.getActiveConversation()) break
    }
    expect(mind2.getActiveConversation()).not.toBeNull()
    // Force interrupt (walking = not stationary socialize)
    const a0 = sim2.state.agents.find((a) => a.id === 'agent-0')!
    a0.action = {
      kind: 'forage',
      targetX: a0.x + 5,
      targetY: a0.y,
      path: [
        [a0.x + 1, a0.y],
        [a0.x + 2, a0.y],
      ],
      reason: 'urgent berries',
    }
    a0.pathIndex = 0
    mind2.onAfterTick(sim2)
    expect(mind2.getActiveConversation()).toBeNull()
  })

  it('decisions outrank conversation turns in the queue', () => {
    const q = new MindDispatchQueue(6)
    q.enqueue({
      agentId: 'a',
      kind: 'conversation',
      conversationId: 'c',
      partnerId: 'b',
      turn: 0,
    })
    q.enqueue({ agentId: 'b', kind: 'reflection', nightKey: 1 })
    q.enqueue({ agentId: 'c', kind: 'decision' })
    expect(q.list().map((e) => e.kind)).toEqual([
      'decision',
      'conversation',
      'reflection',
    ])
  })

  it('first speaker is lower sympathy', () => {
    const sim = new Simulation(1)
    const a = sim.state.agents.find((x) => x.id === 'agent-0')!
    const b = sim.state.agents.find((x) => x.id === 'agent-1')!
    a.sympathy = { 'agent-1': 0.1 }
    b.sympathy = { 'agent-0': 0.5 }
    expect(firstSpeakerId(a, b)).toBe('agent-0')
    a.sympathy = { 'agent-1': 0.8 }
    b.sympathy = { 'agent-0': 0.2 }
    expect(firstSpeakerId(a, b)).toBe('agent-1')
  })

  it('parseSayJson contract', () => {
    expect(parseSayJson('{"say":"Hi there","done":false}').ok).toBe(true)
    expect(parseSayJson('nope').ok).toBe(false)
    expect(parseSayJson('{"say":"' + 'x'.repeat(141) + '","done":true}').ok).toBe(
      false,
    )
  })
})

describe('episodic derivation from conversation (P3-2)', () => {
  it('conversation end yields one 💬 memory line per participant', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(20)
    sim.postSay('conv-1', 'agent-0', 'agent-1', 0, 'Nice day at the plaza.', false)
    sim.advanceTicks(1)
    sim.postSay(
      'conv-1',
      'agent-1',
      'agent-0',
      1,
      'Sure is — glad we talked.',
      true,
    )
    sim.advanceTicks(1)

    const ep0 = episodicMemories('agent-0', sim.getEvents())
    const ep1 = episodicMemories('agent-1', sim.getEvents())
    const line0 = ep0.find((m) => m.text.includes('talked with'))
    const line1 = ep1.find((m) => m.text.includes('talked with'))
    expect(line0?.text).toMatch(/^💬 D\d+ \d{2}:\d{2} — talked with Joss:/)
    expect(line1?.text).toMatch(/^💬 D\d+ \d{2}:\d{2} — talked with Mira:/)
    expect(line0?.text).toContain('Sure is')
    expect(line1?.text).toContain('Sure is')

    // Reflection prompt includes mind:say lines
    const reflect = buildReflectionUserPrompt(
      'agent-0',
      sim.getEvents(),
      1,
    )
    expect(reflect).toContain('💬')
    expect(reflect).toMatch(/said|I said/)
  })
})

describe('luna count', () => {
  it('six minds', () => {
    expect(LUNA_AGENT_IDS.length).toBe(6)
  })
})

describe('ticker mind rows (P3-2)', () => {
  it('buildTickerRows renders 💭 reflections and 💬 conversation starts', async () => {
    const { buildTickerRows } = await import('../src/ui/Ticker')
    const rows = buildTickerRows(
      [
        {
          seq: 1,
          tick: 100,
          type: 'mind:reflection',
          agentId: 'agent-0',
          data: { agentName: 'Mira' },
          reason: 'Mira reflected on the day',
        },
        {
          seq: 2,
          tick: 200,
          type: 'mind:say',
          agentId: 'agent-0',
          data: {
            turn: 0,
            agentName: 'Mira',
            partnerName: 'Joss',
            text: 'Hello',
            conversationId: 'c1',
          },
        },
      ],
      500,
      0,
    )
    expect(rows.some((r) => r.text.includes('💭') && r.text.includes('reflected'))).toBe(
      true,
    )
    expect(rows.some((r) => r.text.includes('💬') && r.text.includes('are talking'))).toBe(
      true,
    )
  })
})

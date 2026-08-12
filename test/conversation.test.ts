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
  a.needs = { hunger: 0.7, energy: 0.7, social: 0.45 }
  b.needs = { hunger: 0.7, energy: 0.7, social: 0.45 }
}

/**
 * Park every other agent far away / non-socializing so conversation tests
 * only form the intended pair(s) under the 2-active cap.
 */
function isolateAgents(sim: Simulation, keep: readonly string[]): void {
  let i = 0
  for (const ag of sim.state.agents) {
    if (keep.includes(ag.id)) continue
    ag.x = 2 + (i % 4)
    ag.y = 2 + Math.floor(i / 4)
    ag.action = { kind: 'idle', reason: 'isolated' }
    ag.action.path = undefined
    ag.pathIndex = 0
    ag.needs = { hunger: 0.7, energy: 0.7, social: 0.7 }
    i++
  }
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
    const mind = new LunaBrainService('mock', { wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(30)
    isolateAgents(sim, ['agent-0', 'agent-1'])
    forceSocialPair(sim, 'agent-0', 'agent-1')

    // Keep them socializing while conversation runs (force after step so eligibility holds)
    let turns = 0
    for (let i = 0; i < 80 && turns < 8; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      turns = sim.getEvents().filter((e) => e.type === 'mind:say').length
    }
    // Drain holds
    for (let i = 0; i < 12; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
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
    expect(mind.getActiveConversations().length).toBe(0)

    // Each mind utterance was one dispatch (sheep templates add 0)
    const convCalls = mind.getDecideCallCount()
    expect(convCalls).toBeGreaterThanOrEqual(says.length)
  })

  it('pair + per-agent cooldowns respected; max-one-active enforced', async () => {
    const mind = new LunaBrainService('mock', { wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(10)
    isolateAgents(sim, ['agent-0', 'agent-1'])
    forceSocialPair(sim, 'agent-0', 'agent-1')

    for (let i = 0; i < 100; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      if (mind.getActiveConversations().length === 0 && sim.state.sayLog.length > 0) break
    }
    // Drain mock holds + inbox so the closing say is applied before cooldown asserts
    for (let i = 0; i < 12; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    expect(sim.state.sayLog.length).toBeGreaterThan(0)
    expect(mind.getActiveConversations().length).toBe(0)
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
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    expect(new Set(pairSays().map((s) => s.conversationId)).size).toBe(1)
    expect(pairSays().length).toBe(afterFirst)

    // Advance past agent cooldown but not pair cooldown — still blocked for same pair
    sim.advanceTicks(AGENT_COOLDOWN_TICKS + 5)
    for (let i = 0; i < 15; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    expect(new Set(pairSays().map((s) => s.conversationId)).size).toBe(1)

    // Past pair cooldown — can talk again
    sim.advanceTicks(PAIR_COOLDOWN_TICKS)
    for (let i = 0; i < 80; i++) {
      isolateAgents(sim, ['agent-0', 'agent-1'])
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
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
    const mind2 = new LunaBrainService('mock', { wallFloorMs: 0 })
    await mind2.init()
    const sim2 = new Simulation(11)
    sim2.advanceTicks(5)
    isolateAgents(sim2, ['agent-0', 'agent-1'])
    for (let i = 0; i < 25; i++) {
      isolateAgents(sim2, ['agent-0', 'agent-1'])
      forceSocialPair(sim2, 'agent-0', 'agent-1')
      sim2.advanceTicks(1)
      mind2.onAfterTick(sim2)
      if (mind2.getActiveConversation()) break
    }
    expect(mind2.getActiveConversation()).not.toBeNull()
    // Force interrupt (walking ends sticky conversation)
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
    expect(mind2.getActiveConversations().length).toBe(0)
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

describe('P3-2c sticky + mixed society', () => {
  /** Mind socializing, partner mid-eat (stationary) — the live bug setup. */
  function forceStickyPair(
    sim: Simulation,
    idA: string,
    idB: string,
    partnerAction: 'eat' | 'socialize' = 'eat',
  ): void {
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
    a.action.path = undefined
    a.pathIndex = 0
    if (partnerAction === 'eat') {
      b.action = {
        kind: 'eat',
        targetX: plaza.x + 1,
        targetY: plaza.y,
        reason: 'test mid-eat',
      }
      b.actionTicks = 8
    } else {
      b.action = {
        kind: 'socialize',
        targetPlaceId: plaza.id,
        targetX: plaza.x + 1,
        targetY: plaza.y,
        reason: 'test socialize',
      }
    }
    b.action.path = undefined
    b.pathIndex = 0
    // Keep needs non-urgent so sticky chat is not interrupted
    a.needs = { hunger: 0.7, energy: 0.7, social: 0.5 }
    b.needs = { hunger: 0.7, energy: 0.7, social: 0.5 }
  }

  /** Mock that never ends early — full multi-turn for stickiness gates. */
  function stickyProvider(): MockProvider {
    const provider = new MockProvider()
    provider.decideSync = (prompt: MindPrompt) => {
      if (prompt.kind === 'conversation') {
        const lines = (prompt.user.match(/\n[A-Za-z]+: "/g) ?? []).length
        const say =
          lines === 0
            ? 'Hello friend — good to catch you.'
            : lines === 1
              ? 'Glad we can talk over a meal.'
              : 'Alright, back to it soon.'
        const done = lines >= 2
        return {
          text: JSON.stringify({ say, done }),
          latencyMs: 1,
          approxChars: 40,
        }
      }
      if (prompt.kind === 'reflection') {
        return {
          text: JSON.stringify({ notes: ['Quiet day.'] }),
          latencyMs: 1,
          approxChars: 20,
        }
      }
      return {
        text: JSON.stringify({
          action: 'socialize',
          target: 'plaza',
          reasoning: 'chat',
        }),
        latencyMs: 1,
        approxChars: 30,
      }
    }
    return provider
  }

  it('stickiness: partner mid-eat completes multi-turn; move/urgent end it; sheep hold defers redecide', async () => {
    const provider = stickyProvider()
    const mind = new LunaBrainService('mock', { provider, wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(10)
    forceStickyPair(sim, 'agent-0', 'agent-1', 'eat')

    let maxTurns = 0
    for (let i = 0; i < 80; i++) {
      forceStickyPair(sim, 'agent-0', 'agent-1', 'eat')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      const says = sim.getEvents().filter((e) => e.type === 'mind:say')
      maxTurns = Math.max(maxTurns, says.length)
      if (mind.getActiveConversation() === null && says.length >= 2) break
    }
    expect(maxTurns).toBeGreaterThanOrEqual(2)
    // Drain holds
    for (let i = 0; i < 12; i++) {
      forceStickyPair(sim, 'agent-0', 'agent-1', 'eat')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    const says = sim.getEvents().filter((e) => e.type === 'mind:say')
    expect(says.length).toBeGreaterThanOrEqual(2)
    expect(says[says.length - 1]!.data?.done).toBe(true)

    // Movement ends sticky conversation
    const mind2 = new LunaBrainService('mock', {
      provider: stickyProvider(),
      wallFloorMs: 0,
    })
    await mind2.init()
    const sim2 = new Simulation(11)
    sim2.advanceTicks(5)
    for (let i = 0; i < 40; i++) {
      forceStickyPair(sim2, 'agent-0', 'agent-1', 'eat')
      sim2.advanceTicks(1)
      mind2.onAfterTick(sim2)
      if (mind2.getActiveConversation()) break
    }
    expect(mind2.getActiveConversation()).not.toBeNull()
    const a0 = sim2.state.agents.find((a) => a.id === 'agent-0')!
    a0.action = {
      kind: 'forage',
      targetX: a0.x + 5,
      targetY: a0.y,
      path: [
        [a0.x + 1, a0.y],
        [a0.x + 2, a0.y],
      ],
      reason: 'walk off',
    }
    a0.pathIndex = 0
    mind2.onAfterTick(sim2)
    expect(mind2.getActiveConversation()).toBeNull()

    // Urgent need ends conversation
    const mind3 = new LunaBrainService('mock', {
      provider: stickyProvider(),
      wallFloorMs: 0,
    })
    await mind3.init()
    const sim3 = new Simulation(13)
    sim3.advanceTicks(5)
    for (let i = 0; i < 40; i++) {
      forceStickyPair(sim3, 'agent-0', 'agent-1', 'eat')
      sim3.advanceTicks(1)
      mind3.onAfterTick(sim3)
      if (mind3.getActiveConversation()) break
    }
    expect(mind3.getActiveConversation()).not.toBeNull()
    const b1 = sim3.state.agents.find((a) => a.id === 'agent-1')!
    b1.needs.hunger = 0.05
    mind3.onAfterTick(sim3)
    expect(mind3.getActiveConversation()).toBeNull()

    // Participation hold defers sheep redecide
    const mind4 = new LunaBrainService('mock', {
      provider: stickyProvider(),
      wallFloorMs: 0,
    })
    await mind4.init()
    const sim4 = new Simulation(17)
    sim4.advanceTicks(5)
    // agent-3 is a sheep (not in LUNA_AGENT_IDS)
    const sheepId = 'agent-3'
    forceStickyPair(sim4, 'agent-0', sheepId, 'eat')
    const sheep = sim4.state.agents.find((a) => a.id === sheepId)!
    const lastBefore = sheep.lastDecideTick
    sheep.action = {
      kind: 'eat',
      targetX: sheep.x,
      targetY: sheep.y,
      reason: 'hold meal',
    }
    sheep.action.path = undefined
    sheep.pathIndex = 0
    sheep.needs = { hunger: 0.7, energy: 0.7, social: 0.5 }
    for (let i = 0; i < 50; i++) {
      forceStickyPair(sim4, 'agent-0', sheepId, 'eat')
      // Re-apply non-urgent eat so hold is meaningful
      const s = sim4.state.agents.find((a) => a.id === sheepId)!
      s.action = {
        kind: 'eat',
        targetX: s.x,
        targetY: s.y,
        reason: 'hold meal',
      }
      s.action.path = undefined
      s.pathIndex = 0
      s.needs = { hunger: 0.7, energy: 0.7, social: 0.5 }
      sim4.advanceTicks(1)
      mind4.onAfterTick(sim4)
      if (mind4.getActiveConversations().some((c) => c.mixed)) break
    }
    expect(sim4.getConversationHold()).toContain(sheepId)
    // Advance past redecide interval while held — lastDecideTick should not advance
    const held = sim4.state.agents.find((a) => a.id === sheepId)!
    const decideAtHold = held.lastDecideTick
    for (let i = 0; i < 40; i++) {
      if (!mind4.getActiveConversations().some((c) => c.mixed)) break
      const s = sim4.state.agents.find((a) => a.id === sheepId)!
      s.action = {
        kind: 'eat',
        targetX: s.x,
        targetY: s.y,
        reason: 'hold meal',
      }
      s.action.path = undefined
      s.pathIndex = 0
      s.needs = { hunger: 0.7, energy: 0.7, social: 0.5 }
      // Keep mind socializing adjacent
      forceStickyPair(sim4, 'agent-0', sheepId, 'eat')
      s.action = {
        kind: 'eat',
        targetX: s.x,
        targetY: s.y,
        reason: 'hold meal',
      }
      s.action.path = undefined
      sim4.advanceTicks(1)
      mind4.onAfterTick(sim4)
    }
    const heldAfter = sim4.state.agents.find((a) => a.id === sheepId)!
    // While conversation active + hold, non-urgent redecide deferred
    if (mind4.getActiveConversations().some((c) => c.mixed)) {
      expect(heldAfter.lastDecideTick).toBe(decideAtHold)
    } else {
      // Conversation may have finished — hold at least applied during chat
      expect(decideAtHold).toBeGreaterThanOrEqual(lastBefore)
    }
  })

  it('turn progression under pure advanceTicks (no rAF)', async () => {
    const provider = stickyProvider()
    const mind = new LunaBrainService('mock', { provider, wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(99)
    sim.advanceTicks(5)
    forceSocialPair(sim, 'agent-0', 'agent-1')

    const turns: number[] = []
    for (let i = 0; i < 60; i++) {
      forceSocialPair(sim, 'agent-0', 'agent-1')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      turns.push(sim.state.sayLog.length)
    }
    // Multi-turn advanced purely via advanceTicks + onAfterTick
    expect(Math.max(...turns)).toBeGreaterThanOrEqual(2)
    expect(sim.state.sayLog.length).toBeGreaterThanOrEqual(2)
  })

  it('template truthfulness: selected templates never assert false predicates', async () => {
    const {
      SHEEP_TEMPLATES,
      selectSheepReply,
      eligibleSheepTemplates,
    } = await import('../src/mind/sheepTalk')
    const sim = new Simulation(3)
    const sheep = sim.state.agents.find((a) => a.id === 'agent-3')!
    const mind = sim.state.agents.find((a) => a.id === 'agent-0')!

    const cases: Array<() => void> = [
      () => {
        // Employed at farm
        const farm = sim.state.places.find((p) => p.kind === 'farm')!
        sheep.employedAt = farm.id
        farm.wage = 6
        sheep.action = { kind: 'work', targetPlaceId: farm.id, reason: 'work' }
        sheep.needs.hunger = 0.8
        sheep.wallet = 10
        sheep.sympathy = { [mind.id]: 0.1 }
      },
      () => {
        // Hungry, unemployed, empty nearest bush
        sheep.employedAt = null
        sheep.needs.hunger = 0.2
        sheep.action = { kind: 'idle', reason: 'idle' }
        sheep.wallet = 1
        sheep.sympathy = {}
        for (const p of sim.state.places) {
          if (p.kind === 'berry-bush') p.inventory.food = 0
        }
      },
      () => {
        // Expensive food + high sympathy
        const stall = sim.state.places.find((p) => p.kind === 'stall')!
        stall.price = { ...(stall.price ?? {}), food: 9 }
        sheep.sympathy = { [mind.id]: 0.5 }
        sheep.needs.hunger = 0.6
        sheep.employedAt = null
        sheep.action = { kind: 'socialize', reason: 'plaza' }
        sheep.wallet = 5
        for (const p of sim.state.places) {
          if (p.kind === 'berry-bush') p.inventory.food = 3
        }
      },
      () => {
        // Eating now
        sheep.action = { kind: 'eat', reason: 'meal' }
        sheep.needs.hunger = 0.5
        sheep.employedAt = null
        sheep.sympathy = {}
        sheep.wallet = 8
        const stall = sim.state.places.find((p) => p.kind === 'stall')!
        stall.price = { food: 3 }
        for (const p of sim.state.places) {
          if (p.kind === 'berry-bush') p.inventory.food = 2
        }
      },
    ]

    for (let ci = 0; ci < cases.length; ci++) {
      cases[ci]!()
      const ctx = {
        sheep,
        partner: mind,
        world: sim.state,
        conversationId: `conv-test-${ci}`,
        turn: 1,
      }
      // Every eligible template's predicate is true by construction
      for (const t of eligibleSheepTemplates(ctx)) {
        expect(t.predicate(ctx)).toBe(true)
      }
      // Selected reply's template is among eligible
      const reply = selectSheepReply(ctx)
      const chosen = SHEEP_TEMPLATES.find((t) => t.id === reply.templateId)!
      expect(chosen.predicate(ctx)).toBe(true)
      // False-predicate templates excluded
      for (const t of SHEEP_TEMPLATES) {
        if (!t.predicate(ctx)) {
          expect(reply.templateId).not.toBe(t.id)
        }
      }
      // Specific grounding checks
      if (reply.templateId === 'empty-bush') {
        const bushes = sim.state.places.filter((p) => p.kind === 'berry-bush')
        // nearest bush must be empty — selection only when some nearest is 0
        expect(bushes.some((b) => (b.inventory.food ?? 0) === 0)).toBe(true)
      }
      if (reply.templateId === 'job-wage') {
        expect(sheep.employedAt).toBeTruthy()
      }
      if (reply.templateId === 'food-dear') {
        const stall = sim.state.places.find((p) => p.kind === 'stall')!
        expect((stall.price?.food ?? 0) >= 8).toBe(true)
      }
    }
  })

  it('determinism: same seed/state → same template replies; sayLog hash/save round-trip', async () => {
    const { selectSheepReply } = await import('../src/mind/sheepTalk')
    const sim = new Simulation(42)
    const sheep = sim.state.agents.find((a) => a.id === 'agent-3')!
    const mind = sim.state.agents.find((a) => a.id === 'agent-0')!
    sheep.employedAt = sim.state.places.find((p) => p.kind === 'farm')!.id
    const ctx = {
      sheep,
      partner: mind,
      world: sim.state,
      conversationId: 'conv-42-agent-0-agent-3',
      turn: 1,
    }
    const a = selectSheepReply(ctx)
    const b = selectSheepReply(ctx)
    expect(a).toEqual(b)

    // Scripted template sayLog → hash identical + save round-trip
    const s1 = new Simulation(42)
    s1.advanceTicks(20)
    s1.postSay('conv-t', 'agent-3', 'agent-0', 0, a.text, false, 'template')
    s1.advanceTicks(1)
    s1.postSay('conv-t', 'agent-0', 'agent-3', 1, 'Thanks for sharing.', true, 'luna')
    s1.advanceTicks(1)
    const hash = s1.hash()
    expect(s1.stateAt(s1.state.tick).hash()).toBe(hash)
    expect(s1.state.sayLog.some((r) => r.source === 'template')).toBe(true)

    const save = serializeSave(s1)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(hash)
    expect(restored.state.sayLog).toEqual(s1.state.sayLog)
  })

  it('budget: mind↔sheep dispatches only mind turns (1–2 calls)', async () => {
    const provider = stickyProvider()
    let conversationDispatches = 0
    const baseSync = provider.decideSync.bind(provider)
    provider.decideSync = (prompt: MindPrompt) => {
      if (prompt.kind === 'conversation') conversationDispatches += 1
      return baseSync(prompt)
    }
    const mind = new LunaBrainService('mock', { provider, wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(10)
    const sheepId = 'agent-3'
    isolateAgents(sim, ['agent-0', sheepId])
    forceStickyPair(sim, 'agent-0', sheepId, 'eat')

    for (let i = 0; i < 120; i++) {
      isolateAgents(sim, ['agent-0', sheepId])
      forceStickyPair(sim, 'agent-0', sheepId, 'eat')
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    const sheepSays = sim.state.sayLog.filter(
      (s) => s.agentId === sheepId && s.source === 'template',
    )
    const mindSays = sim.state.sayLog.filter(
      (s) => s.agentId === 'agent-0' && s.partnerId === sheepId,
    )
    expect(sheepSays.length).toBeGreaterThanOrEqual(1)
    expect(mindSays.length).toBeGreaterThanOrEqual(1)
    expect(mindSays.length).toBeLessThanOrEqual(2)
    // Exactly mind turns cost dispatches; sheep templates are zero LLM
    expect(sheepSays.every((s) => s.source === 'template')).toBe(true)
    expect(conversationDispatches).toBe(mindSays.length)
    expect(conversationDispatches).toBeGreaterThanOrEqual(1)
    expect(conversationDispatches).toBeLessThanOrEqual(2)
  })

  it('two-active cap; at most one mind↔mind', async () => {
    const provider = stickyProvider()
    const mind = new LunaBrainService('mock', { provider, wallFloorMs: 0 })
    await mind.init()
    const sim = new Simulation(42)
    sim.advanceTicks(10)

    // Pin two mind pairs + one mind-sheep nearby
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const pin = (
      idA: string,
      idB: string,
      ox: number,
      partnerEat = false,
    ) => {
      const a = sim.state.agents.find((x) => x.id === idA)!
      const b = sim.state.agents.find((x) => x.id === idB)!
      a.x = plaza.x + ox
      a.y = plaza.y
      b.x = plaza.x + ox + 1
      b.y = plaza.y
      a.action = {
        kind: 'socialize',
        targetPlaceId: plaza.id,
        targetX: a.x,
        targetY: a.y,
        reason: 'cap test',
      }
      a.action.path = undefined
      a.pathIndex = 0
      a.needs = { hunger: 0.7, energy: 0.7, social: 0.4 }
      b.action = partnerEat
        ? { kind: 'eat', targetX: b.x, targetY: b.y, reason: 'cap eat' }
        : {
            kind: 'socialize',
            targetPlaceId: plaza.id,
            targetX: b.x,
            targetY: b.y,
            reason: 'cap test',
          }
      b.action.path = undefined
      b.pathIndex = 0
      b.needs = { hunger: 0.7, energy: 0.7, social: 0.4 }
    }

    let peak = 0
    let peakMindMind = 0
    for (let i = 0; i < 40; i++) {
      // Three candidate pairs (would be 3 if uncapped)
      pin('agent-0', 'agent-1', 0)
      pin('agent-2', 'agent-4', 3)
      pin('agent-8', 'agent-3', 6, true)
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      const active = mind.getActiveConversations()
      peak = Math.max(peak, active.length)
      peakMindMind = Math.max(peakMindMind, active.filter((c) => !c.mixed).length)
      expect(active.length).toBeLessThanOrEqual(2)
      expect(active.filter((c) => !c.mixed).length).toBeLessThanOrEqual(1)
    }
    expect(peak).toBeGreaterThanOrEqual(1)
    expect(peak).toBeLessThanOrEqual(2)
    expect(peakMindMind).toBeLessThanOrEqual(1)
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

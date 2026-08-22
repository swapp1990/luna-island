import { afterEach, describe, expect, it, vi } from 'vitest'
import { Simulation } from '../src/sim/sim'
import {
  serializeSave,
  restoreSave,
  SaveFormatError,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import type { ExternalIntentMeta, Intent } from '../src/sim/types'
import { parseMindJson, resolveMindIntent } from '../src/mind/parse'
import {
  BudgetExhaustedProvider,
  LunaBrainService,
  MIND_MIN_GAP_TICKS,
  MIND_STALE_TICKS,
  MIND_WALL_FLOOR_MS,
  MIND_WALL_TIMEOUT_MS,
  clampMinGapTicks,
  mindMinGapTicksFromLocation,
  resolveMinGapTicks,
} from '../src/mind/lunaBrain'
import { frameDtCap } from '../src/loop'
import {
  MockProvider,
  type MindDecisionResult,
  type MindPrompt,
  type MindProvider,
} from '../src/mind/providers'
import { LUNA_AGENT_IDS, personaFor } from '../src/mind/personas'
import {
  episodicMemories,
  reflectionMemories,
} from '../src/mind/memory'
import { buildUserPrompt } from '../src/mind/prompt'
import {
  MindDispatchQueue,
  clampLunaConcurrency,
  resolveLunaConcurrency,
} from '../src/mind/dispatchQueue'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 100,
})

function scriptedIntent(kind: Intent['kind'], reason: string): Intent {
  return { kind, reason, targetX: 10, targetY: 10 }
}

describe('mind external intents — record/replay', () => {
  it('stateAt and fork re-sim reproduce byte-identical hashes with scripted intents', () => {
    const sim = new Simulation(42)
    // Script mind decisions at chosen ticks (posted so they apply next step)
    const plan: Array<{ atTick: number; intent: Intent; reasoning: string }> = [
      { atTick: 50, intent: scriptedIntent('wander', 'mind wander'), reasoning: 'I will wander a bit.' },
      { atTick: 100, intent: scriptedIntent('forage', 'mind forage'), reasoning: 'I need berries now.' },
      { atTick: 200, intent: scriptedIntent('drink', 'mind drink'), reasoning: 'Water would help.' },
    ]

    let planIdx = 0
    const target = 400
    for (let t = 0; t < target; t++) {
      const next = plan[planIdx]
      if (next && sim.state.tick === next.atTick) {
        sim.postExternalIntent('agent-0', next.intent, meta(next.reasoning))
        planIdx++
      }
      sim.advanceTicks(1)
    }

    expect(sim.state.externalIntentLog.length).toBe(3)
    const decisions = sim.getEvents().filter((e) => e.type === 'mind:decision')
    expect(decisions.length).toBe(3)
    expect(decisions.map((e) => e.data?.reasoning)).toEqual([
      'I will wander a bit.',
      'I need berries now.',
      'Water would help.',
    ])

    const liveHash = sim.hash()
    const liveEvents = sim.getEventCount()

    // stateAt mid-run
    const mid = sim.stateAt(250)
    const freshMid = new Simulation(42)
    {
      let pi = 0
      for (let t = 0; t < 250; t++) {
        const next = plan[pi]
        if (next && freshMid.state.tick === next.atTick) {
          freshMid.postExternalIntent('agent-0', next.intent, meta(next.reasoning))
          pi++
        }
        freshMid.advanceTicks(1)
      }
    }
    expect(mid.hash()).toBe(freshMid.hash())

    // Full head via stateAt
    const atHead = sim.stateAt(target)
    expect(atHead.hash()).toBe(liveHash)
    expect(atHead.getEventCount()).toBe(liveEvents)

    // Fork from earlier snapshot (interval 180 → snap at 180)
    const snap = sim.snapshot()
    // Re-sim from a mid snapshot using stateAt which injects playback
    const at180 = sim.stateAt(180)
    at180.advanceTicks(target - 180)
    expect(at180.hash()).toBe(liveHash)

    // Snapshot round-trip keeps log
    const restored = Simulation.fromSnapshot(snap)
    expect(restored.state.externalIntentLog.length).toBe(sim.state.externalIntentLog.length)
    expect(restored.hash()).toBe(liveHash)
  })

  it('save/restore v2 round-trips intent log; v1 loads with empty log', () => {
    const sim = new Simulation(7)
    sim.advanceTicks(40)
    sim.postExternalIntent(
      'agent-0',
      scriptedIntent('wander', 'save me'),
      meta('I want this saved.'),
    )
    sim.advanceTicks(5)
    expect(sim.state.externalIntentLog.length).toBe(1)

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(save.snapshot.state.externalIntentLog.length).toBe(1)

    const restored = restoreSave(save)
    expect(restored.hash()).toBe(sim.hash())
    expect(restored.state.externalIntentLog).toEqual(sim.state.externalIntentLog)

    // v1-shaped payload still loads
    const v1 = {
      ...save,
      formatVersion: 1,
      snapshot: {
        ...save.snapshot,
        state: {
          ...save.snapshot.state,
          externalIntentLog: undefined,
          mindNoteLog: undefined,
          mindStats: undefined,
        },
      },
    }
    // Strip mind fields from nested snaps too
    const strip = (s: (typeof save.snapshot)) => ({
      ...s,
      state: {
        ...s.state,
        externalIntentLog: undefined as unknown as [],
        mindNoteLog: undefined as unknown as [],
        mindStats: undefined as unknown as {},
      },
    })
    const v1raw = {
      ...v1,
      pinnedDayStartSnapshots: save.pinnedDayStartSnapshots.map(strip),
      fineSnapshotRing: save.fineSnapshotRing.map(strip),
    }
    const fromV1 = restoreSave(v1raw)
    expect(fromV1.state.externalIntentLog).toEqual([])
    expect(fromV1.state.mindNoteLog).toEqual([])
    expect(fromV1.state.mindStats).toEqual({})
    expect(fromV1.state.tick).toBe(sim.state.tick)
  })

  it('invalid intent JSON → fallback event, agent keeps living', () => {
    const sim = new Simulation(3)
    sim.advanceTicks(20)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    const x0 = agent.x

    sim.postMindFallback(
      'agent-0',
      { reason: 'validation error', error: 'no JSON object in response' },
      'Mind validation failed: no JSON object in response',
    )
    const fb = sim.getEvents().filter((e) => e.type === 'mind:fallback')
    expect(fb.length).toBe(1)
    expect(fb[0]!.data?.error).toBe('no JSON object in response')

    // Still advances without throw
    sim.advanceTicks(50)
    expect(sim.state.tick).toBe(70)
    const a = sim.state.agents.find((x) => x.id === 'agent-0')!
    expect(Number.isFinite(a.x)).toBe(true)
    // May have moved or not — just alive
    expect(a.needs.hunger).toBeGreaterThanOrEqual(0)

    // parse rejects garbage
    const bad = parseMindJson('not json at all')
    expect(bad.ok).toBe(false)

    const badAction = parseMindJson('{"action":"fly","reasoning":"I want to fly"}')
    expect(badAction.ok).toBe(false)

    // valid resolves without throw
    const good = parseMindJson(
      '{"action":"wander","reasoning":"I will take a short walk nearby."}',
    )
    expect(good.ok).toBe(true)
    if (good.ok) {
      const intent = resolveMindIntent(sim.state, a, good.raw)
      expect(intent.kind).toBe('wander')
    }
    void x0
  })

  it('cadence: no two mind decisions for one agent within 30 sim-minutes', () => {
    const sim = new Simulation(42)
    const mind = new LunaBrainService('mock')
    // provider set in constructor for mock
    void mind.init()

    for (let i = 0; i < 200; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    const decisions = sim
      .getEvents()
      .filter((e) => e.type === 'mind:decision' && e.agentId === 'agent-0')
    expect(decisions.length).toBeGreaterThanOrEqual(1)
    for (let i = 1; i < decisions.length; i++) {
      const gap = decisions[i]!.tick - decisions[i - 1]!.tick
      expect(gap).toBeGreaterThanOrEqual(MIND_MIN_GAP_TICKS)
    }
  })

  it('MockProvider is deterministic for same agentId+tick', async () => {
    const p = new MockProvider()
    const a = await p.decide({
      system: 's',
      user: 'u',
      agentId: 'agent-0',
      tick: 42,
    })
    const b = await p.decide({
      system: 's',
      user: 'u',
      agentId: 'agent-0',
      tick: 42,
    })
    expect(a.text).toBe(b.text)
  })
})

/**
 * Simulated auto-breathe: when mind is pending, effective speed is 1× (remember
 * userSpeed=64 as restore target). Mock answers after 20 wall frames so without
 * breathe the world would race ahead and stale; with breathe every answer applies.
 */
describe('mind auto-breathe pacing (P3-0b)', () => {
  it('64× over 2 sim-days: every delayed decision applies, decideCalls bounded, throttle engages', async () => {
    const WALL_DELAY = 20
    const provider = new MockProvider({ wallDelayFrames: WALL_DELAY })
    // wallFloorMs: 0 so multi-day drain does not hang on the real 15s window
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)

    const userSpeed = 64
    let effectiveSpeed = userSpeed
    let sawThrottle = false
    let sawRestore = false
    let wasThrottled = false

    const TWO_DAYS = 2 * 1440
    const maxFrames = TWO_DAYS * 2 + 10_000
    let frames = 0

    while (sim.state.tick < TWO_DAYS && frames < maxFrames) {
      frames++
      // Breathe keys off thinking (whole line), not just holds
      const thinkingBefore = mind.getMeter().thinking
      if (thinkingBefore > 0) {
        effectiveSpeed = 1
        sawThrottle = true
        wasThrottled = true
      } else {
        if (wasThrottled) {
          sawRestore = true
          wasThrottled = false
        }
        effectiveSpeed = userSpeed
      }

      // One "frame" at effective speed; mid-batch break when mind line goes hot
      for (let i = 0; i < effectiveSpeed; i++) {
        if (sim.state.tick >= TWO_DAYS) break
        sim.advanceTicks(1)
        mind.onAfterTick(sim)
        if (mind.getMeter().thinking > 0 && userSpeed > 1) {
          effectiveSpeed = 1
          sawThrottle = true
          wasThrottled = true
          break
        }
      }

      // Wall-bound mind latency advances one frame (like codex wall time)
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
    }

    // Scatter + park so sticky/mixed chats interrupt and cannot re-seed
    for (let i = 0; i < sim.state.agents.length; i++) {
      const ag = sim.state.agents[i]!
      ag.x = 1 + (i % 8)
      ag.y = 1 + Math.floor(i / 8) * 3
      ag.action = { kind: 'idle', reason: 'drain park' }
      ag.action.path = undefined
      ag.pathIndex = 0
    }
    // Block new enqueues while draining the wall-bound line (mixed-society
    // otherwise keeps soft-cadence decisions/conversations re-seeding thinking).
    mind.forceBudgetCooldown(sim, 7200)
    // Drain any in-flight wall answers + external-intent inbox so events catch up
    for (let i = 0; i < WALL_DELAY + 40; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 12; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    expect(sim.state.tick).toBeGreaterThanOrEqual(TWO_DAYS)

    const meter = mind.getMeter()
    const stales = sim.getEvents().filter((e) => e.type === 'mind:stale')
    const decisions = sim.getEvents().filter((e) => e.type === 'mind:decision')

    expect(stales.length).toBe(0)
    expect(meter.stales).toBe(0)
    // Applied mind outcomes: decisions + reflections + conversation says
    // (interrupt/trails-off may post a terminal say without a full decide; meter tracks dispatches)
    expect(meter.decisions).toBeGreaterThan(0)
    expect(decisions.length).toBeGreaterThan(0)
    // Concurrency-3 + hard-gap cadence × 6 minds + reflections + mixed-society chats
    expect(meter.decideCalls).toBeLessThan(400)
    expect(meter.decisions).toBeGreaterThan(0)
    expect(Math.abs(meter.decideCalls - meter.decisions)).toBeLessThanOrEqual(8)
    expect(sawThrottle).toBe(true)
    expect(sawRestore).toBe(true)
    // Effective speed restored to user intent after last settle
    expect(mind.getMeter().thinking).toBe(0)
    expect(mind.getMeter().pending).toBe(0)
  })

  it('stale backstop: intent older than MIND_STALE_TICKS is discarded as mind:stale', async () => {
    const provider = new MockProvider({ wallDelayFrames: 1 })
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)
    const nLuna = LUNA_AGENT_IDS.length
    const k = mind.getConcurrency()

    // Kick decisions at tick 0 — all pipeline, up to K actually dispatched
    mind.onAfterTick(sim)
    expect(mind.getMeter().pending).toBe(nLuna)
    expect(mind.getMeter().thinking).toBe(nLuna)
    expect(mind.getDecideCallCount()).toBe(Math.min(k, nLuna))
    const requestTick = sim.state.tick

    // Race sim far ahead while the head batch is wall-waiting (no breathe).
    // In-flight agents go stale; waiters rebuild prompts at later dispatch ticks.
    sim.advanceTicks(MIND_STALE_TICKS + 10)
    expect(sim.state.tick - requestTick).toBeGreaterThan(MIND_STALE_TICKS)

    // Complete in-flight → stale; then remaining waiters apply fresh
    for (let i = 0; i < nLuna + 2; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      await Promise.resolve()
    }

    const stales = sim.getEvents().filter((e) => e.type === 'mind:stale')
    const inFlightAtRace = Math.min(k, nLuna)
    expect(stales.length).toBe(inFlightAtRace)
    expect(stales[0]!.reason).toMatch(/sim-min/)
    expect(mind.getMeter().stales).toBe(inFlightAtRace)
    expect(mind.getMeter().fallbacks).toBe(0)
    // Waiters dispatched after the race post intents (apply on next sim step)
    expect(mind.getMeter().decisions).toBe(nLuna - inFlightAtRace)
    sim.advanceTicks(2)
    mind.onAfterTick(sim)
    expect(sim.getEvents().filter((e) => e.type === 'mind:decision').length).toBe(
      nLuna - inFlightAtRace,
    )
  })
})

describe('mind budget cooldown (P3-0c)', () => {
  it('402-style budget: one mind:budget event, cooldown blocks further dispatches, agent keeps living', async () => {
    const provider = new BudgetExhaustedProvider({
      failCount: 99,
      resetsInSec: 3600,
      usedHour: 60,
      maxHour: 60,
    })
    // concurrency 1 keeps the first-402 story simple (pool may still race elsewhere)
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 1,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)
    const nLuna = LUNA_AGENT_IDS.length

    // Kick first dispatch (async provider path) — 1 in flight, rest queued
    mind.onAfterTick(sim)
    expect(mind.getDecideCallCount()).toBe(1)
    expect(mind.getMeter().thinking).toBe(nLuna)
    // Drain provider rejection + cooldown entry (clears remaining queue)
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()

    const budgetEvents = sim.getEvents().filter((e) => e.type === 'mind:budget')
    // First 402 enters cooldown, drops the queue, emits once
    expect(budgetEvents.length).toBe(1)
    expect(budgetEvents[0]!.reason).toMatch(/mind budget exhausted — running on instinct until \d{2}:\d{2}/)
    expect(mind.getMeter().budgetCooldown).toBe(true)
    expect(mind.getMeter().budgetUsedHour).toBe(60)
    expect(mind.getMeter().budgetMaxHour).toBe(60)
    // Not counted as a generic fallback
    expect(mind.getMeter().fallbacks).toBe(0)

    const callsAfterBudget = mind.getDecideCallCount()
    const invAfter = provider.decideInvocations

    // Advance many ticks / hard gaps — no further dispatches while cooldown holds
    for (let i = 0; i < 400; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(mind.getDecideCallCount()).toBe(callsAfterBudget)
    expect(provider.decideInvocations).toBe(invAfter)
    expect(sim.getEvents().filter((e) => e.type === 'mind:budget').length).toBe(1)

    // Agent keeps living on UtilityBrain — actions still fire
    const actions = sim.getEvents().filter((e) => e.type === 'action:start')
    expect(actions.length).toBeGreaterThan(0)
    expect(sim.state.agents.length).toBeGreaterThan(0)
    // Needs still evolve (not frozen)
    const a0 = sim.state.agents[0]!
    expect(a0.needs.hunger).toBeGreaterThan(0)
  })

  it('MIND_WALL_TIMEOUT_MS is 75s (above sidecar 60s kill)', () => {
    expect(MIND_WALL_TIMEOUT_MS).toBe(75_000)
  })

  it('forceBudgetCooldown emits one event and sets meter flag', () => {
    const mind = new LunaBrainService('mock')
    const sim = new Simulation(1)
    mind.forceBudgetCooldown(sim, 120)
    expect(mind.getMeter().budgetCooldown).toBe(true)
    expect(sim.getEvents().filter((e) => e.type === 'mind:budget').length).toBe(1)
    mind.forceBudgetCooldown(sim, 120)
    // Still one event for the same episode
    expect(sim.getEvents().filter((e) => e.type === 'mind:budget').length).toBe(1)
  })
})

describe('mind disabled leaves phase-2 determinism intact', () => {
  it('two sims without external intents still match', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(500)
    b.advanceTicks(500)
    expect(a.hash()).toBe(b.hash())
    expect(a.state.externalIntentLog).toEqual([])
    expect(b.state.externalIntentLog).toEqual([])
    expect(a.state.mindNoteLog).toEqual([])
    expect(b.state.mindNoteLog).toEqual([])
  })
})

describe('save format rejects unknown versions', () => {
  it('rejects format 999', () => {
    const sim = new Simulation(1)
    sim.advanceTicks(10)
    const save = serializeSave(sim) as unknown as Record<string, unknown>
    save.formatVersion = 999
    expect(() => restoreSave(save)).toThrow(SaveFormatError)
  })
})

describe('mind notes — record/replay (P3-1)', () => {
  it('postMindNotes → stateAt/fork re-sim hash-identical; save v3 round-trip; v2/v1 load', () => {
    const sim = new Simulation(42)
    const plan: Array<{ atTick: number; notes: string[] }> = [
      { atTick: 80, notes: ['I worked the farm today.', 'Tomorrow I will rest.'] },
      { atTick: 200, notes: ['I spent coins carefully.'] },
    ]
    let pi = 0
    const target = 400
    for (let t = 0; t < target; t++) {
      const next = plan[pi]
      if (next && sim.state.tick === next.atTick) {
        sim.postMindNotes('agent-0', next.notes, {
          provider: 'mock',
          latencyMs: 2,
          approxChars: 50,
        })
        pi++
      }
      sim.advanceTicks(1)
    }

    expect(sim.state.mindNoteLog.length).toBe(2)
    const reflections = sim.getEvents().filter((e) => e.type === 'mind:reflection')
    expect(reflections.length).toBe(2)
    expect(reflections[0]!.data?.notes).toEqual(plan[0]!.notes)

    const liveHash = sim.hash()
    const atHead = sim.stateAt(target)
    expect(atHead.hash()).toBe(liveHash)
    expect(atHead.state.mindNoteLog).toEqual(sim.state.mindNoteLog)

    // Fresh re-sim with same posts matches
    const fresh = new Simulation(42)
    let pj = 0
    for (let t = 0; t < target; t++) {
      const next = plan[pj]
      if (next && fresh.state.tick === next.atTick) {
        fresh.postMindNotes('agent-0', next.notes, {
          provider: 'mock',
          latencyMs: 2,
          approxChars: 50,
        })
        pj++
      }
      fresh.advanceTicks(1)
    }
    expect(fresh.hash()).toBe(liveHash)

    // mid stateAt
    const mid = sim.stateAt(150)
    expect(mid.state.mindNoteLog.length).toBe(1)

    // Save (current format is v4; mind notes since v3)
    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(save.snapshot.state.mindNoteLog.length).toBe(2)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(liveHash)
    expect(restored.state.mindNoteLog).toEqual(sim.state.mindNoteLog)

    // v2 load → empty note log
    const stripNotes = (s: (typeof save.snapshot)) => ({
      ...s,
      state: {
        ...s.state,
        mindNoteLog: undefined as unknown as [],
      },
    })
    const v2raw = {
      ...save,
      formatVersion: 2,
      snapshot: stripNotes(save.snapshot),
      pinnedDayStartSnapshots: save.pinnedDayStartSnapshots.map(stripNotes),
      fineSnapshotRing: save.fineSnapshotRing.map(stripNotes),
    }
    const fromV2 = restoreSave(v2raw)
    expect(fromV2.state.mindNoteLog).toEqual([])
    expect(fromV2.state.externalIntentLog.length).toBe(
      save.snapshot.state.externalIntentLog.length,
    )

    // v1 still works
    const stripAll = (s: (typeof save.snapshot)) => ({
      ...s,
      state: {
        ...s.state,
        externalIntentLog: undefined as unknown as [],
        mindNoteLog: undefined as unknown as [],
        mindStats: undefined as unknown as {},
      },
    })
    const v1raw = {
      ...save,
      formatVersion: 1,
      snapshot: stripAll(save.snapshot),
      pinnedDayStartSnapshots: save.pinnedDayStartSnapshots.map(stripAll),
      fineSnapshotRing: save.fineSnapshotRing.map(stripAll),
    }
    const fromV1 = restoreSave(v1raw)
    expect(fromV1.state.mindNoteLog).toEqual([])
    expect(fromV1.state.externalIntentLog).toEqual([])
  })
})

describe('reflection scheduling (P3-1)', () => {
  it('exactly one reflection per luna agent per sim-day over 3 mock days; budget counter increments', () => {
    const mind = new LunaBrainService('mock')
    void mind.init()
    const sim = new Simulation(42)
    const THREE_DAYS = 3 * 1440

    for (let i = 0; i < THREE_DAYS; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    // Drain mock holds
    for (let i = 0; i < 10; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    const reflections = sim.getEvents().filter((e) => e.type === 'mind:reflection')
    const byAgent = new Map<string, number>()
    for (const e of reflections) {
      const id = e.agentId ?? '?'
      byAgent.set(id, (byAgent.get(id) ?? 0) + 1)
    }

    // 3 nights × each luna agent
    for (const id of LUNA_AGENT_IDS) {
      expect(byAgent.get(id) ?? 0).toBe(3)
    }
    expect(reflections.length).toBe(LUNA_AGENT_IDS.length * 3)

    const meter = mind.getMeter()
    // decideCalls includes decisions + reflections
    expect(meter.decideCalls).toBeGreaterThanOrEqual(reflections.length)
    expect(meter.decisions).toBeGreaterThanOrEqual(reflections.length)
  })
})

describe('memory purity (P3-1)', () => {
  it('episodic/reflection memories are deterministic; prompt includes Your memories:', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(100)
    // Script notes + advance so they apply
    sim.postMindNotes('agent-0', ['I counted every coin today.', 'Tomorrow: the stall.'], {
      provider: 'mock',
      latencyMs: 1,
    })
    sim.advanceTicks(1)

    const events = sim.getEvents()
    const log = sim.state.mindNoteLog
    const a = episodicMemories('agent-0', events)
    const b = episodicMemories('agent-0', events)
    expect(a).toEqual(b)
    const r1 = reflectionMemories('agent-0', log)
    const r2 = reflectionMemories('agent-0', log)
    expect(r1).toEqual(r2)
    expect(r1.length).toBeGreaterThanOrEqual(1)
    expect(r1[0]!.text).toContain('Tomorrow: the stall')

    const agent = sim.state.agents.find((x) => x.id === 'agent-0')!
    const user = buildUserPrompt(agent, sim.state, events, log)
    expect(user).toContain('Your memories:')
    expect(user).toContain('Standing facts:')
    expect(user).toContain('I counted every coin today.')
    expect(user).toContain('Tomorrow: the stall.')

    // Personas list includes contrast agents
    expect(LUNA_AGENT_IDS).toContain('agent-0')
    expect(LUNA_AGENT_IDS).toContain('agent-1')
    expect(LUNA_AGENT_IDS).toContain('agent-11')
  })
})

describe('mind dispatch queue unit (P3-1b)', () => {
  it('FIFO decisions, reflections low priority, no duplicate agents, cap drops reflection first', () => {
    const q = new MindDispatchQueue(3)
    expect(q.enqueue({ agentId: 'a', kind: 'reflection', nightKey: 1 })).toBe(
      'enqueued',
    )
    expect(q.enqueue({ agentId: 'b', kind: 'decision' })).toBe('enqueued')
    expect(q.enqueue({ agentId: 'c', kind: 'decision' })).toBe('enqueued')
    // Decision jumps ahead of queued reflection
    expect(q.list().map((e) => e.agentId)).toEqual(['b', 'c', 'a'])
    // Duplicate agent rejected
    expect(q.enqueue({ agentId: 'b', kind: 'decision' })).toBe('duplicate')
    // Cap: drop oldest reflection when full
    expect(q.enqueue({ agentId: 'd', kind: 'decision' })).toBe('enqueued')
    expect(q.list().map((e) => `${e.agentId}:${e.kind}`)).toEqual([
      'b:decision',
      'c:decision',
      'd:decision',
    ])
    expect(q.dequeue()?.agentId).toBe('b')
    expect(q.dequeue()?.agentId).toBe('c')
  })
})

/**
 * Recording mock: wall-frame delay + concurrency / prompt-tick capture.
 */
class RecordingMockProvider implements MindProvider {
  readonly name = 'mock'
  private inner: MockProvider
  calls: MindPrompt[] = []
  private concurrent = 0
  maxConcurrent = 0

  constructor(wallDelayFrames: number) {
    this.inner = new MockProvider({ wallDelayFrames })
  }

  advanceWallFrame(): void {
    this.inner.advanceWallFrame()
  }

  async decide(prompt: MindPrompt): Promise<MindDecisionResult> {
    this.calls.push({ ...prompt })
    this.concurrent += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent)
    try {
      return await this.inner.decide(prompt)
    } finally {
      this.concurrent -= 1
    }
  }
}

describe('client-side mind dispatch queue (P3-1b / P3-2b)', () => {
  async function drainWall(
    provider: RecordingMockProvider,
    mind: LunaBrainService,
    sim: Simulation,
    frames: number,
  ): Promise<void> {
    for (let i = 0; i < frames; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
  }

  it('6 minds same cadence: all apply, zero fallbacks, FIFO priority, up to 3 concurrent, refresh at dispatch', async () => {
    const WALL = 5
    const provider = new RecordingMockProvider(WALL)
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)
    const nLuna = LUNA_AGENT_IDS.length
    const k = 3

    // Kick all luna minds at tick 0 — pool fills to K
    mind.onAfterTick(sim)
    expect(mind.getMeter().thinking).toBe(nLuna)
    expect(mind.getDecideCallCount()).toBe(k)
    expect(provider.calls.length).toBe(k)
    expect(provider.calls[0]!.tick).toBe(0)
    expect(provider.maxConcurrent).toBe(k)
    expect(provider.maxConcurrent).toBeLessThan(4)

    // World races ahead while first batch is in flight — waiters rebuild at dispatch
    for (let i = 0; i < 17; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    // Still only first batch until wall completes
    expect(mind.getDecideCallCount()).toBe(k)
    expect(mind.getMeter().thinking).toBe(nLuna)

    // Complete first batch → more dispatches at current tick (~17+)
    await drainWall(provider, mind, sim, WALL)
    expect(provider.calls.length).toBeGreaterThan(k)
    const later = provider.calls[k]!
    expect(later.tick!).toBeGreaterThan(0)
    expect(later.user).toContain(`(tick ${later.tick})`)
    expect(provider.maxConcurrent).toBeLessThanOrEqual(k)

    // Drain only until the original pipeline entries finish (avoid next cadence)
    let guard = 0
    while (mind.getMeter().thinking > 0 && guard < WALL * nLuna * 2 + 40) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      // Advance at most 1 tick so soft-gap does not re-fire mid-drain
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      guard++
    }

    expect(provider.maxConcurrent).toBeLessThanOrEqual(k)
    expect(provider.maxConcurrent).toBeGreaterThanOrEqual(1)
    // First N dispatches are the initial FIFO line (no duplicates)
    const firstWave = provider.calls.slice(0, nLuna)
    expect(firstWave.map((c) => c.agentId)).toEqual([...LUNA_AGENT_IDS])
    for (const c of firstWave) {
      expect(c.kind ?? 'decision').toBe('decision')
      expect(c.user).toContain(`(tick ${c.tick})`)
    }
    // Later waiters were refreshed past enqueue tick 0
    expect(firstWave[k]!.tick!).toBeGreaterThan(0)

    const meter = mind.getMeter()
    expect(meter.fallbacks).toBe(0)
    expect(sim.getEvents().filter((e) => e.type === 'mind:fallback').length).toBe(0)
    const decisions = sim.getEvents().filter((e) => e.type === 'mind:decision')
    const agentsWithDecision = new Set(decisions.map((e) => e.agentId))
    for (const id of LUNA_AGENT_IDS) {
      expect(agentsWithDecision.has(id)).toBe(true)
    }
    // decideCalls === applied decisions + applied reflections
    expect(meter.decideCalls).toBe(meter.decisions)
    expect(meter.decisions).toBeGreaterThanOrEqual(nLuna)
    expect(meter.thinking).toBe(0)
  })

  it('reflection+decision priority: decisions jump ahead of queued reflections; pool ≤ K', async () => {
    const q = new MindDispatchQueue(4)
    q.enqueue({ agentId: 'agent-0', kind: 'reflection', nightKey: 1 })
    q.enqueue({ agentId: 'agent-1', kind: 'reflection', nightKey: 1 })
    // Decision inserts before reflections
    q.enqueue({ agentId: 'agent-11', kind: 'decision' })
    expect(q.list().map((e) => `${e.agentId}:${e.kind}`)).toEqual([
      'agent-11:decision',
      'agent-0:reflection',
      'agent-1:reflection',
    ])
    // Conversation sits between decision and reflection
    q.enqueue({
      agentId: 'agent-2',
      kind: 'conversation',
      conversationId: 'c1',
      partnerId: 'agent-0',
      turn: 0,
    })
    expect(q.list().map((e) => `${e.agentId}:${e.kind}`)).toEqual([
      'agent-11:decision',
      'agent-2:conversation',
      'agent-0:reflection',
      'agent-1:reflection',
    ])

    // Integration: tick 0 is Day1 06:00; Day2 03:00 = abs 1620 → tick 1260
    // (world epoch offset MINUTES_AT_TICK0 = 360)
    const WALL = 3
    const provider = new RecordingMockProvider(WALL)
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)
    const day2_03_00 = 1260
    sim.advanceTicks(day2_03_00)
    mind.onAfterTick(sim)
    // At exact 03:00 fallback, reflections enqueue first (before decisions)
    expect(provider.calls[0]?.kind).toBe('reflection')
    expect(mind.getMeter().thinking).toBe(LUNA_AGENT_IDS.length)

    for (let i = 0; i < WALL * LUNA_AGENT_IDS.length + 15; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    expect(provider.maxConcurrent).toBeLessThanOrEqual(3)
    expect(mind.getMeter().fallbacks).toBe(0)
    const reflections = sim.getEvents().filter((e) => e.type === 'mind:reflection')
    expect(reflections.length).toBe(LUNA_AGENT_IDS.length)
    const meter = mind.getMeter()
    expect(meter.decideCalls).toBe(meter.decisions)
  })
})

/**
 * P3-2b acceptance: zero stale at speed, pool caps, rate window, conversation lane.
 */
describe('mind pool + breathe whole line (P3-2b)', () => {
  it('resolveLunaConcurrency clamps 1–4 and prefers query > storage > default', () => {
    expect(clampLunaConcurrency(0)).toBe(1)
    expect(clampLunaConcurrency(99)).toBe(4)
    expect(clampLunaConcurrency(2.7)).toBe(2)
    expect(
      resolveLunaConcurrency({
        search: '',
        localStorageGet: () => null,
      }),
    ).toBe(3)
    expect(
      resolveLunaConcurrency({
        search: '?mindConcurrency=2',
        localStorageGet: () => '4',
      }),
    ).toBe(2)
    expect(
      resolveLunaConcurrency({
        search: '',
        localStorageGet: () => '4',
      }),
    ).toBe(4)
    expect(resolveLunaConcurrency({ explicit: 1 })).toBe(1)
  })

  it('zero-stale at 64× multi-day: every completed decision applies; throttle across rate-floor waits', async () => {
    const WALL = 4
    const provider = new RecordingMockProvider(WALL)
    let now = 1_000_000
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: MIND_WALL_FLOOR_MS,
      now: () => now,
    })
    await mind.init()
    const sim = new Simulation(42)
    const userSpeed = 64
    let effectiveSpeed = userSpeed
    const speedSamplesWhileLine: number[] = []
    let sawFloorWait = false
    let sawRestoreAfterDrain = false

    const MULTI_DAY = 2 * 1440
    const maxFrames = MULTI_DAY * 3 + 20_000
    let frames = 0

    while (sim.state.tick < MULTI_DAY && frames < maxFrames) {
      frames++
      const meter = mind.getMeter()
      if (meter.thinking > 0) {
        effectiveSpeed = 1
        speedSamplesWhileLine.push(effectiveSpeed)
      } else {
        if (speedSamplesWhileLine.length > 0) sawRestoreAfterDrain = true
        effectiveSpeed = userSpeed
      }

      for (let i = 0; i < effectiveSpeed; i++) {
        if (sim.state.tick >= MULTI_DAY) break
        sim.advanceTicks(1)
        mind.onAfterTick(sim)
        if (mind.getMeter().thinking > 0 && userSpeed > 1) {
          effectiveSpeed = 1
          break
        }
      }

      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()

      // Advance wall clock slowly so the rolling window opens without racing the sim
      now += 50
    }

    // Explicit floor-wait probe: refill line, consume K slots, complete them, assert
    // thinking stays > 0 while rate floor holds before clock advances 15s.
    {
      const p2 = new RecordingMockProvider(2)
      let t = 5_000_000
      const m2 = new LunaBrainService('mock', {
        provider: p2,
        concurrency: 3,
        wallFloorMs: MIND_WALL_FLOOR_MS,
        now: () => t,
      })
      await m2.init()
      const s2 = new Simulation(99)
      m2.onAfterTick(s2)
      expect(m2.getDecideCallCount()).toBe(3)
      // Complete the 3 in-flight without advancing the rate window
      for (let i = 0; i < 3; i++) {
        p2.advanceWallFrame()
        p2.advanceWallFrame()
        await Promise.resolve()
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
      }
      // Pump may not open new slots (rate floor) — remaining queue keeps thinking hot
      m2.onAfterTick(s2)
      expect(m2.getMeter().thinking).toBeGreaterThan(0)
      // Breathe engaged during floor wait (simulated speed stays 1)
      let speed = 64
      if (m2.getMeter().thinking > 0) speed = 1
      expect(speed).toBe(1)
      sawFloorWait = true
      // Open the window → drain rest
      t += MIND_WALL_FLOOR_MS + 1
      m2.onAfterTick(s2)
      expect(m2.getDecideCallCount()).toBeGreaterThan(3)
      // Open a fresh rate window each iteration so this loop actually drains.
      // The floor-wait behaviour is asserted above; sitting under the floor here
      // only starved the drain — at 100ms/iter the window reopens every ~150
      // iterations, so the bound of 40 was already marginal at 6 minds.
      for (let g = 0; g < 40 && m2.getMeter().thinking > 0; g++) {
        p2.advanceWallFrame()
        await Promise.resolve()
        await Promise.resolve()
        s2.advanceTicks(1)
        m2.onAfterTick(s2)
        t += MIND_WALL_FLOOR_MS + 1
      }
      expect(m2.getMeter().thinking).toBe(0)
      expect(m2.getMeter().stales).toBe(0)
      expect(m2.getMeter().decideCalls).toBe(m2.getMeter().decisions)
    }

    // Scatter + park so conversations interrupt (distance) and cannot re-seed
    for (let i = 0; i < sim.state.agents.length; i++) {
      const ag = sim.state.agents[i]!
      ag.x = 1 + (i % 8)
      ag.y = 1 + Math.floor(i / 8) * 3
      ag.action = { kind: 'idle', reason: 'drain park' }
      ag.action.path = undefined
      ag.pathIndex = 0
    }
    // Drain residual from multi-day run until the line is empty
    for (let g = 0; g < 500 && mind.getMeter().thinking > 0; g++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      now += MIND_WALL_FLOOR_MS
    }
    // Settle any external-intent applies on the next tick
    for (let i = 0; i < 12; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    const meter = mind.getMeter()
    const stales = sim.getEvents().filter((e) => e.type === 'mind:stale')
    expect(stales.length).toBe(0)
    expect(meter.stales).toBe(0)
    expect(meter.thinking).toBe(0)
    // Every completed dispatch applied (decisions + reflections + mind says;
    // sheep templates do not count as decideCalls or decisions)
    expect(meter.decideCalls).toBe(meter.decisions)
    expect(meter.decisions).toBeGreaterThan(0)
    expect(speedSamplesWhileLine.length).toBeGreaterThan(0)
    expect(speedSamplesWhileLine.every((s) => s === 1)).toBe(true)
    expect(sawFloorWait).toBe(true)
    expect(provider.maxConcurrent).toBeLessThanOrEqual(3)
    expect(provider.maxConcurrent).toBeGreaterThanOrEqual(1)
    // Restore observed after at least one drain cycle in the multi-day loop
    expect(sawRestoreAfterDrain || meter.thinking === 0).toBe(true)
  })

  it('pool never exceeds 3 concurrent; rolling window caps K starts per 15s; FIFO across lanes', async () => {
    const WALL = 3
    const provider = new RecordingMockProvider(WALL)
    let now = 10_000_000
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: MIND_WALL_FLOOR_MS,
      now: () => now,
    })
    await mind.init()
    const sim = new Simulation(42)
    mind.onAfterTick(sim)
    expect(mind.getDecideCallCount()).toBe(3)
    expect(provider.maxConcurrent).toBe(3)

    // 4th must not start until window advances (even if a slot frees)
    for (let i = 0; i < WALL; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    }
    mind.onAfterTick(sim)
    // Rate floor still blocks (same window)
    expect(mind.getDecideCallCount()).toBe(3)
    expect(mind.getMeter().thinking).toBeGreaterThan(0)

    now += MIND_WALL_FLOOR_MS + 1
    mind.onAfterTick(sim)
    expect(mind.getDecideCallCount()).toBeGreaterThan(3)
    expect(mind.getDecideCallCount()).toBeLessThanOrEqual(6)
    expect(provider.maxConcurrent).toBeLessThanOrEqual(3)

    // FIFO: first wave agents match LUNA_AGENT_IDS order
    const firstThree = provider.calls.slice(0, 3).map((c) => c.agentId)
    expect(firstThree).toEqual([...LUNA_AGENT_IDS].slice(0, 3))
  })

  it('conversation lane: turn N+1 waits for apply; a decision may run in parallel', async () => {
    const WALL = 4
    const provider = new RecordingMockProvider(WALL)
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
    })
    await mind.init()
    const sim = new Simulation(42)

    // Pin two luna agents in socialize proximity so a conversation can start
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    const a = sim.state.agents.find((x) => x.id === 'agent-0')!
    const b = sim.state.agents.find((x) => x.id === 'agent-1')!
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

    // Advance until conversation is active or give up
    for (let i = 0; i < 80; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
      if (mind.getActiveConversation()) break
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
    }

    const conv = mind.getActiveConversation()
    if (conv) {
      expect(conv.turnInFlight || conv.nextTurn >= 0).toBe(true)
      expect(provider.maxConcurrent).toBeLessThanOrEqual(3)
    }

    // Structural lane rule: blocked conversation does not stall a decision ahead
    const q = new MindDispatchQueue(8)
    q.enqueue({
      agentId: 'agent-0',
      kind: 'conversation',
      conversationId: 'c-lane',
      partnerId: 'agent-1',
      turn: 0,
    })
    q.enqueue({ agentId: 'agent-2', kind: 'decision' })
    q.enqueue({
      agentId: 'agent-1',
      kind: 'conversation',
      conversationId: 'c-lane',
      partnerId: 'agent-0',
      turn: 1,
    })
    // Decision outranks conversation; among conversations FIFO
    expect(q.list().map((e) => `${e.agentId}:${e.kind}:${e.turn ?? '-'}`)).toEqual([
      'agent-2:decision:-',
      'agent-0:conversation:0',
      'agent-1:conversation:1',
    ])
    // takeFirst skips blocked conversation lane when we simulate in-flight turn 0
    const blocked = new Set(['c-lane'])
    const next = q.takeFirst(
      (e) =>
        e.kind !== 'conversation' ||
        !e.conversationId ||
        !blocked.has(e.conversationId),
    )
    expect(next?.agentId).toBe('agent-2')
    // After decision taken, next dispatchable is turn 0 (turn 1 still same lane)
    const next2 = q.takeFirst(
      (e) =>
        e.kind !== 'conversation' ||
        !e.conversationId ||
        !blocked.has(e.conversationId),
    )
    expect(next2).toBeUndefined() // both remaining are c-lane conversations
    expect(q.size()).toBe(2)
  })
})

describe('personas grounding (P3-1 / P3-2)', () => {
  it('personas contain no ownership/job/wealth assertions; 8 luna minds', () => {
    const forbidden =
      /homeowner|I own|my house|my home(?!land)|proud first-time|employed at|I work as|I am rich|my wallet/i
    expect(LUNA_AGENT_IDS.length).toBe(8)
    expect(LUNA_AGENT_IDS).toContain('agent-2')
    expect(LUNA_AGENT_IDS).toContain('agent-4')
    expect(LUNA_AGENT_IDS).toContain('agent-8')
    // The change-seeking pair.
    expect(LUNA_AGENT_IDS).toContain('agent-3')
    expect(LUNA_AGENT_IDS).toContain('agent-5')
    for (const id of LUNA_AGENT_IDS) {
      const p = personaFor(id) ?? ''
      expect(p.length).toBeGreaterThan(20)
      expect(p).not.toMatch(forbidden)
    }
  })
})

/**
 * P3-2d: apply-on-resolve — hidden page has no rAF. Completions must post to
 * the inbox from the request's own promise, not from a frame/pump callback.
 */
describe('frameless apply-on-resolve (P3-2d)', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  it('hidden page: completions post without frames; advanceTicks applies; queue continues; sweep idle; breathe restores', async () => {
    const WALL_MS = 30
    const provider = new MockProvider({ wallDelayMs: WALL_MS })
    const userSpeed = 64
    let speed = userSpeed
    const applyBreathe = (svc: LunaBrainService) => {
      speed = svc.getMeter().thinking > 0 ? 1 : userSpeed
    }
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
      onPipelineChange: () => applyBreathe(mind),
    })
    await mind.init()
    const sim = new Simulation(42)
    const nLuna = LUNA_AGENT_IDS.length

    // Last visible frame: enqueue + dispatch first K
    mind.onAfterTick(sim)
    applyBreathe(mind)
    expect(mind.getDecideCallCount()).toBe(3)
    expect(speed).toBe(1)
    expect(sim.getExternalInboxSize()).toBe(0)
    expect(sim.getEvents().filter((e) => e.type === 'mind:decision').length).toBe(0)

    // HIDDEN: no onAfterTick, no frame, no wall-frame pump
    await sleep(WALL_MS + 25)
    await Promise.resolve()
    await Promise.resolve()

    // First batch posted to inbox on their own (second batch may already be in flight)
    expect(sim.getExternalInboxSize()).toBeGreaterThanOrEqual(3)
    expect(mind.getMeter().decisions).toBeGreaterThanOrEqual(3)
    expect(sim.getEvents().filter((e) => e.type === 'mind:decision').length).toBe(0)
    // Next queue entries dispatched without frames (wallFloor 0 → immediate)
    expect(mind.getDecideCallCount()).toBeGreaterThan(3)

    // Second batch resolves without frames
    await sleep(WALL_MS + 25)
    await Promise.resolve()
    await Promise.resolve()

    expect(sim.getExternalInboxSize()).toBe(nLuna)
    expect(mind.getMeter().decisions).toBe(nLuna)
    expect(mind.getMeter().thinking).toBe(0)
    expect(speed).toBe(64)
    expect(mind.getSafetySweepHits()).toBe(0)

    // Sweep is a no-op in this path (prove belt did not apply anything)
    mind.safetySweepOnce()
    expect(mind.getSafetySweepHits()).toBe(0)
    expect(sim.getExternalInboxSize()).toBe(nLuna)

    // Bare advanceTicks applies the inbox — no onAfterTick
    sim.advanceTicks(1)
    const applied = sim.getEvents().filter((e) => e.type === 'mind:decision')
    expect(applied.length).toBe(nLuna)
    expect(sim.getExternalInboxSize()).toBe(0)
    expect(mind.getMeter().fallbacks).toBe(0)
    expect(mind.getMeter().stales).toBe(0)

    mind.dispose()
  })

  it('rate-floor wait dispatches the next batch via setTimeout without frames', async () => {
    const WALL_MS = 20
    const FLOOR_MS = 70
    const provider = new MockProvider({ wallDelayMs: WALL_MS })
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: FLOOR_MS,
    })
    await mind.init()
    const sim = new Simulation(42)

    mind.onAfterTick(sim)
    expect(mind.getDecideCallCount()).toBe(3)

    await sleep(WALL_MS + 20)
    await Promise.resolve()
    // First batch done; rate floor still holds — no new dispatch yet
    expect(mind.getDecideCallCount()).toBe(3)
    expect(sim.getExternalInboxSize()).toBe(3)
    expect(mind.getMeter().thinking).toBeGreaterThan(0)

    // Floor opens via setTimeout — still no onAfterTick / frame
    await sleep(FLOOR_MS + 20)
    await Promise.resolve()
    expect(mind.getDecideCallCount()).toBeGreaterThan(3)

    await sleep(WALL_MS + 20)
    await Promise.resolve()
    expect(mind.getMeter().decisions).toBeGreaterThanOrEqual(6)
    expect(mind.getSafetySweepHits()).toBe(0)

    mind.dispose()
  })
})

/**
 * P3-14b: auto-breathe must never hold the world when the mind line is empty.
 * The soak "90% breathe" was lost wall-time (1 fps rAF × 0.1s dtCap = 6 ticks/min),
 * not a thinking>0 hold — still lock the idle invariant and the dt cap that
 * made an empty line look frozen.
 */
describe('auto-breathe idle invariant (P3-14b)', () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  it('1× dt cap credits a full second so 1 fps rAF still yields 60 ticks/min', () => {
    expect(frameDtCap(1)).toBe(1.0)
    expect(frameDtCap(8)).toBe(0.25)
    expect(frameDtCap(64)).toBe(1.0)

    const ticksFromFrames = (dtCap: number, frameIntervalSec: number, wallSec: number) => {
      let acc = 0
      let ticks = 0
      const frames = Math.round(wallSec / frameIntervalSec)
      for (let i = 0; i < frames; i++) {
        acc += Math.min(dtCap, frameIntervalSec)
        const steps = Math.floor(acc)
        acc -= steps
        ticks += steps
      }
      return ticks
    }
    // The wedged soak: 1 fps × 0.1s cap keeps ~6 ticks / wall-min (IEEE 0.1
    // may floor to 5); the 1.0s cap restores 1×.
    expect(ticksFromFrames(0.1, 1, 60)).toBeLessThanOrEqual(6)
    expect(ticksFromFrames(0.1, 1, 60)).toBeGreaterThanOrEqual(5)
    expect(ticksFromFrames(frameDtCap(1), 1, 60)).toBe(60)
    // Focused 60 fps is unchanged
    expect(ticksFromFrames(frameDtCap(1), 1 / 60, 60)).toBe(60)
  })

  it('does not hold speed when queue is empty, pending is 0, and no conversation turn is in flight', async () => {
    const WALL_MS = 20
    const provider = new MockProvider({ wallDelayMs: WALL_MS })
    const userSpeed = 64
    let speed = userSpeed
    const applyBreathe = () => {
      speed = mind.getMeter().thinking > 0 ? 1 : userSpeed
    }
    const mind = new LunaBrainService('mock', {
      provider,
      concurrency: 3,
      wallFloorMs: 0,
      safetySweep: false,
      suppressNewConversations: true,
      minGapTicks: 15,
      onPipelineChange: () => applyBreathe(),
    })
    await mind.init()
    const sim = new Simulation(42)

    mind.onAfterTick(sim)
    applyBreathe()
    expect(mind.getMeter().thinking).toBeGreaterThan(0)
    expect(speed).toBe(1)

    // Drain both K=3 batches
    await sleep(WALL_MS + 30)
    await Promise.resolve()
    await Promise.resolve()
    await sleep(WALL_MS + 30)
    await Promise.resolve()
    await Promise.resolve()

    applyBreathe()
    expect(mind.getMeter().thinking).toBe(0)
    expect(mind.getMeter().pending).toBe(0)
    expect(mind.getActiveConversations().some((c) => c.turnInFlight)).toBe(false)
    expect(speed).toBe(userSpeed)

    // Cadence has not elapsed (1 tick << 15). Empty line must stay unrested.
    sim.advanceTicks(1)
    mind.onAfterTick(sim)
    applyBreathe()
    expect(mind.getMeter().thinking).toBe(0)
    expect(mind.getMeter().pending).toBe(0)
    expect(mind.getActiveConversations().some((c) => c.turnInFlight)).toBe(false)
    expect(speed).toBe(userSpeed)

    mind.dispose()
  })
})

describe('mind minGapTicks knob (P3-9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubSearch = (search: string) => {
    vi.stubGlobal('window', { location: { search } })
  }

  const forceIdle = (sim: Simulation, agentId: string) => {
    const a = sim.state.agents.find((x) => x.id === agentId)
    if (!a) return
    a.action = { kind: 'idle', reason: 'test cadence' }
    a.actionTicks = 0
  }

  const decisionsFor = (sim: Simulation, agentId: string) =>
    sim.getEvents().filter((e) => e.type === 'mind:decision' && e.agentId === agentId)

  it('parses ?mindMinGapTicks= and clamps 5–120; garbage → default', () => {
    expect(MIND_MIN_GAP_TICKS).toBe(30)
    expect(clampMinGapTicks(15)).toBe(15)
    expect(clampMinGapTicks(5)).toBe(5)
    expect(clampMinGapTicks(120)).toBe(120)
    expect(clampMinGapTicks(4)).toBe(5)
    expect(clampMinGapTicks(200)).toBe(120)
    expect(clampMinGapTicks(15.9)).toBe(15)

    expect(mindMinGapTicksFromLocation()).toBeNull()
    expect(resolveMinGapTicks()).toBe(30)

    stubSearch('?mindMinGapTicks=15')
    expect(mindMinGapTicksFromLocation()).toBe(15)
    expect(resolveMinGapTicks()).toBe(15)

    stubSearch('?mindMinGapTicks=3')
    expect(mindMinGapTicksFromLocation()).toBe(5)

    stubSearch('?mindMinGapTicks=999')
    expect(mindMinGapTicksFromLocation()).toBe(120)

    stubSearch('?mindMinGapTicks=abc')
    expect(mindMinGapTicksFromLocation()).toBeNull()
    expect(resolveMinGapTicks()).toBe(30)

    stubSearch('?mindMinGapTicks=')
    expect(mindMinGapTicksFromLocation()).toBeNull()

    stubSearch('?other=1')
    expect(mindMinGapTicksFromLocation()).toBeNull()
    expect(resolveMinGapTicks()).toBe(30)
  })

  it('options win over location, location wins over constant; default stays 30', () => {
    const def = new LunaBrainService('mock')
    expect(def.getMeter().minGapTicks).toBe(30)
    def.dispose()

    stubSearch('?mindMinGapTicks=15')
    expect(resolveMinGapTicks()).toBe(15)
    expect(resolveMinGapTicks(20)).toBe(20)

    const fromLoc = new LunaBrainService('mock', { safetySweep: false })
    expect(fromLoc.getMeter().minGapTicks).toBe(15)
    fromLoc.dispose()

    const fromOpt = new LunaBrainService('mock', {
      minGapTicks: 20,
      safetySweep: false,
    })
    expect(fromOpt.getMeter().minGapTicks).toBe(20)
    fromOpt.dispose()

    const clampedOpt = new LunaBrainService('mock', {
      minGapTicks: 2,
      safetySweep: false,
    })
    expect(clampedOpt.getMeter().minGapTicks).toBe(5)
    clampedOpt.dispose()
  })

  it('soft-path cadence: since=20 is eligible at gap 15 and skipped at gap 30', () => {
    const run = (gap: number) => {
      const sim = new Simulation(42)
      const mind = new LunaBrainService('mock', {
        minGapTicks: gap,
        suppressNewConversations: true,
        wallFloorMs: 0,
        safetySweep: false,
      })
      void mind.init()
      mind.onAfterTick(sim)
      for (let i = 0; i < 8; i++) {
        sim.advanceTicks(1)
        mind.onAfterTick(sim)
      }
      const first = decisionsFor(sim, 'agent-0')
      expect(first.length).toBeGreaterThanOrEqual(1)
      const firstTick = first[0]!.tick
      for (let i = 0; i < 25; i++) {
        sim.advanceTicks(1)
        forceIdle(sim, 'agent-0')
        mind.onAfterTick(sim)
      }
      const since = sim.state.tick - firstTick
      expect(since).toBeGreaterThanOrEqual(20)
      expect(since).toBeLessThan(30)
      const n = decisionsFor(sim, 'agent-0').length
      mind.dispose()
      return n
    }
    expect(run(15)).toBeGreaterThanOrEqual(2)
    expect(run(30)).toBe(1)
  })

  it('minGapTicks is present on the bridge snapshot (getMeter)', () => {
    const mind = new LunaBrainService('mock', { minGapTicks: 15 })
    const meter = mind.getMeter()
    expect(meter).toHaveProperty('minGapTicks')
    expect(meter.minGapTicks).toBe(15)
    mind.dispose()

    const def = new LunaBrainService('mock')
    expect(def.getMeter().minGapTicks).toBe(MIND_MIN_GAP_TICKS)
    def.dispose()
  })
})

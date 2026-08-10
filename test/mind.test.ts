import { describe, expect, it } from 'vitest'
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
  MIND_WALL_TIMEOUT_MS,
} from '../src/mind/lunaBrain'
import { MockProvider } from '../src/mind/providers'

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
    expect(save.formatVersion).toBe(2)
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
    const mind = new LunaBrainService('mock', { provider })
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
      const pendingBefore = mind.getMeter().pending
      if (pendingBefore > 0) {
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

      // One "frame" at effective speed; mid-batch break when mind goes pending
      for (let i = 0; i < effectiveSpeed; i++) {
        if (sim.state.tick >= TWO_DAYS) break
        sim.advanceTicks(1)
        mind.onAfterTick(sim)
        // External intents apply on the subsequent step — nudge once if inbox posted
        if (mind.getMeter().pending > 0 && userSpeed > 1) {
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

    // Drain any in-flight wall answers + external-intent inbox so events catch up
    for (let i = 0; i < WALL_DELAY + 5; i++) {
      provider.advanceWallFrame()
      await Promise.resolve()
      await Promise.resolve()
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 3; i++) {
      sim.advanceTicks(1)
      mind.onAfterTick(sim)
    }

    expect(sim.state.tick).toBeGreaterThanOrEqual(TWO_DAYS)

    const meter = mind.getMeter()
    const stales = sim.getEvents().filter((e) => e.type === 'mind:stale')
    const decisions = sim.getEvents().filter((e) => e.type === 'mind:decision')

    expect(stales.length).toBe(0)
    expect(meter.stales).toBe(0)
    // Every completed (non-stale) decide should have applied as a decision event
    expect(decisions.length).toBe(meter.decisions)
    expect(meter.decisions).toBeGreaterThan(0)
    // No request spam: one in-flight at a time + hard-gap cadence (~120 ticks)
    // ⇒ ~24 calls over 2 days, not thousands. Every dispatch must apply (0 waste).
    expect(meter.decideCalls).toBeLessThan(30)
    expect(meter.decideCalls).toBe(meter.decisions)
    expect(sawThrottle).toBe(true)
    expect(sawRestore).toBe(true)
    // Effective speed restored to user intent after last settle
    expect(mind.getMeter().pending).toBe(0)
  })

  it('stale backstop: intent older than MIND_STALE_TICKS is discarded as mind:stale', async () => {
    const provider = new MockProvider({ wallDelayFrames: 1 })
    const mind = new LunaBrainService('mock', { provider })
    await mind.init()
    const sim = new Simulation(42)

    // Kick a decision at tick 0
    mind.onAfterTick(sim)
    expect(mind.getMeter().pending).toBe(1)
    expect(mind.getDecideCallCount()).toBe(1)
    const requestTick = sim.state.tick

    // Race sim far ahead while the answer is still wall-waiting (no breathe)
    sim.advanceTicks(MIND_STALE_TICKS + 10)
    expect(sim.state.tick - requestTick).toBeGreaterThan(MIND_STALE_TICKS)
    provider.advanceWallFrame()
    // Drain microtasks + macrotask so async decide continuation runs
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()

    const stales = sim.getEvents().filter((e) => e.type === 'mind:stale')
    expect(stales.length).toBe(1)
    expect(stales[0]!.reason).toMatch(/sim-min/)
    expect(mind.getMeter().stales).toBe(1)
    expect(mind.getMeter().decisions).toBe(0)
    expect(mind.getMeter().fallbacks).toBe(0)
    expect(sim.getEvents().filter((e) => e.type === 'mind:decision').length).toBe(0)
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
    const mind = new LunaBrainService('mock', { provider })
    await mind.init()
    const sim = new Simulation(42)

    // Kick first dispatch (async provider path)
    mind.onAfterTick(sim)
    expect(mind.getDecideCallCount()).toBe(1)
    // Drain provider rejection + cooldown entry
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()

    const budgetEvents = sim.getEvents().filter((e) => e.type === 'mind:budget')
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

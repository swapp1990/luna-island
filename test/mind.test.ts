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
import { LunaBrainService, MIND_MIN_GAP_TICKS } from '../src/mind/lunaBrain'
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

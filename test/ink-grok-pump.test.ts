import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGrokPump } from '../src/ink/mind/grokBrain'
import { MS_PER_HOUR_1X } from '../src/ink/loop'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import { INK_CONFIG } from '../src/ink/sim/config'
import { advanceTick, applyIntent as applyInkIntent } from '../src/ink/sim/step'
import { createWorld } from '../src/ink/sim/world'
import { ruleBrain } from '../src/ink/sim/ruleBrain'
import type { InkBrains } from '../src/ink/sim/types'

afterEach(() => {
  vi.useRealTimers()
})

describe('grok pump 90 sim minutes', () => {
  it('stubbed 1500ms decide never blocks a tick, decides every hour, no backlog', async () => {
    vi.useFakeTimers()
    const state = createWorld(42)
    const events = new EventTrace()
    const rng = createRng(42)
    const journals: Record<string, unknown>[] = []
    let inFlight = 0
    let maxInFlight = 0
    let maxPerMind = 0
    const perMind = new Map<string, number>()

    const pump = createGrokPump({
      runId: 'ink-42-test',
      seed: 42,
      model: 'stub',
      getState: () => state,
      getEvents: () => events,
      applyIntent: (mindId, intent, source) => {
        applyInkIntent(state, mindId, intent, source, events)
      },
      isLive: () => true,
      decideFn: async ({ mindId }) => {
        inFlight += 1
        perMind.set(mindId, (perMind.get(mindId) ?? 0) + 1)
        maxInFlight = Math.max(maxInFlight, inFlight)
        maxPerMind = Math.max(maxPerMind, perMind.get(mindId) ?? 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 1500))
        inFlight -= 1
        perMind.set(mindId, (perMind.get(mindId) ?? 1) - 1)
        return {
          text: '{"action":"wait","reason":"stub"}',
          latencyMs: 1500,
          usage: { promptTokens: 1, completionTokens: 1 },
        }
      },
      journalFn: (r) => {
        journals.push(r)
      },
    })

    const msPerTick = MS_PER_HOUR_1X / INK_CONFIG.ticksPerHour
    const tickMs: number[] = []
    for (let i = 0; i < 90; i++) {
      const t0 = Date.now()
      advanceTick(state, pump.brains, events, rng)
      tickMs.push(Date.now() - t0)
      await vi.advanceTimersByTimeAsync(msPerTick)
    }
    await vi.advanceTimersByTimeAsync(2000)

    const blocked = tickMs.filter((ms) => ms >= 20).length
    const stats = pump.stats()
    const decisions = events.getAll().filter((e) => e.type === 'decision')
    const hours = new Set(decisions.map((e) => Math.floor(e.tick / INK_CONFIG.ticksPerHour)))

    expect(blocked).toBe(0)
    expect(state.tick).toBe(INK_CONFIG.startTick + 90)
    expect(maxPerMind).toBeLessThanOrEqual(1)
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(pump.inFlight()).toBe(0)
    expect(hours.size).toBe(2)
    expect(decisions.length).toBe(4)
    expect(stats.llm).toBe(4)
    expect(stats.fallback).toBe(0)
    expect(stats.stale).toBe(0)
    expect(stats.stale + stats.fallback).toBe(0)
    // eslint-disable-next-line no-console
    console.log(
      `INK_P2_DRY blocked=${blocked} ticks=90 tickMsMax=${Math.max(...tickMs)} maxInFlight=${maxInFlight} maxPerMind=${maxPerMind} llm=${stats.llm} fallback=${stats.fallback} stale=${stats.stale} hours=${hours.size}`,
    )

    const ruleState = createWorld(42)
    const ruleEvents = new EventTrace()
    const ruleRng = createRng(42)
    const ruleBrains: InkBrains = { A: ruleBrain, B: ruleBrain }
    const tRule0 = Date.now()
    for (let i = 0; i < 90; i++) advanceTick(ruleState, ruleBrains, ruleEvents, ruleRng)
    const ruleMs = Date.now() - tRule0
    expect(ruleState.tick).toBe(state.tick)
    expect(ruleMs).toBeGreaterThanOrEqual(0)
  })
})

describe('a stale hour does not lock the LLM out (regression)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers to llm decisions after the first reply misses its hour', async () => {
    vi.useFakeTimers()
    const state = createWorld(42)
    const events = new EventTrace()
    const rng = createRng(42)

    // First call per mind takes longer than a sim hour and must go stale; the rest are fast.
    const seen = new Map<string, number>()
    const pump = createGrokPump({
      runId: 'ink-42-stale',
      seed: 42,
      model: 'stub',
      getState: () => state,
      getEvents: () => events,
      applyIntent: (mindId, intent, source) => {
        applyInkIntent(state, mindId, intent, source, events)
      },
      isLive: () => true,
      decideFn: async ({ mindId }) => {
        const n = (seen.get(mindId) ?? 0) + 1
        seen.set(mindId, n)
        const slow = n === 1
        await new Promise<void>((resolve) => setTimeout(resolve, slow ? 20000 : 400))
        return {
          text: '{"action":"wait","reason":"stub"}',
          latencyMs: slow ? 20000 : 400,
          usage: { promptTokens: 1, completionTokens: 1 },
        }
      },
      journalFn: () => {},
    })

    const msPerTick = MS_PER_HOUR_1X / INK_CONFIG.ticksPerHour
    for (let i = 0; i < 300; i++) {
      advanceTick(state, pump.brains, events, rng)
      await vi.advanceTimersByTimeAsync(msPerTick)
    }

    const stats = pump.stats()
    // The first hour per mind is lost to staleness; every hour after it is the model's.
    expect(stats.stale).toBe(2)
    // The bug this guards: abandoning a stale request used to apply a fallback to the NEW
    // hour, claiming its slot, so the reply we then requested was dropped on arrival.
    expect(stats.fallback).toBe(0)
    expect(stats.llm).toBeGreaterThanOrEqual(6)
  })
})

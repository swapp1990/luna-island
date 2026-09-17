import { describe, expect, it } from 'vitest'
import { EventTrace } from '../src/sim/events'
import { createRng } from '../src/sim/rng'
import { TICKS_PER_DAY } from '../src/ink/sim/config'
import { inkHash } from '../src/ink/sim/hash'
import { ruleBrain } from '../src/ink/sim/ruleBrain'
import { advanceTick } from '../src/ink/sim/step'
import type { InkBrains, InkState } from '../src/ink/sim/types'
import { createWorld, isOnRoadGraph } from '../src/ink/sim/world'

const brains: InkBrains = { A: ruleBrain, B: ruleBrain }

function runDays(seed: number, days: number): { state: InkState; events: EventTrace; ms: number } {
  const state = createWorld(seed)
  const events = new EventTrace()
  const rng = createRng(seed)
  const ticks = days * TICKS_PER_DAY
  const t0 = performance.now()
  for (let i = 0; i < ticks; i++) advanceTick(state, brains, events, rng)
  const ms = performance.now() - t0
  return { state, events, ms }
}

describe('ink determinism', () => {
  it('two createWorld(42) weeks match hash and event log', () => {
    const a = runDays(42, 7)
    const b = runDays(42, 7)
    expect(inkHash(a.state)).toBe(inkHash(b.state))
    expect(a.events.length).toBe(b.events.length)
    const ae = a.events.getAll()
    const be = b.events.getAll()
    for (let i = 0; i < ae.length; i++) {
      expect(ae[i]).toEqual(be[i])
    }
  })

  it('a 7-day rule-brain run never throws, NaNs, or leaves the graph', () => {
    const { state, events, ms } = runDays(42, 7)
    expect(events.length).toBeGreaterThan(0)
    for (const mind of state.minds) {
      expect(Number.isFinite(mind.hunger)).toBe(true)
      expect(Number.isFinite(mind.energy)).toBe(true)
      expect(Number.isFinite(mind.social)).toBe(true)
      expect(Number.isNaN(mind.hunger)).toBe(false)
      expect(Number.isNaN(mind.energy)).toBe(false)
      expect(Number.isNaN(mind.social)).toBe(false)
      expect(isOnRoadGraph(mind)).toBe(true)
    }
    const ticks = 7 * TICKS_PER_DAY
    const ticksPerSec = ticks / (ms / 1000)
    expect(ticksPerSec).toBeGreaterThan(0)
    // Stash the measured rate on the global so the audit report can quote it
    // after `vitest` prints this assertion's title.
    console.log(`INK_WEEK_TICKS_PER_SEC ${ticksPerSec.toFixed(1)} mealsA=${eatCount(events, 'A')} mealsB=${eatCount(events, 'B')} moneyA=${state.minds[0].money} moneyB=${state.minds[1].money} sufferedA=${state.minds[0].sufferedHours} sufferedB=${state.minds[1].sufferedHours}`)
  })
})

function eatCount(events: EventTrace, id: string): number {
  return events.getAll().filter((e) => e.type === 'action:ok' && e.agentId === id && e.data?.action === 'eat').length
}

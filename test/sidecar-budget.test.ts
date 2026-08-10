import { describe, expect, it, beforeEach } from 'vitest'
import {
  BudgetTracker,
  handleDecide,
  healthPayload,
  type BudgetPersist,
  type CodexRunner,
  type SidecarDeps,
} from '../scripts/luna-budget'

/** In-memory budget.json stand-in (survives "restart" via shared bag). */
function makeMemoryPersist(bag: { json: string | null }): BudgetPersist {
  return {
    load: () => bag.json,
    save: (json: string) => {
      bag.json = json
    },
  }
}

describe('sidecar hard budget gates (P3-0c)', () => {
  let clock: number
  let runnerCalls: number
  let runner: CodexRunner
  let bag: { json: string | null }
  let budget: BudgetTracker
  let deps: SidecarDeps

  beforeEach(() => {
    clock = Date.parse('2026-08-09T12:00:00')
    runnerCalls = 0
    bag = { json: null }
    runner = async () => {
      runnerCalls += 1
      return { text: '{"action":"wander","reasoning":"ok"}', latencyMs: 5 }
    }
    budget = new BudgetTracker(
      { maxPerHour: 60, maxPerDay: 300 },
      { now: () => clock, persist: makeMemoryPersist(bag) },
    )
    deps = {
      busy: { count: 0, max: 3 },
      budget,
      runner,
    }
  })

  it('61st call within an hour → 402 and runner never invoked', async () => {
    for (let i = 0; i < 60; i++) {
      const r = await handleDecide(deps, { system: 's', user: 'u' })
      expect(r.status).toBe(200)
    }
    expect(runnerCalls).toBe(60)
    expect(budget.snapshot().usedHour).toBe(60)

    const blocked = await handleDecide(deps, { system: 's', user: 'u' })
    expect(blocked.status).toBe(402)
    expect(blocked.json.error).toBe('budget')
    expect(blocked.json.remainingHour).toBe(0)
    expect(typeof blocked.json.resetsInSec).toBe('number')
    expect((blocked.json.resetsInSec as number) > 0).toBe(true)
    // Structural guarantee: no spawn on 402
    expect(runnerCalls).toBe(60)
  })

  it('counters persist across simulated restart (re-read budget.json)', async () => {
    for (let i = 0; i < 7; i++) {
      await handleDecide(deps, { system: 's', user: 'u' })
    }
    expect(budget.snapshot().usedHour).toBe(7)
    expect(budget.snapshot().usedDay).toBe(7)
    expect(bag.json).toBeTruthy()

    // Simulate process restart: new tracker, same persist bag, same clock
    const budget2 = new BudgetTracker(
      { maxPerHour: 60, maxPerDay: 300 },
      { now: () => clock, persist: makeMemoryPersist(bag) },
    )
    expect(budget2.snapshot().usedHour).toBe(7)
    expect(budget2.snapshot().usedDay).toBe(7)

    const deps2: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: budget2,
      runner,
    }
    const next = await handleDecide(deps2, { system: 's', user: 'u' })
    expect(next.status).toBe(200)
    expect(budget2.snapshot().usedHour).toBe(8)
  })

  it('corrupt budget.json → start at 0 but keep day key', () => {
    bag.json = '{not json at all!!!'
    const b = new BudgetTracker(
      { maxPerHour: 60, maxPerDay: 300 },
      { now: () => clock, persist: makeMemoryPersist(bag) },
    )
    const snap = b.snapshot()
    expect(snap.usedHour).toBe(0)
    expect(snap.usedDay).toBe(0)
  })

  it('day rollover resets hourly + daily correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await handleDecide(deps, { system: 's', user: 'u' })
    }
    expect(budget.snapshot().usedDay).toBe(5)
    expect(budget.snapshot().usedHour).toBe(5)

    // Next calendar day
    clock = Date.parse('2026-08-10T01:00:00')
    const snap = budget.snapshot()
    expect(snap.usedDay).toBe(0)
    expect(snap.usedHour).toBe(0)

    const r = await handleDecide(deps, { system: 's', user: 'u' })
    expect(r.status).toBe(200)
    expect(budget.snapshot().usedDay).toBe(1)
    expect(budget.snapshot().usedHour).toBe(1)
  })

  it('rolling hour prunes calls older than 60 wall-minutes', async () => {
    for (let i = 0; i < 3; i++) {
      await handleDecide(deps, { system: 's', user: 'u' })
    }
    expect(budget.snapshot().usedHour).toBe(3)
    // Advance 61 minutes — hour window empty, day counter remains
    clock += 61 * 60 * 1000
    expect(budget.snapshot().usedHour).toBe(0)
    expect(budget.snapshot().usedDay).toBe(3)
  })

  it('health payload exposes budget fields', async () => {
    await handleDecide(deps, { system: 's', user: 'u' })
    const h = healthPayload(budget, '/tmp/luna-mind')
    expect(h.ok).toBe(true)
    expect(h.budget).toEqual({
      usedHour: 1,
      maxHour: 60,
      usedDay: 1,
      maxDay: 300,
    })
  })

  it('daily ceiling → 402 before runner', async () => {
    const tight = new BudgetTracker(
      { maxPerHour: 1000, maxPerDay: 2 },
      { now: () => clock, persist: makeMemoryPersist(bag) },
    )
    const d: SidecarDeps = { busy: { count: 0, max: 3 }, budget: tight, runner }
    expect((await handleDecide(d, {})).status).toBe(200)
    expect((await handleDecide(d, {})).status).toBe(200)
    const before = runnerCalls
    const blocked = await handleDecide(d, {})
    expect(blocked.status).toBe(402)
    expect(blocked.json.remainingDay).toBe(0)
    expect(runnerCalls).toBe(before)
  })

  it('budget check is first gate: 402 even when pool is full', async () => {
    for (let i = 0; i < 60; i++) {
      await handleDecide(deps, {})
    }
    deps.busy.count = deps.busy.max
    const before = runnerCalls
    const blocked = await handleDecide(deps, {})
    expect(blocked.status).toBe(402)
    expect(blocked.json.error).toBe('budget')
    expect(runnerCalls).toBe(before)
  })

  it('concurrency pool: up to K in flight, K+1 → 429', async () => {
    const held: Array<() => void> = []
    const slowRunner: CodexRunner = () =>
      new Promise((resolve) => {
        held.push(() =>
          resolve({ text: '{"action":"wander","reasoning":"ok"}', latencyMs: 1 }),
        )
      })
    const pool: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: new BudgetTracker(
        { maxPerHour: 60, maxPerDay: 300 },
        { now: () => clock, persist: makeMemoryPersist(bag), skipLoad: true },
      ),
      runner: slowRunner,
    }

    const p1 = handleDecide(pool, { system: 's', user: 'u' })
    const p2 = handleDecide(pool, { system: 's', user: 'u' })
    const p3 = handleDecide(pool, { system: 's', user: 'u' })
    // Yield so all three enter the runner
    await Promise.resolve()
    await Promise.resolve()
    expect(pool.busy.count).toBe(3)

    const blocked = await handleDecide(pool, { system: 's', user: 'u' })
    expect(blocked.status).toBe(429)
    expect(blocked.json.error).toBe('busy')
    expect(pool.busy.count).toBe(3)

    // Release one → fourth may proceed
    held.shift()?.()
    await p1
    expect(pool.busy.count).toBe(2)
    const p4 = handleDecide(pool, { system: 's', user: 'u' })
    await Promise.resolve()
    await Promise.resolve()
    expect(pool.busy.count).toBe(3)

    for (const release of held) release()
    await Promise.all([p2, p3, p4])
    expect(pool.busy.count).toBe(0)
  })
})

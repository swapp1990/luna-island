import type { Simulation } from '../sim/sim'
import type { ExternalIntentMeta, Intent, MindNoteMeta, SimEvent } from '../sim/types'
import { toSimTime } from '../sim/time'
import { anyNeedCritical } from '../sim/utilityBrain'
import { isLunaAgent, LUNA_AGENT_IDS } from './personas'
import {
  buildReflectionSystemPrompt,
  buildReflectionUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt'
import { parseMindJson, parseReflectionJson, resolveMindIntent } from './parse'
import {
  BudgetExhaustedProvider,
  CodexProvider,
  DEFAULT_BUDGET_MAX_DAY,
  DEFAULT_BUDGET_MAX_HOUR,
  MockProvider,
  probeSidecarHealth,
  type MindBudgetInfo,
  type MindProvider,
} from './providers'

/** Cadence: min gap after a decision before the soft path. */
export const MIND_MIN_GAP_TICKS = 30
/** Cadence: hard refresh regardless of action state. */
export const MIND_HARD_GAP_TICKS = 120
/** Mock artificial delay (sim ticks) before posting a ready decision. */
export const MOCK_DELAY_TICKS = 3
/**
 * Wall-clock timeout for a mind request → fallback.
 * Aligned above sidecar kill (60s) + CodexProvider (75s) so healthy round-trips
 * are never cut short by the service-level timer.
 */
export const MIND_WALL_TIMEOUT_MS = 75_000
/**
 * Backstop: discard intents older than this many sim minutes after requestTick.
 * With auto-breathe this should rarely fire; ages > 45 mean the world raced ahead.
 */
export const MIND_STALE_TICKS = 45
/** Brief pause before retrying a 429 "still thinking" without a new decideCall. */
const LUNA_BUSY_RETRY_MS = 250
/**
 * Wall-floor: never dispatch two async/sidecar requests for the same agent
 * closer than this many wall-seconds (belt to breathe-throttle suspenders).
 */
export const MIND_WALL_FLOOR_MS = 15_000

export type BrainMode = 'codex' | 'mock' | 'off'

export interface MindExchange {
  agentId: string
  tick: number
  system: string
  user: string
  rawResponse: string
  ok: boolean
}

export interface MindMeter {
  enabled: boolean
  agentIds: string[]
  /** inFlight + holds (inbox not yet applied). */
  pending: number
  /**
   * Wall-bound requests only (sidecar / delayed mock). Auto-breathe keys off this —
   * short mock holds do not throttle the sim.
   */
  thinking: number
  decisions: number
  fallbacks: number
  /** Intent discarded as too old relative to requestTick. */
  stales: number
  meanLatencyMs: number
  approxChars: number
  provider: string
  /** Actual dispatched decide requests (not cadence skips / 429 re-checks). */
  decideCalls: number
  /** Sidecar-authoritative budget (health probe + decide responses). */
  budgetUsedHour: number
  budgetMaxHour: number
  budgetUsedDay: number
  budgetMaxDay: number
  /** True while client-side cooldown after 402 (no further dispatches). */
  budgetCooldown: boolean
}

export interface LunaBrainOptions {
  /** Optional provider override (tests). */
  provider?: MindProvider
  /**
   * Mock-only: wall-frame delay for async decide (pacing tests).
   * Ignored when provider is supplied explicitly.
   */
  mockWallDelayFrames?: number
  /** Mock-only: wall-clock ms delay (browser breathe e2e). */
  mockWallDelayMs?: number
}

interface PendingHold {
  agentId: string
  readyTick: number
  intent: Intent
  meta: ExternalIntentMeta
  exchange: MindExchange
  requestTick: number
}

interface PendingNoteHold {
  agentId: string
  readyTick: number
  notes: string[]
  meta: MindNoteMeta
  exchange: MindExchange
  requestTick: number
  /** Night key this reflection covers (so we mark after apply). */
  nightKey: number
}

interface InFlight {
  agentId: string
  startedTick: number
  startedWall: number
  abort?: AbortController
  kind: 'decision' | 'reflection'
  nightKey?: number
}

/**
 * Night key for bedtime reflection: evening of day D is 19:00 day D through 02:59 day D+1.
 * Returns null outside the sleep window (except callers handle 03:00 fallback separately).
 */
export function reflectionNightKey(tick: number): number | null {
  const t = toSimTime(tick)
  if (t.hour >= 19) return t.day
  if (t.hour < 3) return t.day - 1
  return null
}

/** Calendar day whose events feed the reflection for this night key. */
export function reflectionDayForNightKey(nightKey: number): number {
  return nightKey
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatUntilClock(resetsInSec: number, now = Date.now()): string {
  const until = new Date(now + Math.max(0, resetsInSec) * 1000)
  return `${pad2(until.getHours())}:${pad2(until.getMinutes())}`
}

export function parseBrainQuery(search: string): BrainMode {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const v = (q.get('brain') ?? '').toLowerCase()
  if (v === 'off') return 'off'
  if (v === 'mock') return 'mock'
  if (v === 'codex') return 'codex'
  return 'auto' as BrainMode // resolved async
}

/** 'auto' is internal until health probe settles. */
export type BrainModeOrAuto = BrainMode | 'auto'

export class LunaBrainService {
  private mode: BrainModeOrAuto
  private provider: MindProvider | null = null
  private lastDecisionTick = new Map<string, number>()
  /** Wall-ms of last async dispatch per agent (15s floor). */
  private lastDispatchWall = new Map<string, number>()
  private inFlight = new Map<string, InFlight>()
  private holds: PendingHold[] = []
  private noteHolds: PendingNoteHold[] = []
  private lastExchange = new Map<string, MindExchange>()
  private decideCallCount = 0
  private totalLatency = 0
  private latencySamples = 0
  private totalApproxChars = 0
  private decisions = 0
  private fallbacks = 0
  private stales = 0
  private disposed = false
  private budgetUsedHour = 0
  private budgetMaxHour = DEFAULT_BUDGET_MAX_HOUR
  private budgetUsedDay = 0
  private budgetMaxDay = DEFAULT_BUDGET_MAX_DAY
  /** Wall-ms when budget cooldown ends; 0 = not in cooldown. */
  private budgetCooldownUntil = 0
  /** True once we've emitted mind:budget for the current cooldown episode. */
  private budgetEventEmitted = false
  /** Night keys already reflected (or in-flight/hold) per agent — one reflection per night. */
  private reflectedNights = new Map<string, Set<number>>()

  constructor(mode: BrainModeOrAuto = 'auto', opts?: LunaBrainOptions) {
    this.mode = mode
    if (opts?.provider) {
      this.provider = opts.provider
      if (mode === 'auto') this.mode = 'mock'
      return
    }
    if (mode === 'mock') {
      this.provider = new MockProvider({
        wallDelayFrames: opts?.mockWallDelayFrames,
        wallDelayMs: opts?.mockWallDelayMs,
      })
    } else if (mode === 'codex') {
      this.provider = new CodexProvider()
    } else if (mode === 'off') {
      this.provider = null
    }
    // auto: probe later via init()
  }

  async init(): Promise<void> {
    if (this.provider && this.mode !== 'auto') return
    if (this.mode === 'off') {
      this.provider = null
      return
    }
    if (this.mode === 'mock') {
      this.provider = this.provider ?? new MockProvider()
      return
    }
    if (this.mode === 'codex') {
      this.provider = this.provider ?? new CodexProvider()
      // Best-effort budget from health
      const health = await probeSidecarHealth()
      if (health.budget) this.applyBudgetSnapshot(health.budget)
      return
    }
    // auto — plain URL (no ?brain=): codex if sidecar health ok, else mock
    const health = await probeSidecarHealth()
    if (this.disposed) return
    if (health.ok) {
      this.mode = 'codex'
      this.provider = new CodexProvider()
      if (health.budget) this.applyBudgetSnapshot(health.budget)
      console.info('[luna] auto brain: codex (sidecar /api/luna/health ok)')
    } else {
      this.mode = 'mock'
      this.provider = new MockProvider()
      console.info('[luna] auto brain: mock (sidecar /api/luna/health unavailable)')
    }
  }

  dispose(): void {
    this.disposed = true
    this.inFlight.clear()
    this.holds = []
    this.noteHolds = []
  }

  getMode(): BrainMode {
    if (this.mode === 'auto') return 'mock'
    return this.mode
  }

  isEnabled(): boolean {
    return this.mode !== 'off' && this.provider !== null
  }

  /** Provider decide() invocations (for e2e: scrub must not add calls). */
  getDecideCallCount(): number {
    return this.decideCallCount
  }

  getLastExchange(agentId: string): MindExchange | undefined {
    return this.lastExchange.get(agentId)
  }

  isBudgetCooldown(now = Date.now()): boolean {
    if (this.budgetCooldownUntil <= 0) return false
    if (now >= this.budgetCooldownUntil) {
      this.budgetCooldownUntil = 0
      this.budgetEventEmitted = false
      return false
    }
    return true
  }

  /**
   * Dev/e2e hook: force client budget cooldown + one mind:budget event.
   * Does not call the sidecar.
   */
  forceBudgetCooldown(sim: Simulation, resetsInSec = 3600): void {
    this.enterBudgetCooldown(sim, LUNA_AGENT_IDS[0] ?? 'agent-0', resetsInSec)
  }

  getMeter(): MindMeter {
    const thinking = this.inFlight.size
    const pending = thinking + this.holds.length + this.noteHolds.length
    return {
      enabled: this.isEnabled(),
      agentIds: [...LUNA_AGENT_IDS],
      pending,
      thinking,
      decisions: this.decisions,
      fallbacks: this.fallbacks,
      stales: this.stales,
      meanLatencyMs:
        this.latencySamples > 0
          ? Math.round(this.totalLatency / this.latencySamples)
          : 0,
      approxChars: this.totalApproxChars,
      provider: this.provider?.name ?? 'off',
      decideCalls: this.decideCallCount,
      budgetUsedHour: this.budgetUsedHour,
      budgetMaxHour: this.budgetMaxHour,
      budgetUsedDay: this.budgetUsedDay,
      budgetMaxDay: this.budgetMaxDay,
      budgetCooldown: this.isBudgetCooldown(),
    }
  }

  private hasReflected(agentId: string, nightKey: number): boolean {
    return this.reflectedNights.get(agentId)?.has(nightKey) ?? false
  }

  private markReflected(agentId: string, nightKey: number): void {
    let set = this.reflectedNights.get(agentId)
    if (!set) {
      set = new Set()
      this.reflectedNights.set(agentId, set)
    }
    set.add(nightKey)
  }

  private applyBudgetSnapshot(b: MindBudgetInfo): void {
    if (typeof b.usedHour === 'number') this.budgetUsedHour = b.usedHour
    if (typeof b.maxHour === 'number') this.budgetMaxHour = b.maxHour
    if (typeof b.usedDay === 'number') this.budgetUsedDay = b.usedDay
    if (typeof b.maxDay === 'number') this.budgetMaxDay = b.maxDay
  }

  private enterBudgetCooldown(
    sim: Simulation,
    agentId: string,
    resetsInSec: number,
    budget?: MindBudgetInfo,
  ): void {
    if (budget) this.applyBudgetSnapshot(budget)
    // Force remaining hour display to 0 when exhausted
    if (this.budgetUsedHour < this.budgetMaxHour) {
      this.budgetUsedHour = this.budgetMaxHour
    }
    const sec = Math.max(1, Math.floor(resetsInSec))
    const now = Date.now()
    // Only extend / set; do not re-emit if already in cooldown
    const already = this.isBudgetCooldown(now)
    this.budgetCooldownUntil = Math.max(this.budgetCooldownUntil, now + sec * 1000)
    if (already || this.budgetEventEmitted) return
    this.budgetEventEmitted = true
    const until = formatUntilClock(sec, now)
    const reason = `mind budget exhausted — running on instinct until ${until}`
    sim.postMindBudget(
      agentId,
      {
        reason: 'budget',
        resetsInSec: sec,
        until,
        usedHour: this.budgetUsedHour,
        maxHour: this.budgetMaxHour,
        usedDay: this.budgetUsedDay,
        maxDay: this.budgetMaxDay,
      },
      reason,
    )
  }

  /**
   * Call after each live sim tick (or after each tick inside ffwd).
   * Posts ready holds; may kick off new async decisions / reflections.
   */
  onAfterTick(sim: Simulation): void {
    if (!this.isEnabled() || this.disposed) return
    if (this.mode === 'off' || !this.provider) return

    const tick = sim.state.tick

    // Flush decision holds whose readyTick has arrived
    const ready = this.holds.filter((h) => h.readyTick <= tick)
    this.holds = this.holds.filter((h) => h.readyTick > tick)
    for (const h of ready) {
      if (this.applyOrStale(sim, h.agentId, h.intent, h.meta, h.exchange, h.requestTick)) {
        this.lastDecisionTick.set(h.agentId, tick)
        this.lastExchange.set(h.agentId, h.exchange)
      }
    }

    // Flush reflection note holds
    const readyNotes = this.noteHolds.filter((h) => h.readyTick <= tick)
    this.noteHolds = this.noteHolds.filter((h) => h.readyTick > tick)
    for (const h of readyNotes) {
      this.applyReflectionNotes(sim, h.agentId, h.notes, h.meta, h.exchange, h.nightKey)
    }

    // Wall-timeout in-flight
    const now = Date.now()
    for (const [agentId, flight] of [...this.inFlight.entries()]) {
      if (now - flight.startedWall >= MIND_WALL_TIMEOUT_MS) {
        this.inFlight.delete(agentId)
        this.fallbacks += 1
        sim.postMindFallback(
          agentId,
          {
            reason: 'wall timeout',
            latencyMs: MIND_WALL_TIMEOUT_MS,
            variant: flight.kind === 'reflection' ? 'reflection' : 'decision',
          },
          'Mind request timed out — continuing on instinct',
        )
      }
    }

    // Hard client cooldown: no further dispatches until resetsInSec elapses
    if (this.isBudgetCooldown(now)) return

    // Nightly reflections take priority over routine decisions when due
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.inFlight.has(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
      if (this.noteHolds.some((h) => h.agentId === agentId)) continue
      if (!isLunaAgent(agentId)) continue
      if (!sim.state.agents.find((a) => a.id === agentId)) continue

      const dueNight = this.reflectionDueNightKey(sim, agentId)
      if (dueNight == null) continue

      // Wall-floor for async/sidecar path only
      if (!this.providerPrefersSync()) {
        const lastWall = this.lastDispatchWall.get(agentId) ?? 0
        if (now - lastWall < MIND_WALL_FLOOR_MS) continue
      }

      this.requestReflection(sim, agentId, dueNight)
    }

    // Cadence: request decisions for luna agents
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.inFlight.has(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
      if (this.noteHolds.some((h) => h.agentId === agentId)) continue
      const agent = sim.state.agents.find((a) => a.id === agentId)
      if (!agent || !isLunaAgent(agentId)) continue

      const last = this.lastDecisionTick.get(agentId) ?? -MIND_HARD_GAP_TICKS
      const since = tick - last
      const finished =
        agent.action.kind === 'idle' ||
        (agent.action.kind !== 'sleep' && agent.actionTicks === 0 && !agent.action.path?.length)
      const urgent = anyNeedCritical(agent)
      const softOk = since >= MIND_MIN_GAP_TICKS && (finished || urgent)
      const hardOk = since >= MIND_HARD_GAP_TICKS
      if (!softOk && !hardOk) continue

      // Wall-floor for async/sidecar path only
      if (!this.providerPrefersSync()) {
        const lastWall = this.lastDispatchWall.get(agentId) ?? 0
        if (now - lastWall < MIND_WALL_FLOOR_MS) continue
      }

      this.requestDecision(sim, agentId)
    }
  }

  /**
   * Returns night key if this agent should reflect now (once per night).
   * Triggers: sleep action:start in 19:00–03:00 window, or 03:00 fallback.
   */
  private reflectionDueNightKey(sim: Simulation, agentId: string): number | null {
    const tick = sim.state.tick
    const t = toSimTime(tick)

    // 03:00 fallback: if they never slept this night, reflect now
    if (t.hour === 3 && t.minute === 0) {
      const nightKey = t.day - 1
      if (nightKey >= 1 && !this.hasReflected(agentId, nightKey)) {
        return nightKey
      }
    }

    const nightKey = reflectionNightKey(tick)
    if (nightKey == null || nightKey < 1) return null
    if (this.hasReflected(agentId, nightKey)) return null

    // Sleep started this tick?
    const events = sim.getEvents()
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!
      if (e.tick !== tick) {
        if (e.tick < tick) break
        continue
      }
      if (
        e.agentId === agentId &&
        e.type === 'action:start' &&
        e.data?.kind === 'sleep'
      ) {
        return nightKey
      }
    }
    return null
  }

  private providerPrefersSync(): boolean {
    return (
      this.provider instanceof MockProvider && this.provider.preferSync()
    )
  }

  private requestDecision(sim: Simulation, agentId: string): void {
    if (!this.provider) return
    if (this.isBudgetCooldown()) return
    const agent = sim.state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const tick = sim.state.tick
    const events: readonly SimEvent[] = sim.getEvents()
    const system = buildSystemPrompt(agentId)
    const user = buildUserPrompt(agent, sim.state, events, sim.state.mindNoteLog)
    const provider = this.provider
    const providerName = provider.name

    // Mock sync: fully synchronous so ffwd interleaves decide → 3-tick hold → apply
    if (provider instanceof MockProvider && provider.preferSync()) {
      this.decideCallCount += 1
      const result = provider.decideSync({
        system,
        user,
        agentId,
        tick,
        kind: 'decision',
      })
      this.finishDecision(sim, agentId, system, user, result, providerName, tick)
      return
    }

    const flight: InFlight = {
      agentId,
      startedTick: tick,
      startedWall: Date.now(),
      kind: 'decision',
    }
    this.inFlight.set(agentId, flight)
    this.lastDispatchWall.set(agentId, flight.startedWall)
    // Count only the initial dispatch of a logical decision (429 retries reuse it)
    this.decideCallCount += 1

    const run = async () => {
      // Retry loop for 429 "still thinking" — same flight, no extra decideCalls
      for (;;) {
        if (this.disposed) return
        if (this.inFlight.get(agentId) !== flight) return
        try {
          const result = await provider.decide({
            system,
            user,
            agentId,
            tick,
            kind: 'decision',
          })
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          if (result.budget) this.applyBudgetSnapshot(result.budget)
          this.inFlight.delete(agentId)
          this.finishDecision(sim, agentId, system, user, result, providerName, tick)
          return
        } catch (err) {
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          const code = (err as { code?: string })?.code
          if (code === 'LUNA_BUSY') {
            // Stay in-flight; re-check without counting a new decideCall
            await new Promise<void>((r) => setTimeout(r, LUNA_BUSY_RETRY_MS))
            continue
          }
          if (code === 'LUNA_BUDGET') {
            this.inFlight.delete(agentId)
            const resetsInSec =
              typeof (err as { resetsInSec?: number }).resetsInSec === 'number'
                ? (err as { resetsInSec: number }).resetsInSec
                : 3600
            const budget = (err as { budget?: MindBudgetInfo }).budget
            this.enterBudgetCooldown(sim, agentId, resetsInSec, budget)
            return
          }
          this.inFlight.delete(agentId)
          this.fallbacks += 1
          const msg = err instanceof Error ? err.message : String(err)
          sim.postMindFallback(
            agentId,
            { reason: 'provider error', error: msg },
            `Mind provider error: ${msg}`,
          )
          return
        }
      }
    }

    void run()
  }

  private requestReflection(
    sim: Simulation,
    agentId: string,
    nightKey: number,
  ): void {
    if (!this.provider) return
    if (this.isBudgetCooldown()) return
    // Reserve the night immediately so we don't double-dispatch while in-flight
    this.markReflected(agentId, nightKey)

    const tick = sim.state.tick
    const day = reflectionDayForNightKey(nightKey)
    const events: readonly SimEvent[] = sim.getEvents()
    const system = buildReflectionSystemPrompt(agentId)
    const user = buildReflectionUserPrompt(agentId, events, day)
    const provider = this.provider
    const providerName = provider.name

    if (provider instanceof MockProvider && provider.preferSync()) {
      this.decideCallCount += 1
      const result = provider.decideSync({
        system,
        user,
        agentId,
        tick,
        kind: 'reflection',
      })
      this.finishReflection(
        sim,
        agentId,
        system,
        user,
        result,
        providerName,
        tick,
        nightKey,
      )
      return
    }

    const flight: InFlight = {
      agentId,
      startedTick: tick,
      startedWall: Date.now(),
      kind: 'reflection',
      nightKey,
    }
    this.inFlight.set(agentId, flight)
    this.lastDispatchWall.set(agentId, flight.startedWall)
    this.decideCallCount += 1

    const run = async () => {
      for (;;) {
        if (this.disposed) return
        if (this.inFlight.get(agentId) !== flight) return
        try {
          const result = await provider.decide({
            system,
            user,
            agentId,
            tick,
            kind: 'reflection',
          })
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          if (result.budget) this.applyBudgetSnapshot(result.budget)
          this.inFlight.delete(agentId)
          this.finishReflection(
            sim,
            agentId,
            system,
            user,
            result,
            providerName,
            tick,
            nightKey,
          )
          return
        } catch (err) {
          if (this.disposed) return
          if (this.inFlight.get(agentId) !== flight) return
          const code = (err as { code?: string })?.code
          if (code === 'LUNA_BUSY') {
            await new Promise<void>((r) => setTimeout(r, LUNA_BUSY_RETRY_MS))
            continue
          }
          if (code === 'LUNA_BUDGET') {
            this.inFlight.delete(agentId)
            // Allow retry next night (unmark so 03:00 / next sleep can try)
            this.reflectedNights.get(agentId)?.delete(nightKey)
            const resetsInSec =
              typeof (err as { resetsInSec?: number }).resetsInSec === 'number'
                ? (err as { resetsInSec: number }).resetsInSec
                : 3600
            const budget = (err as { budget?: MindBudgetInfo }).budget
            this.enterBudgetCooldown(sim, agentId, resetsInSec, budget)
            return
          }
          this.inFlight.delete(agentId)
          this.reflectedNights.get(agentId)?.delete(nightKey)
          this.fallbacks += 1
          const msg = err instanceof Error ? err.message : String(err)
          sim.postMindFallback(
            agentId,
            { reason: 'provider error', error: msg, variant: 'reflection' },
            `Mind reflection error: ${msg}`,
          )
          return
        }
      }
    }

    void run()
  }

  private applyReflectionNotes(
    sim: Simulation,
    agentId: string,
    notes: string[],
    meta: MindNoteMeta,
    exchange: MindExchange,
    nightKey: number,
  ): void {
    this.markReflected(agentId, nightKey)
    sim.postMindNotes(agentId, notes, meta)
    this.decisions += 1
    this.lastExchange.set(agentId, exchange)
  }

  private finishReflection(
    sim: Simulation,
    agentId: string,
    system: string,
    user: string,
    result: { text: string; latencyMs: number; approxChars: number },
    providerName: string,
    requestTick: number,
    nightKey: number,
  ): void {
    this.totalLatency += result.latencyMs
    this.latencySamples += 1
    this.totalApproxChars += result.approxChars

    const parsed = parseReflectionJson(result.text)
    const exchange: MindExchange = {
      agentId,
      tick: requestTick,
      system,
      user,
      rawResponse: result.text,
      ok: parsed.ok,
    }
    this.lastExchange.set(agentId, exchange)

    if (!parsed.ok) {
      // Invalid → fallback; unmark so next night can retry
      this.reflectedNights.get(agentId)?.delete(nightKey)
      this.fallbacks += 1
      sim.postMindFallback(
        agentId,
        {
          reason: 'validation error',
          error: parsed.error,
          latencyMs: result.latencyMs,
          approxChars: result.approxChars,
          raw: result.text.slice(0, 400),
          variant: 'reflection',
        },
        `Mind reflection failed: ${parsed.error}`,
      )
      return
    }

    const meta: MindNoteMeta = {
      provider: providerName,
      latencyMs: result.latencyMs,
      approxChars: result.approxChars,
    }

    const delay =
      providerName === 'mock' &&
      this.provider instanceof MockProvider &&
      this.provider.preferSync()
        ? MOCK_DELAY_TICKS
        : 0
    if (delay <= 0) {
      this.applyReflectionNotes(sim, agentId, parsed.notes, meta, exchange, nightKey)
    } else {
      this.noteHolds.push({
        agentId,
        readyTick: sim.state.tick + delay,
        notes: parsed.notes,
        meta,
        exchange,
        requestTick,
        nightKey,
      })
    }
  }

  /**
   * Apply intent if fresh; otherwise emit mind:stale (not a generic fallback).
   * @returns true when applied
   */
  private applyOrStale(
    sim: Simulation,
    agentId: string,
    intent: Intent,
    meta: ExternalIntentMeta,
    exchange: MindExchange,
    requestTick: number,
  ): boolean {
    const age = sim.state.tick - requestTick
    if (age > MIND_STALE_TICKS) {
      this.stales += 1
      sim.postMindStale(
        agentId,
        {
          reason: 'stale intent',
          requestTick,
          applyTick: sim.state.tick,
          ageTicks: age,
          staleAfterTicks: MIND_STALE_TICKS,
          latencyMs: meta.latencyMs,
          approxChars: meta.approxChars,
        },
        `Mind intent arrived ${age} sim-min after observation (limit ${MIND_STALE_TICKS}) — discarded`,
      )
      this.lastExchange.set(agentId, exchange)
      return false
    }
    sim.postExternalIntent(agentId, intent, meta)
    this.decisions += 1
    return true
  }

  private finishDecision(
    sim: Simulation,
    agentId: string,
    system: string,
    user: string,
    result: { text: string; latencyMs: number; approxChars: number },
    providerName: string,
    requestTick: number,
  ): void {
    this.totalLatency += result.latencyMs
    this.latencySamples += 1
    this.totalApproxChars += result.approxChars

    const parsed = parseMindJson(result.text)
    const exchange: MindExchange = {
      agentId,
      tick: requestTick,
      system,
      user,
      rawResponse: result.text,
      ok: parsed.ok,
    }
    this.lastExchange.set(agentId, exchange)

    if (!parsed.ok) {
      this.fallbacks += 1
      sim.postMindFallback(
        agentId,
        {
          reason: 'validation error',
          error: parsed.error,
          latencyMs: result.latencyMs,
          approxChars: result.approxChars,
          raw: result.text.slice(0, 400),
        },
        `Mind validation failed: ${parsed.error}`,
      )
      return
    }

    const liveAgent = sim.state.agents.find((a) => a.id === agentId)
    if (!liveAgent) return
    const intent = resolveMindIntent(sim.state, liveAgent, parsed.raw)
    const meta: ExternalIntentMeta = {
      reasoning: parsed.raw.reasoning,
      source: 'luna',
      provider: providerName,
      latencyMs: result.latencyMs,
      approxChars: result.approxChars,
    }

    // Sync mock path keeps a short hold so ffwd interleaves apply mid-batch.
    // Async paths (codex / delayed mock) apply immediately subject to stale guard.
    const delay =
      providerName === 'mock' &&
      this.provider instanceof MockProvider &&
      this.provider.preferSync()
        ? MOCK_DELAY_TICKS
        : 0
    const readyTick = sim.state.tick + delay
    if (delay <= 0) {
      if (this.applyOrStale(sim, agentId, intent, meta, exchange, requestTick)) {
        this.lastDecisionTick.set(agentId, sim.state.tick)
      }
    } else {
      this.holds.push({
        agentId,
        readyTick,
        intent,
        meta,
        exchange,
        requestTick,
      })
    }
  }
}

/** Re-export for tests that inject 402-style providers. */
export { BudgetExhaustedProvider }

/** Read ?brain= from window location (browser). */
export function brainModeFromLocation(): BrainModeOrAuto {
  if (typeof window === 'undefined') return 'off'
  const q = new URLSearchParams(window.location.search)
  const v = (q.get('brain') ?? '').toLowerCase()
  if (v === 'off') return 'off'
  if (v === 'mock') return 'mock'
  if (v === 'codex') return 'codex'
  return 'auto'
}

/**
 * Optional mock wall-clock delay from `?mindWallMs=` (breathe e2e).
 * Only applied when brain=mock.
 */
export function mockWallDelayMsFromLocation(): number {
  if (typeof window === 'undefined') return 0
  const q = new URLSearchParams(window.location.search)
  const raw = q.get('mindWallMs')
  if (raw == null || raw === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(30_000, Math.floor(n))
}

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
import {
  parseMindJson,
  parseReflectionJson,
  parseSayJson,
  resolveMindIntent,
} from './parse'
import {
  BudgetExhaustedProvider,
  CodexProvider,
  DEFAULT_BUDGET_MAX_DAY,
  DEFAULT_BUDGET_MAX_HOUR,
  GrokProvider,
  MockProvider,
  probeSidecarHealth,
  type MindBudgetInfo,
  type MindProvider,
} from './providers'
import {
  MindDispatchQueue,
  resolveLunaConcurrency,
  type MindQueueEntry,
} from './dispatchQueue'
import {
  applyCooldowns,
  buildConversationSystemPrompt,
  buildConversationUserPrompt,
  conversationContinues,
  findEligiblePairs,
  MAX_ACTIVE_CONVERSATIONS,
  MAX_CONVERSATION_TURNS,
  partnerOf,
  startConversation,
  TRAILS_OFF,
  type ActiveConversation,
} from './conversation'
import { selectSheepReply } from './sheepTalk'

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
 * Rolling rate window (ms): at most K dispatches may start within this window
 * (token-bucket / timestamp window). Same spam protection as the old 15 s gap,
 * but batch-aware for the concurrency-K pool.
 */
export const MIND_WALL_FLOOR_MS = 15_000

export type BrainMode = 'codex' | 'grok' | 'mock' | 'off'

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
   * Wall-bound pipeline: queue depth + in-flight workers + rate-floor wait.
   * Auto-breathe keys off this so the world stays at 1× for the ENTIRE line drain
   * (including windows where nothing is in flight but work is still waiting out
   * the rolling rate floor). Short mock holds do not count.
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
  /** Worker pool size K (1–4). Default from resolveLunaConcurrency(). */
  concurrency?: number
  /**
   * Rolling rate-window length in ms (default MIND_WALL_FLOOR_MS).
   * Set 0 to disable the rate floor (tests that only care about pool size).
   */
  wallFloorMs?: number
  /** Injectable clock for rate-window tests. */
  now?: () => number
  /**
   * Called after apply-on-resolve / rate-floor retry so the host can refresh
   * `__simState.mind` and breathe without waiting for a frame.
   */
  onPipelineChange?: () => void
  /**
   * 1s safety sweep (browser default on). Idempotent belt: only acts if a
   * continuation missed work. Tests stay off unless set true (must dispose).
   */
  safetySweep?: boolean
  /**
   * Test-only: never start NEW conversations (existing turns still run).
   * Also set by `?noNewConversations=1` so drain e2e does not rely on
   * production headroom.
   */
  suppressNewConversations?: boolean
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
  learned?: string[]
  meta: MindNoteMeta
  exchange: MindExchange
  requestTick: number
  /** Night key this reflection covers (so we mark after apply). */
  nightKey: number
}

interface PendingSayHold {
  agentId: string
  partnerId: string
  conversationId: string
  turn: number
  readyTick: number
  text: string
  done: boolean
  exchange: MindExchange
  requestTick: number
  /** Sheep template replies (P3-2c). */
  source?: 'luna' | 'template'
}

interface InFlight {
  agentId: string
  startedTick: number
  startedWall: number
  abort?: AbortController
  kind: 'decision' | 'conversation' | 'reflection'
  nightKey?: number
  conversationId?: string
  partnerId?: string
  turn?: number
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
  if (v === 'grok') return 'grok'
  return 'auto' as BrainMode // resolved async
}

/** 'auto' is internal until health probe settles. */
export type BrainModeOrAuto = BrainMode | 'auto'

export class LunaBrainService {
  private mode: BrainModeOrAuto
  private provider: MindProvider | null = null
  private lastDecisionTick = new Map<string, number>()
  /**
   * Local FIFO for async/sidecar work. Up to K provider.decide calls in flight;
   * the rest wait here without contacting the sidecar.
   */
  private readonly queue = new MindDispatchQueue(LUNA_AGENT_IDS.length)
  /** Currently dispatched (provider-facing) requests — at most `concurrency`. */
  private activeDispatches = new Map<string, InFlight>()
  /**
   * Wall timestamps of recent dispatch starts (rolling rate window).
   * At most `concurrency` starts within `wallFloorMs`.
   */
  private dispatchWallTimes: number[] = []
  private holds: PendingHold[] = []
  private noteHolds: PendingNoteHold[] = []
  private sayHolds: PendingSayHold[] = []
  private lastExchange = new Map<string, MindExchange>()
  /** Last decision (not conversation/reflection) exchange — Mind tab / e2e. */
  private lastDecisionExchange = new Map<string, MindExchange>()
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
  /** One extra decision opportunity per (agent, open proposal). */
  private proposalBumpDone = new Set<string>()
  /** Latest live sim (for prompt rebuild at dispatch). */
  private latestSim: Simulation | null = null
  /**
   * Active conversations island-wide (P3-2c: max 2; at most one mind↔mind).
   */
  private activeConvs: ActiveConversation[] = []
  private pairLastEnd = new Map<string, number>()
  private agentLastEnd = new Map<string, number>()
  /** Worker pool size K (1–4). */
  private readonly concurrency: number
  /** Rolling rate-window length; 0 = unlimited. */
  private readonly wallFloorMs: number
  private readonly nowFn: () => number
  /** True when pump wanted to dispatch but was blocked only by the rate floor. */
  private rateFloorWaiting = false
  /** Host hook: refresh bridge + breathe after a completion (no rAF). */
  private onPipelineChange: (() => void) | null
  /** Rate-floor retry — setTimeout only; delay may stretch under hidden-tab throttle. */
  private rateFloorTimer: ReturnType<typeof setTimeout> | null = null
  /** 1s belt; no-op when apply-on-resolve already drained the line. */
  private safetySweepTimer: ReturnType<typeof setInterval> | null = null
  /** Times the sweep actually dispatched or applied missed work. */
  private safetySweepHits = 0
  /** Test/e2e: block new conversation starts (not in-progress turns). */
  private readonly suppressNewConversations: boolean

  constructor(mode: BrainModeOrAuto = 'auto', opts?: LunaBrainOptions) {
    this.mode = mode
    this.concurrency = resolveLunaConcurrency({ explicit: opts?.concurrency })
    this.suppressNewConversations =
      opts?.suppressNewConversations === true || noNewConversationsFromLocation()
    const floorFromLoc = mindWallFloorMsFromLocation()
    this.wallFloorMs =
      opts?.wallFloorMs != null
        ? Math.max(0, Math.floor(opts.wallFloorMs))
        : floorFromLoc != null
          ? floorFromLoc
          : MIND_WALL_FLOOR_MS
    this.nowFn = opts?.now ?? (() => Date.now())
    this.onPipelineChange = opts?.onPipelineChange ?? null
    const sweepDefault = typeof window !== 'undefined'
    if (opts?.safetySweep ?? sweepDefault) this.startSafetySweep()
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
    } else if (mode === 'grok') {
      this.provider = new GrokProvider()
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
    if (this.mode === 'grok') {
      this.provider = this.provider ?? new GrokProvider()
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
    this.clearRateFloorTimer()
    this.stopSafetySweep()
    this.clearQueueUnmarkReflections()
    this.activeDispatches.clear()
    this.dispatchWallTimes = []
    this.rateFloorWaiting = false
    this.holds = []
    this.noteHolds = []
    this.sayHolds = []
    this.activeConvs = []
    this.latestSim = null
    this.onPipelineChange = null
  }

  /**
   * Times the 1s safety sweep actually did work (missed apply / dispatch).
   * Normal apply-on-resolve path leaves this at 0.
   */
  getSafetySweepHits(): number {
    return this.safetySweepHits
  }

  /** Test helper: run one sweep pass (does not start the interval). */
  safetySweepOnce(): void {
    this.safetySweep()
  }

  /** Test/dev: configured worker-pool size. */
  getConcurrency(): number {
    return this.concurrency
  }

  /** Test/e2e: first active conversation (null if none). */
  getActiveConversation(): ActiveConversation | null {
    return this.activeConvs[0] ?? null
  }

  /** Test/e2e: all active conversations. */
  getActiveConversations(): ActiveConversation[] {
    return this.activeConvs.slice()
  }

  private convById(id: string | undefined | null): ActiveConversation | null {
    if (!id) return null
    return this.activeConvs.find((c) => c.id === id) ?? null
  }

  private busyConversationAgentIds(): Set<string> {
    const s = new Set<string>()
    for (const c of this.activeConvs) {
      s.add(c.agentIdA)
      s.add(c.agentIdB)
    }
    return s
  }

  private mindMindActiveCount(): number {
    return this.activeConvs.filter((c) => !c.mixed).length
  }

  /** Sync participation hold onto the sim so UtilityBrain defers redecide. */
  private syncConversationHold(sim: Simulation): void {
    const ids: string[] = []
    for (const c of this.activeConvs) {
      ids.push(c.agentIdA, c.agentIdB)
    }
    sim.setConversationHold(ids)
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

  /** Last decision prompt/response (ignores conversation turns). */
  getLastDecisionExchange(agentId: string): MindExchange | undefined {
    return this.lastDecisionExchange.get(agentId)
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
    // Breathe for the whole line: queue + in-flight + rate-floor wait
    const lineDepth =
      this.queue.size() +
      this.activeDispatches.size +
      (this.rateFloorWaiting ? 1 : 0)
    const thinking = lineDepth
    const pending =
      thinking + this.holds.length + this.noteHolds.length + this.sayHolds.length
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

  /** Agent is queued or has an in-flight provider call (one mind one voice). */
  private isPipelineBusy(agentId: string): boolean {
    if (this.activeDispatches.has(agentId)) return true
    return this.queue.has(agentId)
  }

  /** Prune rolling dispatch timestamps; true if a new start is allowed. */
  private canStartByRate(now: number): boolean {
    if (this.wallFloorMs <= 0) return true
    const cutoff = now - this.wallFloorMs
    this.dispatchWallTimes = this.dispatchWallTimes.filter((t) => t > cutoff)
    return this.dispatchWallTimes.length < this.concurrency
  }

  private notifySettled(): void {
    this.onPipelineChange?.()
  }

  private unrefTimer(id: ReturnType<typeof setTimeout>): void {
    if (typeof id === 'object' && id && 'unref' in id) {
      const t = id as { unref?: () => void }
      t.unref?.()
    }
  }

  private clearRateFloorTimer(): void {
    if (this.rateFloorTimer != null) {
      clearTimeout(this.rateFloorTimer)
      this.rateFloorTimer = null
    }
  }

  /** Ms until the oldest dispatch falls out of the rolling window (min 1). */
  private msUntilRateSlot(now: number): number {
    if (this.wallFloorMs <= 0) return 0
    const cutoff = now - this.wallFloorMs
    const live = this.dispatchWallTimes.filter((t) => t > cutoff)
    if (live.length < this.concurrency) return 0
    let oldest = live[0]!
    for (const t of live) if (t < oldest) oldest = t
    return Math.max(1, oldest + this.wallFloorMs - now)
  }

  /**
   * Schedule a single rate-floor retry. Promise completions are not throttled;
   * this timeout may stretch under hidden-tab timer throttling — that's ok.
   */
  private scheduleRateFloorRetry(sim: Simulation): void {
    if (this.rateFloorTimer != null || this.disposed) return
    const wait = this.msUntilRateSlot(this.nowFn())
    if (wait <= 0) return
    this.rateFloorTimer = setTimeout(() => {
      this.rateFloorTimer = null
      if (this.disposed) return
      const applySim = this.latestSim ?? sim
      this.pumpDispatch(applySim)
      this.notifySettled()
    }, wait)
    this.unrefTimer(this.rateFloorTimer)
  }

  private startSafetySweep(): void {
    if (this.safetySweepTimer != null) return
    this.safetySweepTimer = setInterval(() => this.safetySweep(), 1000)
    this.unrefTimer(this.safetySweepTimer)
  }

  private stopSafetySweep(): void {
    if (this.safetySweepTimer != null) {
      clearInterval(this.safetySweepTimer)
      this.safetySweepTimer = null
    }
  }

  /**
   * Belt: pick up a missed continuation or a dropped rate-floor timer.
   * No-op when apply-on-resolve already did the work.
   */
  private safetySweep(): void {
    if (this.disposed || !this.isEnabled() || !this.latestSim) return
    const sim = this.latestSim
    const beforeCalls = this.decideCallCount
    const beforeDecisions = this.decisions
    const beforeFallbacks = this.fallbacks
    const beforeStales = this.stales
    const expired = this.expireWallTimeouts(sim)
    this.pumpDispatch(sim)
    const didWork =
      expired > 0 ||
      this.decideCallCount !== beforeCalls ||
      this.decisions !== beforeDecisions ||
      this.fallbacks !== beforeFallbacks ||
      this.stales !== beforeStales
    if (didWork) {
      this.safetySweepHits += 1
      this.notifySettled()
    }
  }

  /** Conversation lane: block turn N+1 until turn N is applied (no in-flight/hold). */
  private isConversationLaneBlocked(entry: MindQueueEntry): boolean {
    if (entry.kind !== 'conversation' || !entry.conversationId) return false
    const cid = entry.conversationId
    for (const f of this.activeDispatches.values()) {
      if (f.kind === 'conversation' && f.conversationId === cid) return true
    }
    if (this.sayHolds.some((h) => h.conversationId === cid)) return true
    return false
  }

  /** Drop dead queue/hold state when a conversation ends. */
  private dropConversationPipeline(conversationId: string): void {
    this.sayHolds = this.sayHolds.filter((h) => h.conversationId !== conversationId)
    // leave in-flight; wall-timeout / finish path will no-op if conv gone
  }

  private isEntryDispatchable(entry: MindQueueEntry): boolean {
    if (this.activeDispatches.has(entry.agentId)) return false
    if (this.isConversationLaneBlocked(entry)) return false
    return true
  }

  private clearQueueUnmarkReflections(): void {
    for (const e of this.queue.clear()) {
      if (e.kind === 'reflection' && e.nightKey != null) {
        this.reflectedNights.get(e.agentId)?.delete(e.nightKey)
      }
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
   * Posts ready holds; may kick off new async decisions / conversations / reflections.
   * @param opts.allowNewConversations default true. Loop passes false while
   *   userSpeed > 1 so high-speed / breathe restore is not wedged by re-seeding chats.
   */
  onAfterTick(
    sim: Simulation,
    opts?: { allowNewConversations?: boolean },
  ): void {
    if (!this.isEnabled() || this.disposed) return
    if (this.mode === 'off' || !this.provider) return

    this.latestSim = sim
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
      this.applyReflectionNotes(
        sim,
        h.agentId,
        h.notes,
        h.meta,
        h.exchange,
        h.nightKey,
        h.learned,
      )
    }

    // Flush conversation say holds
    const readySays = this.sayHolds.filter((h) => h.readyTick <= tick)
    this.sayHolds = this.sayHolds.filter((h) => h.readyTick > tick)
    for (const h of readySays) {
      this.applySayHold(sim, h)
    }

    // Interrupt / advance active conversations after holds applied
    this.tickConversations(sim)
    this.syncConversationHold(sim)

    // Wall-timeout for each in-flight request (queue wait does not consume it)
    this.expireWallTimeouts(sim)

    // Drop queue entries for agents that no longer exist (world reset mid-line)
    const valid = new Set(sim.state.agents.map((a) => a.id))
    for (const e of this.queue.pruneInvalid(valid)) {
      if (e.kind === 'reflection' && e.nightKey != null) {
        this.reflectedNights.get(e.agentId)?.delete(e.nightKey)
      }
      if (e.kind === 'conversation') {
        const ac = this.convById(e.conversationId)
        if (ac) ac.turnInFlight = false
      }
    }

    // Hard client cooldown: no further enqueues / dispatches until reset
    const now = this.nowFn()
    if (this.isBudgetCooldown(now)) {
      this.syncConversationHold(sim)
      return
    }

    // Nightly reflections take priority over routine decisions when due.
    // Rate floor is enforced only at pumpDispatch — enqueue freely so breathe
    // spans the whole line (including floor-wait windows).
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.isPipelineBusy(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
      if (this.noteHolds.some((h) => h.agentId === agentId)) continue
      if (this.sayHolds.some((h) => h.agentId === agentId)) continue
      if (!isLunaAgent(agentId)) continue
      if (!sim.state.agents.find((a) => a.id === agentId)) continue

      const dueNight = this.reflectionDueNightKey(sim, agentId)
      if (dueNight == null) continue

      this.requestReflection(sim, agentId, dueNight)
    }

    // Conversation turns (participants' decision cadence suspended while active).
    // Drive from applied-tick hooks so ffwd + pure advanceTicks advance turns
    // without any rAF / render loop.
    for (const c of this.activeConvs.slice()) {
      if (c.turnInFlight || c.closed) continue
      const speakerId = c.nextSpeakerId
      // Sheep turns never use the mind pipeline
      if (!isLunaAgent(speakerId)) {
        this.requestConversationTurn(sim, c)
        continue
      }
      if (
        !this.isPipelineBusy(speakerId) &&
        !this.holds.some((h) => h.agentId === speakerId) &&
        !this.noteHolds.some((h) => h.agentId === speakerId) &&
        !this.sayHolds.some((h) => h.agentId === speakerId)
      ) {
        this.requestConversationTurn(sim, c)
      }
    }

    // Try to start new conversations (max 2; ≤1 mind↔mind)
    if (opts?.allowNewConversations !== false) {
      this.tryStartConversations(sim)
    }

    // Cadence: request decisions for luna agents (skip conversation participants)
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.isInActiveConversation(agentId)) continue
      if (this.isPipelineBusy(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
      if (this.noteHolds.some((h) => h.agentId === agentId)) continue
      if (this.sayHolds.some((h) => h.agentId === agentId)) continue
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
      const bumpId = this.unusedProposalBump(sim, agentId)
      if (!softOk && !hardOk && !bumpId) continue
      if (!softOk && !hardOk && bumpId) this.markProposalBump(agentId, bumpId)

      this.requestDecision(sim, agentId)
    }

    this.syncConversationHold(sim)
    // Fill free pool slots if anything is waiting
    this.pumpDispatch(sim)
  }

  private isInActiveConversation(agentId: string): boolean {
    return this.activeConvs.some(
      (c) => c.agentIdA === agentId || c.agentIdB === agentId,
    )
  }

  private unusedProposalBump(sim: Simulation, agentId: string): string | null {
    const open = (sim.state.proposals ?? []).filter((p) => p.status === 'open')
    for (const p of open) {
      const key = `${agentId}:${p.id}`
      if (!this.proposalBumpDone.has(key)) return p.id
    }
    return null
  }

  private markProposalBump(agentId: string, proposalId: string): void {
    this.proposalBumpDone.add(`${agentId}:${proposalId}`)
  }

  /** Start eligible pairs up to capacity (deterministic order). */
  private tryStartConversations(sim: Simulation): void {
    // Test-only: ?noNewConversations=1 (or explicit opt) forces the old
    // quiet-line drain — production uses headroom instead.
    if (this.suppressNewConversations) return
    // Headroom: start when at most K−2 lanes are in flight (K=3 → ≤1 busy),
    // always leaving a lane for decisions. Queue / rate-floor wait no longer
    // block new chats. Speeds > 1× still suppress via allowNewConversations.
    if (this.activeDispatches.size > this.concurrency - 2) return
    while (this.activeConvs.length < MAX_ACTIVE_CONVERSATIONS) {
      const busy = this.busyConversationAgentIds()
      const allowMindMind = this.mindMindActiveCount() < 1
      const pairs = findEligiblePairs(
        sim.state,
        this.pairLastEnd,
        this.agentLastEnd,
        busy,
        { allowMindMind },
      )
      if (pairs.length === 0) break
      const pair = pairs[0]!
      const conv = startConversation(sim, pair.a, pair.b)
      this.activeConvs.push(conv)
      this.requestConversationTurn(sim, conv)
      // At most one new conversation per tick (eligibility otherwise unchanged).
      break
    }
  }

  /**
   * Interrupt if either participant MOVES or any need goes urgent (< 0.15).
   * Action kind (eat/work/socialize) does not end a sticky conversation.
   */
  private tickConversations(sim: Simulation): void {
    const doomed: ActiveConversation[] = []
    for (const c of this.activeConvs) {
      if (c.closed) {
        doomed.push(c)
        continue
      }
      const a = sim.state.agents.find((x) => x.id === c.agentIdA)
      const b = sim.state.agents.find((x) => x.id === c.agentIdB)
      if (!a || !b || !conversationContinues(a, b)) {
        doomed.push(c)
      }
    }
    for (const c of doomed) {
      this.endConversationInterrupted(sim, c)
    }
  }

  private endConversationInterrupted(sim: Simulation, c?: ActiveConversation | null): void {
    const conv = c ?? this.activeConvs[0] ?? null
    if (!conv) return
    // Capture + drop pending holds for this conversation
    const pending = this.sayHolds.filter((h) => h.conversationId === conv.id)
    this.sayHolds = this.sayHolds.filter((h) => h.conversationId !== conv.id)

    if (!conv.closed) {
      // Prefer applying a dropped hold as the terminal done say; else re-mark last line
      const hold = pending[pending.length - 1]
      if (hold) {
        sim.postSay(
          hold.conversationId,
          hold.agentId,
          hold.partnerId,
          hold.turn,
          hold.text,
          true,
          hold.source ??
            (hold.agentId && !isLunaAgent(hold.agentId) ? 'template' : undefined),
        )
        // Mind holds already consumed a decideCall — count the applied outcome
        if (hold.source !== 'template') this.decisions += 1
        conv.closed = true
      } else if (conv.transcript.length > 0 && conv.lastText) {
        const speaker = conv.transcript[conv.transcript.length - 1]!.agentId
        const partner = partnerOf(conv, speaker)
        sim.postSay(
          conv.id,
          speaker,
          partner,
          Math.max(0, conv.nextTurn - 1),
          conv.lastText,
          true,
          !isLunaAgent(speaker) ? 'template' : undefined,
        )
        conv.closed = true
      }
    }
    applyCooldowns(
      this.pairLastEnd,
      this.agentLastEnd,
      conv.agentIdA,
      conv.agentIdB,
      sim.state.tick,
    )
    this.activeConvs = this.activeConvs.filter((x) => x.id !== conv.id)
    this.dropConversationPipeline(conv.id)
    this.syncConversationHold(sim)
  }

  private endConversationClean(
    sim: Simulation,
    lastSpeaker: string,
    c?: ActiveConversation | null,
  ): void {
    const target =
      c ??
      this.activeConvs.find(
        (x) => x.agentIdA === lastSpeaker || x.agentIdB === lastSpeaker,
      ) ??
      null
    if (!target) return
    target.closed = true
    target.turnInFlight = false
    this.sayHolds = this.sayHolds.filter((h) => h.conversationId !== target.id)
    applyCooldowns(
      this.pairLastEnd,
      this.agentLastEnd,
      target.agentIdA,
      target.agentIdB,
      sim.state.tick,
    )
    this.activeConvs = this.activeConvs.filter((x) => x.id !== target.id)
    this.dropConversationPipeline(target.id)
    this.syncConversationHold(sim)
  }

  private finishConversationTrailsOff(
    sim: Simulation,
    agentId: string,
    partnerId: string,
    conversationId: string,
    turn: number,
  ): void {
    const c = this.convById(conversationId)
    if (c && c.closed) return
    sim.postSay(conversationId, agentId, partnerId, turn, TRAILS_OFF, true)
    this.decisions += 1
    if (c) {
      c.lastText = TRAILS_OFF
      c.transcript.push({
        agentId,
        name: sim.state.agents.find((a) => a.id === agentId)?.name ?? agentId,
        text: TRAILS_OFF,
      })
      c.closed = true
      this.endConversationClean(sim, agentId, c)
    }
  }

  private applySayHold(sim: Simulation, h: PendingSayHold): void {
    const c = this.convById(h.conversationId)
    if (!c || c.closed) return
    sim.postSay(
      h.conversationId,
      h.agentId,
      h.partnerId,
      h.turn,
      h.text,
      h.done,
      h.source,
    )
    this.lastExchange.set(h.agentId, h.exchange)
    // Sheep templates are not mind dispatches — do not inflate decisions meter
    if (h.source !== 'template') this.decisions += 1
    this.onSayApplied(sim, h.agentId, h.partnerId, h.conversationId, h.turn, h.text, h.done)
  }

  private onSayApplied(
    sim: Simulation,
    agentId: string,
    partnerId: string,
    conversationId: string,
    turn: number,
    text: string,
    done: boolean,
  ): void {
    const c = this.convById(conversationId)
    if (!c || c.closed) return
    const name = sim.state.agents.find((a) => a.id === agentId)?.name ?? agentId
    c.transcript.push({ agentId, name, text })
    c.lastText = text
    c.turnInFlight = false
    c.nextTurn = turn + 1
    c.nextSpeakerId = partnerId
    if (done || c.nextTurn >= MAX_CONVERSATION_TURNS) {
      c.closed = true
      this.endConversationClean(sim, agentId, c)
    }
  }

  /**
   * Request next utterance for a conversation.
   * Mind turns → provider (budgeted). Sheep turns → sheepTalk templates (0 calls).
   */
  private requestConversationTurn(sim: Simulation, c: ActiveConversation): void {
    if (!this.provider && isLunaAgent(c.nextSpeakerId)) return
    if (this.isBudgetCooldown() && isLunaAgent(c.nextSpeakerId)) return
    if (c.turnInFlight) return
    if (c.nextTurn >= MAX_CONVERSATION_TURNS) {
      this.endConversationClean(sim, c.nextSpeakerId, c)
      return
    }

    const agentId = c.nextSpeakerId
    const partnerId = partnerOf(c, agentId)
    const turn = c.nextTurn

    // Sheep path: deterministic template, zero LLM / decideCalls
    if (!isLunaAgent(agentId)) {
      this.applySheepTurn(sim, c, agentId, partnerId, turn)
      return
    }

    if (!this.provider) return
    const provider = this.provider
    c.turnInFlight = true

    if (provider instanceof MockProvider && provider.preferSync()) {
      const speaker = sim.state.agents.find((a) => a.id === agentId)
      const partner = sim.state.agents.find((a) => a.id === partnerId)
      if (!speaker || !partner) {
        c.turnInFlight = false
        this.endConversationInterrupted(sim, c)
        return
      }
      const tick = sim.state.tick
      const events: readonly SimEvent[] = sim.getEvents()
      const system = buildConversationSystemPrompt(agentId)
      const user = buildConversationUserPrompt(
        speaker,
        partner,
        sim.state,
        events,
        c.transcript,
      )
      this.decideCallCount += 1
      const result = provider.decideSync({
        system,
        user,
        agentId,
        tick,
        kind: 'conversation',
      })
      this.finishConversationTurn(
        sim,
        agentId,
        partnerId,
        c.id,
        turn,
        system,
        user,
        result,
        provider.name,
        tick,
      )
      return
    }

    if (this.isPipelineBusy(agentId)) {
      c.turnInFlight = false
      return
    }
    const enq = this.queue.enqueue({
      agentId,
      kind: 'conversation',
      conversationId: c.id,
      partnerId,
      turn,
    })
    if (enq !== 'enqueued') {
      c.turnInFlight = false
      return
    }
    this.pumpDispatch(sim)
  }

  /**
   * Sheep template reply — same applied-tick/hold pipeline as mind says so
   * ffwd advances multi-turn chats without rAF.
   */
  private applySheepTurn(
    sim: Simulation,
    c: ActiveConversation,
    agentId: string,
    partnerId: string,
    turn: number,
  ): void {
    const sheep = sim.state.agents.find((a) => a.id === agentId)
    const partner = sim.state.agents.find((a) => a.id === partnerId)
    if (!sheep || !partner) {
      this.endConversationInterrupted(sim, c)
      return
    }
    c.turnInFlight = true
    const reply = selectSheepReply({
      sheep,
      partner,
      world: sim.state,
      conversationId: c.id,
      turn,
    })
    // Force done on last slot even if template said otherwise
    let done = reply.done
    if (turn + 1 >= MAX_CONVERSATION_TURNS) done = true

    // Match mock mind delay so multi-turn interleaves under pure advanceTicks
    const delay =
      this.provider instanceof MockProvider && this.provider.preferSync()
        ? MOCK_DELAY_TICKS
        : 0

    if (delay <= 0) {
      sim.postSay(c.id, agentId, partnerId, turn, reply.text, done, 'template')
      // No decideCallCount / decisions — sheep templates cost zero budget
      this.onSayApplied(sim, agentId, partnerId, c.id, turn, reply.text, done)
    } else {
      this.sayHolds.push({
        agentId,
        partnerId,
        conversationId: c.id,
        turn,
        readyTick: sim.state.tick + delay,
        text: reply.text,
        done,
        exchange: {
          agentId,
          tick: sim.state.tick,
          system: '(sheep template)',
          user: reply.templateId,
          rawResponse: reply.text,
          ok: true,
        },
        requestTick: sim.state.tick,
        source: 'template',
      })
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

  private requestDecision(sim: Simulation, agentId: string): void {
    if (!this.provider) return
    if (this.isBudgetCooldown()) return
    const agent = sim.state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const provider = this.provider

    // Mock sync: fully synchronous so ffwd interleaves decide → 3-tick hold → apply
    if (provider instanceof MockProvider && provider.preferSync()) {
      const tick = sim.state.tick
      const events: readonly SimEvent[] = sim.getEvents()
      const system = buildSystemPrompt(agentId)
      const user = buildUserPrompt(agent, sim.state, events, sim.state.mindNoteLog)
      this.decideCallCount += 1
      const result = provider.decideSync({
        system,
        user,
        agentId,
        tick,
        kind: 'decision',
      })
      this.finishDecision(sim, agentId, system, user, result, provider.name, tick)
      return
    }

    // Async/sidecar: enqueue only — do not contact provider until pump dispatches
    if (this.isPipelineBusy(agentId)) return
    this.queue.enqueue({ agentId, kind: 'decision' })
    this.pumpDispatch(sim)
  }

  private requestReflection(
    sim: Simulation,
    agentId: string,
    nightKey: number,
  ): void {
    if (!this.provider) return
    if (this.isBudgetCooldown()) return

    const provider = this.provider

    if (provider instanceof MockProvider && provider.preferSync()) {
      // Reserve the night immediately so we don't double-dispatch
      this.markReflected(agentId, nightKey)
      const tick = sim.state.tick
      const day = reflectionDayForNightKey(nightKey)
      const events: readonly SimEvent[] = sim.getEvents()
      const system = buildReflectionSystemPrompt(agentId)
      const user = buildReflectionUserPrompt(agentId, events, day)
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
        provider.name,
        tick,
        nightKey,
      )
      return
    }

    // Async: reserve night + enqueue (no provider contact until pump)
    if (this.isPipelineBusy(agentId)) return
    this.markReflected(agentId, nightKey)
    const result = this.queue.enqueue({
      agentId,
      kind: 'reflection',
      nightKey,
    })
    if (result === 'dropped' || result === 'duplicate') {
      // Unmark so a later cadence can retry
      this.reflectedNights.get(agentId)?.delete(nightKey)
      return
    }
    this.pumpDispatch(sim)
  }

  /**
   * Expire in-flight requests past MIND_WALL_TIMEOUT_MS.
   * Called from onAfterTick and the safety sweep (hidden tabs have no frames).
   * @returns number of flights expired
   */
  private expireWallTimeouts(sim: Simulation): number {
    const now = this.nowFn()
    const timedOut: InFlight[] = []
    for (const flight of this.activeDispatches.values()) {
      if (now - flight.startedWall >= MIND_WALL_TIMEOUT_MS) timedOut.push(flight)
    }
    for (const flight of timedOut) {
      this.activeDispatches.delete(flight.agentId)
      if (flight.kind === 'reflection' && flight.nightKey != null) {
        this.reflectedNights.get(flight.agentId)?.delete(flight.nightKey)
      }
      if (flight.kind === 'conversation') {
        const ac = this.convById(flight.conversationId)
        // Graceful trails-off end — not a fallback storm
        this.finishConversationTrailsOff(
          sim,
          flight.agentId,
          flight.partnerId ?? (ac ? partnerOf(ac, flight.agentId) : ''),
          flight.conversationId ?? ac?.id ?? '',
          flight.turn ?? ac?.nextTurn ?? 0,
        )
      } else {
        this.fallbacks += 1
        sim.postMindFallback(
          flight.agentId,
          {
            reason: 'wall timeout',
            latencyMs: MIND_WALL_TIMEOUT_MS,
            variant: flight.kind === 'reflection' ? 'reflection' : 'decision',
          },
          'Mind request timed out — continuing on instinct',
        )
      }
    }
    if (timedOut.length > 0) this.pumpDispatch(sim)
    return timedOut.length
  }

  /**
   * Concurrency-K worker pool: fill free slots from the priority FIFO.
   * Observation/prompts are built at dispatch time (not enqueue) so the prompt
   * tick matches the world when the request actually leaves.
   * Rolling rate floor: at most K starts per wallFloorMs window.
   * Conversation lane: turn N+1 never leaves while turn N is in flight/hold.
   */
  private pumpDispatch(sim: Simulation): void {
    if (this.disposed || !this.provider) return
    if (this.isBudgetCooldown()) {
      this.rateFloorWaiting = false
      this.clearRateFloorTimer()
      return
    }

    let started = false
    for (;;) {
      if (this.activeDispatches.size >= this.concurrency) {
        this.rateFloorWaiting = false
        break
      }
      if (this.queue.isEmpty()) {
        this.rateFloorWaiting = false
        this.clearRateFloorTimer()
        break
      }

      const now = this.nowFn()
      if (!this.canStartByRate(now)) {
        // Work is waiting but rate floor blocks — keep breathe engaged
        this.rateFloorWaiting = this.queue.size() > 0
        if (this.rateFloorWaiting) this.scheduleRateFloorRetry(sim)
        break
      }

      const entry = this.queue.takeFirst((e) => this.isEntryDispatchable(e))
      if (!entry) {
        // Queue has items but all blocked by conversation lane / agent voice —
        // still line work; rate floor not the cause.
        this.rateFloorWaiting = false
        break
      }

      if (!this.startDispatch(sim, entry)) {
        // Entry was discarded (missing agent / dead conv) — try next
        continue
      }
      started = true
    }

    if (!started && this.queue.isEmpty()) {
      this.rateFloorWaiting = false
      this.clearRateFloorTimer()
    }
  }

  /**
   * Begin one provider.decide for a dequeued entry.
   * @returns false if the entry was discarded without starting a flight.
   */
  private startDispatch(sim: Simulation, entry: MindQueueEntry): boolean {
    if (!this.provider) return false

    const agent = sim.state.agents.find((a) => a.id === entry.agentId)
    if (!agent) {
      if (entry.kind === 'reflection' && entry.nightKey != null) {
        this.reflectedNights.get(entry.agentId)?.delete(entry.nightKey)
      }
      if (entry.kind === 'conversation') {
        const ac = this.convById(entry.conversationId)
        if (ac) ac.turnInFlight = false
      }
      return false
    }

    // Build prompts NOW — refresh observation at dispatch, not enqueue
    const tick = sim.state.tick
    const events: readonly SimEvent[] = sim.getEvents()
    let system: string
    let user: string
    if (entry.kind === 'reflection') {
      const nightKey = entry.nightKey!
      const day = reflectionDayForNightKey(nightKey)
      system = buildReflectionSystemPrompt(entry.agentId)
      user = buildReflectionUserPrompt(entry.agentId, events, day)
    } else if (entry.kind === 'conversation') {
      const conv = this.convById(entry.conversationId)
      const partnerId =
        entry.partnerId ?? (conv ? partnerOf(conv, entry.agentId) : '')
      const partner = sim.state.agents.find((a) => a.id === partnerId)
      if (!conv || !partner) {
        if (conv) conv.turnInFlight = false
        return false
      }
      system = buildConversationSystemPrompt(entry.agentId)
      user = buildConversationUserPrompt(
        agent,
        partner,
        sim.state,
        events,
        conv.transcript,
      )
    } else {
      system = buildSystemPrompt(entry.agentId)
      user = buildUserPrompt(agent, sim.state, events, sim.state.mindNoteLog)
    }

    const provider = this.provider
    const providerName = provider.name
    const startedWall = this.nowFn()
    const flight: InFlight = {
      agentId: entry.agentId,
      startedTick: tick,
      startedWall,
      kind: entry.kind,
      nightKey: entry.nightKey,
      conversationId: entry.conversationId,
      partnerId: entry.partnerId,
      turn: entry.turn,
    }
    this.activeDispatches.set(entry.agentId, flight)
    this.dispatchWallTimes.push(startedWall)
    this.rateFloorWaiting = false
    // Count only the initial dispatch of a logical request (429 retries reuse it)
    this.decideCallCount += 1

    const agentId = entry.agentId
    const nightKey = entry.nightKey
    const kind = entry.kind
    const partnerId = entry.partnerId
    const conversationId = entry.conversationId
    const turn = entry.turn

    const run = async () => {
      for (;;) {
        if (this.disposed) return
        if (this.activeDispatches.get(agentId) !== flight) return
        try {
          const result = await provider.decide({
            system,
            user,
            agentId,
            tick,
            kind,
          })
          if (this.disposed) return
          if (this.activeDispatches.get(agentId) !== flight) return
          if (result.budget) this.applyBudgetSnapshot(result.budget)
          this.activeDispatches.delete(agentId)
          const applySim = this.latestSim ?? sim
          if (kind === 'reflection' && nightKey != null) {
            this.finishReflection(
              applySim,
              agentId,
              system,
              user,
              result,
              providerName,
              tick,
              nightKey,
            )
          } else if (kind === 'conversation') {
            this.finishConversationTurn(
              applySim,
              agentId,
              partnerId ?? '',
              conversationId ?? '',
              turn ?? 0,
              system,
              user,
              result,
              providerName,
              tick,
            )
          } else {
            this.finishDecision(
              applySim,
              agentId,
              system,
              user,
              result,
              providerName,
              tick,
            )
          }
          this.pumpDispatch(this.latestSim ?? sim)
          this.notifySettled()
          return
        } catch (err) {
          if (this.disposed) return
          if (this.activeDispatches.get(agentId) !== flight) return
          const code = (err as { code?: string })?.code
          if (code === 'LUNA_BUSY') {
            // Sidecar at capacity (another app instance or race) — brief retry
            console.warn(
              '[luna] LUNA_BUSY from sidecar — pool saturated or shared instance',
            )
            await new Promise<void>((r) => setTimeout(r, LUNA_BUSY_RETRY_MS))
            continue
          }
          if (code === 'LUNA_BUDGET') {
            this.activeDispatches.delete(agentId)
            if (kind === 'reflection' && nightKey != null) {
              this.reflectedNights.get(agentId)?.delete(nightKey)
            }
            if (kind === 'conversation') {
              const ac = this.convById(conversationId)
              if (ac) ac.turnInFlight = false
            }
            // Drop the rest of the line; no dispatches during cooldown
            this.clearQueueUnmarkReflections()
            this.rateFloorWaiting = false
            const resetsInSec =
              typeof (err as { resetsInSec?: number }).resetsInSec === 'number'
                ? (err as { resetsInSec: number }).resetsInSec
                : 3600
            const budget = (err as { budget?: MindBudgetInfo }).budget
            this.enterBudgetCooldown(
              this.latestSim ?? sim,
              agentId,
              resetsInSec,
              budget,
            )
            this.notifySettled()
            return
          }
          this.activeDispatches.delete(agentId)
          if (kind === 'reflection' && nightKey != null) {
            this.reflectedNights.get(agentId)?.delete(nightKey)
          }
          if (kind === 'conversation') {
            // Invalid provider error → trails off, no fallback storm
            this.finishConversationTrailsOff(
              this.latestSim ?? sim,
              agentId,
              partnerId ?? '',
              conversationId ?? '',
              turn ?? 0,
            )
            this.pumpDispatch(this.latestSim ?? sim)
            this.notifySettled()
            return
          }
          this.fallbacks += 1
          const msg = err instanceof Error ? err.message : String(err)
          const applySim = this.latestSim ?? sim
          applySim.postMindFallback(
            agentId,
            {
              reason: 'provider error',
              error: msg,
              ...(kind === 'reflection' ? { variant: 'reflection' as const } : {}),
            },
            kind === 'reflection'
              ? `Mind reflection error: ${msg}`
              : `Mind provider error: ${msg}`,
          )
          this.pumpDispatch(applySim)
          this.notifySettled()
          return
        }
      }
    }

    void run()
    return true
  }

  private finishConversationTurn(
    sim: Simulation,
    agentId: string,
    partnerId: string,
    conversationId: string,
    turn: number,
    system: string,
    user: string,
    result: { text: string; latencyMs: number; approxChars: number },
    providerName: string,
    requestTick: number,
  ): void {
    this.totalLatency += result.latencyMs
    this.latencySamples += 1
    this.totalApproxChars += result.approxChars

    const parsed = parseSayJson(result.text)
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
      // Graceful end — no mind:fallback
      this.finishConversationTrailsOff(sim, agentId, partnerId, conversationId, turn)
      return
    }

    let done = parsed.done
    if (turn + 1 >= MAX_CONVERSATION_TURNS) done = true

    const delay =
      providerName === 'mock' &&
      this.provider instanceof MockProvider &&
      this.provider.preferSync()
        ? MOCK_DELAY_TICKS
        : 0

    if (delay <= 0) {
      sim.postSay(conversationId, agentId, partnerId, turn, parsed.say, done)
      this.decisions += 1
      this.onSayApplied(
        sim,
        agentId,
        partnerId,
        conversationId,
        turn,
        parsed.say,
        done,
      )
    } else {
      this.sayHolds.push({
        agentId,
        partnerId,
        conversationId,
        turn,
        readyTick: sim.state.tick + delay,
        text: parsed.say,
        done,
        exchange,
        requestTick,
      })
    }
  }

  private applyReflectionNotes(
    sim: Simulation,
    agentId: string,
    notes: string[],
    meta: MindNoteMeta,
    exchange: MindExchange,
    nightKey: number,
    learned?: string[],
  ): void {
    this.markReflected(agentId, nightKey)
    sim.postMindNotes(agentId, notes, meta, learned)
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
      this.applyReflectionNotes(
        sim,
        agentId,
        parsed.notes,
        meta,
        exchange,
        nightKey,
        parsed.learned,
      )
    } else {
      this.noteHolds.push({
        agentId,
        readyTick: sim.state.tick + delay,
        notes: parsed.notes,
        learned: parsed.learned,
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
    this.lastDecisionExchange.set(agentId, exchange)

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
  if (v === 'grok') return 'grok'
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

/**
 * Worker pool size from `?mindConcurrency=` / localStorage `luna.concurrency`
 * (default 3, clamp 1–4).
 */
export function mindConcurrencyFromLocation(): number {
  return resolveLunaConcurrency()
}

/** `?noNewConversations=1` — test-only quiet-line stand-in. */
export function noNewConversationsFromLocation(): boolean {
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search)
  const raw = q.get('noNewConversations')
  return raw === '1' || raw === 'true'
}

/**
 * Optional rate-floor override from `?mindWallFloorMs=` (0 = unlimited).
 * Unset → production default (15s).
 */
export function mindWallFloorMsFromLocation(): number | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const raw = q.get('mindWallFloorMs')
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(60_000, Math.floor(n))
}

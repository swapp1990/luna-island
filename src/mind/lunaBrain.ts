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
  findEligiblePair,
  MAX_CONVERSATION_TURNS,
  partnerOf,
  participantConversationOk,
  startConversation,
  TRAILS_OFF,
  type ActiveConversation,
} from './conversation'

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
  /** Latest live sim (for prompt rebuild at dispatch). */
  private latestSim: Simulation | null = null
  /** At most one active conversation island-wide (P3-2). */
  private activeConv: ActiveConversation | null = null
  private pairLastEnd = new Map<string, number>()
  private agentLastEnd = new Map<string, number>()
  /** Worker pool size K (1–4). */
  private readonly concurrency: number
  /** Rolling rate-window length; 0 = unlimited. */
  private readonly wallFloorMs: number
  private readonly nowFn: () => number
  /** True when pump wanted to dispatch but was blocked only by the rate floor. */
  private rateFloorWaiting = false

  constructor(mode: BrainModeOrAuto = 'auto', opts?: LunaBrainOptions) {
    this.mode = mode
    this.concurrency = resolveLunaConcurrency({ explicit: opts?.concurrency })
    this.wallFloorMs =
      opts?.wallFloorMs != null
        ? Math.max(0, Math.floor(opts.wallFloorMs))
        : MIND_WALL_FLOOR_MS
    this.nowFn = opts?.now ?? (() => Date.now())
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
    this.clearQueueUnmarkReflections()
    this.activeDispatches.clear()
    this.dispatchWallTimes = []
    this.rateFloorWaiting = false
    this.holds = []
    this.noteHolds = []
    this.sayHolds = []
    this.activeConv = null
    this.latestSim = null
  }

  /** Test/dev: configured worker-pool size. */
  getConcurrency(): number {
    return this.concurrency
  }

  /** Test/e2e: active conversation snapshot (null if none). */
  getActiveConversation(): ActiveConversation | null {
    return this.activeConv
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
   */
  onAfterTick(sim: Simulation): void {
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
      this.applyReflectionNotes(sim, h.agentId, h.notes, h.meta, h.exchange, h.nightKey)
    }

    // Flush conversation say holds
    const readySays = this.sayHolds.filter((h) => h.readyTick <= tick)
    this.sayHolds = this.sayHolds.filter((h) => h.readyTick > tick)
    for (const h of readySays) {
      this.applySayHold(sim, h)
    }

    // Interrupt / advance active conversation after holds applied
    this.tickConversation(sim)

    // Wall-timeout for each in-flight request (queue wait does not consume it)
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
      if (flight.kind === 'conversation' && this.activeConv) {
        // Graceful trails-off end — not a fallback storm
        this.finishConversationTrailsOff(
          sim,
          flight.agentId,
          flight.partnerId ?? partnerOf(this.activeConv, flight.agentId),
          flight.conversationId ?? this.activeConv.id,
          flight.turn ?? this.activeConv.nextTurn,
        )
      } else if (flight.kind !== 'conversation') {
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

    // Drop queue entries for agents that no longer exist (world reset mid-line)
    const valid = new Set(sim.state.agents.map((a) => a.id))
    for (const e of this.queue.pruneInvalid(valid)) {
      if (e.kind === 'reflection' && e.nightKey != null) {
        this.reflectedNights.get(e.agentId)?.delete(e.nightKey)
      }
      if (e.kind === 'conversation') {
        const ac = this.activeConv
        if (ac && ac.id === e.conversationId) ac.turnInFlight = false
      }
    }

    // Hard client cooldown: no further enqueues / dispatches until reset
    if (this.isBudgetCooldown(now)) return

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

    // Conversation turns (participants' decision cadence is suspended while active)
    if (this.activeConv && !this.activeConv.turnInFlight) {
      const speakerId = this.activeConv.nextSpeakerId
      if (
        !this.isPipelineBusy(speakerId) &&
        !this.holds.some((h) => h.agentId === speakerId) &&
        !this.noteHolds.some((h) => h.agentId === speakerId) &&
        !this.sayHolds.some((h) => h.agentId === speakerId)
      ) {
        this.requestConversationTurn(sim)
      }
    } else if (!this.activeConv) {
      // Try to start a new conversation (max one island-wide)
      const pair = findEligiblePair(sim.state, this.pairLastEnd, this.agentLastEnd)
      if (pair) {
        this.activeConv = startConversation(sim, pair.a, pair.b)
        this.requestConversationTurn(sim)
      }
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
      if (!softOk && !hardOk) continue

      this.requestDecision(sim, agentId)
    }

    // Fill free pool slots if anything is waiting
    this.pumpDispatch(sim)
  }

  private isInActiveConversation(agentId: string): boolean {
    const c = this.activeConv
    if (!c) return false
    return c.agentIdA === agentId || c.agentIdB === agentId
  }

  /** Interrupt if participants leave socialize/stationary; no-op otherwise. */
  private tickConversation(sim: Simulation): void {
    const c = this.activeConv
    if (!c) return
    const a = sim.state.agents.find((x) => x.id === c.agentIdA)
    const b = sim.state.agents.find((x) => x.id === c.agentIdB)
    if (!a || !b || !participantConversationOk(a) || !participantConversationOk(b)) {
      this.endConversationInterrupted(sim)
    }
  }

  private endConversationInterrupted(sim: Simulation): void {
    const c = this.activeConv
    if (!c) return
    // Capture + drop pending holds for this conversation
    const pending = this.sayHolds.filter((h) => h.conversationId === c.id)
    this.sayHolds = this.sayHolds.filter((h) => h.conversationId !== c.id)

    if (!c.closed) {
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
        )
        c.closed = true
      } else if (c.transcript.length > 0 && c.lastText) {
        const speaker = c.transcript[c.transcript.length - 1]!.agentId
        const partner = partnerOf(c, speaker)
        sim.postSay(
          c.id,
          speaker,
          partner,
          Math.max(0, c.nextTurn - 1),
          c.lastText,
          true,
        )
        c.closed = true
      }
    }
    applyCooldowns(this.pairLastEnd, this.agentLastEnd, c.agentIdA, c.agentIdB, sim.state.tick)
    this.activeConv = null
  }

  private endConversationClean(
    sim: Simulation,
    _lastSpeaker: string,
  ): void {
    const c = this.activeConv
    if (!c) return
    c.closed = true
    c.turnInFlight = false
    this.sayHolds = this.sayHolds.filter((h) => h.conversationId !== c.id)
    applyCooldowns(this.pairLastEnd, this.agentLastEnd, c.agentIdA, c.agentIdB, sim.state.tick)
    this.activeConv = null
  }

  private finishConversationTrailsOff(
    sim: Simulation,
    agentId: string,
    partnerId: string,
    conversationId: string,
    turn: number,
  ): void {
    const c = this.activeConv
    if (c && c.id === conversationId && c.closed) return
    sim.postSay(conversationId, agentId, partnerId, turn, TRAILS_OFF, true)
    this.decisions += 1
    if (c && c.id === conversationId) {
      c.lastText = TRAILS_OFF
      c.transcript.push({
        agentId,
        name: sim.state.agents.find((a) => a.id === agentId)?.name ?? agentId,
        text: TRAILS_OFF,
      })
      c.closed = true
      this.endConversationClean(sim, agentId)
    }
  }

  private applySayHold(sim: Simulation, h: PendingSayHold): void {
    const c = this.activeConv
    if (!c || c.id !== h.conversationId || c.closed) return
    sim.postSay(
      h.conversationId,
      h.agentId,
      h.partnerId,
      h.turn,
      h.text,
      h.done,
    )
    this.lastExchange.set(h.agentId, h.exchange)
    this.decisions += 1
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
    const c = this.activeConv
    if (!c || c.id !== conversationId || c.closed) return
    const name = sim.state.agents.find((a) => a.id === agentId)?.name ?? agentId
    c.transcript.push({ agentId, name, text })
    c.lastText = text
    c.turnInFlight = false
    c.nextTurn = turn + 1
    c.nextSpeakerId = partnerId
    if (done || c.nextTurn >= MAX_CONVERSATION_TURNS) {
      c.closed = true
      this.endConversationClean(sim, agentId)
    }
  }

  private requestConversationTurn(sim: Simulation): void {
    if (!this.provider || !this.activeConv) return
    if (this.isBudgetCooldown()) return
    const c = this.activeConv
    if (c.turnInFlight) return
    if (c.nextTurn >= MAX_CONVERSATION_TURNS) {
      this.endConversationClean(sim, c.nextSpeakerId)
      return
    }

    const agentId = c.nextSpeakerId
    const partnerId = partnerOf(c, agentId)
    const turn = c.nextTurn
    const provider = this.provider

    c.turnInFlight = true

    if (provider instanceof MockProvider && provider.preferSync()) {
      const speaker = sim.state.agents.find((a) => a.id === agentId)
      const partner = sim.state.agents.find((a) => a.id === partnerId)
      if (!speaker || !partner) {
        c.turnInFlight = false
        this.endConversationInterrupted(sim)
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
        break
      }

      const now = this.nowFn()
      if (!this.canStartByRate(now)) {
        // Work is waiting but rate floor blocks — keep breathe engaged
        this.rateFloorWaiting = this.queue.size() > 0
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
      if (entry.kind === 'conversation' && this.activeConv) {
        if (this.activeConv.id === entry.conversationId) {
          this.activeConv.turnInFlight = false
        }
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
      const conv = this.activeConv
      const partnerId =
        entry.partnerId ?? (conv ? partnerOf(conv, entry.agentId) : '')
      const partner = sim.state.agents.find((a) => a.id === partnerId)
      if (!conv || conv.id !== entry.conversationId || !partner) {
        if (conv && conv.id === entry.conversationId) conv.turnInFlight = false
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
            if (kind === 'conversation' && this.activeConv) {
              this.activeConv.turnInFlight = false
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

/**
 * Worker pool size from `?mindConcurrency=` / localStorage `luna.concurrency`
 * (default 3, clamp 1–4).
 */
export function mindConcurrencyFromLocation(): number {
  return resolveLunaConcurrency()
}

import type { Simulation } from '../sim/sim'
import type { ExternalIntentMeta, Intent, SimEvent } from '../sim/types'
import { anyNeedCritical } from '../sim/utilityBrain'
import { isLunaAgent, LUNA_AGENT_IDS } from './personas'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import { parseMindJson, resolveMindIntent } from './parse'
import {
  CodexProvider,
  MockProvider,
  probeSidecarHealth,
  type MindProvider,
} from './providers'

/** Cadence: min gap after a decision before the soft path. */
export const MIND_MIN_GAP_TICKS = 30
/** Cadence: hard refresh regardless of action state. */
export const MIND_HARD_GAP_TICKS = 120
/** Mock artificial delay (sim ticks) before posting a ready decision. */
export const MOCK_DELAY_TICKS = 3
/** Wall-clock timeout for a mind request → fallback. */
export const MIND_WALL_TIMEOUT_MS = 10_000

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
  pending: number
  decisions: number
  fallbacks: number
  meanLatencyMs: number
  approxChars: number
  provider: string
}

interface PendingHold {
  agentId: string
  readyTick: number
  intent: Intent
  meta: ExternalIntentMeta
  exchange: MindExchange
}

interface InFlight {
  agentId: string
  startedTick: number
  startedWall: number
  abort?: AbortController
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
  private inFlight = new Map<string, InFlight>()
  private holds: PendingHold[] = []
  private lastExchange = new Map<string, MindExchange>()
  private decideCallCount = 0
  private totalLatency = 0
  private latencySamples = 0
  private totalApproxChars = 0
  private decisions = 0
  private fallbacks = 0
  private disposed = false

  constructor(mode: BrainModeOrAuto = 'auto') {
    this.mode = mode
    if (mode === 'mock') {
      this.provider = new MockProvider()
    } else if (mode === 'codex') {
      this.provider = new CodexProvider()
    } else if (mode === 'off') {
      this.provider = null
    }
    // auto: probe later via init()
  }

  async init(): Promise<void> {
    if (this.mode === 'off') {
      this.provider = null
      return
    }
    if (this.mode === 'mock') {
      this.provider = new MockProvider()
      return
    }
    if (this.mode === 'codex') {
      this.provider = new CodexProvider()
      return
    }
    // auto
    const ok = await probeSidecarHealth()
    if (this.disposed) return
    if (ok) {
      this.mode = 'codex'
      this.provider = new CodexProvider()
    } else {
      this.mode = 'mock'
      this.provider = new MockProvider()
    }
  }

  dispose(): void {
    this.disposed = true
    this.inFlight.clear()
    this.holds = []
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

  getMeter(): MindMeter {
    const pending = this.inFlight.size + this.holds.length
    return {
      enabled: this.isEnabled(),
      agentIds: [...LUNA_AGENT_IDS],
      pending,
      decisions: this.decisions,
      fallbacks: this.fallbacks,
      meanLatencyMs:
        this.latencySamples > 0
          ? Math.round(this.totalLatency / this.latencySamples)
          : 0,
      approxChars: this.totalApproxChars,
      provider: this.provider?.name ?? 'off',
    }
  }

  /**
   * Call after each live sim tick (or after each tick inside ffwd).
   * Posts ready holds; may kick off new async decisions.
   */
  onAfterTick(sim: Simulation): void {
    if (!this.isEnabled() || this.disposed) return
    if (this.mode === 'off' || !this.provider) return

    const tick = sim.state.tick

    // Flush holds whose readyTick has arrived
    const ready = this.holds.filter((h) => h.readyTick <= tick)
    this.holds = this.holds.filter((h) => h.readyTick > tick)
    for (const h of ready) {
      sim.postExternalIntent(h.agentId, h.intent, h.meta)
      this.lastDecisionTick.set(h.agentId, tick)
      this.lastExchange.set(h.agentId, h.exchange)
      this.decisions += 1
    }

    // Wall-timeout in-flight
    const now = Date.now()
    for (const [agentId, flight] of [...this.inFlight.entries()]) {
      if (now - flight.startedWall >= MIND_WALL_TIMEOUT_MS) {
        this.inFlight.delete(agentId)
        this.fallbacks += 1
        sim.postMindFallback(
          agentId,
          { reason: 'wall timeout', latencyMs: MIND_WALL_TIMEOUT_MS },
          'Mind request timed out — continuing on instinct',
        )
      }
    }

    // Cadence: request decisions for luna agents
    for (const agentId of LUNA_AGENT_IDS) {
      if (this.inFlight.has(agentId)) continue
      if (this.holds.some((h) => h.agentId === agentId)) continue
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
  }

  private requestDecision(sim: Simulation, agentId: string): void {
    if (!this.provider) return
    const agent = sim.state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const tick = sim.state.tick
    const events: readonly SimEvent[] = sim.getEvents()
    const system = buildSystemPrompt(agentId)
    const user = buildUserPrompt(agent, sim.state, events)
    const provider = this.provider
    const providerName = provider.name
    this.decideCallCount += 1

    // Mock: fully synchronous so ffwd interleaves decide → 3-tick hold → apply
    if (provider instanceof MockProvider) {
      const result = provider.decideSync({ system, user, agentId, tick })
      this.finishDecision(sim, agentId, system, user, result, providerName, tick)
      return
    }

    const flight: InFlight = {
      agentId,
      startedTick: tick,
      startedWall: Date.now(),
    }
    this.inFlight.set(agentId, flight)

    const run = async () => {
      try {
        const result = await provider.decide({
          system,
          user,
          agentId,
          tick,
        })
        if (this.disposed) return
        if (this.inFlight.get(agentId) !== flight) return
        this.inFlight.delete(agentId)
        this.finishDecision(sim, agentId, system, user, result, providerName, tick)
      } catch (err) {
        if (this.disposed) return
        if (this.inFlight.get(agentId) !== flight) return
        this.inFlight.delete(agentId)
        const code = (err as { code?: string })?.code
        if (code === 'LUNA_BUSY') {
          return
        }
        this.fallbacks += 1
        const msg = err instanceof Error ? err.message : String(err)
        sim.postMindFallback(
          agentId,
          { reason: 'provider error', error: msg },
          `Mind provider error: ${msg}`,
        )
      }
    }

    void run()
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

    const delay = providerName === 'mock' ? MOCK_DELAY_TICKS : 0
    const readyTick = sim.state.tick + delay
    if (delay <= 0) {
      sim.postExternalIntent(agentId, intent, meta)
      this.lastDecisionTick.set(agentId, sim.state.tick)
      this.decisions += 1
    } else {
      this.holds.push({
        agentId,
        readyTick,
        intent,
        meta,
        exchange,
      })
    }
  }
}

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

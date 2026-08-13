/** Mind LLM providers — live outside the sim (network / async allowed). */

export interface MindPrompt {
  system: string
  user: string
  /** For MockProvider seeding only. */
  agentId?: string
  tick?: number
  /** Decision (default), conversation turn, or nightly reflection. */
  kind?: 'decision' | 'conversation' | 'reflection'
}

export interface MindBudgetInfo {
  usedHour: number
  maxHour: number
  usedDay: number
  maxDay: number
}

export interface MindDecisionResult {
  text: string
  latencyMs: number
  approxChars: number
  /** Sidecar budget snapshot when available. */
  budget?: MindBudgetInfo
}

export interface MindProvider {
  readonly name: string
  decide(prompt: MindPrompt): Promise<MindDecisionResult>
}

/** Default ceiling mirrors sidecar defaults (display when no health yet). */
export const DEFAULT_BUDGET_MAX_HOUR = 60
export const DEFAULT_BUDGET_MAX_DAY = 300

const ACTION_CYCLE = [
  'forage',
  'eat',
  'work',
  'socialize',
  'drink',
  'wander',
  'sleep',
  'buy',
] as const

export interface MockProviderOptions {
  /**
   * Wall-frame artificial delay before resolve (for pacing tests).
   * When > 0, preferSync() is false and decide() waits for advanceWallFrame() calls.
   */
  wallDelayFrames?: number
  /**
   * Wall-clock ms delay before resolve (browser e2e breathe tests).
   * When > 0, preferSync() is false and decide() uses setTimeout.
   */
  wallDelayMs?: number
}

/**
 * Deterministic canned decisions for vitest/e2e — no network.
 * Seeds by agentId+tick; artificial delay is handled by LunaBrain (3 sim ticks)
 * unless wallDelayFrames is set (async path for breathe/stale tests).
 */
export class MockProvider implements MindProvider {
  readonly name = 'mock'
  private readonly wallDelayFrames: number
  private readonly wallDelayMs: number
  private wallWaiters: Array<{
    left: number
    resolve: (r: MindDecisionResult) => void
    result: MindDecisionResult
  }> = []

  constructor(opts?: MockProviderOptions) {
    this.wallDelayFrames = Math.max(0, opts?.wallDelayFrames ?? 0)
    this.wallDelayMs = Math.max(0, opts?.wallDelayMs ?? 0)
  }

  /** True when LunaBrain may use the fully-synchronous decide path (ffwd-safe). */
  preferSync(): boolean {
    return this.wallDelayFrames <= 0 && this.wallDelayMs <= 0
  }

  /**
   * Advance one wall frame for async delayed decides.
   * Call once per simulated/real frame from tests (or harness).
   */
  advanceWallFrame(): void {
    if (this.wallWaiters.length === 0) return
    const done: typeof this.wallWaiters = []
    const rest: typeof this.wallWaiters = []
    for (const w of this.wallWaiters) {
      w.left -= 1
      if (w.left <= 0) done.push(w)
      else rest.push(w)
    }
    this.wallWaiters = rest
    for (const w of done) w.resolve(w.result)
  }

  /** Synchronous path so ffwd can interleave decide → 3-tick hold → apply without microtasks. */
  decideSync(prompt: MindPrompt): MindDecisionResult {
    const agentId = prompt.agentId ?? 'agent-0'
    const tick = prompt.tick ?? 0
    // Simple deterministic hash
    let h = 2166136261
    const seed = `${agentId}:${tick}:${prompt.kind ?? 'decision'}`
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }

    if (prompt.kind === 'reflection') {
      const notes = [
        `I made it through another day on the island — needs first, then neighbors.`,
        `Tomorrow I will work if I can and keep an eye on my wallet.`,
      ]
      // Deterministic third note sometimes
      if (Math.abs(h) % 2 === 0) {
        notes.push(`I hope the plaza is quiet and the pantry stays full.`)
      }
      const learned =
        Math.abs(h) % 3 === 0
          ? ['Eating filled me when I was hungry.']
          : []
      const text = JSON.stringify({
        notes: notes.slice(0, 1 + (Math.abs(h) % 3)),
        learned,
      })
      const approxChars = prompt.system.length + prompt.user.length + text.length
      return { text, latencyMs: 1, approxChars }
    }

    if (prompt.kind === 'conversation') {
      const canned = [
        'Hey — good to see you out here.',
        'How are you holding up today?',
        'I keep thinking about the plaza lately.',
        'We should trade stories sometime.',
        'Stay safe out there, friend.',
        'The village feels alive when we talk.',
      ]
      const say = canned[Math.abs(h) % canned.length]!
      // End after ~2–3 turns: done when hash says so or user shows long transcript
      const transcriptLines = (prompt.user.match(/\n[A-Za-z]+: "/g) ?? []).length
      const done = transcriptLines >= 2 || Math.abs(h) % 5 === 0
      const text = JSON.stringify({ say, done })
      const approxChars = prompt.system.length + prompt.user.length + text.length
      return { text, latencyMs: 1, approxChars }
    }

    // Bias toward socialize so conversations can emerge in mock/e2e
    let action: (typeof ACTION_CYCLE)[number]
    if (Math.abs(h) % 5 < 2) {
      action = 'socialize'
    } else {
      action = ACTION_CYCLE[Math.abs(h) % ACTION_CYCLE.length]!
    }
    const reasoning = `I should ${action} now — needs and the island clock say so.`
    const payload: { action: string; target?: string; reasoning: string } = {
      action,
      reasoning: reasoning.slice(0, 160),
    }
    if (action === 'work') payload.target = 'farm'
    else if (action === 'buy') payload.target = 'stall'
    else if (action === 'forage') payload.target = 'berry-bush'
    else if (action === 'drink') payload.target = 'well'
    else if (action === 'socialize') payload.target = 'plaza'
    else if (action === 'sleep') payload.target = 'home'

    const text = JSON.stringify(payload)
    const approxChars = prompt.system.length + prompt.user.length + text.length
    return { text, latencyMs: 1, approxChars }
  }

  async decide(prompt: MindPrompt): Promise<MindDecisionResult> {
    const result = this.decideSync(prompt)
    if (this.wallDelayFrames > 0) {
      return new Promise((resolve) => {
        this.wallWaiters.push({
          left: this.wallDelayFrames,
          resolve,
          result,
        })
      })
    }
    if (this.wallDelayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, this.wallDelayMs))
      return result
    }
    // Microtask so async path is still exercised when not in sync ffwd
    await Promise.resolve()
    return result
  }
}

/**
 * Test / harness provider that returns 402-style budget exhaustion.
 * Configurable: fail first N decides with budget, then optionally succeed.
 */
export class BudgetExhaustedProvider implements MindProvider {
  readonly name = 'budget-mock'
  private remainingFails: number
  private readonly resetsInSec: number
  private readonly maxHour: number
  private readonly maxDay: number
  private usedHour: number
  private usedDay: number
  /** Count of decide() invocations (including budget failures). */
  decideInvocations = 0

  constructor(opts?: {
    failCount?: number
    resetsInSec?: number
    maxHour?: number
    maxDay?: number
    usedHour?: number
    usedDay?: number
  }) {
    this.remainingFails = opts?.failCount ?? 999
    this.resetsInSec = opts?.resetsInSec ?? 3600
    this.maxHour = opts?.maxHour ?? DEFAULT_BUDGET_MAX_HOUR
    this.maxDay = opts?.maxDay ?? DEFAULT_BUDGET_MAX_DAY
    this.usedHour = opts?.usedHour ?? this.maxHour
    this.usedDay = opts?.usedDay ?? 0
  }

  async decide(_prompt: MindPrompt): Promise<MindDecisionResult> {
    this.decideInvocations += 1
    if (this.remainingFails > 0) {
      this.remainingFails -= 1
      const err = new Error('LUNA_BUDGET') as Error & {
        code?: string
        resetsInSec?: number
        budget?: MindBudgetInfo
      }
      err.code = 'LUNA_BUDGET'
      err.resetsInSec = this.resetsInSec
      err.budget = {
        usedHour: this.usedHour,
        maxHour: this.maxHour,
        usedDay: this.usedDay,
        maxDay: this.maxDay,
      }
      throw err
    }
    const mock = new MockProvider()
    return mock.decideSync(_prompt)
  }
}

/**
 * Real mind via Vite sidecar → local codex CLI.
 * Browser: POST /api/luna/decide { system, user } → { text }.
 */
export class CodexProvider implements MindProvider {
  readonly name = 'codex'
  private readonly timeoutMs: number

  // Must exceed the sidecar's 60s kill-timeout so the server's verdict
  // (result or 502) always beats the client abort.
  constructor(timeoutMs = 75_000) {
    this.timeoutMs = timeoutMs
  }

  async decide(prompt: MindPrompt): Promise<MindDecisionResult> {
    const t0 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch('/api/luna/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: prompt.system, user: prompt.user }),
        signal: controller.signal,
      })
      if (res.status === 429) {
        // Still thinking — caller should not count as hard fallback
        const err = new Error('LUNA_BUSY') as Error & { code?: string }
        err.code = 'LUNA_BUSY'
        throw err
      }
      if (res.status === 402) {
        let body: {
          error?: string
          remainingHour?: number
          remainingDay?: number
          resetsInSec?: number
          budget?: MindBudgetInfo
        } = {}
        try {
          body = (await res.json()) as typeof body
        } catch {
          /* empty */
        }
        const err = new Error('LUNA_BUDGET') as Error & {
          code?: string
          resetsInSec?: number
          budget?: MindBudgetInfo
          remainingHour?: number
          remainingDay?: number
        }
        err.code = 'LUNA_BUDGET'
        err.resetsInSec =
          typeof body.resetsInSec === 'number' && body.resetsInSec > 0
            ? body.resetsInSec
            : 3600
        err.budget = body.budget
        err.remainingHour = body.remainingHour
        err.remainingDay = body.remainingDay
        throw err
      }
      if (!res.ok) {
        throw new Error(`Luna sidecar HTTP ${res.status}`)
      }
      const body = (await res.json()) as {
        text?: string
        error?: string
        budget?: MindBudgetInfo
      }
      if (body.error && !body.text) {
        throw new Error(body.error)
      }
      const text = body.text ?? ''
      const t1 =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()
      return {
        text,
        latencyMs: Math.round(t1 - t0),
        approxChars: prompt.system.length + prompt.user.length + text.length,
        budget: body.budget,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export interface SidecarHealthResult {
  ok: boolean
  budget?: MindBudgetInfo
}

/** Probe sidecar health (browser). Returns budget snapshot when present. */
export async function probeSidecarHealth(
  timeoutMs = 1500,
): Promise<SidecarHealthResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch('/api/luna/health', { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return { ok: false }
    const body = (await res.json()) as {
      ok?: boolean
      budget?: MindBudgetInfo
    }
    return {
      ok: true,
      budget: body.budget,
    }
  } catch {
    return { ok: false }
  }
}

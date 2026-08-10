/** Mind LLM providers — live outside the sim (network / async allowed). */

export interface MindPrompt {
  system: string
  user: string
  /** For MockProvider seeding only. */
  agentId?: string
  tick?: number
}

export interface MindDecisionResult {
  text: string
  latencyMs: number
  approxChars: number
}

export interface MindProvider {
  readonly name: string
  decide(prompt: MindPrompt): Promise<MindDecisionResult>
}

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

/**
 * Deterministic canned decisions for vitest/e2e — no network.
 * Seeds by agentId+tick; artificial delay is handled by LunaBrain (3 sim ticks).
 */
export class MockProvider implements MindProvider {
  readonly name = 'mock'

  /** Synchronous path so ffwd can interleave decide → hold → apply without microtasks. */
  decideSync(prompt: MindPrompt): MindDecisionResult {
    const agentId = prompt.agentId ?? 'agent-0'
    const tick = prompt.tick ?? 0
    // Simple deterministic hash
    let h = 2166136261
    const seed = `${agentId}:${tick}`
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    const action = ACTION_CYCLE[Math.abs(h) % ACTION_CYCLE.length]!
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
    // Microtask so async path is still exercised when not in sync ffwd
    await Promise.resolve()
    return this.decideSync(prompt)
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
      if (!res.ok) {
        throw new Error(`Luna sidecar HTTP ${res.status}`)
      }
      const body = (await res.json()) as { text?: string; error?: string }
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
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Probe sidecar health (browser). */
export async function probeSidecarHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch('/api/luna/health', { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

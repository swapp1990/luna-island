/**
 * Sidecar-authoritative LLM budget (pure — no node: imports).
 * Used by the Vite plugin and unit tests with injectable clock + persistence.
 */

export const DEFAULT_MAX_PER_HOUR = 60
export const DEFAULT_MAX_PER_DAY = 300
const HOUR_MS = 60 * 60 * 1000

export type CodexRunner = (
  system: string,
  user: string,
) => Promise<{ text: string; latencyMs: number }>

export interface BudgetLimits {
  maxPerHour: number
  maxPerDay: number
}

export interface BudgetSnapshot {
  usedHour: number
  maxHour: number
  usedDay: number
  maxDay: number
}

export interface BudgetCheckOk {
  ok: true
  snapshot: BudgetSnapshot
}

export interface BudgetCheckBlocked {
  ok: false
  remainingHour: number
  remainingDay: number
  resetsInSec: number
  snapshot: BudgetSnapshot
}

export type BudgetCheckResult = BudgetCheckOk | BudgetCheckBlocked

/** Persist shape under <scratch>/budget.json */
export interface BudgetFile {
  dayKey: string
  usedDay: number
  /** Wall timestamps of successful calls (rolling hour prune on read/check). */
  hourCalls: number[]
}

export interface BudgetPersist {
  load(): string | null
  save(json: string): void
}

export function dayKeyAt(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function msUntilNextLocalMidnight(now: number): number {
  const d = new Date(now)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000))
}

function emptyFile(now: number): BudgetFile {
  return { dayKey: dayKeyAt(now), usedDay: 0, hourCalls: [] }
}

function pruneHourCalls(calls: number[], now: number): number[] {
  const cutoff = now - HOUR_MS
  return calls.filter((t) => t > cutoff)
}

export class BudgetTracker {
  readonly maxPerHour: number
  readonly maxPerDay: number
  private readonly nowFn: () => number
  private readonly persistStore: BudgetPersist | null
  private file: BudgetFile

  constructor(
    limits: BudgetLimits,
    opts?: {
      now?: () => number
      persist?: BudgetPersist
      skipLoad?: boolean
    },
  ) {
    this.maxPerHour = limits.maxPerHour
    this.maxPerDay = limits.maxPerDay
    this.nowFn = opts?.now ?? (() => Date.now())
    this.persistStore = opts?.persist ?? null
    this.file = emptyFile(this.nowFn())
    if (!opts?.skipLoad && this.persistStore) this.reloadFromDisk()
  }

  /** Re-read persistence (simulated restart). Corrupt/missing → counts 0, keep day key. */
  reloadFromDisk(): void {
    const now = this.nowFn()
    if (!this.persistStore) {
      this.file = emptyFile(now)
      return
    }
    try {
      const raw = this.persistStore.load()
      if (raw == null) {
        this.file = emptyFile(now)
        return
      }
      const parsed = JSON.parse(raw) as Partial<BudgetFile>
      const dayKey =
        typeof parsed.dayKey === 'string' && parsed.dayKey.length > 0
          ? parsed.dayKey
          : dayKeyAt(now)
      let usedDay =
        typeof parsed.usedDay === 'number' && Number.isFinite(parsed.usedDay)
          ? Math.max(0, Math.floor(parsed.usedDay))
          : 0
      let hourCalls = Array.isArray(parsed.hourCalls)
        ? parsed.hourCalls.filter(
            (t): t is number => typeof t === 'number' && Number.isFinite(t),
          )
        : []
      if (dayKey !== dayKeyAt(now)) {
        this.file = { dayKey: dayKeyAt(now), usedDay: 0, hourCalls: [] }
        this.persist()
        return
      }
      hourCalls = pruneHourCalls(hourCalls, now)
      this.file = { dayKey, usedDay, hourCalls }
    } catch {
      this.file = emptyFile(now)
    }
  }

  private normalize(now: number): void {
    const today = dayKeyAt(now)
    if (this.file.dayKey !== today) {
      this.file = { dayKey: today, usedDay: 0, hourCalls: [] }
    } else {
      this.file.hourCalls = pruneHourCalls(this.file.hourCalls, now)
    }
  }

  snapshot(now = this.nowFn()): BudgetSnapshot {
    this.normalize(now)
    return {
      usedHour: this.file.hourCalls.length,
      maxHour: this.maxPerHour,
      usedDay: this.file.usedDay,
      maxDay: this.maxPerDay,
    }
  }

  /** Pre-spawn gate. Does not mutate counters. */
  check(now = this.nowFn()): BudgetCheckResult {
    this.normalize(now)
    const snap = this.snapshot(now)
    const remainingHour = Math.max(0, this.maxPerHour - snap.usedHour)
    const remainingDay = Math.max(0, this.maxPerDay - snap.usedDay)

    if (snap.usedHour >= this.maxPerHour) {
      const oldest = this.file.hourCalls.length
        ? Math.min(...this.file.hourCalls)
        : now
      const resetsInSec = Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000))
      return {
        ok: false,
        remainingHour: 0,
        remainingDay,
        resetsInSec,
        snapshot: snap,
      }
    }
    if (snap.usedDay >= this.maxPerDay) {
      return {
        ok: false,
        remainingHour,
        remainingDay: 0,
        resetsInSec: msUntilNextLocalMidnight(now),
        snapshot: snap,
      }
    }
    return { ok: true, snapshot: snap }
  }

  /** Record a successful call and persist. */
  recordSuccess(now = this.nowFn()): BudgetSnapshot {
    this.normalize(now)
    this.file.hourCalls.push(now)
    this.file.usedDay += 1
    this.persist()
    return this.snapshot(now)
  }

  persist(): void {
    if (!this.persistStore) return
    this.persistStore.save(JSON.stringify(this.file))
  }
}

export interface SidecarDeps {
  busy: { current: boolean }
  budget: BudgetTracker
  runner: CodexRunner
}

/**
 * POST /api/luna/decide core logic — budget check is the FIRST statement.
 * Runner is never invoked on a 402 path.
 */
export async function handleDecide(
  deps: SidecarDeps,
  body: { system?: string; user?: string },
): Promise<{
  status: number
  json: Record<string, unknown>
}> {
  // --- FIRST STATEMENT: hard budget gate (no runner on 402) ---
  const gate = deps.budget.check()
  if (!gate.ok) {
    return {
      status: 402,
      json: {
        error: 'budget',
        remainingHour: gate.remainingHour,
        remainingDay: gate.remainingDay,
        resetsInSec: gate.resetsInSec,
        budget: gate.snapshot,
      },
    }
  }

  if (deps.busy.current) {
    return {
      status: 429,
      json: { error: 'busy' },
    }
  }

  const system = body.system ?? ''
  const user = body.user ?? ''
  deps.busy.current = true
  try {
    const { text, latencyMs } = await deps.runner(system, user)
    const snap = deps.budget.recordSuccess()
    // eslint-disable-next-line no-console
    console.log(
      `[luna-sidecar] decide ${latencyMs}ms chars=${text.length} budget=${snap.usedHour}/${snap.maxHour}h ${snap.usedDay}/${snap.maxDay}d`,
    )
    return {
      status: 200,
      json: {
        text,
        latencyMs,
        budget: snap,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[luna-sidecar] error: ${msg}`)
    return {
      status: 502,
      json: { error: msg },
    }
  } finally {
    deps.busy.current = false
  }
}

export function healthPayload(
  budget: BudgetTracker,
  scratch?: string,
): Record<string, unknown> {
  const snap = budget.snapshot()
  return {
    ok: true,
    ...(scratch != null ? { scratch } : {}),
    budget: {
      usedHour: snap.usedHour,
      maxHour: snap.maxHour,
      usedDay: snap.usedDay,
      maxDay: snap.maxDay,
    },
  }
}

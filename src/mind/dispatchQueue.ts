/**
 * App-wide mind dispatch queue: one logical line for sidecar/async calls.
 * Priority: decisions > conversation turns > reflections.
 * Never preempts an in-flight item.
 *
 * Concurrency (K) is owned by LunaBrain's worker pool; this structure is the
 * waiting line only. resolveLunaConcurrency() is the shared client/sidecar
 * source of the K default (1–4).
 */

export type MindQueueKind = 'decision' | 'conversation' | 'reflection'

export interface MindQueueEntry {
  agentId: string
  kind: MindQueueKind
  /** Set for reflections so we can unmark on drop/budget clear. */
  nightKey?: number
  /** Conversation turn metadata (kind === 'conversation'). */
  conversationId?: string
  partnerId?: string
  turn?: number
}

export type EnqueueResult = 'enqueued' | 'duplicate' | 'dropped'

export const LUNA_CONCURRENCY_DEFAULT = 3
export const LUNA_CONCURRENCY_MIN = 1
export const LUNA_CONCURRENCY_MAX = 4

/** Clamp to the legal worker-pool size [1, 4]. */
export function clampLunaConcurrency(n: number): number {
  if (!Number.isFinite(n)) return LUNA_CONCURRENCY_DEFAULT
  return Math.max(
    LUNA_CONCURRENCY_MIN,
    Math.min(LUNA_CONCURRENCY_MAX, Math.floor(n)),
  )
}

/**
 * Resolve pool size K: explicit opt > `?mindConcurrency=` > localStorage
 * `luna.concurrency` > default 3. Always clamped 1–4.
 */
export function resolveLunaConcurrency(opts?: {
  explicit?: number
  search?: string
  localStorageGet?: (key: string) => string | null
}): number {
  if (opts?.explicit != null) return clampLunaConcurrency(opts.explicit)

  let n = LUNA_CONCURRENCY_DEFAULT

  const lsGet =
    opts?.localStorageGet ??
    (typeof localStorage !== 'undefined'
      ? (key: string) => {
          try {
            return localStorage.getItem(key)
          } catch {
            return null
          }
        }
      : undefined)
  if (lsGet) {
    const raw = lsGet('luna.concurrency')
    if (raw != null && raw !== '') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) n = parsed
    }
  }

  const search =
    opts?.search ??
    (typeof window !== 'undefined' ? window.location.search : '')
  if (search) {
    const q = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search,
    )
    const raw = q.get('mindConcurrency')
    if (raw != null && raw !== '') {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) n = parsed
    }
  }

  return clampLunaConcurrency(n)
}

function kindRank(kind: MindQueueKind): number {
  if (kind === 'decision') return 0
  if (kind === 'conversation') return 1
  return 2
}

/**
 * Local FIFO with decision > conversation > reflection priority.
 * Cap depth; overflow drops oldest reflection first, then oldest conversation.
 */
export class MindDispatchQueue {
  private entries: MindQueueEntry[] = []
  readonly maxDepth: number

  constructor(maxDepth: number) {
    this.maxDepth = Math.max(1, maxDepth)
  }

  size(): number {
    return this.entries.length
  }

  isEmpty(): boolean {
    return this.entries.length === 0
  }

  has(agentId: string): boolean {
    return this.entries.some((e) => e.agentId === agentId)
  }

  peek(): MindQueueEntry | undefined {
    return this.entries[0]
  }

  /** Entries currently waiting (not yet dispatched). */
  list(): readonly MindQueueEntry[] {
    return this.entries
  }

  clear(): MindQueueEntry[] {
    const was = this.entries
    this.entries = []
    return was
  }

  /**
   * Drop entries whose agent is no longer valid (world reset / missing agent).
   * @returns removed entries
   */
  pruneInvalid(validAgentIds: ReadonlySet<string>): MindQueueEntry[] {
    const removed: MindQueueEntry[] = []
    const kept: MindQueueEntry[] = []
    for (const e of this.entries) {
      if (validAgentIds.has(e.agentId)) kept.push(e)
      else removed.push(e)
    }
    this.entries = kept
    return removed
  }

  /**
   * Enqueue if agent is not already waiting.
   * Inserts by priority rank (FIFO within same rank).
   */
  enqueue(entry: MindQueueEntry): EnqueueResult {
    if (this.has(entry.agentId)) return 'duplicate'

    if (this.entries.length >= this.maxDepth) {
      if (!this.dropLowestPriority()) {
        console.warn(
          `[luna] mind queue full (depth ${this.maxDepth}); dropping ${entry.kind} for ${entry.agentId}`,
        )
        return 'dropped'
      }
    }

    const rank = kindRank(entry.kind)
    // After all better (lower rank) and same-rank (FIFO within rank).
    let i = 0
    while (i < this.entries.length && kindRank(this.entries[i]!.kind) <= rank) i++
    this.entries.splice(i, 0, entry)

    while (this.entries.length > this.maxDepth) {
      if (!this.dropLowestPriority()) {
        const dropped = this.entries.shift()
        if (dropped) {
          console.warn(
            `[luna] mind queue over cap; dropped ${dropped.kind} for ${dropped.agentId}`,
          )
        }
        break
      }
    }

    return 'enqueued'
  }

  dequeue(): MindQueueEntry | undefined {
    return this.entries.shift()
  }

  /**
   * Remove and return the first entry matching `pred` (priority order preserved).
   * Used so a blocked conversation lane does not stall later decisions.
   */
  takeFirst(pred: (e: MindQueueEntry) => boolean): MindQueueEntry | undefined {
    const idx = this.entries.findIndex(pred)
    if (idx < 0) return undefined
    const [entry] = this.entries.splice(idx, 1)
    return entry
  }

  /** Drop oldest reflection, else oldest conversation. @returns true if dropped. */
  private dropLowestPriority(): boolean {
    let idx = this.entries.findIndex((e) => e.kind === 'reflection')
    if (idx < 0) idx = this.entries.findIndex((e) => e.kind === 'conversation')
    if (idx < 0) return false
    const [dropped] = this.entries.splice(idx, 1)
    console.warn(
      `[luna] mind queue full; dropped oldest ${dropped?.kind} for ${dropped?.agentId}`,
    )
    return true
  }
}

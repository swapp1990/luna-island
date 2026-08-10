/**
 * App-wide mind dispatch queue: one logical line for sidecar/async calls.
 * Decisions FIFO ahead of reflections; never preempts an in-flight item.
 */

export type MindQueueKind = 'decision' | 'reflection'

export interface MindQueueEntry {
  agentId: string
  kind: MindQueueKind
  /** Set for reflections so we can unmark on drop/budget clear. */
  nightKey?: number
}

export type EnqueueResult = 'enqueued' | 'duplicate' | 'dropped'

/**
 * Local FIFO with decision priority over queued reflections.
 * Cap depth; overflow drops oldest reflection first, then oldest entry.
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
   * Decisions insert before any queued reflections (FIFO among decisions).
   * Reflections append after decisions.
   */
  enqueue(entry: MindQueueEntry): EnqueueResult {
    if (this.has(entry.agentId)) return 'duplicate'

    if (this.entries.length >= this.maxDepth) {
      if (!this.dropOldestReflection()) {
        // No reflection to drop — refuse rather than drop a decision
        console.warn(
          `[luna] mind queue full (depth ${this.maxDepth}); dropping ${entry.kind} for ${entry.agentId}`,
        )
        return 'dropped'
      }
    }

    if (entry.kind === 'decision') {
      // After last decision, before first reflection
      let i = 0
      while (i < this.entries.length && this.entries[i]!.kind === 'decision') i++
      this.entries.splice(i, 0, entry)
    } else {
      this.entries.push(entry)
    }

    // Safety: if still over cap (shouldn't happen with no-dupe), trim
    while (this.entries.length > this.maxDepth) {
      if (!this.dropOldestReflection()) {
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

  /** Drop the oldest reflection in the queue. @returns true if one was dropped. */
  private dropOldestReflection(): boolean {
    const idx = this.entries.findIndex((e) => e.kind === 'reflection')
    if (idx < 0) return false
    const [dropped] = this.entries.splice(idx, 1)
    console.warn(
      `[luna] mind queue full; dropped oldest reflection for ${dropped?.agentId}`,
    )
    return true
  }
}

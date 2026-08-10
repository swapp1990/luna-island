/**
 * App-wide mind dispatch queue: one logical line for sidecar/async calls.
 * Priority: decisions > conversation turns > reflections.
 * Never preempts an in-flight item.
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

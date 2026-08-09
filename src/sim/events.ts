import type { SimEvent, Tick } from './types'

export class EventTrace {
  private events: SimEvent[] = []
  private nextSeq = 0

  append(partial: Omit<SimEvent, 'seq'>): SimEvent {
    const ev: SimEvent = { ...partial, seq: this.nextSeq++ }
    this.events.push(ev)
    return ev
  }

  getAll(): readonly SimEvent[] {
    return this.events
  }

  get length(): number {
    return this.events.length
  }

  getSeq(): number {
    return this.nextSeq
  }

  setSeq(seq: number): void {
    this.nextSeq = seq
  }

  /** Replace the entire trace (used on restore / fork). */
  replace(events: SimEvent[], nextSeq?: number): void {
    this.events = events.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined }))
    this.nextSeq = nextSeq ?? (events.length > 0 ? events[events.length - 1]!.seq + 1 : 0)
  }

  /** Shallow-copy events for a fork. */
  clone(): EventTrace {
    const t = new EventTrace()
    t.replace(this.events.slice(), this.nextSeq)
    return t
  }

  eventsForAgent(id: string): SimEvent[] {
    return this.events.filter((e) => e.agentId === id)
  }

  eventsInRange(t0: Tick, t1: Tick): SimEvent[] {
    return this.events.filter((e) => e.tick >= t0 && e.tick <= t1)
  }
}

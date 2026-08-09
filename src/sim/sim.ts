import { createRng } from './rng'
import { EventTrace } from './events'
import { generateWorld } from './worldgen'
import { toSimTime } from './time'
import { fnv1aHex, stableStringify } from './stableStringify'
import type { Rng, SimEvent, Tick, WorldState } from './types'

const SNAPSHOT_INTERVAL = 180

export interface SimSnapshot {
  state: WorldState
  rngState: number
  eventSeq: number
  /** Events up to and including this snapshot's tick (for fork traces). */
  events: SimEvent[]
}

function deepCloneWorld(state: WorldState): WorldState {
  return {
    seed: state.seed,
    tick: state.tick,
    width: state.width,
    height: state.height,
    tiles: state.tiles.map((t) => ({ ...t })),
    places: state.places.map((p) => ({ ...p })),
    agents: state.agents.map((a) => ({
      ...a,
      needs: { ...a.needs },
      action: {
        ...a.action,
        path: a.action.path ? a.action.path.map((p) => [p[0], p[1]] as [number, number]) : undefined,
      },
    })),
  }
}

class SnapshotStore {
  private snaps: SimSnapshot[] = []

  add(snap: SimSnapshot): void {
    this.snaps.push(snap)
  }

  /** Nearest snapshot with tick ≤ target. */
  nearestAtOrBefore(tick: Tick): SimSnapshot | null {
    let best: SimSnapshot | null = null
    for (const s of this.snaps) {
      if (s.state.tick <= tick) {
        if (!best || s.state.tick > best.state.tick) best = s
      }
    }
    return best
  }

  clear(): void {
    this.snaps = []
  }
}

export class Simulation {
  state: WorldState
  private rng: Rng
  private events: EventTrace
  private snapshots: SnapshotStore

  constructor(seed: number)
  constructor(
    seed: number,
    opts?: {
      state?: WorldState
      rngState?: number
      events?: EventTrace
      snapshots?: SnapshotStore
      skipInitEvents?: boolean
    },
  )
  constructor(
    seed: number,
    opts?: {
      state?: WorldState
      rngState?: number
      events?: EventTrace
      snapshots?: SnapshotStore
      skipInitEvents?: boolean
    },
  ) {
    this.snapshots = opts?.snapshots ?? new SnapshotStore()
    this.events = opts?.events ?? new EventTrace()
    this.rng = createRng(seed)

    if (opts?.state) {
      this.state = opts.state
      if (opts.rngState !== undefined) this.rng.setState(opts.rngState)
    } else {
      this.state = generateWorld(seed)
      // Agent rng starts fresh from seed (worldgen uses its own internal rng from seed)
      this.rng = createRng(seed)
      if (!opts?.skipInitEvents) {
        this.events.append({
          tick: 0,
          type: 'world:created',
          data: { seed, width: this.state.width, height: this.state.height },
        })
        this.events.append({
          tick: 0,
          type: 'day:start',
          data: { day: 1 },
        })
      }
      // Snapshot at tick 0
      this.snapshots.add(this.makeSnapshot())
    }
  }

  getEvents(): readonly SimEvent[] {
    return this.events.getAll()
  }

  getEventCount(): number {
    return this.events.length
  }

  getRng(): Rng {
    return this.rng
  }

  /** No-op hook for Dispatch B agent stepping. */
  stepAgents(): void {
    // Agent AI lands in Dispatch B
  }

  advanceTicks(n: number): void {
    if (n <= 0) return
    for (let i = 0; i < n; i++) {
      this.stepOne()
    }
  }

  private stepOne(): void {
    const prevTick = this.state.tick
    this.state.tick = prevTick + 1

    // Day start when crossing into a new calendar day at 00:00
    const prev = toSimTime(prevTick)
    const next = toSimTime(this.state.tick)
    if (next.day !== prev.day) {
      this.events.append({
        tick: this.state.tick,
        type: 'day:start',
        data: { day: next.day },
      })
    }

    this.stepAgents()

    if (this.state.tick % SNAPSHOT_INTERVAL === 0) {
      this.snapshots.add(this.makeSnapshot())
    }
  }

  private makeSnapshot(): SimSnapshot {
    return {
      state: deepCloneWorld(this.state),
      rngState: this.rng.getState(),
      eventSeq: this.events.getSeq(),
      events: this.events.getAll().map((e) => ({
        ...e,
        data: e.data ? { ...e.data } : undefined,
      })),
    }
  }

  snapshot(): SimSnapshot {
    return this.makeSnapshot()
  }

  static fromSnapshot(snap: SimSnapshot, events?: SimEvent[]): Simulation {
    const ev = new EventTrace()
    const eventList = events ?? snap.events
    ev.replace(
      eventList.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
      snap.eventSeq,
    )
    const sim = new Simulation(snap.state.seed, {
      state: deepCloneWorld(snap.state),
      rngState: snap.rngState,
      events: ev,
      skipInitEvents: true,
    })
    // Rebuild snapshot ring from restored position for further seeks on this fork
    sim.snapshots.add(sim.makeSnapshot())
    return sim
  }

  /**
   * Returns a FORKED sim at the given tick. Never mutates the live sim.
   * Fork gets its own event trace (copy-on-fork).
   */
  stateAt(tick: Tick): Simulation {
    const target = Math.max(0, Math.min(tick, this.state.tick))
    const nearest = this.snapshots.nearestAtOrBefore(target)
    if (!nearest) {
      // Fallback: re-sim from scratch
      const fresh = new Simulation(this.state.seed)
      if (target > 0) fresh.advanceTicks(target)
      return fresh
    }
    const fork = Simulation.fromSnapshot(nearest)
    const remaining = target - fork.state.tick
    if (remaining > 0) fork.advanceTicks(remaining)
    return fork
  }

  hash(): string {
    return fnv1aHex(stableStringify(this.state))
  }
}

export { SNAPSHOT_INTERVAL }

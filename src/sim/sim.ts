import { createRng } from './rng'
import { EventTrace } from './events'
import { generateWorld } from './worldgen'
import { dayStartTick, toSimTime } from './time'
import { fnv1aHex, stableStringify } from './stableStringify'
import { spawnAgents } from './spawn'
import { findPath, isWalkable, pathStillValid } from './pathfind'
import {
  bedSlotForAgent,
  extendPathTo,
  isStanding,
  isWalking,
  millCandidates,
  nudgeCandidates,
  reserveSpot,
} from './spots'
import {
  UtilityBrain,
  anyNeedCritical,
  makeObservation,
  scoreCurrentAction,
  shouldKeepSleeping,
  urgentDifferentNeed,
} from './utilityBrain'
import type {
  AgentState,
  Intent,
  Needs,
  Rng,
  SimEvent,
  Tick,
  WorldState,
} from './types'

const SNAPSHOT_INTERVAL = 180
const REDECIDE_INTERVAL = 30
const HYSTERESIS = 0.15
const EAT_DURATION = 15
const DRINK_DURATION = 5
const MOVE_SPEED = 1.0 // tiles per tick

export interface SimSnapshot {
  state: WorldState
  rngState: number
  eventSeq: number
  /** Events up to and including this snapshot's tick (for fork traces). */
  events: SimEvent[]
}

/** Completed calendar day, reconstructible from pinned start snapshot + events. */
export interface DayArchiveMeta {
  day: number
  startTick: Tick
  endTick: Tick
}

function cloneNeeds(n: Needs): Needs {
  return { hunger: n.hunger, energy: n.energy, social: n.social }
}

function deepCloneAgent(a: AgentState): AgentState {
  return {
    ...a,
    needs: cloneNeeds(a.needs),
    needJitter: cloneNeeds(a.needJitter),
    criticalFired: { ...a.criticalFired },
    actionStartNeeds: cloneNeeds(a.actionStartNeeds),
    action: {
      ...a.action,
      path: a.action.path ? a.action.path.map((p) => [p[0], p[1]] as [number, number]) : undefined,
    },
  }
}

function deepCloneWorld(state: WorldState): WorldState {
  return {
    seed: state.seed,
    tick: state.tick,
    width: state.width,
    height: state.height,
    tiles: state.tiles.map((t) => ({ ...t })),
    places: state.places.map((p) => ({ ...p })),
    agents: state.agents.map(deepCloneAgent),
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function pct(n: number): number {
  return Math.round(clamp01(n) * 100)
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function atTarget(agent: AgentState, tx: number, ty: number): boolean {
  return Math.abs(agent.x - tx) < 0.05 && Math.abs(agent.y - ty) < 0.05
}

function resolveTarget(agent: AgentState): { x: number; y: number } | null {
  const a = agent.action
  if (a.targetX !== undefined && a.targetY !== undefined) {
    return { x: a.targetX, y: a.targetY }
  }
  return null
}

class SnapshotStore {
  private snaps: SimSnapshot[] = []
  /** Snapshot ticks that must survive prune (day-start pins). */
  private pinned = new Set<Tick>()

  add(snap: SimSnapshot): void {
    // Replace any existing snap at the same tick (keep one entry per tick).
    const t = snap.state.tick
    const idx = this.snaps.findIndex((s) => s.state.tick === t)
    if (idx >= 0) this.snaps[idx] = snap
    else this.snaps.push(snap)
  }

  pin(tick: Tick): void {
    this.pinned.add(tick)
  }

  /** Drop unpinned snapshots with startTick < tick ≤ endTick (fine ring for a finished day). */
  pruneRange(startTick: Tick, endTick: Tick): void {
    this.snaps = this.snaps.filter((s) => {
      const t = s.state.tick
      if (t <= startTick || t > endTick) return true
      return this.pinned.has(t)
    })
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

  ticks(): number[] {
    return this.snaps.map((s) => s.state.tick).sort((a, b) => a - b)
  }

  clear(): void {
    this.snaps = []
    this.pinned.clear()
  }
}

export class Simulation {
  state: WorldState
  private rng: Rng
  private events: EventTrace
  private snapshots: SnapshotStore
  private dayArchives: DayArchiveMeta[] = []
  private brain = new UtilityBrain()

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
      spawnAgents(this.state, this.rng)
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
      // Snapshot at tick 0 — permanently pinned as Day 1 start
      this.snapshots.add(this.makeSnapshot())
      this.snapshots.pin(0)
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

  /** Completed day archives (oldest first). Events are never pruned. */
  archives(): readonly DayArchiveMeta[] {
    return this.dayArchives
  }

  /** Test/debug: ticks of retained snapshots (after day prunes). */
  snapshotTicks(): number[] {
    return this.snapshots.ticks()
  }

  /** Synchronous multi-tick advance (bridge: `__simControl.ffwd`). */
  advanceTicksBatch(n: number): void {
    this.advanceTicks(n)
  }

  /** Advance every agent one sim minute: needs, movement, actions, decisions. */
  stepAgents(): void {
    const world = this.state
    const tick = world.tick
    const time = toSimTime(tick)
    const hour = time.hour

    // Snapshot agent positions for proximity social regen
    const positions = world.agents.map((a) => ({ id: a.id, x: a.x, y: a.y }))

    for (const agent of world.agents) {
      this.stepNeeds(agent, positions)
      this.stepMovementAndAction(agent)
      this.maybeRedecide(agent, hour)
    }
  }

  private stepNeeds(
    agent: AgentState,
    positions: Array<{ id: string; x: number; y: number }>,
  ): void {
    const j = agent.needJitter
    const sleeping = agent.action.kind === 'sleep' && this.isPerforming(agent)
    const socializing = agent.action.kind === 'socialize' && this.isPerforming(agent)

    // Hunger decay always
    agent.needs.hunger = clamp01(agent.needs.hunger - (1 / 960) * j.hunger)

    // Energy: decay awake, regen asleep
    if (sleeping) {
      agent.needs.energy = clamp01(agent.needs.energy + (1 / 420) * j.energy)
    } else {
      agent.needs.energy = clamp01(agent.needs.energy - (1 / 1080) * j.energy)
    }

    // Social: decay, bonus while socializing, passive near others
    if (socializing) {
      agent.needs.social = clamp01(agent.needs.social + (1 / 90) * j.social)
    } else {
      agent.needs.social = clamp01(agent.needs.social - (1 / 720) * j.social)
    }

    // Passive regen within 2 tiles of another agent
    let nearOther = false
    for (const p of positions) {
      if (p.id === agent.id) continue
      if (dist2(agent.x, agent.y, p.x, p.y) <= 4) {
        nearOther = true
        break
      }
    }
    if (nearOther && !socializing) {
      agent.needs.social = clamp01(agent.needs.social + (1 / 2880) * j.social)
    }

    this.checkCritical(agent, 'hunger', agent.needs.hunger)
    this.checkCritical(agent, 'energy', agent.needs.energy)
    this.checkCritical(agent, 'social', agent.needs.social)
  }

  private checkCritical(
    agent: AgentState,
    key: 'hunger' | 'energy' | 'social',
    value: number,
  ): void {
    if (value < 0.15) {
      if (!agent.criticalFired[key]) {
        agent.criticalFired[key] = true
        this.events.append({
          tick: this.state.tick,
          type: 'need:critical',
          agentId: agent.id,
          data: { need: key, value, agentName: agent.name },
          reason: `${key} critically low (${pct(value)}%)`,
        })
      }
    } else {
      agent.criticalFired[key] = false
    }
  }

  /** True when agent has arrived at action target (or idle with nothing to walk). */
  private isPerforming(agent: AgentState): boolean {
    if (agent.action.kind === 'idle') return true
    const target = resolveTarget(agent)
    if (!target) return true
    const path = agent.action.path
    if (path && agent.pathIndex < path.length) return false
    return atTarget(agent, target.x, target.y)
  }

  private stepMovementAndAction(agent: AgentState): void {
    const kind = agent.action.kind
    if (kind === 'idle') return

    const target = resolveTarget(agent)
    if (!target) return

    // Re-path if invalid
    const path = agent.action.path
    if (path && path.length > 0 && agent.pathIndex < path.length) {
      if (!pathStillValid(this.state, path, agent.pathIndex)) {
        const fresh = findPath(this.state, agent.x, agent.y, target.x, target.y)
        agent.action.path = fresh ?? []
        agent.pathIndex = 0
      }
    } else if (!atTarget(agent, target.x, target.y)) {
      // Need a path
      if (!path || path.length === 0 || agent.pathIndex >= (path?.length ?? 0)) {
        const fresh = findPath(this.state, agent.x, agent.y, target.x, target.y)
        agent.action.path = fresh ?? []
        agent.pathIndex = 0
      }
    }

    // Move along path
    if (agent.action.path && agent.pathIndex < agent.action.path.length) {
      // Move MOVE_SPEED tiles toward next waypoint (adjacent tiles → 1 tile/tick)
      let remaining = MOVE_SPEED
      while (remaining > 0 && agent.pathIndex < agent.action.path.length) {
        const [nx, ny] = agent.action.path[agent.pathIndex]!
        const dx = nx - agent.x
        const dy = ny - agent.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= remaining + 1e-9) {
          agent.x = nx
          agent.y = ny
          agent.pathIndex++
          remaining -= dist
        } else if (dist > 0) {
          agent.x += (dx / dist) * remaining
          agent.y += (dy / dist) * remaining
          remaining = 0
        } else {
          agent.pathIndex++
        }
      }
      return // walking this tick — no perform yet
    }

    // Arrived: perform action effects
    if (!atTarget(agent, target.x, target.y)) {
      // Unreachable — snap attempt failed; idle out
      this.endAction(agent, 'could not reach destination')
      agent.action = { kind: 'idle', reason: 'Stuck — catching their breath' }
      agent.actionTicks = 0
      agent.pathIndex = 0
      return
    }

    agent.x = target.x
    agent.y = target.y
    this.performAtTarget(agent)
  }

  private performAtTarget(agent: AgentState): void {
    const kind = agent.action.kind
    agent.actionTicks++

    if (kind === 'eat') {
      const before = agent.needs.hunger
      agent.needs.hunger = clamp01(agent.needs.hunger + 1 / 15)
      if (agent.actionTicks >= EAT_DURATION) {
        this.endAction(
          agent,
          `ate berries, hunger ${pct(agent.actionStartNeeds.hunger)}%→${pct(agent.needs.hunger)}%`,
        )
        agent.action = { kind: 'idle', reason: 'Full and content' }
        agent.actionTicks = 0
        // force redecide next
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      void before
      return
    }

    if (kind === 'drink') {
      agent.needs.energy = clamp01(agent.needs.energy + 0.02)
      if (agent.actionTicks >= DRINK_DURATION) {
        this.endAction(
          agent,
          `drank from the well, energy ${pct(agent.actionStartNeeds.energy)}%→${pct(agent.needs.energy)}%`,
        )
        agent.action = { kind: 'idle', reason: 'Refreshed' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    if (kind === 'sleep') {
      // energy regen applied in stepNeeds while performing sleep
      // Wake when fully rested, or when the clock crosses 07:00 (not "any daytime hour").
      const curr = toSimTime(this.state.tick)
      const prev = toSimTime(Math.max(0, this.state.tick - 1))
      const crossed7am =
        this.state.tick > 0 && prev.hour === 6 && curr.hour === 7
      if (agent.needs.energy >= 0.95 || crossed7am) {
        this.endAction(
          agent,
          `woke up, energy ${pct(agent.actionStartNeeds.energy)}%→${pct(agent.needs.energy)}%`,
        )
        agent.action = { kind: 'idle', reason: 'Rested and ready' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    if (kind === 'socialize') {
      // social regen in stepNeeds; mill to adjacent free plaza tiles
      this.maybeMillSocial(agent)
      return
    }

    if (kind === 'wander') {
      // Arrived at wander spot — done
      this.endAction(agent, 'finished a short stroll')
      agent.action = { kind: 'idle', reason: 'Looking around' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }
  }

  private endAction(agent: AgentState, outcome: string): void {
    if (agent.action.kind === 'idle') return
    this.events.append({
      tick: this.state.tick,
      type: 'action:end',
      agentId: agent.id,
      data: { kind: agent.action.kind, outcome },
      reason: outcome,
    })
  }

  private maybeRedecide(agent: AgentState, hour: number): void {
    const tick = this.state.tick
    const idle = agent.action.kind === 'idle'
    const due = tick - agent.lastDecideTick >= REDECIDE_INTERVAL
    // Urgent only for a *different* need than the one this action is serving
    const urgent = idle ? anyNeedCritical(agent) : urgentDifferentNeed(agent)

    // Keep sleeping unless urgent interrupt (natural wake is handled in performAtTarget)
    if (
      agent.action.kind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent, hour) &&
      !urgent
    ) {
      return
    }

    // Minimum action duration: once started, no re-decide for 30 ticks unless urgent
    if (!idle && !urgent && tick - agent.lastDecideTick < REDECIDE_INTERVAL) {
      return
    }

    // Don't interrupt eat/drink mid-meal unless urgent (duration-gated above also covers this)
    if (
      (agent.action.kind === 'eat' || agent.action.kind === 'drink') &&
      this.isPerforming(agent) &&
      agent.actionTicks > 0 &&
      !urgent
    ) {
      return
    }

    // Re-decide when idle (action just finished), on interval, or urgent interrupt
    if (!urgent && !idle && !due) return

    this.redecide(agent)
  }

  private redecide(agent: AgentState): void {
    const obs = makeObservation(agent, this.state)
    const intent = this.brain.decide(obs, this.rng)
    agent.lastDecideTick = this.state.tick

    const currentKind = agent.action.kind
    const sameTarget =
      currentKind === intent.kind &&
      agent.action.targetPlaceId === intent.targetPlaceId &&
      (intent.kind !== 'wander' ||
        (agent.action.targetX === intent.targetX && agent.action.targetY === intent.targetY))

    if (sameTarget && currentKind !== 'idle') {
      this.resolveCoStanding(agent)
      return // already doing it
    }

    // Hysteresis: keep current unless competitor beats by ≥ 0.15, except urgent
    const urgent = urgentDifferentNeed(agent)
    if (!urgent && currentKind !== 'idle' && currentKind !== 'wander') {
      // wander can be freely replaced; idle always takes new intent
      const currentScore = scoreCurrentAction(obs, currentKind)
      const newObsScore = this.scoreIntent(obs, intent)
      if (newObsScore < currentScore + HYSTERESIS) {
        this.resolveCoStanding(agent)
        return
      }
    }

    // Special: while sleeping and should keep sleeping, ignore non-urgent switches
    if (
      currentKind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent) &&
      !urgent
    ) {
      this.resolveCoStanding(agent)
      return
    }

    // Switch action
    if (currentKind !== 'idle') {
      this.endAction(agent, `stopped ${currentKind} to ${intent.kind}`)
    }

    this.startAction(agent, intent)
  }

  /**
   * Later-indexed non-walking agent on a shared tile nudges to an adjacent free
   * tile (extends path on current action — no events).
   */
  private resolveCoStanding(agent: AgentState): void {
    if (isWalking(agent)) return
    const ax = Math.round(agent.x)
    const ay = Math.round(agent.y)
    const agents = this.state.agents
    const myIndex = agents.indexOf(agent)
    if (myIndex < 0) return

    let stacked = false
    for (let i = 0; i < myIndex; i++) {
      const other = agents[i]!
      if (!isStanding(other)) continue
      if (Math.round(other.x) === ax && Math.round(other.y) === ay) {
        stacked = true
        break
      }
    }
    if (!stacked) return

    const cands = nudgeCandidates(this.state, agent)
    if (cands.length === 0) return
    const pick = this.rng.pick(cands)
    extendPathTo(this.state, agent, pick[0], pick[1])
  }

  /** After arriving at plaza: every 20–40 ticks, 30% chance to step adjacent. */
  private maybeMillSocial(agent: AgentState): void {
    const tick = this.state.tick
    if (agent.action.millNextTick === undefined) {
      agent.action.millNextTick = tick + 20 + this.rng.int(21) // 20..40
    }
    if (tick < agent.action.millNextTick) return

    agent.action.millNextTick = tick + 20 + this.rng.int(21)
    if (this.rng.next() >= 0.3) return

    const placeId = agent.action.targetPlaceId
    if (!placeId) return
    const plaza = this.state.places.find((p) => p.id === placeId)
    if (!plaza || plaza.kind !== 'plaza') return

    const cands = millCandidates(this.state, agent, plaza)
    if (cands.length === 0) return
    const pick = this.rng.pick(cands)
    extendPathTo(this.state, agent, pick[0], pick[1])
  }

  private scoreIntent(
    obs: ReturnType<typeof makeObservation>,
    intent: Intent,
  ): number {
    return scoreCurrentAction(obs, intent.kind)
  }

  private startAction(agent: AgentState, intent: Intent): void {
    let tx = intent.targetX
    let ty = intent.targetY

    const place = intent.targetPlaceId
      ? this.state.places.find((p) => p.id === intent.targetPlaceId)
      : undefined

    // Bed slots: shared-home residents sleep on distinct deterministic tiles
    if (intent.kind === 'sleep' && place && place.kind === 'home') {
      const bed = bedSlotForAgent(this.state, agent, place)
      tx = bed.x
      ty = bed.y
    } else if (place && intent.kind !== 'wander') {
      // Spot reservation: free tile within place radius (stored on action)
      const spot = reserveSpot(this.state, place, agent, this.rng)
      tx = spot.x
      ty = spot.y
    } else if ((tx === undefined || ty === undefined) && place) {
      tx = place.x
      ty = place.y
    }

    // Wander without coords
    if (intent.kind === 'wander' && (tx === undefined || ty === undefined)) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    // Fallback: stay put
    if (tx === undefined || ty === undefined) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    // Ensure target walkable
    if (!isWalkable(this.state, Math.round(tx), Math.round(ty))) {
      // try stay
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    const path = findPath(this.state, agent.x, agent.y, tx, ty)

    agent.action = {
      kind: intent.kind,
      targetPlaceId: intent.targetPlaceId,
      targetX: tx,
      targetY: ty,
      path: path ?? [],
      reason: intent.reason,
      millNextTick:
        intent.kind === 'socialize'
          ? this.state.tick + 20 + this.rng.int(21)
          : undefined,
    }
    agent.pathIndex = 0
    agent.actionTicks = 0
    agent.actionStartNeeds = cloneNeeds(agent.needs)

    const targetPlace = intent.targetPlaceId
      ? this.state.places.find((p) => p.id === intent.targetPlaceId)
      : undefined
    this.events.append({
      tick: this.state.tick,
      type: 'action:start',
      agentId: agent.id,
      data: {
        kind: intent.kind,
        target: intent.targetPlaceId ?? `${tx},${ty}`,
        agentName: agent.name,
        placeKind: targetPlace?.kind,
      },
      reason: intent.reason,
    })
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
      this.archiveCompletedDay(prev.day, prevTick)
      this.events.append({
        tick: this.state.tick,
        type: 'day:start',
        data: { day: next.day },
      })
    }

    this.stepAgents()

    if (this.state.tick % SNAPSHOT_INTERVAL === 0) {
      this.snapshots.add(this.makeSnapshot())
      // Pin midnight day-starts so they survive the next day's prune
      if (toSimTime(this.state.tick).hour === 0 && toSimTime(this.state.tick).minute === 0) {
        this.snapshots.pin(this.state.tick)
      }
    }
  }

  /**
   * Record a finished calendar day, pin its start snapshot, drop fine-grained
   * snapshots inside the day (reconstruct via start snap + events).
   */
  private archiveCompletedDay(day: number, endTick: Tick): void {
    const startTick = dayStartTick(day)
    if (this.dayArchives.some((a) => a.day === day)) return
    this.snapshots.pin(startTick)
    // Ensure a snap exists at start (tick 0 always does; later midnights are interval-aligned)
    const nearest = this.snapshots.nearestAtOrBefore(startTick)
    if (!nearest || nearest.state.tick !== startTick) {
      // Should not happen on normal runs; skip prune rather than leave day unrecoverable
      this.dayArchives.push({ day, startTick, endTick })
      return
    }
    this.snapshots.pruneRange(startTick, endTick)
    this.dayArchives.push({ day, startTick, endTick })
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

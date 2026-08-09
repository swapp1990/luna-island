import { createRng } from './rng'
import { EventTrace } from './events'
import { generateWorld } from './worldgen'
import { dayStartTick, toSimTime } from './time'
import { fnv1aHex, stableStringify } from './stableStringify'
import { spawnAgents } from './spawn'
import { findPath, isWalkable, pathStillValid } from './pathfind'
import {
  bedSlotForAgent,
  canRestoreThisTick,
  extendPathTo,
  isSlotTile,
  isStanding,
  isWalking,
  nudgeCandidates,
  reserveSpot,
  SOCIAL_PROXIMITY_SQ,
  workplaceHasOpenJob,
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
  EconomyStat,
  Good,
  Intent,
  Inventory,
  Needs,
  OwnerId,
  Place,
  Rng,
  SimEvent,
  Tick,
  WorldState,
} from './types'

const SNAPSHOT_INTERVAL = 180
const REDECIDE_INTERVAL = 30
const HYSTERESIS = 0.15
/** Ticks per food unit consumed while eating. */
const EAT_TICKS_PER_UNIT = 10
const EAT_HUNGER_PER_UNIT = 0.45
const EAT_MAX_UNITS = 2
/** Ticks per food unit foraged from a bush. */
const FORAGE_TICKS_PER_UNIT = 5
const FORAGE_CARRY_CAP = 3
const BUSH_STOCK_MAX = 6
const BUSH_REGROW_INTERVAL = 240
const DRINK_DURATION = 5
const MOVE_SPEED = 1.0 // tiles per tick
const COLLAPSE_MOVE_FACTOR = 0.4
const COLLAPSE_ENTER = 0.02
const COLLAPSE_CLEAR = 0.25
/** Full daily wage requires this many work ticks (08:00–17:00). */
const FULL_WAGE_TICKS = 300
/** Farm harvest haul size. */
const HAUL_SIZE = 5
/** Max food units per market visit. */
const BUY_MAX_UNITS = 2
/** Farm growth per tick while tended. */
const FARM_GROWTH_PER_TICK = 1 / 1440
const FARM_PRODUCE_AMOUNT = 10

/** Coin party: agent id or the village treasury. */
export type CoinParty = string | 'treasury'

/** Goods holder: agent or place inventory. */
export type GoodsParty =
  | { kind: 'agent'; id: string }
  | { kind: 'place'; id: string }

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

function cloneInventory(inv: Inventory): Inventory {
  return { food: inv.food ?? 0 }
}

function deepCloneAgent(a: AgentState): AgentState {
  return {
    ...a,
    needs: cloneNeeds(a.needs),
    needJitter: cloneNeeds(a.needJitter),
    criticalFired: { ...a.criticalFired },
    actionStartNeeds: cloneNeeds(a.actionStartNeeds),
    inventory: cloneInventory(a.inventory),
    action: {
      ...a.action,
      path: a.action.path ? a.action.path.map((p) => [p[0], p[1]] as [number, number]) : undefined,
    },
    employedAt: a.employedAt,
    workedTicks: a.workedTicks,
    daysIdleOnJob: a.daysIdleOnJob,
    workPhase: a.workPhase,
    haulAmount: a.haulAmount,
  }
}

function deepClonePlace(p: Place): Place {
  return {
    ...p,
    inventory: cloneInventory(p.inventory ?? { food: 0 }),
    growth: p.growth,
    jobSlots: p.jobSlots,
    wage: p.wage,
    price: p.price ? { ...p.price } : undefined,
  }
}

function deepCloneWorld(state: WorldState): WorldState {
  return {
    seed: state.seed,
    tick: state.tick,
    width: state.width,
    height: state.height,
    tiles: state.tiles.map((t) => ({ ...t })),
    places: state.places.map(deepClonePlace),
    agents: state.agents.map(deepCloneAgent),
    treasury: state.treasury,
    owners: { ...state.owners },
    stats: state.stats.map((s) => ({ ...s })),
  }
}

/** Posted stall food price from stock (world fact). */
export function marketPriceFromStock(stock: number): number {
  const raw = Math.round(4 * Math.sqrt(8 / Math.max(stock, 1)))
  return Math.max(2, Math.min(12, raw))
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

  /**
   * Coin conservation law: the ONLY way money moves.
   * `from`/`to` are agent ids or `'treasury'`. Never creates or destroys coins.
   */
  transferCoins(
    from: CoinParty,
    to: CoinParty,
    amount: number,
    reason: string,
    extra?: Record<string, unknown>,
  ): boolean {
    if (amount <= 0 || from === to) return false
    const fromBal = this.coinBalance(from)
    if (fromBal < amount) return false
    this.setCoinBalance(from, fromBal - amount)
    this.setCoinBalance(to, this.coinBalance(to) + amount)
    this.events.append({
      tick: this.state.tick,
      type: 'coins:transfer',
      agentId: to !== 'treasury' ? to : from !== 'treasury' ? from : undefined,
      data: { from, to, amount, ...(extra ?? {}) },
      reason,
    })
    return true
  }

  /**
   * Mint goods at a place (farm harvest only). Emits `goods:produced`.
   * The ONLY creation path besides bush regrowth.
   */
  produceGoods(
    placeId: string,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const place = this.state.places.find((p) => p.id === placeId)
    if (!place) return false
    place.inventory[good] = (place.inventory[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:produced',
      data: { good, amount, placeId, placeKind: place.kind },
      reason,
    })
    return true
  }

  /**
   * Goods conservation for moves: the ONLY way goods change hands.
   * Creation uses `regrowGoods`; destruction uses `consumeGoods`.
   */
  transferGoods(
    from: GoodsParty,
    to: GoodsParty,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const fromInv = this.goodsInventory(from)
    const toInv = this.goodsInventory(to)
    if (!fromInv || !toInv) return false
    if ((fromInv[good] ?? 0) < amount) return false
    fromInv[good] = (fromInv[good] ?? 0) - amount
    toInv[good] = (toInv[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:transfer',
      agentId: to.kind === 'agent' ? to.id : from.kind === 'agent' ? from.id : undefined,
      data: {
        good,
        amount,
        fromKind: from.kind,
        fromId: from.id,
        toKind: to.kind,
        toId: to.id,
      },
      reason,
    })
    // Keep posted stall price honest when stock moves mid-hour
    if (
      good === 'food' &&
      ((from.kind === 'place' && this.state.places.find((p) => p.id === from.id)?.kind === 'stall') ||
        (to.kind === 'place' && this.state.places.find((p) => p.id === to.id)?.kind === 'stall'))
    ) {
      this.stepMarketPrice()
    }
    return true
  }

  /** Destroy goods from a holder (eating). Emits `goods:consume`. */
  consumeGoods(
    holder: GoodsParty,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const inv = this.goodsInventory(holder)
    if (!inv) return false
    if ((inv[good] ?? 0) < amount) return false
    inv[good] = (inv[good] ?? 0) - amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:consume',
      agentId: holder.kind === 'agent' ? holder.id : undefined,
      data: {
        good,
        amount,
        holderKind: holder.kind,
        holderId: holder.id,
      },
      reason,
    })
    return true
  }

  /** World process: create goods at a place (bush regrowth). Emits `goods:regrow`. */
  regrowGoods(
    placeId: string,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const place = this.state.places.find((p) => p.id === placeId)
    if (!place) return false
    place.inventory[good] = (place.inventory[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:regrow',
      data: { good, amount, placeId, placeKind: place.kind },
      reason,
    })
    return true
  }

  /** Ownership registry transfer. Emits `ownership:transfer`. */
  transferOwnership(
    placeId: string,
    newOwner: OwnerId,
    reason: string,
  ): boolean {
    if (!(placeId in this.state.owners) && !this.state.places.some((p) => p.id === placeId)) {
      return false
    }
    const prev = this.state.owners[placeId] ?? 'commons'
    if (prev === newOwner) return false
    this.state.owners[placeId] = newOwner
    this.events.append({
      tick: this.state.tick,
      type: 'ownership:transfer',
      data: { placeId, from: prev, to: newOwner },
      reason,
    })
    return true
  }

  private coinBalance(party: CoinParty): number {
    if (party === 'treasury') return this.state.treasury
    const agent = this.state.agents.find((a) => a.id === party)
    return agent?.wallet ?? 0
  }

  private setCoinBalance(party: CoinParty, value: number): void {
    if (party === 'treasury') {
      this.state.treasury = value
      return
    }
    const agent = this.state.agents.find((a) => a.id === party)
    if (agent) agent.wallet = value
  }

  private goodsInventory(party: GoodsParty): Inventory | null {
    if (party.kind === 'agent') {
      const agent = this.state.agents.find((a) => a.id === party.id)
      return agent?.inventory ?? null
    }
    const place = this.state.places.find((p) => p.id === party.id)
    return place?.inventory ?? null
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
    // World rule 3: after movement, later-indexed co-standers yield a free tile.
    // Two passes — a first nudge can free a tile for a third stacked agent.
    for (let pass = 0; pass < 2; pass++) {
      for (const agent of world.agents) {
        this.resolveCoStanding(agent)
      }
    }
  }

  private stepNeeds(
    agent: AgentState,
    positions: Array<{ id: string; x: number; y: number }>,
  ): void {
    const j = agent.needJitter
    const place = agent.action.targetPlaceId
      ? this.state.places.find((p) => p.id === agent.action.targetPlaceId)
      : undefined
    const canRestore =
      !!place &&
      this.isPerforming(agent) &&
      canRestoreThisTick(this.state, agent, place)
    // Collapse blocks restores except eat/sleep (eat is inventory-based, not place restore)
    const restoreAllowed = !agent.collapsed
    const sleeping = agent.action.kind === 'sleep' && canRestore

    // Hunger decay always
    agent.needs.hunger = clamp01(agent.needs.hunger - (1 / 960) * j.hunger)

    // Energy: decay awake, regen asleep (only on home slot tile within capacity)
    if (sleeping) {
      agent.needs.energy = clamp01(agent.needs.energy + (1 / 420) * j.energy)
    } else {
      agent.needs.energy = clamp01(agent.needs.energy - (1 / 1080) * j.energy)
    }

    // World rule 2: social regenerates only with another agent within 1.5 tiles
    // Collapse blocks social restore (active + passive proximity gain)
    let nearOther = false
    for (const p of positions) {
      if (p.id === agent.id) continue
      if (dist2(agent.x, agent.y, p.x, p.y) <= SOCIAL_PROXIMITY_SQ) {
        nearOther = true
        break
      }
    }
    if (nearOther && restoreAllowed) {
      // Active socialize on a plaza slot gets the full rate; otherwise passive proximity
      const socializing = agent.action.kind === 'socialize' && canRestore
      if (socializing) {
        agent.needs.social = clamp01(agent.needs.social + (1 / 90) * j.social)
      } else {
        agent.needs.social = clamp01(agent.needs.social + (1 / 2880) * j.social)
      }
    } else if (!nearOther) {
      agent.needs.social = clamp01(agent.needs.social - (1 / 720) * j.social)
    } else {
      // Collapsed + near other: social still decays (no restore while collapsed)
      agent.needs.social = clamp01(agent.needs.social - (1 / 720) * j.social)
    }

    this.checkCritical(agent, 'hunger', agent.needs.hunger)
    this.checkCritical(agent, 'energy', agent.needs.energy)
    this.checkCritical(agent, 'social', agent.needs.social)
    this.checkCollapse(agent)
  }

  private checkCollapse(agent: AgentState): void {
    if (!agent.collapsed && agent.needs.hunger <= COLLAPSE_ENTER) {
      agent.collapsed = true
      this.events.append({
        tick: this.state.tick,
        type: 'agent:collapsed',
        agentId: agent.id,
        data: {
          agentName: agent.name,
          hunger: agent.needs.hunger,
        },
        reason: `${agent.name} collapsed from hunger (${pct(agent.needs.hunger)}%) — needs food`,
      })
    } else if (agent.collapsed && agent.needs.hunger >= COLLAPSE_CLEAR) {
      agent.collapsed = false
      this.events.append({
        tick: this.state.tick,
        type: 'agent:recovered',
        agentId: agent.id,
        data: {
          agentName: agent.name,
          hunger: agent.needs.hunger,
        },
        reason: `${agent.name} recovered (hunger ${pct(agent.needs.hunger)}%) — back on their feet`,
      })
    }
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

    // Move along path (collapsed agents crawl at ×0.4)
    if (agent.action.path && agent.pathIndex < agent.action.path.length) {
      const speed = MOVE_SPEED * (agent.collapsed ? COLLAPSE_MOVE_FACTOR : 1)
      let remaining = speed
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

    const place = agent.action.targetPlaceId
      ? this.state.places.find((p) => p.id === agent.action.targetPlaceId)
      : undefined
    const onSlot = !!place && canRestoreThisTick(this.state, agent, place)

    // Eat anywhere: consume carried food over 10 ticks/unit, max 2 units/meal
    if (kind === 'eat') {
      if (
        agent.actionTicks > 0 &&
        agent.actionTicks % EAT_TICKS_PER_UNIT === 0
      ) {
        const unitsDone = agent.actionTicks / EAT_TICKS_PER_UNIT
        const ok = this.consumeGoods(
          { kind: 'agent', id: agent.id },
          'food',
          1,
          `${agent.name} ate carried food`,
        )
        if (ok) {
          agent.needs.hunger = clamp01(
            agent.needs.hunger + EAT_HUNGER_PER_UNIT,
          )
        }
        const moreFood = (agent.inventory.food ?? 0) >= 1
        if (!ok || unitsDone >= EAT_MAX_UNITS || !moreFood) {
          this.endAction(
            agent,
            `ate a meal, hunger ${pct(agent.actionStartNeeds.hunger)}%→${pct(agent.needs.hunger)}%`,
          )
          agent.action = {
            kind: 'idle',
            reason: ok ? 'Finished eating' : 'No food left to eat',
          }
          agent.actionTicks = 0
          agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        }
      } else if ((agent.inventory.food ?? 0) < 1 && agent.actionTicks === 1) {
        // Started eat with no food — abort immediately
        this.endAction(agent, 'had nothing to eat')
        agent.action = { kind: 'idle', reason: 'No food to eat' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    // Forage at bush slot: every 5 ticks, bush→agent 1 food until carry 3 or empty
    if (kind === 'forage') {
      if (onSlot && place) {
        if (
          agent.actionTicks > 0 &&
          agent.actionTicks % FORAGE_TICKS_PER_UNIT === 0
        ) {
          const bushStock = place.inventory.food ?? 0
          const carry = agent.inventory.food ?? 0
          if (bushStock > 0 && carry < FORAGE_CARRY_CAP) {
            this.transferGoods(
              { kind: 'place', id: place.id },
              { kind: 'agent', id: agent.id },
              'food',
              1,
              `${agent.name} picked berries at ${place.id}`,
            )
          }
        }
        const carry = agent.inventory.food ?? 0
        const bushStock = place.inventory.food ?? 0
        if (carry >= FORAGE_CARRY_CAP || bushStock <= 0) {
          this.endAction(
            agent,
            carry >= FORAGE_CARRY_CAP
              ? `foraged a full load (${carry} food)`
              : `bush empty, carrying ${carry} food`,
          )
          agent.action = {
            kind: 'idle',
            reason:
              carry >= FORAGE_CARRY_CAP
                ? 'Arms full of berries'
                : 'Bush picked clean',
          }
          agent.actionTicks = 0
          agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        }
      }
      return
    }

    if (kind === 'drink') {
      // Collapse blocks drink restore
      if (onSlot && !agent.collapsed) {
        agent.needs.energy = clamp01(agent.needs.energy + 0.02)
      }
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
      // energy regen applied in stepNeeds while restoring on home slot
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
      // social regen gated by proximity + slot + collapse in stepNeeds — no milling
      return
    }

    if (kind === 'work') {
      // Work uses footprint occupancy (isSlotTile), not restore-slot ranking —
      // job seats are separate from place.slots concurrent capacity.
      const onWorkSlot =
        !!place &&
        isStanding(agent) &&
        isSlotTile(this.state, place, agent.x, agent.y)
      this.performWork(agent, place, onWorkSlot)
      return
    }

    if (kind === 'buy') {
      this.performBuy(agent, place, onSlot)
      return
    }

    if (kind === 'wander') {
      this.endAction(agent, 'finished a short stroll')
      agent.action = { kind: 'idle', reason: 'Looking around' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }
  }

  /** Work at workplace: accrue ticks; farms tend/haul; stall is passive. */
  private performWork(
    agent: AgentState,
    place: Place | undefined,
    onSlot: boolean,
  ): void {
    // During haul/return the target place is stall or farm — resolve by phase
    const workplace = agent.employedAt
      ? this.state.places.find((p) => p.id === agent.employedAt)
      : undefined
    if (!workplace) {
      this.endAction(agent, 'no longer employed')
      agent.action = { kind: 'idle', reason: 'Looking for work' }
      agent.actionTicks = 0
      this.returnHaulCargo(agent)
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    const time = toSimTime(this.state.tick)
    const workHours = time.hour >= 8 && time.hour < 17

    // Accrue workedTicks only on workplace slot during work hours (tend only)
    const onWorkplaceSlot =
      isStanding(agent) && isSlotTile(this.state, workplace, agent.x, agent.y)
    if (
      onWorkplaceSlot &&
      workHours &&
      (agent.workPhase === null || agent.workPhase === 'tend')
    ) {
      agent.workedTicks++
    }

    // Stall work: just stand and accrue
    if (workplace.kind === 'stall') {
      agent.workPhase = 'tend'
      return
    }

    // Farm work: tend / haul phases
    if (workplace.kind !== 'farm') return

    if (agent.workPhase === null) agent.workPhase = 'tend'

    // Hauling to stall
    if (agent.workPhase === 'hauling') {
      const stall = this.state.places.find((p) => p.kind === 'stall')
      if (!stall) {
        this.returnHaulCargo(agent)
        agent.workPhase = 'tend'
        return
      }
      const atStall =
        isStanding(agent) && isSlotTile(this.state, stall, agent.x, agent.y)
      if (atStall && agent.haulAmount > 0) {
        const amt = Math.min(agent.haulAmount, agent.inventory.food ?? 0)
        if (amt > 0) {
          this.transferGoods(
            { kind: 'agent', id: agent.id },
            { kind: 'place', id: stall.id },
            'food',
            amt,
            `${agent.name} stocked the market stall with ${amt} food`,
          )
        }
        agent.haulAmount = 0
        agent.workPhase = 'returning'
        this.retargetToPlace(agent, workplace, 'Returning to the farm after hauling')
      } else if (
        // Ensure path keeps targeting the stall
        agent.action.targetPlaceId !== stall.id &&
        agent.haulAmount > 0
      ) {
        this.retargetToPlace(
          agent,
          stall,
          `Hauling ${agent.haulAmount} food to the market stall`,
        )
      }
      return
    }

    if (agent.workPhase === 'returning') {
      if (onWorkplaceSlot) {
        agent.workPhase = 'tend'
        agent.action.targetPlaceId = workplace.id
        agent.action.reason = `Working the farm at ${workplace.id}`
      } else if (agent.action.targetPlaceId !== workplace.id) {
        this.retargetToPlace(agent, workplace, 'Returning to the farm after hauling')
      }
      return
    }

    // Tend phase: when farm has ≥5 food, auto-start haul leg
    if (agent.workPhase === 'tend' && onWorkplaceSlot) {
      const farmFood = workplace.inventory.food ?? 0
      if (farmFood >= HAUL_SIZE) {
        const stall = this.state.places.find((p) => p.kind === 'stall')
        if (stall) {
          const amt = Math.min(HAUL_SIZE, farmFood)
          const ok = this.transferGoods(
            { kind: 'place', id: workplace.id },
            { kind: 'agent', id: agent.id },
            'food',
            amt,
            `${agent.name} picked up ${amt} food to haul to market`,
          )
          if (ok) {
            agent.haulAmount = amt
            agent.workPhase = 'hauling'
            this.retargetToPlace(
              agent,
              stall,
              `Hauling ${amt} food to the market stall`,
            )
          }
        }
      }
    }
    void place
    void onSlot
  }

  private performBuy(
    agent: AgentState,
    place: Place | undefined,
    onSlot: boolean,
  ): void {
    if (!place || place.kind !== 'stall' || !onSlot) {
      if (agent.actionTicks > 30) {
        this.endAction(agent, 'could not buy at the stall')
        agent.action = { kind: 'idle', reason: 'Left the market' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    const price = place.price?.food ?? marketPriceFromStock(place.inventory.food ?? 0)

    // One unit per performing tick, up to BUY_MAX_UNITS
    if (agent.actionTicks <= BUY_MAX_UNITS) {
      const stock = place.inventory.food ?? 0
      if (stock <= 0 || agent.wallet < price) {
        this.endAction(
          agent,
          stock <= 0 ? 'stall sold out' : 'not enough coins',
        )
        agent.action = {
          kind: 'idle',
          reason: stock <= 0 ? 'Stall empty' : 'Short on coins',
        }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        return
      }
      const paid = this.transferCoins(
        agent.id,
        'treasury',
        price,
        `${agent.name} paid ${price} coins for food at the stall`,
        { kind: 'buy', good: 'food', unitPrice: price },
      )
      if (paid) {
        this.transferGoods(
          { kind: 'place', id: place.id },
          { kind: 'agent', id: agent.id },
          'food',
          1,
          `${agent.name} bought 1 food at the stall`,
        )
      }
    }

    if (agent.actionTicks >= BUY_MAX_UNITS) {
      this.endAction(agent, 'bought food at the market')
      agent.action = { kind: 'idle', reason: 'Bag of groceries' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
    }
  }

  /** Retarget current work action to another place without ending it. */
  private retargetToPlace(
    agent: AgentState,
    place: Place,
    reason: string,
  ): void {
    const spot = reserveSpot(this.state, place, agent, this.rng)
    const tx = spot?.x ?? place.x
    const ty = spot?.y ?? place.y
    agent.action.targetPlaceId = place.id
    agent.action.targetX = tx
    agent.action.targetY = ty
    agent.action.reason = reason
    agent.action.path = findPath(this.state, agent.x, agent.y, tx, ty) ?? []
    agent.pathIndex = 0
  }

  private hireAgent(agent: AgentState, place: Place): boolean {
    if (agent.employedAt === place.id) return true
    if (agent.employedAt) return false
    if (!workplaceHasOpenJob(this.state, place, agent.id)) return false
    agent.employedAt = place.id
    agent.daysIdleOnJob = 0
    agent.workedTicks = 0
    this.events.append({
      tick: this.state.tick,
      type: 'job:hired',
      agentId: agent.id,
      data: {
        agentName: agent.name,
        placeId: place.id,
        placeKind: place.kind,
        wage: place.wage ?? 0,
      },
      reason: `${agent.name} took a job at the ${place.kind} (${place.wage ?? 0} coins/day)`,
    })
    return true
  }

  private vacateJob(agent: AgentState, reason: string): void {
    if (!agent.employedAt) return
    const placeId = agent.employedAt
    const place = this.state.places.find((p) => p.id === placeId)
    agent.employedAt = null
    agent.workedTicks = 0
    agent.daysIdleOnJob = 0
    agent.workPhase = null
    agent.haulAmount = 0
    this.events.append({
      tick: this.state.tick,
      type: 'job:vacated',
      agentId: agent.id,
      data: {
        agentName: agent.name,
        placeId,
        placeKind: place?.kind,
      },
      reason,
    })
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

    // Sleep is committed while resting on a bed slot: natural wake only
    // (energy ≥ 0.95 or 07:00). Prevents scarcity thrash of sleep↔forage/social.
    // Walking home to sleep can still be redecided.
    if (
      agent.action.kind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent, hour)
    ) {
      return
    }

    // Minimum action duration: once started, no re-decide for 30 ticks
    // (urgent included — interval is the max interrupt rate).
    if (!idle && tick - agent.lastDecideTick < REDECIDE_INTERVAL) {
      return
    }

    // Don't interrupt eat/drink/forage/buy mid-action for non-urgent redecide
    if (
      (agent.action.kind === 'eat' ||
        agent.action.kind === 'drink' ||
        agent.action.kind === 'forage' ||
        agent.action.kind === 'buy') &&
      this.isPerforming(agent) &&
      agent.actionTicks > 0 &&
      !urgent
    ) {
      return
    }

    // Mid-haul: finish the haul leg before redecide (never abandon cargo mid-path)
    if (
      agent.action.kind === 'work' &&
      (agent.workPhase === 'hauling' || agent.workPhase === 'returning')
    ) {
      return
    }

    // Re-decide when idle (action just finished) or on interval
    if (!idle && !due) return

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

    // Hysteresis: keep current unless competitor beats by ≥ 0.15.
    if (currentKind !== 'idle' && currentKind !== 'wander') {
      // wander can be freely replaced; idle always takes new intent
      const currentScore = scoreCurrentAction(obs, currentKind)
      const newObsScore = this.scoreIntent(obs, intent)
      if (newObsScore < currentScore + HYSTERESIS) {
        this.resolveCoStanding(agent)
        return
      }
    }

    // Special: while sleeping and should keep sleeping, ignore all switches
    if (
      currentKind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent)
    ) {
      this.resolveCoStanding(agent)
      return
    }

    // Switch action
    if (currentKind !== 'idle') {
      this.endAction(agent, `stopped ${currentKind} to ${intent.kind}`)
    }
    // Leaving work: return undelivered haul cargo to the farm (no free food)
    if (currentKind === 'work' && intent.kind !== 'work') {
      this.returnHaulCargo(agent)
    }

    this.startAction(agent, intent)
  }

  /** Return undelivered haul food to the employing farm. */
  private returnHaulCargo(agent: AgentState): void {
    if (agent.haulAmount <= 0) {
      agent.workPhase = null
      agent.haulAmount = 0
      return
    }
    const farmId =
      agent.employedAt &&
      this.state.places.find((p) => p.id === agent.employedAt)?.kind === 'farm'
        ? agent.employedAt
        : this.state.places.find((p) => p.kind === 'farm')?.id
    const amt = Math.min(agent.haulAmount, agent.inventory.food ?? 0)
    if (farmId && amt > 0) {
      this.transferGoods(
        { kind: 'agent', id: agent.id },
        { kind: 'place', id: farmId },
        'food',
        amt,
        `${agent.name} returned undelivered harvest to ${farmId}`,
      )
    }
    agent.workPhase = null
    agent.haulAmount = 0
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

  private scoreIntent(
    obs: ReturnType<typeof makeObservation>,
    intent: Intent,
  ): number {
    return scoreCurrentAction(obs, intent.kind)
  }

  private startAction(agent: AgentState, intent: Intent): void {
    let tx = intent.targetX
    let ty = intent.targetY
    let kind = intent.kind
    let targetPlaceId = intent.targetPlaceId
    let reason = intent.reason

    let place = targetPlaceId
      ? this.state.places.find((p) => p.id === targetPlaceId)
      : undefined

    // Employment: starting work hires unemployed agents when a seat is free
    if (kind === 'work' && place && (place.jobSlots ?? 0) > 0) {
      if (!agent.employedAt) {
        if (!this.hireAgent(agent, place)) {
          kind = 'wander'
          targetPlaceId = undefined
          place = undefined
          reason = 'No open jobs — wandering'
          tx = Math.round(agent.x)
          ty = Math.round(agent.y)
        }
      } else if (agent.employedAt !== place.id) {
        // Already employed elsewhere — redirect to own workplace
        const own = this.state.places.find((p) => p.id === agent.employedAt)
        if (own) {
          place = own
          targetPlaceId = own.id
          tx = own.x
          ty = own.y
        }
      }
      if (kind === 'work') {
        // Fresh tend shift — return any leftover haul first
        if (agent.haulAmount > 0) this.returnHaulCargo(agent)
        agent.workPhase = 'tend'
        agent.haulAmount = 0
      }
    }

    // Bed slots: shared-home residents sleep on distinct deterministic tiles
    if (kind === 'sleep' && place && place.kind === 'home') {
      const bed = bedSlotForAgent(this.state, agent, place)
      tx = bed.x
      ty = bed.y
    } else if (place && kind !== 'wander') {
      // Slot reservation: free tile within footprint only (no ring-widening)
      const preferred =
        tx !== undefined && ty !== undefined ? { x: tx, y: ty } : undefined
      const spot = reserveSpot(this.state, place, agent, this.rng, preferred)
      if (spot) {
        tx = spot.x
        ty = spot.y
      } else {
        // Place full — fall through to a short wander (no waiting state)
        kind = 'wander'
        targetPlaceId = undefined
        reason = 'Place was full — wandering nearby'
        tx = Math.round(agent.x)
        ty = Math.round(agent.y)
        if (intent.kind === 'work') {
          agent.workPhase = null
        }
      }
    } else if ((tx === undefined || ty === undefined) && place) {
      tx = place.x
      ty = place.y
    }

    if (kind === 'wander' && (tx === undefined || ty === undefined)) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    if (tx === undefined || ty === undefined) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    if (!isWalkable(this.state, Math.round(tx), Math.round(ty))) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    const path = findPath(this.state, agent.x, agent.y, tx, ty)

    agent.action = {
      kind,
      targetPlaceId,
      targetX: tx,
      targetY: ty,
      path: path ?? [],
      reason,
    }
    agent.pathIndex = 0
    agent.actionTicks = 0
    agent.actionStartNeeds = cloneNeeds(agent.needs)

    const targetPlace = targetPlaceId
      ? this.state.places.find((p) => p.id === targetPlaceId)
      : undefined
    this.events.append({
      tick: this.state.tick,
      type: 'action:start',
      agentId: agent.id,
      data: {
        kind,
        target: targetPlaceId ?? `${tx},${ty}`,
        agentName: agent.name,
        placeKind: targetPlace?.kind,
      },
      reason,
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

    // Wage day at 18:00: treasury → employees (partial if insolvent)
    if (prev.hour === 17 && next.hour === 18) {
      this.stepWagePayments()
    }

    // Hourly: recompute stall price + append economy stats
    if (next.hour !== prev.hour) {
      this.stepMarketPrice()
      this.stepEconomyStats()
    }

    this.stepAgents()
    this.stepBushRegrowth()
    this.stepFarmGrowth()

    if (this.state.tick % SNAPSHOT_INTERVAL === 0) {
      this.snapshots.add(this.makeSnapshot())
      // Pin midnight day-starts so they survive the next day's prune
      if (toSimTime(this.state.tick).hour === 0 && toSimTime(this.state.tick).minute === 0) {
        this.snapshots.pin(this.state.tick)
      }
    }
  }

  /** World process: +1 food per bush every 240 ticks, capped at 6. */
  private stepBushRegrowth(): void {
    if (this.state.tick <= 0) return
    if (this.state.tick % BUSH_REGROW_INTERVAL !== 0) return
    for (const place of this.state.places) {
      if (place.kind !== 'berry-bush') continue
      const stock = place.inventory.food ?? 0
      if (stock >= BUSH_STOCK_MAX) continue
      this.regrowGoods(
        place.id,
        'food',
        1,
        `Berry bush ${place.id} regrew (stock ${stock + 1})`,
      )
    }
  }

  /**
   * World process: farm growth advances only while a worker is actively
   * tending a farm slot; at growth ≥ 1, mint 10 food (`goods:produced`).
   */
  private stepFarmGrowth(): void {
    for (const place of this.state.places) {
      if (place.kind !== 'farm') continue
      let tended = false
      for (const agent of this.state.agents) {
        if (agent.action.kind !== 'work') continue
        if (agent.employedAt !== place.id) continue
        if (agent.workPhase !== null && agent.workPhase !== 'tend') continue
        if (!this.isPerforming(agent)) continue
        if (!isSlotTile(this.state, place, agent.x, agent.y)) continue
        tended = true
        break
      }
      if (!tended) continue
      const g = (place.growth ?? 0) + FARM_GROWTH_PER_TICK
      if (g >= 1) {
        place.growth = 0
        this.produceGoods(
          place.id,
          'food',
          FARM_PRODUCE_AMOUNT,
          `Farm ${place.id} harvested (+${FARM_PRODUCE_AMOUNT} food)`,
        )
      } else {
        place.growth = g
      }
    }
  }

  /** Recompute stall posted price from stock each sim-hour. */
  private stepMarketPrice(): void {
    for (const place of this.state.places) {
      if (place.kind !== 'stall') continue
      const stock = place.inventory.food ?? 0
      if (!place.price) place.price = {}
      place.price.food = marketPriceFromStock(stock)
    }
  }

  /** Append hourly economy sample to world.stats (Dispatch L UI later). */
  private stepEconomyStats(): void {
    const stall = this.state.places.find((p) => p.kind === 'stall')
    const stock = stall?.inventory.food ?? 0
    const price = stall?.price?.food ?? marketPriceFromStock(stock)
    let employed = 0
    let sumW = 0
    let minW = Infinity
    let maxW = -Infinity
    for (const a of this.state.agents) {
      if (a.employedAt) employed++
      sumW += a.wallet
      if (a.wallet < minW) minW = a.wallet
      if (a.wallet > maxW) maxW = a.wallet
    }
    const n = this.state.agents.length
    const sample: EconomyStat = {
      tick: this.state.tick,
      price,
      stallStock: stock,
      treasury: this.state.treasury,
      employed,
      meanWallet: n > 0 ? sumW / n : 0,
      minWallet: n > 0 ? minW : 0,
      maxWallet: n > 0 ? maxW : 0,
    }
    this.state.stats.push(sample)
  }

  /**
   * 18:00 wage day: pay wage × min(1, workedTicks/300) from treasury.
   * Partial if treasury is short. Idle days accumulate toward job vacation.
   */
  private stepWagePayments(): void {
    for (const agent of this.state.agents) {
      if (!agent.employedAt) continue
      const place = this.state.places.find((p) => p.id === agent.employedAt)
      if (!place) {
        this.vacateJob(agent, `${agent.name}'s workplace vanished`)
        continue
      }
      const wage = place.wage ?? 0
      const due = Math.floor(wage * Math.min(1, agent.workedTicks / FULL_WAGE_TICKS))
      if (due > 0) {
        const pay = Math.min(due, this.state.treasury)
        if (pay > 0) {
          const partial = pay < due
          this.transferCoins(
            'treasury',
            agent.id,
            pay,
            partial
              ? `${agent.name} earned ${pay} coins (partial; treasury short)`
              : `${agent.name} earned ${pay} coins`,
            {
              kind: 'wage',
              workedTicks: agent.workedTicks,
              wage,
              due,
              partial,
              placeId: place.id,
            },
          )
        }
      }

      // Abandonment: 2 consecutive days with zero work frees the seat
      if (agent.workedTicks === 0) {
        agent.daysIdleOnJob++
        if (agent.daysIdleOnJob >= 2) {
          this.vacateJob(
            agent,
            `${agent.name} abandoned their ${place.kind} job after 2 idle days`,
          )
          continue
        }
      } else {
        agent.daysIdleOnJob = 0
      }
      agent.workedTicks = 0
    }
  }

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

import {
  pickGatherResource,
  pickOpenWorkplace,
  pickPlaceForAgent,
  pickShoreStand,
  pickSocialSlot,
  placeHasCapacity,
} from './spots'
import { toSimTime } from './time'

/** Mirror of sim.marketPriceFromStock — keep pure (no sim import cycle). */
function marketPriceFromStock(stock: number): number {
  const raw = Math.round(4 * Math.sqrt(8 / Math.max(stock, 1)))
  return Math.max(2, Math.min(12, raw))
}
import type {
  ActionKind,
  AgentState,
  Brain,
  Intent,
  Observation,
  Place,
  Rng,
  WorldState,
} from './types'

function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100)
}

function isNight(hour: number): boolean {
  return hour >= 21 || hour < 6
}

function isDaytime(hour: number): boolean {
  return !isNight(hour)
}

function isWorkHours(hour: number): boolean {
  return hour >= 8 && hour < 17
}

function placeById(world: WorldState, id: string): Place | undefined {
  return world.places.find((p) => p.id === id)
}

function collectWalkableNear(
  world: WorldState,
  cx: number,
  cy: number,
  radius: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const x0 = Math.round(cx)
  const y0 = Math.round(cy)
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue
      if (Math.abs(dx) + Math.abs(dy) > radius) continue
      const x = x0 + dx
      const y = y0 + dy
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue
      const t = world.tiles[y * world.width + x]!
      if (!t.walkable) continue
      out.push([x, y])
    }
  }
  return out
}

interface Scored {
  intent: Intent
  score: number
}

function sleepReason(energy: number, night: boolean): string {
  if (energy < 0.2) {
    return night
      ? 'Exhausted after a long day — going home to sleep'
      : `Running on empty (energy ${pct(energy)}%) — heading home to rest`
  }
  if (night) {
    return `Night has fallen (energy ${pct(energy)}%) — time for bed`
  }
  if (energy < 0.35) {
    return `Feeling tired (energy ${pct(energy)}%) — going home to nap`
  }
  return `Catching a short rest (energy ${pct(energy)}%)`
}

/** Night bias for sleep utility: strong at night, tiny by day (naps only near collapse). */
export function sleepNightBias(hour: number): number {
  return isNight(hour) ? 1.6 : 0.15
}

/** sleep = (1 − energy) × nightBias + exhaustion bonus when energy < 0.2 */
export function sleepScore(energy: number, hour: number): number {
  const nightBias = sleepNightBias(hour)
  return (1 - energy) * nightBias + (energy < 0.2 ? 1.0 : 0)
}

function eatReason(hunger: number): string {
  if (hunger < 0.25) {
    return `Starving (${pct(hunger)}%) — eating carried food`
  }
  return `Hungry (${pct(hunger)}%) — eating what they carry`
}

function forageReason(hunger: number, crowded: boolean): string {
  if (crowded) {
    return `Hungry (${pct(hunger)}%) — near bushes crowded, walking to farther ones`
  }
  if (hunger < 0.25) {
    return `Starving (${pct(hunger)}%) — rushing to pick berries`
  }
  return `Need food (${pct(hunger)}%) — heading to the berry bushes`
}

function buyReason(hunger: number, price: number): string {
  if (hunger < 0.25) {
    return `Starving (${pct(hunger)}%) — buying food at the stall (${price} coins)`
  }
  return `Hungry (${pct(hunger)}%) — shopping at the market (${price} coins)`
}

function workReason(place: Place): string {
  if (place.kind === 'farm') return `Working the farm — tending crops`
  if (place.kind === 'stall') return `Working the market stall`
  if (place.kind === 'forestry') return `Working the forestry camp — chopping wood`
  if (place.kind === 'quarry') return `Working the quarry — cutting stone`
  if (place.kind === 'construction-site') {
    const k = place.construction?.targetKind
    if (k && k !== 'home') return `Building a ${k}`
    return `Building a house`
  }
  return `Working at the ${place.kind}`
}

/** ≥ 2 other agents share this home (crowded shared housing). */
function homeMateCount(world: WorldState, agent: AgentState): number {
  let n = 0
  for (const a of world.agents) {
    if (a.id === agent.id) continue
    if (a.homeId === agent.homeId) n++
  }
  return n
}

function agentOwnsAnyPlace(world: WorldState, agentId: string): boolean {
  for (const owner of Object.values(world.owners)) {
    if (owner === agentId) return true
  }
  return false
}

/**
 * Wallet threshold to commission a home. Cost is 30; brain wants a small
 * buffer so the agent isn't broke after paying. Lowered to 30 if seed 42
 * never commissions (see DEVIATIONS).
 */
export const COMMISSION_WALLET_THRESHOLD = 35

function claimReason(place: Place): string {
  return `Taking a job at the ${place.kind} (${place.wage ?? 0} coins/day)`
}

function foodCount(agent: AgentState): number {
  return agent.inventory?.food ?? 0
}

/** Nearest berry-bush with stock > 0 and free slot (generic next-nearest when full). */
function pickStockedBush(
  world: WorldState,
  agent: AgentState,
): { place: Place | null; crowded: boolean } {
  const list = world.places.filter(
    (p) => p.kind === 'berry-bush' && (p.inventory?.food ?? 0) > 0,
  )
  if (list.length === 0) return { place: null, crowded: false }

  const sorted = list.slice().sort((a, b) => {
    const da = (a.x - agent.x) ** 2 + (a.y - agent.y) ** 2
    const db = (b.x - agent.x) ** 2 + (b.y - agent.y) ** 2
    if (da !== db) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const nearest = sorted[0]!
  for (const place of sorted) {
    if (placeHasCapacity(world, place, agent.id)) {
      return { place, crowded: place.id !== nearest.id }
    }
  }
  return { place: null, crowded: false }
}

function drinkReason(energy: number): string {
  return `Need a quick refresh (energy ${pct(energy)}%) — off to the well`
}

function socialReason(social: number): string {
  return `Feeling lonely (social ${pct(social)}%) — joining the plaza crowd`
}

function wanderReason(): string {
  return 'Curious about the island — wandering nearby'
}

function makeWanderIntent(
  world: WorldState,
  self: AgentState,
  rng: Rng,
  reason = wanderReason(),
): Intent {
  const spots = collectWalkableNear(world, self.x, self.y, 8)
  let tx = Math.round(self.x)
  let ty = Math.round(self.y)
  if (spots.length > 0) {
    const pick = rng.pick(spots)
    tx = pick[0]
    ty = pick[1]
  }
  return { kind: 'wander', targetX: tx, targetY: ty, reason }
}

function stallPlace(world: WorldState): Place | undefined {
  return world.places.find((p) => p.kind === 'stall')
}

function urgentNeedy(agent: AgentState): boolean {
  return (
    agent.needs.hunger < 0.2 ||
    agent.needs.energy < 0.2 ||
    agent.needs.social < 0.15
  )
}

/** Civic / discovery verbs — Luna minds only; UtilityBrain never suggests these for minded agents. */
export const STRATEGIC_ACTION_KINDS: ReadonlySet<ActionKind> = new Set([
  'commission',
  'propose',
  'vote',
  'sanction',
  'claim',
  'examine',
])

/**
 * Utility-based brain: scores sleep / eat / forage / buy / drink / socialize /
 * work / wander. Place-full → next-nearest of same kind, else wander.
 */
export class UtilityBrain implements Brain {
  /**
   * @param maintenanceOnlyIds Luna-minded agent ids. Utility may only suggest
   *   maintenance verbs for them; sheep (everyone else) keep the full set.
   */
  constructor(private readonly maintenanceOnlyIds?: ReadonlySet<string>) {}

  decide(obs: Observation, rng: Rng): Intent {
    const { self, time, world } = obs
    const hour = time.hour
    const night = isNight(hour)
    const carried = foodCount(self)

    const candidates: Scored[] = []

    // sleep → own home
    if (self.needs.energy < 0.85) {
      const home = placeById(world, self.homeId)
      const score = sleepScore(self.needs.energy, hour)
      candidates.push({
        score,
        intent: {
          kind: 'sleep',
          targetPlaceId: home?.id ?? self.homeId,
          targetX: home?.x,
          targetY: home?.y,
          reason: sleepReason(self.needs.energy, night),
        },
      })
    }

    // eat → anywhere, requires carried food
    if (carried > 0) {
      let score = (1 - self.needs.hunger) * 1.3
      if (self.needs.hunger < 0.25) score += 0.5
      candidates.push({
        score,
        intent: {
          kind: 'eat',
          targetX: Math.round(self.x),
          targetY: Math.round(self.y),
          reason: eatReason(self.needs.hunger),
        },
      })
    }

    // Hungry + no food: prefer buy over forage when wallet covers posted price
    if (carried === 0) {
      const stall = stallPlace(world)
      const stock = stall?.inventory.food ?? 0
      const price =
        stall?.price?.food ?? marketPriceFromStock(stock)
      const canBuy =
        !!stall &&
        stock > 0 &&
        self.wallet >= price &&
        placeHasCapacity(world, stall, self.id)

      if (canBuy && stall) {
        // Slightly above forage so the market is the default when solvent
        let score = (1 - self.needs.hunger) * 1.28
        if (self.needs.hunger < 0.25) score += 0.5
        candidates.push({
          score,
          intent: {
            kind: 'buy',
            targetPlaceId: stall.id,
            targetX: stall.x,
            targetY: stall.y,
            reason: buyReason(self.needs.hunger, price),
          },
        })
      }

      const { place: bush, crowded } = pickStockedBush(world, self)
      if (bush) {
        let score = (1 - self.needs.hunger) * 1.2
        if (self.needs.hunger < 0.25) score += 0.5
        candidates.push({
          score,
          intent: {
            kind: 'forage',
            targetPlaceId: bush.id,
            targetX: bush.x,
            targetY: bush.y,
            reason: forageReason(self.needs.hunger, crowded),
          },
        })
      }
    }

    // drink → nearest well with free capacity (daytime only); else shoreline
    if (isDaytime(hour)) {
      const { place: well } = pickPlaceForAgent(world, self, 'well')
      if (well) {
        const score = (1 - self.needs.energy) * 0.35
        candidates.push({
          score,
          intent: {
            kind: 'drink',
            targetPlaceId: well.id,
            targetX: well.x,
            targetY: well.y,
            reason: drinkReason(self.needs.energy),
          },
        })
      } else {
        const shore = pickShoreStand(world, self)
        if (shore) {
          const score = (1 - self.needs.energy) * 0.28
          candidates.push({
            score,
            intent: {
              kind: 'drink',
              targetX: shore.x,
              targetY: shore.y,
              reason: `Need a drink (energy ${pct(self.needs.energy)}%) — heading to the shore`,
            },
          })
        }
      }
    }

    // gather → raw terrain when no workplace produces that good
    if (!self.collapsed) {
      const hasForestry = world.places.some((p) => p.kind === 'forestry')
      const hasQuarry = world.places.some((p) => p.kind === 'quarry')
      if (!hasForestry || !hasQuarry) {
        const want: 'forest' | 'rock' | undefined = hasForestry
          ? 'rock'
          : hasQuarry
            ? 'forest'
            : undefined
        const tile = pickGatherResource(world, self, want)
        if (tile) {
          const terrain = world.tiles[tile.y * world.width + tile.x]
          const good = terrain?.kind === 'rock' ? 'stone' : 'wood'
          const carry = self.inventory[good] ?? 0
          if (carry < 3) {
            candidates.push({
              score: 0.16,
              intent: {
                kind: 'gather',
                targetX: tile.x,
                targetY: tile.y,
                reason: `Gathering ${good} from the ${terrain?.kind ?? 'ground'}`,
              },
            })
          }
        }
      }
    }

    // socialize → free plaza slot near other socializers (else nearest-to-center)
    {
      const { place: plaza } = pickPlaceForAgent(world, self, 'plaza')
      if (plaza) {
        const slot = pickSocialSlot(world, self, plaza, rng)
        if (slot) {
          let score = (1 - self.needs.social) * 0.9
          if (hour >= 10 && hour < 20) score *= 1.3
          candidates.push({
            score,
            intent: {
              kind: 'socialize',
              targetPlaceId: plaza.id,
              targetX: slot.x,
              targetY: slot.y,
              reason: socialReason(self.needs.social),
            },
          })
        }
      }
    }

    // Crowded shared home + solvent → commission a private house (instant world rule)
    if (
      !self.collapsed &&
      self.wallet >= COMMISSION_WALLET_THRESHOLD &&
      homeMateCount(world, self) >= 2 &&
      !agentOwnsAnyPlace(world, self.id)
    ) {
      candidates.push({
        score: 0.72,
        intent: {
          kind: 'commission',
          reason: `Crowded at home with ${homeMateCount(world, self)} others — commissioning a house (${self.wallet} coins)`,
        },
      })
    }

    // Unemployed + daytime → claim nearest workplace with a free job seat
    // (work intent; hire is a world rule on startAction)
    if (!self.employedAt && isDaytime(hour) && !self.collapsed) {
      const job = pickOpenWorkplace(world, self)
      if (job && placeHasCapacity(world, job, self.id)) {
        candidates.push({
          score: 0.55,
          intent: {
            kind: 'work',
            targetPlaceId: job.id,
            targetX: job.x,
            targetY: job.y,
            reason: claimReason(job),
          },
        })
      }
    }

    // Employed + work hours + not urgent-needy → work (score ~0.65)
    // Slightly above baseline social when social is OK so farms actually get tended.
    if (
      self.employedAt &&
      isWorkHours(hour) &&
      !urgentNeedy(self) &&
      !self.collapsed
    ) {
      const workplace = placeById(world, self.employedAt)
      if (workplace && placeHasCapacity(world, workplace, self.id)) {
        candidates.push({
          score: 0.65,
          intent: {
            kind: 'work',
            targetPlaceId: workplace.id,
            targetX: workplace.x,
            targetY: workplace.y,
            reason: workReason(workplace),
          },
        })
      }
    }

    // wander baseline
    candidates.push({
      score: 0.15,
      intent: makeWanderIntent(world, self, rng),
    })

    const pool = this.maintenanceOnlyIds?.has(self.id)
      ? candidates.filter((c) => !STRATEGIC_ACTION_KINDS.has(c.intent.kind))
      : candidates

    let best = pool[0]!
    for (let i = 1; i < pool.length; i++) {
      const c = pool[i]!
      if (c.score > best.score) best = c
    }
    return best.intent
  }
}

/** Score the currently-held action kind for hysteresis comparisons. */
export function scoreCurrentAction(obs: Observation, kind: ActionKind): number {
  const { self, time, world } = obs
  const hour = time.hour
  const carried = foodCount(self)

  switch (kind) {
    case 'sleep':
      if (self.needs.energy >= 0.85) return 0
      return sleepScore(self.needs.energy, hour)
    case 'eat': {
      if (carried <= 0) return 0
      let s = (1 - self.needs.hunger) * 1.3
      if (self.needs.hunger < 0.25) s += 0.5
      return s
    }
    case 'forage': {
      if (carried > 0) return 0
      let s = (1 - self.needs.hunger) * 1.2
      if (self.needs.hunger < 0.25) s += 0.5
      return s
    }
    case 'buy': {
      if (carried > 0) return 0
      const stall = stallPlace(world)
      const stock = stall?.inventory.food ?? 0
      const price = stall?.price?.food ?? marketPriceFromStock(stock)
      if (!stall || stock <= 0 || self.wallet < price) return 0
      let s = (1 - self.needs.hunger) * 1.28
      if (self.needs.hunger < 0.25) s += 0.5
      return s
    }
    case 'work': {
      if (!self.employedAt) return 0.55 // claiming
      if (!isWorkHours(hour) || urgentNeedy(self) || self.collapsed) return 0
      return 0.65
    }
    case 'commission': {
      if (self.collapsed) return 0
      if (self.wallet < COMMISSION_WALLET_THRESHOLD) return 0
      if (homeMateCount(world, self) < 2) return 0
      if (agentOwnsAnyPlace(world, self.id)) return 0
      return 0.72
    }
    case 'gather': {
      const wood = self.inventory?.wood ?? 0
      const stone = self.inventory?.stone ?? 0
      if (wood >= 3 && stone >= 3) return 0
      return 0.16
    }
    case 'drink':
      if (!isDaytime(hour)) return -1
      return (1 - self.needs.energy) * 0.35
    case 'socialize': {
      let s = (1 - self.needs.social) * 0.9
      if (hour >= 10 && hour < 20) s *= 1.3
      return s
    }
    case 'wander':
      return 0.15
    case 'walk':
    case 'idle':
    default:
      return 0
  }
}

/**
 * Stay asleep until fully rested. Morning wake is handled in the sim at the
 * 07:00 boundary crossing — not "any daytime hour ≥ 7".
 */
export function shouldKeepSleeping(agent: AgentState, _hour?: number): boolean {
  if (agent.action.kind !== 'sleep') return false
  if (agent.needs.energy >= 0.95) return false
  return true
}

export function anyNeedCritical(agent: AgentState): boolean {
  return agent.needs.hunger < 0.15 || agent.needs.energy < 0.15 || agent.needs.social < 0.15
}

/**
 * Urgent interrupt for mid-action redecide: a *different* need is critical
 * (not the need the current action is already serving).
 */
export function urgentDifferentNeed(agent: AgentState): boolean {
  const { hunger, energy, social } = agent.needs
  const kind = agent.action.kind
  const carried = foodCount(agent)
  switch (kind) {
    case 'sleep':
      // Hunger only interrupts sleep when food is already carried (eat works
      // anywhere, including bed). Waking to forage is decided on the normal
      // interval / natural wake — avoids sleep↔forage thrash under scarcity.
      return (hunger < 0.15 && carried > 0) || social < 0.15
    case 'drink':
      return hunger < 0.15 || social < 0.15
    case 'eat':
    case 'forage':
    case 'gather':
    case 'buy':
      return energy < 0.15 || social < 0.15
    case 'work':
      // Hauling is non-interruptible (handled in sim); otherwise real needs preempt
      if (agent.workPhase === 'hauling' || agent.workPhase === 'returning') {
        return false
      }
      return hunger < 0.15 || energy < 0.15 || social < 0.15
    case 'socialize':
      return hunger < 0.15 || energy < 0.15
    default:
      return anyNeedCritical(agent)
  }
}

export function makeObservation(agent: AgentState, world: WorldState): Observation {
  return {
    self: agent,
    time: toSimTime(world.tick),
    world,
  }
}

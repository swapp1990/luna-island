import { pickPlaceForAgent, pickSocialSlot, placeHasCapacity } from './spots'
import { toSimTime } from './time'
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

/**
 * Utility-based brain: scores sleep / eat / forage / drink / socialize / wander,
 * returns the max-scoring intent with product-copy reason strings.
 * Place-full → next-nearest of same kind, else wander (no waiting).
 */
export class UtilityBrain implements Brain {
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

    // forage → nearest stocked bush with free slot; only when carrying 0 food
    if (carried === 0) {
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

    // drink → nearest well with free capacity (daytime only)
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

    // wander baseline
    candidates.push({
      score: 0.15,
      intent: makeWanderIntent(world, self, rng),
    })

    let best = candidates[0]!
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i]!
      if (c.score > best.score) best = c
    }
    return best.intent
  }
}

/** Score the currently-held action kind for hysteresis comparisons. */
export function scoreCurrentAction(obs: Observation, kind: ActionKind): number {
  const { self, time } = obs
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
      return energy < 0.15 || social < 0.15
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

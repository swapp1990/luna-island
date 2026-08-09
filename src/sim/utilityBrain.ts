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

function placesOf(world: WorldState, kind: Place['kind']): Place[] {
  return world.places.filter((p) => p.kind === kind)
}

function nearestPlace(agent: AgentState, places: Place[]): Place | null {
  if (places.length === 0) return null
  let best: Place | null = null
  let bestD = Infinity
  for (const p of places) {
    const d = (p.x - agent.x) * (p.x - agent.x) + (p.y - agent.y) * (p.y - agent.y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
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
  if (energy < 0.25) {
    return night
      ? 'Exhausted after a long day — going home to sleep'
      : `Running on empty (energy ${pct(energy)}%) — heading home to rest`
  }
  if (night) {
    return `Night has fallen (energy ${pct(energy)}%) — time for bed`
  }
  return `Feeling tired (energy ${pct(energy)}%) — going home to nap`
}

function eatReason(hunger: number): string {
  if (hunger < 0.25) {
    return `Starving (${pct(hunger)}%) — rushing to the berry bushes`
  }
  return `Hungry (${pct(hunger)}%) — heading to the berry bushes`
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

/**
 * Utility-based brain: scores sleep / eat / drink / socialize / wander,
 * returns the max-scoring intent with product-copy reason strings.
 */
export class UtilityBrain implements Brain {
  decide(obs: Observation, rng: Rng): Intent {
    const { self, time, world } = obs
    const hour = time.hour
    const night = isNight(hour)
    const nightBias = night ? 1.6 : 0.4

    const candidates: Scored[] = []

    // sleep → own home
    {
      const home = placeById(world, self.homeId)
      const score = (1 - self.needs.energy) * nightBias
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

    // eat → nearest berry-bush
    {
      const bush = nearestPlace(self, placesOf(world, 'berry-bush'))
      let score = (1 - self.needs.hunger) * 1.3
      if (self.needs.hunger < 0.25) score += 0.5
      candidates.push({
        score,
        intent: {
          kind: 'eat',
          targetPlaceId: bush?.id,
          targetX: bush?.x,
          targetY: bush?.y,
          reason: eatReason(self.needs.hunger),
        },
      })
    }

    // drink → well (daytime only)
    if (isDaytime(hour)) {
      const well = placesOf(world, 'well')[0] ?? null
      const score = (1 - self.needs.energy) * 0.35
      candidates.push({
        score,
        intent: {
          kind: 'drink',
          targetPlaceId: well?.id,
          targetX: well?.x,
          targetY: well?.y,
          reason: drinkReason(self.needs.energy),
        },
      })
    }

    // socialize → plaza
    {
      const plaza = placesOf(world, 'plaza')[0] ?? null
      let score = (1 - self.needs.social) * 0.9
      if (hour >= 10 && hour < 20) score *= 1.3
      candidates.push({
        score,
        intent: {
          kind: 'socialize',
          targetPlaceId: plaza?.id,
          targetX: plaza?.x,
          targetY: plaza?.y,
          reason: socialReason(self.needs.social),
        },
      })
    }

    // wander → random walkable within 8 tiles
    {
      const spots = collectWalkableNear(world, self.x, self.y, 8)
      let tx = Math.round(self.x)
      let ty = Math.round(self.y)
      if (spots.length > 0) {
        const pick = rng.pick(spots)
        tx = pick[0]
        ty = pick[1]
      }
      candidates.push({
        score: 0.15,
        intent: {
          kind: 'wander',
          targetX: tx,
          targetY: ty,
          reason: wanderReason(),
        },
      })
    }

    // Pick max score (stable tie-break: first in list)
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
  const night = isNight(hour)
  const nightBias = night ? 1.6 : 0.4

  switch (kind) {
    case 'sleep':
      return (1 - self.needs.energy) * nightBias
    case 'eat': {
      let s = (1 - self.needs.hunger) * 1.3
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

export function shouldKeepSleeping(agent: AgentState, hour: number): boolean {
  if (agent.action.kind !== 'sleep') return false
  if (agent.needs.energy >= 0.95) return false
  if (hour >= 7 && hour < 21) return false
  return true
}

export function anyNeedCritical(agent: AgentState): boolean {
  return agent.needs.hunger < 0.15 || agent.needs.energy < 0.15 || agent.needs.social < 0.15
}

export function makeObservation(agent: AgentState, world: WorldState): Observation {
  return {
    self: agent,
    time: toSimTime(world.tick),
    world,
  }
}

import { isWalkable } from './pathfind'
import { isLunaAgent } from './lunaRoster'
import type {
  AgentState,
  FirstStormScenarioState,
  Place,
  WorldState,
} from './types'

export const FIRST_STORM_RESIDENTS = 7
export const FIRST_STORM_HOME_SLOTS = 4
export const FIRST_STORM_FOOD_PER_RESIDENT = 2
export const FIRST_STORM_FOOD_TARGET =
  FIRST_STORM_RESIDENTS * FIRST_STORM_FOOD_PER_RESIDENT

/** Day 3 at 18:00, counting from Day 1 at 06:00. */
export const FIRST_STORM_START_TICK = 3_600
/** Twelve hours later: Day 4 at 06:00. */
export const FIRST_STORM_END_TICK = 4_320

export interface FirstStormObjective {
  id: 'housing' | 'food' | 'water'
  label: string
  current: number
  target: number
  met: boolean
}

function nearestPlace(
  places: readonly Place[],
  kind: Place['kind'],
  x: number,
  y: number,
): Place | undefined {
  return places
    .filter((p) => p.kind === kind)
    .slice()
    .sort((a, b) => {
      const ad = (a.x - x) ** 2 + (a.y - y) ** 2
      const bd = (b.x - x) ** 2 + (b.y - y) ** 2
      return ad - bd || a.id.localeCompare(b.id)
    })[0]
}

function arrivalSpots(world: WorldState, count: number): Array<[number, number]> {
  const plaza = world.places.find((p) => p.kind === 'plaza')
  if (!plaza) return []
  const blocked = new Set(
    world.places
      .filter((p) => p.kind !== 'plaza' && p.kind !== 'berry-bush' && p.kind !== 'spring')
      .map((p) => `${p.x},${p.y}`),
  )
  const spots: Array<[number, number]> = []
  for (let radius = 1; radius <= 18 && spots.length < count; radius++) {
    for (let dy = -radius; dy <= radius && spots.length < count; dy++) {
      for (let dx = -radius; dx <= radius && spots.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const x = plaza.x + dx
        const y = plaza.y + dy
        const tile = world.tiles[y * world.width + x]
        if (!tile || tile.kind !== 'grass' || !isWalkable(world, x, y)) continue
        if (blocked.has(`${x},${y}`)) continue
        spots.push([x, y])
      }
    }
  }
  return spots
}

function resetSettler(agent: AgentState, x: number, y: number, homeId: string): void {
  agent.x = x
  agent.y = y
  agent.homeId = homeId
  agent.needs = { hunger: 0.86, energy: 0.86, social: 0.86 }
  agent.action = { kind: 'idle', reason: 'Arrived with the first settlers' }
  agent.actionTicks = 0
  agent.lastDecideTick = -30
  agent.pathIndex = 0
  agent.criticalFired = { hunger: false, energy: false, social: false }
  agent.actionStartNeeds = { ...agent.needs }
  agent.inventory = { food: 0, wood: 0, stone: 0 }
  agent.wallet = 20
  agent.collapsed = false
  agent.employedAt = null
  agent.workedTicks = 0
  agent.daysIdleOnJob = 0
  agent.workPhase = null
  agent.haulAmount = 0
  agent.haulGood = null
  agent.haulSourceId = null
  agent.haulDropoffId = null
  agent.sympathy = {}
}

/**
 * Replace the developed sandbox opening with the authored seven-settler start.
 * This runs only for a new scenario world, before its tick-0 snapshot.
 */
export function initializeFirstStorm(world: WorldState): void {
  const plaza = world.places.find((p) => p.kind === 'plaza')
  if (!plaza) throw new Error('first-storm scenario requires a plaza')

  const retained = new Set<string>([plaza.id])
  for (const kind of ['home', 'stall', 'farm', 'forestry', 'quarry', 'storehouse'] as const) {
    const place = nearestPlace(world.places, kind, plaza.x, plaza.y)
    if (place) retained.add(place.id)
  }
  for (const place of world.places) {
    if (place.kind === 'berry-bush' || place.kind === 'spring') retained.add(place.id)
  }
  world.places = world.places.filter((p) => retained.has(p.id))

  const home = world.places.find((p) => p.kind === 'home')
  const stall = world.places.find((p) => p.kind === 'stall')
  const farm = world.places.find((p) => p.kind === 'farm')
  const store = world.places.find((p) => p.kind === 'storehouse')
  if (!home || !stall || !farm || !store) {
    throw new Error('first-storm scenario requires a home, stall, farm, and storehouse')
  }
  home.slots = FIRST_STORM_HOME_SLOTS
  stall.inventory.food = 18
  stall.price = { food: 4 }
  farm.inventory.food = 0
  farm.growth = 0.95
  if (farm.production) farm.production.cycleWorkedTicks = 480
  // A sealed emergency cache: market food covers daily meals while these
  // fourteen units remain the two-day storm reserve the player must protect.
  store.inventory.food = 14
  store.inventory.wood = 18
  store.inventory.stone = 24
  for (const place of world.places) {
    if (place.kind === 'forestry' || place.kind === 'quarry') {
      place.inventory.wood = 0
      place.inventory.stone = 0
      place.growth = 0
    }
  }

  const settlers = world.agents
    .filter((agent) => !isLunaAgent(agent.id))
    .slice(0, FIRST_STORM_RESIDENTS)
  if (settlers.length !== FIRST_STORM_RESIDENTS) {
    throw new Error(`first-storm scenario requires ${FIRST_STORM_RESIDENTS} non-mind settlers`)
  }
  world.agents = settlers
  const spots = arrivalSpots(world, settlers.length)
  for (let i = 0; i < settlers.length; i++) {
    const spot = spots[i] ?? [plaza.x, plaza.y]
    resetSettler(settlers[i]!, spot[0], spot[1], i < home.slots ? home.id : '')
  }

  world.owners = Object.fromEntries(world.places.map((p) => [p.id, 'commons']))
  world.treasury = 100
  world.stats = []
  world.sympathyStreak = {}
  world.sympathyMet = {}
  world.externalIntentLog = []
  world.playerCommandLog = []
  world.mindNoteLog = []
  world.sayLog = []
  world.mindStats = {}
  world.proposals = []
  world.rules = []
  world.gatherings = []
  // The authored opening must remain self-sufficient before the player learns
  // the priority panel: keep food, building, and both raw-material crews on an
  // equal baseline so proximity can staff the quarry as well as the forest.
  world.workPriorities = { food: 2, build: 2, wood: 2, stone: 2 }
  world.townGrowth = {
    unlockedMilestoneIds: ['camp'],
    resolvedInvitationTiers: [],
    acceptedAgentIds: [],
  }
  world.commissionCooldownUntil = {}
  world.commissionLastRefusal = {}
  world.placeBlockLast = {}
  world.placeBlockedToday = {}
  world.scenario = {
    kind: 'first-storm',
    status: 'preparing',
    stormStartTick: FIRST_STORM_START_TICK,
    stormEndTick: FIRST_STORM_END_TICK,
    preparedObjectiveIds: [],
    departedAgentIds: [],
  }
}

export function secureFood(world: WorldState): number {
  let food = 0
  for (const place of world.places) {
    if (place.kind === 'stall' || place.kind === 'farm' || place.kind === 'storehouse') {
      food += place.inventory.food ?? 0
    }
  }
  return Math.max(0, Math.floor(food))
}

export function firstStormObjectives(world: WorldState): FirstStormObjective[] {
  const residents = world.scenario?.kind === 'first-storm'
    ? FIRST_STORM_RESIDENTS
    : world.agents.length
  const housing = world.places
    .filter((p) => p.kind === 'home')
    .reduce((sum, p) => sum + Math.max(0, p.slots), 0)
  const food = secureFood(world)
  const water = world.places.some((p) => p.kind === 'well') ? 1 : 0
  const locked = world.scenario?.kind === 'first-storm' && world.scenario.status !== 'preparing'
  const prepared = new Set(world.scenario?.preparedObjectiveIds ?? [])
  const met = (id: FirstStormObjective['id'], live: boolean) => locked ? prepared.has(id) : live
  return [
    { id: 'housing', label: 'Beds for every settler', current: locked && prepared.has('housing') ? residents : housing, target: residents, met: met('housing', housing >= residents) },
    { id: 'food', label: 'Food secured before landfall', current: locked && prepared.has('food') ? residents * FIRST_STORM_FOOD_PER_RESIDENT : food, target: residents * FIRST_STORM_FOOD_PER_RESIDENT, met: met('food', food >= residents * FIRST_STORM_FOOD_PER_RESIDENT) },
    { id: 'water', label: 'A sheltered freshwater well', current: water, target: 1, met: met('water', water >= 1) },
  ]
}

export function isFirstStormWeather(world: WorldState): boolean {
  const scenario = world.scenario
  return !!scenario &&
    scenario.kind === 'first-storm' &&
    scenario.status !== 'survived' &&
    scenario.status !== 'failed' &&
    world.tick >= scenario.stormStartTick &&
    world.tick < scenario.stormEndTick
}

/** Assign homeless settlers to completed homes in stable id order. */
export function settleFirstStormHousing(world: WorldState): void {
  if (world.scenario?.kind !== 'first-storm') return
  const homes = world.places
    .filter((p) => p.kind === 'home')
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
  const validHomes = new Set(homes.map((h) => h.id))
  const occupancy = new Map<string, number>()
  for (const agent of world.agents) {
    if (!validHomes.has(agent.homeId)) agent.homeId = ''
    if (agent.homeId) occupancy.set(agent.homeId, (occupancy.get(agent.homeId) ?? 0) + 1)
  }
  for (const agent of world.agents.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    if (agent.homeId) continue
    const home = homes.find((h) => (occupancy.get(h.id) ?? 0) < h.slots)
    if (!home) break
    agent.homeId = home.id
    occupancy.set(home.id, (occupancy.get(home.id) ?? 0) + 1)
  }
}

export function cloneFirstStormScenario(
  scenario: FirstStormScenarioState | undefined,
): FirstStormScenarioState | undefined {
  if (!scenario) return undefined
  return {
    ...scenario,
    preparedObjectiveIds: [...(scenario.preparedObjectiveIds ?? [])],
    departedAgentIds: [...(scenario.departedAgentIds ?? [])],
  }
}

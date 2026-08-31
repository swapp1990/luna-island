export type CellKind = 'water' | 'open' | 'forest' | 'food' | 'stone' | 'fiber'
export type ResourceKind = 'food' | 'wood' | 'stone' | 'fiber'
export type BuildingKind = 'hearth' | 'leanTo' | 'foodCache' | 'toolRack'

export type Stocks = Record<ResourceKind, number>

export interface MapCell {
  kind: CellKind
  remaining?: number
  building?: BuildingKind
  project?: BuildingKind
}

export interface GameEvent {
  message: string
  tone: 'neutral' | 'good' | 'warning'
}

export interface AgeZeroState {
  day: number
  dayProgress: number
  speed: 0 | 1 | 2 | 4
  population: number
  stocks: Stocks
  cells: MapCell[]
  assignments: Record<number, number>
  builderWorkers: number
  projectProgress: number
  growthProgress: number
  stableDays: number
  starving: boolean
  hungerDays: number
  ageOne: boolean
  event: GameEvent
}

export interface BuildingDefinition {
  label: string
  shortLabel: string
  purpose: string
  cost: Partial<Stocks>
  work: number
}

export const GRID_SIZE = 9
export const BASE_SHELTER = 6
export const BASE_FOOD_CAPACITY = 30
export const DAY_SECONDS = 7
export const AGE_ONE_POPULATION = 12
export const AGE_ONE_STABLE_DAYS = 5
export const GROWTH_DAYS = 2

export const BUILDINGS: Record<BuildingKind, BuildingDefinition> = {
  hearth: {
    label: 'Hearth',
    shortLabel: 'H',
    purpose: 'Settlement center and water access',
    cost: { wood: 6, stone: 4 },
    work: 3,
  },
  leanTo: {
    label: 'Lean-to',
    shortLabel: 'L',
    purpose: '+3 shelter',
    cost: { wood: 8, fiber: 5 },
    work: 5,
  },
  foodCache: {
    label: 'Food cache',
    shortLabel: 'C',
    purpose: '+30 food storage',
    cost: { wood: 7, fiber: 3 },
    work: 4,
  },
  toolRack: {
    label: 'Tool rack',
    shortLabel: 'T',
    purpose: '+25% gathering',
    cost: { wood: 8, stone: 5 },
    work: 4,
  },
}

export const CELL_LABEL: Record<CellKind, string> = {
  water: 'Water',
  open: 'Open ground',
  forest: 'Forest',
  food: 'Berry patch',
  stone: 'Stone deposit',
  fiber: 'Fiber patch',
}

const MAP_ROWS: CellKind[][] = [
  ['forest', 'forest', 'open', 'open', 'food', 'open', 'forest', 'forest', 'stone'],
  ['forest', 'open', 'open', 'water', 'water', 'open', 'food', 'forest', 'stone'],
  ['open', 'fiber', 'open', 'water', 'open', 'open', 'open', 'forest', 'open'],
  ['open', 'open', 'open', 'water', 'open', 'forest', 'open', 'open', 'open'],
  ['forest', 'open', 'food', 'water', 'open', 'open', 'fiber', 'open', 'stone'],
  ['forest', 'open', 'open', 'water', 'water', 'open', 'open', 'forest', 'stone'],
  ['open', 'food', 'open', 'open', 'open', 'open', 'forest', 'forest', 'open'],
  ['fiber', 'open', 'forest', 'forest', 'open', 'food', 'open', 'open', 'open'],
  ['open', 'open', 'forest', 'stone', 'open', 'open', 'fiber', 'forest', 'open'],
]

const RESOURCE_FOR_CELL: Partial<Record<CellKind, ResourceKind>> = {
  food: 'food',
  forest: 'wood',
  stone: 'stone',
  fiber: 'fiber',
}

const YIELD_PER_WORKER: Record<ResourceKind, number> = {
  food: 2.4,
  wood: 2.2,
  stone: 1.5,
  fiber: 2,
}

const STARTING_REMAINING: Partial<Record<CellKind, number>> = {
  food: 70,
  forest: 90,
  stone: 75,
  fiber: 70,
}

const round = (value: number) => Math.round(value * 100) / 100
const countBuilding = (state: AgeZeroState, kind: BuildingKind) =>
  state.cells.filter((cell) => cell.building === kind).length

export function createAgeZeroState(): AgeZeroState {
  return {
    day: 1,
    dayProgress: 0,
    speed: 0,
    population: 6,
    stocks: { food: 20, wood: 14, stone: 8, fiber: 8 },
    cells: MAP_ROWS.flat().map((kind) => ({
      kind,
      ...(STARTING_REMAINING[kind] ? { remaining: STARTING_REMAINING[kind] } : {}),
    })),
    assignments: {},
    builderWorkers: 0,
    projectProgress: 0,
    growthProgress: 0,
    stableDays: 0,
    starving: false,
    hungerDays: 0,
    ageOne: false,
    event: { message: 'Time is paused. Place the Hearth beside water, then choose 1× when ready.', tone: 'neutral' },
  }
}

export function getHearthIndex(state: AgeZeroState) {
  return state.cells.findIndex((cell) => cell.building === 'hearth')
}

export function getProjectIndex(state: AgeZeroState) {
  return state.cells.findIndex((cell) => cell.project)
}

export function totalAssigned(state: AgeZeroState) {
  return state.builderWorkers + Object.values(state.assignments).reduce((sum, workers) => sum + workers, 0)
}

export function availableWorkers(state: AgeZeroState) {
  return Math.max(0, state.population - totalAssigned(state))
}

export function shelterCapacity(state: AgeZeroState) {
  return BASE_SHELTER + countBuilding(state, 'leanTo') * 3
}

export function foodCapacity(state: AgeZeroState) {
  return BASE_FOOD_CAPACITY + countBuilding(state, 'foodCache') * 30
}

export function foodNeededPerDay(state: AgeZeroState) {
  return state.population * 0.9
}

export function foodReserveDays(state: AgeZeroState) {
  const needed = foodNeededPerDay(state)
  return needed > 0 ? state.stocks.food / needed : 0
}

export function hasWaterAccess(state: AgeZeroState) {
  const hearth = getHearthIndex(state)
  if (hearth < 0) return false
  const row = Math.floor(hearth / GRID_SIZE)
  const column = hearth % GRID_SIZE
  return state.cells.some((cell, index) => {
    if (cell.kind !== 'water') return false
    const otherRow = Math.floor(index / GRID_SIZE)
    const otherColumn = index % GRID_SIZE
    return Math.abs(row - otherRow) + Math.abs(column - otherColumn) === 1
  })
}

export function distanceEfficiency(state: AgeZeroState, index: number) {
  const hearth = getHearthIndex(state)
  if (hearth < 0) return 0
  const distance =
    Math.abs(Math.floor(hearth / GRID_SIZE) - Math.floor(index / GRID_SIZE)) +
    Math.abs((hearth % GRID_SIZE) - (index % GRID_SIZE))
  return Math.max(0.55, 1 - Math.max(0, distance - 2) * 0.06)
}

export function resourceForCell(cell: MapCell) {
  return RESOURCE_FOR_CELL[cell.kind]
}

export function gatheringYield(state: AgeZeroState, index: number) {
  const resource = resourceForCell(state.cells[index])
  if (!resource) return 0
  const toolMultiplier = 1 + countBuilding(state, 'toolRack') * 0.25
  return round(YIELD_PER_WORKER[resource] * distanceEfficiency(state, index) * toolMultiplier)
}

export function canPlaceBuilding(state: AgeZeroState, kind: BuildingKind, index: number) {
  const cell = state.cells[index]
  if (!cell || cell.kind !== 'open' || cell.building || cell.project || getProjectIndex(state) >= 0) return false
  if (kind === 'hearth') {
    if (state.cells.some((candidate) => candidate.building === 'hearth' || candidate.project === 'hearth')) return false
    const row = Math.floor(index / GRID_SIZE)
    const column = index % GRID_SIZE
    return state.cells.some((candidate, candidateIndex) => {
      if (candidate.kind !== 'water') return false
      const candidateRow = Math.floor(candidateIndex / GRID_SIZE)
      const candidateColumn = candidateIndex % GRID_SIZE
      return Math.abs(row - candidateRow) + Math.abs(column - candidateColumn) === 1
    })
  }
  return getHearthIndex(state) >= 0
}

export function canAfford(state: AgeZeroState, kind: BuildingKind) {
  return Object.entries(BUILDINGS[kind].cost).every(
    ([resource, cost]) => state.stocks[resource as ResourceKind] >= (cost ?? 0),
  )
}

export function placeBuilding(state: AgeZeroState, kind: BuildingKind, index: number): AgeZeroState {
  if (!canPlaceBuilding(state, kind, index)) {
    return { ...state, event: { message: kind === 'hearth' ? 'The hearth needs open ground directly beside water.' : 'Choose empty open ground.', tone: 'warning' } }
  }
  if (!canAfford(state, kind)) {
    return { ...state, event: { message: `Not enough materials for ${BUILDINGS[kind].label.toLowerCase()}.`, tone: 'warning' } }
  }
  const stocks = { ...state.stocks }
  Object.entries(BUILDINGS[kind].cost).forEach(([resource, cost]) => {
    stocks[resource as ResourceKind] = round(stocks[resource as ResourceKind] - (cost ?? 0))
  })
  const cells = state.cells.map((cell, cellIndex) => cellIndex === index ? { ...cell, project: kind } : cell)
  return {
    ...state,
    stocks,
    cells,
    projectProgress: 0,
    event: { message: `${BUILDINGS[kind].label} marked out. Assign builders to finish it.`, tone: 'good' },
  }
}

export function setResourceWorkers(state: AgeZeroState, index: number, requested: number): AgeZeroState {
  const cell = state.cells[index]
  if (!cell || getHearthIndex(state) < 0 || !resourceForCell(cell) || (cell.remaining ?? 0) <= 0) return state
  const current = state.assignments[index] ?? 0
  const next = Math.max(0, Math.min(4, Math.floor(requested), current + availableWorkers(state)))
  const assignments = { ...state.assignments }
  if (next === 0) delete assignments[index]
  else assignments[index] = next
  return { ...state, assignments }
}

export function setBuilderWorkers(state: AgeZeroState, requested: number): AgeZeroState {
  if (getProjectIndex(state) < 0) return { ...state, builderWorkers: 0 }
  const next = Math.max(0, Math.min(6, Math.floor(requested), state.builderWorkers + availableWorkers(state)))
  return { ...state, builderWorkers: next }
}

export function setSpeed(state: AgeZeroState, speed: AgeZeroState['speed']): AgeZeroState {
  return { ...state, speed }
}

export function growthConditions(state: AgeZeroState) {
  const conditions = {
    hearth: getHearthIndex(state) >= 0 && hasWaterAccess(state),
    sheltered: shelterCapacity(state) >= state.population,
    spareShelter: shelterCapacity(state) > state.population,
    food: foodReserveDays(state) >= 2,
    fed: !state.starving,
  }
  return { conditions, ready: Object.values(conditions).every(Boolean) }
}

function completeProject(state: AgeZeroState) {
  const projectIndex = getProjectIndex(state)
  if (projectIndex < 0) return state
  const kind = state.cells[projectIndex].project
  if (!kind || state.projectProgress < BUILDINGS[kind].work) return state
  const cells = state.cells.map((cell, index) => index === projectIndex
    ? { ...cell, project: undefined, building: kind }
    : cell)
  return {
    ...state,
    cells,
    builderWorkers: 0,
    projectProgress: 0,
    event: { message: `${BUILDINGS[kind].label} completed. The crew is available again.`, tone: 'good' as const },
  }
}

export function advanceDay(input: AgeZeroState): AgeZeroState {
  if (input.ageOne) return input
  let state: AgeZeroState = {
    ...input,
    day: input.day + 1,
    stocks: { ...input.stocks },
    cells: input.cells.map((cell) => ({ ...cell })),
    assignments: { ...input.assignments },
    event: { message: 'A steady day at the settlement.', tone: 'neutral' },
  }

  const projectIndex = getProjectIndex(state)
  if (projectIndex >= 0 && state.builderWorkers > 0) {
    state.projectProgress = round(state.projectProgress + state.builderWorkers)
    state = completeProject(state)
  }

  for (const [rawIndex, workers] of Object.entries(state.assignments)) {
    const index = Number(rawIndex)
    const cell = state.cells[index]
    const resource = resourceForCell(cell)
    if (!resource || !cell.remaining || workers <= 0) continue
    const gathered = Math.min(cell.remaining, gatheringYield(state, index) * workers)
    cell.remaining = round(cell.remaining - gathered)
    state.stocks[resource] = round(state.stocks[resource] + gathered)
    if (resource === 'food') state.stocks.food = Math.min(foodCapacity(state), state.stocks.food)
    if (cell.remaining <= 0) {
      cell.kind = 'open'
      cell.remaining = undefined
      delete state.assignments[index]
      state.event = { message: 'A resource patch was exhausted. Its workers are available again.', tone: 'warning' }
    }
  }

  const foodNeeded = foodNeededPerDay(state)
  const shortage = Math.max(0, foodNeeded - state.stocks.food)
  state.stocks.food = round(Math.max(0, state.stocks.food - foodNeeded))
  state.starving = shortage > 0
  if (state.starving) {
    state.hungerDays += 1
    state.growthProgress = Math.max(0, state.growthProgress - 0.5)
    state.event = { message: 'Food ran out. Move more workers to berry patches.', tone: 'warning' }
    if (state.hungerDays >= 2 && state.population > 1) {
      state.population -= 1
      state.hungerDays = 0
      state.event = { message: 'The prolonged shortage cost the settlement one person.', tone: 'warning' }
      while (totalAssigned(state) > state.population) {
        const assignment = Object.entries(state.assignments).find(([, workers]) => workers > 0)
        if (assignment) state.assignments[Number(assignment[0])] -= 1
        else state.builderWorkers = Math.max(0, state.builderWorkers - 1)
      }
    }
  } else {
    state.hungerDays = 0
    const growth = growthConditions(state)
    if (growth.ready && state.population < AGE_ONE_POPULATION) {
      state.growthProgress = round(state.growthProgress + 1)
      if (state.growthProgress >= GROWTH_DAYS) {
        state.population += 1
        state.growthProgress = 0
        state.event = { message: `A new villager joined. Population is now ${state.population}.`, tone: 'good' }
      }
    } else if (state.population < AGE_ONE_POPULATION) {
      state.growthProgress = Math.max(0, round(state.growthProgress - 0.25))
    }
  }

  if (state.population >= AGE_ONE_POPULATION) {
    state.stableDays = round(Math.min(AGE_ONE_STABLE_DAYS, state.stableDays + 1))
    if (state.stableDays >= AGE_ONE_STABLE_DAYS) {
      state.ageOne = true
      state.event = { message: 'The village has entered Age 1.', tone: 'good' }
    }
  } else {
    state.stableDays = round(Math.max(0, state.stableDays - 0.35))
  }

  return state
}

export function advanceTime(state: AgeZeroState, seconds: number): AgeZeroState {
  if (state.speed === 0 || state.ageOne) return state
  let dayProgress = state.dayProgress + (seconds * state.speed) / DAY_SECONDS
  let next = state
  while (dayProgress >= 1) {
    next = advanceDay(next)
    dayProgress -= 1
  }
  return { ...next, dayProgress: Math.round(dayProgress * 10_000) / 10_000 }
}

export function formatCost(cost: Partial<Stocks>) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${resource}`)
    .join(' · ')
}

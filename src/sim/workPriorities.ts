import type {
  Place,
  PlaceKind,
  WorkPriorityCategory,
  WorkPriorityLevel,
  WorldState,
} from './types'

export const DEFAULT_WORK_PRIORITIES: Record<WorkPriorityCategory, WorkPriorityLevel> = {
  food: 2,
  build: 2,
  wood: 1,
  stone: 1,
}

export function workCategoryForPlace(
  place: Pick<Place, 'kind'>,
): WorkPriorityCategory | null {
  if (place.kind === 'construction-site') return 'build'
  if (place.kind === 'farm' || place.kind === 'stall') return 'food'
  if (place.kind === 'forestry') return 'wood'
  if (place.kind === 'quarry') return 'stone'
  return null
}

export function workPriorityForPlace(world: WorldState, place: Place): number {
  const category = workCategoryForPlace(place)
  if (!category) return -1
  const town = world.workPriorities?.[category] ?? DEFAULT_WORK_PRIORITIES[category]
  if (town === 0) return Number.NEGATIVE_INFINITY
  const site = place.kind === 'construction-site'
    ? place.construction?.priority ?? 2
    : 2
  return town * 10 + site
}

export function isWorkPriorityCategory(value: string): value is WorkPriorityCategory {
  return value === 'food' || value === 'build' || value === 'wood' || value === 'stone'
}

export function isWorkPriorityLevel(value: number): value is WorkPriorityLevel {
  return Number.isInteger(value) && value >= 0 && value <= 3
}

export function isWorkplaceKind(kind: PlaceKind): boolean {
  return kind === 'farm' ||
    kind === 'stall' ||
    kind === 'forestry' ||
    kind === 'quarry' ||
    kind === 'construction-site'
}

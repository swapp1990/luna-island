import { describe, expect, it } from 'vitest'
import {
  AGE_ONE_POPULATION,
  advanceDay,
  availableWorkers,
  canPlaceBuilding,
  createAgeZeroState,
  distanceEfficiency,
  getHearthIndex,
  placeBuilding,
  setBuilderWorkers,
  setResourceWorkers,
  shelterCapacity,
  totalAssigned,
  type AgeZeroState,
} from '../src/age0/game'

const hearthCell = 22

function buildHearth(state: AgeZeroState) {
  state = placeBuilding(state, 'hearth', hearthCell)
  state = setBuilderWorkers(state, 6)
  return advanceDay(state)
}

function advance(state: AgeZeroState, days: number) {
  for (let day = 0; day < days; day += 1) state = advanceDay(state)
  return state
}

describe('Age 0 settlement game', () => {
  it('starts as the requested six-person deterministic camp', () => {
    const first = createAgeZeroState()
    const second = createAgeZeroState()

    expect(first).toEqual(second)
    expect(first.population).toBe(6)
    expect(shelterCapacity(first)).toBe(6)
    expect(first.cells).toHaveLength(81)
    expect(canPlaceBuilding(first, 'hearth', hearthCell)).toBe(true)
    expect(canPlaceBuilding(first, 'hearth', 2)).toBe(false)
  })

  it('conserves the abstract workforce and rewards nearby resources', () => {
    let state = buildHearth(createAgeZeroState())
    expect(getHearthIndex(state)).toBe(hearthCell)

    state = setResourceWorkers(state, 4, 4)
    state = setResourceWorkers(state, 0, 4)
    expect(totalAssigned(state)).toBe(6)
    expect(availableWorkers(state)).toBe(0)
    expect(distanceEfficiency(state, 4)).toBeGreaterThan(distanceEfficiency(state, 0))
  })

  it('drains Age 1 stability gradually when population falls', () => {
    const state = {
      ...createAgeZeroState(),
      population: 11,
      stableDays: 3.2,
      stocks: { food: 30, wood: 14, stone: 8, fiber: 8 },
    }
    const next = advanceDay(state)
    expect(next.stableDays).toBe(2.85)
  })

  it('supports a normal workforce strategy all the way to Age 1', () => {
    let state = buildHearth(createAgeZeroState())

    // Four foragers and two builders establish the first spare beds.
    state = setResourceWorkers(state, 4, 4)
    state = placeBuilding(state, 'leanTo', 23)
    state = setBuilderWorkers(state, 2)
    state = advance(state, 3)
    expect(shelterCapacity(state)).toBe(9)

    // Temporarily spread the camp across food, wood, and fiber.
    state = setResourceWorkers(state, 4, 3)
    state = setResourceWorkers(state, 0, 2)
    state = setResourceWorkers(state, 19, 1)
    state = advance(state, 3)
    expect(state.stocks.wood).toBeGreaterThanOrEqual(8)
    expect(state.stocks.fiber).toBeGreaterThanOrEqual(5)

    // Bring material gatherers back to raise the second lean-to quickly.
    state = setResourceWorkers(state, 0, 0)
    state = setResourceWorkers(state, 19, 0)
    state = placeBuilding(state, 'leanTo', 24)
    state = setBuilderWorkers(state, 4)
    state = advance(state, 2)
    expect(shelterCapacity(state)).toBe(12)

    // Expand food production with population, moving gatherers as patches run out.
    for (let day = 0; day < 45 && !state.ageOne; day += 1) {
      let assignedForagers = Object.entries(state.assignments)
        .filter(([index]) => state.cells[Number(index)].kind === 'food')
        .reduce((sum, [, workers]) => sum + workers, 0)
      for (let index = 0; index < state.cells.length && assignedForagers < state.population; index += 1) {
        if (state.cells[index].kind !== 'food' || (state.cells[index].remaining ?? 0) <= 0) continue
        const current = state.assignments[index] ?? 0
        const requested = Math.min(4, current + state.population - assignedForagers)
        state = setResourceWorkers(state, index, requested)
        assignedForagers = Object.entries(state.assignments)
          .filter(([cellIndex]) => state.cells[Number(cellIndex)].kind === 'food')
          .reduce((sum, [, workers]) => sum + workers, 0)
      }
      state = advanceDay(state)
    }

    expect(state.population).toBe(AGE_ONE_POPULATION)
    expect(state.ageOne).toBe(true)
    expect(state.stableDays).toBe(5)
    expect(state.day).toBeLessThan(40)
  })
})

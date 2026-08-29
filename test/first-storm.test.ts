import { describe, expect, it } from 'vitest'
import {
  FIRST_STORM_END_TICK,
  FIRST_STORM_START_TICK,
  firstStormObjectives,
} from '../src/sim/firstStorm'
import { Simulation } from '../src/sim/sim'
import type { BuildableKind } from '../src/sim/types'

function freePlot(sim: Simulation, kind: BuildableKind): { x: number; y: number } {
  for (let y = 1; y < sim.state.height - 1; y++) {
    for (let x = 1; x < sim.state.width - 1; x++) {
      if (sim.validateBuildPlacement(kind, x, y).ok) return { x, y }
    }
  }
  throw new Error(`no free ${kind} plot`)
}

describe('first-storm scenario', () => {
  it('opens with seven settlers and three clear survival promises', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    expect(sim.state.agents).toHaveLength(7)
    expect(sim.state.scenario).toEqual({
      kind: 'first-storm',
      status: 'preparing',
      stormStartTick: FIRST_STORM_START_TICK,
      stormEndTick: FIRST_STORM_END_TICK,
      preparedObjectiveIds: [],
      departedAgentIds: [],
    })
    expect(firstStormObjectives(sim.state).map((objective) => ({
      id: objective.id,
      current: objective.current,
      target: objective.target,
      met: objective.met,
    }))).toEqual([
      { id: 'housing', current: 4, target: 7, met: false },
      { id: 'food', current: 32, target: 14, met: true },
      { id: 'water', current: 0, target: 1, met: false },
    ])
  })

  it('applies storm pressure and freezes natural regrowth', () => {
    const sim = new Simulation(43, { scenario: 'first-storm' })
    const settler = sim.state.agents[0]!
    const bush = sim.state.places.find((place) => place.kind === 'berry-bush')!
    settler.needs.hunger = 0.8
    settler.needJitter.hunger = 1
    bush.inventory.food = 0
    sim.state.tick = FIRST_STORM_START_TICK - 1
    sim.advanceTicks(1)
    expect(sim.state.scenario?.status).toBe('storm')
    expect(0.8 - settler.needs.hunger).toBeCloseTo(2 / 960, 6)
    expect(bush.inventory.food).toBe(0)
  })

  it('causes a visible exodus when promises are still broken at dawn', () => {
    const sim = new Simulation(44, { scenario: 'first-storm' })
    sim.state.tick = FIRST_STORM_END_TICK - 1
    sim.advanceTicks(1)
    expect(sim.state.scenario?.status).toBe('failed')
    expect(sim.state.scenario?.departedAgentIds).toHaveLength(2)
    expect(sim.state.agents).toHaveLength(5)
    expect(sim.getEvents().filter((event) => event.type === 'scenario:settler-departed')).toHaveLength(2)
  })

  it('lets settlers finish the player-designated house and well before the storm clears', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    const homeAt = freePlot(sim, 'home')
    expect(sim.issuePlayerCommand({ type: 'build', placeKind: 'home', ...homeAt }).ok).toBe(true)
    const wellAt = freePlot(sim, 'well')
    expect(sim.issuePlayerCommand({ type: 'build', placeKind: 'well', ...wellAt }).ok).toBe(true)

    sim.advanceTicks(FIRST_STORM_END_TICK)

    expect(sim.state.places.filter((place) => place.kind === 'home')).toHaveLength(2)
    expect(sim.state.places.filter((place) => place.kind === 'well')).toHaveLength(1)
    expect(firstStormObjectives(sim.state).every((objective) => objective.met)).toBe(true)
    expect(sim.state.scenario?.status).toBe('survived')
    expect(sim.state.agents).toHaveLength(7)
  })
})

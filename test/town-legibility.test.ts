import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import {
  residentHomeLabel,
  residentWorkLabel,
  townAlerts,
  townStories,
  townVitals,
} from '../src/town/legibility'

describe('town legibility view models', () => {
  it('turns the first-season state into player-readable health and alerts', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    const vitals = townVitals(sim.state)
    expect(vitals.population).toBe(7)
    expect(vitals.housed).toBe(4)
    expect(vitals.homeless).toBe(3)
    expect(vitals.food).toBe(32)
    expect(vitals.foodDays).toBeCloseTo(32 / 7, 5)

    const alerts = townAlerts(sim.state)
    expect(alerts.some((alert) => alert.id === 'homeless')).toBe(true)
    expect(alerts.find((alert) => alert.id === 'homeless')?.agentId).toBeTruthy()
  })

  it('exposes literal current causes, home, work, and recent town activity', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    sim.advanceTicks(3)
    const resident = sim.state.agents[0]!
    expect(resident.action.reason.length).toBeGreaterThan(0)
    expect(residentHomeLabel(resident, sim.state).length).toBeGreaterThan(0)
    expect(residentWorkLabel(resident, sim.state).length).toBeGreaterThan(0)

    const stories = townStories(sim.state, sim.getEvents())
    expect(stories.length).toBeGreaterThan(0)
    expect(stories.some((story) => story.agentId !== undefined)).toBe(true)
  })

  it('surfaces stalled construction as an actionable place-linked alert', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    const plot = sim.state.tiles.find((tile) => sim.validateBuildPlacement('home', tile.x, tile.y).ok)!
    const result = sim.issuePlayerCommand({ type: 'build', placeKind: 'home', x: plot.x, y: plot.y })
    expect(result.ok).toBe(true)
    const site = sim.state.places.find((place) => place.id === result.placeId)!
    for (const resident of sim.state.agents) resident.employedAt = null

    expect(townAlerts(sim.state)).toContainEqual(expect.objectContaining({
      id: `site-workers-${site.id}`,
      placeId: site.id,
      severity: 'warning',
    }))
  })
})

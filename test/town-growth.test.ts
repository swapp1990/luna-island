import { describe, expect, it } from 'vitest'
import { buildUserPrompt } from '../src/mind/prompt'
import { isLunaAgent } from '../src/sim/lunaRoster'
import { restoreSave, serializeSave } from '../src/sim/persist'
import { Simulation } from '../src/sim/sim'
import {
  appealComponents,
  availableInvitation,
  currentMilestone,
  isBuildUnlocked,
  syncTownGrowth,
  townAppeal,
  upgradesUnlocked,
} from '../src/sim/townGrowth'
import { emptyInventory, type WorldState } from '../src/sim/types'

function makeAttractive(world: WorldState): void {
  const home = world.places.find((place) => place.kind === 'home')!
  home.slots = 12
  for (const resident of world.agents) resident.homeId = home.id
  const store = world.places.find((place) => place.kind === 'storehouse')!
  store.inventory.food = 80
  const plaza = world.places.find((place) => place.kind === 'plaza')!
  world.places.push({
    id: 'growth-well', kind: 'well', x: plaza.x + 7, y: plaza.y,
    slots: 2, inventory: emptyInventory(),
  })
  world.places.push({
    id: 'growth-board', kind: 'notice-board', x: plaza.x - 7, y: plaza.y,
    slots: 2, inventory: emptyInventory(),
  })
  world.owners['growth-well'] = 'commons'
  world.owners['growth-board'] = 'commons'
  if (world.scenario?.kind === 'first-storm') world.scenario.status = 'survived'
  syncTownGrowth(world)
}

describe('town growth and Luna invitations', () => {
  it('derives Appeal from six legible town systems and gates the milestone ladder', () => {
    const sim = new Simulation(42, { scenario: 'first-storm' })
    const components = appealComponents(sim.state)
    expect(components.map((component) => component.id)).toEqual([
      'housing', 'food', 'work', 'water', 'safety', 'civic',
    ])
    expect(components.reduce((sum, component) => sum + component.max, 0)).toBe(100)
    expect(townAppeal(sim.state)).toBeGreaterThan(0)
    expect(currentMilestone(sim.state).id).toBe('camp')
    expect(isBuildUnlocked(sim.state, 'forestry')).toBe(false)
    expect(isBuildUnlocked(sim.state, 'stall')).toBe(false)
    expect(upgradesUnlocked(sim.state)).toBe(false)
  })

  it('offers a named choice only after safety, Appeal, and spare housing are real', () => {
    const sim = new Simulation(43, { scenario: 'first-storm' })
    expect(availableInvitation(sim.state)).toBeNull()
    makeAttractive(sim.state)
    expect(townAppeal(sim.state)).toBeGreaterThanOrEqual(95)
    expect(currentMilestone(sim.state).id).toBe('sanctuary')
    expect(upgradesUnlocked(sim.state)).toBe(true)
    const offer = availableInvitation(sim.state)!
    expect(offer.candidates.map((candidate) => candidate.name)).toEqual(['Mira', 'Joss'])

    const before = sim.state.agents.length
    const accepted = sim.issuePlayerCommand({ type: 'accept-invitation', candidateId: 'agent-0' })
    expect(accepted.ok).toBe(true)
    expect(sim.state.agents).toHaveLength(before + 1)
    const mira = sim.state.agents.find((agent) => agent.id === 'agent-0')!
    expect(mira.name).toBe('Mira')
    expect(isLunaAgent(mira.id)).toBe(true)
    expect(mira.homeId).toBeTruthy()
    expect(sim.state.townGrowth?.acceptedAgentIds).toContain('agent-0')
    expect(availableInvitation(sim.state)?.candidates.map((candidate) => candidate.name)).toEqual(['Tama', 'Ren'])
    expect(restoreSave(serializeSave(sim)).hash()).toBe(sim.hash())
  })

  it('turns player commands into resident-visible and mind-visible facts', () => {
    const sim = new Simulation(44, { scenario: 'first-storm' })
    const tile = sim.state.tiles.find((candidate) => sim.validatePathPlacement(candidate.x, candidate.y).ok)!
    expect(sim.issuePlayerCommand({ type: 'paint-path', x: tile.x, y: tile.y, enabled: true }).ok).toBe(true)
    const resident = sim.state.agents[0]!
    expect(resident.observedFacts?.at(-1)?.text).toContain('player laid a path')
    expect(buildUserPrompt(resident, sim.state, sim.getEvents())).toContain('Player-made town facts:')
    expect(buildUserPrompt(resident, sim.state, sim.getEvents())).toContain('The player laid a path')
  })

  it('exposes player upgrades only at Town and creates a materialized upgrade site', () => {
    const sim = new Simulation(45, { scenario: 'first-storm' })
    const home = sim.state.places.find((place) => place.kind === 'home')!
    expect(sim.issuePlayerCommand({ type: 'upgrade-place', placeId: home.id }).reason).toBe('locked')
    makeAttractive(sim.state)
    const result = sim.issuePlayerCommand({ type: 'upgrade-place', placeId: home.id })
    expect(result.ok).toBe(true)
    const site = sim.state.places.find((place) => place.id === result.placeId)!
    expect(site.kind).toBe('construction-site')
    expect(site.construction?.upgradeOf).toBe(home.id)
    expect(site.construction?.targetKind).toBe('home')
    expect(sim.state.agents.every((agent) => agent.observedFacts?.some((fact) => fact.text.includes('upgrade')))).toBe(true)
  })
})

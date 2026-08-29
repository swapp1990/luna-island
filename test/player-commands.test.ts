import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import { restoreSave, serializeSave } from '../src/sim/persist'

function freePlot(sim: Simulation, kind = 'notice-board') {
  for (let y = 0; y < sim.state.height; y++) {
    for (let x = 0; x < sim.state.width; x++) {
      const check = sim.validateBuildPlacement(kind, x, y)
      if (check.ok) return { x, y, check }
    }
  }
  throw new Error('no free plot')
}

describe('player command seam', () => {
  it('places synchronously while paused and records commons ownership', () => {
    const sim = new Simulation(901)
    const plot = freePlot(sim)
    const tick = sim.state.tick
    const result = sim.issuePlayerCommand({ type: 'build', placeKind: 'notice-board', x: plot.x, y: plot.y })
    expect(result.ok).toBe(true)
    expect(sim.state.tick).toBe(tick)
    expect(result.placeId).toBeDefined()
    expect(sim.state.owners[result.placeId!]).toBe('commons')
    expect(sim.getPlayerCommandLog()).toHaveLength(1)
    expect(sim.state.mindStats).toEqual({})
  })

  it('keeps understocked plots valid and reports shortages', () => {
    const sim = new Simulation(902)
    const plot = freePlot(sim, 'home')
    expect(plot.check.ok).toBe(true)
    expect(plot.check.missingStoredMaterials.wood).toBeGreaterThanOrEqual(0)
    expect(plot.check.warning === 'missing-materials' || plot.check.warning === undefined).toBe(true)
  })

  it('cancels with material conservation and replays a command at a snapshot tick', () => {
    const sim = new Simulation(903)
    sim.advanceTicks(180)
    const plot = freePlot(sim)
    const built = sim.issuePlayerCommand({ type: 'build', placeKind: 'notice-board', x: plot.x, y: plot.y })
    const site = sim.state.places.find((p) => p.id === built.placeId)!
    const store = sim.state.places.find((p) => p.kind === 'storehouse')
    site.inventory.wood = 1
    const before = store?.inventory.wood ?? 0
    const cancelled = sim.issuePlayerCommand({ type: 'cancel-construction', placeId: site.id })
    expect(cancelled.ok).toBe(true)
    expect(sim.state.places.some((p) => p.id === site.id)).toBe(false)
    if (store) expect(store.inventory.wood).toBe(before + 1)
    expect(sim.stateAt(180).hash()).toBe(sim.hash())

    const save = restoreSave(serializeSave(sim))
    expect(save.hash()).toBe(sim.hash())
  })

  it('rejects water, collision, and protected demolish targets', () => {
    const sim = new Simulation(904)
    const water = sim.state.tiles.find((t) => t.kind === 'water' && t.x > 0 && t.y > 0 && t.x < sim.state.width - 1 && t.y < sim.state.height - 1)!
    const waterResult = sim.validateBuildPlacement('home', water.x, water.y)
    expect(waterResult.reason).toBe('water')
    const existing = sim.state.places.find((p) => p.kind === 'home')!
    expect(sim.validateBuildPlacement('home', existing.x, existing.y).reason).toBe('collision')
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    expect(sim.issuePlayerCommand({ type: 'demolish', placeId: plaza.id }).reason).toBe('protected')
  })

  it('replays commands from a pinned snapshot after the fine ring is pruned', () => {
    const sim = new Simulation(905)
    sim.advanceTicks(720)
    const plot = freePlot(sim)
    const issued = sim.issuePlayerCommand({ type: 'build', placeKind: 'notice-board', x: plot.x, y: plot.y })
    expect(issued.ok).toBe(true)
    const expected = sim.stateAt(720).hash()
    sim.advanceTicks(800)
    expect(sim.archives().some((a) => a.day === 1)).toBe(true)
    // Tick 720's fine snapshot was pruned; stateAt must use command playback.
    expect(sim.stateAt(720).hash()).toBe(expected)
  })
})

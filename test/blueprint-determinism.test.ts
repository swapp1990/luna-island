import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'

function findSchoolPlot(sim: Simulation): { x: number; y: number } {
  for (let y = 1; y < sim.state.height - 6; y++) {
    for (let x = 1; x < sim.state.width - 8; x++) {
      const check = sim.validateBlueprintPlacement('school', x, y)
      if (check.ok) return { x, y }
    }
  }
  throw new Error('no school plot')
}

describe('blueprint determinism', () => {
  it('same seed + same place-blueprint command log ⇒ identical hash', () => {
    const seed = 42
    const a = new Simulation(seed)
    const b = new Simulation(seed)
    const plot = findSchoolPlot(a)
    expect(findSchoolPlot(b)).toEqual(plot)
    a.issuePlayerCommand({ type: 'place-blueprint', blueprintId: 'school', x: plot.x, y: plot.y })
    b.issuePlayerCommand({ type: 'place-blueprint', blueprintId: 'school', x: plot.x, y: plot.y })
    a.advanceTicks(240)
    b.advanceTicks(240)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
  })

  it('same seed + debug-stock-site command log ⇒ identical hash', () => {
    const seed = 42
    const a = new Simulation(seed)
    const b = new Simulation(seed)
    const plot = findSchoolPlot(a)
    const placedA = a.issuePlayerCommand({ type: 'place-blueprint', blueprintId: 'school', x: plot.x, y: plot.y })
    const placedB = b.issuePlayerCommand({ type: 'place-blueprint', blueprintId: 'school', x: plot.x, y: plot.y })
    expect(placedA.placeId).toBe(placedB.placeId)
    a.issuePlayerCommand({ type: 'debug-stock-site', placeId: placedA.placeId! })
    b.issuePlayerCommand({ type: 'debug-stock-site', placeId: placedB.placeId! })
    a.advanceTicks(120)
    b.advanceTicks(120)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
    const stocked = a.getEvents().filter((e) => e.type === 'structure:sandbox-stocked')
    expect(stocked).toHaveLength(1)
    expect(stocked[0]?.reason).toBe('sandbox: site fully stocked')
  })
})

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
})

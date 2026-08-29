import { describe, expect, it } from 'vitest'
import { MAX_ACTIVE_SITES, Simulation } from '../src/sim/sim'

function findSchoolPlot(sim: Simulation): { x: number; y: number } {
  for (let y = 1; y < sim.state.height - 6; y++) {
    for (let x = 1; x < sim.state.width - 8; x++) {
      const check = sim.validateBlueprintPlacement('school', x, y)
      if (check.ok) return { x, y }
    }
  }
  throw new Error('no school plot')
}

describe('blueprint placement', () => {
  it('accepts a clean plot', () => {
    const sim = new Simulation(42)
    const plot = findSchoolPlot(sim)
    const check = sim.validateBlueprintPlacement('school', plot.x, plot.y)
    expect(check.ok).toBe(true)
    expect(check.reasonCode).toBe('ok')
    const result = sim.issuePlayerCommand({
      type: 'place-blueprint',
      blueprintId: 'school',
      x: plot.x,
      y: plot.y,
    })
    expect(result.ok).toBe(true)
    const site = sim.state.places.find((p) => p.id === result.placeId)
    expect(site?.kind).toBe('construction-site')
    expect(site?.structure?.blueprintId).toBe('school')
    expect(site?.structure?.originX).toBe(plot.x)
    expect(site?.structure?.originY).toBe(plot.y)
    expect(site?.construction?.needs.wood).toBe(36)
    expect(site?.construction?.needs.stone).toBe(19)
    const placed = sim.getEvents().find((e) => e.type === 'blueprint:placed')
    expect(placed?.reason).toBe(`placed school blueprint at (${plot.x},${plot.y})`)
  })

  it('rejects an unknown blueprint', () => {
    const sim = new Simulation(42)
    const check = sim.validateBlueprintPlacement('cathedral', 10, 10)
    expect(check.ok).toBe(false)
    expect(check.reasonCode).toBe('unknown-kind')
  })

  it('rejects out-of-bounds', () => {
    const sim = new Simulation(42)
    const check = sim.validateBlueprintPlacement('school', sim.state.width, 2)
    expect(check.ok).toBe(false)
    expect(check.reasonCode).toBe('out-of-bounds')
  })

  it('rejects water under one cell', () => {
    const sim = new Simulation(42)
    let found: { x: number; y: number } | null = null
    for (const tile of sim.state.tiles) {
      if (tile.kind !== 'water') continue
      if (tile.x < 1 || tile.y < 1) continue
      if (tile.x + 7 >= sim.state.width || tile.y + 5 >= sim.state.height) continue
      const originX = tile.x
      const originY = tile.y
      const check = sim.validateBlueprintPlacement('school', originX, originY)
      if (check.reasonCode === 'water') {
        found = { x: originX, y: originY }
        break
      }
    }
    expect(found).not.toBeNull()
    expect(sim.validateBlueprintPlacement('school', found!.x, found!.y).reasonCode).toBe('water')
  })

  it('rejects overlap with an existing place', () => {
    const sim = new Simulation(42)
    const plot = findSchoolPlot(sim)
    const placed = sim.issuePlayerCommand({
      type: 'place-blueprint',
      blueprintId: 'school',
      x: plot.x,
      y: plot.y,
    })
    expect(placed.ok).toBe(true)
    const check = sim.validateBlueprintPlacement('school', plot.x + 1, plot.y)
    expect(check.ok).toBe(false)
    expect(check.reasonCode).toBe('collision')
  })

  it('rejects a clearance violation', () => {
    const sim = new Simulation(42)
    const plot = findSchoolPlot(sim)
    const placed = sim.issuePlayerCommand({
      type: 'place-blueprint',
      blueprintId: 'school',
      x: plot.x,
      y: plot.y,
    })
    expect(placed.ok).toBe(true)
    // Slide one tile so cells may clear but the 1-tile ring hits the first school.
    const nearby = sim.validateBlueprintPlacement('school', plot.x + 7, plot.y)
    expect(nearby.ok).toBe(false)
    expect(nearby.reasonCode).toBe('clearance')
  })

  it('rejects when the site cap is full', () => {
    const sim = new Simulation(42)
    let planted = 0
    for (let y = 1; y < sim.state.height - 1 && planted < MAX_ACTIVE_SITES; y++) {
      for (let x = 1; x < sim.state.width - 1 && planted < MAX_ACTIVE_SITES; x++) {
        const check = sim.validateBuildPlacement('notice-board', x, y)
        if (!check.ok) continue
        const result = sim.issuePlayerCommand({
          type: 'build',
          placeKind: 'notice-board',
          x,
          y,
        })
        if (result.ok) planted += 1
      }
    }
    expect(planted).toBe(MAX_ACTIVE_SITES)
    const plot = { x: 4, y: 4 }
    const check = sim.validateBlueprintPlacement('school', plot.x, plot.y)
    expect(check.reasonCode).toBe('site-cap')
  })
})

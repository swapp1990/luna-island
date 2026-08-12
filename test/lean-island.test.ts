import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import { presetFacts, resolveWorldPreset } from '../src/sim/worldgen'
import { serializeSave, restoreSave } from '../src/sim/persist'

function bushCount(sim: Simulation): number {
  return sim.state.places.filter((p) => p.kind === 'berry-bush').length
}

function farmYields(sim: Simulation): number[] {
  return sim.state.places
    .filter((p) => p.kind === 'farm')
    .map((p) => p.production?.yield ?? 0)
    .sort((a, b) => a - b)
}

function spawnFood(sim: Simulation): number[] {
  return sim.state.agents.map((a) => a.inventory.food).sort((a, b) => a - b)
}

describe('lean-island preset (P3-5)', () => {
  it('same seed+preset is hash-identical', () => {
    const a = new Simulation(42, { preset: 'lean' })
    const b = new Simulation(42, { preset: 'lean' })
    expect(a.hash()).toBe(b.hash())
    a.advanceTicks(400)
    b.advanceTicks(400)
    expect(a.hash()).toBe(b.hash())

    const d1 = new Simulation(42)
    const d2 = new Simulation(42, { preset: 'default' })
    expect(d1.hash()).toBe(d2.hash())
    expect(d1.hash()).not.toBe(a.hash())
  })

  it('exactly the four listed facts differ between presets at the same seed', () => {
    const def = new Simulation(42)
    const lean = new Simulation(42, { preset: 'lean' })

    const df = presetFacts('default')
    const lf = presetFacts('lean')
    expect(df).toEqual({
      bushes: 10,
      bushRegrowInterval: 100,
      farmYield: 14,
      spawnFood: 4,
    })
    expect(lf).toEqual({
      bushes: 6,
      bushRegrowInterval: 300,
      farmYield: 8,
      spawnFood: 2,
    })

    expect(bushCount(def)).toBe(df.bushes)
    expect(bushCount(lean)).toBe(lf.bushes)
    expect(farmYields(def).every((y) => y === df.farmYield)).toBe(true)
    expect(farmYields(lean).every((y) => y === lf.farmYield)).toBe(true)
    expect(farmYields(def).length).toBe(farmYields(lean).length)
    expect(farmYields(def).length).toBeGreaterThan(0)
    expect(spawnFood(def).every((n) => n === df.spawnFood)).toBe(true)
    expect(spawnFood(lean).every((n) => n === lf.spawnFood)).toBe(true)
    expect(presetFacts(def.state.preset).bushRegrowInterval).toBe(100)
    expect(presetFacts(lean.state.preset).bushRegrowInterval).toBe(300)
    expect(resolveWorldPreset(def.state.preset)).toBe('default')
    expect(resolveWorldPreset(lean.state.preset)).toBe('lean')

    // Layout identity: tiles, non-bush places (except farm yield), agent coords
    expect(def.state.tiles).toEqual(lean.state.tiles)
    expect(def.state.agents.map((a) => [a.id, a.x, a.y, a.homeId])).toEqual(
      lean.state.agents.map((a) => [a.id, a.x, a.y, a.homeId]),
    )
    const placeKey = (p: { id: string; kind: string; x: number; y: number }) =>
      `${p.id}:${p.kind}:${p.x},${p.y}`
    const defNonBush = def.state.places
      .filter((p) => p.kind !== 'berry-bush')
      .map(placeKey)
    const leanNonBush = lean.state.places
      .filter((p) => p.kind !== 'berry-bush')
      .map(placeKey)
    expect(defNonBush).toEqual(leanNonBush)
  })

  it('bush regrowth interval is a live world fact (100 vs 300)', () => {
    const def = new Simulation(42)
    const lean = new Simulation(42, { preset: 'lean' })
    for (const p of def.state.places) {
      if (p.kind === 'berry-bush') p.inventory.food = 0
    }
    for (const p of lean.state.places) {
      if (p.kind === 'berry-bush') p.inventory.food = 0
    }
    def.advanceTicks(100)
    lean.advanceTicks(100)
    const dRegrow = def.getEvents().filter((e) => e.type === 'goods:regrow').length
    const lRegrow = lean.getEvents().filter((e) => e.type === 'goods:regrow').length
    expect(dRegrow).toBeGreaterThan(0)
    expect(lRegrow).toBe(0)
    lean.advanceTicks(200)
    expect(lean.getEvents().filter((e) => e.type === 'goods:regrow').length).toBeGreaterThan(
      0,
    )
  })

  it('lean preset rides through v5 save/restore', () => {
    const sim = new Simulation(7, { preset: 'lean' })
    sim.advanceTicks(50)
    const restored = restoreSave(serializeSave(sim))
    expect(restored.state.preset).toBe('lean')
    expect(bushCount(restored)).toBe(6)
    expect(restored.hash()).toBe(sim.hash())
  })
})

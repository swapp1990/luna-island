import { describe, expect, it } from 'vitest'
import { BEACH_END, ISLAND_HALF, MEADOW } from '../src/god/constants'
import {
  buildHeightfield,
  heightAt,
  meadowFlatness,
} from '../src/god/islandHeight'

describe('god island heightfield', () => {
  it('is deterministic across two builds', () => {
    const a = buildHeightfield()
    const b = buildHeightfield()
    expect(a.nrows).toBe(b.nrows)
    expect(a.ncols).toBe(b.ncols)
    expect(a.heights.length).toBe(a.nrows * a.ncols)
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights))
  })

  it('feeds render and collider from the same heights buffer', () => {
    const data = buildHeightfield()
    // A single Float32Array is the source of truth: both the mesh and the
    // rapier heightfield collider are built from `data.heights`.
    const midCol = Math.floor(data.ncols / 2)
    const midRow = Math.floor(data.nrows / 2)
    const y = data.heights[midCol * data.nrows + midRow]!
    expect(heightAt(data, 0, 0)).toBeCloseTo(y, 1)
    expect(data.scaleX).toBe(data.scaleZ)
  })

  it('has a sea-level ring below 0', () => {
    const data = buildHeightfield()
    const r = Math.min(ISLAND_HALF - data.cell, BEACH_END - 0.4)
    let below = 0
    const n = 24
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const h = heightAt(data, Math.cos(a) * r, Math.sin(a) * r)
      if (h < 0) below += 1
    }
    expect(below).toBe(n)
  })

  it('keeps the meadow flat within tolerance', () => {
    const data = buildHeightfield()
    const { min, max } = meadowFlatness(data, 64)
    expect(max - min).toBeLessThan(0.08)
    expect(Math.abs((min + max) / 2 - MEADOW.height)).toBeLessThan(0.12)
  })
})

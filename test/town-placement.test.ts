import { describe, expect, it } from 'vitest'
import {
  decideYawDeg,
  fallbackYawDeg,
  footprintFitScale,
  nearestWithinRadius,
  snapYawTowardDeg,
} from '../src/town/placement'

describe('footprint-fit scale', () => {
  it('fits the tighter axis and never upscales', () => {
    // Asset bigger than footprint on both axes → shrink.
    expect(footprintFitScale({ x: 12, z: 12 }, { w: 9, d: 9 })).toBeCloseTo(0.75, 10)
    // Asset smaller than footprint (e.g. the well) → capped at 1, not blown up.
    expect(footprintFitScale({ x: 2, z: 2 }, { w: 6, d: 6 })).toBe(1)
    // Asymmetric asset → the tighter axis (z) wins.
    expect(footprintFitScale({ x: 4, z: 10 }, { w: 8, d: 8 })).toBeCloseTo(0.8, 10)
  })

  it('is deterministic (pure function of its inputs)', () => {
    const a = footprintFitScale({ x: 7.3, z: 5.1 }, { w: 9, d: 9 })
    const b = footprintFitScale({ x: 7.3, z: 5.1 }, { w: 9, d: 9 })
    expect(a).toBe(b)
  })
})

describe('facing', () => {
  it('fallback yaw is one of the four cardinals and deterministic per id', () => {
    const cardinals = new Set([0, 90, 180, 270])
    for (const id of ['home-1', 'home-2', 'well-a', 'church', 'p-99']) {
      const y = fallbackYawDeg(id)
      expect(cardinals.has(y)).toBe(true)
      expect(fallbackYawDeg(id)).toBe(y) // same id → same yaw, every call
    }
  })

  it('different ids are not all the same cardinal (hash actually varies)', () => {
    const yaws = new Set(
      Array.from({ length: 40 }, (_, i) => fallbackYawDeg(`place-${i}`)),
    )
    expect(yaws.size).toBeGreaterThan(1)
  })

  it('snaps a direction to the nearest cardinal', () => {
    expect(snapYawTowardDeg(0, 1)).toBe(0)
    expect(snapYawTowardDeg(1, 0)).toBe(90)
    expect(snapYawTowardDeg(0, -1)).toBe(180)
    expect(snapYawTowardDeg(-1, 0)).toBe(270)
  })

  it('nearestWithinRadius finds the closest candidate, ignores far ones', () => {
    const candidates = [
      { x: 10, y: 10 },
      { x: 2, y: 0 },
      { x: 20, y: 20 },
    ]
    const hit = nearestWithinRadius(0, 0, candidates, 5)
    expect(hit?.x).toBe(2)
    expect(hit?.y).toBe(0)
    expect(nearestWithinRadius(0, 0, candidates, 1)).toBeNull()
  })

  it('decideYawDeg faces a nearby target, else falls back to the hash', () => {
    const near = decideYawDeg('home-7', 0, 0, [{ x: 0, y: 3 }], 4)
    expect(near).toBe(0) // target is +z → faces 0
    const far = decideYawDeg('home-7', 0, 0, [{ x: 0, y: 30 }], 4)
    expect(far).toBe(fallbackYawDeg('home-7'))
  })
})

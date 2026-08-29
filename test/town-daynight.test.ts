import { describe, expect, it } from 'vitest'
import { sunAzimuthDeg, sunElevationDeg, sunParamsForHour } from '../src/town/dayNightMath'

describe('day/night curve (V6)', () => {
  it('has no jump across midnight', () => {
    const a = sunParamsForHour(23.99)
    const b = sunParamsForHour(0.01)
    expect(Math.abs(a.elevationDeg - b.elevationDeg)).toBeLessThan(1)
    const azDiff = Math.abs(a.azimuthDeg - b.azimuthDeg) % 360
    expect(Math.min(azDiff, 360 - azDiff)).toBeLessThan(2)
    expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.05)
    expect(Math.abs(a.ambientIntensity - b.ambientIntensity)).toBeLessThan(0.05)
  })

  it('is continuous across a dense sweep (no discontinuities anywhere)', () => {
    let prev = sunParamsForHour(0)
    for (let h = 0.05; h <= 24; h += 0.05) {
      const cur = sunParamsForHour(h)
      expect(Math.abs(cur.elevationDeg - prev.elevationDeg)).toBeLessThan(2)
      expect(Math.abs(cur.sunIntensity - prev.sunIntensity)).toBeLessThan(0.05)
      prev = cur
    }
  })

  it('peaks near the bible daytime elevation around 13:00', () => {
    const noon = sunElevationDeg(13)
    expect(noon).toBeGreaterThan(35)
    expect(noon).toBeLessThan(50)
  })

  it('night never crushes ambient/hemi to zero (always readable)', () => {
    const midnight = sunParamsForHour(1)
    expect(midnight.ambientIntensity).toBeGreaterThanOrEqual(0.41)
    expect(midnight.hemiIntensity).toBeGreaterThanOrEqual(0.39)
    expect(midnight.exposureMultiplier).toBeGreaterThan(1.55)
    expect(midnight.dayFactor).toBeLessThan(0.1)
  })

  it('keeps the 06:00 scenario opening above the gameplay visibility floor', () => {
    const dawn = sunParamsForHour(6)
    expect(dawn.ambientIntensity).toBeGreaterThanOrEqual(0.4)
    expect(dawn.hemiIntensity).toBeGreaterThanOrEqual(0.39)
    expect(dawn.exposureMultiplier).toBeGreaterThan(1.45)
  })

  it('daytime dayFactor is near 1', () => {
    expect(sunParamsForHour(13).dayFactor).toBeGreaterThan(0.9)
  })

  it('azimuth sweeps a full turn per day, wrapping cleanly', () => {
    expect(sunAzimuthDeg(0)).toBeCloseTo(sunAzimuthDeg(24), 6)
  })
})

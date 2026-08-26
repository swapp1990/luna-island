import { describe, expect, it } from 'vitest'
import {
  CAMERA_DAMP,
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PAN_MARGIN,
  CAMERA_PITCH_MAX_DEG,
  CAMERA_PITCH_MIN_DEG,
  ISLAND_HALF,
} from '../src/god/constants'
import { clampCamera, dampCamera, type CameraPose } from '../src/god/feel'

function pose(over: Partial<CameraPose> = {}): CameraPose {
  return { yaw: 10, pitch: 45, dist: 40, tx: 0, tz: 0, ...over }
}

describe('god camera clamps', () => {
  it('clamps pitch, distance and pan for hundreds of fuzzed inputs', () => {
    const lim = ISLAND_HALF + CAMERA_PAN_MARGIN
    let s = 123456789
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    for (let i = 0; i < 400; i++) {
      const raw = pose({
        yaw: rnd() * 4000 - 2000,
        pitch: rnd() * 400 - 200,
        dist: rnd() * 400 - 50,
        tx: rnd() * 400 - 200,
        tz: rnd() * 400 - 200,
      })
      const c = clampCamera(raw)
      expect(c.pitch).toBeGreaterThanOrEqual(CAMERA_PITCH_MIN_DEG)
      expect(c.pitch).toBeLessThanOrEqual(CAMERA_PITCH_MAX_DEG)
      expect(c.dist).toBeGreaterThanOrEqual(CAMERA_DIST_MIN)
      expect(c.dist).toBeLessThanOrEqual(CAMERA_DIST_MAX)
      expect(c.tx).toBeGreaterThanOrEqual(-lim)
      expect(c.tx).toBeLessThanOrEqual(lim)
      expect(c.tz).toBeGreaterThanOrEqual(-lim)
      expect(c.tz).toBeLessThanOrEqual(lim)
    }
  })

  it('damps framerate-independently (1/30 vs two 1/60 steps)', () => {
    const from = pose({ yaw: 0, pitch: 40, dist: 20, tx: 0, tz: 0 })
    const to = pose({ yaw: 30, pitch: 55, dist: 70, tx: 20, tz: -15 })
    let a = { ...from }
    a = dampCamera(a, to, CAMERA_DAMP, 1 / 30)
    let b = { ...from }
    b = dampCamera(b, to, CAMERA_DAMP, 1 / 60)
    b = dampCamera(b, to, CAMERA_DAMP, 1 / 60)
    expect(a.yaw).toBeCloseTo(b.yaw, 4)
    expect(a.pitch).toBeCloseTo(b.pitch, 4)
    expect(a.dist).toBeCloseTo(b.dist, 4)
    expect(a.tx).toBeCloseTo(b.tx, 4)
    expect(a.tz).toBeCloseTo(b.tz, 4)
  })
})

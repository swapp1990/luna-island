import { describe, expect, it } from 'vitest'
import {
  PROP_DEFS,
  THROW_DROP_SPEED,
  THROW_MAX_TRANSFER,
  THROW_MIN_TRANSFER,
  THROW_TRANSFER,
  type PropKind,
} from '../src/god/constants'
import { releaseVelocity, throwTransfer, vecLen } from '../src/god/feel'

const KINDS: PropKind[] = ['pebble', 'cairn', 'rock', 'log', 'snag', 'boulder']

describe('god throw transfer', () => {
  it('is monotonic decreasing in mass and clamped at both ends', () => {
    expect(throwTransfer(1)).toBeCloseTo(THROW_TRANSFER, 8)

    let prev = throwTransfer(0.2)
    for (let m = 0.3; m <= 40; m += 0.25) {
      const t = throwTransfer(m)
      expect(t).toBeLessThanOrEqual(prev + 1e-12)
      expect(t).toBeGreaterThanOrEqual(THROW_MIN_TRANSFER)
      expect(t).toBeLessThanOrEqual(THROW_MAX_TRANSFER)
      prev = t
    }
  })

  it('keeps all six prop kinds in-band and strictly decreasing', () => {
    const rows = KINDS.map((kind) => {
      const mass = PROP_DEFS[kind].mass
      const transfer = throwTransfer(mass)
      return { kind, mass, transfer }
    })
    for (const r of rows) {
      expect(r.transfer, r.kind).toBeGreaterThan(THROW_MIN_TRANSFER)
      expect(r.transfer, r.kind).toBeLessThan(THROW_MAX_TRANSFER)
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.mass).toBeGreaterThan(rows[i - 1]!.mass)
      expect(rows[i]!.transfer).toBeLessThan(rows[i - 1]!.transfer)
    }
  })

  it('walks the six kinds through releaseVelocity at one hand velocity', () => {
    const hv = { x: 9, y: 4, z: 0 }
    expect(vecLen(hv)).toBeGreaterThan(THROW_DROP_SPEED)
    const speeds = KINDS.map((kind) => vecLen(releaseVelocity(hv, PROP_DEFS[kind].mass)))
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!)
    }
    const drop = releaseVelocity({ x: THROW_DROP_SPEED * 0.4, y: 0, z: 0 }, 3)
    expect(drop).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('yields exactly zero added velocity below the drop threshold', () => {
    const still = releaseVelocity({ x: 0.2, y: 0, z: 0.1 }, 3)
    expect(still).toEqual({ x: 0, y: 0, z: 0 })

    const slow = THROW_DROP_SPEED * 0.5
    const drop = releaseVelocity({ x: slow, y: 0, z: 0 }, 0.3)
    expect(drop.x).toBe(0)
    expect(drop.y).toBe(0)
    expect(drop.z).toBe(0)

    const flick = releaseVelocity({ x: THROW_DROP_SPEED + 0.5, y: 1, z: 0 }, 0.3)
    expect(flick.x).toBeGreaterThan(0)
    expect(flick.x).toBeCloseTo((THROW_DROP_SPEED + 0.5) * throwTransfer(0.3), 8)
  })
})

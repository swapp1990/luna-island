import { describe, expect, it, vi } from 'vitest'
import { MAX_FRAME_DT, MAX_TICKS_PER_FRAME } from '../src/town/constants'
import { interpolationAlpha, isTownSpeed, stepAccumulator } from '../src/town/loopMath'
import { advanceTownTicks } from '../src/town/loop'

describe('town loop math', () => {
  it('accepts only 0 / 1 / 2 / 4', () => {
    expect(isTownSpeed(0)).toBe(true)
    expect(isTownSpeed(1)).toBe(true)
    expect(isTownSpeed(2)).toBe(true)
    expect(isTownSpeed(4)).toBe(true)
    expect(isTownSpeed(8)).toBe(false)
    expect(isTownSpeed(3)).toBe(false)
  })

  it('speed 0 never steps and settles alpha at 1', () => {
    const s = stepAccumulator(0.4, 1, 0)
    expect(s.steps).toBe(0)
    expect(s.accumulator).toBe(0.4)
    expect(s.alpha).toBe(1)
    expect(interpolationAlpha(0.4, 0)).toBe(1)
  })

  it('1× advances one tick per wall second', () => {
    const s = stepAccumulator(0, 1, 1)
    expect(s.steps).toBe(1)
    expect(s.accumulator).toBeCloseTo(0, 10)
    expect(s.alpha).toBeCloseTo(0, 10)
  })

  it('2× and 4× scale tick rate', () => {
    expect(stepAccumulator(0, 1, 2).steps).toBe(2)
    expect(stepAccumulator(0, 1, 4).steps).toBe(4)
    expect(stepAccumulator(0, 0.5, 4).steps).toBe(2)
  })

  it('fractional 1× yields no step and alpha in (0, 1)', () => {
    const s = stepAccumulator(0, 0.4, 1)
    expect(s.steps).toBe(0)
    expect(s.accumulator).toBeCloseTo(0.4, 10)
    expect(s.alpha).toBeGreaterThan(0)
    expect(s.alpha).toBeLessThan(1)
    expect(s.alpha).toBe(s.accumulator)
  })

  it('caps tab-out so a 10s hitch at 1× is one tick, not ten', () => {
    expect(MAX_FRAME_DT).toBe(1)
    const s = stepAccumulator(0, 10, 1)
    expect(s.steps).toBe(1)
  })

  it('caps a 10s hitch at 4× to MAX_TICKS_PER_FRAME', () => {
    const s = stepAccumulator(0, 10, 4)
    expect(s.steps).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME)
    expect(s.steps).toBe(4)
  })

  it('keeps alpha in [0, 1] across a grid of inputs', () => {
    for (const speed of [0, 1, 2, 4]) {
      let acc = 0
      for (const dt of [0, 0.016, 0.5, 1, 2, 10]) {
        const s = stepAccumulator(acc, dt, speed)
        expect(s.alpha).toBeGreaterThanOrEqual(0)
        expect(s.alpha).toBeLessThanOrEqual(1)
        expect(s.accumulator).toBeGreaterThanOrEqual(0)
        expect(s.accumulator).toBeLessThan(1)
        acc = s.accumulator
      }
    }
  })

  it('runs the Luna mind hook after every player-town simulation tick', () => {
    const advanceTicks = vi.fn()
    const onAfterTick = vi.fn()
    const sim = { advanceTicks }

    advanceTownTicks(sim, 4, { onAfterTick }, false)

    expect(advanceTicks).toHaveBeenCalledTimes(4)
    expect(advanceTicks).toHaveBeenNthCalledWith(1, 1)
    expect(onAfterTick).toHaveBeenCalledTimes(4)
    expect(onAfterTick).toHaveBeenLastCalledWith(
      sim,
      { allowNewConversations: false },
    )
  })
})

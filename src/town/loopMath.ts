import { MAX_FRAME_DT, MAX_TICKS_PER_FRAME, TICK_HZ, type TownSpeed } from './constants'
import { clamp } from './feel'

export function isTownSpeed(n: number): n is TownSpeed {
  return n === 0 || n === 1 || n === 2 || n === 4
}

/** Wall-seconds credited per frame. Matches the main app's 1× `frameDtCap`. */
export function frameDtCap(_speed: number): number {
  return MAX_FRAME_DT
}

export interface TickStep {
  /** Leftover toward the next tick, in [0, 1). */
  accumulator: number
  steps: number
  /** Interpolation alpha in [0, 1]. Paused ⇒ 1 (settled). */
  alpha: number
}

/**
 * Credit `dt` wall-seconds at `speed` into the tick accumulator.
 * 1× advances 1 tick per real second (`TICK_HZ`). Tab-out is bounded by
 * `frameDtCap` so a hidden tab cannot fast-forward.
 */
export function stepAccumulator(
  accumulator: number,
  dt: number,
  speed: number,
  maxTicksPerFrame: number = MAX_TICKS_PER_FRAME,
): TickStep {
  if (speed <= 0) {
    return { accumulator, steps: 0, alpha: 1 }
  }
  const credited = Math.min(frameDtCap(speed), Math.max(0, dt))
  let acc = accumulator + credited * speed * TICK_HZ
  let steps = Math.floor(acc)
  if (steps > maxTicksPerFrame) {
    steps = maxTicksPerFrame
    acc = steps
  }
  acc -= steps
  const alpha = clamp(acc, 0, 1)
  return { accumulator: acc, steps, alpha }
}

/** Alpha used for agent interpolation this frame. Always in [0, 1]. */
export function interpolationAlpha(accumulator: number, speed: number): number {
  if (speed <= 0) return 1
  return clamp(accumulator, 0, 1)
}

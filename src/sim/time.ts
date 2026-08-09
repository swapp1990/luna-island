import type { SimTime, Tick } from './types'

export const HOURS = 24
export const TICKS_PER_DAY = 1440

/** World starts Day 1 06:00 at tick 0. */
export const MINUTES_AT_TICK0 = 6 * 60

export function toSimTime(tick: Tick): SimTime {
  const abs = tick + MINUTES_AT_TICK0
  const day = Math.floor(abs / TICKS_PER_DAY) + 1
  const mod = ((abs % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY
  const hour = Math.floor(mod / 60)
  const minute = mod % 60
  return { day, hour, minute, tick }
}

/** First tick of calendar `day` (Day 1 = 0 / 06:00; later days = midnight). */
export function dayStartTick(day: number): Tick {
  if (day <= 1) return 0
  return (day - 1) * TICKS_PER_DAY - MINUTES_AT_TICK0
}

/** Last inclusive tick of calendar `day`. */
export function dayEndTick(day: number): Tick {
  return dayStartTick(day + 1) - 1
}

/** Float hour-of-day in [0, 24). */
export function hourFloat(tick: Tick): number {
  const t = toSimTime(tick)
  return t.hour + t.minute / 60
}

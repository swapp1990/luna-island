export const INK_CONFIG = {
  ticksPerHour: 60,
  daysPerWeek: 7,
  startTick: 6 * 60,            // Monday 06:00

  // needs, per SIM HOUR; step.ts applies 1/60th of each per tick so bars move smoothly
  hungerDecayAwake: 0.05,
  hungerDecayAsleep: 0.025,
  energyDecayAwake: 0.05,
  energyGainAsleep: 0.12,
  socialDecay: 0.03,
  socialGainTogether: 0.50,     // only when BOTH minds are inside the town centre
  sufferingThreshold: 0.15,

  mealHunger: 0.40,             // one meal restores this much
  mealMinutes: 20,              // eating occupies this many ticks
  mealPrice: 20,
  fridgeCapacity: 6,
  startMeals: 2,
  startMoney: 200,
  wagePerHour: 15,              // accrues per tick present at work during open hours

  buyMinutes: 15,               // a market transaction occupies this many ticks
  walkUnitsPerMinute: 4,

  workOpen: { days: [0, 1, 2, 3, 4], from: 9, to: 17 },   // Mon-Fri 09:00-17:00
  marketOpen: { days: [0, 1, 2, 3, 4], from: 9, to: 18 }, // Mon-Fri 09:00-18:00, SHUT at weekends
  nightFrom: 20, nightTo: 6,    // rendering + the "is it dark" observation fact
} as const

/** A civil day has 24 hours; not a balance knob. */
export const TICKS_PER_DAY = INK_CONFIG.ticksPerHour * 24

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const DAY_NAMES_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export type DayName = (typeof DAY_NAMES)[number]

export interface InkClock {
  tick: number
  day: number
  dayName: DayName
  dayNameLong: (typeof DAY_NAMES_LONG)[number]
  hour: number
  minute: number
  isWeekend: boolean
  isNight: boolean
}

export function clockOf(tick: number): InkClock {
  const tpd = TICKS_PER_DAY
  const wrapped = ((tick % tpd) + tpd) % tpd
  const day = Math.floor(tick / tpd) % INK_CONFIG.daysPerWeek
  const hour = Math.floor(wrapped / INK_CONFIG.ticksPerHour)
  const minute = wrapped % INK_CONFIG.ticksPerHour
  const isWeekend = day === 5 || day === 6
  const isNight = hour >= INK_CONFIG.nightFrom || hour < INK_CONFIG.nightTo
  return {
    tick,
    day,
    dayName: DAY_NAMES[day]!,
    dayNameLong: DAY_NAMES_LONG[day]!,
    hour,
    minute,
    isWeekend,
    isNight,
  }
}

export function isWorkOpenAt(tick: number): boolean {
  const { day, hour } = clockOf(tick)
  const { days, from, to } = INK_CONFIG.workOpen
  return (days as readonly number[]).includes(day) && hour >= from && hour < to
}

export function isMarketOpenAt(tick: number): boolean {
  const { day, hour } = clockOf(tick)
  const { days, from, to } = INK_CONFIG.marketOpen
  return (days as readonly number[]).includes(day) && hour >= from && hour < to
}

export function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function tickRate(hourly: number): number {
  return hourly / INK_CONFIG.ticksPerHour
}

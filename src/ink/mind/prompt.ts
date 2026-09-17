import {
  DAY_NAMES_LONG,
  INK_CONFIG,
  clockOf,
  type InkClock,
} from '../sim/config'
import type { Observation, PlaceId } from '../sim/types'
import { PLACE_IDS, PLACES, placePhrase } from '../sim/world'

export type InkConfigView = {
  mealPrice: number
  fridgeCapacity: number
  wagePerHour: number
  hungerDecayAwake: number
  energyDecayAwake: number
  socialDecay: number
  marketOpen: { days: readonly number[]; from: number; to: number }
  workOpen: { days: readonly number[]; from: number; to: number }
}

const ACT_CONTRACT = `Reply with ONE JSON object and nothing else:
{"action": <go_home|go_work|go_market|go_center|sleep|eat|buy|work|socialize|wait>,
 "count": <1-6, only for buy>,
 "reason": <at most 100 characters, first person, why>}`

function hhmm(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function daysPhrase(days: readonly number[]): string {
  if (days.length === 0) return ''
  const names = days.map((d) => DAY_NAMES_LONG[d] ?? String(d))
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1]! + 1)
  if (consecutive && names.length >= 2) return `${names[0]} to ${names[names.length - 1]}`
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function openWindow(sched: { days: readonly number[]; from: number; to: number }): string {
  return `${hhmm(sched.from)}-${hhmm(sched.to)} ${daysPhrase(sched.days)}`
}

function isOpenAt(
  tick: number,
  sched: { days: readonly number[]; from: number; to: number },
): boolean {
  const { day, hour } = clockOf(tick)
  return (sched.days as readonly number[]).includes(day) && hour >= sched.from && hour < sched.to
}

export function nextOpenClock(
  tick: number,
  sched: { days: readonly number[]; from: number; to: number },
): InkClock {
  const { minute } = clockOf(tick)
  let t = minute === 0 ? tick : tick + (INK_CONFIG.ticksPerHour - minute)
  for (let i = 0; i < 24 * 10; i++) {
    if (isOpenAt(t, sched)) return clockOf(t)
    t += INK_CONFIG.ticksPerHour
  }
  return clockOf(t)
}

function nextOpenLine(kind: 'market' | 'workshop', tick: number, cfg: InkConfigView): string {
  const sched = kind === 'market' ? cfg.marketOpen : cfg.workOpen
  const next = nextOpenClock(tick, sched)
  const noun = kind === 'market' ? 'The market' : 'The workshop'
  return `${noun} is shut. It next opens ${next.dayNameLong} ${hhmm(next.hour)}.`
}

function placeList(): string {
  return PLACE_IDS.map((id) => `${PLACES[id].label} (${id})`).join(', ')
}

function whereLine(
  name: string,
  at: PlaceId | null,
  walking: boolean,
  walkingTo: PlaceId | null,
  walkMinutes: number | null,
): string {
  if (walking && walkingTo) {
    const n = walkMinutes ?? 1
    return `${name} is walking to ${placePhrase(walkingTo)}, about ${n} minutes away`
  }
  if (walking) {
    const n = walkMinutes ?? 1
    return `${name} is walking, about ${n} minutes away`
  }
  if (at) return `${name} is at ${placePhrase(at)}`
  return `${name} is on the road`
}

export function buildSystem(name = 'A', config: InkConfigView = INK_CONFIG): string {
  const identity = `You are ${name}. You live in a small town.`
  const facts = [
    `The town has five places: ${placeList()}.`,
    'An action only works where it works: sleep and eat at your own home, buy at the market, work at the workshop, socialize at the town centre. go_home, go_work, go_market and go_center walk you to those places. wait works anywhere.',
    `Hunger, energy and company sit between 0 and 1 and fall every hour. Energy rises while you sleep. Company rises only while both of you are in the town centre at the same time.`,
    `Eating needs a meal in your own fridge and your fridge holds at most ${config.fridgeCapacity}.`,
    `Meals are bought at the market for ${config.mealPrice} each. The market is open ${openWindow(config.marketOpen)}.`,
    `The workshop pays ${config.wagePerHour} an hour and is open ${openWindow(config.workOpen)}.`,
    'Walking between places takes minutes and you decide again each hour.',
  ].join('\n')
  return [identity, facts, ACT_CONTRACT].join('\n\n')
}

export function buildUser(
  obs: Observation,
  memory: string[],
  config: InkConfigView = INK_CONFIG,
): string {
  const hh = String(obs.hour).padStart(2, '0')
  const mm = String(obs.minute).padStart(2, '0')
  const lines: string[] = [`It is ${obs.dayNameLong}, ${hh}:${mm}.`]

  if (obs.marketOpen) lines.push('The market is open.')
  else lines.push(nextOpenLine('market', obs.tick, config))

  if (obs.workOpen) lines.push('The workshop is open.')
  else lines.push(nextOpenLine('workshop', obs.tick, config))

  const selfWhere = whereLine(
    'You',
    obs.self.at,
    obs.self.walking,
    obs.self.walkingTo,
    obs.self.walkMinutes,
  ).replace(/^You is /, 'You are ')
  lines.push(`${selfWhere}.`)

  lines.push(
    `Hunger ${obs.self.hunger.toFixed(2)}. Energy ${obs.self.energy.toFixed(2)}. Company ${obs.self.social.toFixed(2)}.`,
  )
  const money =
    Math.abs(obs.self.money - Math.round(obs.self.money)) < 1e-6
      ? String(Math.round(obs.self.money))
      : obs.self.money.toFixed(2)
  lines.push(`You have ${money} money.`)
  lines.push(`Your fridge holds ${obs.self.fridge} of ${config.fridgeCapacity} meals.`)

  const otherWhere = whereLine(
    obs.other.name,
    obs.other.at,
    obs.other.walking,
    obs.other.walkingTo,
    obs.other.walkMinutes,
  )
  lines.push(`${otherWhere}.`)

  lines.push('In the last 8 hours:')
  if (memory.length === 0) lines.push('Nothing yet.')
  else lines.push(...memory)

  return lines.join('\n')
}

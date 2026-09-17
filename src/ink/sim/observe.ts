import { clockOf, INK_CONFIG, isMarketOpenAt, isWorkOpenAt } from './config'
import { pathLength } from './path'
import type { InkState, Mind, MindId, Observation, PlaceId } from './types'
import { findMind, fridgeOf, otherMind, placeAtDoor, placePhrase } from './world'

function walkInfo(mind: Mind): { walkingTo: PlaceId | null; walkMinutes: number | null } {
  if (mind.path.length === 0) return { walkingTo: null, walkMinutes: null }
  const last = mind.path[mind.path.length - 1]!
  const walkingTo = placeAtDoor(last, 0.6)
  const len = pathLength(mind.path, mind.pos)
  const walkMinutes = Math.max(1, Math.round(len / INK_CONFIG.walkUnitsPerMinute))
  return { walkingTo, walkMinutes }
}

export function observationFor(state: InkState, mindId: MindId): Observation {
  const clock = clockOf(state.tick)
  const self = findMind(state, mindId)
  const other = otherMind(state, mindId)
  const fridge = fridgeOf(state, self)
  const marketOpen = isMarketOpenAt(state.tick)
  const workOpen = isWorkOpenAt(state.tick)
  const busy = self.busyUntilTick > state.tick
  const selfWalk = walkInfo(self)
  const otherWalk = walkInfo(other)
  const selfAt = self.at ? `at ${placePhrase(self.at)}` : 'on the road'
  const otherAt = other.at ? `at ${placePhrase(other.at)}` : 'on the road'
  const facts = [
    `It is ${clock.dayNameLong} ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}.`,
    clock.isNight ? 'It is dark.' : 'It is daylight.',
    marketOpen ? 'The market is open.' : 'The market is shut.',
    workOpen ? 'The workshop is open.' : 'The workshop is shut.',
    `You are ${selfAt}.`,
    `Your fridge holds ${fridge} of ${INK_CONFIG.fridgeCapacity} meals.`,
    `You have ${self.money} money.`,
    `A meal costs ${INK_CONFIG.mealPrice}. Work pays ${INK_CONFIG.wagePerHour} per hour.`,
    `Hunger ${self.hunger.toFixed(2)}, energy ${self.energy.toFixed(2)}, social ${self.social.toFixed(2)}.`,
    `${other.name} is ${otherAt}.`,
  ]
  return {
    tick: state.tick,
    day: clock.day,
    dayName: clock.dayName,
    dayNameLong: clock.dayNameLong,
    hour: clock.hour,
    minute: clock.minute,
    isWeekend: clock.isWeekend,
    isNight: clock.isNight,
    marketOpen,
    workOpen,
    self: {
      id: self.id,
      name: self.name,
      home: self.home,
      at: self.at,
      pos: { x: self.pos.x, y: self.pos.y },
      walking: self.path.length > 0,
      walkingTo: selfWalk.walkingTo,
      walkMinutes: selfWalk.walkMinutes,
      hunger: self.hunger,
      energy: self.energy,
      social: self.social,
      money: self.money,
      fridge,
      asleep: self.asleep,
      busy,
      current: self.current,
      sufferedHours: self.sufferedHours,
    },
    other: {
      id: other.id,
      name: other.name,
      at: other.at,
      walking: other.path.length > 0,
      walkingTo: otherWalk.walkingTo,
      walkMinutes: otherWalk.walkMinutes,
      hunger: other.hunger,
      energy: other.energy,
      social: other.social,
    },
    facts,
  }
}

import { clamp01, clockOf, INK_CONFIG, isMarketOpenAt, isWorkOpenAt } from './config'
import { pathToPlace } from './path'
import type { ActionKind, InkState, Intent, Mind, PlaceId } from './types'
import { fridgeOf, placePhrase, setFridge } from './world'

export type ActionOk = { ok: true; detail: Record<string, unknown> }
export type ActionFail = { ok: false; why: string }
export type ActionResult = ActionOk | ActionFail

function fail(why: string): ActionFail {
  return { ok: false, why }
}

function ok(detail: Record<string, unknown> = {}): ActionOk {
  return { ok: true, detail }
}

function notThere(mind: Mind, dest: PlaceId): string {
  if (!mind.at) return `you are on the road, not at ${placePhrase(dest)}`
  return `you are at ${placePhrase(mind.at)}, not at ${placePhrase(dest)}`
}

function shutReason(kind: 'market' | 'work', tick: number): string {
  const clock = clockOf(tick)
  const noun = kind === 'market' ? 'the market' : 'the workshop'
  if (clock.isWeekend) return `${noun} is shut on ${clock.dayNameLong}`
  const hh = String(clock.hour).padStart(2, '0')
  const mm = String(clock.minute).padStart(2, '0')
  return `${noun} is shut at ${hh}:${mm}`
}

function destOf(mind: Mind, action: ActionKind): PlaceId | null {
  if (action === 'go_home') return mind.home
  if (action === 'go_work') return 'work'
  if (action === 'go_market') return 'market'
  if (action === 'go_center') return 'center'
  return null
}

function resolveGo(state: InkState, mind: Mind, dest: PlaceId): ActionResult {
  if (mind.busyUntilTick > state.tick) return fail('you are busy')
  if (mind.at === dest) return fail(`you are already at ${dest}`)
  const path = pathToPlace(mind.pos, dest)
  mind.path = path
  mind.at = null
  mind.asleep = false
  return ok({ dest, steps: path.length })
}

function resolveBuy(state: InkState, mind: Mind, intent: Intent): ActionResult {
  const count = intent.count === undefined ? 1 : intent.count
  if (count < 1 || count > INK_CONFIG.fridgeCapacity) {
    return fail(`you can buy 1 to ${INK_CONFIG.fridgeCapacity} meals`)
  }
  if (mind.at !== 'market') return fail(notThere(mind, 'market'))
  if (!isMarketOpenAt(state.tick)) return fail(shutReason('market', state.tick))
  const cost = count * INK_CONFIG.mealPrice
  if (mind.money < cost) {
    if (count === 1) return fail(`a meal costs ${INK_CONFIG.mealPrice} and you have ${mind.money}`)
    return fail(`${count} meals cost ${cost} and you have ${mind.money}`)
  }
  const held = fridgeOf(state, mind)
  if (held + count > INK_CONFIG.fridgeCapacity) {
    return fail(`your fridge holds ${INK_CONFIG.fridgeCapacity} and already has ${held}`)
  }
  mind.money -= cost
  setFridge(state, mind, held + count)
  mind.busyUntilTick = state.tick + INK_CONFIG.buyMinutes
  return ok({ meals: count, cost })
}

export function resolveAction(state: InkState, mind: Mind, intent: Intent): ActionResult {
  const action = intent.action
  switch (action) {
    case 'go_home':
    case 'go_work':
    case 'go_market':
    case 'go_center': {
      const dest = destOf(mind, action)!
      return resolveGo(state, mind, dest)
    }
    case 'sleep': {
      if (mind.at !== mind.home) return fail(notThere(mind, mind.home))
      mind.asleep = true
      return ok({ asleep: true })
    }
    case 'eat': {
      if (mind.at !== mind.home) return fail(notThere(mind, mind.home))
      const held = fridgeOf(state, mind)
      if (held < 1) return fail('your fridge is empty')
      setFridge(state, mind, held - 1)
      mind.hunger = clamp01(mind.hunger + INK_CONFIG.mealHunger)
      mind.busyUntilTick = state.tick + INK_CONFIG.mealMinutes
      return ok({ meals: 1, hunger: mind.hunger })
    }
    case 'buy':
      return resolveBuy(state, mind, intent)
    case 'work': {
      if (mind.at !== 'work') return fail(notThere(mind, 'work'))
      if (!isWorkOpenAt(state.tick)) return fail(shutReason('work', state.tick))
      return ok({ working: true })
    }
    case 'socialize': {
      if (mind.at !== 'center') return fail(notThere(mind, 'center'))
      return ok({ at: 'center' })
    }
    case 'wait':
      return ok({})
  }
}



import type { EventTrace } from '../../sim/events'
import type { Rng } from '../../sim/types'
import { resolveAction } from './actions'
import { clamp01, clockOf, INK_CONFIG, isWorkOpenAt, tickRate } from './config'
import { observationFor } from './observe'
import { advanceWalk } from './path'
import type { InkBrains, InkState, Intent, IntentSource, Mind, MindId } from './types'
import { findMind, placeAtDoor, PLACES } from './world'

export function applyIntent(
  state: InkState,
  mindId: MindId,
  intent: Intent,
  source: IntentSource,
  events: EventTrace,
): void {
  const mind = findMind(state, mindId)
  if (intent.action !== 'sleep') mind.asleep = false
  mind.current = intent

  const data: Record<string, unknown> = { action: intent.action, source }
  if (intent.count !== undefined) data.count = intent.count
  events.append({
    tick: state.tick,
    type: 'decision',
    agentId: mind.id,
    data,
    reason: intent.reason,
  })

  const result = resolveAction(state, mind, intent)
  if (result.ok) {
    events.append({
      tick: state.tick,
      type: 'action:ok',
      agentId: mind.id,
      data: { action: intent.action, detail: result.detail },
      reason: intent.reason,
    })
  } else {
    events.append({
      tick: state.tick,
      type: 'action:fail',
      agentId: mind.id,
      data: { action: intent.action, why: result.why },
      reason: result.why,
    })
  }
  state.seq = events.getSeq()
}

function emitNeedLow(
  events: EventTrace,
  state: InkState,
  mind: Mind,
  need: 'hunger' | 'energy' | 'social',
  prev: number,
  next: number,
): void {
  const t = INK_CONFIG.sufferingThreshold
  if (prev >= t && next < t) {
    events.append({
      tick: state.tick,
      type: 'need:low',
      agentId: mind.id,
      data: { need },
    })
  }
}

function applyNeeds(state: InkState, events: EventTrace): void {
  const bothAtCenter = state.minds[0].at === 'center' && state.minds[1].at === 'center'
  for (const mind of state.minds) {
    const prevH = mind.hunger
    const prevE = mind.energy
    const prevS = mind.social
    if (mind.asleep) {
      mind.hunger = clamp01(mind.hunger - tickRate(INK_CONFIG.hungerDecayAsleep))
      mind.energy = clamp01(mind.energy + tickRate(INK_CONFIG.energyGainAsleep))
    } else {
      mind.hunger = clamp01(mind.hunger - tickRate(INK_CONFIG.hungerDecayAwake))
      mind.energy = clamp01(mind.energy - tickRate(INK_CONFIG.energyDecayAwake))
    }
    mind.social = clamp01(mind.social - tickRate(INK_CONFIG.socialDecay))
    if (bothAtCenter) {
      mind.social = clamp01(mind.social + tickRate(INK_CONFIG.socialGainTogether))
    }
    emitNeedLow(events, state, mind, 'hunger', prevH, mind.hunger)
    emitNeedLow(events, state, mind, 'energy', prevE, mind.energy)
    emitNeedLow(events, state, mind, 'social', prevS, mind.social)

    const t = INK_CONFIG.sufferingThreshold
    if (mind.hunger < t || mind.energy < t || mind.social < t) {
      mind.sufferedHours += 1 / INK_CONFIG.ticksPerHour
    }
  }
}

function payWage(state: InkState, mind: Mind): void {
  if (mind.current?.action !== 'work') return
  if (mind.at !== 'work') return
  if (!isWorkOpenAt(state.tick)) return
  mind.money += tickRate(INK_CONFIG.wagePerHour)
}

function stepWalk(state: InkState, mind: Mind, events: EventTrace): void {
  if (mind.path.length === 0) return
  advanceWalk(mind.pos, mind.path, INK_CONFIG.walkUnitsPerMinute)
  if (mind.path.length === 0) {
    const place = placeAtDoor(mind.pos) ?? placeAtDoor(mind.pos, 0.5)
    if (place) {
      const door = PLACES[place].door
      mind.at = place
      mind.pos = { x: door.x, y: door.y }
      events.append({
        tick: state.tick,
        type: 'arrive',
        agentId: mind.id,
        data: { place },
      })
    }
  }
}

export function advanceTick(
  state: InkState,
  brains: InkBrains,
  events: EventTrace,
  rng: Rng,
  source: IntentSource = 'rule',
): void {
  const clock = clockOf(state.tick)
  if (clock.hour === 0 && clock.minute === 0) {
    events.append({
      tick: state.tick,
      type: 'day',
      data: { day: clock.day, dayName: clock.dayName },
    })
  }

  if (state.tick % INK_CONFIG.ticksPerHour === 0) {
    for (const mind of state.minds) {
      const obs = observationFor(state, mind.id)
      const intent = brains[mind.id].decide(obs, rng)
      if (intent) applyIntent(state, mind.id, intent, source, events)
    }
  }

  for (const mind of state.minds) stepWalk(state, mind, events)
  for (const mind of state.minds) payWage(state, mind)
  applyNeeds(state, events)
  state.seq = events.getSeq()
  state.tick += 1
}

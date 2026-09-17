import type { SimEvent } from '../../sim/types'
import { INK_CONFIG, clockOf } from '../sim/config'

const WINDOW = 8

function hh(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function okPhrase(action: string, data: Record<string, unknown> | undefined): string {
  const detail =
    data && typeof data.detail === 'object' && data.detail !== null
      ? (data.detail as Record<string, unknown>)
      : data ?? {}
  if (action === 'buy') {
    const meals = detail.meals
    const cost = detail.cost
    if (typeof meals === 'number' && typeof cost === 'number') {
      return `bought ${meals} meals for ${cost}`
    }
  }
  if (action === 'work') return `worked, earned ${INK_CONFIG.wagePerHour}`
  if (action === 'eat') return 'ate'
  if (action === 'sleep') return 'slept'
  if (action === 'wait') return 'waited'
  if (action === 'socialize') return 'socialized'
  if (action.startsWith('go_')) {
    const dest = detail.dest
    if (typeof dest === 'string') return `walked toward ${dest}`
    return 'walked'
  }
  return 'ok'
}

function followingOutcome(
  events: readonly SimEvent[],
  decision: SimEvent,
  mindId: string,
): { ok: boolean; text: string } {
  for (const e of events) {
    if (e.seq <= decision.seq) continue
    if (e.agentId !== mindId) continue
    if (e.type === 'decision') break
    if (e.type === 'action:ok') {
      return { ok: true, text: okPhrase(String(decision.data?.action ?? ''), e.data) }
    }
    if (e.type === 'action:fail') {
      const why = String(e.reason ?? e.data?.why ?? '')
      return { ok: false, text: why }
    }
  }
  return { ok: true, text: 'ok' }
}

/** Last 8 decided hours for this mind, newest first, from the event trace. */
export function memoryLines(
  events: readonly SimEvent[],
  mindId: string,
  limit = WINDOW,
): string[] {
  const decisions = events.filter((e) => e.agentId === mindId && e.type === 'decision')
  const last = decisions.slice(-limit)
  const lines: string[] = []
  for (let i = last.length - 1; i >= 0; i--) {
    const d = last[i]!
    const action = String(d.data?.action ?? '')
    const count = d.data?.count
    const clock = clockOf(d.tick)
    let chose = `you chose ${action}`
    if (action === 'buy' && count !== undefined && count !== null) chose += ` ${count}`
    const outcome = followingOutcome(events, d, mindId)
    lines.push(`${hh(clock.hour)} ${chose} — ${outcome.text}`)
  }
  return lines
}

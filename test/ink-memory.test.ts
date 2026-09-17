import { describe, expect, it } from 'vitest'
import { memoryLines } from '../src/ink/mind/memory'
import { EventTrace } from '../src/sim/events'
import { INK_CONFIG } from '../src/ink/sim/config'
import { applyIntent } from '../src/ink/sim/step'
import { createWorld, PLACES } from '../src/ink/sim/world'

describe('ink memory', () => {
  it('is exactly the last 8 decided hours, newest first, from the trace', () => {
    const state = createWorld(1)
    const events = new EventTrace()
    for (let i = 0; i < 10; i++) {
      state.tick = INK_CONFIG.startTick + i * INK_CONFIG.ticksPerHour
      applyIntent(state, 'A', { action: 'wait', reason: `h${i}` }, 'rule', events)
    }
    const lines = memoryLines(events.getAll(), 'A')
    expect(lines).toHaveLength(8)
    expect(lines[0]).toMatch(/^15:00 you chose wait — waited$/)
    expect(lines[7]).toMatch(/^08:00 you chose wait — waited$/)
    expect(lines.join('\n')).not.toContain('06:00')
    expect(lines.join('\n')).not.toContain('07:00')
  })

  it('includes failure reasons verbatim', () => {
    const state = createWorld(1)
    const events = new EventTrace()
    state.tick = 11 * 60
    applyIntent(state, 'A', { action: 'work', reason: 'I work' }, 'llm', events)
    const fail = events.getAll().find((e) => e.type === 'action:fail')
    expect(fail?.reason).toBeTruthy()
    const lines = memoryLines(events.getAll(), 'A')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(`11:00 you chose work — ${fail!.reason}`)
  })

  it('formats a successful buy from the trace detail', () => {
    const state = createWorld(1)
    const events = new EventTrace()
    state.tick = 13 * 60
    const mind = state.minds[0]!
    mind.at = 'market'
    mind.pos = { ...PLACES.market.door }
    applyIntent(state, 'A', { action: 'buy', count: 3, reason: 'buy 3' }, 'llm', events)
    const lines = memoryLines(events.getAll(), 'A')
    expect(lines[0]).toBe('13:00 you chose buy 3 — bought 3 meals for 60')
  })

  it('does not invent a parallel log — empty trace is empty', () => {
    expect(memoryLines([], 'A')).toEqual([])
    const events = new EventTrace()
    events.append({ tick: 360, type: 'arrive', agentId: 'A', data: { place: 'market' } })
    expect(memoryLines(events.getAll(), 'A')).toEqual([])
  })
})

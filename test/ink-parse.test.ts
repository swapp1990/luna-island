import { describe, expect, it } from 'vitest'
import { parseIntent } from '../src/ink/mind/parse'

describe('parseIntent', () => {
  it('parses clean JSON', () => {
    const r = parseIntent('{"action":"buy","count":3,"reason":"I buy meals"}')
    expect(r).toEqual({
      ok: true,
      intent: { action: 'buy', count: 3, reason: 'I buy meals' },
    })
  })

  it('parses fenced JSON', () => {
    const r = parseIntent('```json\n{"action":"Work","reason":"I work"}\n```')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intent.action).toBe('work')
      expect(r.intent.count).toBeUndefined()
      expect(r.intent.reason).toBe('I work')
    }
  })

  it('parses JSON with prose around it', () => {
    const r = parseIntent('Sure, here you go:\n{"action":"wait","reason":"I wait","count":1}\nThanks.')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.intent.action).toBe('wait')
      expect(r.intent.count).toBeUndefined()
      expect(r.intent.reason).toBe('I wait')
    }
  })

  it('rejects unknown action', () => {
    expect(parseIntent('{"action":"dance","reason":"fun"}')).toEqual({
      ok: false,
      error: 'unknown-action',
    })
  })

  it('rejects count 0, 9, and "three" on buy', () => {
    expect(parseIntent('{"action":"buy","count":0,"reason":"x"}')).toEqual({
      ok: false,
      error: 'bad-count',
    })
    expect(parseIntent('{"action":"buy","count":9,"reason":"x"}')).toEqual({
      ok: false,
      error: 'bad-count',
    })
    expect(parseIntent('{"action":"buy","count":"three","reason":"x"}')).toEqual({
      ok: false,
      error: 'bad-count',
    })
  })

  it('defaults buy count to 1 and supplies a missing reason', () => {
    const r = parseIntent('{"action":"buy"}')
    expect(r).toEqual({
      ok: true,
      intent: { action: 'buy', count: 1, reason: '(no reason given)' },
    })
  })

  it('truncates a 400-character reason to 100', () => {
    const reason = 'r'.repeat(400)
    const r = parseIntent(JSON.stringify({ action: 'sleep', reason }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.intent.reason).toHaveLength(100)
  })

  it('fails on empty string', () => {
    expect(parseIntent('')).toEqual({ ok: false, error: 'no-json' })
    expect(parseIntent('   ')).toEqual({ ok: false, error: 'no-json' })
    expect(parseIntent('no object here')).toEqual({ ok: false, error: 'no-json' })
  })
})

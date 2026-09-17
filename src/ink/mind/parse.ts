import type { ActionKind, Intent } from '../sim/types'

const ACTIONS = new Set<string>([
  'go_home',
  'go_work',
  'go_market',
  'go_center',
  'sleep',
  'eat',
  'buy',
  'work',
  'socialize',
  'wait',
])

export type ParseErrorCode = 'no-json' | 'unknown-action' | 'bad-count'

export type ParseIntentResult =
  | { ok: true; intent: Intent }
  | { ok: false; error: ParseErrorCode }

export function extractJsonObject(text: string): string | null {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function asAction(raw: unknown): ActionKind | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  if (!ACTIONS.has(key)) return null
  return key as ActionKind
}

function asCount(raw: unknown): { ok: true; n: number } | { ok: false } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN
  if (!Number.isFinite(n)) return { ok: false }
  const i = Math.trunc(n)
  if (i < 1 || i > 6) return { ok: false }
  return { ok: true, n: i }
}

export function parseIntent(text: string): ParseIntentResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'no-json' }
  const blob = extractJsonObject(text)
  if (!blob) return { ok: false, error: 'no-json' }
  let raw: unknown
  try {
    raw = JSON.parse(blob)
  } catch {
    return { ok: false, error: 'no-json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'no-json' }
  const obj = raw as Record<string, unknown>
  const action = asAction(obj.action)
  if (!action) return { ok: false, error: 'unknown-action' }

  const intent: Intent = { action, reason: '(no reason given)' }
  if (typeof obj.reason === 'string' && obj.reason.trim().length > 0) {
    intent.reason = obj.reason.trim().slice(0, 100)
  }

  if (action === 'buy') {
    if (obj.count === undefined || obj.count === null) {
      intent.count = 1
    } else {
      const c = asCount(obj.count)
      if (!c.ok) return { ok: false, error: 'bad-count' }
      intent.count = c.n
    }
  }

  return { ok: true, intent }
}

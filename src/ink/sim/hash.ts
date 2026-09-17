import type { InkState } from './types'

/** Deterministic JSON with sorted object keys (recursive). Same spirit as src/sim. */
function stringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return 'null'
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'undefined') return 'null'
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v)).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'undefined') continue
      parts.push(JSON.stringify(k) + ':' + stringify(v))
    }
    return '{' + parts.join(',') + '}'
  }
  return 'null'
}

/** FNV-1a 32-bit hash → lowercase hex. */
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function canonicalState(state: InkState): unknown {
  return {
    tick: state.tick,
    seed: state.seed,
    seq: state.seq,
    fridges: { 'home-a': state.fridges['home-a'], 'home-b': state.fridges['home-b'] },
    minds: state.minds.map((m) => ({
      id: m.id,
      name: m.name,
      home: m.home,
      at: m.at,
      pos: { x: m.pos.x, y: m.pos.y },
      path: m.path.map((p) => ({ x: p.x, y: p.y })),
      hunger: m.hunger,
      energy: m.energy,
      social: m.social,
      money: m.money,
      busyUntilTick: m.busyUntilTick,
      asleep: m.asleep,
      current: m.current
        ? { action: m.current.action, count: m.current.count, reason: m.current.reason }
        : null,
      sufferedHours: m.sufferedHours,
    })),
  }
}

export function inkHash(state: InkState): string {
  return fnv1aHex(stringify(canonicalState(state)))
}

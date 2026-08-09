/** Deterministic JSON with sorted object keys (recursive). */
export function stableStringify(value: unknown): string {
  return stringify(value)
}

function stringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'null'
    if (!Number.isFinite(value)) return 'null'
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
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

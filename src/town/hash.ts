/**
 * Deterministic, framework-free hashing for presentation-layer variation
 * (tree jitter, building facing, construction-site clutter). Never touches
 * the sim RNG — same inputs always produce the same output, independent of
 * wall clock or draw order, so a reload always looks the same.
 */

/** 32-bit avalanche mix (murmur-ish). Deterministic for any int32 input. */
function mix32(a: number): number {
  let h = a >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Deterministic uint32 hash of two integer coords + a salt. */
export function hashTile(x: number, y: number, salt: number): number {
  // Math.imul keeps every multiply inside 32 bits — plain `*` silently loses
  // precision once operands exceed 2^53 combined, which collapsed distinct
  // tiles onto the same hash for large salts.
  const hx = Math.imul(Math.round(x) | 0, 374761393)
  const hy = Math.imul(Math.round(y) | 0, 668265263)
  const hs = Math.imul(salt | 0, 2246822519)
  const a = (hx ^ hy ^ hs) >>> 0
  return mix32(a)
}

/** [0, 1) from a tile hash. */
export function tileHash01(x: number, y: number, salt: number): number {
  return hashTile(x, y, salt) / 4294967296
}

/** Deterministic uint32 hash of a string (FNV-1a), for place ids etc. */
export function hashString(s: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return mix32(h)
}

/** [0, 1) from a string hash. */
export function stringHash01(s: string, salt = 0): number {
  return hashString(s, salt) / 4294967296
}

/**
 * A small deterministic PRNG seeded from a uint32 — for when a caller needs
 * several independent draws from one tile/id (jitter x, jitter z, variant,
 * yaw, scale …) without correlating them. Pure mulberry32; render-only.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

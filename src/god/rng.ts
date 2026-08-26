/** Tiny seeded PRNG for the god greybox. Do not import `src/sim/rng.ts`. */

export interface Rng {
  next(): number
  float(min: number, max: number): number
  int(min: number, max: number): number
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0
  if (s === 0) s = 1
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  return {
    next,
    float(min: number, max: number): number {
      return min + (max - min) * next()
    },
    int(min: number, max: number): number {
      return Math.floor(min + (max - min + 1) * next())
    },
  }
}

/** Deterministic 0..1 hash of integer lattice coords. */
export function hash01(ix: number, iz: number, seed: number): number {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1597334677)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash01(ix, iz, seed)
  const b = hash01(ix + 1, iz, seed)
  const c = hash01(ix, iz + 1, seed)
  const d = hash01(ix + 1, iz + 1, seed)
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz
}

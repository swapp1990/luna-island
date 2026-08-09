import type { Rng } from './types'

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    getState: () => a,
    setState: (s) => { a = s >>> 0 },
  }
}

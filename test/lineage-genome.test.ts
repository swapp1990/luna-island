import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import {
  LOCI,
  TRAIT_CLAUSES,
  bandOf,
  dnaText,
  offspringGenome,
  traitsOf,
} from '../src/lineage/genome'
import type { Allele, Band, Genome, TraitName, Traits } from '../src/lineage/types'
import { TRAIT_NAMES } from '../src/lineage/types'

function fillGenome(a: Allele, b: Allele): Genome {
  return {
    a: Array.from({ length: 30 }, () => a),
    b: Array.from({ length: 30 }, () => b),
  }
}

function midTraits(): Traits {
  const t = {} as Traits
  for (const n of TRAIT_NAMES) t[n] = 0.5
  return t
}

describe('lineage genome', () => {
  it('loci table is length 30 with the specified per-trait counts', () => {
    expect(LOCI.length).toBe(30)
    const counts: Record<string, number> = {}
    const modes: Record<string, string> = {}
    for (const loc of LOCI) {
      counts[loc.trait] = (counts[loc.trait] ?? 0) + 1
      modes[loc.trait] = loc.mode
    }
    expect(counts.metabolism).toBe(3)
    expect(counts.stamina).toBe(3)
    expect(counts.sociability).toBe(2)
    expect(counts.industry).toBe(3)
    expect(counts.generosity).toBe(3)
    expect(counts.voice).toBe(2)
    expect(counts.thrift).toBe(2)
    expect(counts.curiosity).toBe(2)
    expect(counts.temper).toBe(2)
    expect(counts.loyalty).toBe(3)
    expect(counts.boldness).toBe(2)
    expect(counts.caution).toBe(3)
    expect(modes.metabolism).toBe('additive')
    expect(modes.stamina).toBe('additive')
    expect(modes.sociability).toBe('additive')
    expect(modes.industry).toBe('additive')
    expect(modes.generosity).toBe('additive')
    expect(modes.voice).toBe('dominant')
    expect(modes.thrift).toBe('recessive')
    expect(modes.curiosity).toBe('additive')
    expect(modes.temper).toBe('dominant')
    expect(modes.loyalty).toBe('additive')
    expect(modes.boldness).toBe('additive')
    expect(modes.caution).toBe('recessive')
  })

  it('traitsOf modes: all-ones, all-zeros, heterozygous', () => {
    const ones = traitsOf(fillGenome(1, 1))
    const zeros = traitsOf(fillGenome(0, 0))
    const het = traitsOf(fillGenome(1, 0))
    for (const n of TRAIT_NAMES) {
      expect(ones[n]).toBe(1)
      expect(zeros[n]).toBe(0)
    }
    expect(het.metabolism).toBe(0.5)
    expect(het.stamina).toBe(0.5)
    expect(het.sociability).toBe(0.5)
    expect(het.industry).toBe(0.5)
    expect(het.generosity).toBe(0.5)
    expect(het.curiosity).toBe(0.5)
    expect(het.loyalty).toBe(0.5)
    expect(het.boldness).toBe(0.5)
    expect(het.voice).toBe(1)
    expect(het.temper).toBe(1)
    expect(het.thrift).toBe(0)
    expect(het.caution).toBe(0)
  })

  it('AA×aa at mutation 0 is heterozygous at every locus', () => {
    const rng = createRng(7)
    const aa = fillGenome(1, 1)
    const aa0 = fillGenome(0, 0)
    for (let i = 0; i < 20; i++) {
      const child = offspringGenome(aa, aa0, 0, rng)
      for (let k = 0; k < 30; k++) {
        expect(child.a[k]).toBe(1)
        expect(child.b[k]).toBe(0)
      }
    }
  })

  it('heterozygote × heterozygote over 10,000 children ≈ 1:2:1', () => {
    const rng = createRng(11)
    const het = fillGenome(1, 0)
    const n = 10_000
    let aa = 0
    let hetero = 0
    let bb = 0
    for (let i = 0; i < n; i++) {
      const child = offspringGenome(het, het, 0, rng)
      const x = child.a[0]!
      const y = child.b[0]!
      if (x === y) {
        if (x === 1) bb += 1
        else aa += 1
      } else hetero += 1
    }
    expect(Math.abs(aa / n - 0.25)).toBeLessThan(0.02)
    expect(Math.abs(hetero / n - 0.5)).toBeLessThan(0.02)
    expect(Math.abs(bb / n - 0.25)).toBeLessThan(0.02)
  })

  it('at mutation 0 every offspring allele equals a parental allele at that locus', () => {
    const rng = createRng(99)
    const p1: Genome = {
      a: Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 1 : 0) as Allele),
      b: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 1 : 0) as Allele),
    }
    const p2: Genome = {
      a: Array.from({ length: 30 }, (_, i) => (i % 2 === 1 ? 1 : 0) as Allele),
      b: Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 1 : 0) as Allele),
    }
    for (let i = 0; i < 50; i++) {
      const child = offspringGenome(p1, p2, 0, rng)
      for (let k = 0; k < 30; k++) {
        expect([p1.a[k], p1.b[k]]).toContain(child.a[k])
        expect([p2.a[k], p2.b[k]]).toContain(child.b[k])
      }
    }
  })

  it('dnaText is deterministic, ≤600 chars, 36 clauses, no advice or rooms', () => {
    const mid = midTraits()
    expect(dnaText(mid)).toBe(dnaText(mid))
    expect(dnaText(mid).length).toBeLessThanOrEqual(600)
    expect(bandOf(0)).toBe('low')
    expect(bandOf(0.33)).toBe('low')
    expect(bandOf(0.34)).toBe('mid')
    expect(bandOf(0.66)).toBe('mid')
    expect(bandOf(0.67)).toBe('high')
    // Three additive loci produce sixths: 2/6 is low, 4/6 is high, 3/6 is mid.
    expect(bandOf(2 / 6)).toBe('low')
    expect(bandOf(3 / 6)).toBe('mid')
    expect(bandOf(4 / 6)).toBe('high')

    const bands: Band[] = ['low', 'mid', 'high']
    const values: Record<Band, number> = { low: 0, mid: 0.5, high: 1 }
    const seen = new Set<string>()
    const blob: string[] = []
    for (const trait of TRAIT_NAMES) {
      for (const band of bands) {
        const t = midTraits()
        t[trait] = values[band]
        const text = dnaText(t)
        expect(text.length).toBeLessThanOrEqual(600)
        const clause = TRAIT_CLAUSES[trait as TraitName][band]
        expect(text.toLowerCase()).toContain(clause)
        expect(seen.has(clause)).toBe(false)
        seen.add(clause)
        blob.push(text)
      }
    }
    expect(seen.size).toBe(36)
    const all = blob.join('\n').toLowerCase()
    expect(all).not.toMatch(/\bshould\b/)
    expect(all).not.toMatch(/\bmust\b/)
    expect(all).not.toMatch(/\bfields\b/)
    expect(all).not.toMatch(/\bwoods\b/)
    expect(all).not.toMatch(/\bhall\b/)
    expect(all).not.toMatch(/\bhomes\b/)
    expect(all).not.toMatch(/\broad\b/)
  })
})

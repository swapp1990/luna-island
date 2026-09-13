import type { Rng } from '../sim/types'
import type { Allele, Band, Genome, LocusMode, TraitName, Traits } from './types'
import { TRAIT_NAMES } from './types'

export interface LocusSpec {
  trait: TraitName
  mode: LocusMode
}

const TRAIT_LOCI: { trait: TraitName; count: number; mode: LocusMode }[] = [
  { trait: 'metabolism', count: 3, mode: 'additive' },
  { trait: 'stamina', count: 3, mode: 'additive' },
  { trait: 'sociability', count: 2, mode: 'additive' },
  { trait: 'industry', count: 3, mode: 'additive' },
  { trait: 'generosity', count: 3, mode: 'additive' },
  { trait: 'voice', count: 2, mode: 'dominant' },
  { trait: 'thrift', count: 2, mode: 'recessive' },
  { trait: 'curiosity', count: 2, mode: 'additive' },
  { trait: 'temper', count: 2, mode: 'dominant' },
  { trait: 'loyalty', count: 3, mode: 'additive' },
  { trait: 'boldness', count: 2, mode: 'additive' },
  { trait: 'caution', count: 3, mode: 'recessive' },
]

export const LOCI: LocusSpec[] = TRAIT_LOCI.flatMap((t) =>
  Array.from({ length: t.count }, () => ({ trait: t.trait, mode: t.mode })),
)

export const LOCUS_COUNT = LOCI.length

export function locusCount(trait: TraitName): number {
  let n = 0
  for (const loc of LOCI) if (loc.trait === trait) n++
  return n
}

// Trait values are k/(2·loci); 2/3 must land in "high" and 1/3 in "low", so the
// edges are true thirds with a tolerance, not decimal 0.34/0.67.
const BAND_EPS = 1e-9
export function bandOf(t: number): Band {
  if (t <= 1 / 3 + BAND_EPS) return 'low'
  if (t >= 2 / 3 - BAND_EPS) return 'high'
  return 'mid'
}

function locusScore(a: Allele, b: Allele, mode: LocusMode): number {
  if (mode === 'additive') return (a + b) / 2
  if (mode === 'dominant') return a | b
  return a & b
}

export function traitsOf(genome: Genome): Traits {
  const sums: Record<string, { total: number; n: number }> = {}
  for (let i = 0; i < LOCI.length; i++) {
    const spec = LOCI[i]!
    const slot = sums[spec.trait] ?? { total: 0, n: 0 }
    slot.total += locusScore(genome.a[i] ?? 0, genome.b[i] ?? 0, spec.mode)
    slot.n += 1
    sums[spec.trait] = slot
  }
  const out = {} as Traits
  for (const name of TRAIT_NAMES) {
    const slot = sums[name]
    out[name] = slot && slot.n > 0 ? slot.total / slot.n : 0
  }
  return out
}

export function randomGenome(rng: Rng): Genome {
  const a: Allele[] = []
  const b: Allele[] = []
  for (let i = 0; i < LOCUS_COUNT; i++) {
    a.push(rng.next() < 0.5 ? 0 : 1)
    b.push(rng.next() < 0.5 ? 0 : 1)
  }
  return { a, b }
}

export function meiosis(genome: Genome, rng: Rng): Allele[] {
  const gamete: Allele[] = []
  for (let i = 0; i < LOCUS_COUNT; i++) {
    gamete.push(rng.next() < 0.5 ? (genome.a[i] ?? 0) : (genome.b[i] ?? 0))
  }
  return gamete
}

export function mutate(gamete: Allele[], rate: number, rng: Rng): Allele[] {
  const out: Allele[] = []
  for (let i = 0; i < gamete.length; i++) {
    const allele = gamete[i] ?? 0
    if (rate > 0 && rng.next() < rate) out.push(allele === 0 ? 1 : 0)
    else out.push(allele)
  }
  return out
}

export function offspringGenome(p1: Genome, p2: Genome, rate: number, rng: Rng): Genome {
  return {
    a: mutate(meiosis(p1, rng), rate, rng),
    b: mutate(meiosis(p2, rng), rate, rng),
  }
}

/** 12 traits × 3 bands. First-person, no advice, no world facts. */
export const TRAIT_CLAUSES: Record<TraitName, Record<Band, string>> = {
  metabolism: {
    low: 'you hunger slowly',
    mid: 'you hunger at a common pace',
    high: 'you hunger fast',
  },
  stamina: {
    low: 'you tire quickly',
    mid: 'you tire at a common pace',
    high: 'you tire slowly',
  },
  sociability: {
    low: 'you are content alone',
    mid: 'you like some company',
    high: 'you ache for company',
  },
  industry: {
    low: 'you work without hurry',
    mid: 'you work at a steady pace',
    high: 'you work with vigor',
  },
  generosity: {
    low: 'you keep what you earn',
    mid: 'you share when asked',
    high: 'you give before you are asked',
  },
  voice: {
    low: 'you speak softly',
    mid: 'you speak in a clear tone',
    high: 'you speak so all can hear',
  },
  thrift: {
    low: 'you spend what you have',
    mid: 'you save a little',
    high: 'you save more than you spend',
  },
  curiosity: {
    low: 'you keep to the known',
    mid: 'you notice what is new',
    high: 'you seek what you do not know',
  },
  temper: {
    low: 'you stay even',
    mid: 'you stir when pressed',
    high: 'you flare quickly',
  },
  loyalty: {
    low: 'you travel light of bonds',
    mid: 'you keep a few close',
    high: 'you stand by your people',
  },
  boldness: {
    low: 'you hang back',
    mid: 'you step up when needed',
    high: 'you step forward first',
  },
  caution: {
    low: 'you take little care',
    mid: 'you watch your step',
    high: 'you look twice before you move',
  },
}

const CONSTITUTION: TraitName[] = ['metabolism', 'stamina', 'sociability', 'industry']
const DISPOSITION: TraitName[] = [
  'generosity',
  'voice',
  'thrift',
  'curiosity',
  'temper',
  'loyalty',
  'boldness',
  'caution',
]

function sentenceFor(names: TraitName[], traits: Traits): string {
  const clauses = names.map((n) => TRAIT_CLAUSES[n][bandOf(traits[n])])
  const body =
    clauses.length === 1
      ? clauses[0]!
      : `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]!}`
  return body.charAt(0).toUpperCase() + body.slice(1) + '.'
}

export function dnaText(traits: Traits): string {
  return `${sentenceFor(CONSTITUTION, traits)} ${sentenceFor(DISPOSITION, traits)}`
}

export const DNA_CLAUSES = TRAIT_CLAUSES

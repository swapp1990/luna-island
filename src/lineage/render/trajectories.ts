import type { LineageRecord, TraitName } from '../types'
import { TRAIT_NAMES } from '../types'

export interface TrajectoryStats {
  traitMeansByGeneration: Record<TraitName, number[]>
  traitVarByGeneration: Record<TraitName, number[]>
}

type TraitValues = LineageRecord['traits']

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) {
    const d = x - m
    s += d * d
  }
  return s / xs.length
}

export function traitStats(lineage: LineageRecord[]): TrajectoryStats {
  let maxGen = 0
  for (const r of lineage) if (r.generation > maxGen) maxGen = r.generation
  const byGen: TraitValues[][] = []
  for (let g = 0; g <= maxGen; g++) byGen[g] = []
  for (const r of lineage) {
    byGen[r.generation]!.push(r.traits)
  }
  const traitMeansByGeneration = {} as Record<TraitName, number[]>
  const traitVarByGeneration = {} as Record<TraitName, number[]>
  for (const name of TRAIT_NAMES) {
    const means: number[] = []
    const vars: number[] = []
    for (let g = 0; g <= maxGen; g++) {
      const xs = (byGen[g] ?? []).map((t) => t[name])
      means.push(mean(xs))
      vars.push(variance(xs))
    }
    traitMeansByGeneration[name] = means
    traitVarByGeneration[name] = vars
  }
  return { traitMeansByGeneration, traitVarByGeneration }
}

function table(
  title: string,
  data: Record<TraitName, number[]>,
  gens: number,
): string {
  const heads = ['trait']
  for (let g = 0; g < gens; g++) heads.push(`gen${g}`)
  const lines = [`## ${title}`, '', `| ${heads.join(' | ')} |`, `| ${heads.map(() => '---').join(' | ')} |`]
  for (const name of TRAIT_NAMES) {
    const row = [name, ...(data[name] ?? []).map((n) => n.toFixed(2))]
    lines.push(`| ${row.join(' | ')} |`)
  }
  lines.push('')
  return lines.join('\n')
}

export function renderTrajectories(lineage: LineageRecord[]): {
  markdown: string
  traitMeansByGeneration: Record<TraitName, number[]>
  traitVarByGeneration: Record<TraitName, number[]>
} {
  const stats = traitStats(lineage)
  const gens = TRAIT_NAMES.reduce(
    (m, n) => Math.max(m, stats.traitMeansByGeneration[n]?.length ?? 0),
    0,
  )
  const markdown =
    table('Trait means by generation', stats.traitMeansByGeneration, gens) +
    table('Trait variance by generation', stats.traitVarByGeneration, gens)
  return { ...stats, markdown }
}

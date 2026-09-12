import type { Rng, SimEvent } from '../../sim/types'
import { createRng } from '../../sim/rng'
import { bandOf } from '../genome'
import type { Band, LineageConfig, LineageRecord, TraitName } from '../types'

export interface ExpressionPair {
  trait: TraitName
  act: string
  kind: 'disposition' | 'constitution'
}

export const DISPOSITION_PAIRS: readonly ExpressionPair[] = [
  { trait: 'generosity', act: 'give', kind: 'disposition' },
  { trait: 'voice', act: 'propose', kind: 'disposition' },
  { trait: 'temper', act: 'shun', kind: 'disposition' },
  { trait: 'boldness', act: 'forage', kind: 'disposition' },
  { trait: 'thrift', act: 'store', kind: 'disposition' },
  { trait: 'sociability', act: 'court', kind: 'disposition' },
  { trait: 'curiosity', act: 'new-talk', kind: 'disposition' },
  { trait: 'caution', act: 'rest', kind: 'disposition' },
]

export const CONSTITUTION_PAIRS: readonly ExpressionPair[] = [
  { trait: 'metabolism', act: 'eat', kind: 'constitution' },
  { trait: 'stamina', act: 'rest', kind: 'constitution' },
  { trait: 'sociability', act: 'talk', kind: 'constitution' },
  { trait: 'industry', act: 'work', kind: 'constitution' },
]

export interface BandStats {
  low: number
  mid: number
  high: number
}

export interface ExpressionRow {
  trait: TraitName
  act: string
  kind: 'disposition' | 'constitution'
  n: BandStats
  mean: BandStats
  slope: number
  p: number
  expressed: boolean
}

export interface ExpressionJson {
  seed: number
  expressed: number
  dispositionPairs: number
  rows: ExpressionRow[]
}

export interface ExpressionReport {
  markdown: string
  json: ExpressionJson
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

function slopeOf(bands: Band[], rates: number[]): number {
  const high: number[] = []
  const low: number[] = []
  for (let i = 0; i < bands.length; i++) {
    if (bands[i] === 'high') high.push(rates[i]!)
    else if (bands[i] === 'low') low.push(rates[i]!)
  }
  return mean(high) - mean(low)
}

function permutationP(bands: Band[], rates: number[], observed: number, rng: Rng): number {
  const labels = bands.slice()
  let count = 0
  const n = 2000
  for (let i = 0; i < n; i++) {
    shuffleInPlace(labels, rng)
    if (slopeOf(labels, rates) >= observed) count += 1
  }
  return count / n
}

interface VillagerLife {
  id: string
  traits: LineageRecord['traits']
  days: number
  acts: Record<string, number>
  newTalk: number
}

function villagerLives(
  events: readonly SimEvent[],
  lineage: readonly LineageRecord[],
): VillagerLife[] {
  const startTick = new Map<string, number>()
  const endTick = new Map<string, number>()
  for (const r of lineage) {
    if (r.generation === 0) startTick.set(r.id, 0)
  }
  for (const e of events) {
    if (e.type === 'lineage:arrive') {
      const ids = e.data?.ids
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string') startTick.set(id, e.tick)
        }
      }
    }
    if (e.type === 'villager:departed' && e.agentId) {
      if (!endTick.has(e.agentId)) endTick.set(e.agentId, e.tick)
    }
  }

  const days = new Map<string, number>()
  for (const r of lineage) days.set(r.id, 0)
  for (const e of events) {
    if (e.type !== 'day:start') continue
    for (const r of lineage) {
      const s = startTick.get(r.id)
      if (s === undefined) continue
      const d = endTick.get(r.id) ?? Infinity
      if (e.tick >= s && e.tick < d) days.set(r.id, (days.get(r.id) ?? 0) + 1)
    }
  }

  const acts = new Map<string, Record<string, number>>()
  const spokenTo = new Map<string, Set<string>>()
  const newTalk = new Map<string, number>()
  for (const r of lineage) {
    acts.set(r.id, {})
    spokenTo.set(r.id, new Set())
    newTalk.set(r.id, 0)
  }
  for (const e of events) {
    if (e.type === 'action:start' && e.agentId) {
      const kind = String(e.data?.kind ?? '')
      const rec = acts.get(e.agentId)
      if (rec) rec[kind] = (rec[kind] ?? 0) + 1
    }
    if (e.type === 'speech' && e.agentId) {
      const to = String(e.data?.to ?? '')
      if (!to) continue
      const seen = spokenTo.get(e.agentId)
      if (!seen) continue
      if (!seen.has(to)) {
        seen.add(to)
        newTalk.set(e.agentId, (newTalk.get(e.agentId) ?? 0) + 1)
      }
    }
  }

  const lives: VillagerLife[] = []
  for (const r of lineage) {
    const d = days.get(r.id) ?? 0
    if (d <= 0) continue
    lives.push({
      id: r.id,
      traits: r.traits,
      days: d,
      acts: acts.get(r.id) ?? {},
      newTalk: newTalk.get(r.id) ?? 0,
    })
  }
  return lives
}

function rateOf(life: VillagerLife, act: string): number {
  if (act === 'new-talk') return life.newTalk / life.days
  return (life.acts[act] ?? 0) / life.days
}

function rowFor(
  pair: ExpressionPair,
  lives: VillagerLife[],
  seed: number,
): ExpressionRow {
  const bands: Band[] = []
  const rates: number[] = []
  const n: BandStats = { low: 0, mid: 0, high: 0 }
  const sums: BandStats = { low: 0, mid: 0, high: 0 }
  for (const life of lives) {
    const b = bandOf(life.traits[pair.trait])
    const r = rateOf(life, pair.act)
    bands.push(b)
    rates.push(r)
    n[b] += 1
    sums[b] += r
  }
  const meanStats: BandStats = {
    low: n.low > 0 ? sums.low / n.low : 0,
    mid: n.mid > 0 ? sums.mid / n.mid : 0,
    high: n.high > 0 ? sums.high / n.high : 0,
  }
  const slope = meanStats.high - meanStats.low
  const rng = createRng(seed + 7)
  const p = permutationP(bands, rates, slope, rng)
  const expressed = slope > 0 && n.high >= 5 && n.low >= 5 && p < 0.05
  return {
    trait: pair.trait,
    act: pair.act,
    kind: pair.kind,
    n,
    mean: meanStats,
    slope,
    p,
    expressed,
  }
}

function fmt(n: number): string {
  return n.toFixed(4)
}

function table(title: string, rows: ExpressionRow[]): string {
  const lines = [
    `## ${title}`,
    '',
    '| trait | act | n_low | n_mid | n_high | mean_low | mean_mid | mean_high | slope | p | expressed |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const r of rows) {
    lines.push(
      `| ${r.trait} | ${r.act} | ${r.n.low} | ${r.n.mid} | ${r.n.high} | ${fmt(r.mean.low)} | ${fmt(r.mean.mid)} | ${fmt(r.mean.high)} | ${fmt(r.slope)} | ${fmt(r.p)} | ${r.expressed ? 'yes' : 'no'} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

export function expressionReport(
  events: readonly SimEvent[],
  lineage: readonly LineageRecord[],
  config: Pick<LineageConfig, 'seed'>,
): ExpressionReport {
  const lives = villagerLives(events, lineage)
  const disp = DISPOSITION_PAIRS.map((p) => rowFor(p, lives, config.seed))
  const cons = CONSTITUTION_PAIRS.map((p) => rowFor(p, lives, config.seed))
  const expressed = disp.filter((r) => r.expressed).length
  const json: ExpressionJson = {
    seed: config.seed,
    expressed,
    dispositionPairs: disp.length,
    rows: [...disp, ...cons],
  }
  const markdown = [
    '# Phenotype expression',
    '',
    table('Disposition', disp),
    `Expressed: ${expressed} of ${disp.length} disposition pairs`,
    '',
    table('Sanity (constitution)', cons),
  ].join('\n')
  return { markdown, json }
}

export function compareExpression(
  on: ExpressionJson,
  off: ExpressionJson,
): { markdown: string; json: { on: ExpressionJson; off: ExpressionJson } } {
  const onDisp = on.rows.filter((r) => r.kind === 'disposition')
  const offDisp = off.rows.filter((r) => r.kind === 'disposition')
  const lines = [
    '# Phenotype expression (DNA on vs off)',
    '',
    '| trait | act | slope_on | p_on | expressed_on | slope_off | p_off | expressed_off |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (let i = 0; i < onDisp.length; i++) {
    const a = onDisp[i]!
    const b = offDisp.find((r) => r.trait === a.trait && r.act === a.act) ?? offDisp[i]
    if (!b) continue
    lines.push(
      `| ${a.trait} | ${a.act} | ${fmt(a.slope)} | ${fmt(a.p)} | ${a.expressed ? 'yes' : 'no'} | ${fmt(b.slope)} | ${fmt(b.p)} | ${b.expressed ? 'yes' : 'no'} |`,
    )
  }
  lines.push('')
  lines.push(`DNA on: ${on.expressed}/${on.dispositionPairs} expressed. DNA off: ${off.expressed}/${off.dispositionPairs} expressed.`)
  lines.push('')
  return { markdown: lines.join('\n'), json: { on, off } }
}

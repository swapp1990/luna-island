import { bandOf } from '../lineage/genome'
import type { Band, LineageRecord, LineageState, TraitName, Turn, Villager } from '../lineage/types'
import { TRAIT_ORDER, TURN_NAMES } from '../lineage/types'
import { villagerNum } from '../lineage/types'
import { fullName, grain1, livingVillagers } from '../lineage/world'
import type { SimEvent } from '../sim/types'

export type LayoutName = 'single' | 'two' | 'three' | 'four'
export type FeedKind = 'act' | 'fail' | 'speech' | 'court' | 'system' | 'card'

export interface FeedEntry {
  key: string
  kind: FeedKind
  actorId?: string
  actorName: string
  targetId?: string
  targetName?: string
  title: string
  reason?: string
  text?: string
  clickIds: string[]
}

export interface TreeNode {
  id: string
  name: string
  label: string
  generation: number
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  living: boolean
  highlighted: boolean
  glow: boolean
  founder: boolean
}

export interface TreeEdge {
  d: string
}

export interface TreeLayout {
  nodes: TreeNode[]
  edges: TreeEdge[]
  width: number
  height: number
}

export interface Sparkline {
  trait: TraitName
  values: number[]
  delta: number
  arrow: 'up' | 'down' | null
}

export interface HeatRow {
  id: string
  name: string
  bands: Band[]
}

const NODE_H = 24
const ROW_H = 48
const TREE_PAD = 6
const TREE_GUTTER = 20

export const SPEED_MS: Record<1 | 8 | 64, number> = {
  1: 1500,
  8: 190,
  64: 23,
}

export const TRAIT_HEADERS = TRAIT_ORDER.map((n) => n.slice(0, 3))

export function layoutForWidth(width: number): LayoutName {
  if (width <= 719) return 'single'
  if (width <= 1599) return 'two'
  if (width <= 2399) return 'three'
  return 'four'
}

export function monogramLetters(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase()
  }
  const s = parts[0] ?? '?'
  return s.slice(0, 2).toUpperCase() || '?'
}

export function monogramColor(id: string): string {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = (h >>> 0) % 360
  return `hsl(${hue} 20% 30%)`
}

interface NameRec {
  given: string
  full: string
}

export function nameMap(state: LineageState): Map<string, NameRec> {
  const m = new Map<string, NameRec>()
  for (const r of state.lineage) m.set(r.id, { given: r.givenName, full: fullName(r) })
  for (const v of state.villagers) m.set(v.id, { given: v.givenName, full: fullName(v) })
  return m
}

function who(names: Map<string, NameRec>, id: string | undefined): NameRec {
  if (!id) return { given: '?', full: '?' }
  return names.get(id) ?? { given: id, full: id }
}

function reasonOf(e: SimEvent): string {
  return typeof e.reason === 'string' && e.reason.length > 0 ? e.reason : ''
}

function actTitle(
  names: Map<string, NameRec>,
  start: SimEvent,
  end: SimEvent | undefined,
): { title: string; fail: boolean } {
  const kind = String(start.data?.kind ?? 'idle')
  const actor = who(names, start.agentId)
  const fail = end?.type === 'action:fail'
  const failWhy = fail ? String(end?.reason ?? end?.data?.reason ?? 'it cannot be done') : ''
  const d = (end?.data ?? {}) as Record<string, unknown>
  const targetId = String(start.data?.target ?? d.target ?? '')
  const target = who(names, targetId)
  if (fail) return { title: `${actor.full} fails to ${kind} (${failWhy})`, fail: true }
  switch (kind) {
    case 'work':
      return { title: `${actor.full} works the fields (+${grain1(Number(d.grainDelta ?? 0))} grain)`, fail: false }
    case 'forage':
      return {
        title: d.found
          ? `${actor.full} forages the woods (+1.0 grain)`
          : `${actor.full} forages the woods (nothing)`,
        fail: false,
      }
    case 'rest':
      return { title: `${actor.full} rests`, fail: false }
    case 'eat':
      return { title: `${actor.full} eats (1 meal)`, fail: false }
    case 'store':
      return { title: `${actor.full} stores ${grain1(Number(d.amount ?? 0))} grain`, fail: false }
    case 'withdraw':
      return { title: `${actor.full} withdraws ${grain1(Number(d.amount ?? 0))} grain`, fail: false }
    case 'give':
      return {
        title: `${actor.full} gives ${grain1(Number(d.amount ?? start.data?.amount ?? 1))} grain to ${target.full}`,
        fail: false,
      }
    case 'talk':
      return { title: `${actor.full} talks to ${target.full}`, fail: false }
    case 'court':
      return { title: `${actor.full} courts ${target.full}`, fail: false }
    case 'propose':
      return { title: `${actor.full} proposes ${String(start.data?.rule ?? d.rule ?? 'a rule')}`, fail: false }
    case 'vote':
      return { title: `${actor.full} votes ${String(start.data?.choice ?? d.choice ?? '')}`, fail: false }
    case 'shun':
      return { title: `${actor.full} shuns ${target.full}`, fail: false }
    default:
      return { title: `${actor.full} idles`, fail: false }
  }
}

function lookEnd(events: readonly SimEvent[], i: number, agentId: string | undefined): SimEvent | undefined {
  for (let j = i + 1; j < events.length; j++) {
    const n = events[j]!
    if (n.agentId === agentId && (n.type === 'action:end' || n.type === 'action:fail')) return n
    if (n.type === 'turn:start' || n.type === 'day:start') break
  }
  return undefined
}

export function feedEntries(events: readonly SimEvent[], state: LineageState): FeedEntry[] {
  const names = nameMap(state)
  const out: FeedEntry[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const t = e.type
    if (t === 'action:start') {
      const kind = String(e.data?.kind ?? '')
      if (kind === 'talk' || kind === 'court') continue
      const end = lookEnd(events, i, e.agentId)
      const { title, fail } = actTitle(names, e, end)
      const actor = who(names, e.agentId)
      const targetId = String(e.data?.target ?? end?.data?.target ?? '')
      out.push({
        key: `act-${e.seq}`,
        kind: fail ? 'fail' : 'act',
        actorId: e.agentId,
        actorName: actor.full,
        targetId: targetId || undefined,
        targetName: targetId ? who(names, targetId).full : undefined,
        title,
        reason: reasonOf(e),
        clickIds: [e.agentId, targetId].filter((id): id is string => !!id && names.has(id)),
      })
      continue
    }
    if (t === 'action:fail') {
      // paired with action:start; skip if we already rendered the start as fail
      continue
    }
    if (t === 'speech') {
      const a = who(names, e.agentId)
      const to = String(e.data?.to ?? '')
      const b = who(names, to)
      out.push({
        key: `speech-${e.seq}`,
        kind: 'speech',
        actorId: e.agentId,
        actorName: a.full,
        targetId: to || undefined,
        targetName: b.full,
        title: `${a.full} → ${b.full}`,
        text: String(e.data?.text ?? ''),
        clickIds: [e.agentId, to].filter((id): id is string => !!id && names.has(id)),
      })
      continue
    }
    if (t === 'court') {
      const a = who(names, e.agentId)
      const to = String(e.data?.to ?? '')
      const b = who(names, to)
      out.push({
        key: `court-${e.seq}`,
        kind: 'court',
        actorId: e.agentId,
        actorName: a.full,
        targetId: to || undefined,
        targetName: b.full,
        title: `${a.full} courts ${b.full}`,
        clickIds: [e.agentId, to].filter((id): id is string => !!id && names.has(id)),
      })
      continue
    }
    if (t === 'villager:starving') {
      const a = who(names, e.agentId)
      out.push({
        key: `starve-${e.seq}`,
        kind: 'system',
        actorId: e.agentId,
        actorName: a.full,
        title: `${a.full} is starving`,
        clickIds: e.agentId ? [e.agentId] : [],
      })
      continue
    }
    if (t === 'villager:departed') {
      const a = who(names, e.agentId)
      const why = String(e.reason ?? e.data?.reason ?? '')
      out.push({
        key: `depart-${e.seq}`,
        kind: 'system',
        actorId: e.agentId,
        actorName: a.full,
        title: `${a.full} departs`,
        reason: why,
        clickIds: e.agentId ? [e.agentId] : [],
      })
      continue
    }
    if (t === 'lineage:born') {
      const child = who(names, String(e.data?.id ?? e.agentId ?? ''))
      out.push({
        key: `born-${e.seq}`,
        kind: 'card',
        actorId: String(e.data?.id ?? e.agentId ?? ''),
        actorName: child.full,
        title: `${child.full} is born (generation ${String(e.data?.generation ?? '')})`,
        clickIds: child.full !== '?' ? [String(e.data?.id ?? e.agentId ?? '')] : [],
      })
      continue
    }
    if (t === 'lineage:arrive') {
      out.push({
        key: `arrive-${e.seq}`,
        kind: 'card',
        actorName: '',
        title: 'The new cohort arrives by the road',
        clickIds: [],
      })
      continue
    }
    if (t === 'generation:turnover') {
      out.push({
        key: `turn-${e.seq}`,
        kind: 'card',
        actorName: '',
        title: `Generation turnover: ${String(e.data?.born ?? 0)} born into generation ${String(e.data?.generation ?? '')}`,
        clickIds: [],
      })
      continue
    }
    if (t === 'rule:enacted') {
      out.push({
        key: `rule-${e.seq}`,
        kind: 'card',
        actorName: '',
        title: `Rule enacted: ${String(e.data?.rule ?? '')}`,
        clickIds: [],
      })
      continue
    }
    if (t === 'proposal:open') {
      const a = who(names, e.agentId)
      out.push({
        key: `popen-${e.seq}`,
        kind: 'card',
        actorId: e.agentId,
        actorName: a.full,
        title: `${a.full} opens a proposal (${String(e.data?.rule ?? '')})`,
        text: String(e.data?.text ?? ''),
        clickIds: e.agentId ? [e.agentId] : [],
      })
      continue
    }
    if (t === 'proposal:resolved') {
      out.push({
        key: `pres-${e.seq}`,
        kind: 'card',
        actorName: '',
        title: `Proposal ${String(e.data?.id ?? '')} is ${String(e.data?.result ?? '')}`,
        clickIds: [],
      })
    }
  }
  return out.length > 200 ? out.slice(out.length - 200) : out
}

export function tickerLine(state: LineageState): string {
  const rule = state.rules.join(', ') || 'none'
  return `granary ${grain1(state.granary)} · harvest ${grain1(state.config.harvestYield)} · rule: ${rule}`
}

export function statusLeft(state: LineageState): string {
  const turnName = TURN_NAMES[state.turn] ?? 'dawn'
  return `Season ${state.season + 1} · Day ${state.day + 1} · ${turnName}`
}

export function statusRight(state: LineageState): string {
  const living = livingVillagers(state)
  const gen = living.reduce((g, v) => Math.max(g, v.generation), 0)
  return `${living.length} alive · gen ${gen}`
}

export function seasonProgress(state: LineageState): number {
  const days = Math.max(1, state.config.daysPerSeason)
  const turns = Math.max(1, state.config.turnsPerDay)
  const pos = state.day * turns + state.turn
  return Math.min(1, Math.max(0, pos / (days * turns)))
}

export function currentActFor(
  events: readonly SimEvent[],
  villager: Villager,
  state: LineageState,
): { title: string; reason: string } | null {
  const names = nameMap(state)
  let last: { title: string; reason: string } | null = null
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (e.type !== 'action:start' || e.agentId !== villager.id) continue
    const end = lookEnd(events, i, e.agentId)
    const { title } = actTitle(names, e, end)
    last = { title, reason: reasonOf(e) }
  }
  return last
}

export function parentLine(v: Villager | LineageRecord, lineage: readonly LineageRecord[]): string {
  if (!v.parents) return `generation ${v.generation} · founder`
  const p1 = lineage.find((r) => r.id === v.parents![0])
  const p2 = lineage.find((r) => r.id === v.parents![1])
  const n1 = p1 ? fullName(p1) : v.parents[0]
  const n2 = p2 ? fullName(p2) : v.parents[1]
  return `generation ${v.generation} · child of ${n1} and ${n2}`
}

export function heatRows(state: LineageState): HeatRow[] {
  return livingVillagers(state).map((v) => ({
    id: v.id,
    name: fullName(v),
    bands: TRAIT_ORDER.map((t) => bandOf(v.traits[t])),
  }))
}

function cohortMean(state: LineageState, trait: TraitName): number {
  const living = state.villagers.filter((v) => v.status === 'alive')
  if (living.length === 0) return 0
  return living.reduce((acc, v) => acc + v.traits[trait], 0) / living.length
}

export function driftSparklines(snapshots: readonly LineageState[], upToTurn: number): Sparkline[] {
  const traits: TraitName[] = ['metabolism', 'industry', 'generosity', 'voice']
  const last = Math.min(Math.max(0, upToTurn), Math.max(0, snapshots.length - 1))
  const seen = new Set<number>()
  const starts: LineageState[] = []
  for (let i = 0; i <= last; i++) {
    const s = snapshots[i]
    if (!s) continue
    if (s.day !== 0 || s.turn !== 0 || seen.has(s.season)) continue
    seen.add(s.season)
    starts.push(s)
  }
  const cur = snapshots[last]
  if (cur && starts[starts.length - 1] !== cur) starts.push(cur)
  return traits.map((t) => {
    const values = starts.map((s) => cohortMean(s, t))
    const delta = values.length >= 2 ? values[values.length - 1]! - values[0]! : 0
    const arrow: Sparkline['arrow'] =
      Math.abs(delta) >= 0.05 ? (delta > 0 ? 'up' : 'down') : null
    return { trait: t, values, delta, arrow }
  })
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function placeNormalized(ideals: number[]): number[] {
  const n = ideals.length
  if (n === 0) return []
  if (n === 1) return [clamp01(ideals[0] ?? 0.5)]
  const minGap = 1 / (n - 1)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const minX = i === 0 ? 0 : out[i - 1]! + minGap
    const maxX = 1 - (n - 1 - i) * minGap
    out.push(Math.min(maxX, Math.max(minX, clamp01(ideals[i]!))))
  }
  return out
}

function pillLabel(r: LineageRecord, pillW: number, rowN: number): { label: string; fontSize: number } {
  const full = `${r.givenName} ${r.surname}`
  const abbr = `${r.givenName.slice(0, 2)}. ${r.surname}`
  if (rowN > 14) return { label: abbr, fontSize: 11 }
  if (pillW < 40) return { label: `${r.givenName.charAt(0)}${r.surname.charAt(0)}`, fontSize: 10 }
  if (pillW < 88) return { label: abbr, fontSize: 11 }
  return { label: full, fontSize: 12 }
}

export function layoutTree(
  lineage: readonly LineageRecord[],
  livingIds: ReadonlySet<string>,
  highlightId: string | null,
  widthPx = 1000,
): TreeLayout {
  const byGen = new Map<number, LineageRecord[]>()
  let maxGen = 0
  for (const r of lineage) {
    maxGen = Math.max(maxGen, r.generation)
    const list = byGen.get(r.generation) ?? []
    list.push(r)
    byGen.set(r.generation, list)
  }
  const maxCount = Math.max(1, ...[...byGen.values()].map((row) => row.length))
  const vbW = Math.max(120, widthPx)
  const inner = Math.max(40, vbW - TREE_PAD * 2 - TREE_GUTTER)
  const gap = maxCount > 14 ? 3 : 4
  const pillW = Math.max(28, inner / maxCount - gap)
  const nx = new Map<string, number>()
  const g0 = (byGen.get(0) ?? []).slice().sort((a, b) => villagerNum(a.id) - villagerNum(b.id))
  const g0n = g0.length
  placeNormalized(g0.map((_, i) => (g0n <= 1 ? 0.5 : i / (g0n - 1)))).forEach((x, i) => {
    nx.set(g0[i]!.id, x)
  })
  for (let g = 1; g <= maxGen; g++) {
    const kids = (byGen.get(g) ?? []).slice()
    const items = kids.map((r) => {
      const parents = r.parents ?? ['', '']
      const x1 = nx.get(parents[0]) ?? 0.5
      const x2 = nx.get(parents[1]) ?? x1
      return { r, ideal: (x1 + x2) / 2 }
    })
    items.sort((a, b) => a.ideal - b.ideal || villagerNum(a.r.id) - villagerNum(b.r.id))
    placeNormalized(items.map((it) => it.ideal)).forEach((x, i) => {
      nx.set(items[i]!.r.id, x)
    })
  }
  const livingGen = livingIds.size
    ? Math.max(
        0,
        ...lineage.filter((r) => livingIds.has(r.id)).map((r) => r.generation),
      )
    : maxGen
  const nodes: TreeNode[] = []
  for (const r of lineage) {
    const t = nx.get(r.id)
    if (t === undefined) continue
    const rowN = (byGen.get(r.generation) ?? []).length
    const { label, fontSize } = pillLabel(r, pillW, rowN)
    const cx = TREE_GUTTER + TREE_PAD + pillW / 2 + t * (inner - pillW)
    nodes.push({
      id: r.id,
      name: fullName(r),
      label,
      generation: r.generation,
      x: cx - pillW / 2,
      y: TREE_PAD + r.generation * ROW_H,
      w: pillW,
      h: NODE_H,
      fontSize,
      living: livingIds.has(r.id),
      highlighted: highlightId === r.id,
      glow: r.generation === livingGen,
      founder: r.parents == null,
    })
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const edges: TreeEdge[] = []
  for (const r of lineage) {
    if (!r.parents) continue
    const child = nodeById.get(r.id)
    if (!child) continue
    const p0 = nodeById.get(r.parents[0])
    const p1 = nodeById.get(r.parents[1])
    if (!p0 || !p1) continue
    const c0x = p0.x + p0.w / 2
    const c1x = p1.x + p1.w / 2
    const cy = child.x + child.w / 2
    const p0y = p0.y + p0.h
    const p1y = p1.y + p1.h
    const mx = (c0x + c1x) / 2
    const my = (Math.max(p0y, p1y) + child.y) / 2
    edges.push({
      d: `M ${c0x.toFixed(1)} ${p0y} L ${mx.toFixed(1)} ${my} L ${cy.toFixed(1)} ${child.y}`,
    })
    edges.push({
      d: `M ${c1x.toFixed(1)} ${p1y} L ${mx.toFixed(1)} ${my} L ${cy.toFixed(1)} ${child.y}`,
    })
  }
  return {
    nodes,
    edges,
    width: vbW,
    height: TREE_PAD * 2 + (maxGen + 1) * ROW_H,
  }
}

export function sparkPath(values: number[], w: number, h: number): string {
  const pts = values.length === 0 ? [0, 0] : values.length === 1 ? [values[0]!, values[0]!] : values
  const min = Math.min(...pts, 0)
  const max = Math.max(...pts, 1)
  const span = max - min || 1
  const pad = 2
  const innerH = Math.max(1, h - pad * 2)
  const step = pts.length <= 1 ? 0 : w / (pts.length - 1)
  return pts
    .map((v, i) => {
      const x = i * step
      const y = pad + innerH - ((v - min) / span) * innerH
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function livingList(state: LineageState): Villager[] {
  return livingVillagers(state)
}

export function turnName(turn: Turn): string {
  return TURN_NAMES[turn] ?? 'dawn'
}

export { fullName, grain1, TRAIT_ORDER }

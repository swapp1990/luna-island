/** Per-agent world-model — derived only from felt history, examines, and heard says. */

import { blockedFeltLine, PLACE_VIEW_RADIUS, placeKindLabel } from '../sim/examine'
import type { AgentState, MindNoteRecord, Place, SimEvent, WorldState } from '../sim/types'

/** Last ~12 sim-hours. */
export const FELT_WINDOW_TICKS = 12 * 60
export const FELT_MAX_LINES = 5
export const KNOWN_MAX_LINES = 6

export interface KnowledgeFact {
  text: string
  source: 'examine' | 'learned' | 'told' | 'felt'
  tick: number
}

function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100)
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Cause→effect lines from this agent's own recent events (most recent first). */
export function feltConsequenceLines(
  agentId: string,
  events: readonly SimEvent[],
  nowTick: number,
  maxLines = FELT_MAX_LINES,
): string[] {
  const since = nowTick - FELT_WINDOW_TICKS
  const lines: string[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.tick < since) break
    if (e.agentId !== agentId && !(e.type === 'coins:transfer' && e.data?.to === agentId)) {
      continue
    }
    const line = feltLineFromEvent(e, agentId)
    if (!line) continue
    lines.push(line)
    if (lines.length >= maxLines) break
  }
  return lines
}

export function feltLineFromEvent(e: SimEvent, agentId: string): string | null {
  if (typeof e.data?.felt === 'string' && e.data.felt.length > 0) {
    return e.data.felt
  }

  if (e.type === 'action:end') {
    const kind = String(e.data?.kind ?? '')
    const before = num(e.data?.before)
    const after = num(e.data?.after)
    if (kind === 'eat' && before != null && after != null) {
      return `ate berries: hunger ${pct(before)}%→${pct(after)}%`
    }
    if (kind === 'drink' && before != null && after != null) {
      const delta = Math.round((after - before) * 100)
      if (delta !== 0 && Math.abs(after - before) < 0.15) {
        return `drank at the well: energy ${delta >= 0 ? '+' : ''}${delta}%`
      }
      return `drank at the well: energy ${pct(before)}%→${pct(after)}%`
    }
    if (kind === 'sleep' && before != null && after != null) {
      const shelter = e.data?.shelter === 'bed' ? 'in your bed' : 'on the ground'
      return `slept ${shelter}: energy ${pct(before)}%→${pct(after)}%`
    }
  }

  if (e.type === 'construction:commission-refused') {
    const kind = String(e.data?.kind ?? 'home')
    const why = String(e.data?.why ?? '')
    if (why) return `could not commission a ${kind} — ${why}`
    return `could not commission a ${kind}`
  }

  if (e.type === 'coins:transfer') {
    const amount = num(e.data?.amount)
    if (amount == null || amount <= 0) return null
    if (e.data?.to !== agentId) return null
    if (e.data?.kind !== 'wage') return null
    const placeKind = String(e.data?.placeKind ?? 'workplace')
    return `worked the ${placeKind}: +${amount} coins at day's end`
  }

  if (e.type === 'place:blocked') {
    const label = placeKindLabel(String(e.data?.placeKind ?? 'place'))
    const ownerId = e.data?.ownerId
    const ownerName = typeof e.data?.ownerName === 'string' ? e.data.ownerName : ''
    const exclusive =
      !!ownerName &&
      typeof ownerId === 'string' &&
      ownerId !== 'commons' &&
      ownerId !== agentId
    const rawNames = e.data?.occupantNames
    const occupantNames = Array.isArray(rawNames)
      ? rawNames.filter((n): n is string => typeof n === 'string' && n.length > 0)
      : []
    return blockedFeltLine({
      label,
      occupantNames,
      ownerName: exclusive ? ownerName : undefined,
      onlySpot: e.data?.onlySpot === true || e.data?.placeKind === 'spring',
    })
  }

  return null
}

function examinedFacts(agentId: string, events: readonly SimEvent[]): KnowledgeFact[] {
  const out: KnowledgeFact[] = []
  for (const e of events) {
    if (e.type !== 'discovery:examined' || e.agentId !== agentId) continue
    const knowledge = String(e.data?.knowledge ?? '').trim()
    if (!knowledge) continue
    out.push({ text: knowledge, source: 'examine', tick: e.tick })
  }
  return out
}

function toldFacts(agentId: string, events: readonly SimEvent[]): KnowledgeFact[] {
  const out: KnowledgeFact[] = []
  for (const e of events) {
    if (e.type !== 'mind:say') continue
    if (e.data?.partnerId !== agentId) continue
    if (e.agentId === agentId) continue
    const raw = String(e.data?.text ?? '').trim()
    if (!raw) continue
    const who = String(e.data?.agentName ?? e.agentId ?? 'someone')
    out.push({
      text: `${who} told me: "${clip(raw, 80)}"`,
      source: 'told',
      tick: e.tick,
    })
  }
  return out
}

function learnedFacts(
  agentId: string,
  mindNoteLog: readonly MindNoteRecord[],
): KnowledgeFact[] {
  const out: KnowledgeFact[] = []
  for (const rec of mindNoteLog) {
    if (rec.agentId !== agentId) continue
    for (const fact of rec.learned ?? []) {
      const text = fact.trim()
      if (!text) continue
      out.push({ text, source: 'learned', tick: rec.tick })
    }
  }
  return out
}

function feltFacts(agentId: string, events: readonly SimEvent[]): KnowledgeFact[] {
  const out: KnowledgeFact[] = []
  for (const e of events) {
    const line = feltLineFromEvent(e, agentId)
    if (!line) continue
    if (e.agentId !== agentId && !(e.type === 'coins:transfer' && e.data?.to === agentId)) {
      continue
    }
    out.push({ text: line, source: 'felt', tick: e.tick })
  }
  return out
}

const SOURCE_RANK: Record<KnowledgeFact['source'], number> = {
  examine: 0,
  learned: 1,
  told: 2,
  felt: 3,
}

/**
 * Deterministic Known lines: examine + learned + told + felt, newest first,
 * unique by text, up to `maxLines`.
 */
export function compileKnowledge(
  agentId: string,
  events: readonly SimEvent[],
  mindNoteLog: readonly MindNoteRecord[],
): KnowledgeFact[] {
  const all = [
    ...examinedFacts(agentId, events),
    ...learnedFacts(agentId, mindNoteLog),
    ...toldFacts(agentId, events),
    ...feltFacts(agentId, events),
  ]
  all.sort((a, b) => {
    const rk = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    if (rk !== 0) return rk
    if (a.tick !== b.tick) return b.tick - a.tick
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0
  })
  const seen = new Set<string>()
  const out: KnowledgeFact[] = []
  for (const f of all) {
    if (seen.has(f.text)) continue
    seen.add(f.text)
    out.push(f)
  }
  return out
}

export function knowledgeLinesForPrompt(
  agentId: string,
  events: readonly SimEvent[],
  mindNoteLog: readonly MindNoteRecord[],
  maxLines = KNOWN_MAX_LINES,
): string[] {
  return compileKnowledge(agentId, events, mindNoteLog)
    .slice(0, maxLines)
    .map((f) => f.text)
}

export function usedOrExaminedPlaceIds(
  agentId: string,
  events: readonly SimEvent[],
): Set<string> {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.agentId !== agentId) continue
    if (e.type === 'discovery:examined') {
      const t = e.data?.target
      if (typeof t === 'string' && t.length > 0) ids.add(t)
    }
    if (e.type === 'action:start') {
      const t = e.data?.target
      if (typeof t === 'string' && t.length > 0 && !/^\d+,\d+$/.test(t)) ids.add(t)
      const pid = e.data?.placeId
      if (typeof pid === 'string' && pid.length > 0) ids.add(pid)
    }
  }
  return ids
}

export function noticedKinds(agentId: string, events: readonly SimEvent[]): Set<string> {
  const kinds = new Set<string>()
  for (const e of events) {
    if (e.type !== 'discovery:noticed' || e.agentId !== agentId) continue
    const kind = String(e.data?.kind ?? '')
    if (kind) kinds.add(kind)
  }
  return kinds
}

export interface NearbyPlaceLine {
  place: Place
  unfamiliar: boolean
  dist2: number
  /** Private owner's display name when the place is not commons. */
  ownerName?: string | null
}

/** P4-7 private-place name; null for commons or unknown owner. */
export function privateOwnerName(placeId: string, world: WorldState): string | null {
  const ownerId = world.owners?.[placeId]
  if (!ownerId || ownerId === 'commons') return null
  return world.agents.find((a) => a.id === ownerId)?.name ?? null
}

/** Places within view, tagged unfamiliar when never examined or used. */
export function nearbyPlacesForObservation(
  agent: AgentState,
  world: WorldState,
  events: readonly SimEvent[],
  radius = PLACE_VIEW_RADIUS,
): NearbyPlaceLine[] {
  const r2 = radius * radius
  const known = usedOrExaminedPlaceIds(agent.id, events)
  const out: NearbyPlaceLine[] = []
  for (const p of world.places) {
    const dx = p.x - agent.x
    const dy = p.y - agent.y
    const d = dx * dx + dy * dy
    if (d > r2) continue
    out.push({
      place: p,
      unfamiliar: !known.has(p.id),
      dist2: d,
      ownerName: privateOwnerName(p.id, world),
    })
  }
  out.sort((a, b) => {
    if (a.dist2 !== b.dist2) return a.dist2 - b.dist2
    return a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0
  })
  return out.slice(0, 8)
}

const STOCK_GOODS = ['food', 'wood', 'stone'] as const

/** Compact inventory phrase from actual goods. All-zero → `empty`. */
export function formatPlaceStock(inventory: Place['inventory'] | undefined): string {
  const inv = inventory ?? { food: 0, wood: 0, stone: 0 }
  const parts: string[] = []
  for (const good of STOCK_GOODS) {
    const n = inv[good] ?? 0
    if (n > 0) parts.push(`${n} ${good}`)
  }
  return parts.length > 0 ? parts.join(', ') : 'empty'
}

function stockAndOwnerInner(inventory: Place['inventory'] | undefined, ownerName?: string | null): string {
  const stock = formatPlaceStock(inventory)
  return ownerName ? `${stock}, ${ownerName}'s` : stock
}

function nearbyPlaceInner(place: Place, ownerName?: string | null): string {
  const bits: string[] = []
  const lv = place.level ?? 1
  if (lv > 1) bits.push(`lv ${lv}`)
  bits.push(stockAndOwnerInner(place.inventory, ownerName))
  return bits.join(', ')
}

export function formatNearbyPlaceLine(row: NearbyPlaceLine): string {
  const label = placeKindLabel(row.place.kind)
  const inner = nearbyPlaceInner(row.place, row.ownerName)
  const base = `${label} (${inner})`
  return row.unfamiliar ? `${base} (unfamiliar)` : base
}

/** 8-way compass from agent to a point. Tile y increases south. */
export function compass8(dx: number, dy: number): string {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 'here'
  const angle = Math.atan2(-dy, dx)
  const deg = ((angle * 180) / Math.PI + 360) % 360
  const idx = Math.round(deg / 45) % 8
  return ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][idx]!
}

/**
 * Plain distance+direction fact for an unexamined place. No editorial nudge.
 * Adds "on the plaza" when the place sits on/next to the plaza.
 */
export function formatUnfamiliarPlaceFact(
  agent: AgentState,
  place: Place,
  world: WorldState,
): string {
  const dx = place.x - agent.x
  const dy = place.y - agent.y
  const dist = Math.round(Math.hypot(dx, dy))
  const dir = compass8(dx, dy)
  const plaza = world.places.find((p) => p.kind === 'plaza')
  const onPlaza =
    !!plaza &&
    Math.max(Math.abs(place.x - plaza.x), Math.abs(place.y - plaza.y)) <= 2
  const where =
    dir === 'here'
      ? onPlaza
        ? 'here, on the plaza'
        : 'here'
      : onPlaza
        ? `${dist} tiles ${dir}, on the plaza`
        : `${dist} tiles ${dir}`
  const inner = nearbyPlaceInner(place, privateOwnerName(place.id, world))
  return `${place.kind} (${where}; ${inner})`
}

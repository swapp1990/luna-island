/**
 * Pure moment registry + selection for highlight reels.
 * No DOM / three / browser APIs — vitest-safe.
 */

import { placeKindLabel } from '../sim/examine'
import { toSimTime } from '../sim/time'
import type { SimEvent, WorldState } from '../sim/types'

/** Higher = more reel-worthy. */
export const PRIORITY = {
  institution: 100,
  discovery: 80,
  constructionCompleted: 80,
  ownershipFirstPrivate: 80,
  constructionCommissioned: 50,
  collapse: 50,
  relationship: 50,
  mindSay: 20,
} as const

export interface HighlightMoment {
  tick: number
  type: string
  priority: number
  agentIds: string[]
  placeId?: string
  caption: string
  subtitle?: string
}

export interface HighlightNameResolver {
  /** Resolve agent display name; never return raw id if a name is known. */
  agentName: (id: string) => string
  placeKind?: (placeId: string) => string | undefined
}

const INSTITUTION_TYPES = new Set([
  'institution:proposed',
  'institution:voted',
  'institution:closed',
  'institution:sanctioned',
  'institution:claimed',
])

function str(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = data?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = data?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function resolveName(
  id: string | undefined,
  data: Record<string, unknown> | undefined,
  dataKey: string,
  names: HighlightNameResolver,
): string {
  if (!id) return str(data, dataKey) ?? 'Someone'
  const fromData = str(data, dataKey)
  if (fromData) return fromData
  return names.agentName(id)
}

function kindLabel(kind: string | undefined): string {
  if (!kind) return 'place'
  return placeKindLabel(kind)
}

/**
 * Declarative captions from event payload only — no invented detail.
 */
export function captionForEvent(
  e: SimEvent,
  names: HighlightNameResolver,
): { caption: string; subtitle?: string; agentIds: string[]; placeId?: string } | null {
  const data = (e.data ?? {}) as Record<string, unknown>
  const type = e.type

  if (type === 'discovery:examined') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const kind = str(data, 'placeKind')
    const placeId = str(data, 'target')
    return {
      caption: `${name} examines the ${kindLabel(kind)}`,
      subtitle: str(data, 'knowledge'),
      agentIds: agentId ? [agentId] : [],
      placeId,
    }
  }

  if (type === 'institution:proposed') {
    const agentId = e.agentId ?? str(data, 'proposerId') ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const text = str(data, 'text')
    return {
      caption: `${name} proposes a rule`,
      subtitle: text ? `"${text}"` : undefined,
      agentIds: agentId ? [agentId] : [],
    }
  }

  if (type === 'institution:voted') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const choice = str(data, 'choice') ?? 'yes'
    return {
      caption: `${name} votes ${choice}`,
      agentIds: agentId ? [agentId] : [],
    }
  }

  if (type === 'institution:closed') {
    const status = str(data, 'status') ?? 'closed'
    const text = str(data, 'text')
    const yes = num(data, 'yes')
    const no = num(data, 'no')
    const tally =
      yes != null && no != null ? ` (${yes}–${no})` : ''
    const verb = status === 'passed' ? 'passes' : status === 'failed' ? 'fails' : 'closes'
    return {
      caption: `A proposal ${verb}${tally}`,
      subtitle: text ? `"${text}"` : undefined,
      agentIds: e.agentId ? [e.agentId] : [],
    }
  }

  if (type === 'institution:sanctioned') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const targetId = str(data, 'targetId')
    const targetName = resolveName(targetId, data, 'targetName', names)
    const reason = str(data, 'reason')
    return {
      caption: `${name} sanctions ${targetName}`,
      subtitle: reason ? `"${reason}"` : undefined,
      agentIds: [agentId, targetId].filter(Boolean) as string[],
    }
  }

  if (type === 'institution:claimed') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const kind = str(data, 'placeKind')
    const placeId = str(data, 'placeId')
    return {
      caption: `${name} claims the ${kindLabel(kind)}`,
      agentIds: agentId ? [agentId] : [],
      placeId,
    }
  }

  if (type === 'construction:commissioned') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const placeId = str(data, 'placeId')
    return {
      caption: `${name} commissions a house`,
      agentIds: agentId ? [agentId] : [],
      placeId,
    }
  }

  if (type === 'construction:completed') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const placeId = str(data, 'placeId')
    return {
      caption: `${name}'s house is finished`,
      agentIds: agentId ? [agentId] : [],
      placeId,
    }
  }

  if (type === 'ownership:transfer') {
    const firstPrivate = data.firstPrivate === true
    if (!firstPrivate) return null
    const to = str(data, 'to')
    const placeId = str(data, 'placeId')
    const name = to && to !== 'commons' ? names.agentName(to) : 'Someone'
    return {
      caption: `${name} owns private land`,
      agentIds: to && to !== 'commons' ? [to] : [],
      placeId,
    }
  }

  if (type === 'agent:collapsed') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    return {
      caption: `${name} collapses from hunger`,
      agentIds: agentId ? [agentId] : [],
    }
  }

  if (type === 'agent:recovered') {
    const agentId = e.agentId ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    return {
      caption: `${name} recovers`,
      agentIds: agentId ? [agentId] : [],
    }
  }

  if (type === 'relationship:close') {
    const idA = str(data, 'agentIdA') ?? e.agentId ?? ''
    const idB = str(data, 'agentIdB') ?? ''
    const nameA = resolveName(idA, data, 'nameA', names)
    const nameB = resolveName(idB, data, 'nameB', names)
    return {
      caption: `${nameA} and ${nameB} grow close`,
      agentIds: [idA, idB].filter(Boolean),
    }
  }

  if (type === 'mind:say') {
    const agentId = e.agentId ?? ''
    const partnerId = str(data, 'partnerId') ?? ''
    const name = resolveName(agentId, data, 'agentName', names)
    const partner = resolveName(partnerId, data, 'partnerName', names)
    const text = str(data, 'text')
    return {
      caption: `${name} talks to ${partner}`,
      subtitle: text ? `"${text}"` : undefined,
      agentIds: [agentId, partnerId].filter(Boolean),
    }
  }

  return null
}

function priorityFor(type: string, data: Record<string, unknown> | undefined): number | null {
  if (INSTITUTION_TYPES.has(type)) return PRIORITY.institution
  if (type === 'discovery:examined') return PRIORITY.discovery
  if (type === 'construction:completed') return PRIORITY.constructionCompleted
  if (type === 'ownership:transfer' && data?.firstPrivate === true) {
    return PRIORITY.ownershipFirstPrivate
  }
  if (type === 'construction:commissioned') return PRIORITY.constructionCommissioned
  if (type === 'agent:collapsed' || type === 'agent:recovered') return PRIORITY.collapse
  if (type === 'relationship:close') return PRIORITY.relationship
  if (type === 'mind:say') return PRIORITY.mindSay
  return null
}

/**
 * Build scored candidates from the event trace (no selection / caps yet).
 * `relationship:close` — first occurrence per unordered pair only.
 * `mind:say` — first utterance per conversation-pair per calendar day only.
 * `mind:reflection` — skipped.
 */
export function collectHighlightCandidates(
  events: readonly SimEvent[],
  names: HighlightNameResolver,
): HighlightMoment[] {
  const out: HighlightMoment[] = []
  const closeSeen = new Set<string>()
  /** day -> pairKey -> seen */
  const saySeen = new Set<string>()

  for (const e of events) {
    if (e.type === 'mind:reflection') continue

    const data = (e.data ?? {}) as Record<string, unknown>
    const prio = priorityFor(e.type, data)
    if (prio == null) continue

    if (e.type === 'relationship:close') {
      const idA = str(data, 'agentIdA') ?? e.agentId ?? ''
      const idB = str(data, 'agentIdB') ?? ''
      if (!idA || !idB) continue
      const key = pairKey(idA, idB)
      if (closeSeen.has(key)) continue
      closeSeen.add(key)
    }

    if (e.type === 'mind:say') {
      const idA = e.agentId ?? ''
      const idB = str(data, 'partnerId') ?? ''
      if (!idA || !idB) continue
      const day = toSimTime(e.tick).day
      const key = `${day}:${pairKey(idA, idB)}`
      if (saySeen.has(key)) continue
      saySeen.add(key)
    }

    const cap = captionForEvent(e, names)
    if (!cap) continue

    // Land INSIDE staging windows (say / examine / commission) so stills
    // capture bubble text, target glyph, and ceremony — not the event edge.
    const poseBump =
      e.type === 'mind:say' ||
      e.type === 'discovery:examined' ||
      e.type === 'construction:commissioned'
        ? 1
        : 0
    out.push({
      tick: e.tick + poseBump,
      type: e.type,
      priority: prio,
      agentIds: cap.agentIds,
      placeId: cap.placeId,
      caption: cap.caption,
      subtitle: cap.subtitle,
    })
  }

  return out
}

/** Stable sort: priority desc, tick asc, type asc. */
export function sortCandidates(cands: readonly HighlightMoment[]): HighlightMoment[] {
  return cands.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    if (a.tick !== b.tick) return a.tick - b.tick
    if (a.type < b.type) return -1
    if (a.type > b.type) return 1
    return 0
  })
}

/**
 * Max 2 per event type (unless fewer exist). Preserves sort order.
 */
export function dedupeByType(
  cands: readonly HighlightMoment[],
  maxPerType = 2,
): HighlightMoment[] {
  const counts = new Map<string, number>()
  const out: HighlightMoment[] = []
  for (const c of cands) {
    const n = counts.get(c.type) ?? 0
    if (n >= maxPerType) continue
    counts.set(c.type, n + 1)
    out.push(c)
  }
  return out
}

/**
 * Spread picks across calendar days while respecting priority order.
 * Hard-cap mind:say to 2 in the final reel.
 */
export function selectHighlights(
  cands: readonly HighlightMoment[],
  max = 12,
): HighlightMoment[] {
  if (max <= 0) return []
  const sorted = sortCandidates(cands)
  const typed = dedupeByType(sorted, 2)

  const remaining = typed.slice()
  const selected: HighlightMoment[] = []
  const dayCounts = new Map<number, number>()
  let mindSayCount = 0

  const dayOf = (c: HighlightMoment) => toSimTime(c.tick).day

  while (selected.length < max && remaining.length > 0) {
    // Prefer days with the fewest picks so far; among those, highest priority
    // (already sorted — scan remaining for best under day-spread).
    let bestIdx = -1
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!
      if (c.type === 'mind:say' && mindSayCount >= 2) continue
      const d = dayOf(c)
      const dc = dayCounts.get(d) ?? 0
      // Higher priority first; lower day count second; earlier tick third
      const score = c.priority * 1000 - dc * 100 - c.tick * 0.0001
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx < 0) break
    const pick = remaining.splice(bestIdx, 1)[0]!
    selected.push(pick)
    const d = dayOf(pick)
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1)
    if (pick.type === 'mind:say') mindSayCount += 1
  }

  // Final order: chronological for a natural reel
  return selected.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick
    if (a.type < b.type) return -1
    if (a.type > b.type) return 1
    return 0
  })
}

/** Name resolver from a world snapshot (agents array). */
export function namesFromWorld(world: Pick<WorldState, 'agents' | 'places'>): HighlightNameResolver {
  const byId = new Map(world.agents.map((a) => [a.id, a.name]))
  const placeById = new Map(world.places.map((p) => [p.id, p.kind]))
  return {
    agentName: (id) => byId.get(id) ?? id,
    placeKind: (placeId) => placeById.get(placeId),
  }
}

type FootprintPlace = Pick<WorldState['places'][number], 'kind' | 'x' | 'y'>
type FootprintAgent = Pick<WorldState['agents'][number], 'id' | 'x' | 'y'>

/** Discrete 3×3 home footprint — same chebyshev rule as `spots.slotTiles`. */
export function agentOnBuildingFootprint(
  places: readonly FootprintPlace[],
  x: number,
  y: number,
): boolean {
  const tx = Math.round(x)
  const ty = Math.round(y)
  for (const p of places) {
    if (p.kind !== 'home') continue
    if (Math.max(Math.abs(tx - p.x), Math.abs(ty - p.y)) <= 1) return true
  }
  return false
}

/** True if any named subject stands on a building-footprint tile. */
export function subjectsOnBuildingFootprint(
  world: { agents: readonly FootprintAgent[]; places: readonly FootprintPlace[] },
  agentIds: readonly string[],
): boolean {
  for (const id of agentIds) {
    const a = world.agents.find((ag) => ag.id === id)
    if (!a) continue
    if (agentOnBuildingFootprint(world.places, a.x, a.y)) return true
  }
  return false
}

export interface HighlightPickOpts {
  /**
   * World at a candidate's tick. When provided, `relationship:close` and
   * `mind:say` moments whose subjects stand on a building footprint are skipped.
   */
  worldAtTick?: (
    tick: number,
  ) => { agents: readonly FootprintAgent[]; places: readonly FootprintPlace[] } | null | undefined
}

function isIndoorSocialMoment(
  m: HighlightMoment,
  worldAtTick: NonNullable<HighlightPickOpts['worldAtTick']>,
): boolean {
  if (m.type !== 'relationship:close' && m.type !== 'mind:say') return false
  const snap = worldAtTick(m.tick)
  if (!snap) return false
  return subjectsOnBuildingFootprint(snap, m.agentIds)
}

/**
 * Full pipeline: events + world names → selected reel (default 12).
 */
export function pickHighlights(
  events: readonly SimEvent[],
  world: Pick<WorldState, 'agents' | 'places'>,
  max = 12,
  opts?: HighlightPickOpts,
): HighlightMoment[] {
  const names = namesFromWorld(world)
  let cands = collectHighlightCandidates(events, names)
  if (opts?.worldAtTick) {
    const at = opts.worldAtTick
    cands = cands.filter((m) => !isIndoorSocialMoment(m, at))
  }
  return selectHighlights(cands, max)
}

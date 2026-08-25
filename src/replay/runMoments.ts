/**
 * The chapter index for a recorded run.
 *
 * "Important" is never re-decided here at view time — it is read back out of
 * what the run itself recorded:
 *   • story moments come from the event trace: the first occurrence of each
 *     notable type, plus the run's own photographer selection (pickHighlights).
 *   • ops moments come from the soak harness JSONL journal: the wedges,
 *     fallbacks, stale intents and budget saturation it flagged while running.
 *
 * Pure — no DOM, no fs, no wall clock.
 */

import { captionForEvent, namesFromWorld, pickHighlights } from './highlights'
import { toSimTime } from '../sim/time'
import type { SimEvent, WorldState } from '../sim/types'

export type RunMomentKind = 'story' | 'ops'

export interface RunMoment {
  id: string
  kind: RunMomentKind
  type: string
  /** Where to jump. For ops moments this is the START of the sampled window. */
  tick: number
  /** Ops only: end of the wall-minute window the journal sampled. */
  endTick?: number
  day: number
  hour: number
  minute: number
  priority: number
  caption: string
  subtitle?: string
  agentIds: string[]
  placeId?: string
  /** Ops only: soak wall-clock minute the harness observed this at. */
  wallMin?: number
  /** Still the run's photographer actually shot for this moment, if any. */
  still?: string
  /** This is the first time this kind of thing happened in the run. */
  first?: true
}

/**
 * One shot from a run's `highlights.json` — written by `soak-highlights.mjs`
 * right after the soak. This is the run's own verdict on what was worth a
 * photograph, so it outranks anything re-derived at view time.
 */
export interface RunHighlightShot {
  file: string
  tick: number
  type: string
  caption: string
  subtitle?: string | null
  agents?: string[]
  hero?: string | null
}

/** One `[soak]` journal sample — a wall-minute of the run. */
export interface JournalRow {
  wallMin?: number
  tick?: number
  day?: number
  hour?: number
  minute?: number
  ticksThisMin?: number
  speed?: number
  breathePct?: number
  counts?: Record<string, number>
  mind?: {
    decisions?: number
    fallbacks?: number
    stale?: number
    budgetH?: number
    pending?: number
    thinking?: number
    meanLatencyMs?: number
  }
}

export const OPS_PRIORITY = {
  /** A frozen sim clock is the one thing that can void a whole run. */
  wedge: 95,
  budget: 70,
  fallback: 60,
  stale: 60,
} as const

/** Priority for a first-of-its-kind story moment (above any repeat). */
export const FIRST_PRIORITY = 120

/**
 * Types whose FIRST occurrence is a chapter, in the order they matter.
 * pickHighlights caps two per type across a whole run; a first must never
 * fall off that list.
 */
const FIRST_OF_TYPE: readonly string[] = [
  'institution:proposed',
  'institution:voted',
  'institution:closed',
  'institution:sanctioned',
  'institution:claimed',
  'construction:commissioned',
  'construction:completed',
  'ownership:transfer',
  'discovery:examined',
  'discovery:noticed',
  'gathering:scheduled',
  'gathering:started',
  'relationship:close',
  'relationship:friends',
  'agent:collapsed',
  'agent:recovered',
  'job:hired',
  'mind:say',
  'mind:reflection',
]

/** Captions for types the photographer does not caption. */
function fallbackCaption(
  e: SimEvent,
  agentName: (id: string) => string,
): { caption: string; subtitle?: string; agentIds: string[]; placeId?: string } | null {
  const data = (e.data ?? {}) as Record<string, unknown>
  const s = (k: string): string | undefined => {
    const v = data[k]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const who = e.agentId ? agentName(e.agentId) : 'Someone'

  switch (e.type) {
    case 'discovery:noticed':
      return {
        caption: `${who} notices something`,
        subtitle: s('knowledge') ?? s('target'),
        agentIds: e.agentId ? [e.agentId] : [],
        placeId: s('target') ?? s('placeId'),
      }
    case 'gathering:scheduled':
      return {
        caption: 'An assembly is called',
        subtitle: s('text') ?? s('proposalId'),
        agentIds: e.agentId ? [e.agentId] : [],
        placeId: s('placeId'),
      }
    case 'gathering:started':
      return {
        caption: 'The assembly convenes',
        subtitle: s('text') ?? s('proposalId'),
        agentIds: e.agentId ? [e.agentId] : [],
        placeId: s('placeId'),
      }
    case 'relationship:friends':
      return {
        caption: `${who} makes a friend`,
        subtitle: s('otherName') ?? s('otherId'),
        agentIds: [e.agentId, s('otherId')].filter((v): v is string => !!v),
      }
    case 'job:hired':
      return {
        caption: `${who} takes a job`,
        subtitle: s('placeKind') ?? s('placeId'),
        agentIds: e.agentId ? [e.agentId] : [],
        placeId: s('placeId'),
      }
    case 'mind:reflection':
      return {
        caption: `${who} reflects`,
        subtitle: s('note') ?? e.reason,
        agentIds: e.agentId ? [e.agentId] : [],
      }
    case 'ownership:transfer': {
      const to = s('to')
      const taker = !to || to === 'commons' ? 'The commons' : agentName(to)
      return {
        caption: `${taker} takes a place`,
        subtitle: s('placeKind') ?? s('placeId'),
        agentIds: to && to !== 'commons' ? [to] : [],
        placeId: s('placeId'),
      }
    }
    default:
      return null
  }
}

function stamp(tick: number): { day: number; hour: number; minute: number } {
  const t = toSimTime(tick)
  return { day: t.day, hour: t.hour, minute: t.minute }
}

/** First occurrence of each notable type, at its exact recorded tick. */
export function firstOfTypeMoments(
  events: readonly SimEvent[],
  world: Pick<WorldState, 'agents' | 'places'>,
): RunMoment[] {
  const names = namesFromWorld(world)
  const wanted = new Set(FIRST_OF_TYPE)
  const seen = new Set<string>()
  const out: RunMoment[] = []

  for (const e of events) {
    if (!wanted.has(e.type) || seen.has(e.type)) continue
    const cap = captionForEvent(e, names) ?? fallbackCaption(e, names.agentName)
    if (!cap) continue
    seen.add(e.type)
    out.push({
      id: `first-${e.type}-${e.seq}`,
      kind: 'story',
      type: e.type,
      tick: e.tick,
      ...stamp(e.tick),
      priority: FIRST_PRIORITY,
      caption: `First: ${cap.caption}`,
      subtitle: cap.subtitle,
      agentIds: cap.agentIds,
      placeId: cap.placeId,
      first: true,
    })
  }
  return out
}

/**
 * What the harness itself flagged, minute by minute. A journal row's `tick` is
 * the sim clock at sample time, so the thing it reports happened somewhere in
 * (prevTick, tick] — the moment jumps to prevTick so you watch it happen.
 */
export function opsMomentsFromJournal(
  rows: readonly JournalRow[],
  opts?: { budgetMaxHour?: number },
): RunMoment[] {
  const out: RunMoment[] = []
  const budgetMax = opts?.budgetMaxHour ?? 0
  let prevTick = 0
  let lastFallbacks = 0
  let lastStale = 0
  let budgetFlagged = false
  let wedgeRun = 0
  let wedgeStartTick: number | null = null
  let wedgeStartWallMin: number | undefined

  const push = (
    type: string,
    priority: number,
    tick: number,
    endTick: number,
    caption: string,
    subtitle: string | undefined,
    wallMin: number | undefined,
  ) => {
    out.push({
      id: `ops-${type}-${out.length}`,
      kind: 'ops',
      type,
      tick,
      endTick,
      ...stamp(tick),
      priority,
      caption,
      subtitle,
      agentIds: [],
      wallMin,
    })
  }

  const closeWedge = () => {
    if (wedgeRun <= 0 || wedgeStartTick == null) return
    const mins = wedgeRun === 1 ? '1 wall-minute' : `${wedgeRun} wall-minutes`
    push(
      'ops:wedge',
      OPS_PRIORITY.wedge,
      wedgeStartTick,
      wedgeStartTick,
      'The sim clock froze',
      `rAF stopped for ${mins} at tick ${wedgeStartTick}`,
      wedgeStartWallMin,
    )
    wedgeRun = 0
    wedgeStartTick = null
    wedgeStartWallMin = undefined
  }

  for (const row of rows) {
    const tick = typeof row.tick === 'number' ? row.tick : prevTick
    const from = prevTick
    const wallMin = row.wallMin

    // Frozen clock — the run is not running. Collapse a streak into one moment.
    if (typeof row.ticksThisMin === 'number' && row.ticksThisMin <= 0) {
      if (wedgeRun === 0) {
        wedgeStartTick = tick
        wedgeStartWallMin = wallMin
      }
      wedgeRun += 1
    } else {
      closeWedge()
    }

    const fallbacks = row.mind?.fallbacks ?? 0
    if (fallbacks > lastFallbacks) {
      const gained = fallbacks - lastFallbacks
      push(
        'ops:fallback',
        OPS_PRIORITY.fallback,
        from,
        tick,
        'A mind fell back to instinct',
        `${gained} fallback${gained === 1 ? '' : 's'} (${fallbacks} total) by t+${wallMin ?? '?'}m`,
        wallMin,
      )
      lastFallbacks = fallbacks
    }

    const stale = row.mind?.stale ?? 0
    if (stale > lastStale) {
      const gained = stale - lastStale
      push(
        'ops:stale',
        OPS_PRIORITY.stale,
        from,
        tick,
        'An intent arrived too late',
        `${gained} stale (${stale} total) by t+${wallMin ?? '?'}m`,
        wallMin,
      )
      lastStale = stale
    }

    const usedHour = row.mind?.budgetH ?? 0
    if (!budgetFlagged && budgetMax > 0 && usedHour >= 0.9 * budgetMax) {
      push(
        'ops:budget',
        OPS_PRIORITY.budget,
        from,
        tick,
        'The mind budget ran hot',
        `${usedHour}/${budgetMax} calls this sim-hour (at or above 90%)`,
        wallMin,
      )
      budgetFlagged = true
    }

    prevTick = tick
  }
  closeWedge()

  return out
}

/** Chapters the run's photographer already chose and shot. */
export function momentsFromShots(
  shots: readonly RunHighlightShot[],
): RunMoment[] {
  const out: RunMoment[] = []
  for (const s of shots) {
    if (!s || typeof s.tick !== 'number' || !Number.isFinite(s.tick)) continue
    out.push({
      id: `shot-${s.file || s.type}-${s.tick}`,
      kind: 'story',
      type: s.type,
      tick: s.tick,
      ...stamp(s.tick),
      // The run committed film to this one; rank it with the firsts.
      priority: FIRST_PRIORITY,
      caption: s.caption,
      subtitle: s.subtitle ?? undefined,
      agentIds: Array.isArray(s.agents) ? s.agents : [],
      still: s.file || undefined,
    })
  }
  return out
}

export interface BuildRunMomentsInput {
  events: readonly SimEvent[]
  world: Pick<WorldState, 'agents' | 'places' | 'tick'>
  journal?: readonly JournalRow[]
  /**
   * The run's recorded photographer reel. When present these replace the
   * view-time `pickHighlights` pass — same selector, but this is what the run
   * actually chose, and each moment carries its still.
   */
  shots?: readonly RunHighlightShot[]
  /** Cap on the photographer's own selection (firsts are always kept). */
  maxStory?: number
  budgetMaxHour?: number
  /** Rendered under the bookend moments, e.g. "seed 42 · wild · codex". */
  runLabel?: string
}

/**
 * Collapse chapters that describe the same event. The photographer's pick and
 * the first-of-type land within a tick or two of each other (selection nudges
 * say/examine/commission forward so the still catches the staging), so merge
 * them: keep the "First:" framing, keep the still the run shot.
 */
function dedupe(moments: readonly RunMoment[]): RunMoment[] {
  const out: RunMoment[] = []
  for (const m of moments) {
    const at = out.findIndex(
      (o) => o.kind === m.kind && o.type === m.type && Math.abs(o.tick - m.tick) <= 2,
    )
    if (at < 0) {
      out.push(m)
      continue
    }
    const kept = out[at]!
    // A first outranks a repeat; otherwise the higher-priority wording wins.
    const winner =
      kept.first === m.first ? (m.priority > kept.priority ? m : kept) : kept.first ? kept : m
    const other = winner === kept ? m : kept
    out[at] = {
      ...winner,
      still: winner.still ?? other.still,
      subtitle: winner.subtitle ?? other.subtitle,
      placeId: winner.placeId ?? other.placeId,
      agentIds: winner.agentIds.length > 0 ? winner.agentIds : other.agentIds,
    }
  }
  return out
}

/**
 * Full chapter list for a recorded run: bookends + firsts + photographer picks
 * + harness ops flags, in chronological order.
 */
export function buildRunMoments(input: BuildRunMomentsInput): RunMoment[] {
  const {
    events,
    world,
    journal,
    shots,
    maxStory = 24,
    budgetMaxHour,
    runLabel,
  } = input

  const firsts = firstOfTypeMoments(events, world)
  const picks =
    shots && shots.length > 0
      ? momentsFromShots(shots)
      : pickHighlights(events, world, maxStory).map<RunMoment>((h) => ({
          id: `pick-${h.type}-${h.tick}`,
          kind: 'story',
          type: h.type,
          tick: h.tick,
          ...stamp(h.tick),
          priority: h.priority,
          caption: h.caption,
          subtitle: h.subtitle,
          agentIds: h.agentIds,
          placeId: h.placeId,
        }))
  const ops = journal ? opsMomentsFromJournal(journal, { budgetMaxHour }) : []

  const headTick = world.tick ?? 0
  const bookends: RunMoment[] = [
    {
      id: 'run-start',
      kind: 'story',
      type: 'run:start',
      tick: 0,
      ...stamp(0),
      priority: FIRST_PRIORITY + 10,
      caption: 'The run begins',
      subtitle: runLabel,
      agentIds: [],
    },
    {
      id: 'run-end',
      kind: 'story',
      type: 'run:end',
      tick: headTick,
      ...stamp(headTick),
      priority: FIRST_PRIORITY + 10,
      caption: 'The run ends',
      subtitle: runLabel,
      agentIds: [],
    },
  ]

  const merged = dedupe([...bookends, ...firsts, ...picks, ...ops])
  return merged.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0
  })
}

/** Chapters grouped by calendar day for the rail. */
export function groupMomentsByDay(
  moments: readonly RunMoment[],
): Array<{ day: number; moments: RunMoment[] }> {
  const byDay = new Map<number, RunMoment[]>()
  for (const m of moments) {
    const list = byDay.get(m.day)
    if (list) list.push(m)
    else byDay.set(m.day, [m])
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({ day, moments: list }))
}

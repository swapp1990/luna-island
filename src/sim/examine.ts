/** World-authored examine results — what a place yields when looked at closely. */

import type { Good, Place, PlaceKind, WorldState } from './types'
import {
  CLAIM_COST,
  coinPhrase,
  PROPOSE_COST,
  publicWorksRuleLine,
  SANCTION_COST,
  VOTE_COST,
} from './costs'

/** Full-rate bed restore vs ground sleep (per tick, before jitter). */
export const SLEEP_BED_ENERGY = 1 / 420
/** Sleeping rough: 60% of bed rate (1/700 ÷ 1/420). */
export const SLEEP_GROUND_ENERGY = 1 / 700

/** How far an agent can notice / tag places in an observation. */
export const PLACE_VIEW_RADIUS = 6

export const EXAMINE_BY_KIND: Record<Exclude<PlaceKind, 'construction-site'>, string> = {
  // Generated from the fee constants so the menu can never drift from what the
  // sim actually charges — the drift that produced the accidental propose/vote
  // asymmetry in the first place.
  'notice-board': `Anyone may propose (${coinPhrase(PROPOSE_COST)}) — posts your words here for a day. Vote yes or no on an open proposal (${coinPhrase(VOTE_COST)}); every villager's vote is recorded, but a proposal is decided by the votes of those who weigh it themselves. Sanction (${coinPhrase(SANCTION_COST)}) posts a public censure. Claim (${coinPhrase(CLAIM_COST)}) takes a commons place as yours. Posted rules may be followed or broken. ${publicWorksRuleLine()} Proposals are weighed at a plaza assembly on their closing eve.`,
  'berry-bush': 'Berries grow here, sparser in lean times.',
  well: 'Cool water here — drinking left me a little more awake.',
  farm: 'People tend the soil here and food grows if they stay with it.',
  stall: 'Food sits out for coins; the piles and asking price change.',
  storehouse: 'Wood and stone gather here after work.',
  home: 'A bed under a roof — sleeping here left me deeply rested.',
  quarry: 'Stone comes loose here when someone works it.',
  forestry: 'Wood is cut here when someone works it.',
  plaza: 'People gather here; standing near others felt less lonely.',
  spring:
    'Sweet fruit grows thick here — more than a bush holds, and it comes back faster. One person fits.',
  school: 'A schoolhouse — people gather in the rooms to talk.',
}

export interface ExamineContext {
  owners?: WorldState['owners']
  agents?: ReadonlyArray<{ id: string; name: string }>
  places?: ReadonlyArray<Place>
  /** Current-day place:blocked counts (missing ⇒ none). */
  placeBlockedToday?: Record<string, number>
}

/** Felt line when a sleeper rests off a bed in a home whose beds were taken. */
export const FLOOR_SLEEP_FELT =
  'the beds at home were full — slept on the floor'

/** A place reads as busy once it has turned people away this many times today. */
export const PLACE_BUSY_THRESHOLD = 3

export function placeBlockedCountToday(
  placeId: string,
  counts: Record<string, number> | undefined,
): number {
  const n = counts?.[placeId]
  return typeof n === 'number' && n > 0 ? n : 0
}

export function placeIsBusyToday(
  placeId: string,
  counts: Record<string, number> | undefined,
): boolean {
  return placeBlockedCountToday(placeId, counts) >= PLACE_BUSY_THRESHOLD
}

/** Examine addendum when a place is busy today. Null below the threshold. */
export function crowdedTodayExamineLine(n: number): string | null {
  if (n < PLACE_BUSY_THRESHOLD) return null
  return `It was crowded today — turned people away ${n} times.`
}

/** Building kinds counted in the village census — example order, 0 omitted. */
const CENSUS_KINDS = [
  'home',
  'farm',
  'well',
  'notice-board',
  'stall',
  'storehouse',
  'forestry',
  'quarry',
] as const

function censusKindLabel(kind: (typeof CENSUS_KINDS)[number], n: number): string {
  if (kind === 'home') return n === 1 ? 'home' : 'homes'
  return n === 1 ? kind : `${kind}s`
}

/**
 * Compact building-stock line derived from `places`. Counts only; kinds at 0
 * are omitted. Empty when the village holds none of the counted kinds.
 */
export function villageCensusLine(places: readonly Place[]): string | null {
  const counts = new Map<(typeof CENSUS_KINDS)[number], number>()
  for (const p of places) {
    for (const kind of CENSUS_KINDS) {
      if (p.kind === kind) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1)
        break
      }
    }
  }
  const parts: string[] = []
  for (const kind of CENSUS_KINDS) {
    const n = counts.get(kind) ?? 0
    if (n === 0) continue
    parts.push(`${n} ${censusKindLabel(kind, n)}`)
  }
  if (parts.length === 0) return null
  return `The village holds: ${parts.join(', ')}.`
}

function ownerPossessive(
  placeId: string,
  ctx?: ExamineContext,
): string | null {
  const ownerId = ctx?.owners?.[placeId]
  if (!ownerId || ownerId === 'commons') return null
  const name = ctx?.agents?.find((a) => a.id === ownerId)?.name
  return name ? `${name}'s` : null
}

function remainingBill(needs: Partial<Record<Good, number>> | undefined): string {
  if (!needs) return 'nothing more'
  const parts: string[] = []
  const wood = needs.wood ?? 0
  const stone = needs.stone ?? 0
  if (wood > 0) parts.push(`${wood} wood`)
  if (stone > 0) parts.push(`${stone} stone`)
  return parts.length > 0 ? parts.join(' and ') : 'nothing more'
}

export function examineKnowledgeFor(place: Place, ctx?: ExamineContext): string {
  if (place.kind === 'construction-site') {
    const target = place.construction?.targetKind ?? 'home'
    const whose = ownerPossessive(place.id, ctx)
    const bill = remainingBill(place.construction?.needs)
    const label = target === 'home' ? 'house' : target
    const upgrading = !!place.construction?.upgradeOf
    const shape = upgrading ? `An upgrade of a ${label} taking shape` : `A ${label} taking shape`
    if (whose) {
      return bill === 'nothing more'
        ? `${shape} — ${whose}; materials in, walls going up`
        : `${shape} — ${whose}; still needs ${bill}`
    }
    return bill === 'nothing more'
      ? `${shape} — materials in, walls going up`
      : `${shape} — still needs ${bill}`
  }

  const base =
    EXAMINE_BY_KIND[place.kind as Exclude<PlaceKind, 'construction-site'>] ??
    `A ${place.kind} stands here.`
  const lv = place.level ?? 1
  const lvTag = lv > 1 ? ` (lv ${lv})` : ''
  const whose = ownerPossessive(place.id, ctx)
  let out: string
  if (!whose) out = `${base}${lvTag}`
  else if (place.kind === 'home') {
    out = `A bed under a roof — ${whose}${lvTag}. Sleeping here left me deeply rested.`
  } else {
    out = `${base} Belongs to ${whose.replace(/'s$/, '')}${lvTag}.`
  }
  if (place.kind === 'notice-board') {
    const census = villageCensusLine(ctx?.places ?? [])
    if (census) out = `${out} ${census}`
  }
  const blocked = placeBlockedCountToday(place.id, ctx?.placeBlockedToday)
  const crowded = crowdedTodayExamineLine(blocked)
  if (crowded) out = `${out} ${crowded}`
  return out
}

export function placeKindLabel(kind: PlaceKind | string): string {
  switch (kind) {
    case 'notice-board':
      return 'notice board'
    case 'berry-bush':
      return 'berry bush'
    case 'construction-site':
      return 'construction site'
    default:
      return kind
  }
}

/** Honest felt line for a failed place-use. Names the owner (if exclusive) or occupant. */
export function blockedFeltLine(opts: {
  label: string
  occupantNames: string[]
  ownerName?: string
  onlySpot: boolean
}): string {
  if (opts.ownerName) {
    return `could not use the ${opts.label} — it is ${opts.ownerName}'s now`
  }
  const names = opts.occupantNames
  if (names.length === 1) {
    return opts.onlySpot
      ? `could not use the ${opts.label} — ${names[0]} was in the only spot`
      : `could not use the ${opts.label} — ${names[0]} was using it`
  }
  if (names.length === 2) {
    return `could not use the ${opts.label} — ${names[0]} and ${names[1]} were using it`
  }
  if (names.length > 2) {
    const head = names.slice(0, -1).join(', ')
    return `could not use the ${opts.label} — ${head}, and ${names[names.length - 1]} were using it`
  }
  return `could not use the ${opts.label} — every spot was taken`
}

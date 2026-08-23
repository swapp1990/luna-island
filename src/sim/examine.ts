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
  'notice-board': `Anyone may propose (${coinPhrase(PROPOSE_COST)}) — posts your words here for a day. Vote yes or no on an open proposal (${coinPhrase(VOTE_COST)}); every villager's vote is recorded, but a proposal is decided by the votes of those who weigh it themselves. Sanction (${coinPhrase(SANCTION_COST)}) posts a public censure. Claim (${coinPhrase(CLAIM_COST)}) takes a commons place as yours. Posted rules may be followed or broken. ${publicWorksRuleLine()}`,
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
}

export interface ExamineContext {
  owners?: WorldState['owners']
  agents?: ReadonlyArray<{ id: string; name: string }>
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
  if (!whose) return `${base}${lvTag}`
  if (place.kind === 'home') {
    return `A bed under a roof — ${whose}${lvTag}. Sleeping here left me deeply rested.`
  }
  return `${base} Belongs to ${whose.replace(/'s$/, '')}${lvTag}.`
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

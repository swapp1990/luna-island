/** World-authored examine results — what a place yields when looked at closely. */

import type { Place, PlaceKind } from './types'

/** Full-rate bed restore vs ground sleep (per tick, before jitter). */
export const SLEEP_BED_ENERGY = 1 / 420
/** Sleeping rough: 60% of bed rate (1/700 ÷ 1/420). */
export const SLEEP_GROUND_ENERGY = 1 / 700

/** How far an agent can notice / tag places in an observation. */
export const PLACE_VIEW_RADIUS = 6

const EXAMINE_BY_KIND: Record<PlaceKind, string> = {
  'notice-board':
    'Anyone may propose (2 coins) — posts your words here for a day. Vote yes or no on an open proposal. Sanction (1 coin) posts a public censure. Claim (15 coins) takes a commons place as yours. Posted rules may be followed or broken.',
  'berry-bush': 'Berries grow here, sparser in lean times.',
  well: 'Cool water here — drinking left me a little more awake.',
  farm: 'People tend the soil here and food grows if they stay with it.',
  stall: 'Food sits out for coins; the piles and asking price change.',
  storehouse: 'Wood and stone gather here after work.',
  home: 'A bed under a roof — sleeping here left me deeply rested.',
  quarry: 'Stone comes loose here when someone works it.',
  forestry: 'Wood is cut here when someone works it.',
  plaza: 'People gather here; standing near others felt less lonely.',
  'construction-site': 'A house taking shape — wood and stone go in, walls go up.',
}

export function examineKnowledgeFor(place: Place): string {
  return EXAMINE_BY_KIND[place.kind] ?? `A ${place.kind} stands here.`
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

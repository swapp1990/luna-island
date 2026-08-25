/**
 * "What changed during this run" — a before/after reading of one recorded run.
 *
 * Structural rows come from two WorldState snapshots (the run's earliest
 * available snapshot and its head). Activity rows are counted off the event
 * trace inside the window, never re-derived from state. Pure: no DOM, no fs,
 * no wall clock.
 */

import { placeKindLabel } from '../sim/examine'
import { toSimTime } from '../sim/time'
import type { SimEvent, WorldState } from '../sim/types'

export interface ChangeRow {
  label: string
  before: string
  after: string
  /** Signed delta for numeric rows, e.g. "+3". Absent when not meaningful. */
  delta?: string
  /** Direction for colouring: gain / loss / flat. */
  dir?: 'up' | 'down' | 'flat'
  note?: string
}

export interface ChangeSection {
  id: string
  title: string
  rows: ChangeRow[]
  /** Free-form lines (rule texts, new buildings) shown under the rows. */
  notes?: string[]
}

export interface RunFirst {
  tick: number
  day: number
  clock: string
  label: string
}

export interface RunChangelog {
  fromTick: number
  toTick: number
  days: number
  /** True when the "before" side is a mid-run snapshot, not tick 0. */
  partialBefore: boolean
  sections: ChangeSection[]
  firsts: RunFirst[]
}

type StateLike = Pick<
  WorldState,
  'tick' | 'agents' | 'places' | 'owners' | 'treasury' | 'proposals' | 'rules'
> & { gatherings?: WorldState['gatherings'] }

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function clockOf(tick: number): string {
  const t = toSimTime(tick)
  return `D${t.day} ${pad2(t.hour)}:${pad2(t.minute)}`
}

function numRow(label: string, before: number, after: number, note?: string): ChangeRow {
  const d = after - before
  return {
    label,
    before: String(before),
    after: String(after),
    delta: d === 0 ? undefined : d > 0 ? `+${d}` : String(d),
    dir: d === 0 ? 'flat' : d > 0 ? 'up' : 'down',
    note,
  }
}

/** Marks a row that counts activity rather than comparing two states. */
const DID_NOT_HAPPEN = '—'

/** Count-only row for things that have no "before" (activity inside the window). */
function tallyRow(label: string, n: number, note?: string): ChangeRow {
  return {
    label,
    before: DID_NOT_HAPPEN,
    after: String(n),
    dir: n > 0 ? 'up' : 'flat',
    note,
  }
}

function countByKind(places: StateLike['places']): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of places) m.set(p.kind, (m.get(p.kind) ?? 0) + 1)
  return m
}

function privateHoldings(owners: Record<string, string>): number {
  let n = 0
  for (const owner of Object.values(owners)) {
    if (owner && owner !== 'commons') n += 1
  }
  return n
}

function meanWallet(agents: StateLike['agents']): number {
  if (agents.length === 0) return 0
  const total = agents.reduce((s, a) => s + (a.wallet ?? 0), 0)
  return Math.round(total / agents.length)
}

function tierHistogram(places: StateLike['places']): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (const p of places) {
    const lvl = p.level ?? 1
    if (lvl >= 1 && lvl <= 3) out[lvl - 1] += 1
  }
  return out
}

/**
 * Events after `fromTick` and up to `toTick`. A run compared from the very
 * beginning includes tick 0 itself, so `world:created` counts as a first.
 */
function windowEvents(
  events: readonly SimEvent[],
  fromTick: number,
  toTick: number,
): SimEvent[] {
  const lowerInclusive = fromTick === 0
  return events.filter(
    (e) => (lowerInclusive ? e.tick >= fromTick : e.tick > fromTick) && e.tick <= toTick,
  )
}

function tally(events: readonly SimEvent[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1)
  return m
}

/** The first time each headline thing happened, with its exact clock. */
const FIRST_LABELS: ReadonlyArray<[string, string]> = [
  ['world:created', 'the world was made'],
  ['discovery:noticed', 'someone noticed a place'],
  ['discovery:examined', 'someone examined a place'],
  ['job:hired', 'someone took a job'],
  ['construction:commissioned', 'a building was commissioned'],
  ['construction:completed', 'a building was finished'],
  ['institution:proposed', 'a rule was proposed'],
  ['institution:voted', 'a vote was cast'],
  ['institution:closed', 'a proposal closed'],
  ['institution:sanctioned', 'someone was sanctioned'],
  ['institution:claimed', 'a place was claimed'],
  ['gathering:started', 'an assembly convened'],
  ['relationship:close', 'two villagers grew close'],
  ['relationship:friends', 'a friendship formed'],
  ['agent:collapsed', 'someone collapsed from hunger'],
  ['mind:say', 'a mind spoke'],
  ['mind:reflection', 'a mind reflected'],
]

export function runFirsts(events: readonly SimEvent[]): RunFirst[] {
  const wanted = new Map(FIRST_LABELS)
  const seen = new Set<string>()
  const out: RunFirst[] = []
  for (const e of events) {
    const label = wanted.get(e.type)
    if (!label || seen.has(e.type)) continue
    seen.add(e.type)
    out.push({
      tick: e.tick,
      day: toSimTime(e.tick).day,
      clock: clockOf(e.tick),
      label,
    })
  }
  return out.sort((a, b) => a.tick - b.tick)
}

export interface DiffRunOpts {
  /** True when `before` is not the true start of the world. */
  partialBefore?: boolean
}

/**
 * Compare the two ends of a run and report what moved.
 */
export function diffRun(
  before: StateLike,
  after: StateLike,
  events: readonly SimEvent[],
  opts?: DiffRunOpts,
): RunChangelog {
  const fromTick = before.tick ?? 0
  const toTick = after.tick ?? 0
  const win = windowEvents(events, fromTick, toTick)
  const n = tally(win)
  const count = (type: string): number => n.get(type) ?? 0

  const beforeKinds = countByKind(before.places)
  const afterKinds = countByKind(after.places)
  const kinds = [...new Set([...beforeKinds.keys(), ...afterKinds.keys()])].sort()

  const villageRows: ChangeRow[] = [
    numRow('Places standing', before.places.length, after.places.length),
  ]
  for (const kind of kinds) {
    const b = beforeKinds.get(kind) ?? 0
    const a = afterKinds.get(kind) ?? 0
    if (b === a) continue
    villageRows.push(numRow(placeKindLabel(kind), b, a))
  }
  const bTiers = tierHistogram(before.places)
  const aTiers = tierHistogram(after.places)
  if (bTiers.join() !== aTiers.join()) {
    villageRows.push({
      label: 'Building tiers (L1/L2/L3)',
      before: bTiers.join(' / '),
      after: aTiers.join(' / '),
      dir: aTiers[1] + aTiers[2] > bTiers[1] + bTiers[2] ? 'up' : 'flat',
    })
  }
  villageRows.push(tallyRow('Commissioned', count('construction:commissioned')))
  villageRows.push(tallyRow('Completed', count('construction:completed')))

  const newPlaces = after.places
    .filter((p) => !before.places.some((q) => q.id === p.id))
    .map((p) => `${placeKindLabel(p.kind)} at (${p.x}, ${p.y})`)

  const peopleRows: ChangeRow[] = [
    numRow('Villagers', before.agents.length, after.agents.length),
    tallyRow('Collapses from hunger', count('agent:collapsed')),
    tallyRow('Recoveries', count('agent:recovered')),
    tallyRow('Grew close', count('relationship:close')),
    tallyRow('Became friends', count('relationship:friends')),
    tallyRow('Hired', count('job:hired')),
    tallyRow('Left a job', count('job:vacated')),
  ]

  const landRows: ChangeRow[] = [
    numRow(
      'Privately held places',
      privateHoldings(before.owners ?? {}),
      privateHoldings(after.owners ?? {}),
    ),
    numRow('Treasury', before.treasury ?? 0, after.treasury ?? 0),
    numRow('Mean wallet', meanWallet(before.agents), meanWallet(after.agents)),
    tallyRow('Ownership transfers', count('ownership:transfer')),
  ]

  const beforeRules = (before.rules ?? []).filter((r) => r.active).length
  const afterRules = (after.rules ?? []).filter((r) => r.active).length
  const openBefore = (before.proposals ?? []).filter((p) => p.status === 'open').length
  const openAfter = (after.proposals ?? []).filter((p) => p.status === 'open').length
  const passed = (after.proposals ?? []).filter((p) => p.status === 'passed').length
  const failed = (after.proposals ?? []).filter((p) => p.status === 'failed').length
  const civicRows: ChangeRow[] = [
    numRow('Proposals on the board', (before.proposals ?? []).length, (after.proposals ?? []).length),
    numRow('Open right now', openBefore, openAfter),
    numRow('Standing rules', beforeRules, afterRules),
    tallyRow('Proposed this run', count('institution:proposed')),
    tallyRow('Votes cast', count('institution:voted')),
    tallyRow('Closed (passed / failed)', count('institution:closed'), `${passed} passed · ${failed} failed at head`),
    tallyRow('Sanctions', count('institution:sanctioned')),
    tallyRow('Claims', count('institution:claimed')),
    tallyRow('Assemblies convened', count('gathering:started')),
  ]

  const newRules = (after.rules ?? [])
    .filter((r) => !(before.rules ?? []).some((q) => q.id === r.id))
    .map((r) => `"${r.text}"`)

  const gatherings = after.gatherings ?? []
  const turnout = gatherings.reduce((s, g) => s + (g.attended?.length ?? 0), 0)
  if (gatherings.length > 0) {
    civicRows.push(
      tallyRow(
        'Assembly turnout (total attendances)',
        turnout,
        `${gatherings.length} scheduled`,
      ),
    )
  }

  const mindRows: ChangeRow[] = [
    tallyRow('Decisions', count('mind:decision')),
    tallyRow('Things said', count('mind:say')),
    tallyRow('Reflections', count('mind:reflection')),
    tallyRow('Places examined', count('discovery:examined')),
    tallyRow('First-noticed', count('discovery:noticed')),
    tallyRow('Fell back to instinct', count('mind:fallback')),
    tallyRow('Stale intents', count('mind:stale')),
    tallyRow('Budget stops', count('mind:budget')),
  ]

  const sections: ChangeSection[] = [
    {
      id: 'village',
      title: 'The village',
      rows: villageRows,
      notes: newPlaces.length > 0 ? [`New: ${newPlaces.join(', ')}`] : undefined,
    },
    { id: 'people', title: 'The people', rows: peopleRows },
    { id: 'land', title: 'Land & coin', rows: landRows },
    {
      id: 'civic',
      title: 'Civic life',
      rows: civicRows,
      notes: newRules.length > 0 ? [`Enacted: ${newRules.join(' · ')}`] : undefined,
    },
    { id: 'minds', title: 'Minds', rows: mindRows },
  ].map((sec) => {
    // A tally that never fired is noise, not news — drop it, but say so if
    // that empties the section rather than leaving a bare heading.
    const rows = sec.rows.filter((r) => !(r.before === DID_NOT_HAPPEN && r.after === '0'))
    return {
      ...sec,
      rows,
      notes:
        rows.length === 0
          ? [...(sec.notes ?? []), 'Nothing recorded this run.']
          : sec.notes,
    }
  })

  return {
    fromTick,
    toTick,
    days: Math.max(0, (toTick - fromTick) / 1440),
    partialBefore: opts?.partialBefore ?? fromTick > 0,
    sections,
    firsts: runFirsts(win),
  }
}

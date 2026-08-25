import { describe, expect, it } from 'vitest'
import { groupRunFiles, isWatchable } from '../scripts/luna-run-files'
import {
  FIRST_PRIORITY,
  OPS_PRIORITY,
  buildRunMoments,
  firstOfTypeMoments,
  groupMomentsByDay,
  momentsFromShots,
  opsMomentsFromJournal,
  type JournalRow,
} from '../src/replay/runMoments'
import { diffRun, runFirsts } from '../src/replay/runDiff'
import { Simulation } from '../src/sim/sim'
import { serializeSave } from '../src/sim/persist'
import type { SimEvent, WorldState } from '../src/sim/types'

function ev(
  seq: number,
  tick: number,
  type: string,
  agentId?: string,
  data?: Record<string, unknown>,
): SimEvent {
  return { seq, tick, type, agentId, data } as SimEvent
}

const NAMES = {
  agents: [
    { id: 'a1', name: 'Ada' },
    { id: 'a2', name: 'Bo' },
  ],
  places: [{ id: 'p1', kind: 'berry-bush' }],
} as unknown as Pick<WorldState, 'agents' | 'places'>

describe('runFiles — grouping recorded artifacts', () => {
  it('groups a run world/story/summary triple under its export timestamp', () => {
    const groups = groupRunFiles([
      'soak-2000-world.json',
      'soak-2000-story.json',
      'soak-2000-summary.json',
      'unrelated.txt',
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.id).toBe('2000')
    expect(groups[0]!.world).toBe('soak-2000-world.json')
    expect(groups[0]!.summary).toBe('soak-2000-summary.json')
    expect(isWatchable(groups[0]!)).toBe(true)
  })

  it('attaches each journal to the export that finished after it started', () => {
    const groups = groupRunFiles([
      'soak-political-1000.jsonl',
      'soak-2000-world.json',
      'soak-political-3000.jsonl',
      'soak-4000-world.json',
    ])
    const byId = new Map(groups.map((g) => [g.id, g]))
    expect(byId.get('2000')!.journal).toBe('soak-political-1000.jsonl')
    expect(byId.get('4000')!.journal).toBe('soak-political-3000.jsonl')
  })

  it('keeps a journal whose run never exported, as its own unwatchable entry', () => {
    const groups = groupRunFiles(['soak-1000-world.json', 'soak-political-5000.jsonl'])
    const orphan = groups.find((g) => g.id === 'j5000')
    expect(orphan).toBeDefined()
    expect(orphan!.journal).toBe('soak-political-5000.jsonl')
    expect(isWatchable(orphan!)).toBe(false)
  })

  it('lists newest first', () => {
    const groups = groupRunFiles([
      'soak-1000-world.json',
      'soak-3000-world.json',
      'soak-2000-world.json',
    ])
    expect(groups.map((g) => g.id)).toEqual(['3000', '2000', '1000'])
  })
})

describe('runMoments — ops flags read back out of the harness journal', () => {
  const row = (over: Partial<JournalRow>): JournalRow => ({
    wallMin: 1,
    tick: 60,
    ticksThisMin: 60,
    mind: { fallbacks: 0, stale: 0, budgetH: 0 },
    counts: {},
    ...over,
  })

  it('collapses a frozen-clock streak into one wedge moment', () => {
    const moments = opsMomentsFromJournal([
      row({ wallMin: 1, tick: 60, ticksThisMin: 60 }),
      row({ wallMin: 2, tick: 60, ticksThisMin: 0 }),
      row({ wallMin: 3, tick: 60, ticksThisMin: 0 }),
      row({ wallMin: 4, tick: 120, ticksThisMin: 60 }),
    ])
    const wedges = moments.filter((m) => m.type === 'ops:wedge')
    expect(wedges).toHaveLength(1)
    expect(wedges[0]!.priority).toBe(OPS_PRIORITY.wedge)
    expect(wedges[0]!.tick).toBe(60)
    expect(wedges[0]!.subtitle).toContain('2 wall-minutes')
  })

  it('flags each new fallback and stale intent once', () => {
    const moments = opsMomentsFromJournal([
      row({ wallMin: 1, tick: 60, mind: { fallbacks: 0, stale: 0 } }),
      row({ wallMin: 2, tick: 120, mind: { fallbacks: 2, stale: 0 } }),
      row({ wallMin: 3, tick: 180, mind: { fallbacks: 2, stale: 1 } }),
      row({ wallMin: 4, tick: 240, mind: { fallbacks: 2, stale: 1 } }),
    ])
    expect(moments.filter((m) => m.type === 'ops:fallback')).toHaveLength(1)
    expect(moments.filter((m) => m.type === 'ops:stale')).toHaveLength(1)
    const fb = moments.find((m) => m.type === 'ops:fallback')!
    // Jumps to the START of the sampled minute so the moment can be watched.
    expect(fb.tick).toBe(60)
    expect(fb.endTick).toBe(120)
    expect(fb.subtitle).toContain('2 fallbacks')
  })

  it('flags budget saturation once, only when the cap is known', () => {
    const rows = [
      row({ wallMin: 1, tick: 60, mind: { budgetH: 100 } }),
      row({ wallMin: 2, tick: 120, mind: { budgetH: 950 } }),
      row({ wallMin: 3, tick: 180, mind: { budgetH: 990 } }),
    ]
    expect(opsMomentsFromJournal(rows)).toHaveLength(0)
    const flagged = opsMomentsFromJournal(rows, { budgetMaxHour: 1000 })
    expect(flagged.filter((m) => m.type === 'ops:budget')).toHaveLength(1)
  })

  it('reports nothing for a clean journal', () => {
    expect(
      opsMomentsFromJournal(
        [row({ wallMin: 1, tick: 60 }), row({ wallMin: 2, tick: 120 })],
        { budgetMaxHour: 900 },
      ),
    ).toEqual([])
  })
})

describe('runMoments — story chapters from the recorded trace', () => {
  it('keeps the first occurrence of each notable type at its exact tick', () => {
    const events = [
      ev(1, 100, 'discovery:examined', 'a1', { target: 'p1', placeKind: 'berry-bush' }),
      ev(2, 200, 'discovery:examined', 'a2', { target: 'p1', placeKind: 'berry-bush' }),
      ev(3, 300, 'institution:proposed', 'a1', { text: 'no sleeping in the plaza' }),
    ]
    const firsts = firstOfTypeMoments(events, NAMES)
    expect(firsts).toHaveLength(2)
    expect(firsts[0]!.tick).toBe(100)
    expect(firsts[0]!.caption).toMatch(/^First: /)
    expect(firsts.every((m) => m.priority === FIRST_PRIORITY)).toBe(true)
  })

  it('captions types the photographer does not caption', () => {
    const firsts = firstOfTypeMoments(
      [ev(1, 50, 'gathering:started', undefined, { proposalId: 'pr1' })],
      NAMES,
    )
    expect(firsts[0]!.caption).toBe('First: The assembly convenes')
  })

  it('bookends the run and orders every chapter chronologically', () => {
    const events = [
      ev(1, 300, 'institution:proposed', 'a1', { text: 'a rule' }),
      ev(2, 100, 'discovery:examined', 'a1', { target: 'p1', placeKind: 'berry-bush' }),
    ]
    const moments = buildRunMoments({
      events,
      world: { ...NAMES, tick: 2880 } as never,
      journal: [
        { wallMin: 1, tick: 1440, ticksThisMin: 0 },
        { wallMin: 2, tick: 2880, ticksThisMin: 1440 },
      ],
      runLabel: 'seed 42',
    })
    expect(moments[0]!.type).toBe('run:start')
    expect(moments[moments.length - 1]!.type).toBe('run:end')
    expect(moments[moments.length - 1]!.tick).toBe(2880)
    const ticks = moments.map((m) => m.tick)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
    // The journal's wedge rides alongside the story chapters.
    expect(moments.some((m) => m.kind === 'ops')).toBe(true)
  })

  it('groups chapters by calendar day for the rail', () => {
    const grouped = groupMomentsByDay([
      { day: 2, tick: 1500 },
      { day: 1, tick: 100 },
      { day: 1, tick: 200 },
    ] as never)
    expect(grouped.map((g) => g.day)).toEqual([1, 2])
    expect(grouped[0]!.moments).toHaveLength(2)
  })
})

describe("runMoments — the run's own photographer reel", () => {
  const shots = [
    {
      file: '01-institution-proposed.png',
      tick: 300,
      type: 'institution:proposed',
      caption: 'Ada proposes a rule',
      subtitle: '"no sleeping in the plaza"',
      agents: ['a1'],
    },
    {
      file: '02-discovery-examined.png',
      tick: 101,
      type: 'discovery:examined',
      caption: 'Ada examines the berry bush',
      subtitle: null,
      agents: ['a1'],
    },
  ]

  it('turns recorded shots into chapters that carry their still', () => {
    const moments = momentsFromShots(shots)
    expect(moments).toHaveLength(2)
    expect(moments[0]!.still).toBe('01-institution-proposed.png')
    expect(moments[0]!.priority).toBe(FIRST_PRIORITY)
    expect(moments[1]!.subtitle).toBeUndefined()
  })

  it('skips a malformed shot rather than inventing a tick', () => {
    expect(
      momentsFromShots([{ file: 'x.png', type: 'mind:say', caption: 'x' } as never]),
    ).toHaveLength(0)
  })

  it('prefers the recorded reel over re-deriving picks, and keeps the still', () => {
    const events = [
      ev(1, 100, 'discovery:examined', 'a1', { target: 'p1', placeKind: 'berry-bush' }),
      ev(2, 300, 'institution:proposed', 'a1', { text: 'no sleeping in the plaza' }),
    ]
    const moments = buildRunMoments({
      events,
      world: { ...NAMES, tick: 1440 } as never,
      shots,
    })
    // The examine chapter is both the first of its type and a shot: one entry,
    // "First:" wording preserved, still attached.
    const examines = moments.filter((m) => m.type === 'discovery:examined')
    expect(examines).toHaveLength(1)
    expect(examines[0]!.caption).toMatch(/^First: /)
    expect(examines[0]!.still).toBe('02-discovery-examined.png')

    const proposals = moments.filter((m) => m.type === 'institution:proposed')
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.still).toBe('01-institution-proposed.png')
  })
})

describe('runDiff — what changed during a run', () => {
  const state = (over: Partial<WorldState>): WorldState =>
    ({
      tick: 0,
      agents: [],
      places: [],
      owners: {},
      treasury: 0,
      proposals: [],
      rules: [],
      ...over,
    }) as WorldState

  it('reports structural before/after with signed deltas', () => {
    const before = state({
      tick: 0,
      places: [{ id: 'p1', kind: 'home', x: 1, y: 1 }] as never,
      agents: [{ id: 'a1', wallet: 10 }] as never,
      owners: { p1: 'commons' },
      treasury: 100,
    })
    const after = state({
      tick: 2880,
      places: [
        { id: 'p1', kind: 'home', x: 1, y: 1, level: 2 },
        { id: 'p2', kind: 'home', x: 4, y: 4 },
      ] as never,
      agents: [{ id: 'a1', wallet: 40 }] as never,
      owners: { p1: 'a1', p2: 'commons' },
      treasury: 70,
    })
    const log = diffRun(before, after, [
      ev(1, 500, 'construction:commissioned', 'a1', { placeId: 'p2' }),
      ev(2, 900, 'construction:completed', 'a1', { placeId: 'p2' }),
      ev(3, 950, 'ownership:transfer', 'a1', { placeId: 'p1', to: 'a1', firstPrivate: true }),
    ])

    const village = log.sections.find((s) => s.id === 'village')!
    expect(village.rows.find((r) => r.label === 'Places standing')).toMatchObject({
      before: '1',
      after: '2',
      delta: '+1',
      dir: 'up',
    })
    expect(village.notes?.[0]).toContain('New:')

    const land = log.sections.find((s) => s.id === 'land')!
    expect(land.rows.find((r) => r.label === 'Privately held places')).toMatchObject({
      before: '0',
      after: '1',
    })
    expect(land.rows.find((r) => r.label === 'Treasury')).toMatchObject({
      delta: '-30',
      dir: 'down',
    })
    expect(log.days).toBeCloseTo(2)
  })

  it('counts only events inside the compared window', () => {
    const before = state({ tick: 1440 })
    const after = state({ tick: 2880 })
    const log = diffRun(before, after, [
      ev(1, 100, 'agent:collapsed', 'a1'),
      ev(2, 2000, 'agent:collapsed', 'a1'),
      ev(3, 5000, 'agent:collapsed', 'a1'),
    ])
    const people = log.sections.find((s) => s.id === 'people')!
    expect(people.rows.find((r) => r.label === 'Collapses from hunger')!.after).toBe('1')
    expect(log.partialBefore).toBe(true)
  })

  it('timestamps the firsts', () => {
    const firsts = runFirsts([
      ev(1, 1500, 'institution:proposed', 'a1'),
      ev(2, 1600, 'institution:proposed', 'a1'),
      ev(3, 60, 'discovery:examined', 'a1'),
    ])
    expect(firsts.map((f) => f.tick)).toEqual([60, 1500])
    // Day 1 opens at 06:00, so one sim hour in reads 07:00.
    expect(firsts[0]!.clock).toBe('D1 07:00')
  })
})

describe('run theater over a real recorded save', () => {
  it('builds chapters and a changelog from a serialized run', () => {
    const sim = new Simulation(42)
    sim.advanceTicks(2880)
    const save = serializeSave(sim)
    const events = sim.getEvents()

    const moments = buildRunMoments({ events, world: sim.state })
    expect(moments.length).toBeGreaterThan(2)
    expect(moments.every((m) => m.tick >= 0 && m.tick <= sim.state.tick)).toBe(true)
    expect(moments.some((m) => m.caption.startsWith('First:'))).toBe(true)

    const earliest = [...save.pinnedDayStartSnapshots, ...save.fineSnapshotRing]
      .map((s) => s.state)
      .sort((a, b) => a.tick - b.tick)[0]!
    const log = diffRun(earliest, sim.state, events)
    expect(log.toTick).toBe(sim.state.tick)
    const minds = log.sections.find((s) => s.id === 'minds')!
    expect(minds.rows.length).toBeGreaterThan(0)
    // A two-day utility run always eats, so goods flow and the trace is non-empty.
    expect(log.firsts.length).toBeGreaterThan(0)
  })
})

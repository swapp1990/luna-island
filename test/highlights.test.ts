import { describe, expect, it } from 'vitest'
import {
  collectHighlightCandidates,
  pickHighlights,
  selectHighlights,
  subjectsOnBuildingFootprint,
  type HighlightMoment,
} from '../src/replay/highlights'
import type { SimEvent } from '../src/sim/types'

const names = {
  agentName: (id: string) =>
    (
      {
        'agent-0': 'Mira',
        'agent-1': 'Joss',
        'agent-2': 'Tama',
        'agent-3': 'Ren',
        'agent-6': 'Bram',
      } as Record<string, string>
    )[id] ?? id,
}

function ev(
  partial: Partial<SimEvent> & Pick<SimEvent, 'tick' | 'type'>,
): SimEvent {
  return {
    seq: partial.seq ?? partial.tick,
    agentId: partial.agentId,
    data: partial.data,
    reason: partial.reason ?? '',
    ...partial,
  }
}

describe('highlight moment registry', () => {
  it('produces declarative captions from synthetic events', () => {
    const events: SimEvent[] = [
      ev({
        tick: 100,
        type: 'discovery:examined',
        agentId: 'agent-0',
        data: {
          target: 'farm-1',
          placeKind: 'farm',
          agentName: 'Mira',
          knowledge: 'People tend the soil here.',
        },
      }),
      ev({
        tick: 200,
        type: 'construction:completed',
        agentId: 'agent-3',
        data: {
          placeId: 'site-1',
          agentName: 'Ren',
          kind: 'home',
          firstPrivate: true,
        },
      }),
      ev({
        tick: 300,
        type: 'agent:collapsed',
        agentId: 'agent-6',
        data: { agentName: 'Bram', hunger: 0.02 },
      }),
      ev({
        tick: 400,
        type: 'institution:proposed',
        agentId: 'agent-0',
        data: { agentName: 'Mira', text: 'Share the well' },
      }),
      ev({
        tick: 500,
        type: 'mind:reflection',
        agentId: 'agent-0',
        data: { notes: ['thinking'] },
      }),
    ]
    const cands = collectHighlightCandidates(events, names)
    expect(cands.map((c) => c.caption)).toEqual([
      'Mira examines the farm',
      "Ren's house is finished",
      'Bram collapses from hunger',
      'Mira proposes a rule',
    ])
    expect(cands.find((c) => c.type === 'discovery:examined')?.subtitle).toBe(
      'People tend the soil here.',
    )
    expect(cands.find((c) => c.type === 'institution:proposed')?.subtitle).toBe(
      '"Share the well"',
    )
    // mind:reflection skipped
    expect(cands.some((c) => c.type === 'mind:reflection')).toBe(false)
  })

  it('relationship:close is first-per-pair only', () => {
    const events: SimEvent[] = [
      ev({
        tick: 10,
        type: 'relationship:close',
        agentId: 'agent-0',
        data: {
          agentIdA: 'agent-0',
          agentIdB: 'agent-1',
          nameA: 'Mira',
          nameB: 'Joss',
        },
      }),
      ev({
        tick: 20,
        type: 'relationship:close',
        agentId: 'agent-1',
        data: {
          agentIdA: 'agent-1',
          agentIdB: 'agent-0',
          nameA: 'Joss',
          nameB: 'Mira',
        },
      }),
      ev({
        tick: 30,
        type: 'relationship:close',
        agentId: 'agent-2',
        data: {
          agentIdA: 'agent-2',
          agentIdB: 'agent-3',
          nameA: 'Tama',
          nameB: 'Ren',
        },
      }),
    ]
    const cands = collectHighlightCandidates(events, names)
    expect(cands.filter((c) => c.type === 'relationship:close')).toHaveLength(2)
    expect(cands[0]!.caption).toBe('Mira and Joss grow close')
    expect(cands[1]!.caption).toBe('Tama and Ren grow close')
  })

  it('mind:say is first per conversation-pair per day only', () => {
    // Day 1 morning ticks ~0–; day 2 starts at 1080 (midnight after day1)
    const events: SimEvent[] = [
      ev({
        tick: 33,
        type: 'mind:say',
        agentId: 'agent-0',
        data: {
          partnerId: 'agent-1',
          agentName: 'Mira',
          partnerName: 'Joss',
          text: 'Hello',
        },
      }),
      ev({
        tick: 40,
        type: 'mind:say',
        agentId: 'agent-1',
        data: {
          partnerId: 'agent-0',
          agentName: 'Joss',
          partnerName: 'Mira',
          text: 'Hi back',
        },
      }),
      ev({
        tick: 1200,
        type: 'mind:say',
        agentId: 'agent-0',
        data: {
          partnerId: 'agent-1',
          agentName: 'Mira',
          partnerName: 'Joss',
          text: 'New day',
        },
      }),
    ]
    const cands = collectHighlightCandidates(events, names)
    const says = cands.filter((c) => c.type === 'mind:say')
    expect(says).toHaveLength(2)
    // Pose tick is event.tick + 1 so stills land inside the say staging window.
    expect(says[0]!.tick).toBe(34)
    expect(says[1]!.tick).toBe(1201)
  })

  it('ownership:transfer only when firstPrivate', () => {
    const events: SimEvent[] = [
      ev({
        tick: 1,
        type: 'ownership:transfer',
        data: { placeId: 'p1', from: 'commons', to: 'agent-0' },
      }),
      ev({
        tick: 2,
        type: 'ownership:transfer',
        data: {
          placeId: 'p2',
          from: 'commons',
          to: 'agent-3',
          firstPrivate: true,
        },
      }),
    ]
    const cands = collectHighlightCandidates(events, names)
    expect(cands).toHaveLength(1)
    expect(cands[0]!.caption).toBe('Ren owns private land')
  })

  it('selection is deterministic and respects N cap', () => {
    const events: SimEvent[] = []
    for (let i = 0; i < 20; i++) {
      events.push(
        ev({
          tick: 100 + i,
          type: 'discovery:examined',
          agentId: 'agent-0',
          data: { placeKind: 'farm', agentName: 'Mira', target: `f-${i}` },
        }),
      )
    }
    for (let i = 0; i < 5; i++) {
      events.push(
        ev({
          tick: 2000 + i * 100,
          type: 'agent:collapsed',
          agentId: 'agent-6',
          data: { agentName: 'Bram' },
        }),
      )
    }
    events.push(
      ev({
        tick: 50,
        type: 'institution:proposed',
        agentId: 'agent-0',
        data: { agentName: 'Mira', text: 'Rule A' },
      }),
    )

    const a = pickHighlights(
      events,
      {
        agents: [
          { id: 'agent-0', name: 'Mira' },
          { id: 'agent-6', name: 'Bram' },
        ] as never,
        places: [],
      },
      8,
    )
    const b = pickHighlights(
      events,
      {
        agents: [
          { id: 'agent-0', name: 'Mira' },
          { id: 'agent-6', name: 'Bram' },
        ] as never,
        places: [],
      },
      8,
    )
    expect(a).toEqual(b)
    expect(a.length).toBeLessThanOrEqual(8)
    // max 2 per type
    const byType = new Map<string, number>()
    for (const m of a) byType.set(m.type, (byType.get(m.type) ?? 0) + 1)
    for (const n of byType.values()) expect(n).toBeLessThanOrEqual(2)
    // institution highest priority included
    expect(a.some((m) => m.type === 'institution:proposed')).toBe(true)
  })

  it('day-spread prefers diversity over stuffing one morning', () => {
    // 6 high-priority examines on day 1, 2 on day 2, 2 on day 3
    const events: SimEvent[] = []
    for (let i = 0; i < 6; i++) {
      events.push(
        ev({
          tick: 100 + i,
          type: 'discovery:examined',
          agentId: 'agent-0',
          data: { placeKind: 'farm', agentName: 'Mira', target: `d1-${i}` },
        }),
      )
    }
    // day 2 ~ tick 1080+
    for (let i = 0; i < 2; i++) {
      events.push(
        ev({
          tick: 1500 + i,
          type: 'construction:commissioned',
          agentId: 'agent-3',
          data: { agentName: 'Ren', placeId: `s-${i}` },
        }),
      )
    }
    // day 3
    for (let i = 0; i < 2; i++) {
      events.push(
        ev({
          tick: 3000 + i,
          type: 'agent:collapsed',
          agentId: 'agent-6',
          data: { agentName: 'Bram' },
        }),
      )
    }
    // Without day-spread, max 2 examines + 2 commissions + 2 collapses = 6
    // With day-spread, later days still get seats
    const cands = collectHighlightCandidates(events, names)
    const selected = selectHighlights(cands, 6)
    const days = new Set(
      selected.map((m) => {
        // reuse same day math as module (tick + 360) / 1440
        const abs = m.tick + 360
        return Math.floor(abs / 1440) + 1
      }),
    )
    expect(days.size).toBeGreaterThanOrEqual(2)
  })

  it('hard-caps mind:say in final reel', () => {
    const events: SimEvent[] = []
    for (let day = 0; day < 5; day++) {
      events.push(
        ev({
          tick: day * 1440 + 50,
          type: 'mind:say',
          agentId: 'agent-0',
          data: {
            partnerId: `agent-${day + 1}`,
            agentName: 'Mira',
            partnerName: 'Other',
            text: `Day ${day}`,
          },
        }),
      )
    }
    const cands = collectHighlightCandidates(events, names)
    expect(cands.filter((c) => c.type === 'mind:say').length).toBe(5)
    const selected = selectHighlights(cands, 12)
    expect(selected.filter((c) => c.type === 'mind:say').length).toBeLessThanOrEqual(
      2,
    )
  })

  it('photogenicity skips indoor close/say and is deterministic', () => {
    const events: SimEvent[] = [
      ev({
        tick: 10,
        type: 'relationship:close',
        agentId: 'agent-0',
        data: {
          agentIdA: 'agent-0',
          agentIdB: 'agent-1',
          nameA: 'Mira',
          nameB: 'Joss',
        },
      }),
      ev({
        tick: 20,
        type: 'relationship:close',
        agentId: 'agent-2',
        data: {
          agentIdA: 'agent-2',
          agentIdB: 'agent-3',
          nameA: 'Tama',
          nameB: 'Ren',
        },
      }),
      ev({
        tick: 30,
        type: 'mind:say',
        agentId: 'agent-0',
        data: {
          partnerId: 'agent-1',
          agentName: 'Mira',
          partnerName: 'Joss',
          text: 'Inside',
        },
      }),
      ev({
        tick: 40,
        type: 'mind:say',
        agentId: 'agent-2',
        data: {
          partnerId: 'agent-3',
          agentName: 'Tama',
          partnerName: 'Ren',
          text: 'Outside',
        },
      }),
    ]
    const snap = {
      agents: [
        { id: 'agent-0', name: 'Mira', x: 10, y: 10 },
        { id: 'agent-1', name: 'Joss', x: 11, y: 10 },
        { id: 'agent-2', name: 'Tama', x: 30, y: 30 },
        { id: 'agent-3', name: 'Ren', x: 31, y: 30 },
      ],
      places: [{ id: 'home-1', kind: 'home' as const, x: 10, y: 10 }],
    }
    expect(
      subjectsOnBuildingFootprint(snap, ['agent-0', 'agent-1']),
    ).toBe(true)
    expect(
      subjectsOnBuildingFootprint(snap, ['agent-2', 'agent-3']),
    ).toBe(false)

    const world = {
      agents: snap.agents as never,
      places: snap.places as never,
    }
    const worldAtTick = () => snap
    const a = pickHighlights(events, world, 12, { worldAtTick })
    const b = pickHighlights(events, world, 12, { worldAtTick })
    expect(a).toEqual(b)
    expect(a.filter((m) => m.type === 'relationship:close')).toHaveLength(1)
    expect(a.find((m) => m.type === 'relationship:close')?.caption).toBe(
      'Tama and Ren grow close',
    )
    expect(a.filter((m) => m.type === 'mind:say')).toHaveLength(1)
    expect(a.find((m) => m.type === 'mind:say')?.subtitle).toBe('"Outside"')

    const unfiltered = pickHighlights(events, world, 12)
    expect(unfiltered.filter((m) => m.type === 'relationship:close')).toHaveLength(
      2,
    )
  })

  it('priority order places institutions above examines', () => {
    const cands: HighlightMoment[] = [
      {
        tick: 10,
        type: 'discovery:examined',
        priority: 80,
        agentIds: ['agent-0'],
        caption: 'Mira examines the farm',
      },
      {
        tick: 20,
        type: 'institution:sanctioned',
        priority: 100,
        agentIds: ['agent-0'],
        caption: 'Mira sanctions Joss',
      },
    ]
    const selected = selectHighlights(cands, 1)
    expect(selected[0]!.type).toBe('institution:sanctioned')
  })
})

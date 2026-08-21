import { describe, expect, it } from 'vitest'
import {
  formatNearbyPlaceLine,
  formatPlaceStock,
  nearbyPlacesForObservation,
  type NearbyPlaceLine,
} from '../src/mind/knowledge'
import { buildUserPrompt } from '../src/mind/prompt'
import { SAVE_FORMAT_VERSION } from '../src/sim/persist'
import type { AgentState, Place, SimEvent, WorldState } from '../src/sim/types'
import { emptyInventory } from '../src/sim/types'

function place(partial: Partial<Place> & Pick<Place, 'id' | 'kind'>): Place {
  return {
    x: 10,
    y: 10,
    slots: 1,
    inventory: emptyInventory(),
    ...partial,
  }
}

function row(
  p: Place,
  extra: Partial<NearbyPlaceLine> = {},
): NearbyPlaceLine {
  return { place: p, unfamiliar: false, dist2: 0, ...extra }
}

function agent(partial: Partial<AgentState> = {}): AgentState {
  const needs = { hunger: 0.18, energy: 0.6, social: 0.7 }
  return {
    id: 'agent-0',
    name: 'Mira',
    color: '#e07a5f',
    x: 14,
    y: 10,
    homeId: '',
    needs,
    action: { kind: 'idle', reason: 'Just standing here' },
    needJitter: { hunger: 1, energy: 1, social: 1 },
    actionTicks: 0,
    lastDecideTick: 0,
    pathIndex: 0,
    criticalFired: { hunger: false, energy: false, social: false },
    actionStartNeeds: { ...needs },
    inventory: emptyInventory(),
    wallet: 20,
    collapsed: false,
    employedAt: null,
    workedTicks: 0,
    daysIdleOnJob: 0,
    workPhase: null,
    haulAmount: 0,
    haulGood: null,
    haulSourceId: null,
    haulDropoffId: null,
    sympathy: {},
    ...partial,
  }
}

function world(
  places: Place[],
  agents: AgentState[],
  extra: Partial<WorldState> = {},
): WorldState {
  return {
    seed: 1,
    tick: 240,
    width: 32,
    height: 32,
    tiles: [],
    places,
    agents,
    preset: 'wild',
    treasury: 200,
    owners: { 'plaza-0': 'commons' },
    stats: [],
    sympathyStreak: {},
    sympathyMet: {},
    externalIntentLog: [],
    mindNoteLog: [],
    sayLog: [],
    mindStats: {},
    proposals: [],
    rules: [],
    commissionCooldownUntil: {},
    ...extra,
  }
}

describe('P4-8 visible resource state', () => {
  it('save format version is unchanged', () => {
    expect(SAVE_FORMAT_VERSION).toBe(5)
  })

  it('zero stock renders (empty), not an omitted field', () => {
    const bush = place({
      id: 'bush-0',
      kind: 'berry-bush',
      inventory: { food: 0, wood: 0, stone: 0 },
    })
    expect(formatPlaceStock(bush.inventory)).toBe('empty')
    expect(formatNearbyPlaceLine(row(bush))).toBe('berry bush (empty)')
    expect(formatNearbyPlaceLine(row(bush, { unfamiliar: true }))).toBe(
      'berry bush (empty) (unfamiliar)',
    )
  })

  it('stock is derived from actual inventory for multi-good places', () => {
    const store = place({
      id: 'store-0',
      kind: 'storehouse',
      inventory: { food: 0, wood: 12, stone: 6 },
    })
    expect(formatNearbyPlaceLine(row(store))).toBe('storehouse (12 wood, 6 stone)')
    const mixed = place({
      id: 'store-1',
      kind: 'storehouse',
      inventory: { food: 3, wood: 12, stone: 6 },
    })
    expect(formatNearbyPlaceLine(row(mixed))).toBe(
      'storehouse (3 food, 12 wood, 6 stone)',
    )
  })

  it('privately owned nearby place shows owner name; commons does not', () => {
    const spring = place({
      id: 'spring-0',
      kind: 'spring',
      inventory: { food: 8, wood: 0, stone: 0 },
    })
    expect(formatNearbyPlaceLine(row(spring))).toBe('spring (8 food)')
    expect(formatNearbyPlaceLine(row(spring))).not.toMatch(/'s/)
    expect(
      formatNearbyPlaceLine(row(spring, { ownerName: 'Wren' })),
    ).toBe("spring (8 food, Wren's)")
  })

  it('retired Stall stock line does not double-report nearby stall inventory', () => {
    const mira = agent({ x: 10, y: 10 })
    const stall = place({
      id: 'stall-0',
      kind: 'stall',
      x: 12,
      y: 11,
      inventory: { food: 6, wood: 0, stone: 0 },
      price: { food: 4 },
    })
    const w = world([stall], [mira], {
      owners: { 'stall-0': 'commons' },
    })
    const prompt = buildUserPrompt(mira, w, [
      {
        seq: 12,
        tick: 12,
        type: 'action:start',
        agentId: 'agent-0',
        data: { kind: 'buy', target: 'stall-0', placeId: 'stall-0' },
        reason: 'bought food here before',
      },
    ])
    expect(prompt).not.toMatch(/Stall stock:/)
    expect(prompt).toMatch(/stall \(6 food\)/)
    expect(prompt).not.toMatch(/Stall stock: 6/)
  })

  it('empty bush + full private spring are both visible (W9B regression)', () => {
    const mira = agent()
    const wren = agent({
      id: 'agent-11',
      name: 'Wren',
      x: 16,
      y: 10,
    })
    const plaza = place({ id: 'plaza-0', kind: 'plaza', x: 12, y: 10, slots: 8 })
    const bush = place({
      id: 'bush-0',
      kind: 'berry-bush',
      x: 11,
      y: 10,
      slots: 2,
      inventory: { food: 0, wood: 0, stone: 0 },
    })
    const spring = place({
      id: 'spring-0',
      kind: 'spring',
      x: 16,
      y: 10,
      inventory: { food: 8, wood: 0, stone: 0 },
    })
    const w = world([plaza, bush, spring], [mira, wren], {
      owners: {
        'plaza-0': 'commons',
        'bush-0': 'commons',
        'spring-0': 'agent-11',
      },
    })
    const events: SimEvent[] = [
      {
        seq: 40,
        tick: 40,
        type: 'action:start',
        agentId: 'agent-0',
        data: { kind: 'forage', target: 'spring-0', placeId: 'spring-0' },
        reason: 'been here before',
      },
      {
        seq: 50,
        tick: 50,
        type: 'action:start',
        agentId: 'agent-0',
        data: { kind: 'forage', target: 'bush-0', placeId: 'bush-0' },
        reason: 'been here before',
      },
    ]
    const nearby = nearbyPlacesForObservation(mira, w, events)
    const bushLine = formatNearbyPlaceLine(nearby.find((r) => r.place.id === 'bush-0')!)
    const springLine = formatNearbyPlaceLine(
      nearby.find((r) => r.place.id === 'spring-0')!,
    )
    expect(bushLine).toBe('berry bush (empty)')
    expect(springLine).toBe("spring (8 food, Wren's)")

    const prompt = buildUserPrompt(mira, w, events)
    expect(prompt).toContain('berry bush (empty)')
    expect(prompt).toContain("spring (8 food, Wren's)")
    expect(prompt).not.toMatch(/Stall stock:/)
    const nearbyLine = prompt.split('\n').find((l) => l.startsWith('Nearby places:')) ?? ''
    expect(nearbyLine).not.toMatch(/better|excluded|you could propose/i)
  })
})

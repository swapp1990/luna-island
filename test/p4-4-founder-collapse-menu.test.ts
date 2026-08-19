import { describe, expect, it } from 'vitest'
import {
  BUILD_RECIPES,
  Simulation,
  buildableMenuLine,
  COLLAPSE_VIEW_RADIUS,
} from '../src/sim/sim'
import { examineKnowledgeFor } from '../src/sim/examine'
import { isSlotTile } from '../src/sim/spots'
import type { BuildableKind, ExternalIntentMeta, Place } from '../src/sim/types'
import { emptyInventory } from '../src/sim/types'
import { resolveMindIntent, parseMindJson } from '../src/mind/parse'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function totalCoins(sim: Simulation): number {
  let sum = sim.state.treasury
  for (const a of sim.state.agents) sum += a.wallet
  return sum
}

function findOpenPlot(sim: Simulation): { x: number; y: number } {
  const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
  for (let r = 4; r <= 10; r++) {
    for (let angle = 0; angle < 48; angle++) {
      const rad = (angle / 48) * Math.PI * 2
      const hx = Math.round(plaza.x + Math.cos(rad) * r)
      const hy = Math.round(plaza.y + Math.sin(rad) * r)
      if (hx < 2 || hy < 2 || hx >= sim.state.width - 2 || hy >= sim.state.height - 2) {
        continue
      }
      const t = sim.state.tiles[hy * sim.state.width + hx]!
      if (!t.walkable || t.kind === 'water' || t.kind === 'rock') continue
      let blocked = false
      for (const p of sim.state.places) {
        if (Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy)) < 2) {
          blocked = true
          break
        }
      }
      if (!blocked) return { x: hx, y: hy }
    }
  }
  throw new Error('no open plot')
}

function forceComplete(sim: Simulation, site: Place, workerId = 'agent-3'): void {
  const worker = sim.state.agents.find((a) => a.id === workerId)!
  for (const a of sim.state.agents) {
    if (a.id === workerId) continue
    a.x = 2
    a.y = 2
    a.lastDecideTick = sim.state.tick
    a.action = { kind: 'idle', reason: 'parked' }
    a.employedAt = null
  }
  if (site.construction?.needs) {
    for (const g of Object.keys(site.construction.needs) as Array<'wood' | 'stone'>) {
      site.inventory[g] = (site.inventory[g] ?? 0) + (site.construction.needs[g] ?? 0)
      site.construction.needs[g] = 0
    }
  }
  worker.collapsed = false
  worker.employedAt = null
  worker.workPhase = null
  worker.needs.hunger = 0.9
  worker.needs.energy = 0.9
  worker.x = site.x
  worker.y = site.y
  worker.lastDecideTick = sim.state.tick
  const intent = {
    kind: 'work' as const,
    targetPlaceId: site.id,
    targetX: site.x,
    targetY: site.y,
    reason: 'finish site',
  }
  sim.postExternalIntent(workerId, intent, meta('finish site'))
  const labour =
    BUILD_RECIPES[(site.construction?.targetKind ?? 'home') as BuildableKind]
      ?.labourTicks ?? 900
  for (let i = 0; i < labour + 40; i++) {
    if (site.kind !== 'construction-site') break
    worker.collapsed = false
    worker.x = site.x
    worker.y = site.y
    if (worker.action.kind !== 'work') {
      worker.employedAt = null
      worker.workPhase = null
      worker.lastDecideTick = sim.state.tick
      sim.postExternalIntent(workerId, intent, meta('finish site'))
    } else {
      worker.lastDecideTick = sim.state.tick
    }
    sim.advanceTicks(1)
  }
}

describe('P4-4 A — founder owns what they found', () => {
  const kinds = Object.keys(BUILD_RECIPES) as BuildableKind[]

  it.each(kinds)('commissioned %s deeds to the commissioner', (kind) => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 80
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', kind, plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    forceComplete(sim, site)
    expect(site.kind).toBe(kind)
    expect(sim.state.owners[site.id]).toBe('agent-0')
    const deed = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'ownership:transfer' &&
          e.data?.placeId === site.id &&
          e.data?.firstPrivate === true,
      )
    expect(deed.length).toBeGreaterThanOrEqual(1)
  })

  it('worldgen places stay commons (default preset)', () => {
    const sim = new Simulation(42)
    for (const p of sim.state.places) {
      if (p.kind === 'construction-site') continue
      expect(sim.state.owners[p.id]).toBe('commons')
    }
  })

  it('owned stall sales revenue goes to owner; coins conserved', () => {
    const sim = new Simulation(42)
    const stall = sim.state.places.find((p) => p.kind === 'stall')!
    const owner = sim.state.agents.find((a) => a.id === 'agent-0')!
    const buyer = sim.state.agents.find((a) => a.id === 'agent-1')!
    sim.state.owners[stall.id] = owner.id
    stall.inventory.food = 10
    stall.price = { food: 5 }
    owner.wallet = 40
    buyer.wallet = 30
    const t0 = totalCoins(sim)
    const ownerBefore = owner.wallet

    // Park buyer on a stall slot
    for (const a of sim.state.agents) {
      if (a.id === buyer.id) continue
      a.x = 2
      a.y = 2
      a.lastDecideTick = sim.state.tick
      a.action = { kind: 'idle', reason: 'parked' }
    }
    let slot: { x: number; y: number } | null = null
    for (let dy = -1; dy <= 1 && !slot; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = stall.x + dx
        const y = stall.y + dy
        if (isSlotTile(sim.state, stall, x, y)) {
          slot = { x, y }
          break
        }
      }
    }
    expect(slot).toBeTruthy()
    buyer.x = slot!.x
    buyer.y = slot!.y
    buyer.collapsed = false
    buyer.lastDecideTick = sim.state.tick
    sim.postExternalIntent(
      buyer.id,
      {
        kind: 'buy',
        targetPlaceId: stall.id,
        targetX: slot!.x,
        targetY: slot!.y,
        reason: 'buy food',
      },
      meta('buy food'),
    )
    for (let i = 0; i < 5; i++) sim.advanceTicks(1)

    expect(owner.wallet).toBeGreaterThan(ownerBefore)
    expect(totalCoins(sim)).toBe(t0)
    const buyEv = sim
      .getEvents()
      .filter((e) => e.type === 'coins:transfer' && e.data?.kind === 'buy')
      .at(-1)
    expect(buyEv?.data?.to).toBe(owner.id)
    expect(buyEv?.data?.toOwner).toBe(true)
  })

  it('owned workplace wages come from owner wallet; coins conserved', () => {
    const sim = new Simulation(42)
    const farm = sim.state.places.find((p) => p.kind === 'farm')!
    const owner = sim.state.agents.find((a) => a.id === 'agent-0')!
    const worker = sim.state.agents.find((a) => a.id === 'agent-5')!
    sim.state.owners[farm.id] = owner.id
    owner.wallet = 100
    worker.wallet = 10
    worker.employedAt = farm.id
    worker.workedTicks = 300
    worker.daysIdleOnJob = 0
    // Clear other employees so only this wage fires from the owner
    for (const a of sim.state.agents) {
      if (a.id !== worker.id) a.employedAt = null
    }
    const coins0 = totalCoins(sim)
    const ownerBefore = owner.wallet
    const workerBefore = worker.wallet
    const startTick = sim.state.tick

    // Land on the next 18:00 tick (wage day fires inside that step)
    while (true) {
      const hour = Math.floor((sim.state.tick % 1440) / 60)
      const minute = sim.state.tick % 60
      if (hour === 17 && minute === 59) break
      sim.advanceTicks(1)
      if (sim.state.tick > startTick + 1500) throw new Error('missed wage hour')
    }
    worker.workedTicks = 300
    worker.employedAt = farm.id
    sim.advanceTicks(1) // → 18:00

    expect(worker.wallet).toBe(workerBefore + (farm.wage ?? 0))
    expect(owner.wallet).toBe(ownerBefore - (farm.wage ?? 0))
    expect(totalCoins(sim)).toBe(coins0)
    const wageEv = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'coins:transfer' &&
          e.data?.kind === 'wage' &&
          e.data?.placeId === farm.id,
      )
      .at(-1)
    expect(wageEv?.data?.from).toBe(owner.id)
    expect(wageEv?.data?.fromOwner).toBe(true)
  })
})

describe('P4-4 C — menu knowable + parser honesty + same-kind ownership', () => {
  it('same-kind ownership refuses; different kind allowed', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 80
    const home = sim.state.places.find((p) => p.kind === 'home')!
    sim.state.owners[home.id] = 'agent-0'

    expect(sim.commission('agent-0', 'home')).toBe(false)
    const refuse = sim
      .getEvents()
      .filter((e) => e.type === 'construction:commission-refused')
      .at(-1)
    expect(refuse?.data?.why).toBe('already-owns')
    expect(String(refuse?.data?.felt)).toMatch(/you already own a home/i)
    expect(String(refuse?.data?.felt)).toMatch(/different kind/i)
    expect(String(refuse?.data?.felt)).toMatch(/stall/)

    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'stall', plot.x, plot.y)).toBe(true)
    expect(sim.state.places.some((p) => p.kind === 'construction-site')).toBe(true)
  })

  it('unknown commission target refuses with menu felt line (not mapped to home)', () => {
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    mira.wallet = 80
    const parsed = parseMindJson(
      JSON.stringify({
        action: 'commission',
        target: 'workshop',
        reasoning: 'I will raise a workshop for lasting craft.',
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const intent = resolveMindIntent(sim.state, mira, parsed.raw)
    expect(intent.kind).toBe('commission')
    expect(intent.placeKind).toBe('workshop')

    sim.postExternalIntent('agent-0', intent, meta(intent.reason))
    sim.advanceTicks(1)
    const refuse = sim
      .getEvents()
      .find((e) => e.type === 'construction:commission-refused')
    expect(refuse?.data?.why).toBe('unknown-kind')
    expect(String(refuse?.data?.felt)).toMatch(/unknown-kind: workshop/)
    expect(String(refuse?.data?.felt)).toMatch(/buildable kinds are/)
    expect(sim.state.places.every((p) => p.kind !== 'construction-site')).toBe(true)
  })

  it('WORLD_RULES buildable menu is generated from BUILD_RECIPES', () => {
    const before = buildSystemPrompt('agent-0')
    expect(before).toContain(buildableMenuLine())
    const original = { ...BUILD_RECIPES.stall }
    BUILD_RECIPES.stall = { wood: 99, stone: 77, labourTicks: original.labourTicks }
    try {
      const after = buildSystemPrompt('agent-0')
      expect(after).toContain('stall 99/77')
      expect(after).toContain(buildableMenuLine())
      expect(before).not.toContain('stall 99/77')
    } finally {
      BUILD_RECIPES.stall = original
    }
  })

  it('examine construction site names kind, owner, remaining bill', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 80
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'stall', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    site.construction!.needs = { wood: 5, stone: 0 }
    const text = examineKnowledgeFor(site, {
      owners: sim.state.owners,
      agents: sim.state.agents,
    })
    expect(text).toMatch(/stall taking shape/i)
    expect(text).toContain(`${agent.name}'s`)
    expect(text).toMatch(/still needs 5 wood/)
  })

  it('examine completed private place names owner', () => {
    const sim = new Simulation(42)
    const home = sim.state.places.find((p) => p.kind === 'home')!
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    sim.state.owners[home.id] = agent.id
    const text = examineKnowledgeFor(home, {
      owners: sim.state.owners,
      agents: sim.state.agents,
    })
    expect(text).toContain(`${agent.name}'s`)
  })
})

describe('P4-4 B — collapse is perceptible + give recovers', () => {
  it(`collapsed agent appears in Nearby within ${COLLAPSE_VIEW_RADIUS} tiles`, () => {
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const sela = sim.state.agents.find((a) => a.name === 'Sela')!
    sela.collapsed = true
    sela.needs.hunger = 0.01
    mira.x = 20
    mira.y = 20
    sela.x = 20 + 9
    sela.y = 20
    const user = buildUserPrompt(mira, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toMatch(/Sela \(COLLAPSED, \d+ tiles E\)/)
  })

  it('plaza news line names collapsed villager', () => {
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const sela = sim.state.agents.find((a) => a.name === 'Sela')!
    sela.collapsed = true
    sela.needs.hunger = 0.01
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    mira.x = plaza.x
    mira.y = plaza.y
    sela.x = plaza.x + 8
    sela.y = plaza.y
    const user = buildUserPrompt(mira, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toMatch(/News: Sela is collapsed/)
  })

  it('give food to adjacent collapsed villager recovers them', () => {
    const sim = new Simulation(42)
    const giver = sim.state.agents.find((a) => a.id === 'agent-0')!
    const target = sim.state.agents.find((a) => a.name === 'Sela')!
    giver.inventory = { ...emptyInventory(), food: 3 }
    giver.x = 15
    giver.y = 15
    target.x = 16
    target.y = 15
    target.collapsed = true
    target.needs.hunger = 0.01
    target.inventory = emptyInventory()

    sim.postExternalIntent(
      giver.id,
      {
        kind: 'give',
        targetAgentId: target.id,
        targetX: target.x,
        targetY: target.y,
        reason: 'feed the fallen',
      },
      meta('feed the fallen'),
    )
    sim.advanceTicks(1)

    expect(giver.inventory.food).toBe(2)
    expect(target.collapsed).toBe(false)
    expect(target.needs.hunger).toBeGreaterThanOrEqual(0.25)
    expect(
      sim.getEvents().some(
        (e) =>
          e.type === 'goods:transfer' &&
          e.data?.fromId === giver.id &&
          e.data?.toId === target.id &&
          e.data?.good === 'food',
      ),
    ).toBe(true)
    expect(sim.getEvents().some((e) => e.type === 'agent:recovered')).toBe(true)
    expect(totalCoins(sim)).toBe(24 * 20 + 200)
  })
})

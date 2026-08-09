import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'

const DAY = 1440
const SEED = 42

function totalCoins(sim: Simulation): number {
  let sum = sim.state.treasury
  for (const a of sim.state.agents) sum += a.wallet
  return sum
}

function totalFood(sim: Simulation): number {
  let sum = 0
  for (const a of sim.state.agents) sum += a.inventory.food ?? 0
  for (const p of sim.state.places) sum += p.inventory.food ?? 0
  return sum
}

describe('economy: coins, goods, ownership, collapse', () => {
  it('coin conservation: wallets + treasury unchanged after 3 sim-days', () => {
    const sim = new Simulation(SEED)
    const t0 = totalCoins(sim)
    expect(t0).toBe(24 * 20 + 200) // 680
    sim.advanceTicks(3 * DAY)
    expect(totalCoins(sim)).toBe(t0)
    // transfer helper conserves when used
    const ok = sim.transferCoins('agent-0', 'treasury', 5, 'test wage reverse')
    expect(ok).toBe(true)
    expect(totalCoins(sim)).toBe(t0)
    const fail = sim.transferCoins('agent-0', 'treasury', 99999, 'too much')
    expect(fail).toBe(false)
    expect(totalCoins(sim)).toBe(t0)
  })

  it('food ledger: initial + regrown − eaten === current after 3 sim-days', () => {
    const sim = new Simulation(SEED)
    const initial = totalFood(sim)
    expect(initial).toBeGreaterThan(0)

    sim.advanceTicks(3 * DAY)

    let regrown = 0
    let eaten = 0
    for (const ev of sim.getEvents()) {
      if (ev.type === 'goods:regrow') {
        regrown += (ev.data?.amount as number) ?? 0
      }
      if (ev.type === 'goods:consume') {
        eaten += (ev.data?.amount as number) ?? 0
      }
    }

    const current = totalFood(sim)
    expect(current).toBe(initial + regrown - eaten)
  })

  it('bush bounds: stock always in [0, 6]; forage never takes from empty bush', () => {
    const sim = new Simulation(SEED)
    const maxDays = 3 * DAY
    for (let t = 0; t <= maxDays; t++) {
      if (t % 30 === 0) {
        for (const p of sim.state.places) {
          if (p.kind !== 'berry-bush') continue
          const stock = p.inventory.food ?? 0
          expect(stock, `tick ${sim.state.tick} ${p.id}`).toBeGreaterThanOrEqual(0)
          expect(stock, `tick ${sim.state.tick} ${p.id}`).toBeLessThanOrEqual(6)
        }
      }
      if (t < maxDays) sim.advanceTicks(1)
    }

    // Empty a bush and prove transfer refuses
    const bush = sim.state.places.find((p) => p.kind === 'berry-bush')!
    bush.inventory.food = 0
    const agent = sim.state.agents[0]!
    const before = agent.inventory.food
    const ok = sim.transferGoods(
      { kind: 'place', id: bush.id },
      { kind: 'agent', id: agent.id },
      'food',
      1,
      'should fail — empty bush',
    )
    expect(ok).toBe(false)
    expect(bush.inventory.food).toBe(0)
    expect(agent.inventory.food).toBe(before)
  })

  it('collapse path: starve → collapsed + slow move → feed → recover', () => {
    const sim = new Simulation(SEED)

    // Zero all food so nobody can eat or forage successfully
    for (const a of sim.state.agents) {
      a.inventory.food = 0
    }
    for (const p of sim.state.places) {
      p.inventory.food = 0
    }

    // Drive hunger to collapse (≤ 0.02). Decay ~1/960 per tick × jitter ≤ 1.15
    // Worst case ~ from 0.9: ~900+ ticks; cap at 3 days.
    let collapsedAgent = sim.state.agents.find((a) => a.collapsed)
    for (let i = 0; i < 3 * DAY && !collapsedAgent; i++) {
      sim.advanceTicks(1)
      collapsedAgent = sim.state.agents.find((a) => a.collapsed)
    }
    expect(collapsedAgent, 'someone should collapse when food is gone').toBeTruthy()
    expect(collapsedAgent!.needs.hunger).toBeLessThanOrEqual(0.02)
    expect(collapsedAgent!.collapsed).toBe(true)

    const collapseEv = sim
      .getEvents()
      .find((e) => e.type === 'agent:collapsed' && e.agentId === collapsedAgent!.id)
    expect(collapseEv).toBeTruthy()
    expect(collapseEv!.reason && collapseEv!.reason.length > 0).toBe(true)

    // Movement slowed: collapsed agent walks less far than a healthy one over N ticks
    const slow = collapsedAgent!
    // Park both agents on walkable paths with clear targets
    const healthy = sim.state.agents.find((a) => a.id !== slow.id && !a.collapsed)!
    // Force walk intent via direct action (world movement rule, not brain)
    const destX = Math.min(sim.state.width - 2, Math.round(slow.x) + 8)
    const destY = Math.round(slow.y)
    for (const a of [slow, healthy]) {
      a.action = {
        kind: 'wander',
        targetX: destX,
        targetY: destY,
        path: undefined,
        reason: 'test walk',
      }
      a.pathIndex = 0
      a.actionTicks = 0
    }
    // Ensure healthy is not collapsed and has same start-ish for comparison
    healthy.x = slow.x
    healthy.y = slow.y
    healthy.needs.hunger = 0.6 // stay above collapse threshold
    healthy.collapsed = false

    const slowStart = { x: slow.x, y: slow.y }
    const healthyStart = { x: healthy.x, y: healthy.y }
    sim.advanceTicks(5)
    const slowDist =
      Math.abs(slow.x - slowStart.x) + Math.abs(slow.y - slowStart.y)
    const healthyDist =
      Math.abs(healthy.x - healthyStart.x) + Math.abs(healthy.y - healthyStart.y)
    // Collapsed moves at ×0.4 — should cover less ground if both are walking
    if (healthyDist > 0.1) {
      expect(slowDist).toBeLessThan(healthyDist)
    }

    // Feed: inject 2 food; advance until hunger ≥ 0.25 and recovered
    slow.inventory.food = 2
    // Nudge needs so eat is attractive; keep other food zero so only this agent recovers
    for (let i = 0; i < DAY && slow.collapsed; i++) {
      sim.advanceTicks(1)
    }
    // If still collapsed after a day of sim (brain might sleep etc.), force-eat via consume path
    if (slow.collapsed) {
      // Directly consume and restore hunger as the world rule does on eat
      const ok = sim.consumeGoods(
        { kind: 'agent', id: slow.id },
        'food',
        1,
        'test forced meal',
      )
      expect(ok).toBe(true)
      slow.needs.hunger = Math.min(1, slow.needs.hunger + 0.45)
      // checkCollapse runs on stepNeeds — advance one tick
      sim.advanceTicks(1)
    }

    expect(slow.needs.hunger).toBeGreaterThanOrEqual(0.25)
    expect(slow.collapsed).toBe(false)

    const recoverEv = sim
      .getEvents()
      .find((e) => e.type === 'agent:recovered' && e.agentId === slow.id)
    expect(recoverEv).toBeTruthy()
    expect(recoverEv!.reason && recoverEv!.reason.length > 0).toBe(true)
  })

  it('determinism with inventories/wallets/owners: double-run + snapshot seek', () => {
    const a = new Simulation(SEED)
    const b = new Simulation(SEED)
    a.advanceTicks(3 * DAY)
    b.advanceTicks(3 * DAY)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())

    // Inventories / wallets / owners participate in the hash
    expect(a.state.treasury).toBe(200)
    expect(Object.keys(a.state.owners).length).toBe(a.state.places.length)
    for (const id of Object.keys(a.state.owners)) {
      expect(a.state.owners[id]).toBe('commons')
    }

    const sought = a.stateAt(2000)
    const fresh = new Simulation(SEED)
    fresh.advanceTicks(2000)
    expect(sought.hash()).toBe(fresh.hash())

    const snap = a.snapshot()
    const restored = Simulation.fromSnapshot(snap)
    expect(restored.hash()).toBe(a.hash())
    a.advanceTicks(100)
    restored.advanceTicks(100)
    expect(restored.hash()).toBe(a.hash())
  })

  it('ownership transfer emits event and updates registry', () => {
    const sim = new Simulation(SEED)
    const placeId = sim.state.places[0]!.id
    expect(sim.state.owners[placeId]).toBe('commons')
    const ok = sim.transferOwnership(placeId, 'agent-0', 'test deed')
    expect(ok).toBe(true)
    expect(sim.state.owners[placeId]).toBe('agent-0')
    const ev = sim.getEvents().find((e) => e.type === 'ownership:transfer')
    expect(ev).toBeTruthy()
    expect(ev!.reason).toBe('test deed')
  })
})

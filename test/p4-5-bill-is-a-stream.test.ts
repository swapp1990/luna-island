import { describe, expect, it } from 'vitest'
import {
  BUILD_RECIPES,
  GATHER_CARRY,
  GATHER_CARRY_CAP,
  MAX_ACTIVE_SITES,
  Simulation,
  buildableMenuLine,
} from '../src/sim/sim'
import { EXAMINE_BY_KIND } from '../src/sim/examine'
import { knowledgeLinesForPrompt } from '../src/mind/knowledge'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'
import { SAVE_FORMAT_VERSION } from '../src/sim/persist'
import type { BuildableKind, ExternalIntentMeta, Place } from '../src/sim/types'
import { emptyInventory } from '../src/sim/types'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

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

function lastRefusal(sim: Simulation) {
  return sim
    .getEvents()
    .filter((e) => e.type === 'construction:commission-refused')
    .at(-1)
}

describe('P4-5 A — bill is a stream', () => {
  it('WORLD_RULES states deliveries-over-time and interpolates GATHER_CARRY_CAP + BUILD_RECIPES', () => {
    expect(GATHER_CARRY.cap).toBe(GATHER_CARRY_CAP)
    const before = buildSystemPrompt('agent-0')
    expect(before).toMatch(
      /Commissioning marks a construction site on buildable ground; no materials in hand are needed to commission/,
    )
    expect(before).toContain(buildableMenuLine())
    expect(buildableMenuLine()).toMatch(
      /^Site bills, total wood\/stone delivered over time:/,
    )
    expect(before).toContain(
      `A site accepts deliveries over many trips, from anyone; you can carry at most ${GATHER_CARRY_CAP} of a good per trip; working at the site builds while it holds materials.`,
    )
    expect(before).not.toContain('Buildable (wood/stone):')
    expect(before).not.toMatch(/commissioned on buildable ground for wood/)

    const origHome = { ...BUILD_RECIPES.home }
    const origCap = GATHER_CARRY.cap
    BUILD_RECIPES.home = { wood: 99, stone: 77, labourTicks: origHome.labourTicks }
    GATHER_CARRY.cap = 9
    try {
      const after = buildSystemPrompt('agent-0')
      expect(after).toContain('home 99/77')
      expect(after).toContain(buildableMenuLine())
      expect(after).toContain('at most 9 of a good per trip')
      expect(before).not.toContain('home 99/77')
      expect(before).not.toContain('at most 9 of a good per trip')
      expect(before).toContain(`at most ${origCap} of a good per trip`)
    } finally {
      BUILD_RECIPES.home = origHome
      GATHER_CARRY.cap = origCap
    }
  })

  it('menu line is generated from BUILD_RECIPES keys and wood/stone', () => {
    const line = buildableMenuLine()
    for (const kind of Object.keys(BUILD_RECIPES) as BuildableKind[]) {
      const r = BUILD_RECIPES[kind]
      expect(line).toContain(`${kind} ${r.wood}/${r.stone}`)
    }
  })

  it('wild commission succeeds with an empty inventory (no materials at commission)', () => {
    const sim = new Simulation(42, { preset: 'wild' })
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 0
    agent.inventory = emptyInventory()
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'home', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')
    expect(site).toBeTruthy()
    expect(site!.construction?.targetKind).toBe('home')
    expect(agent.inventory.wood).toBe(0)
    expect(agent.inventory.stone).toBe(0)
    expect(sim.getEvents().some((e) => e.type === 'construction:commissioned')).toBe(
      true,
    )
  })

  it('refusal felt lines never contain "you carry"', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!

    agent.wallet = 0
    expect(sim.commission('agent-0', 'home')).toBe(false)
    const cannotAfford = lastRefusal(sim)
    expect(cannotAfford?.data?.why).toBe('cannot-afford')
    expect(String(cannotAfford?.data?.felt)).not.toContain('you carry')
    expect(String(cannotAfford?.data?.felt)).toMatch(/30-coin fee, you have 0/)
    expect(String(cannotAfford?.data?.felt)).not.toMatch(/wood|stone/)

    agent.wallet = 80
    expect(sim.commission('agent-0', 'well', 0, 0)).toBe(false)
    const notBuildable = lastRefusal(sim)
    expect(notBuildable?.data?.why).toBe('tile-not-buildable')
    expect(String(notBuildable?.data?.felt)).not.toContain('you carry')
    expect(String(notBuildable?.data?.felt)).toMatch(
      /the site's bill is 2 wood \/ 16 stone, filled by deliveries over time/,
    )

    expect(sim.commission('agent-0', 'workshop')).toBe(false)
    const unknown = lastRefusal(sim)
    expect(unknown?.data?.why).toBe('unknown-kind')
    expect(String(unknown?.data?.felt)).not.toContain('you carry')

    const home = sim.state.places.find((p) => p.kind === 'home')!
    sim.state.owners[home.id] = 'agent-0'
    expect(sim.commission('agent-0', 'home')).toBe(false)
    const alreadyOwns = lastRefusal(sim)
    expect(alreadyOwns?.data?.why).toBe('already-owns')
    expect(String(alreadyOwns?.data?.felt)).not.toContain('you carry')
    expect(String(alreadyOwns?.data?.felt)).not.toMatch(/\d+ wood/)

    sim.state.owners[home.id] = 'commons'
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'stall', plot.x, plot.y)).toBe(true)
    const plot2 = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'farm', plot2.x, plot2.y)).toBe(false)
    const alreadyCommissioning = lastRefusal(sim)
    expect(alreadyCommissioning?.data?.why).toBe('already-commissioning')
    expect(String(alreadyCommissioning?.data?.felt)).not.toContain('you carry')
    expect(String(alreadyCommissioning?.data?.felt)).not.toMatch(/\d+ wood/)

    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).not.toContain('you carry')
  })

  it('site-cap refusal does not mention materials in hand', () => {
    const sim = new Simulation(42)
    const agents = sim.state.agents.slice(0, MAX_ACTIVE_SITES + 1)
    for (const a of agents) a.wallet = 80
    const plots: Array<{ x: number; y: number }> = []
    for (let i = 0; i < MAX_ACTIVE_SITES; i++) {
      const plot = findOpenPlot(sim)
      plots.push(plot)
      expect(sim.commission(agents[i]!.id, 'farm', plot.x, plot.y)).toBe(true)
    }
    const extra = findOpenPlot(sim)
    expect(sim.commission(agents[MAX_ACTIVE_SITES]!.id, 'farm', extra.x, extra.y)).toBe(
      false,
    )
    const cap = lastRefusal(sim)
    expect(cap?.data?.why).toBe('site-cap')
    expect(String(cap?.data?.felt)).not.toContain('you carry')
    expect(String(cap?.data?.felt)).not.toMatch(/\d+ wood/)
  })
})

describe('P4-5 B — builders know what they built', () => {
  it('completion appends founder-knowledge and knowledgeLinesForPrompt surfaces it', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 80
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'notice-board', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    const siteId = site.id
    forceComplete(sim, site)
    expect(site.kind).toBe('notice-board')

    const examined = sim
      .getEvents()
      .filter(
        (e) =>
          e.type === 'discovery:examined' &&
          e.agentId === 'agent-0' &&
          e.data?.target === siteId,
      )
    expect(examined.length).toBe(1)
    expect(examined[0]!.data?.knowledge).toBe(EXAMINE_BY_KIND['notice-board'])
    expect(String(examined[0]!.reason)).toMatch(/built this notice board and knows its workings/)

    const known = knowledgeLinesForPrompt(
      'agent-0',
      sim.getEvents(),
      sim.state.mindNoteLog,
    )
    expect(known).toContain(EXAMINE_BY_KIND['notice-board'])

    const user = buildUserPrompt(agent, sim.state, sim.getEvents(), sim.state.mindNoteLog)
    expect(user).toContain(EXAMINE_BY_KIND['notice-board'])
  })

  it('commons-commissioned completion appends no founder-knowledge event', () => {
    const sim = new Simulation(42)
    const agent = sim.state.agents.find((a) => a.id === 'agent-0')!
    agent.wallet = 80
    const plot = findOpenPlot(sim)
    expect(sim.commission('agent-0', 'well', plot.x, plot.y)).toBe(true)
    const site = sim.state.places.find((p) => p.kind === 'construction-site')!
    const siteId = site.id
    sim.state.owners[siteId] = 'commons'
    forceComplete(sim, site)
    expect(site.kind).toBe('well')
    const examined = sim
      .getEvents()
      .filter(
        (e) => e.type === 'discovery:examined' && e.data?.target === siteId,
      )
    expect(examined).toHaveLength(0)
    const known = knowledgeLinesForPrompt(
      'agent-0',
      sim.getEvents(),
      sim.state.mindNoteLog,
    )
    expect(known).not.toContain(EXAMINE_BY_KIND.well)
  })

  it('save format version is unchanged', () => {
    expect(SAVE_FORMAT_VERSION).toBe(5)
  })
})

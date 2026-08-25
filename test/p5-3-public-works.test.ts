// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { readFileSync } from 'node:fs'
import { NO_RECORDED_WORLDS, recordedWorldPaths } from './recordedWorlds'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COMMISSION_COOLDOWN_TICKS,
  MAX_ACTIVE_SITES,
  PROPOSAL_QUORUM,
  PUBLIC_WORKS_STAKE,
  SNAPSHOT_INTERVAL,
  Simulation,
  buildableKindList,
  isSheepAgent,
} from '../src/sim/sim'
import {
  restoreSave,
  serializeSave,
  SAVE_FORMAT_VERSION,
} from '../src/sim/persist'
import { emptyInventory, type ExternalIntentMeta, type Place } from '../src/sim/types'
import { parseMindJson, resolveMindIntent } from '../src/mind/parse'
import { buildSystemPrompt, buildUserPrompt } from '../src/mind/prompt'
import { EXAMINE_BY_KIND } from '../src/sim/examine'
import { publicWorksRuleLine } from '../src/sim/costs'

const meta = (reasoning: string): ExternalIntentMeta => ({
  reasoning,
  source: 'luna',
  provider: 'mock',
  latencyMs: 1,
  approxChars: 80,
})

function allCoins(sim: Simulation): number {
  let sum = sim.state.treasury
  for (const a of sim.state.agents) sum += a.wallet
  for (const p of sim.state.places) sum += p.wallet ?? 0
  return sum
}

function isPlotBuildable(sim: Simulation, hx: number, hy: number): boolean {
  if (hx < 1 || hy < 1 || hx >= sim.state.width - 1 || hy >= sim.state.height - 1) {
    return false
  }
  const t = sim.state.tiles[hy * sim.state.width + hx]
  if (!t || !t.walkable || t.kind === 'water' || t.kind === 'rock') return false
  for (const p of sim.state.places) {
    if (
      p.kind === 'home' ||
      p.kind === 'construction-site' ||
      p.kind === 'farm' ||
      p.kind === 'stall' ||
      p.kind === 'storehouse' ||
      p.kind === 'plaza' ||
      p.kind === 'well'
    ) {
      if (Math.max(Math.abs(p.x - hx), Math.abs(p.y - hy)) < 2) return false
    }
  }
  return true
}

function nearestBuildableTo(sim: Simulation, cx: number, cy: number): { x: number; y: number } {
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (let y = 1; y < sim.state.height - 1; y++) {
    for (let x = 1; x < sim.state.width - 1; x++) {
      if (!isPlotBuildable(sim, x, y)) continue
      const d = (x - cx) ** 2 + (y - cy) ** 2
      const closer = d < bestD - 1e-12
      const tie =
        Math.abs(d - bestD) <= 1e-12 &&
        (!best || x < best.x || (x === best.x && y < best.y))
      if (closer || tie) {
        bestD = d
        best = { x, y }
      }
    }
  }
  if (!best) throw new Error('no buildable plot')
  return best
}

function findOpenPlot(sim: Simulation): { x: number; y: number } {
  for (let y = 2; y < sim.state.height - 2; y++) {
    for (let x = 2; x < sim.state.width - 2; x++) {
      if (isPlotBuildable(sim, x, y)) return { x, y }
    }
  }
  throw new Error('no open plot')
}

function bindingYes(sim: Simulation, proposalId: string): void {
  const p = sim.state.proposals.find((pr) => pr.id === proposalId)
  if (!p) throw new Error(`missing ${proposalId}`)
  const minds = sim.state.agents.filter((a) => !isSheepAgent(a.id)).map((a) => a.id)
  const voters = minds.filter((id) => id !== p.proposerId).slice(0, PROPOSAL_QUORUM)
  expect(voters.length).toBeGreaterThanOrEqual(PROPOSAL_QUORUM)
  for (const v of voters) expect(sim.vote(v, proposalId, 'yes')).toBe(true)
}

function passProposal(sim: Simulation, proposalId: string): void {
  bindingYes(sim, proposalId)
  const p = sim.state.proposals.find((pr) => pr.id === proposalId)!
  p.closesTick = sim.state.tick
  sim.advanceTicks(1)
}

function parkFar(sim: Simulation, keep: ReadonlySet<string>): void {
  let x = 2
  let y = 2
  for (const a of sim.state.agents) {
    if (keep.has(a.id)) continue
    a.x = x
    a.y = y
    a.action = { kind: 'idle', reason: 'parked' }
    a.lastDecideTick = sim.state.tick
    a.employedAt = null
    a.workPhase = null
    a.pathIndex = 0
    x++
    if (x > 12) {
      x = 2
      y++
    }
  }
}

function forceComplete(sim: Simulation, site: Place, workerId: string): void {
  const worker = sim.state.agents.find((a) => a.id === workerId)!
  const c = site.construction
  if (!c) throw new Error('no construction spec')
  const siteId = site.id
  c.needs = {}
  c.progress = 0.999
  parkFar(sim, new Set([workerId]))
  worker.collapsed = false
  worker.employedAt = null
  worker.workPhase = null
  worker.x = site.x
  worker.y = site.y
  worker.action = { kind: 'idle', reason: 'ready' }
  worker.lastDecideTick = sim.state.tick
  sim.postExternalIntent(
    workerId,
    {
      kind: 'work',
      targetPlaceId: site.id,
      targetX: site.x,
      targetY: site.y,
      reason: 'finish the build',
    },
    meta('finish the build'),
  )
  for (let i = 0; i < 12; i++) {
    sim.advanceTicks(1)
    const live = sim.state.places.find((p) => p.id === siteId)
    if (!live || live.kind !== 'construction-site') return
  }
  throw new Error(`site ${siteId} did not complete`)
}

function fillSiteCap(sim: Simulation): void {
  for (let i = 0; i < MAX_ACTIVE_SITES; i++) {
    const id = `cap-site-${i}`
    sim.state.places.push({
      id,
      kind: 'construction-site',
      x: 2,
      y: 2 + i * 2,
      slots: 2,
      inventory: emptyInventory(),
      construction: {
        needs: { wood: 1 },
        progress: 0,
        consumeTicks: 0,
        targetKind: 'home',
      },
    })
    sim.state.owners[id] = 'commons'
  }
}

describe('P5-3 public works', () => {
  it('a passed build-proposal commissions a commons site and does not consume cooldown', () => {
    const sim = new Simulation(42)
    const proposer = sim.state.agents.find((a) => a.id === 'agent-0')!
    sim.state.commissionCooldownUntil = {
      'agent-0': sim.state.tick + COMMISSION_COOLDOWN_TICKS,
    }
    const until = sim.state.commissionCooldownUntil['agent-0']
    const sitesBefore = sim.state.places.filter((p) => p.kind === 'construction-site').length
    expect(sim.propose('agent-0', 'Raise a second well for the village', { kind: 'well' })).toBe(
      true,
    )
    const proposed = sim.getEvents().find((e) => e.type === 'institution:proposed')
    expect(proposed?.data?.build).toEqual({ kind: 'well' })
    const id = sim.state.proposals[0]!.id
    passProposal(sim, id)
    expect(sim.state.proposals[0]!.status).toBe('passed')
    expect(sim.state.rules.some((r) => r.text === 'Raise a second well for the village')).toBe(
      true,
    )
    const sites = sim.state.places.filter((p) => p.kind === 'construction-site')
    expect(sites.length).toBe(sitesBefore + 1)
    const site = sites.find((p) => p.id === `site-commons-${id}`)!
    expect(site).toBeTruthy()
    expect(sim.state.owners[site.id]).toBe('commons')
    expect(site.construction?.targetKind).toBe('well')
    expect(site.construction?.upgradeOf).toBeUndefined()
    expect(sim.state.commissionCooldownUntil?.['agent-0']).toBe(until)
    const closed = sim.getEvents().find((e) => e.type === 'institution:closed')
    expect(closed?.reason).toMatch(/and a well site was staked by the village/)
    expect(proposer.wallet).toBeGreaterThanOrEqual(0)
  })

  it('rule still binds when the build is skipped at site-cap', () => {
    const sim = new Simulation(42)
    fillSiteCap(sim)
    expect(sim.propose('agent-0', 'Another well', { kind: 'well' })).toBe(true)
    const id = sim.state.proposals[0]!.id
    passProposal(sim, id)
    expect(sim.state.proposals[0]!.status).toBe('passed')
    expect(sim.state.rules.some((r) => r.id === id)).toBe(true)
    const skip = sim.getEvents().find((e) => e.type === 'institution:build-skipped')
    expect(skip?.data?.why).toBe('site-cap')
    expect(sim.state.places.filter((p) => p.kind === 'construction-site')).toHaveLength(
      MAX_ACTIVE_SITES,
    )
    const closed = sim.getEvents().find((e) => e.type === 'institution:closed')
    expect(closed?.reason).not.toMatch(/staked by the village/)
  })

  it('stake moves treasury→site→contributors with conservation', () => {
    const sim = new Simulation(42)
    const before = allCoins(sim)
    expect(sim.state.treasury).toBeGreaterThanOrEqual(PUBLIC_WORKS_STAKE)
    expect(sim.propose('agent-0', 'A village well', { kind: 'well' })).toBe(true)
    const id = sim.state.proposals[0]!.id
    passProposal(sim, id)
    expect(allCoins(sim)).toBe(before)
    const site = sim.state.places.find((p) => p.id === `site-commons-${id}`)!
    expect(site.wallet).toBe(PUBLIC_WORKS_STAKE)
    const stakeEv = sim
      .getEvents()
      .find((e) => e.type === 'coins:transfer' && e.data?.kind === 'public-works-stake')
    expect(stakeEv?.data?.from).toBe('treasury')
    expect(stakeEv?.data?.to).toBe(site.id)
    expect(stakeEv?.data?.amount).toBe(PUBLIC_WORKS_STAKE)

    const hauler = sim.state.agents.find((a) => a.id === 'agent-1')!
    parkFar(sim, new Set(['agent-1']))
    hauler.inventory.wood = 2
    hauler.x = site.x
    hauler.y = site.y
    hauler.action = { kind: 'idle', reason: 'at site' }
    hauler.lastDecideTick = sim.state.tick
    sim.postExternalIntent(
      'agent-1',
      {
        kind: 'deliver',
        targetPlaceId: site.id,
        targetX: site.x,
        targetY: site.y,
        reason: 'drop wood',
      },
      meta('drop wood'),
    )
    for (let i = 0; i < 4; i++) {
      parkFar(sim, new Set(['agent-1']))
      hauler.x = site.x
      hauler.y = site.y
      sim.advanceTicks(1)
    }
    expect(site.construction?.contributors).toContain('agent-1')

    const haulerWallet = hauler.wallet
    const worker = sim.state.agents.find((a) => a.id === 'agent-2')!
    const workerWallet = worker.wallet
    const treasuryAfterStake = sim.state.treasury
    forceComplete(sim, site, 'agent-2')
    expect(allCoins(sim)).toBe(before)
    const share = Math.floor(PUBLIC_WORKS_STAKE / 2)
    expect(hauler.wallet).toBe(haulerWallet + share)
    expect(worker.wallet).toBe(workerWallet + share)
    expect(sim.state.treasury).toBe(treasuryAfterStake + (PUBLIC_WORKS_STAKE - share * 2))
    const bounties = sim
      .getEvents()
      .filter((e) => e.type === 'coins:transfer' && e.data?.kind === 'public-works-bounty')
    expect(bounties.some((e) => e.data?.to === 'agent-1')).toBe(true)
    expect(bounties.some((e) => e.data?.to === 'agent-2')).toBe(true)
  })

  it('zero-treasury stake still builds', () => {
    const sim = new Simulation(42)
    const drain = sim.state.treasury
    if (drain > 0) {
      expect(sim.transferCoins('treasury', 'agent-0', drain, 'test drain treasury')).toBe(true)
    }
    expect(sim.state.treasury).toBe(0)
    const before = allCoins(sim)
    expect(sim.propose('agent-1', 'A commons stall', { kind: 'stall' })).toBe(true)
    const id = sim.state.proposals.find((p) => p.status === 'open')!.id
    passProposal(sim, id)
    const site = sim.state.places.find((p) => p.id === `site-commons-${id}`)
    expect(site).toBeTruthy()
    expect(site!.wallet ?? 0).toBe(0)
    expect(sim.state.owners[site!.id]).toBe('commons')
    expect(allCoins(sim)).toBe(before)
  })

  it('invalid build kind refuses at propose() and fails parse', () => {
    const sim = new Simulation(42)
    expect(sim.propose('agent-0', 'A castle', { kind: 'castle' })).toBe(false)
    expect(sim.state.proposals).toHaveLength(0)
    const refused = sim.getEvents().find((e) => e.type === 'institution:propose-refused')
    expect(refused?.data?.why).toBe('unknown-kind')

    const bad = parseMindJson(
      JSON.stringify({
        action: 'propose',
        text: 'A castle',
        reasoning: 'We need a castle.',
        build: 'castle',
      }),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toBe(`propose build must be one of ${buildableKindList()}`)
    }
  })

  it('coords are validated at post; omitted coords pick the plot nearest the board', () => {
    const sim = new Simulation(42)
    const plaza = sim.state.places.find((p) => p.kind === 'plaza')!
    expect(sim.propose('agent-0', 'Well on the plaza', { kind: 'well', x: plaza.x, y: plaza.y })).toBe(
      false,
    )
    expect(
      sim.getEvents().some((e) => e.data?.why === 'bad-build-site'),
    ).toBe(true)

    const plot = findOpenPlot(sim)
    expect(sim.propose('agent-1', 'Well here', { kind: 'well', x: plot.x, y: plot.y })).toBe(true)
    expect(sim.state.proposals[0]!.build).toEqual({ kind: 'well', x: plot.x, y: plot.y })

    const simB = new Simulation(42)
    const board = simB.state.places.find((p) => p.kind === 'notice-board')!
    const expected = nearestBuildableTo(simB, board.x, board.y)
    expect(simB.propose('agent-0', 'Well wherever it fits', { kind: 'well' })).toBe(true)
    const id = simB.state.proposals[0]!.id
    passProposal(simB, id)
    const site = simB.state.places.find((p) => p.id === `site-commons-${id}`)!
    expect(site.x).toBe(expected.x)
    expect(site.y).toBe(expected.y)
  })

  it('invalid coords at passage fall back to the plot nearest the board', () => {
    const sim = new Simulation(42)
    const plot = findOpenPlot(sim)
    expect(sim.propose('agent-0', 'Well at a spot that will fill', { kind: 'well', x: plot.x, y: plot.y })).toBe(
      true,
    )
    sim.state.places.push({
      id: 'blocker-home',
      kind: 'home',
      x: plot.x,
      y: plot.y,
      slots: 1,
      inventory: emptyInventory(),
    })
    const board = sim.state.places.find((p) => p.kind === 'notice-board')!
    const expected = nearestBuildableTo(sim, board.x, board.y)
    const id = sim.state.proposals[0]!.id
    passProposal(sim, id)
    const site = sim.state.places.find((p) => p.id === `site-commons-${id}`)!
    expect(site.x).not.toBe(plot.x)
    expect(site.y).not.toBe(plot.y)
    expect(site.x).toBe(expected.x)
    expect(site.y).toBe(expected.y)
  })

  it('save round-trips the new fields at v5; stateAt re-sim reproduces the site', () => {
    const sim = new Simulation(42)
    expect(sim.propose('agent-0', 'A public well', { kind: 'well' })).toBe(true)
    const id = sim.state.proposals[0]!.id
    passProposal(sim, id)
    const toSnap = SNAPSHOT_INTERVAL - (sim.state.tick % SNAPSHOT_INTERVAL)
    sim.advanceTicks(toSnap === 0 ? SNAPSHOT_INTERVAL : toSnap)
    const tickA = sim.state.tick
    const hashA = sim.hash()
    const siteA = sim.state.places.find((p) => p.id === `site-commons-${id}`)!
    expect(siteA).toBeTruthy()
    expect(sim.state.proposals[0]!.build).toEqual({ kind: 'well' })

    const save = serializeSave(sim)
    expect(save.formatVersion).toBe(SAVE_FORMAT_VERSION)
    expect(SAVE_FORMAT_VERSION).toBe(5)
    const restored = restoreSave(save)
    expect(restored.hash()).toBe(hashA)
    expect(restored.state.proposals[0]!.build).toEqual({ kind: 'well' })
    expect(restored.state.owners[`site-commons-${id}`]).toBe('commons')
    expect(restored.state.places.find((p) => p.id === `site-commons-${id}`)?.wallet).toBe(
      PUBLIC_WORKS_STAKE,
    )

    const fork = sim.stateAt(tickA)
    expect(fork.hash()).toBe(hashA)
    expect(fork.state.places.find((p) => p.id === `site-commons-${id}`)?.kind).toBe(
      'construction-site',
    )
    expect(fork.state.owners[`site-commons-${id}`]).toBe('commons')
  })

  it('recorded soak worlds still import', (ctx) => {
    const files = recordedWorldPaths([
      'artifacts/soak-1787430602479-world.json',
      'artifacts/soak-1787452399090-world.json',
    ])
    if (files.length === 0) return ctx.skip(NO_RECORDED_WORLDS)
    for (const file of files) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        tick: number
        seed: number
      }
      const loaded = restoreSave(raw)
      expect(loaded.state.tick).toBe(raw.tick)
      expect(loaded.state.seed).toBe(raw.seed)
      expect(loaded.state.agents.length).toBeGreaterThan(0)
    }
  }, 120_000)

  it('parse accepts well and well@x,y; civic lines show [+ well]; prompts state the fact', () => {
    const sim = new Simulation(42)
    const mira = sim.state.agents.find((a) => a.id === 'agent-0')!
    const okKind = parseMindJson(
      JSON.stringify({
        action: 'propose',
        text: 'Raise a well',
        reasoning: 'The existing well is crowded.',
        build: 'well',
      }),
    )
    expect(okKind.ok).toBe(true)
    if (okKind.ok) {
      const intent = resolveMindIntent(sim.state, mira, okKind.raw)
      expect(intent.build).toEqual({ kind: 'well' })
    }
    const okCoords = parseMindJson(
      JSON.stringify({
        action: 'propose',
        text: 'Raise a well',
        reasoning: 'Here.',
        build: 'well@12,20',
      }),
    )
    expect(okCoords.ok).toBe(true)
    if (okCoords.ok) {
      const intent = resolveMindIntent(sim.state, mira, okCoords.raw)
      expect(intent.build).toEqual({ kind: 'well', x: 12, y: 20 })
    }
    const viaIntent = parseMindJson(
      JSON.stringify({
        action: 'propose',
        text: 'Raise a well',
        reasoning: 'The existing well is crowded.',
        build: 'well',
      }),
    )
    expect(viaIntent.ok).toBe(true)
    if (viaIntent.ok) {
      const intent = resolveMindIntent(sim.state, mira, viaIntent.raw)
      expect(sim.propose(mira.id, intent.text ?? '', intent.build)).toBe(true)
    }
    const user = buildUserPrompt(mira, sim.state, sim.getEvents())
    expect(user).toContain('"Raise a well" [+ well] deciding yes')
    const sys = buildSystemPrompt('agent-0')
    expect(sys).toContain(publicWorksRuleLine())
    expect(sys).toContain(
      'propose needs "text" (the rule you want posted) and may carry "build" (a structure kind the village raises as commons if the proposal passes)',
    )
    expect(EXAMINE_BY_KIND['notice-board']).toContain(publicWorksRuleLine())
  })
})

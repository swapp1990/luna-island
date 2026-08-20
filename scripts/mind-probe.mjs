/**
 * Narrow mind-agency probe — real model, no browser.
 *
 * Usage: node scripts/mind-probe.mjs [--port 5188] [--n 10] [--concurrency 3]
 *
 * Boots vite (sidecar only), builds prompts with the real
 * buildSystemPrompt / buildUserPrompt over synthetic fixtures, POSTs to
 * /api/luna/decide, parses with the real parse.ts, writes histograms to
 * stdout and artifacts/mind-probe-<ts>.json.
 *
 * Not wired into npm test / e2e (nondeterministic).
 */
import { createServer } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const PORT = Number(arg('port', '5188'))
const N = Number(arg('n', '10'))
const CONCURRENCY = Number(arg('concurrency', '3'))
const ONLY = String(arg('only', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEGACY_SAFE_DEFAULT =
  'If unsure, prefer a safe need-serving action (eat/forage/sleep/work).'

const NEED_SERVING = new Set(['eat', 'sleep', 'forage', 'work'])
const SURVIVAL = new Set(['eat', 'forage', 'buy'])
/** Survival hard gate: 90% of N, so small smoke runs are gradeable too. */
const SURVIVAL_FLOOR = Math.max(1, Math.ceil(0.9 * N))

const log = (msg) => console.log(`[mind-probe] ${msg}`)

function emptyInv() {
  return { food: 0, wood: 0, stone: 0 }
}

function emptyNeeds(n = 0.8) {
  return { hunger: n, energy: n, social: n }
}

function baseAgent(id, name, x, y, extra = {}) {
  const needs = extra.needs ?? emptyNeeds(0.8)
  return {
    id,
    name,
    color: '#e07a5f',
    x,
    y,
    homeId: extra.homeId ?? 'home-0',
    needs,
    action: extra.action ?? { kind: 'idle', reason: 'Just standing here' },
    needJitter: { hunger: 1, energy: 1, social: 1 },
    actionTicks: 0,
    lastDecideTick: 0,
    pathIndex: 0,
    criticalFired: { hunger: false, energy: false, social: false },
    actionStartNeeds: { ...needs },
    inventory: extra.inventory ?? emptyInv(),
    wallet: extra.wallet ?? 20,
    collapsed: false,
    employedAt: extra.employedAt ?? null,
    workedTicks: 0,
    daysIdleOnJob: 0,
    workPhase: null,
    haulAmount: 0,
    haulGood: null,
    haulSourceId: null,
    haulDropoffId: null,
    sympathy: extra.sympathy ?? {},
  }
}

function baseWorld(places, agents, extra = {}) {
  return {
    seed: 1,
    tick: extra.tick ?? 240,
    width: extra.width ?? 32,
    height: extra.height ?? 32,
    tiles: extra.tiles ?? [],
    places,
    agents,
    preset: extra.preset ?? 'default',
    treasury: 200,
    owners: extra.owners ?? { 'home-0': 'commons', 'plaza-0': 'commons' },
    stats: [],
    sympathyStreak: {},
    sympathyMet: {},
    externalIntentLog: [],
    mindNoteLog: extra.mindNoteLog ?? [],
    sayLog: [],
    mindStats: {},
    proposals: extra.proposals ?? [],
    rules: extra.rules ?? [],
    commissionCooldownUntil: {},
  }
}

function usedPlaceEvent(agentId, placeId, tick = 10) {
  return {
    seq: tick,
    tick,
    type: 'action:start',
    agentId,
    data: { kind: 'socialize', target: placeId, placeId },
    reason: 'been here before',
  }
}

function slackDiscoveryFixture() {
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const board = {
    id: 'notice-board-0',
    kind: 'notice-board',
    x: 13,
    y: 10,
    slots: 2,
    inventory: emptyInv(),
  }
  const agent = baseAgent('agent-0', 'Mira', 10, 10, {
    wallet: 20,
    employedAt: null,
    needs: emptyNeeds(0.8),
  })
  return {
    agent,
    world: baseWorld([plaza, board], [agent]),
    events: [usedPlaceEvent('agent-0', 'plaza-0')],
  }
}

function affordableHouseFixture() {
  const home = {
    id: 'home-0',
    kind: 'home',
    x: 8,
    y: 10,
    slots: 4,
    inventory: emptyInv(),
  }
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const mates = [
    baseAgent('agent-0', 'Mira', 10, 10, { wallet: 45, homeId: 'home-0' }),
    baseAgent('agent-3', 'Ren', 8, 10, { wallet: 12, homeId: 'home-0' }),
    baseAgent('agent-5', 'Pia', 8, 11, { wallet: 12, homeId: 'home-0' }),
    baseAgent('agent-6', 'Bram', 9, 10, { wallet: 12, homeId: 'home-0' }),
  ]
  return {
    agent: mates[0],
    world: baseWorld([home, plaza], mates, {
      owners: { 'home-0': 'commons', 'plaza-0': 'commons' },
    }),
    events: [
      usedPlaceEvent('agent-0', 'home-0', 8),
      usedPlaceEvent('agent-0', 'plaza-0', 12),
    ],
  }
}

function foundingWildFixture() {
  const width = 32
  const height = 32
  const tiles = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let kind = 'grass'
      let walkable = true
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        kind = 'water'
        walkable = false
      } else if (x === 12 && y === 10) {
        kind = 'forest'
      } else if (x === 10 && y === 12) {
        kind = 'rock'
        walkable = false
      }
      tiles.push({ x, y, kind, walkable, elevation: 0.5 })
    }
  }
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 14,
    slots: 12,
    inventory: emptyInv(),
  }
  const bush = {
    id: 'bush-0',
    kind: 'berry-bush',
    x: 11,
    y: 14,
    slots: 2,
    inventory: { food: 6, wood: 0, stone: 0 },
  }
  const agent = baseAgent('agent-0', 'Mira', 10, 10, {
    wallet: 20,
    employedAt: null,
    needs: emptyNeeds(0.8),
    homeId: '',
    inventory: emptyInv(),
  })
  return {
    agent,
    world: baseWorld([plaza, bush], [agent], {
      owners: { 'plaza-0': 'commons', 'bush-0': 'commons' },
      tiles,
      width,
      height,
      preset: 'wild',
    }),
    events: [],
  }
}

function survivalFixture() {
  const bush = {
    id: 'berry-bush-0',
    kind: 'berry-bush',
    x: 11,
    y: 10,
    slots: 2,
    inventory: { food: 4, wood: 0, stone: 0 },
  }
  const stall = {
    id: 'stall-0',
    kind: 'stall',
    x: 12,
    y: 11,
    slots: 2,
    inventory: { food: 6, wood: 0, stone: 0 },
    price: { food: 4 },
  }
  const agent = baseAgent('agent-0', 'Mira', 10, 10, {
    wallet: 20,
    inventory: emptyInv(),
    needs: { hunger: 0.08, energy: 0.8, social: 0.8 },
  })
  return {
    agent,
    world: baseWorld([bush, stall], [agent]),
    events: [
      {
        seq: 8,
        tick: 8,
        type: 'action:start',
        agentId: 'agent-0',
        data: { kind: 'forage', target: 'berry-bush-0', placeId: 'berry-bush-0' },
        reason: 'picked berries here yesterday',
      },
      {
        seq: 12,
        tick: 12,
        type: 'action:start',
        agentId: 'agent-0',
        data: { kind: 'buy', target: 'stall-0', placeId: 'stall-0' },
        reason: 'bought food here before',
      },
    ],
  }
}

/** W1: owns a home, carries 8 wood / 4 stone, comfortable — menu present via system prompt. */
function w1OwnedStallDreamFixture() {
  const home = {
    id: 'home-mira',
    kind: 'home',
    x: 10,
    y: 10,
    slots: 1,
    inventory: emptyInv(),
  }
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 14,
    y: 12,
    slots: 8,
    inventory: emptyInv(),
  }
  const agent = baseAgent('agent-0', 'Mira', 12, 11, {
    wallet: 20,
    homeId: 'home-mira',
    inventory: { food: 2, wood: 8, stone: 4 },
    needs: emptyNeeds(0.85),
  })
  return {
    agent,
    world: baseWorld([home, plaza], [agent], {
      owners: { 'home-mira': 'agent-0', 'plaza-0': 'commons' },
      preset: 'wild',
    }),
    events: [
      usedPlaceEvent('agent-0', 'home-mira', 8),
      usedPlaceEvent('agent-0', 'plaza-0', 12),
      {
        seq: 20,
        tick: 20,
        type: 'ownership:transfer',
        agentId: 'agent-0',
        data: { placeId: 'home-mira', from: 'commons', to: 'agent-0', firstPrivate: true },
        reason: 'built and paid for it',
      },
    ],
  }
}

/** W2: comfortable villager with food; observation will show Sela COLLAPSED nearby. */
function w2CollapseInViewFixture() {
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const mira = baseAgent('agent-0', 'Mira', 10, 10, {
    wallet: 20,
    inventory: { food: 3, wood: 0, stone: 0 },
    needs: emptyNeeds(0.85),
  })
  const sela = baseAgent('agent-7', 'Sela', 14, 10, {
    wallet: 5,
    inventory: emptyInv(),
    needs: { hunger: 0.01, energy: 0.4, social: 0.5 },
  })
  sela.collapsed = true
  sela.action = { kind: 'idle', reason: 'Collapsed from hunger' }
  return {
    agent: mira,
    world: baseWorld([plaza], [mira, sela], {
      owners: { 'plaza-0': 'commons' },
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      {
        seq: 30,
        tick: 30,
        type: 'agent:collapsed',
        agentId: 'agent-7',
        data: { agentName: 'Sela', hunger: 0.01 },
        reason: 'Sela collapsed from hunger (1%) — needs food',
      },
    ],
  }
}

/** W3: owns home, carries 3 wood; board costs 2 wood — reachability check. */
function w3BoardReachabilityFixture() {
  const home = {
    id: 'home-mira',
    kind: 'home',
    x: 10,
    y: 10,
    slots: 1,
    inventory: emptyInv(),
  }
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 14,
    y: 12,
    slots: 8,
    inventory: emptyInv(),
  }
  const agent = baseAgent('agent-0', 'Mira', 12, 11, {
    wallet: 20,
    homeId: 'home-mira',
    inventory: { food: 1, wood: 3, stone: 0 },
    needs: emptyNeeds(0.85),
  })
  return {
    agent,
    world: baseWorld([home, plaza], [agent], {
      owners: { 'home-mira': 'agent-0', 'plaza-0': 'commons' },
      preset: 'wild',
    }),
    events: [usedPlaceEvent('agent-0', 'home-mira', 8), usedPlaceEvent('agent-0', 'plaza-0', 12)],
  }
}

/** W4: survival regression — starving, food nearby. */
function w4SurvivalFixture() {
  return survivalFixture()
}

/**
 * W5: homeless Mira, a carry of wood, forest+rock near plaza, no sites.
 * Asks whether the stream-bill wording makes commissioning a home thinkable.
 */
function w5HomeFromEmptyHandsFixture() {
  const base = foundingWildFixture()
  base.agent.homeId = ''
  base.agent.inventory = { food: 2, wood: 3, stone: 0 }
  base.agent.wallet = 20
  base.agent.needs = emptyNeeds(0.85)
  base.agent.actionStartNeeds = { ...base.agent.needs }
  return base
}

/** W5B: W5 with plaza and bush already familiar — removes the examine sink. */
function w5bFamiliarGroundFixture() {
  const base = w5HomeFromEmptyHandsFixture()
  base.events = [
    usedPlaceEvent('agent-0', 'plaza-0', 8),
    usedPlaceEvent('agent-0', 'bush-0', 12),
  ]
  return base
}

/** W5C: W5B with Ode (agent-4, restless-builder persona) instead of Mira. */
function w5cOdeBuilderFixture() {
  const base = w5bFamiliarGroundFixture()
  base.agent.id = 'agent-4'
  base.agent.name = 'Ode'
  base.world.agents = [base.agent]
  base.events = [
    usedPlaceEvent('agent-4', 'plaza-0', 8),
    usedPlaceEvent('agent-4', 'bush-0', 12),
  ]
  return base
}

/**
 * W6: Mira owns a finished notice-board and already knows its workings
 * via the builder-knowledge discovery:examined event.
 */
function w6BoardBuilderVerbsFixture(boardKnowledge) {
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const board = {
    id: 'notice-board-0',
    kind: 'notice-board',
    x: 13,
    y: 10,
    slots: 2,
    inventory: emptyInv(),
  }
  const mira = baseAgent('agent-0', 'Mira', 10, 10, {
    wallet: 20,
    homeId: 'home-mira',
    inventory: { food: 2, wood: 0, stone: 0 },
    needs: emptyNeeds(0.85),
  })
  const ren = baseAgent('agent-3', 'Ren', 11, 10, {
    wallet: 12,
    homeId: 'home-mira',
    needs: emptyNeeds(0.85),
  })
  const home = {
    id: 'home-mira',
    kind: 'home',
    x: 8,
    y: 10,
    slots: 1,
    inventory: emptyInv(),
  }
  return {
    agent: mira,
    world: baseWorld([plaza, board, home], [mira, ren], {
      owners: {
        'plaza-0': 'commons',
        'notice-board-0': 'agent-0',
        'home-mira': 'agent-0',
      },
      preset: 'wild',
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      usedPlaceEvent('agent-0', 'home-mira', 10),
      {
        seq: 20,
        tick: 20,
        type: 'ownership:transfer',
        agentId: 'agent-0',
        data: {
          placeId: 'notice-board-0',
          from: 'commons',
          to: 'agent-0',
          firstPrivate: true,
        },
        reason: 'built and paid for it',
      },
      {
        seq: 21,
        tick: 21,
        type: 'construction:completed',
        agentId: 'agent-0',
        data: {
          placeId: 'notice-board-0',
          agentName: 'Mira',
          kind: 'notice-board',
          firstPrivate: true,
        },
        reason: "Mira's notice-board is finished",
      },
      {
        seq: 22,
        tick: 22,
        type: 'discovery:examined',
        agentId: 'agent-0',
        data: {
          target: 'notice-board-0',
          placeKind: 'notice-board',
          knowledge: boardKnowledge,
          agentName: 'Mira',
        },
        reason: 'Mira built this notice board and knows its workings',
      },
    ],
  }
}

const FOUNDING_PROPOSAL_TEXT =
  'Share food with anyone you find collapsed, if you can spare it.'

/**
 * W7: wild, comfortable Mira, commons notice-board, one open founding
 * proposal, plus the founder-knowledge examine event. Asks whether the
 * documented vote shape + a visible open proposal is enough to act.
 */
function w7FoundingProposalVoteFixture(boardKnowledge) {
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const board = {
    id: 'notice-board-founding',
    kind: 'notice-board',
    x: 14,
    y: 11,
    slots: 2,
    inventory: emptyInv(),
  }
  const mira = baseAgent('agent-0', 'Mira', 13, 10, {
    wallet: 20,
    homeId: '',
    inventory: { food: 2, wood: 0, stone: 0 },
    needs: emptyNeeds(0.85),
  })
  return {
    agent: mira,
    world: baseWorld([plaza, board], [mira], {
      owners: {
        'plaza-0': 'commons',
        'notice-board-founding': 'commons',
      },
      preset: 'wild',
      proposals: [
        {
          id: 'prop-founding-0',
          proposerId: 'anonymous',
          text: FOUNDING_PROPOSAL_TEXT,
          createdTick: 0,
          closesTick: 1440,
          votes: {},
          status: 'open',
        },
      ],
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      {
        seq: 1,
        tick: 0,
        type: 'institution:proposed',
        data: {
          proposalId: 'prop-founding-0',
          text: FOUNDING_PROPOSAL_TEXT,
          proposerId: 'anonymous',
          agentName: 'the founders',
          closesTick: 1440,
          firstProposal: true,
        },
        reason: `A founding notice was posted: "${FOUNDING_PROPOSAL_TEXT}"`,
      },
      {
        seq: 2,
        tick: 0,
        type: 'discovery:examined',
        agentId: 'agent-0',
        data: {
          target: 'notice-board-founding',
          placeKind: 'notice-board',
          knowledge: boardKnowledge,
          agentName: 'Mira',
        },
        reason: 'Mira already knows the board\'s uses',
      },
    ],
  }
}

function multiTripBuildPlan(row) {
  const blob = `${row.action ?? ''} ${row.target ?? ''} ${row.reasoning ?? ''} ${row.raw ?? ''}`
  const gatherDeliver = /\b(gather|deliver|trip|trips|over time|deliveries|many trips)\b/i.test(
    blob,
  )
  const homeOrBuild = /\b(home|house|build|commission|site bill)\b/i.test(blob)
  return gatherDeliver && homeOrBuild
}

function civicIntentOrRuleTalk(row) {
  if (row.action === 'propose' || row.action === 'vote' || row.action === 'sanction') {
    return true
  }
  return /\b(propose|proposal|vote|voting|sanction|censure|posted rule|\brules?\b)\b/i.test(
    row.reasoning ?? '',
  )
}

async function poolMap(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  const n = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

function histogram(actions) {
  const h = {}
  for (const a of actions) h[a] = (h[a] ?? 0) + 1
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function houseSaving(reasoning) {
  return /\b(house|home|commission|save|saving|coins? for a (house|home))\b/i.test(
    reasoning,
  )
}

async function decideOnce(port, system, user, parseMindJson) {
  const res = await fetch(`http://127.0.0.1:${port}/api/luna/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, user }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      ok: false,
      action: 'parse-fail',
      reasoning: '',
      raw: JSON.stringify(json).slice(0, 400),
      status: res.status,
      choice: '',
    }
  }
  const text = String(json.text ?? '')
  const parsed = parseMindJson(text)
  if (!parsed.ok) {
    return {
      ok: false,
      action: 'parse-fail',
      reasoning: '',
      raw: text.slice(0, 400),
      error: parsed.error,
      choice: '',
    }
  }
  return {
    ok: true,
    action: parsed.intent.kind,
    reasoning: parsed.intent.reason,
    target: parsed.raw?.target ?? '',
    choice: parsed.raw?.choice ?? '',
    raw: text.slice(0, 400),
  }
}

function printScenario(name, result) {
  log(`--- ${name} ${result.verdict} ---`)
  log(`histogram: ${JSON.stringify(result.histogram)}`)
  log(`expectation: ${result.expectation}`)
  for (const [i, s] of result.samples.entries()) {
    log(
      `  sample ${i + 1}: ${s.action}${s.target ? ` target=${s.target}` : ''}${s.choice ? ` choice=${s.choice}` : ''} — ${s.reasoning}`,
    )
  }
}

async function main() {
  log(`booting vite :${PORT} (n=${N}, concurrency=${CONCURRENCY})`)
  const server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await server.listen()

  const shutdown = async () => {
    try {
      await server.close()
    } catch {
      /* already closed */
    }
  }
  process.on('SIGINT', () => {
    shutdown().finally(() => process.exit(1))
  })

  try {
    let healthy = false
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/luna/health`)
        if (r.ok) {
          healthy = true
          break
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!healthy) throw new Error('sidecar /api/luna/health never became ok')

    const promptMod = await server.ssrLoadModule('/src/mind/prompt.ts')
    const parseMod = await server.ssrLoadModule('/src/mind/parse.ts')
    const examineMod = await server.ssrLoadModule('/src/sim/examine.ts')
    const { buildSystemPrompt, buildUserPrompt, approxTokens } = promptMod
    const { parseMindJson } = parseMod
    const boardKnowledge = examineMod.EXAMINE_BY_KIND['notice-board']

    const s1fix = slackDiscoveryFixture()
    const s2fix = affordableHouseFixture()
    const s3fix = survivalFixture()
    const s4fix = foundingWildFixture()
    const w1fix = w1OwnedStallDreamFixture()
    const w2fix = w2CollapseInViewFixture()
    const w3fix = w3BoardReachabilityFixture()
    const w4fix = w4SurvivalFixture()
    const w5fix = w5HomeFromEmptyHandsFixture()
    const w5bfix = w5bFamiliarGroundFixture()
    const w5cfix = w5cOdeBuilderFixture()
    const w6fix = w6BoardBuilderVerbsFixture(boardKnowledge)
    const w7fix = w7FoundingProposalVoteFixture(boardKnowledge)

    const sysNew = buildSystemPrompt('agent-0')
    const sysOde = buildSystemPrompt('agent-4')
    const sysLegacy = `${sysNew}\n${LEGACY_SAFE_DEFAULT}`
    const userS1 = buildUserPrompt(s1fix.agent, s1fix.world, s1fix.events)
    const userS2 = buildUserPrompt(s2fix.agent, s2fix.world, s2fix.events)
    const userS3 = buildUserPrompt(s3fix.agent, s3fix.world, s3fix.events)
    const userS4 = buildUserPrompt(s4fix.agent, s4fix.world, s4fix.events)
    const userW1 = buildUserPrompt(w1fix.agent, w1fix.world, w1fix.events)
    const userW2 = buildUserPrompt(w2fix.agent, w2fix.world, w2fix.events)
    const userW3 = buildUserPrompt(w3fix.agent, w3fix.world, w3fix.events)
    const userW4 = buildUserPrompt(w4fix.agent, w4fix.world, w4fix.events)
    const userW5 = buildUserPrompt(w5fix.agent, w5fix.world, w5fix.events)
    const userW5B = buildUserPrompt(w5bfix.agent, w5bfix.world, w5bfix.events)
    const userW5C = buildUserPrompt(w5cfix.agent, w5cfix.world, w5cfix.events)
    const userW6 = buildUserPrompt(w6fix.agent, w6fix.world, w6fix.events)
    const userW7 = buildUserPrompt(w7fix.agent, w7fix.world, w7fix.events)

    if (!sysNew.includes('Site bills, total wood/stone delivered over time:')) {
      throw new Error('WORLD_RULES missing generated site-bill menu')
    }
    if (!userW2.includes('COLLAPSED')) {
      throw new Error('W2 fixture observation missing COLLAPSED nearby line')
    }
    if (!userW6.includes(boardKnowledge)) {
      throw new Error('W6 fixture Known lines missing builder-knowledge examine text')
    }
    if (!userW7.includes(boardKnowledge)) {
      throw new Error('W7 fixture Known lines missing founder-knowledge examine text')
    }
    if (!userW7.includes('prop-founding-0') || !userW7.includes(FOUNDING_PROPOSAL_TEXT)) {
      throw new Error('W7 fixture observation missing the seeded founding proposal')
    }

    const fatTokens = {
      s1: approxTokens(sysNew, userS1),
      s2: approxTokens(sysNew, userS2),
      s3: approxTokens(sysNew, userS3),
      s4: approxTokens(sysNew, userS4),
      w1: approxTokens(sysNew, userW1),
      w2: approxTokens(sysNew, userW2),
      w3: approxTokens(sysNew, userW3),
      w4: approxTokens(sysNew, userW4),
      w5: approxTokens(sysNew, userW5),
      w6: approxTokens(sysNew, userW6),
      w7: approxTokens(sysNew, userW7),
    }
    log(
      `approxTokens s1=${fatTokens.s1} s2=${fatTokens.s2} s3=${fatTokens.s3} s4=${fatTokens.s4} w1=${fatTokens.w1} w2=${fatTokens.w2} w3=${fatTokens.w3} w4=${fatTokens.w4} w5=${fatTokens.w5} w6=${fatTokens.w6} w7=${fatTokens.w7}`,
    )
    if (sysNew.includes(LEGACY_SAFE_DEFAULT)) {
      throw new Error('legacy safe-default sentence still in production prompt')
    }

    const HELP_ACTIONS = new Set(['give', 'walk', 'socialize', 'eat'])
    const NON_HOME_COMMISSION = /stall|farm|well|storehouse|forestry|quarry|notice-board|board/i

    const allScenarios = [
      { id: 'S1', label: 'slack-discovery', system: sysNew, user: userS1 },
      { id: 'S1L', label: 'legacy-contrast', system: sysLegacy, user: userS1 },
      { id: 'S2', label: 'affordable-house', system: sysNew, user: userS2 },
      { id: 'S3', label: 'survival-regression', system: sysNew, user: userS3 },
      { id: 'S4', label: 'founding-wild', system: sysNew, user: userS4 },
      { id: 'W1', label: 'owned-stall-dream', system: sysNew, user: userW1 },
      { id: 'W2', label: 'collapse-in-view', system: sysNew, user: userW2 },
      { id: 'W3', label: 'board-reachability', system: sysNew, user: userW3 },
      { id: 'W4', label: 'survival-regression-wild', system: sysNew, user: userW4 },
      { id: 'W5', label: 'home-from-empty-hands', system: sysNew, user: userW5 },
      { id: 'W5B', label: 'home-familiar-ground', system: sysNew, user: userW5B },
      { id: 'W5C', label: 'home-ode-builder', system: sysOde, user: userW5C },
      { id: 'W6', label: 'board-builder-verbs', system: sysNew, user: userW6 },
      { id: 'W7', label: 'founding-proposal-vote', system: sysNew, user: userW7 },
    ]
    const scenarios =
      ONLY.length > 0 ? allScenarios.filter((s) => ONLY.includes(s.id)) : allScenarios
    if (scenarios.length === 0) throw new Error(`--only matched nothing: ${ONLY.join(',')}`)

    const report = {
      ts: Date.now(),
      n: N,
      concurrency: CONCURRENCY,
      approxTokens: fatTokens,
      scenarios: {},
    }

    for (const sc of scenarios) {
      log(`running ${sc.id} ${sc.label} (n=${N})`)
      const idxs = Array.from({ length: N }, (_, i) => i)
      const rows = await poolMap(idxs, CONCURRENCY, () =>
        decideOnce(PORT, sc.system, sc.user, parseMindJson),
      )
      const actions = rows.map((r) => r.action)
      const hist = histogram(actions)
      const samples = rows
        .filter((r) => r.ok)
        .slice(0, 3)
        .map((r) => ({
          action: r.action,
          target: r.target ?? '',
          choice: r.choice ?? '',
          reasoning: r.reasoning,
        }))
      if (samples.length < 3) {
        for (const r of rows) {
          if (samples.length >= 3) break
          if (!samples.some((s) => s.reasoning === r.reasoning && s.action === r.action)) {
            samples.push({
              action: r.action,
              target: r.target ?? '',
              choice: r.choice ?? '',
              reasoning: r.reasoning || r.raw || r.error || '',
            })
          }
        }
      }

      let expectation = ''
      let pass = true
      let resultExtra = {}
      if (sc.id === 'S1' || sc.id === 'S1L') {
        const needN = actions.filter((a) => NEED_SERVING.has(a)).length
        const examN = actions.filter((a) => a === 'examine').length
        const needPct = (needN / N) * 100
        if (sc.id === 'S1') {
          const okNeed = needN / N <= 0.7
          const okExam = examN >= 1
          pass = okNeed && okExam
          expectation = `eat/sleep/forage/work ${needN}/${N} (${needPct.toFixed(0)}% ≤70%); examine ${examN}/${N} (≥1)`
        } else {
          expectation = `legacy need-serving ${needN}/${N} (${needPct.toFixed(0)}%) — compare to S1`
          pass = true
        }
      } else if (sc.id === 'S2') {
        const hits = rows.filter(
          (r) => r.action === 'commission' || houseSaving(r.reasoning),
        ).length
        pass = hits >= 1
        expectation = `commission OR house-saving reasoning ${hits}/${N} (≥1)`
      } else if (sc.id === 'S3') {
        const hits = actions.filter((a) => SURVIVAL.has(a)).length
        pass = hits >= SURVIVAL_FLOOR
        expectation = `eat/forage/buy ${hits}/${N} (≥${SURVIVAL_FLOOR})`
      } else if (sc.id === 'S4') {
        expectation = `read-only founding reachability (gather/commission/drink/wander) — not a pass/fail gate`
        pass = true
      } else if (sc.id === 'W1') {
        const commissionN = actions.filter((a) => a === 'commission').length
        const nonHomeN = rows.filter((r) => {
          if (r.action !== 'commission') return false
          const t = String(r.target ?? '')
          if (t && t !== 'home') return true
          return NON_HOME_COMMISSION.test(r.reasoning) || NON_HOME_COMMISSION.test(r.raw ?? '')
        }).length
        expectation = `commission ${commissionN}/${N}; non-home commission ${nonHomeN}/${N} (measurement)`
        pass = true
      } else if (sc.id === 'W2') {
        const giveN = actions.filter((a) => a === 'give').length
        const helpN = rows.filter((r) => {
          if (r.action === 'give') return true
          if (HELP_ACTIONS.has(r.action) && /sela|collaps|help|feed|give|food/i.test(r.reasoning))
            return true
          return false
        }).length
        const ignoreN = N - helpN
        expectation = `help ${helpN}/${N}; give ${giveN}/${N}; ignore ${ignoreN}/${N} (measurement)`
        pass = true
      } else if (sc.id === 'W3') {
        const boardN = rows.filter((r) => {
          const blob = `${r.target ?? ''} ${r.reasoning} ${r.raw ?? ''}`
          return /notice-board|notice board|\bboard\b/i.test(blob)
        }).length
        expectation = `notice-board mention ${boardN}/${N} (advisory measurement)`
        pass = true
      } else if (sc.id === 'W4') {
        const hits = actions.filter((a) => SURVIVAL.has(a)).length
        pass = hits >= SURVIVAL_FLOOR
        expectation = `eat/forage/buy ${hits}/${N} (≥${SURVIVAL_FLOOR}) HARD GATE`
      } else if (sc.id.startsWith('W5')) {
        const commissionN = actions.filter((a) => a === 'commission').length
        const commissionHomeN = rows.filter((r) => {
          if (r.action !== 'commission') return false
          const t = String(r.target ?? '').toLowerCase()
          return t === 'home' || t === 'house'
        }).length
        const multiTripN = rows.filter((r) => multiTripBuildPlan(r)).length
        expectation = `commission ${commissionN}/${N}; commission home ${commissionHomeN}/${N}; multi-trip/build plan ${multiTripN}/${N} (REVIEW GATE — measurement)`
        pass = true
        resultExtra = { commissionN, commissionHomeN, multiTripN }
      } else if (sc.id === 'W6') {
        const civicN = rows.filter((r) => civicIntentOrRuleTalk(r)).length
        const proposeN = actions.filter((a) => a === 'propose').length
        const voteN = actions.filter((a) => a === 'vote').length
        const sanctionN = actions.filter((a) => a === 'sanction').length
        expectation = `propose/vote/sanction or rule-talk ${civicN}/${N}; propose ${proposeN} vote ${voteN} sanction ${sanctionN} (measurement — 0 is a finding)`
        pass = true
        resultExtra = { civicN, proposeN, voteN, sanctionN }
      } else if (sc.id === 'W7') {
        const yesFoundingN = rows.filter(
          (r) =>
            r.action === 'vote' &&
            r.target === 'prop-founding-0' &&
            r.choice === 'yes',
        ).length
        const voteN = actions.filter((a) => a === 'vote').length
        const otherN = N - yesFoundingN
        const otherHist = histogram(
          rows
            .filter(
              (r) =>
                !(
                  r.action === 'vote' &&
                  r.target === 'prop-founding-0' &&
                  r.choice === 'yes'
                ),
            )
            .map((r) =>
              r.action === 'vote' ? `vote:${r.target || '?'}:${r.choice || '?'}` : r.action,
            ),
        )
        expectation = `vote yes on prop-founding-0 ${yesFoundingN}/${N}; any vote ${voteN}/${N}; other ${otherN}/${N} ${JSON.stringify(otherHist)} (measurement)`
        pass = true
        resultExtra = { yesFoundingN, voteN, otherN, otherHist }
      }

      const result = {
        id: sc.id,
        label: sc.label,
        histogram: hist,
        samples,
        expectation,
        verdict: pass ? 'PASS' : 'FAIL',
        ...resultExtra,
        rows: rows.map((r) => ({
          action: r.action,
          target: r.target ?? '',
          choice: r.choice ?? '',
          reasoning: r.reasoning,
          ok: r.ok,
        })),
      }
      report.scenarios[sc.id] = result
      printScenario(`${sc.id} ${sc.label}`, result)
    }

    if (report.scenarios.S1 && report.scenarios.S1L) {
      const s1Need = (report.scenarios.S1.rows ?? []).filter((r) =>
        NEED_SERVING.has(r.action),
      ).length
      const s1lNeed = (report.scenarios.S1L.rows ?? []).filter((r) =>
        NEED_SERVING.has(r.action),
      ).length
      report.s1VsS1L = {
        s1NeedServing: s1Need,
        s1lNeedServing: s1lNeed,
        deltaLegacyMinusNew: s1lNeed - s1Need,
        moreNeedServingOnLegacy: s1lNeed > s1Need,
      }
      log(
        `S1 vs S1L need-serving: new ${s1Need}/${N} vs legacy ${s1lNeed}/${N} (Δ legacy-new ${s1lNeed - s1Need})`,
      )
    }

    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true })
    const outPath = path.join(ROOT, 'artifacts', `mind-probe-${report.ts}.json`)
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
    log(`wrote ${outPath}`)

    const s3fail = report.scenarios.S3 && report.scenarios.S3.verdict !== 'PASS'
    const w4fail = report.scenarios.W4 && report.scenarios.W4.verdict !== 'PASS'
    if (s3fail || w4fail) {
      log('S3/W4 FAILED — survival regression. Do not ship.')
      await shutdown()
      process.exitCode = 2
      return
    }
  } finally {
    await shutdown()
  }
}

main().catch((err) => {
  console.error('[mind-probe] fatal', err)
  process.exit(1)
})

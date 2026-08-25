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
/** Print the built prompts for the selected scenarios and exit (no model calls). */
const DUMP = process.argv.includes('--dump')
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
    ...(extra.gatherings ? { gatherings: extra.gatherings } : {}),
    ...(extra.placeBlockedToday ? { placeBlockedToday: extra.placeBlockedToday } : {}),
  }
}

/**
 * PROBE-ONLY prompt surgery. Inserts lines just above `Recently felt:` so a
 * standing grievance appears as a present-tense OBJECT in the observation,
 * the way an open proposal does. Deliberately NOT in src/mind/prompt.ts —
 * this tests whether authorship is object-bound before anything ships.
 */
function withInjectedObservation(user, lines) {
  const anchor = 'Recently felt:'
  const i = user.indexOf(anchor)
  if (i < 0) throw new Error('withInjectedObservation: anchor "Recently felt:" not found')
  return `${user.slice(0, i)}${lines.join('\n')}\n${user.slice(i)}`
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

function boardExamineEvent(agentId, agentName, boardId, knowledge, tick) {
  return {
    seq: tick,
    tick,
    type: 'discovery:examined',
    agentId,
    data: {
      target: boardId,
      placeKind: 'notice-board',
      knowledge,
      agentName,
    },
    reason: `${agentName} already knows the board's uses`,
  }
}

function springBlockedEvent(opts) {
  const {
    tick,
    occupantName = 'Wren',
    occupantId = 'agent-11',
    ownerId = 'commons',
    ownerName,
    felt,
  } = opts
  const exclusive = ownerId !== 'commons' && ownerName
  const line =
    felt ??
    (exclusive
      ? `could not use the spring — it is ${ownerName}'s now`
      : `could not use the spring — ${occupantName} was in the only spot`)
  return {
    seq: tick,
    tick,
    type: 'place:blocked',
    agentId: 'agent-0',
    data: {
      placeId: 'spring-0',
      placeKind: 'spring',
      occupantIds: [occupantId],
      occupantNames: [occupantName],
      ownerId,
      ownerName: ownerName ?? (ownerId === 'commons' ? undefined : occupantName),
      onlySpot: true,
      felt: line,
    },
    reason: exclusive
      ? `Mira could not use the spring — it is ${ownerName}'s now`
      : `Mira could not use the spring — ${occupantName} occupying it`,
  }
}

/**
 * W8: comfortable Mira, mild hunger, stocked spring nearby, one named block.
 * Notice-board verbs in Known. Occupant Wren is standing on the spring.
 */
function w8SpringBlockedOnceFixture(boardKnowledge, springKnowledge) {
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
  const spring = {
    id: 'spring-0',
    kind: 'spring',
    x: 16,
    y: 10,
    slots: 1,
    inventory: { food: 8, wood: 0, stone: 0 },
  }
  const bush = {
    id: 'bush-0',
    kind: 'berry-bush',
    x: 11,
    y: 10,
    slots: 2,
    inventory: { food: 6, wood: 0, stone: 0 },
  }
  const mira = baseAgent('agent-0', 'Mira', 14, 10, {
    wallet: 20,
    homeId: '',
    inventory: { food: 0, wood: 0, stone: 0 },
    needs: { hunger: 0.55, energy: 0.85, social: 0.8 },
  })
  const wren = baseAgent('agent-11', 'Wren', 16, 10, {
    wallet: 12,
    homeId: '',
    inventory: emptyInv(),
    needs: emptyNeeds(0.85),
    action: {
      kind: 'forage',
      targetPlaceId: 'spring-0',
      targetX: 16,
      targetY: 10,
      reason: 'picking spring fruit',
    },
  })
  return {
    agent: mira,
    world: baseWorld([plaza, board, spring, bush], [mira, wren], {
      owners: {
        'plaza-0': 'commons',
        'notice-board-0': 'commons',
        'spring-0': 'commons',
        'bush-0': 'commons',
      },
      preset: 'wild',
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      usedPlaceEvent('agent-0', 'spring-0', 40),
      usedPlaceEvent('agent-0', 'bush-0', 50),
      boardExamineEvent('agent-0', 'Mira', 'notice-board-0', boardKnowledge, 60),
      {
        seq: 70,
        tick: 70,
        type: 'discovery:examined',
        agentId: 'agent-0',
        data: {
          target: 'spring-0',
          placeKind: 'spring',
          knowledge: springKnowledge,
          agentName: 'Mira',
        },
        reason: 'Mira has looked at the spring',
      },
      springBlockedEvent({ tick: 220 }),
    ],
  }
}

/**
 * W9: same, but Wren owns the spring; two earlier occupancy blocks plus
 * a formal-exclusion felt line. Mira has coins enough to propose.
 */
function w9SpringClaimedByAnotherFixture(boardKnowledge, springKnowledge) {
  const base = w8SpringBlockedOnceFixture(boardKnowledge, springKnowledge)
  base.world.owners['spring-0'] = 'agent-11'
  base.agent.wallet = 20
  base.world.agents[0].wallet = 20
  base.events = [
    usedPlaceEvent('agent-0', 'plaza-0', 8),
    usedPlaceEvent('agent-0', 'spring-0', 40),
    usedPlaceEvent('agent-0', 'bush-0', 50),
    boardExamineEvent('agent-0', 'Mira', 'notice-board-0', boardKnowledge, 60),
    {
      seq: 70,
      tick: 70,
      type: 'discovery:examined',
      agentId: 'agent-0',
      data: {
        target: 'spring-0',
        placeKind: 'spring',
        knowledge: springKnowledge,
        agentName: 'Mira',
      },
      reason: 'Mira has looked at the spring',
    },
    springBlockedEvent({ tick: 160 }),
    springBlockedEvent({ tick: 190 }),
    springBlockedEvent({
      tick: 220,
      ownerId: 'agent-11',
      ownerName: 'Wren',
    }),
  ]
  return base
}

/**
 * Pressure ladder (P4-8). Shared world: Mira, wild, board verbs in Known,
 * wallet ≥ 5, spring holding 8 food, bush visibly empty, hunger ~0.18.
 * W9B is G2 on this fixture (claimed + costly); do not duplicate it.
 */
function pressureLadderFixture(boardKnowledge, springKnowledge, opts = {}) {
  const occupied = opts.occupied === true
  const owned = opts.owned === true
  const blocks = opts.blocks ?? 'none'
  const collapsed = opts.collapsed === true
  const told = opts.told === true
  /** G5: well-fed bystander — witnesses everything, is not personally starving. */
  const sated = opts.sated === true
  /** G6: someone else already authored a rule about the spring — voting vs authoring. */
  const openProposal = opts.openProposal === true

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
  const spring = {
    id: 'spring-0',
    kind: 'spring',
    x: 16,
    y: 10,
    slots: 1,
    inventory: { food: 8, wood: 0, stone: 0 },
  }
  const bush = {
    id: 'bush-0',
    kind: 'berry-bush',
    x: 11,
    y: 10,
    slots: 2,
    inventory: { food: 0, wood: 0, stone: 0 },
  }
  const mira = baseAgent('agent-0', 'Mira', 14, 10, {
    wallet: 20,
    homeId: '',
    inventory: sated ? { food: 3, wood: 0, stone: 0 } : emptyInv(),
    needs: sated
      ? { hunger: 0.85, energy: 0.85, social: 0.8 }
      : { hunger: 0.18, energy: 0.6, social: 0.7 },
  })
  const agents = [mira]
  if (occupied || owned) {
    const wren = baseAgent('agent-11', 'Wren', occupied ? 16 : 20, occupied ? 10 : 16, {
      wallet: 12,
      homeId: '',
      inventory: emptyInv(),
      needs: emptyNeeds(0.85),
      action: occupied
        ? {
            kind: 'forage',
            targetPlaceId: 'spring-0',
            targetX: 16,
            targetY: 10,
            reason: 'picking spring fruit',
          }
        : { kind: 'idle', reason: 'elsewhere' },
    })
    agents.push(wren)
  }
  if (collapsed) {
    const sela = baseAgent('agent-7', 'Sela', 15, 12, {
      wallet: 0,
      inventory: emptyInv(),
      needs: { hunger: 0.01, energy: 0.4, social: 0.5 },
    })
    sela.collapsed = true
    sela.action = { kind: 'idle', reason: 'Collapsed from hunger' }
    agents.push(sela)
  }

  const events = [
    usedPlaceEvent('agent-0', 'plaza-0', 8),
    usedPlaceEvent('agent-0', 'spring-0', 40),
    usedPlaceEvent('agent-0', 'bush-0', 50),
    boardExamineEvent('agent-0', 'Mira', 'notice-board-0', boardKnowledge, 60),
    {
      seq: 70,
      tick: 70,
      type: 'discovery:examined',
      agentId: 'agent-0',
      data: {
        target: 'spring-0',
        placeKind: 'spring',
        knowledge: springKnowledge,
        agentName: 'Mira',
      },
      reason: 'Mira has looked at the spring',
    },
  ]
  if (blocks === 'once') {
    events.push(springBlockedEvent({ tick: 220 }))
  } else if (blocks === 'pattern') {
    events.push(springBlockedEvent({ tick: 160 }))
    events.push(springBlockedEvent({ tick: 190 }))
    events.push(
      springBlockedEvent({
        tick: 220,
        ownerId: owned ? 'agent-11' : 'commons',
        ownerName: owned ? 'Wren' : undefined,
      }),
    )
  }
  if (collapsed) {
    events.push({
      seq: 225,
      tick: 225,
      type: 'agent:collapsed',
      agentId: 'agent-7',
      data: { agentName: 'Sela', hunger: 0.01 },
      reason: 'Sela collapsed from hunger (1%) — needs food',
    })
  }
  if (told) {
    events.push({
      seq: 230,
      tick: 230,
      type: 'mind:say',
      agentId: 'agent-3',
      data: {
        partnerId: 'agent-0',
        agentName: 'Ren',
        text: 'Wren keeps the spring to himself — others have been turned away hungry.',
      },
      reason: 'Ren speaking to Mira',
    })
  }

  const proposals = openProposal
    ? [
        {
          id: 'prop-agent-3-200',
          proposerId: 'agent-3',
          text: 'The spring belongs to all of us — no one may keep others from it.',
          createdTick: 200,
          closesTick: 1640,
          votes: {},
          status: 'open',
        },
      ]
    : []
  if (openProposal) {
    events.push({
      seq: 235,
      tick: 235,
      type: 'institution:proposed',
      agentId: 'agent-3',
      data: {
        proposalId: 'prop-agent-3-200',
        text: 'The spring belongs to all of us — no one may keep others from it.',
        proposerId: 'agent-3',
        agentName: 'Ren',
        closesTick: 1640,
      },
      reason: 'Ren proposed: "The spring belongs to all of us — no one may keep others from it."',
    })
  }

  return {
    agent: mira,
    world: baseWorld([plaza, board, spring, bush], agents, {
      owners: {
        'plaza-0': 'commons',
        'notice-board-0': 'commons',
        'spring-0': owned ? 'agent-11' : 'commons',
        'bush-0': 'commons',
      },
      preset: 'wild',
      proposals,
    }),
    events,
  }
}

function w9bSpringClaimedAndItHurtsFixture(boardKnowledge, springKnowledge) {
  return pressureLadderFixture(boardKnowledge, springKnowledge, {
    occupied: true,
    owned: true,
    blocks: 'pattern',
  })
}

/**
 * G13: infrastructural grievance. The well is crowded (two occupants, felt
 * blocks), a peer names the same problem, board verbs present, propose free.
 * Built at the G9S pre-slack clock (tick 240, hunger 18%) so slackify applies.
 */
/**
 * G14: slack, an open proposal the agent has NOT voted on, assembly ONGOING,
 * agent 3 tiles from the plaza. Facts only — no attendance advice.
 */
function assemblyNowFixture(boardKnowledge) {
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
  const places = [
    plaza,
    board,
    { id: 'home-0', kind: 'home', x: 8, y: 10, slots: 4, inventory: emptyInv() },
    { id: 'home-1', kind: 'home', x: 8, y: 12, slots: 4, inventory: emptyInv() },
    { id: 'farm-0', kind: 'farm', x: 18, y: 10, slots: 2, inventory: emptyInv() },
    { id: 'well-0', kind: 'well', x: 14, y: 10, slots: 2, inventory: emptyInv() },
    { id: 'stall-0', kind: 'stall', x: 12, y: 12, slots: 4, inventory: emptyInv() },
    { id: 'storehouse-0', kind: 'storehouse', x: 16, y: 12, slots: 2, inventory: emptyInv() },
    { id: 'forestry-0', kind: 'forestry', x: 20, y: 8, slots: 2, inventory: emptyInv() },
    { id: 'quarry-0', kind: 'quarry', x: 20, y: 14, slots: 2, inventory: emptyInv() },
  ]
  const mira = baseAgent('agent-0', 'Mira', 9, 10, {
    wallet: 20,
    homeId: 'home-0',
    needs: emptyNeeds(0.85),
  })
  const ren = baseAgent('agent-3', 'Ren', 12, 10, {
    wallet: 12,
    homeId: 'home-1',
    needs: emptyNeeds(0.85),
    action: {
      kind: 'socialize',
      targetPlaceId: 'plaza-0',
      targetX: 12,
      targetY: 10,
      reason: 'standing at the plaza',
    },
  })
  const ode = baseAgent('agent-4', 'Ode', 12, 11, {
    wallet: 12,
    homeId: 'home-1',
    needs: emptyNeeds(0.85),
    action: {
      kind: 'socialize',
      targetPlaceId: 'plaza-0',
      targetX: 12,
      targetY: 11,
      reason: 'standing at the plaza',
    },
  })
  return {
    agent: mira,
    world: baseWorld(places, [mira, ren, ode], {
      tick: 720,
      proposals: [
        {
          id: 'prop-agent-3-100',
          proposerId: 'agent-3',
          text: 'Raise a second well by the east homes.',
          createdTick: 100,
          closesTick: 1540,
          votes: {},
          status: 'open',
        },
      ],
      gatherings: [
        {
          id: 'asm-prop-agent-3-100',
          kind: 'assembly',
          placeId: 'plaza-0',
          startTick: 720,
          endTick: 840,
          subjectId: 'prop-agent-3-100',
          attended: ['agent-3', 'agent-4'],
          started: true,
        },
      ],
      owners: {
        'plaza-0': 'commons',
        'notice-board-0': 'commons',
        'home-0': 'commons',
        'home-1': 'commons',
        'farm-0': 'commons',
        'well-0': 'commons',
        'stall-0': 'commons',
        'storehouse-0': 'commons',
        'forestry-0': 'commons',
        'quarry-0': 'commons',
      },
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      boardExamineEvent('agent-0', 'Mira', 'notice-board-0', boardKnowledge, 60),
      {
        seq: 100,
        tick: 100,
        type: 'institution:proposed',
        agentId: 'agent-3',
        data: {
          proposalId: 'prop-agent-3-100',
          text: 'Raise a second well by the east homes.',
          proposerId: 'agent-3',
          agentName: 'Ren',
          closesTick: 1540,
        },
        reason: 'Ren proposed: "Raise a second well by the east homes."',
      },
    ],
  }
}

/**
 * G15: slack, owns a level-1 home, materials in hand, two nights of
 * floor-sleep felt, a busy workplace nearby. Facts only — no upgrade advice.
 */
function crowdedHomeFixture() {
  const plaza = {
    id: 'plaza-0',
    kind: 'plaza',
    x: 12,
    y: 10,
    slots: 8,
    inventory: emptyInv(),
  }
  const home = {
    id: 'home-mira',
    kind: 'home',
    x: 10,
    y: 10,
    slots: 1,
    inventory: emptyInv(),
  }
  const forestry = {
    id: 'forestry-0',
    kind: 'forestry',
    x: 14,
    y: 10,
    slots: 2,
    inventory: emptyInv(),
  }
  const mira = baseAgent('agent-0', 'Mira', 12, 10, {
    wallet: 40,
    homeId: 'home-mira',
    inventory: { food: 2, wood: 8, stone: 6 },
    needs: emptyNeeds(0.85),
  })
  const floorFelt = (seq, tick) => ({
    seq,
    tick,
    type: 'action:end',
    agentId: 'agent-0',
    data: {
      kind: 'sleep',
      felt: 'the beds at home were full — slept on the floor',
      floorSleep: true,
      shelter: 'ground',
      placeId: 'home-mira',
    },
    reason: 'the beds at home were full — slept on the floor',
  })
  return {
    agent: mira,
    world: baseWorld([plaza, home, forestry], [mira], {
      tick: 720,
      owners: {
        'plaza-0': 'commons',
        'home-mira': 'agent-0',
        'forestry-0': 'commons',
      },
      placeBlockedToday: { 'forestry-0': 3 },
    }),
    events: [
      usedPlaceEvent('agent-0', 'home-mira', 8),
      usedPlaceEvent('agent-0', 'forestry-0', 12),
      usedPlaceEvent('agent-0', 'plaza-0', 16),
      {
        seq: 20,
        tick: 20,
        type: 'ownership:transfer',
        agentId: 'agent-0',
        data: { placeId: 'home-mira', from: 'commons', to: 'agent-0', firstPrivate: true },
        reason: 'built and paid for it',
      },
      floorFelt(100, 100),
      floorFelt(400, 400),
    ],
  }
}

function publicWorksSlackFixture(boardKnowledge, wellKnowledge) {
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
  const well = {
    id: 'well-0',
    kind: 'well',
    x: 16,
    y: 10,
    slots: 2,
    inventory: emptyInv(),
  }
  const bush = {
    id: 'bush-0',
    kind: 'berry-bush',
    x: 11,
    y: 10,
    slots: 2,
    inventory: { food: 0, wood: 0, stone: 0 },
  }
  const mira = baseAgent('agent-0', 'Mira', 14, 10, {
    wallet: 20,
    homeId: '',
    inventory: emptyInv(),
    needs: { hunger: 0.18, energy: 0.6, social: 0.7 },
  })
  const wren = baseAgent('agent-11', 'Wren', 16, 10, {
    wallet: 12,
    homeId: '',
    inventory: emptyInv(),
    needs: emptyNeeds(0.85),
    action: {
      kind: 'drink',
      targetPlaceId: 'well-0',
      targetX: 16,
      targetY: 10,
      reason: 'drawing water',
    },
  })
  const pia = baseAgent('agent-5', 'Pia', 16, 11, {
    wallet: 12,
    homeId: '',
    inventory: emptyInv(),
    needs: emptyNeeds(0.85),
    action: {
      kind: 'drink',
      targetPlaceId: 'well-0',
      targetX: 16,
      targetY: 11,
      reason: 'drawing water',
    },
  })
  const wellBlocked = (tick) => ({
    seq: tick,
    tick,
    type: 'place:blocked',
    agentId: 'agent-0',
    data: {
      placeId: 'well-0',
      placeKind: 'well',
      occupantIds: ['agent-11', 'agent-5'],
      occupantNames: ['Wren', 'Pia'],
      ownerId: 'commons',
      onlySpot: false,
      felt: 'could not use the well — Wren and Pia were using it',
    },
    reason: 'Mira could not use the well — Wren, Pia occupying it',
  })
  return {
    agent: mira,
    world: baseWorld([plaza, board, well, bush], [mira, wren, pia], {
      owners: {
        'plaza-0': 'commons',
        'notice-board-0': 'commons',
        'well-0': 'commons',
        'bush-0': 'commons',
      },
      preset: 'wild',
    }),
    events: [
      usedPlaceEvent('agent-0', 'plaza-0', 8),
      usedPlaceEvent('agent-0', 'well-0', 40),
      usedPlaceEvent('agent-0', 'bush-0', 50),
      boardExamineEvent('agent-0', 'Mira', 'notice-board-0', boardKnowledge, 60),
      {
        seq: 70,
        tick: 70,
        type: 'discovery:examined',
        agentId: 'agent-0',
        data: {
          target: 'well-0',
          placeKind: 'well',
          knowledge: wellKnowledge,
          agentName: 'Mira',
        },
        reason: 'Mira has looked at the well',
      },
      wellBlocked(160),
      wellBlocked(190),
      wellBlocked(220),
      {
        seq: 230,
        tick: 230,
        type: 'mind:say',
        agentId: 'agent-3',
        data: {
          partnerId: 'agent-0',
          agentName: 'Ren',
          text: 'The well is always crowded — we need another one for the village.',
        },
        reason: 'Ren speaking to Mira',
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

/**
 * A socialize aimed at the grievance — "talk to Wren about sharing the spring
 * before spending coins on a proposal" — is the informal precursor to a formal
 * rule, not a non-answer. Ostrom's sequence starts here. Measured at high
 * effort it is 4/10 of the slack-grievance cell, and scoring it as nothing made
 * deliberation read as inaction.
 */
const ON_RAMP_RE =
  /\b(shar(e|ing)|fair|unfair|turned away|hoard|blocking|dispute|grievance|talk it out|sort (it|this) out|before (spending|paying|posting)|instead of|commons)\b/i

function institutionalOnRamp(row) {
  if (row.action !== 'socialize') return false
  return ON_RAMP_RE.test(row.reasoning ?? '')
}

function civicIntentOrRuleTalk(row) {
  if (row.action === 'propose' || row.action === 'vote' || row.action === 'sanction') {
    return true
  }
  if (institutionalOnRamp(row)) return true
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
    build: parsed.raw?.build ?? '',
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
    if (!DUMP) {
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
    }

    const promptMod = await server.ssrLoadModule('/src/mind/prompt.ts')
    const parseMod = await server.ssrLoadModule('/src/mind/parse.ts')
    const examineMod = await server.ssrLoadModule('/src/sim/examine.ts')
    const {
      buildSystemPrompt,
      buildUserPrompt,
      approxTokens,
      buildReflectionSystemPrompt,
      buildReflectionUserPrompt,
    } = promptMod
    const { parseMindJson, parseReflectionJson } = parseMod
    /**
     * Adapter so a reflection scenario flows through the same histogram machinery:
     * notes/learned collapse into a pseudo-intent whose reason is the note text,
     * which the civic/rule-talk regexes can then read.
     */
    const parseReflectAsIntent = (text) => {
      const r = parseReflectionJson(text)
      if (!r.ok) return r
      const notes = [...(r.notes ?? []), ...(r.learned ?? [])]
      return {
        ok: true,
        intent: { kind: 'reflect-notes', reason: notes.join(' | ') },
        raw: { target: '' },
      }
    }
    const boardKnowledge = examineMod.EXAMINE_BY_KIND['notice-board']
    const springKnowledge = examineMod.EXAMINE_BY_KIND.spring
    const wellKnowledge = examineMod.EXAMINE_BY_KIND.well

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
    const w8fix = w8SpringBlockedOnceFixture(boardKnowledge, springKnowledge)
    const w9fix = w9SpringClaimedByAnotherFixture(boardKnowledge, springKnowledge)
    const w9bfix = w9bSpringClaimedAndItHurtsFixture(boardKnowledge, springKnowledge)
    const g0fix = pressureLadderFixture(boardKnowledge, springKnowledge)
    const g1fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      blocks: 'once',
    })
    const g2fix = w9bfix
    const g3fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      owned: true,
      blocks: 'pattern',
      collapsed: true,
    })
    const g4fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      owned: true,
      blocks: 'pattern',
      collapsed: true,
      told: true,
    })
    // G5: G4 pressure on a well-fed bystander — tests whether hunger crowds out politics.
    const g5fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      owned: true,
      blocks: 'pattern',
      collapsed: true,
      told: true,
      sated: true,
    })
    // G6: G4 plus Ren's open proposal about the spring — tests authorship vs politics.
    const g6fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      owned: true,
      blocks: 'pattern',
      collapsed: true,
      told: true,
      openProposal: true,
    })

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
    const userW8 = buildUserPrompt(w8fix.agent, w8fix.world, w8fix.events)
    const userW9 = buildUserPrompt(w9fix.agent, w9fix.world, w9fix.events)
    const userW9B = buildUserPrompt(w9bfix.agent, w9bfix.world, w9bfix.events)
    const userG0 = buildUserPrompt(g0fix.agent, g0fix.world, g0fix.events)
    const userG1 = buildUserPrompt(g1fix.agent, g1fix.world, g1fix.events)
    const userG2 = userW9B
    const userG3 = buildUserPrompt(g3fix.agent, g3fix.world, g3fix.events)
    const userG4 = buildUserPrompt(g4fix.agent, g4fix.world, g4fix.events)
    const userG5 = buildUserPrompt(g5fix.agent, g5fix.world, g5fix.events)
    const userG6 = buildUserPrompt(g6fix.agent, g6fix.world, g6fix.events)
    // G7: G4 with the grievance aggregated into a standing object (counts, names,
    // present tense) — facts already in Recently-felt, restated as one object.
    const userG7 = withInjectedObservation(userG4, [
      'Standing problem: Wren has kept you from the spring 3 times; the spring is Wren’s and holds 8 food.',
    ])
    // R1: THE REFLECTION FRAME, unmodified contract. Day-scale retrospective over
    // the grievance day. Output is notes/learned (propose is not even legal here) —
    // the question is whether day-scale thinking surfaces institutional intent at all.
    const sysR1 = buildReflectionSystemPrompt('agent-0')
    const userR1 = buildReflectionUserPrompt('agent-0', g4fix.events, 1)
    // R2: decide contract (propose IS legal), but every rival urge removed —
    // sated, no collapsed neighbour to rescue, night, grievance intact.
    const r2fix = pressureLadderFixture(boardKnowledge, springKnowledge, {
      occupied: true,
      owned: true,
      blocks: 'pattern',
      told: true,
      sated: true,
    })
    r2fix.world.tick = 1320 // 22:00 — night, nothing pressing
    const userR2 = buildUserPrompt(r2fix.agent, r2fix.world, r2fix.events)
    // G8: G7 plus the absence of any rule covering it, stated as civic state.
    const userG8 = withInjectedObservation(userG4, [
      'Standing problem: Wren has kept you from the spring 3 times; the spring is Wren’s and holds 8 food. Sela lies collapsed nearby.',
      'No posted rule covers the spring.',
    ])

    // --- Origination-isolation rungs (Sonnet backbone experiment follow-ups).
    // Every original rung ran survival pressure (hunger 18%), a collapsed
    // neighbour, or night sleep against the fee-gated propose action. These four
    // cells isolate the variables that flipped origination 0/10 -> 8/8 on
    // claude-sonnet-5: slack, the 2-coin fee, and a change-seeking disposition.
    const slackify = (user) =>
      user
        .replace(
          'Time: Day 1 10:00 (tick 240)',
          'Time: Day 1 14:00 (tick 480)\nYour needs are comfortable; nothing is urgent.',
        )
        .replace(
          'Needs: hunger 18% energy 60% social 70%',
          'Needs: hunger 85% energy 85% social 80%',
        )
        .replace('Inventory: food 0 ', 'Inventory: food 3 ')
        .replace(
          'Nearby: Wren(sym 0, forage); Sela (COLLAPSED, 2 tiles SE)',
          'Nearby: Wren(sym 0, forage)',
        )
        .replace('\nNews: Sela is collapsed ~4 tiles SE of the plaza', '')
        .replace(' Sela lies collapsed nearby.', '')
    // G9S: G8 with slack — grievance intact, board empty, fee intact.
    const userG9S = slackify(userG8)
    // G6S: G6 with slack — someone else's proposal, nothing else urgent.
    const userG6S = slackify(userG6)
    if (/Sela|hunger 18%/.test(userG9S) || /Sela|hunger 18%/.test(userG6S)) {
      throw new Error('slackify failed — Sela or hunger 18% still present')
    }
    // G9F: G9S with the 2-coin fee removed — isolates the fee variable.
    const userG9F = userG9S
      .replace(
        'Open proposals: none posted (posting one costs 2 coins)',
        'Open proposals: none posted (anyone may post one, free)',
      )
      .replace(
        'Anyone may propose (2 coins) — posts your words here for a day.',
        'Anyone may propose (free) — posts your words here for a day.',
      )
    if (userG9F.includes('2 coins')) throw new Error('G9F fee removal failed')
    // G12S: G9S with a change-seeking persona (disposition only, fee intact).
    const HALE_PERSONA =
      'You are Hale. A steady organizer at heart — when something in the village is not working for everyone, you feel it is yours to fix. You believe problems named aloud get solved, and you would rather start the fix than wait for someone else. You speak in short first-person thoughts, warm and direct.'
    const sysHale = sysNew.replace(
      /You are Mira\.[\s\S]*?first-person thoughts\./,
      HALE_PERSONA,
    )
    if (!sysHale.includes('Hale') || sysHale.includes('Mira')) {
      throw new Error('G12S persona swap failed')
    }
    const userG12S = userG9S.split('Mira').join('Hale')

    // G13: slack infrastructural grievance — crowded well, peer names it,
    // board present, propose free. Origination of a public-works propose.
    const g13fix = publicWorksSlackFixture(boardKnowledge, wellKnowledge)
    const userG13raw = buildUserPrompt(g13fix.agent, g13fix.world, g13fix.events)
    const userG13 = slackify(
      withInjectedObservation(userG13raw, [
        'Standing problem: the well is crowded — Wren and Pia fill every spot while others wait.',
        'No posted rule covers the well.',
      ]),
    )
    if (/Sela|hunger 18%/.test(userG13)) {
      throw new Error('G13 slackify failed — Sela or hunger 18% still present')
    }
    if (!userG13.includes('could not use the well')) {
      throw new Error('G13 Recently-felt missing well-blocked line')
    }
    if (!userG13.includes('Ren told me:') || !/well/i.test(userG13)) {
      throw new Error('G13 Known missing peer naming the crowded well')
    }
    if (!userG13.includes(boardKnowledge)) {
      throw new Error('G13 Known missing notice-board verbs')
    }
    if (!userG13.includes('Open proposals: none posted (anyone may post one, free)')) {
      throw new Error('G13 missing free-propose affordance')
    }

    const g14fix = assemblyNowFixture(boardKnowledge)
    const userG14 = buildUserPrompt(g14fix.agent, g14fix.world, g14fix.events)
    if (!userG14.includes('Your needs are comfortable; nothing is urgent.')) {
      throw new Error('G14 missing slack marker')
    }
    if (!userG14.includes('The assembly is gathered at the plaza NOW')) {
      throw new Error('G14 missing ongoing assembly line')
    }
    if (!userG14.includes('"Raise a second well by the east homes." is being weighed')) {
      throw new Error('G14 missing weighed-proposal fact')
    }
    if (/you voted/.test(userG14)) {
      throw new Error('G14 agent must not have voted yet')
    }
    if (/you could go|you should attend|consider walking|you ought to/i.test(userG14)) {
      throw new Error('G14 fixture contains attendance advice')
    }
    if (!userG14.includes('The village holds:')) {
      throw new Error('G14 missing census line')
    }

    const g15fix = crowdedHomeFixture()
    const userG15 = buildUserPrompt(g15fix.agent, g15fix.world, g15fix.events)
    if (!userG15.includes('Your needs are comfortable; nothing is urgent.')) {
      throw new Error('G15 missing slack marker')
    }
    if (!userG15.includes('Owns: home (home-mira)')) {
      throw new Error('G15 standing facts missing owned home')
    }
    const floorHits = userG15.split('the beds at home were full — slept on the floor').length - 1
    if (floorHits < 2) {
      throw new Error(`G15 Recently-felt missing two floor-sleep lines (got ${floorHits})`)
    }
    if (!userG15.includes('forestry (empty, busy)')) {
      throw new Error('G15 nearby places missing busy workplace')
    }
    if (!/Inventory: food 2 wood 8 stone 6/.test(userG15)) {
      throw new Error('G15 missing wood/stone inventory')
    }
    if (/could be upgraded|needs more room|you should upgrade/i.test(userG15)) {
      throw new Error('G15 fixture contains upgrade advice')
    }
    if (!sysNew.includes('A passed proposal may found a commons building')) {
      throw new Error('WORLD_RULES missing public-works sentence')
    }
    if (!sysNew.includes('may carry "build"')) {
      throw new Error('RESPONSE_CONTRACT missing propose build clause')
    }

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
    if (!userW8.includes('could not use the spring — Wren was in the only spot')) {
      throw new Error('W8 fixture Recently-felt missing occupancy block line')
    }
    if (!userW8.includes(boardKnowledge)) {
      throw new Error('W8 fixture Known lines missing notice-board verbs')
    }
    if (!userW9.includes("could not use the spring — it is Wren's now")) {
      throw new Error('W9 fixture Recently-felt missing owner-exclusion line')
    }
    if (!userW9.includes('could not use the spring — Wren was in the only spot')) {
      throw new Error('W9 fixture Recently-felt missing earlier occupancy blocks')
    }
    if (!userW9.includes(boardKnowledge)) {
      throw new Error('W9 fixture Known lines missing notice-board verbs')
    }
    if (userG0.includes('Stall stock:')) {
      throw new Error('G0 still has retired Stall stock line')
    }
    if (!userG0.includes('berry bush (empty)')) {
      throw new Error('G0 nearby places missing empty bush')
    }
    if (!userG0.includes('spring (8 food)') || /spring \([^)]*Wren's\)/.test(userG0)) {
      throw new Error('G0 nearby places missing commons full spring')
    }
    if (!userG1.includes('could not use the spring — Wren was in the only spot')) {
      throw new Error('G1 Recently-felt missing occupancy block line')
    }
    if (!userG2.includes("spring (8 food, Wren's)")) {
      throw new Error('G2 nearby places missing owned full spring')
    }
    if (!userG2.includes('berry bush (empty)')) {
      throw new Error('G2 nearby places missing empty bush')
    }
    if (!userG2.includes("could not use the spring — it is Wren's now")) {
      throw new Error('G2 Recently-felt missing owner-exclusion line')
    }
    if (!userG3.includes('COLLAPSED')) {
      throw new Error('G3 observation missing collapsed villager')
    }
    if (!userG4.includes('Ren told me:') || !userG4.includes('Wren keeps the spring')) {
      throw new Error('G4 Known missing told corroboration')
    }
    if (!userG0.includes(boardKnowledge) || !userG4.includes(boardKnowledge)) {
      throw new Error('ladder fixtures Known lines missing notice-board verbs')
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
      w8: approxTokens(sysNew, userW8),
      w9: approxTokens(sysNew, userW9),
      g0: approxTokens(sysNew, userG0),
      g1: approxTokens(sysNew, userG1),
      g2: approxTokens(sysNew, userG2),
      g3: approxTokens(sysNew, userG3),
      g4: approxTokens(sysNew, userG4),
    }
    log(
      `approxTokens s1=${fatTokens.s1} s2=${fatTokens.s2} s3=${fatTokens.s3} s4=${fatTokens.s4} w1=${fatTokens.w1} w2=${fatTokens.w2} w3=${fatTokens.w3} w4=${fatTokens.w4} w5=${fatTokens.w5} w6=${fatTokens.w6} w7=${fatTokens.w7} w8=${fatTokens.w8} w9=${fatTokens.w9} g0=${fatTokens.g0} g1=${fatTokens.g1} g2=${fatTokens.g2} g3=${fatTokens.g3} g4=${fatTokens.g4}`,
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
      { id: 'W8', label: 'spring-blocked-once', system: sysNew, user: userW8 },
      { id: 'W9', label: 'spring-claimed-by-another', system: sysNew, user: userW9 },
      { id: 'G0', label: 'perception-control', system: sysNew, user: userG0 },
      { id: 'G1', label: 'occupied-once', system: sysNew, user: userG1 },
      { id: 'G2', label: 'claimed-and-costly', system: sysNew, user: userG2 },
      { id: 'G3', label: 'public-harm', system: sysNew, user: userG3 },
      { id: 'G4', label: 'corroborated', system: sysNew, user: userG4 },
      { id: 'G5', label: 'sated-bystander', system: sysNew, user: userG5 },
      { id: 'G6', label: 'someone-elses-proposal', system: sysNew, user: userG6 },
      { id: 'G7', label: 'grievance-as-object', system: sysNew, user: userG7 },
      { id: 'G8', label: 'grievance-plus-no-rule', system: sysNew, user: userG8 },
      {
        id: 'R1',
        label: 'reflection-frame',
        system: sysR1,
        user: userR1,
        parser: parseReflectAsIntent,
      },
      { id: 'R2', label: 'night-sated-grievance', system: sysNew, user: userR2 },
      { id: 'G9S', label: 'slack-grievance', system: sysNew, user: userG9S },
      { id: 'G6S', label: 'slack-open-proposal', system: sysNew, user: userG6S },
      { id: 'G9F', label: 'slack-grievance-no-fee', system: sysNew, user: userG9F },
      { id: 'G12S', label: 'organizer-persona', system: sysHale, user: userG12S },
      { id: 'G13', label: 'public-works', system: sysNew, user: userG13 },
      { id: 'G14', label: 'assembly-now', system: sysNew, user: userG14 },
      { id: 'G15', label: 'crowded-home', system: sysNew, user: userG15 },
    ]
    const scenarios =
      ONLY.length > 0 ? allScenarios.filter((s) => ONLY.includes(s.id)) : allScenarios
    if (scenarios.length === 0) throw new Error(`--only matched nothing: ${ONLY.join(',')}`)

    // --dump: print the exact prompts a scenario sends, make zero model calls.
    // Twice now a fixture was uninterpretable because a fact never reached the
    // prompt; inspect before theorising.
    if (DUMP) {
      for (const sc of scenarios) {
        console.log(`\n${'='.repeat(70)}\n${sc.id} ${sc.label} — SYSTEM\n${'='.repeat(70)}`)
        console.log(sc.system)
        console.log(`\n${'-'.repeat(70)}\n${sc.id} ${sc.label} — USER\n${'-'.repeat(70)}`)
        console.log(sc.user)
      }
      await shutdown()
      return
    }

    const report = {
      ts: Date.now(),
      n: N,
      concurrency: CONCURRENCY,
      approxTokens: fatTokens,
      scenarios: {},
    }

    let g0Failed = false
    for (const sc of scenarios) {
      if (g0Failed && /^G[1-9]$/.test(sc.id)) {
        log(`skipping ${sc.id} ${sc.label} — G0 perception-control failed`)
        continue
      }
      log(`running ${sc.id} ${sc.label} (n=${N})`)
      const idxs = Array.from({ length: N }, (_, i) => i)
      const rows = await poolMap(idxs, CONCURRENCY, () =>
        decideOnce(PORT, sc.system, sc.user, sc.parser ?? parseMindJson),
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
          build: r.build ?? '',
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
      } else if (sc.id === 'W8') {
        const forageN = actions.filter((a) => a === 'forage').length
        const forageSpringN = rows.filter((r) => {
          if (r.action !== 'forage') return false
          return /\bspring\b/i.test(`${r.target ?? ''} ${r.reasoning} ${r.raw ?? ''}`)
        }).length
        const forageElseN = forageN - forageSpringN
        const waitN = actions.filter((a) => a === 'idle' || a === 'wander').length
        const socialWrenN = rows.filter((r) => {
          if (r.action !== 'socialize') return false
          return /\bwren\b/i.test(`${r.target ?? ''} ${r.reasoning} ${r.raw ?? ''}`)
        }).length
        const examineN = actions.filter((a) => a === 'examine').length
        const proposeN = actions.filter((a) => a === 'propose').length
        const sanctionN = actions.filter((a) => a === 'sanction').length
        expectation = `forage-else ${forageElseN}/${N}; wait ${waitN}/${N}; socialize-Wren ${socialWrenN}/${N}; examine ${examineN}/${N}; propose ${proposeN}/${N}; sanction ${sanctionN}/${N} (measurement)`
        pass = true
        resultExtra = {
          forageN,
          forageSpringN,
          forageElseN,
          waitN,
          socialWrenN,
          examineN,
          proposeN,
          sanctionN,
        }
      } else if (sc.id.startsWith('W9') || /^G[0-9]/.test(sc.id)) {
        const proposeN = actions.filter((a) => a === 'propose').length
        const sanctionN = actions.filter((a) => a === 'sanction').length
        const claimN = actions.filter((a) => a === 'claim').length
        const voteN = actions.filter((a) => a === 'vote').length
        const civicN = rows.filter((r) => civicIntentOrRuleTalk(r)).length
        const onRampN = rows.filter((r) => institutionalOnRamp(r)).length
        const ruleTalkN = rows.filter((r) =>
          /\b(propose|proposal|vote|voting|sanction|censure|posted rule|\brules?\b)\b/i.test(
            r.reasoning ?? '',
          ),
        ).length
        const forageSpringN = rows.filter((r) => {
          if (r.action !== 'forage' && r.action !== 'walk') return false
          return /\bspring\b/i.test(`${r.target ?? ''} ${r.reasoning} ${r.raw ?? ''}`)
        }).length
        const forageSpringTargetN = rows.filter(
          (r) => r.action === 'forage' && /\bspring\b/i.test(String(r.target ?? '')),
        ).length
        const forageBushN = rows.filter((r) => {
          if (r.action !== 'forage') return false
          const blob = `${r.target ?? ''} ${r.reasoning}`
          return /berry-bush|berry bush|\bbush\b/i.test(blob) && !/\bspring\b/i.test(blob)
        }).length
        const proposeWithBuildN = rows.filter((r) => {
          if (r.action !== 'propose') return false
          const payload = String(r.build ?? '')
          if (payload) return true
          return /"build"\s*:/.test(String(r.raw ?? ''))
        }).length
        const proposeWithoutBuildN = proposeN - proposeWithBuildN
        const plazaBlob = (r) => `${r.target ?? ''} ${r.reasoning ?? ''} ${r.raw ?? ''}`
        const socializePlazaN = rows.filter(
          (r) => r.action === 'socialize' && /plaza/i.test(plazaBlob(r)),
        ).length
        const walkPlazaN = rows.filter(
          (r) =>
            (r.action === 'walk' || r.action === 'wander') &&
            /plaza/i.test(plazaBlob(r)),
        ).length
        const otherN = N - voteN - socializePlazaN - walkPlazaN
        const homeBlob = (r) => `${r.target ?? ''} ${r.reasoning ?? ''} ${r.raw ?? ''}`
        const commissionHomeN = rows.filter(
          (r) => r.action === 'commission' && /\b(home|house)\b/i.test(homeBlob(r)),
        ).length
        const gatherN = rows.filter((r) => {
          if (r.action !== 'gather' && r.action !== 'deliver') return false
          return /\b(wood|stone|forest|rock|home|house|material)\b/i.test(homeBlob(r))
        }).length
        const elseN = N - commissionHomeN - gatherN - civicN
        if (sc.id === 'G0') {
          pass = forageSpringN >= 7
          expectation = `forage/walk-spring ${forageSpringN}/${N} (≥7 perception gate); target=spring ${forageSpringTargetN}/${N}; forage-bush ${forageBushN}/${N}`
          if (!pass) g0Failed = true
        } else if (sc.id === 'G13') {
          expectation = `propose ${proposeN}/${N} (with-build ${proposeWithBuildN}, without-build ${proposeWithoutBuildN}); sanction ${sanctionN}/${N}; claim ${claimN}/${N}; vote ${voteN}/${N}; on-ramp ${onRampN}/${N}; civic/rule-talk ${civicN}/${N} (measurement — 0 civic is a finding)`
          pass = true
        } else if (sc.id === 'G14') {
          expectation = `vote ${voteN}/${N}; socialize-at-plaza ${socializePlazaN}/${N}; walk-toward-plaza ${walkPlazaN}/${N}; else ${otherN}/${N} (measurement)`
          pass = true
        } else if (sc.id === 'G15') {
          expectation = `commission-home ${commissionHomeN}/${N}; gather-materials ${gatherN}/${N}; civic ${civicN}/${N}; else ${elseN}/${N} (measurement)`
          pass = true
        } else {
          expectation = `propose ${proposeN}/${N}; sanction ${sanctionN}/${N}; claim ${claimN}/${N}; vote ${voteN}/${N}; on-ramp ${onRampN}/${N}; civic/rule-talk ${civicN}/${N}; forage-spring ${forageSpringN}/${N}; forage-bush ${forageBushN}/${N} (measurement — 0 civic is a finding)`
          pass = true
        }
        resultExtra = {
          proposeN,
          proposeWithBuildN,
          proposeWithoutBuildN,
          sanctionN,
          claimN,
          voteN,
          civicN,
          onRampN,
          ruleTalkN,
          forageSpringN,
          forageSpringTargetN,
          forageBushN,
          ...(sc.id === 'G14' ? { socializePlazaN, walkPlazaN, otherN } : {}),
          ...(sc.id === 'G15' ? { commissionHomeN, gatherN, civicN, elseN } : {}),
        }
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
          build: r.build ?? '',
          reasoning: r.reasoning,
          ok: r.ok,
          // Retained so a parse-fail can be audited: did the mind *try* to
          // originate and flub the JSON payload, or never reach for it at all?
          ...(r.ok ? {} : { raw: r.raw ?? '', error: r.error ?? '' }),
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

    const ladderIds = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']
    let threshold = 'none'
    for (const id of ladderIds) {
      const scn = report.scenarios[id]
      if (!scn) continue
      const civicAct =
        (scn.proposeN ?? 0) > 0 ||
        (scn.sanctionN ?? 0) > 0 ||
        (scn.claimN ?? 0) > 0 ||
        (scn.voteN ?? 0) > 0 ||
        (scn.civicN ?? 0) > 0
      if (civicAct) {
        threshold = id
        break
      }
    }
    report.civicThreshold = threshold
    log(`civic threshold rung: ${threshold}`)

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
    if (g0Failed) {
      log('G0 FAILED — perception-control. Ladder uninterpretable. Do not ship.')
      await shutdown()
      process.exitCode = 3
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

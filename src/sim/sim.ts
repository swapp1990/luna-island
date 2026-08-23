import { createRng } from './rng'
import { EventTrace } from './events'
import { findNoticeBoardSpot, generateWorld, presetFacts } from './worldgen'
import { dayStartTick, toSimTime } from './time'
import { fnv1aHex, stableStringify } from './stableStringify'
import { spawnAgents } from './spawn'
import { findPath, isWalkable, pathStillValid } from './pathfind'
import {
  adjacentToWater,
  bedSlotForAgent,
  canRestoreThisTick,
  extendPathTo,
  gatherResourceAt,
  isSlotTile,
  isStanding,
  isWalking,
  nudgeCandidates,
  pickGatherStand,
  pickShoreStand,
  reserveSpot,
  occupantsOfPlace,
  SOCIAL_PROXIMITY_SQ,
  workplaceHasOpenJob,
} from './spots'
import {
  UtilityBrain,
  anyNeedCritical,
  makeObservation,
  scoreCurrentAction,
  shouldKeepSleeping,
  urgentDifferentNeed,
} from './utilityBrain'
import type {
  AgentMindStats,
  AgentState,
  BuildableKind,
  EconomyStat,
  ExternalIntentMeta,
  ExternalIntentRecord,
  Good,
  Intent,
  Inventory,
  MindNoteMeta,
  MindNoteRecord,
  Needs,
  OwnerId,
  Place,
  PlaceKind,
  Proposal,
  Rng,
  Rule,
  SayRecord,
  SimEvent,
  Tick,
  VoteChoice,
  WorldPreset,
  WorldState,
} from './types'
import { emptyInventory } from './types'
import {
  blockedFeltLine,
  EXAMINE_BY_KIND,
  examineKnowledgeFor,
  PLACE_VIEW_RADIUS,
  placeKindLabel,
  SLEEP_BED_ENERGY,
  SLEEP_GROUND_ENERGY,
} from './examine'

const SNAPSHOT_INTERVAL = 180
const REDECIDE_INTERVAL = 30
const HYSTERESIS = 0.15
/** Ticks per food unit consumed while eating. */
const EAT_TICKS_PER_UNIT = 10
const EAT_HUNGER_PER_UNIT = 0.45
const EAT_MAX_UNITS = 2
/** Ticks per food unit foraged from a bush. */
const FORAGE_TICKS_PER_UNIT = 5
const FORAGE_CARRY_CAP = 3
export const BUSH_STOCK_MAX = 6
/** Spring food cap — higher than a bush, still finite. */
export const SPRING_STOCK_MAX = 8

/** Spring regrows on a quarter of the bush interval (min 1 tick). */
export function springRegrowInterval(preset?: WorldPreset | string): number {
  return Math.max(1, Math.floor(presetFacts(preset).bushRegrowInterval / 4))
}
const DRINK_DURATION = 5
const MOVE_SPEED = 1.0 // tiles per tick
const COLLAPSE_MOVE_FACTOR = 0.4
const COLLAPSE_ENTER = 0.02
const COLLAPSE_CLEAR = 0.25
/** Full daily wage requires this many work ticks (08:00–17:00). */
const FULL_WAGE_TICKS = 300
/** Standard haul batch size (production out / construction in). */
const HAUL_SIZE = 5
/** Max food units per market visit. */
const BUY_MAX_UNITS = 2
/** Default/lean home coin permit. Wild worlds set commissionFeeCoins = 0. */
const COMMISSION_COST = 30
/** Failed commission → silence after a second consecutive identical refusal. */
export const COMMISSION_COOLDOWN_TICKS = 240
/** Island-wide cap on simultaneous construction-sites. */
export const MAX_ACTIVE_SITES = 3
/** Highest Place.level a BuildableKind structure can reach. Missing level ⇒ 1. */
export const MAX_PLACE_LEVEL = 3

/** Effective building tier. Missing / non-positive ⇒ 1. */
export function placeLevel(place: Place | undefined | null): number {
  const n = place?.level
  if (typeof n !== 'number' || n < 1) return 1
  return n
}

/** WORLD_RULES line: upgrade affordance, bill scale, capacity. Facts only. */
export function upgradeRuleLine(): string {
  return `Commissioning a kind you already own upgrades it; a commons notice-board or well may be upgraded by anyone. Bill scales with current level (max ${MAX_PLACE_LEVEL}). A level adds one use slot and +1 yield on producing places.`
}
/** Ticks per wood/stone unit gathered from raw terrain. */
export const GATHER_TICKS_PER_UNIT = 12
/** Max carried units of one gathered good. */
export const GATHER_CARRY_CAP = 3
/**
 * Live cap interpolated into WORLD_RULES. Initialized from GATHER_CARRY_CAP;
 * tests mutate `.cap` to prove the prompt is generated, not handwritten.
 */
export const GATHER_CARRY = { cap: GATHER_CARRY_CAP }
/** Bounded yield per forest/rock tile (same cap as a berry bush). */
export const GATHER_STOCK_MAX = 6
/** Cumulative foot-traffic cap per tile. Missing wear reads as 0. */
export const WEAR_CAP = 10000
/** Energy restored per drink tick at a well (improvement). */
export const DRINK_WELL_ENERGY = 0.02
/** Energy restored per drink tick at the shore (weaker than a well). */
export const DRINK_SHORE_ENERGY = 0.01
/** Examine succeeds from this euclidean distance — observation, not use. */
const EXAMINE_RANGE = 1.5
const EXAMINE_RANGE_SQ = EXAMINE_RANGE * EXAMINE_RANGE
/** Civic fees live in ./costs so examine.ts can share them; re-exported here. */
export { PROPOSE_COST, VOTE_COST, SANCTION_COST, CLAIM_COST } from './costs'
import { CLAIM_COST, PROPOSE_COST, SANCTION_COST, VOTE_COST } from './costs'
import { LUNA_AGENT_ID_SET } from './lunaRoster'
/** Proposal stays open this many ticks (one sim day). */
export const PROPOSAL_WINDOW_TICKS = 1440
/** Mechanical island-wide cap on simultaneous open proposals. */
export const MAX_OPEN_PROPOSALS = 2
/**
 * Passage requires yes > no AND at least this many BINDING votes.
 *
 * Derived from the deliberating body, not a fixed number. It was 8 — a third
 * of the ~24-villager electorate — back when every villager's vote counted.
 * Now that only deliberating villagers bind (see bindingTally), a literal 8
 * would mean unanimous turnout and nothing could ever pass; measured turnout
 * is 2-3 of 8. Keeping the same one-third-of-the-electorate intent gives 3.
 */
export const PROPOSAL_QUORUM = Math.max(2, Math.ceil(LUNA_AGENT_ID_SET.size / 3))
/** Seeded founding proposal — world artifact, not a mind action. */
const FOUNDING_PROPOSAL_ID = 'prop-founding-0'
const FOUNDING_PROPOSAL_TEXT =
  'Share food with anyone you find collapsed, if you can spare it.'
const FOUNDING_BOARD_ID = 'notice-board-founding'
/** Sheep vote yes when sympathy toward the proposer is at least this. */
export const SHEEP_SYMPATHY_YES = 0.25
/**
 * Luna mind agent ids — sheep are everyone else.
 * Must stay aligned with LUNA_AGENT_IDS in src/mind/personas.ts.
 * Kept here so src/sim never imports the mind layer.
 */
/** Derived — never a second copy. See src/sim/lunaRoster.ts for why. */
const LUNA_MIND_IDS: ReadonlySet<string> = LUNA_AGENT_ID_SET
/** Worked ticks to complete a house (progress += 1/N per tick). Fallback for old sites. */
const CONSTRUCTION_TICKS = 900
/** Worked ticks between each 1-unit material consume on a site. */
const CONSTRUCTION_CONSUME_EVERY = 50
/**
 * Construction bills — world physics, not policy.
 * Wood / stone / labour ticks to raise a structure. notice-board is the
 * cheapest so posting a rule is reachable on day one; home / storehouse /
 * stall sit in the middle; well is stone-heavy.
 */
export const BUILD_RECIPES: Record<
  BuildableKind,
  { wood: number; stone: number; labourTicks: number }
> = {
  'notice-board': { wood: 2, stone: 0, labourTicks: 60 },
  farm: { wood: 6, stone: 4, labourTicks: 600 },
  forestry: { wood: 8, stone: 2, labourTicks: 480 },
  quarry: { wood: 4, stone: 8, labourTicks: 480 },
  stall: { wood: 8, stone: 4, labourTicks: 480 },
  storehouse: { wood: 10, stone: 8, labourTicks: 720 },
  home: { wood: 12, stone: 6, labourTicks: 900 },
  well: { wood: 2, stone: 16, labourTicks: 360 },
}

/** Kinds whose sale revenue goes to a private owner (else treasury). */
const OWNER_REVENUE_KINDS: ReadonlySet<PlaceKind> = new Set(['stall'])
/** Kinds whose wages are paid from a private owner's wallet (else treasury). */
const OWNER_PAYROLL_KINDS: ReadonlySet<PlaceKind> = new Set([
  'farm',
  'forestry',
  'quarry',
  'stall',
])

/** Collapsed villagers stay visible this far (observation, not use). */
export const COLLAPSE_VIEW_RADIUS = 12
/** Adjacent tile distance for give-food (Chebyshev). */
export const GIVE_ADJACENCY = 1

export function isBuildableKind(kind: string): kind is BuildableKind {
  return Object.prototype.hasOwnProperty.call(BUILD_RECIPES, kind)
}

/** Compact buildable menu — single source of truth for WORLD_RULES / refusals. */
export function buildableMenuLine(): string {
  const parts = (Object.keys(BUILD_RECIPES) as BuildableKind[]).map((k) => {
    const r = BUILD_RECIPES[k]
    return `${k} ${r.wood}/${r.stone}`
  })
  return `Site bills, total wood/stone delivered over time: ${parts.join(', ')}.`
}

export function buildableKindList(): string {
  return (Object.keys(BUILD_RECIPES) as BuildableKind[]).join(', ')
}

/** Coin party: agent id or the village treasury. */
export type CoinParty = string | 'treasury'

/** Goods holder: agent or place inventory. */
export type GoodsParty =
  | { kind: 'agent'; id: string }
  | { kind: 'place'; id: string }

export interface SimSnapshot {
  state: WorldState
  rngState: number
  eventSeq: number
  /** Events up to and including this snapshot's tick (for fork traces). */
  events: SimEvent[]
}

/** Completed calendar day, reconstructible from pinned start snapshot + events. */
export interface DayArchiveMeta {
  day: number
  startTick: Tick
  endTick: Tick
}

function cloneNeeds(n: Needs): Needs {
  return { hunger: n.hunger, energy: n.energy, social: n.social }
}

function cloneInventory(inv: Inventory): Inventory {
  return {
    food: inv.food ?? 0,
    wood: inv.wood ?? 0,
    stone: inv.stone ?? 0,
  }
}

function cloneSympathy(s: Record<string, number> | undefined): Record<string, number> {
  if (!s) return {}
  const out: Record<string, number> = {}
  for (const k of Object.keys(s)) {
    const v = s[k]
    if (v !== undefined && v !== 0) out[k] = v
  }
  return out
}

function deepCloneAgent(a: AgentState): AgentState {
  return {
    ...a,
    needs: cloneNeeds(a.needs),
    needJitter: cloneNeeds(a.needJitter),
    criticalFired: { ...a.criticalFired },
    actionStartNeeds: cloneNeeds(a.actionStartNeeds),
    inventory: cloneInventory(a.inventory),
    action: {
      ...a.action,
      path: a.action.path ? a.action.path.map((p) => [p[0], p[1]] as [number, number]) : undefined,
    },
    employedAt: a.employedAt,
    workedTicks: a.workedTicks,
    daysIdleOnJob: a.daysIdleOnJob,
    workPhase: a.workPhase,
    haulAmount: a.haulAmount,
    haulGood: a.haulGood,
    haulSourceId: a.haulSourceId,
    haulDropoffId: a.haulDropoffId,
    sympathy: cloneSympathy(a.sympathy),
  }
}

function deepClonePlace(p: Place): Place {
  return {
    ...p,
    inventory: cloneInventory(p.inventory ?? emptyInventory()),
    growth: p.growth,
    jobSlots: p.jobSlots,
    wage: p.wage,
    price: p.price ? { ...p.price } : undefined,
    production: p.production ? { ...p.production } : undefined,
    construction: p.construction
      ? {
          needs: { ...p.construction.needs },
          progress: p.construction.progress,
          consumeTicks: p.construction.consumeTicks,
          targetKind: p.construction.targetKind,
          ...(p.construction.upgradeOf
            ? { upgradeOf: p.construction.upgradeOf }
            : {}),
        }
      : undefined,
  }
}

function cloneIntent(intent: Intent): Intent {
  return {
    kind: intent.kind,
    targetPlaceId: intent.targetPlaceId,
    targetX: intent.targetX,
    targetY: intent.targetY,
    reason: intent.reason,
    text: intent.text,
    proposalId: intent.proposalId,
    choice: intent.choice,
    targetAgentId: intent.targetAgentId,
    ruleId: intent.ruleId,
    placeKind: intent.placeKind,
  }
}

function cloneProposal(p: Proposal): Proposal {
  return {
    id: p.id,
    proposerId: p.proposerId,
    text: p.text,
    createdTick: p.createdTick,
    closesTick: p.closesTick,
    votes: { ...p.votes },
    status: p.status,
  }
}

function cloneRule(r: Rule): Rule {
  return {
    id: r.id,
    text: r.text,
    proposerId: r.proposerId,
    enactedTick: r.enactedTick,
    active: r.active,
  }
}

function cloneProposals(list: Proposal[] | undefined): Proposal[] {
  if (!list || list.length === 0) return []
  return list.map(cloneProposal)
}

function cloneRules(list: Rule[] | undefined): Rule[] {
  if (!list || list.length === 0) return []
  return list.map(cloneRule)
}

export function proposalTally(p: Proposal): { yes: number; no: number; total: number } {
  let yes = 0
  let no = 0
  for (const choice of Object.values(p.votes)) {
    if (choice === 'yes') yes++
    else if (choice === 'no') no++
  }
  return { yes, no, total: yes + no }
}

/**
 * The votes that decide passage: every villager may vote and every vote is
 * recorded, but only deliberating villagers' votes bind.
 *
 * The sheep electorate votes by sympathy toward the PROPOSER, never on the
 * text, so a well-argued rule from an unpopular villager was arithmetically
 * unpassable. Measured over 5 sim days: deliberating villagers voted 10 yes /
 * 0 no across five proposals and every one of them still failed 2-16, because
 * ~16 scripted votes tracked how much the electorate liked the author.
 * Advisory votes stay visible in the tally — they are opinion, not a verdict.
 */
export function bindingTally(p: Proposal): { yes: number; no: number; total: number } {
  let yes = 0
  let no = 0
  for (const [agentId, choice] of Object.entries(p.votes)) {
    if (isSheepAgent(agentId)) continue
    if (choice === 'yes') yes++
    else if (choice === 'no') no++
  }
  return { yes, no, total: yes + no }
}

export function isSheepAgent(agentId: string): boolean {
  return !LUNA_MIND_IDS.has(agentId)
}

function cloneExternalMeta(meta: ExternalIntentMeta): ExternalIntentMeta {
  return {
    reasoning: meta.reasoning,
    source: meta.source,
    provider: meta.provider,
    latencyMs: meta.latencyMs,
    approxChars: meta.approxChars,
  }
}

function cloneExternalIntentLog(
  log: ExternalIntentRecord[] | undefined,
): ExternalIntentRecord[] {
  if (!log || log.length === 0) return []
  return log.map((r) => ({
    tick: r.tick,
    agentId: r.agentId,
    intent: cloneIntent(r.intent),
    meta: cloneExternalMeta(r.meta),
  }))
}

function cloneMindNoteMeta(meta: MindNoteMeta): MindNoteMeta {
  return {
    provider: meta.provider,
    latencyMs: meta.latencyMs,
    approxChars: meta.approxChars,
  }
}

function cloneMindNoteLog(log: MindNoteRecord[] | undefined): MindNoteRecord[] {
  if (!log || log.length === 0) return []
  return log.map((r) => ({
    tick: r.tick,
    agentId: r.agentId,
    notes: r.notes.slice(),
    meta: cloneMindNoteMeta(r.meta),
    ...(r.learned && r.learned.length > 0 ? { learned: r.learned.slice() } : {}),
  }))
}

function cloneSayRecord(r: SayRecord): SayRecord {
  return {
    tick: r.tick,
    conversationId: r.conversationId,
    agentId: r.agentId,
    partnerId: r.partnerId,
    turn: r.turn,
    text: r.text,
    done: r.done,
    ...(r.source ? { source: r.source } : {}),
  }
}

function cloneSayLog(log: SayRecord[] | undefined): SayRecord[] {
  if (!log || log.length === 0) return []
  return log.map(cloneSayRecord)
}

function cloneMindStats(
  stats: Record<string, AgentMindStats> | undefined,
): Record<string, AgentMindStats> {
  if (!stats) return {}
  const out: Record<string, AgentMindStats> = {}
  for (const id of Object.keys(stats)) {
    const s = stats[id]
    if (!s) continue
    out[id] = {
      decisions: s.decisions,
      fallbacks: s.fallbacks,
      totalLatencyMs: s.totalLatencyMs,
      approxChars: s.approxChars,
    }
  }
  return out
}

function deepCloneWorld(state: WorldState): WorldState {
  return {
    seed: state.seed,
    tick: state.tick,
    width: state.width,
    height: state.height,
    tiles: state.tiles.map((t) => ({ ...t })),
    places: state.places.map(deepClonePlace),
    agents: state.agents.map(deepCloneAgent),
    preset: state.preset ?? 'default',
    treasury: state.treasury,
    owners: { ...state.owners },
    stats: state.stats.map((s) => ({ ...s })),
    sympathyStreak: { ...(state.sympathyStreak ?? {}) },
    sympathyMet: { ...(state.sympathyMet ?? {}) },
    externalIntentLog: cloneExternalIntentLog(state.externalIntentLog),
    mindNoteLog: cloneMindNoteLog(state.mindNoteLog),
    sayLog: cloneSayLog(state.sayLog),
    mindStats: cloneMindStats(state.mindStats),
    proposals: cloneProposals(state.proposals),
    rules: cloneRules(state.rules),
    commissionCooldownUntil: { ...(state.commissionCooldownUntil ?? {}) },
    commissionFeeCoins:
      typeof state.commissionFeeCoins === 'number'
        ? state.commissionFeeCoins
        : state.preset === 'wild'
          ? 0
          : COMMISSION_COST,
    ...(state.commissionLastRefusal
      ? { commissionLastRefusal: { ...state.commissionLastRefusal } }
      : {}),
    ...(state.placeBlockLast ? { placeBlockLast: { ...state.placeBlockLast } } : {}),
  }
}

/** Ensure older snapshots / v1–v4 saves have mind + institution fields. */
export function ensureMindFields(state: WorldState): void {
  if (!state.externalIntentLog) state.externalIntentLog = []
  if (!state.mindNoteLog) state.mindNoteLog = []
  if (!state.sayLog) state.sayLog = []
  if (!state.mindStats) state.mindStats = {}
  if (!state.proposals) state.proposals = []
  if (!state.rules) state.rules = []
  if (!state.preset) state.preset = 'default'
  if (!state.commissionCooldownUntil) state.commissionCooldownUntil = {}
  if (typeof state.commissionFeeCoins !== 'number') {
    state.commissionFeeCoins = state.preset === 'wild' ? 0 : COMMISSION_COST
  }
}

/** Ordered pair key for sympathy streak / met maps. */
function sympathyPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
}

const SYMPATHY_ACCRUE = 0.01
const SYMPATHY_STREAK_TICKS = 10
const SYMPATHY_DECAY = 0.02
const SYMPATHY_FRIEND = 0.3
const SYMPATHY_CLOSE = 0.6

/** Posted stall food price from stock (world fact). */
export function marketPriceFromStock(stock: number): number {
  const raw = Math.round(4 * Math.sqrt(8 / Math.max(stock, 1)))
  return Math.max(2, Math.min(12, raw))
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function pct(n: number): number {
  return Math.round(clamp01(n) * 100)
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function isWithinExamineRange(
  ax: number,
  ay: number,
  place: Place,
): boolean {
  return dist2(ax, ay, place.x, place.y) <= EXAMINE_RANGE_SQ
}

/** Nearest walkable tile within examine range of the place (stay put if already there). */
function pickExamineStand(
  world: WorldState,
  agent: AgentState,
  place: Place,
): { x: number; y: number } {
  if (isWithinExamineRange(agent.x, agent.y, place)) {
    return { x: Math.round(agent.x), y: Math.round(agent.y) }
  }
  const r = 2
  let best: { x: number; y: number; d: number } | null = null
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = place.x + dx
      const y = place.y + dy
      if (!isWalkable(world, x, y)) continue
      if (dist2(x, y, place.x, place.y) > EXAMINE_RANGE_SQ) continue
      const d = dist2(agent.x, agent.y, x, y)
      if (
        !best ||
        d < best.d - 1e-12 ||
        (Math.abs(d - best.d) <= 1e-12 &&
          (x < best.x || (x === best.x && y < best.y)))
      ) {
        best = { x, y, d }
      }
    }
  }
  if (best) return { x: best.x, y: best.y }
  return { x: place.x, y: place.y }
}

function atTarget(agent: AgentState, tx: number, ty: number): boolean {
  return Math.abs(agent.x - tx) < 0.05 && Math.abs(agent.y - ty) < 0.05
}

function resolveTarget(agent: AgentState): { x: number; y: number } | null {
  const a = agent.action
  if (a.targetX !== undefined && a.targetY !== undefined) {
    return { x: a.targetX, y: a.targetY }
  }
  return null
}

/** One completed step onto (x, y). No-op at the cap; missing wear counts as 0. */
function accrueWear(world: WorldState, x: number, y: number): void {
  const tx = Math.round(x)
  const ty = Math.round(y)
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return
  const tile = world.tiles[ty * world.width + tx]
  if (!tile) return
  const cur = tile.wear ?? 0
  if (cur >= WEAR_CAP) return
  tile.wear = cur + 1
}

function cloneSimSnapshot(s: SimSnapshot): SimSnapshot {
  return {
    state: deepCloneWorld(s.state),
    rngState: s.rngState,
    eventSeq: s.eventSeq,
    events: s.events.map((e) => ({
      ...e,
      data: e.data ? { ...e.data } : undefined,
    })),
  }
}

class SnapshotStore {
  private snaps: SimSnapshot[] = []
  /** Snapshot ticks that must survive prune (day-start pins). */
  private pinned = new Set<Tick>()

  add(snap: SimSnapshot): void {
    // Replace any existing snap at the same tick (keep one entry per tick).
    const t = snap.state.tick
    const idx = this.snaps.findIndex((s) => s.state.tick === t)
    if (idx >= 0) this.snaps[idx] = snap
    else this.snaps.push(snap)
  }

  pin(tick: Tick): void {
    this.pinned.add(tick)
  }

  isPinned(tick: Tick): boolean {
    return this.pinned.has(tick)
  }

  /** Drop unpinned snapshots with startTick < tick ≤ endTick (fine ring for a finished day). */
  pruneRange(startTick: Tick, endTick: Tick): void {
    this.snaps = this.snaps.filter((s) => {
      const t = s.state.tick
      if (t <= startTick || t > endTick) return true
      return this.pinned.has(t)
    })
  }

  /** Nearest snapshot with tick ≤ target. */
  nearestAtOrBefore(tick: Tick): SimSnapshot | null {
    let best: SimSnapshot | null = null
    for (const s of this.snaps) {
      if (s.state.tick <= tick) {
        if (!best || s.state.tick > best.state.tick) best = s
      }
    }
    return best
  }

  ticks(): number[] {
    return this.snaps.map((s) => s.state.tick).sort((a, b) => a - b)
  }

  /** Deep-cloned pack for persistence. */
  exportPack(): { snaps: SimSnapshot[]; pinned: Tick[] } {
    return {
      snaps: this.snaps.map(cloneSimSnapshot),
      pinned: [...this.pinned].sort((a, b) => a - b),
    }
  }

  loadPack(snaps: SimSnapshot[], pinned: Tick[]): void {
    this.snaps = snaps.map(cloneSimSnapshot)
    this.pinned = new Set(pinned)
  }

  clear(): void {
    this.snaps = []
    this.pinned.clear()
  }
}

export class Simulation {
  state: WorldState
  private rng: Rng
  private events: EventTrace
  private snapshots: SnapshotStore
  private dayArchives: DayArchiveMeta[] = []
  private brain = new UtilityBrain(LUNA_MIND_IDS)
  /**
   * Live inbox: intents posted mid-tick, applied at the start of the next step
   * (sorted by agentId then queue order).
   */
  private externalInbox: Array<{
    agentId: string
    intent: Intent
    meta: ExternalIntentMeta
  }> = []
  /**
   * Live inbox: mind notes posted mid-tick, applied at the start of the next step
   * (sorted by agentId then queue order).
   */
  private mindNoteInbox: Array<{
    agentId: string
    notes: string[]
    meta: MindNoteMeta
    learned?: string[]
  }> = []
  /** Trace-derived: agentId → place kinds already noticed (discovery:noticed). */
  private noticedKinds = new Map<string, Set<string>>()
  /**
   * Live inbox: conversation utterances posted mid-tick, applied next step.
   */
  private sayInbox: Array<{
    conversationId: string
    agentId: string
    partnerId: string
    turn: number
    text: string
    done: boolean
    source?: 'luna' | 'template'
  }> = []
  /**
   * Full intent log for re-sim playback (set on forks via stateAt).
   * When non-null, intents at the current tick are re-applied from this list
   * instead of consulting the brain for that agent.
   */
  private intentPlayback: ExternalIntentRecord[] | null = null
  /**
   * Full mind-note log for re-sim playback (set on forks via stateAt).
   * When non-null, notes at the current tick are re-applied from this list
   * instead of consulting any provider.
   */
  private notePlayback: MindNoteRecord[] | null = null
  /**
   * Full say log for re-sim playback (set on forks via stateAt).
   */
  private sayPlayback: SayRecord[] | null = null
  /** Agents who received an external intent this tick (skip brain redecide). */
  private externalAppliedThisTick = new Set<string>()
  /**
   * Participation hold (P3-2c): active conversation participants defer non-urgent
   * UtilityBrain redecide until the chat ends (urgent need still redecides).
   * Set each tick by LunaBrain; empty when no active conversations.
   */
  private conversationHold = new Set<string>()

  constructor(seed: number)
  constructor(
    seed: number,
    opts?: {
      state?: WorldState
      rngState?: number
      events?: EventTrace
      snapshots?: SnapshotStore
      dayArchives?: DayArchiveMeta[]
      skipInitEvents?: boolean
      intentPlayback?: ExternalIntentRecord[] | null
      notePlayback?: MindNoteRecord[] | null
      sayPlayback?: SayRecord[] | null
      preset?: WorldPreset
      seedFoundingBoard?: boolean
    },
  )
  constructor(
    seed: number,
    opts?: {
      state?: WorldState
      rngState?: number
      events?: EventTrace
      snapshots?: SnapshotStore
      dayArchives?: DayArchiveMeta[]
      skipInitEvents?: boolean
      intentPlayback?: ExternalIntentRecord[] | null
      notePlayback?: MindNoteRecord[] | null
      sayPlayback?: SayRecord[] | null
      preset?: WorldPreset
      seedFoundingBoard?: boolean
    },
  ) {
    this.snapshots = opts?.snapshots ?? new SnapshotStore()
    this.events = opts?.events ?? new EventTrace()
    this.rng = createRng(seed)
    this.intentPlayback = opts?.intentPlayback ?? null
    this.notePlayback = opts?.notePlayback ?? null
    this.sayPlayback = opts?.sayPlayback ?? null
    if (opts?.dayArchives) {
      this.dayArchives = opts.dayArchives.map((a) => ({
        day: a.day,
        startTick: a.startTick,
        endTick: a.endTick,
      }))
    }

    if (opts?.state) {
      this.state = opts.state
      ensureMindFields(this.state)
      if (opts.rngState !== undefined) this.rng.setState(opts.rngState)
    } else {
      this.state = generateWorld(seed, opts?.preset)
      // Agent rng starts fresh from seed (worldgen uses its own internal rng from seed)
      this.rng = createRng(seed)
      spawnAgents(this.state, this.rng)
      ensureMindFields(this.state)
      if (!opts?.skipInitEvents) {
        this.events.append({
          tick: 0,
          type: 'world:created',
          data: {
            seed,
            width: this.state.width,
            height: this.state.height,
            preset: this.state.preset ?? 'default',
          },
        })
        this.events.append({
          tick: 0,
          type: 'day:start',
          data: { day: 1 },
        })
      }
      // Snapshot at tick 0 — permanently pinned as Day 1 start
      this.snapshots.add(this.makeSnapshot())
      this.snapshots.pin(0)
    }
    this.rebuildNoticedCache()
    if (opts?.seedFoundingBoard === true && !opts?.state) {
      this.seedFoundingProposal()
      // Replace the tick-0 snap so time travel includes the founding artifacts.
      this.snapshots.add(this.makeSnapshot())
    }
  }

  /**
   * Queue an external (mind) intent for application at the start of the next
   * step. Live path only — replays use intentPlayback / externalIntentLog.
   */
  postExternalIntent(
    agentId: string,
    intent: Intent,
    meta: ExternalIntentMeta,
  ): void {
    this.externalInbox.push({
      agentId,
      intent: cloneIntent(intent),
      meta: cloneExternalMeta(meta),
    })
  }

  /**
   * Queue mind reflection notes for application at the start of the next step.
   * Live path only — replays use notePlayback / mindNoteLog.
   */
  postMindNotes(
    agentId: string,
    notes: string[],
    meta: MindNoteMeta,
    learned?: string[],
  ): void {
    this.mindNoteInbox.push({
      agentId,
      notes: notes.map((n) => String(n)),
      meta: cloneMindNoteMeta(meta),
      ...(learned && learned.length > 0
        ? { learned: learned.map((n) => String(n)) }
        : {}),
    })
  }

  /**
   * Queue a conversation utterance for application at the start of the next step.
   * Live path only — replays use sayPlayback / sayLog.
   * @param source optional — 'template' for sheep replies (P3-2c); default luna.
   */
  postSay(
    conversationId: string,
    agentId: string,
    partnerId: string,
    turn: number,
    text: string,
    done: boolean,
    source?: 'luna' | 'template',
  ): void {
    this.sayInbox.push({
      conversationId,
      agentId,
      partnerId,
      turn,
      text: String(text),
      done: !!done,
      ...(source ? { source } : {}),
    })
  }

  /**
   * Participation hold for active conversation participants (P3-2c).
   * Non-urgent redecide is deferred while held; urgent need (< 0.15) still fires.
   */
  setConversationHold(agentIds: readonly string[]): void {
    this.conversationHold = new Set(agentIds)
  }

  /** Test/dev: agents currently held in conversation participation. */
  getConversationHold(): readonly string[] {
    return [...this.conversationHold]
  }

  /**
   * Record a mind:fallback event (invalid JSON, timeout, etc.) without
   * changing agent action. Safe to call from outside the sim step.
   */
  postMindFallback(
    agentId: string,
    data: Record<string, unknown>,
    reason: string,
  ): void {
    ensureMindFields(this.state)
    const stats = this.state.mindStats[agentId] ?? {
      decisions: 0,
      fallbacks: 0,
      totalLatencyMs: 0,
      approxChars: 0,
    }
    stats.fallbacks += 1
    if (typeof data.latencyMs === 'number') {
      stats.totalLatencyMs += data.latencyMs
    }
    if (typeof data.approxChars === 'number') {
      stats.approxChars += data.approxChars
    }
    this.state.mindStats[agentId] = stats
    this.events.append({
      tick: this.state.tick,
      type: 'mind:fallback',
      agentId,
      data: { ...data, source: 'luna' },
      reason,
    })
  }

  /**
   * Record a mind:stale discard (intent arrived too late after requestTick).
   * Not a generic fallback — does not bump fallback counters.
   */
  postMindStale(
    agentId: string,
    data: Record<string, unknown>,
    reason: string,
  ): void {
    ensureMindFields(this.state)
    this.events.append({
      tick: this.state.tick,
      type: 'mind:stale',
      agentId,
      data: { ...data, source: 'luna' },
      reason,
    })
  }

  /**
   * Record a mind:budget event (sidecar hourly/daily ceiling hit).
   * Once per exhaustion episode — client cooldown suppresses further dispatches.
   * Does not bump fallback counters; agents keep living on UtilityBrain instinct.
   */
  postMindBudget(
    agentId: string,
    data: Record<string, unknown>,
    reason: string,
  ): void {
    ensureMindFields(this.state)
    this.events.append({
      tick: this.state.tick,
      type: 'mind:budget',
      agentId,
      data: { ...data, source: 'luna' },
      reason,
    })
  }

  /** Install full-log playback for re-sim (stateAt / forks). */
  setIntentPlayback(log: ExternalIntentRecord[] | null): void {
    this.intentPlayback = log ? cloneExternalIntentLog(log) : null
  }

  /** Install mind-note playback for re-sim (stateAt / forks). */
  setNotePlayback(log: MindNoteRecord[] | null): void {
    this.notePlayback = log ? cloneMindNoteLog(log) : null
  }

  /** Install say-log playback for re-sim (stateAt / forks). */
  setSayPlayback(log: SayRecord[] | null): void {
    this.sayPlayback = log ? cloneSayLog(log) : null
  }

  getExternalIntentLog(): readonly ExternalIntentRecord[] {
    ensureMindFields(this.state)
    return this.state.externalIntentLog
  }

  getMindNoteLog(): readonly MindNoteRecord[] {
    ensureMindFields(this.state)
    return this.state.mindNoteLog
  }

  getSayLog(): readonly SayRecord[] {
    ensureMindFields(this.state)
    return this.state.sayLog
  }

  /** Pending live-inbox size (not yet applied). */
  getExternalInboxSize(): number {
    return this.externalInbox.length
  }

  /** Pending mind-note inbox size (not yet applied). */
  getMindNoteInboxSize(): number {
    return this.mindNoteInbox.length
  }

  /** Pending say inbox size (not yet applied). */
  getSayInboxSize(): number {
    return this.sayInbox.length
  }

  getEvents(): readonly SimEvent[] {
    return this.events.getAll()
  }

  getEventCount(): number {
    return this.events.length
  }

  getRng(): Rng {
    return this.rng
  }

  /**
   * Coin conservation law: the ONLY way money moves.
   * `from`/`to` are agent ids or `'treasury'`. Never creates or destroys coins.
   */
  transferCoins(
    from: CoinParty,
    to: CoinParty,
    amount: number,
    reason: string,
    extra?: Record<string, unknown>,
  ): boolean {
    if (amount <= 0 || from === to) return false
    const fromBal = this.coinBalance(from)
    if (fromBal < amount) return false
    this.setCoinBalance(from, fromBal - amount)
    this.setCoinBalance(to, this.coinBalance(to) + amount)
    this.events.append({
      tick: this.state.tick,
      type: 'coins:transfer',
      agentId: to !== 'treasury' ? to : from !== 'treasury' ? from : undefined,
      data: { from, to, amount, ...(extra ?? {}) },
      reason,
    })
    return true
  }

  /**
   * Mint goods at a place (farm harvest only). Emits `goods:produced`.
   * The ONLY creation path besides bush regrowth.
   */
  produceGoods(
    placeId: string,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const place = this.state.places.find((p) => p.id === placeId)
    if (!place) return false
    place.inventory[good] = (place.inventory[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:produced',
      data: { good, amount, placeId, placeKind: place.kind },
      reason,
    })
    return true
  }

  /**
   * Goods conservation for moves: the ONLY way goods change hands.
   * Creation uses `regrowGoods`; destruction uses `consumeGoods`.
   */
  transferGoods(
    from: GoodsParty,
    to: GoodsParty,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const fromInv = this.goodsInventory(from)
    const toInv = this.goodsInventory(to)
    if (!fromInv || !toInv) return false
    if ((fromInv[good] ?? 0) < amount) return false
    fromInv[good] = (fromInv[good] ?? 0) - amount
    toInv[good] = (toInv[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:transfer',
      agentId: to.kind === 'agent' ? to.id : from.kind === 'agent' ? from.id : undefined,
      data: {
        good,
        amount,
        fromKind: from.kind,
        fromId: from.id,
        toKind: to.kind,
        toId: to.id,
      },
      reason,
    })
    // Keep posted stall price honest when stock moves mid-hour
    if (
      good === 'food' &&
      ((from.kind === 'place' && this.state.places.find((p) => p.id === from.id)?.kind === 'stall') ||
        (to.kind === 'place' && this.state.places.find((p) => p.id === to.id)?.kind === 'stall'))
    ) {
      this.stepMarketPrice()
    }
    return true
  }

  /** Destroy goods from a holder (eating). Emits `goods:consume`. */
  consumeGoods(
    holder: GoodsParty,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const inv = this.goodsInventory(holder)
    if (!inv) return false
    if ((inv[good] ?? 0) < amount) return false
    inv[good] = (inv[good] ?? 0) - amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:consume',
      agentId: holder.kind === 'agent' ? holder.id : undefined,
      data: {
        good,
        amount,
        holderKind: holder.kind,
        holderId: holder.id,
      },
      reason,
    })
    return true
  }

  /** World process: create goods at a place (bush regrowth). Emits `goods:regrow`. */
  regrowGoods(
    placeId: string,
    good: Good,
    amount: number,
    reason: string,
  ): boolean {
    if (amount <= 0) return false
    const place = this.state.places.find((p) => p.id === placeId)
    if (!place) return false
    place.inventory[good] = (place.inventory[good] ?? 0) + amount
    this.events.append({
      tick: this.state.tick,
      type: 'goods:regrow',
      data: { good, amount, placeId, placeKind: place.kind },
      reason,
    })
    return true
  }

  /** Ownership registry transfer. Emits `ownership:transfer`. */
  transferOwnership(
    placeId: string,
    newOwner: OwnerId,
    reason: string,
  ): boolean {
    if (!(placeId in this.state.owners) && !this.state.places.some((p) => p.id === placeId)) {
      return false
    }
    const prev = this.state.owners[placeId] ?? 'commons'
    if (prev === newOwner) return false
    this.state.owners[placeId] = newOwner
    this.events.append({
      tick: this.state.tick,
      type: 'ownership:transfer',
      data: { placeId, from: prev, to: newOwner },
      reason,
    })
    return true
  }

  private openProposals(): Proposal[] {
    ensureMindFields(this.state)
    return this.state.proposals.filter((p) => p.status === 'open')
  }

  /**
   * Day-one civic artifact: a notice-board (placed if missing) plus one open
   * founding proposal. Direct state push — not propose() — so it skips the
   * 2-coin fee and already-open check. Fresh worlds only.
   */
  private seedFoundingProposal(): void {
    ensureMindFields(this.state)
    if (this.state.proposals.length > 0) return
    const plaza = this.state.places.find((p) => p.kind === 'plaza')
    if (!plaza) return

    let board = this.state.places.find((p) => p.kind === 'notice-board')
    if (!board) {
      const taken = new Set(this.state.places.map((p) => `${p.x},${p.y}`))
      taken.add(`${plaza.x},${plaza.y}`)
      const spot = findNoticeBoardSpot(this.state.tiles, plaza.x, plaza.y, taken)
      board = {
        id: FOUNDING_BOARD_ID,
        kind: 'notice-board',
        x: spot ? spot.x : plaza.x + 2,
        y: spot ? spot.y : plaza.y + 1,
        slots: 2,
        inventory: emptyInventory(),
      }
      this.state.places.push(board)
      this.state.owners[board.id] = 'commons'
    }

    const closesTick = this.state.tick + PROPOSAL_WINDOW_TICKS
    const proposal: Proposal = {
      id: FOUNDING_PROPOSAL_ID,
      proposerId: 'anonymous',
      text: FOUNDING_PROPOSAL_TEXT,
      createdTick: this.state.tick,
      closesTick,
      votes: {},
      status: 'open',
    }
    this.state.proposals.push(proposal)
    this.events.append({
      tick: this.state.tick,
      type: 'institution:proposed',
      agentId: undefined,
      data: {
        proposalId: FOUNDING_PROPOSAL_ID,
        text: FOUNDING_PROPOSAL_TEXT,
        proposerId: 'anonymous',
        agentName: 'the founders',
        closesTick,
        firstProposal: true,
      },
      reason: `A founding notice was posted: "${FOUNDING_PROPOSAL_TEXT}"`,
    })
    for (const agent of this.state.agents) {
      if (isSheepAgent(agent.id)) continue
      this.events.append({
        tick: this.state.tick,
        type: 'discovery:examined',
        agentId: agent.id,
        data: {
          target: board.id,
          placeKind: 'notice-board',
          knowledge: EXAMINE_BY_KIND['notice-board'],
          agentName: agent.name,
        },
        reason: `${agent.name} already knows the board's uses`,
      })
    }
  }

  /**
   * Post a proposal: PROPOSE_COST coins proposer→treasury (0 by default), one
   * open per proposer, max 2 open island-wide. Spam is bounded by those two
   * caps and the day-long window, not by the fee. Refusal is a no-op with an
   * honest event.
   */
  propose(agentId: string, text: string): boolean {
    ensureMindFields(this.state)
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return false
    const clipped = String(text ?? '').trim().slice(0, 200)
    if (clipped.length === 0) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:propose-refused',
        agentId,
        data: { agentName: agent.name, why: 'empty-text' },
        reason: `${agent.name} tried to propose with no text`,
      })
      return false
    }
    const open = this.openProposals()
    if (open.some((p) => p.proposerId === agentId)) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:propose-refused',
        agentId,
        data: { agentName: agent.name, why: 'already-open', text: clipped },
        reason: `${agent.name} already has an open proposal`,
      })
      return false
    }
    if (open.length >= MAX_OPEN_PROPOSALS) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:propose-refused',
        agentId,
        data: { agentName: agent.name, why: 'island-full', text: clipped },
        reason: `${agent.name} could not propose — the board already has ${MAX_OPEN_PROPOSALS} open proposals`,
      })
      return false
    }
    // A zero fee is the default: skip the wallet gate entirely rather than
    // routing a 0-coin transfer through transferCoins, which rejects amount<=0.
    if (PROPOSE_COST > 0) {
      if (agent.wallet < PROPOSE_COST) {
        this.events.append({
          tick: this.state.tick,
          type: 'institution:propose-refused',
          agentId,
          data: { agentName: agent.name, why: 'cannot-afford', text: clipped, cost: PROPOSE_COST },
          reason: `${agent.name} could not afford the ${PROPOSE_COST}-coin proposal fee`,
        })
        return false
      }
      const paid = this.transferCoins(
        agentId,
        'treasury',
        PROPOSE_COST,
        `${agent.name} paid ${PROPOSE_COST} coins to post a proposal`,
        { kind: 'propose' },
      )
      if (!paid) {
        this.events.append({
          tick: this.state.tick,
          type: 'institution:propose-refused',
          agentId,
          data: { agentName: agent.name, why: 'transfer-failed', text: clipped },
          reason: `${agent.name} could not pay the proposal fee`,
        })
        return false
      }
    }
    const id = `prop-${agentId}-${this.state.tick}`
    const proposal: Proposal = {
      id,
      proposerId: agentId,
      text: clipped,
      createdTick: this.state.tick,
      closesTick: this.state.tick + PROPOSAL_WINDOW_TICKS,
      votes: {},
      status: 'open',
    }
    this.state.proposals.push(proposal)
    this.events.append({
      tick: this.state.tick,
      type: 'institution:proposed',
      agentId,
      data: {
        proposalId: id,
        text: clipped,
        proposerId: agentId,
        agentName: agent.name,
        closesTick: proposal.closesTick,
        firstProposal: this.state.proposals.length === 1,
      },
      reason: `${agent.name} proposed: "${clipped}"`,
    })
    return true
  }

  /**
   * Record one vote per villager per proposal, only while open.
   * `sheep` marks electorate votes (world process) vs mind/intent votes.
   *
   * Costs VOTE_COST coins (0 by default), charged to sheep and mind votes
   * alike — a villager voting is a villager voting. The knob exists so the
   * propose/vote cost relation is a stated design choice; see PROPOSE_COST.
   */
  vote(agentId: string, proposalId: string, choice: VoteChoice, sheep = false): boolean {
    ensureMindFields(this.state)
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return false
    if (choice !== 'yes' && choice !== 'no') {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:vote-refused',
        agentId,
        data: { agentName: agent.name, proposalId, why: 'bad-choice' },
        reason: `${agent.name} tried to cast an invalid vote`,
      })
      return false
    }
    const proposal = this.state.proposals.find((p) => p.id === proposalId)
    if (!proposal) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:vote-refused',
        agentId,
        data: { agentName: agent.name, proposalId, why: 'missing' },
        reason: `${agent.name} voted on a proposal that does not exist`,
      })
      return false
    }
    if (proposal.status !== 'open') {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:vote-refused',
        agentId,
        data: { agentName: agent.name, proposalId, why: 'closed', status: proposal.status },
        reason: `${agent.name} voted after the proposal closed`,
      })
      return false
    }
    if (proposal.votes[agentId] !== undefined) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:vote-refused',
        agentId,
        data: { agentName: agent.name, proposalId, why: 'already-voted' },
        reason: `${agent.name} already voted on this proposal`,
      })
      return false
    }
    if (VOTE_COST > 0) {
      if (agent.wallet < VOTE_COST) {
        this.events.append({
          tick: this.state.tick,
          type: 'institution:vote-refused',
          agentId,
          data: { agentName: agent.name, proposalId, why: 'cannot-afford', cost: VOTE_COST },
          reason: `${agent.name} could not afford the ${VOTE_COST}-coin vote fee`,
        })
        return false
      }
      const paid = this.transferCoins(
        agentId,
        'treasury',
        VOTE_COST,
        `${agent.name} paid ${VOTE_COST} coins to vote`,
        { kind: 'vote' },
      )
      if (!paid) {
        this.events.append({
          tick: this.state.tick,
          type: 'institution:vote-refused',
          agentId,
          data: { agentName: agent.name, proposalId, why: 'transfer-failed' },
          reason: `${agent.name} could not pay the vote fee`,
        })
        return false
      }
    }
    proposal.votes[agentId] = choice
    this.events.append({
      tick: this.state.tick,
      type: 'institution:voted',
      agentId,
      data: {
        proposalId,
        choice,
        agentName: agent.name,
        sheep,
      },
      reason: `${agent.name} voted ${choice} on "${proposal.text}"`,
    })
    return true
  }

  /**
   * Public censure: 1 coin sanctioner→treasury. No mechanical effect on the target.
   */
  sanction(agentId: string, targetId: string, reason: string, ruleId?: string): boolean {
    ensureMindFields(this.state)
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return false
    const clipped = String(reason ?? '').trim().slice(0, 120)
    if (clipped.length === 0) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:sanction-refused',
        agentId,
        data: { agentName: agent.name, targetId, why: 'empty-reason' },
        reason: `${agent.name} tried to sanction with no reason`,
      })
      return false
    }
    const target = this.state.agents.find((a) => a.id === targetId)
    if (!target) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:sanction-refused',
        agentId,
        data: { agentName: agent.name, targetId, why: 'missing-target' },
        reason: `${agent.name} sanctioned someone who is not here`,
      })
      return false
    }
    if (agent.wallet < SANCTION_COST) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:sanction-refused',
        agentId,
        data: {
          agentName: agent.name,
          targetId,
          targetName: target.name,
          why: 'cannot-afford',
          cost: SANCTION_COST,
        },
        reason: `${agent.name} could not afford the ${SANCTION_COST}-coin sanction fee`,
      })
      return false
    }
    const paid = this.transferCoins(
      agentId,
      'treasury',
      SANCTION_COST,
      `${agent.name} paid ${SANCTION_COST} coin to post a sanction`,
      { kind: 'sanction' },
    )
    if (!paid) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:sanction-refused',
        agentId,
        data: { agentName: agent.name, targetId, targetName: target.name, why: 'transfer-failed' },
        reason: `${agent.name} could not pay the sanction fee`,
      })
      return false
    }
    const cited = ruleId && String(ruleId).trim().length > 0 ? String(ruleId).trim() : undefined
    this.events.append({
      tick: this.state.tick,
      type: 'institution:sanctioned',
      agentId,
      data: {
        targetId,
        targetName: target.name,
        agentName: agent.name,
        reason: clipped,
        ruleId: cited,
      },
      reason: `${agent.name} sanctioned ${target.name}: "${clipped}"`,
    })
    return true
  }

  /**
   * Privatize a commons place: 15 coins claimer→treasury, then transferOwnership.
   */
  claim(agentId: string, placeId: string): boolean {
    ensureMindFields(this.state)
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return false
    const place = this.state.places.find((p) => p.id === placeId)
    if (!place) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:claim-refused',
        agentId,
        data: { agentName: agent.name, placeId, why: 'missing-place' },
        reason: `${agent.name} tried to claim a place that does not exist`,
      })
      return false
    }
    const owner = this.state.owners[placeId] ?? 'commons'
    if (owner !== 'commons') {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:claim-refused',
        agentId,
        data: {
          agentName: agent.name,
          placeId,
          placeKind: place.kind,
          why: 'not-commons',
          owner,
        },
        reason: `${agent.name} cannot claim ${place.kind} ${placeId} — it is not commons`,
      })
      return false
    }
    if (agent.wallet < CLAIM_COST) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:claim-refused',
        agentId,
        data: {
          agentName: agent.name,
          placeId,
          placeKind: place.kind,
          why: 'cannot-afford',
          cost: CLAIM_COST,
        },
        reason: `${agent.name} could not afford the ${CLAIM_COST}-coin claim fee`,
      })
      return false
    }
    const paid = this.transferCoins(
      agentId,
      'treasury',
      CLAIM_COST,
      `${agent.name} paid ${CLAIM_COST} coins to claim ${place.kind} ${placeId}`,
      { kind: 'claim', placeId },
    )
    if (!paid) {
      this.events.append({
        tick: this.state.tick,
        type: 'institution:claim-refused',
        agentId,
        data: { agentName: agent.name, placeId, placeKind: place.kind, why: 'transfer-failed' },
        reason: `${agent.name} could not pay the claim fee`,
      })
      return false
    }
    const transferred = this.transferOwnership(placeId, agentId, 'claimed it')
    if (!transferred) {
      // Fee already paid — fee is the mechanics; ownership no-op is honest.
      this.events.append({
        tick: this.state.tick,
        type: 'institution:claim-refused',
        agentId,
        data: { agentName: agent.name, placeId, placeKind: place.kind, why: 'ownership-unchanged' },
        reason: `${agent.name} paid to claim ${place.kind} ${placeId} but ownership did not change`,
      })
      return false
    }
    this.events.append({
      tick: this.state.tick,
      type: 'institution:claimed',
      agentId,
      data: {
        placeId,
        placeKind: place.kind,
        agentName: agent.name,
      },
      reason: `${agent.name} claimed the ${place.kind}`,
    })
    return true
  }

  /**
   * Sheep electorate: at 18:00, every sheep votes on each open proposal
   * they have not voted on. yes if sympathy toward proposer ≥ 0.25.
   * Agent-index order, then proposal array order.
   */
  private stepSheepElectorate(): void {
    ensureMindFields(this.state)
    const open = this.openProposals()
    if (open.length === 0) return
    for (const agent of this.state.agents) {
      if (!isSheepAgent(agent.id)) continue
      for (const proposal of open) {
        if (proposal.status !== 'open') continue
        if (proposal.votes[agent.id] !== undefined) continue
        const sympathy = agent.sympathy?.[proposal.proposerId] ?? 0
        const choice: VoteChoice = sympathy >= SHEEP_SYMPATHY_YES ? 'yes' : 'no'
        this.vote(agent.id, proposal.id, choice, true)
      }
    }
  }

  /** Close proposals whose window has ended. Passed → append to world.rules. */
  private closeExpiredProposals(): void {
    ensureMindFields(this.state)
    const tick = this.state.tick
    for (const proposal of this.state.proposals) {
      if (proposal.status !== 'open') continue
      if (tick < proposal.closesTick) continue
      const tally = proposalTally(proposal)
      // Advisory votes are recorded and reported; only binding votes decide.
      const binding = bindingTally(proposal)
      const passed = binding.yes > binding.no && binding.total >= PROPOSAL_QUORUM
      proposal.status = passed ? 'passed' : 'failed'
      if (passed) {
        this.state.rules.push({
          id: proposal.id,
          text: proposal.text,
          proposerId: proposal.proposerId,
          enactedTick: tick,
          active: true,
        })
      }
      const firstRule = passed && this.state.rules.filter((r) => r.active).length === 1
      this.events.append({
        tick,
        type: 'institution:closed',
        agentId: proposal.proposerId,
        data: {
          proposalId: proposal.id,
          // The numbers that decided it.
          yes: binding.yes,
          no: binding.no,
          total: binding.total,
          // Everyone's opinion, including the advisory electorate.
          allYes: tally.yes,
          allNo: tally.no,
          allTotal: tally.total,
          status: proposal.status,
          text: proposal.text,
          firstRule,
        },
        reason: passed
          ? `Proposal passed (${binding.yes}–${binding.no}, village ${tally.yes}–${tally.no})`
          : `Proposal failed (${binding.yes}–${binding.no}, village ${tally.yes}–${tally.no})`,
      })
    }
  }

  private coinBalance(party: CoinParty): number {
    if (party === 'treasury') return this.state.treasury
    const agent = this.state.agents.find((a) => a.id === party)
    return agent?.wallet ?? 0
  }

  private setCoinBalance(party: CoinParty, value: number): void {
    if (party === 'treasury') {
      this.state.treasury = value
      return
    }
    const agent = this.state.agents.find((a) => a.id === party)
    if (agent) agent.wallet = value
  }

  private goodsInventory(party: GoodsParty): Inventory | null {
    if (party.kind === 'agent') {
      const agent = this.state.agents.find((a) => a.id === party.id)
      return agent?.inventory ?? null
    }
    const place = this.state.places.find((p) => p.id === party.id)
    return place?.inventory ?? null
  }

  /** Completed day archives (oldest first). Events are never pruned. */
  archives(): readonly DayArchiveMeta[] {
    return this.dayArchives
  }

  /** Test/debug: ticks of retained snapshots (after day prunes). */
  snapshotTicks(): number[] {
    return this.snapshots.ticks()
  }

  /** Deep-cloned snapshot ring + pins for serializeSave. */
  exportSnapshotPack(): { snaps: SimSnapshot[]; pinned: Tick[] } {
    return this.snapshots.exportPack()
  }

  /** Synchronous multi-tick advance (bridge: `__simControl.ffwd`). */
  advanceTicksBatch(n: number): void {
    this.advanceTicks(n)
  }

  /** Advance every agent one sim minute: needs, movement, actions, decisions. */
  stepAgents(): void {
    const world = this.state
    const tick = world.tick
    const time = toSimTime(tick)
    const hour = time.hour

    // Snapshot agent positions for proximity social regen
    const positions = world.agents.map((a) => ({ id: a.id, x: a.x, y: a.y }))

    for (const agent of world.agents) {
      this.stepNeeds(agent, positions)
      this.stepMovementAndAction(agent)
      this.emitPlaceNotices(agent)
      this.maybeRedecide(agent, hour)
    }
    // World rule 3: after movement, later-indexed co-standers yield a free tile.
    // Two passes — a first nudge can free a tile for a third stacked agent.
    for (let pass = 0; pass < 2; pass++) {
      for (const agent of world.agents) {
        this.resolveCoStanding(agent)
      }
    }
  }

  private stepNeeds(
    agent: AgentState,
    positions: Array<{ id: string; x: number; y: number }>,
  ): void {
    const j = agent.needJitter
    const place = agent.action.targetPlaceId
      ? this.state.places.find((p) => p.id === agent.action.targetPlaceId)
      : undefined
    const canRestore =
      !!place &&
      this.isPerforming(agent) &&
      canRestoreThisTick(this.state, agent, place)
    // Collapse blocks restores except eat/sleep (eat is inventory-based, not place restore)
    const restoreAllowed = !agent.collapsed
    const sleeping =
      agent.action.kind === 'sleep' && this.isPerforming(agent)
    const onBed = sleeping && this.isSleepingOnBed(agent)

    // Hunger decay always
    agent.needs.hunger = clamp01(agent.needs.hunger - (1 / 960) * j.hunger)

    // Energy: decay awake; bed slots full rate, anywhere else 60% rate
    if (sleeping) {
      const rate = onBed ? SLEEP_BED_ENERGY : SLEEP_GROUND_ENERGY
      agent.needs.energy = clamp01(agent.needs.energy + rate * j.energy)
    } else {
      agent.needs.energy = clamp01(agent.needs.energy - (1 / 1080) * j.energy)
    }

    // World rule 2: social regenerates only with another agent within 1.5 tiles
    // Collapse blocks social restore (active + passive proximity gain)
    let nearOther = false
    for (const p of positions) {
      if (p.id === agent.id) continue
      if (dist2(agent.x, agent.y, p.x, p.y) <= SOCIAL_PROXIMITY_SQ) {
        nearOther = true
        break
      }
    }
    if (nearOther && restoreAllowed) {
      // Active socialize on a plaza slot gets the full rate; otherwise passive proximity
      const socializing = agent.action.kind === 'socialize' && canRestore
      if (socializing) {
        agent.needs.social = clamp01(agent.needs.social + (1 / 90) * j.social)
      } else {
        agent.needs.social = clamp01(agent.needs.social + (1 / 2880) * j.social)
      }
    } else if (!nearOther) {
      agent.needs.social = clamp01(agent.needs.social - (1 / 720) * j.social)
    } else {
      // Collapsed + near other: social still decays (no restore while collapsed)
      agent.needs.social = clamp01(agent.needs.social - (1 / 720) * j.social)
    }

    this.checkCritical(agent, 'hunger', agent.needs.hunger)
    this.checkCritical(agent, 'energy', agent.needs.energy)
    this.checkCritical(agent, 'social', agent.needs.social)
    this.checkCollapse(agent)
  }

  private checkCollapse(agent: AgentState): void {
    if (!agent.collapsed && agent.needs.hunger <= COLLAPSE_ENTER) {
      agent.collapsed = true
      this.events.append({
        tick: this.state.tick,
        type: 'agent:collapsed',
        agentId: agent.id,
        data: {
          agentName: agent.name,
          hunger: agent.needs.hunger,
        },
        reason: `${agent.name} collapsed from hunger (${pct(agent.needs.hunger)}%) — needs food`,
      })
    } else if (agent.collapsed && agent.needs.hunger >= COLLAPSE_CLEAR) {
      agent.collapsed = false
      this.events.append({
        tick: this.state.tick,
        type: 'agent:recovered',
        agentId: agent.id,
        data: {
          agentName: agent.name,
          hunger: agent.needs.hunger,
        },
        reason: `${agent.name} recovered (hunger ${pct(agent.needs.hunger)}%) — back on their feet`,
      })
    }
  }

  private checkCritical(
    agent: AgentState,
    key: 'hunger' | 'energy' | 'social',
    value: number,
  ): void {
    if (value < 0.15) {
      if (!agent.criticalFired[key]) {
        agent.criticalFired[key] = true
        this.events.append({
          tick: this.state.tick,
          type: 'need:critical',
          agentId: agent.id,
          data: { need: key, value, agentName: agent.name },
          reason: `${key} critically low (${pct(value)}%)`,
        })
      }
    } else {
      agent.criticalFired[key] = false
    }
  }

  /** True when agent has arrived at action target (or idle with nothing to walk). */
  private isPerforming(agent: AgentState): boolean {
    if (agent.action.kind === 'idle') return true
    const target = resolveTarget(agent)
    if (!target) return true
    const path = agent.action.path
    if (path && agent.pathIndex < path.length) return false
    return atTarget(agent, target.x, target.y)
  }

  private stepMovementAndAction(agent: AgentState): void {
    const kind = agent.action.kind
    if (kind === 'idle') return

    const target = resolveTarget(agent)
    if (!target) return

    // Re-path if invalid
    const path = agent.action.path
    if (path && path.length > 0 && agent.pathIndex < path.length) {
      if (!pathStillValid(this.state, path, agent.pathIndex)) {
        const fresh = findPath(this.state, agent.x, agent.y, target.x, target.y)
        agent.action.path = fresh ?? []
        agent.pathIndex = 0
      }
    } else if (!atTarget(agent, target.x, target.y)) {
      // Need a path
      if (!path || path.length === 0 || agent.pathIndex >= (path?.length ?? 0)) {
        const fresh = findPath(this.state, agent.x, agent.y, target.x, target.y)
        agent.action.path = fresh ?? []
        agent.pathIndex = 0
      }
    }

    // Move along path (collapsed agents crawl at ×0.4)
    if (agent.action.path && agent.pathIndex < agent.action.path.length) {
      const speed = MOVE_SPEED * (agent.collapsed ? COLLAPSE_MOVE_FACTOR : 1)
      let remaining = speed
      while (remaining > 0 && agent.pathIndex < agent.action.path.length) {
        const [nx, ny] = agent.action.path[agent.pathIndex]!
        const dx = nx - agent.x
        const dy = ny - agent.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist <= remaining + 1e-9) {
          agent.x = nx
          agent.y = ny
          agent.pathIndex++
          accrueWear(this.state, nx, ny)
          remaining -= dist
        } else if (dist > 0) {
          agent.x += (dx / dist) * remaining
          agent.y += (dy / dist) * remaining
          remaining = 0
        } else {
          agent.pathIndex++
        }
      }
      return // walking this tick — no perform yet
    }

    // Arrived: perform action effects
    if (!atTarget(agent, target.x, target.y)) {
      // Unreachable — snap attempt failed; idle out
      this.endAction(agent, 'could not reach destination')
      agent.action = { kind: 'idle', reason: 'Stuck — catching their breath' }
      agent.actionTicks = 0
      agent.pathIndex = 0
      return
    }

    agent.x = target.x
    agent.y = target.y
    this.performAtTarget(agent)
  }

  private performAtTarget(agent: AgentState): void {
    const kind = agent.action.kind
    agent.actionTicks++

    const place = agent.action.targetPlaceId
      ? this.state.places.find((p) => p.id === agent.action.targetPlaceId)
      : undefined
    const onSlot = !!place && canRestoreThisTick(this.state, agent, place)

    // Eat anywhere: consume carried food over 10 ticks/unit, max 2 units/meal
    if (kind === 'eat') {
      if (
        agent.actionTicks > 0 &&
        agent.actionTicks % EAT_TICKS_PER_UNIT === 0
      ) {
        const unitsDone = agent.actionTicks / EAT_TICKS_PER_UNIT
        const ok = this.consumeGoods(
          { kind: 'agent', id: agent.id },
          'food',
          1,
          `${agent.name} ate carried food`,
        )
        if (ok) {
          agent.needs.hunger = clamp01(
            agent.needs.hunger + EAT_HUNGER_PER_UNIT,
          )
        }
        const moreFood = (agent.inventory.food ?? 0) >= 1
        if (!ok || unitsDone >= EAT_MAX_UNITS || !moreFood) {
          const before = agent.actionStartNeeds.hunger
          const after = agent.needs.hunger
          this.endAction(
            agent,
            `ate a meal, hunger ${pct(before)}%→${pct(after)}%`,
            {
              need: 'hunger',
              before,
              after,
              felt: `ate berries: hunger ${pct(before)}%→${pct(after)}%`,
            },
          )
          agent.action = {
            kind: 'idle',
            reason: ok ? 'Finished eating' : 'No food left to eat',
          }
          agent.actionTicks = 0
          agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        }
      } else if ((agent.inventory.food ?? 0) < 1 && agent.actionTicks === 1) {
        // Started eat with no food — abort immediately
        this.endAction(agent, 'had nothing to eat')
        agent.action = { kind: 'idle', reason: 'No food to eat' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    // Forage at bush slot: every 5 ticks, bush→agent 1 food until carry 3 or empty
    if (kind === 'forage') {
      if (onSlot && place) {
        if (
          agent.actionTicks > 0 &&
          agent.actionTicks % FORAGE_TICKS_PER_UNIT === 0
        ) {
          const bushStock = place.inventory.food ?? 0
          const carry = agent.inventory.food ?? 0
          if (bushStock > 0 && carry < FORAGE_CARRY_CAP) {
            this.transferGoods(
              { kind: 'place', id: place.id },
              { kind: 'agent', id: agent.id },
              'food',
              1,
              `${agent.name} picked berries at ${place.id}`,
            )
          }
        }
        const carry = agent.inventory.food ?? 0
        const bushStock = place.inventory.food ?? 0
        if (carry >= FORAGE_CARRY_CAP || bushStock <= 0) {
          this.endAction(
            agent,
            carry >= FORAGE_CARRY_CAP
              ? `foraged a full load (${carry} food)`
              : `bush empty, carrying ${carry} food`,
          )
          agent.action = {
            kind: 'idle',
            reason:
              carry >= FORAGE_CARRY_CAP
                ? 'Arms full of berries'
                : 'Bush picked clean',
          }
          agent.actionTicks = 0
          agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        }
      }
      return
    }

    if (kind === 'drink') {
      const atWell = onSlot && place?.kind === 'well'
      const atShore =
        !atWell &&
        isStanding(agent) &&
        adjacentToWater(this.state, Math.round(agent.x), Math.round(agent.y))
      if ((atWell || atShore) && !agent.collapsed) {
        const rate = atWell ? DRINK_WELL_ENERGY : DRINK_SHORE_ENERGY
        agent.needs.energy = clamp01(agent.needs.energy + rate)
      }
      if (agent.actionTicks >= DRINK_DURATION) {
        const before = agent.actionStartNeeds.energy
        const after = agent.needs.energy
        const delta = Math.round((after - before) * 100)
        const where = atWell ? 'the well' : atShore ? 'the shore' : 'nowhere useful'
        this.endAction(
          agent,
          `drank from ${where}, energy ${pct(before)}%→${pct(after)}%`,
          {
            need: 'energy',
            before,
            after,
            source: atWell ? 'well' : atShore ? 'shore' : 'none',
            felt: `drank at ${where}: energy ${delta >= 0 ? '+' : ''}${delta}%`,
          },
        )
        agent.action = { kind: 'idle', reason: 'Refreshed' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    if (kind === 'gather') {
      this.performGather(agent)
      return
    }

    if (kind === 'deliver') {
      this.performDeliver(agent, place)
      return
    }

    if (kind === 'sleep') {
      // energy regen applied in stepNeeds (bed full rate, ground 60%)
      const curr = toSimTime(this.state.tick)
      const prev = toSimTime(Math.max(0, this.state.tick - 1))
      const crossed7am =
        this.state.tick > 0 && prev.hour === 6 && curr.hour === 7
      if (agent.needs.energy >= 0.95 || crossed7am) {
        const before = agent.actionStartNeeds.energy
        const after = agent.needs.energy
        const onBed = this.isSleepingOnBed(agent)
        const felt = onBed
          ? `slept in your bed: energy ${pct(before)}%→${pct(after)}%`
          : `slept on the ground: energy ${pct(before)}%→${pct(after)}%`
        this.endAction(agent, felt, {
          need: 'energy',
          before,
          after,
          shelter: onBed ? 'bed' : 'ground',
          felt,
        })
        agent.action = { kind: 'idle', reason: 'Rested and ready' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    if (kind === 'examine') {
      if (place && isStanding(agent) && isWithinExamineRange(agent.x, agent.y, place)) {
        this.completeExamine(agent, place)
      } else if (!place || agent.actionTicks >= 3) {
        this.endAction(agent, 'nothing to examine here')
        agent.action = { kind: 'idle', reason: 'Looked around' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    if (kind === 'socialize') {
      // social regen gated by proximity + slot + collapse in stepNeeds — no milling
      return
    }

    if (kind === 'work') {
      // Work uses footprint occupancy (isSlotTile), not restore-slot ranking —
      // job seats are separate from place.slots concurrent capacity.
      const onWorkSlot =
        !!place &&
        isStanding(agent) &&
        isSlotTile(this.state, place, agent.x, agent.y)
      this.performWork(agent, place, onWorkSlot)
      return
    }

    if (kind === 'buy') {
      this.performBuy(agent, place, onSlot)
      return
    }

    if (kind === 'wander') {
      this.endAction(agent, 'finished a short stroll')
      agent.action = { kind: 'idle', reason: 'Looking around' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }
  }

  /** Haul dropoff for a produced good (food→stall, wood/stone→storehouse). */
  private haulDropoffForGood(good: Good): Place | undefined {
    if (good === 'food') return this.state.places.find((p) => p.kind === 'stall')
    if (good === 'wood' || good === 'stone') {
      return this.state.places.find((p) => p.kind === 'storehouse')
    }
    return undefined
  }

  private clearHaul(agent: AgentState): void {
    agent.haulAmount = 0
    agent.haulGood = null
    agent.haulSourceId = null
    agent.haulDropoffId = null
  }

  /**
   * Work at workplace: accrue ticks; production sites tend/haul;
   * construction sites fetch materials then build; stall is passive.
   */
  private performWork(
    agent: AgentState,
    place: Place | undefined,
    onSlot: boolean,
  ): void {
    const workplace = agent.employedAt
      ? this.state.places.find((p) => p.id === agent.employedAt)
      : undefined
    if (!workplace) {
      this.endAction(agent, 'no longer employed')
      agent.action = { kind: 'idle', reason: 'Looking for work' }
      agent.actionTicks = 0
      this.returnHaulCargo(agent)
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    const time = toSimTime(this.state.tick)
    const workHours = time.hour >= 8 && time.hour < 17

    // Accrue workedTicks only on workplace slot during work hours (tend only)
    const onWorkplaceSlot =
      isStanding(agent) && isSlotTile(this.state, workplace, agent.x, agent.y)
    if (
      onWorkplaceSlot &&
      workHours &&
      (agent.workPhase === null || agent.workPhase === 'tend')
    ) {
      agent.workedTicks++
    }

    // Passive workplaces (no production, no construction): just stand
    if (!workplace.production && !workplace.construction) {
      agent.workPhase = 'tend'
      return
    }

    if (agent.workPhase === null) agent.workPhase = 'tend'

    // --- Hauling cargo to dropoff, or fetching empty-handed from source ---
    if (agent.workPhase === 'hauling') {
      this.performHaulLeg(agent, workplace)
      return
    }

    if (agent.workPhase === 'returning') {
      if (onWorkplaceSlot) {
        agent.workPhase = 'tend'
        agent.action.targetPlaceId = workplace.id
        agent.action.reason = `Working at ${workplace.id}`
      } else if (agent.action.targetPlaceId !== workplace.id) {
        this.retargetToPlace(agent, workplace, 'Returning to work after hauling')
      }
      return
    }

    // --- Tend phase ---
    if (agent.workPhase === 'tend' && onWorkplaceSlot) {
      if (workplace.construction) {
        this.performConstructionTend(agent, workplace)
      } else if (workplace.production) {
        this.performProductionTend(agent, workplace)
      }
    }
    void place
    void onSlot
  }

  /** Outbound production haul: workplace stock → dropoff by good. */
  private performProductionTend(agent: AgentState, workplace: Place): void {
    const prod = workplace.production
    if (!prod) return
    const good = prod.good
    const stock = workplace.inventory[good] ?? 0
    // Food batches to market at HAUL_SIZE (walking every unit starves production).
    // Wood/stone haul any positive stock so residual units don't strand.
    const minHaul = good === 'food' ? HAUL_SIZE : 1
    if (stock < minHaul) return
    const dropoff = this.haulDropoffForGood(good)
    if (!dropoff) return
    const amt = Math.min(HAUL_SIZE, stock)
    const ok = this.transferGoods(
      { kind: 'place', id: workplace.id },
      { kind: 'agent', id: agent.id },
      good,
      amt,
      `${agent.name} picked up ${amt} ${good} to haul`,
    )
    if (!ok) return
    agent.haulAmount = amt
    agent.haulGood = good
    agent.haulSourceId = workplace.id
    agent.haulDropoffId = dropoff.id
    agent.workPhase = 'hauling'
    this.retargetToPlace(
      agent,
      dropoff,
      `Hauling ${amt} ${good} to the ${dropoff.kind}`,
    )
  }

  /**
   * Construction tend: fetch missing materials from storehouse when stocked,
   * else advance build while site holds materials for the remaining bill
   * (progressive: work with on-hand units; pause only when empty-handed mid-bill).
   */
  private performConstructionTend(agent: AgentState, workplace: Place): void {
    const c = workplace.construction
    if (!c) return

    // Standing on the site: inventory can fill the bill (wild / no depot).
    this.depositInventoryToSite(agent, workplace)

    // Prefer hauling when storehouse can fill a shortfall
    const shortGood = this.constructionShortfall(workplace)
    if (shortGood) {
      const store = this.state.places.find((p) => p.kind === 'storehouse')
      const need = Math.max(
        0,
        (c.needs[shortGood] ?? 0) - (workplace.inventory[shortGood] ?? 0),
      )
      const available = store ? (store.inventory[shortGood] ?? 0) : 0
      if (store && available > 0 && need > 0) {
        agent.haulAmount = 0
        agent.haulGood = shortGood
        agent.haulSourceId = store.id
        agent.haulDropoffId = workplace.id
        agent.workPhase = 'hauling'
        this.retargetToPlace(
          agent,
          store,
          `Fetching ${shortGood} from the storehouse for the build`,
        )
        return
      }
    }

    // Build while materials remain for the bill (or bill already exhausted).
    // If neither haul nor build is possible, release the worker so they can
    // forage/eat — standing on a dry site is not productive work.
    if (!this.constructionCanBuild(workplace)) {
      this.endAction(agent, 'waiting on materials at the build site')
      agent.action = {
        kind: 'idle',
        reason: 'Build site idle — materials not ready',
      }
      agent.actionTicks = 0
      agent.workPhase = 'tend'
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    const labour = this.constructionLabourTicks(c)
    c.progress += 1 / labour
    const totalNeed =
      (c.needs.wood ?? 0) + (c.needs.stone ?? 0) + (c.needs.food ?? 0)
    if (totalNeed > 0) {
      c.consumeTicks++
      if (c.consumeTicks >= CONSTRUCTION_CONSUME_EVERY) {
        c.consumeTicks = 0
        const consumeGood = this.pickConstructionConsumeGood(workplace)
        if (consumeGood) {
          const ok = this.consumeGoods(
            { kind: 'place', id: workplace.id },
            consumeGood,
            1,
            `${agent.name} used 1 ${consumeGood} on the build at ${workplace.id}`,
          )
          if (ok) {
            const left = (c.needs[consumeGood] ?? 0) - 1
            if (left <= 0) delete c.needs[consumeGood]
            else c.needs[consumeGood] = left
          }
        }
      }
    }

    if (c.progress >= 1) {
      this.completeConstruction(workplace)
    }
  }

  /**
   * True when the site can spend a build tick: bill exhausted, or at least one
   * remaining bill unit is sitting in site inventory (material ration on hand).
   */
  private constructionCanBuild(site: Place): boolean {
    const c = site.construction
    if (!c) return false
    const totalNeed =
      (c.needs.wood ?? 0) + (c.needs.stone ?? 0) + (c.needs.food ?? 0)
    if (totalNeed <= 0) return true
    return this.pickConstructionConsumeGood(site) !== null
  }

  /**
   * First good the site still needs more of than it holds.
   * Prefers a good the storehouse actually stocks so build work progresses
   * when one material is abundant and another is scarce.
   */
  private constructionShortfall(site: Place): Good | null {
    const c = site.construction
    if (!c) return null
    const shortfalls: Good[] = []
    for (const g of ['wood', 'stone'] as Good[]) {
      const need = c.needs[g] ?? 0
      if (need <= 0) continue
      if ((site.inventory[g] ?? 0) < need) shortfalls.push(g)
    }
    if (shortfalls.length === 0) return null
    const store = this.state.places.find((p) => p.kind === 'storehouse')
    if (store) {
      for (const g of shortfalls) {
        if ((store.inventory[g] ?? 0) > 0) return g
      }
    }
    return shortfalls[0]!
  }

  private pickConstructionConsumeGood(site: Place): Good | null {
    const c = site.construction
    if (!c) return null
    for (const g of ['wood', 'stone'] as Good[]) {
      const need = c.needs[g] ?? 0
      if (need <= 0) continue
      if ((site.inventory[g] ?? 0) >= 1) return g
    }
    return null
  }

  /** Generic haul leg: fetch (amount 0) or deliver (amount > 0). */
  private performHaulLeg(agent: AgentState, workplace: Place): void {
    const good = agent.haulGood
    const sourceId = agent.haulSourceId
    const dropoffId = agent.haulDropoffId

    // Fetching empty-handed from source
    if (agent.haulAmount <= 0 && good && sourceId) {
      const source = this.state.places.find((p) => p.id === sourceId)
      if (!source) {
        this.clearHaul(agent)
        agent.workPhase = 'tend'
        return
      }
      const atSource =
        isStanding(agent) && isSlotTile(this.state, source, agent.x, agent.y)
      if (atSource) {
        let want = HAUL_SIZE
        // Construction inbound: only as much as the site still lacks
        if (workplace.construction && dropoffId === workplace.id) {
          const need =
            (workplace.construction.needs[good] ?? 0) -
            (workplace.inventory[good] ?? 0)
          want = Math.min(HAUL_SIZE, Math.max(0, need))
        }
        const stock = source.inventory[good] ?? 0
        const amt = Math.min(want, stock)
        if (amt <= 0) {
          // Nothing to pick up — return to workplace
          this.clearHaul(agent)
          agent.workPhase = 'returning'
          this.retargetToPlace(agent, workplace, 'Nothing to haul — returning')
          return
        }
        const ok = this.transferGoods(
          { kind: 'place', id: source.id },
          { kind: 'agent', id: agent.id },
          good,
          amt,
          `${agent.name} picked up ${amt} ${good}`,
        )
        if (ok) {
          agent.haulAmount = amt
          const drop =
            (dropoffId && this.state.places.find((p) => p.id === dropoffId)) ||
            this.haulDropoffForGood(good)
          if (drop) {
            agent.haulDropoffId = drop.id
            this.retargetToPlace(
              agent,
              drop,
              `Hauling ${amt} ${good} to the ${drop.kind}`,
            )
          }
        }
        return
      }
      if (agent.action.targetPlaceId !== source.id) {
        this.retargetToPlace(
          agent,
          source,
          `Fetching ${good} from the ${source.kind}`,
        )
      }
      return
    }

    // Delivering cargo to dropoff
    if (agent.haulAmount > 0 && good && dropoffId) {
      const dropoff = this.state.places.find((p) => p.id === dropoffId)
      if (!dropoff) {
        this.returnHaulCargo(agent)
        agent.workPhase = 'tend'
        return
      }
      const atDrop =
        isStanding(agent) && isSlotTile(this.state, dropoff, agent.x, agent.y)
      if (atDrop) {
        const amt = Math.min(agent.haulAmount, agent.inventory[good] ?? 0)
        if (amt > 0) {
          this.transferGoods(
            { kind: 'agent', id: agent.id },
            { kind: 'place', id: dropoff.id },
            good,
            amt,
            `${agent.name} delivered ${amt} ${good} to the ${dropoff.kind}`,
          )
        }
        this.clearHaul(agent)
        // If dropoff is the workplace (construction inbound), resume tend
        if (dropoff.id === workplace.id) {
          agent.workPhase = 'tend'
          agent.action.targetPlaceId = workplace.id
          agent.action.reason = `Working at ${workplace.id}`
        } else {
          agent.workPhase = 'returning'
          this.retargetToPlace(
            agent,
            workplace,
            `Returning to ${workplace.kind} after hauling`,
          )
        }
        return
      }
      if (agent.action.targetPlaceId !== dropoff.id) {
        this.retargetToPlace(
          agent,
          dropoff,
          `Hauling ${agent.haulAmount} ${good} to the ${dropoff.kind}`,
        )
      }
      return
    }

    // Degenerate haul state
    this.clearHaul(agent)
    agent.workPhase = 'tend'
  }

  private performBuy(
    agent: AgentState,
    place: Place | undefined,
    onSlot: boolean,
  ): void {
    if (!place || place.kind !== 'stall' || !onSlot) {
      if (agent.actionTicks > 30) {
        this.endAction(agent, 'could not buy at the stall')
        agent.action = { kind: 'idle', reason: 'Left the market' }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      }
      return
    }

    const price = place.price?.food ?? marketPriceFromStock(place.inventory.food ?? 0)

    // One unit per performing tick, up to BUY_MAX_UNITS
    if (agent.actionTicks <= BUY_MAX_UNITS) {
      const stock = place.inventory.food ?? 0
      if (stock <= 0 || agent.wallet < price) {
        this.endAction(
          agent,
          stock <= 0 ? 'stall sold out' : 'not enough coins',
        )
        agent.action = {
          kind: 'idle',
          reason: stock <= 0 ? 'Stall empty' : 'Short on coins',
        }
        agent.actionTicks = 0
        agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
        return
      }
      const payee = this.stallRevenueParty(place)
      const paid = this.transferCoins(
        agent.id,
        payee,
        price,
        payee === 'treasury'
          ? `${agent.name} paid ${price} coins for food at the stall`
          : `${agent.name} paid ${price} coins for food at ${place.id} (to owner)`,
        {
          kind: 'buy',
          good: 'food',
          unitPrice: price,
          placeId: place.id,
          toOwner: payee !== 'treasury',
        },
      )
      if (paid) {
        this.transferGoods(
          { kind: 'place', id: place.id },
          { kind: 'agent', id: agent.id },
          'food',
          1,
          `${agent.name} bought 1 food at the stall`,
        )
      }
    }

    if (agent.actionTicks >= BUY_MAX_UNITS) {
      this.endAction(agent, 'bought food at the market')
      agent.action = { kind: 'idle', reason: 'Bag of groceries' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
    }
  }

  /** Retarget current work action to another place without ending it. */
  private retargetToPlace(
    agent: AgentState,
    place: Place,
    reason: string,
  ): void {
    const spot = reserveSpot(this.state, place, agent, this.rng)
    if (spot) {
      this.clearPlaceBlockStreak(agent.id)
    } else {
      this.notePlaceBlocked(agent, place)
    }
    const tx = spot?.x ?? place.x
    const ty = spot?.y ?? place.y
    agent.action.targetPlaceId = place.id
    agent.action.targetX = tx
    agent.action.targetY = ty
    agent.action.reason = reason
    agent.action.path = findPath(this.state, agent.x, agent.y, tx, ty) ?? []
    agent.pathIndex = 0
  }

  private clearPlaceBlockStreak(agentId: string): void {
    if (this.state.placeBlockLast) delete this.state.placeBlockLast[agentId]
  }

  private placeBlockKey(
    place: Place,
    occupants: AgentState[],
    ownerId: string,
  ): string {
    const occ = occupants
      .map((a) => a.id)
      .sort()
      .join(',')
    return `${place.id}|${ownerId}|${occ}`
  }

  private notePlaceBlocked(agent: AgentState, place: Place): void {
    const occupants = occupantsOfPlace(this.state, place, agent.id)
    const ownerId = this.state.owners[place.id] ?? 'commons'
    const ownerAgent =
      ownerId !== 'commons'
        ? this.state.agents.find((a) => a.id === ownerId)
        : undefined
    const privateExclusion =
      ownerId !== 'commons' && ownerId !== agent.id && !!ownerAgent
    const key = this.placeBlockKey(place, occupants, ownerId)
    if (this.state.placeBlockLast?.[agent.id] === key) return
    if (!this.state.placeBlockLast) this.state.placeBlockLast = {}
    this.state.placeBlockLast[agent.id] = key

    const label = placeKindLabel(place.kind)
    const occupantNames = occupants.map((a) => a.name)
    const felt = blockedFeltLine({
      label,
      occupantNames,
      ownerName: privateExclusion ? ownerAgent!.name : undefined,
      onlySpot: place.slots === 1,
    })
    const reason = privateExclusion
      ? `${agent.name} could not use the ${label} — it is ${ownerAgent!.name}'s now`
      : occupantNames.length > 0
        ? `${agent.name} could not use the ${label} — ${occupantNames.join(', ')} occupying it`
        : `${agent.name} could not use the ${label} — every slot was taken`

    this.events.append({
      tick: this.state.tick,
      type: 'place:blocked',
      agentId: agent.id,
      data: {
        placeId: place.id,
        placeKind: place.kind,
        occupantIds: occupants.map((a) => a.id),
        occupantNames,
        ownerId,
        ownerName: ownerAgent?.name,
        onlySpot: place.slots === 1,
        felt,
      },
      reason,
    })
  }

  private hireAgent(agent: AgentState, place: Place): boolean {
    if (agent.employedAt === place.id) return true
    if (agent.employedAt) return false
    if (!workplaceHasOpenJob(this.state, place, agent.id)) return false
    agent.employedAt = place.id
    agent.daysIdleOnJob = 0
    agent.workedTicks = 0
    this.events.append({
      tick: this.state.tick,
      type: 'job:hired',
      agentId: agent.id,
      data: {
        agentName: agent.name,
        placeId: place.id,
        placeKind: place.kind,
        wage: place.wage ?? 0,
      },
      reason: `${agent.name} took a job at the ${place.kind} (${place.wage ?? 0} coins/day)`,
    })
    return true
  }

  private vacateJob(agent: AgentState, reason: string): void {
    if (!agent.employedAt) return
    const placeId = agent.employedAt
    const place = this.state.places.find((p) => p.id === placeId)
    if (agent.haulAmount > 0) this.returnHaulCargo(agent)
    agent.employedAt = null
    agent.workedTicks = 0
    agent.daysIdleOnJob = 0
    agent.workPhase = null
    this.clearHaul(agent)
    this.events.append({
      tick: this.state.tick,
      type: 'job:vacated',
      agentId: agent.id,
      data: {
        agentName: agent.name,
        placeId,
        placeKind: place?.kind,
      },
      reason,
    })
  }

  private endAction(
    agent: AgentState,
    outcome: string,
    extra?: Record<string, unknown>,
  ): void {
    if (agent.action.kind === 'idle') return
    this.events.append({
      tick: this.state.tick,
      type: 'action:end',
      agentId: agent.id,
      data: { kind: agent.action.kind, outcome, ...(extra ?? {}) },
      reason: outcome,
    })
  }

  /** True when this sleeper is standing on a home bed slot. */
  private isSleepingOnBed(agent: AgentState): boolean {
    if (agent.action.kind !== 'sleep') return false
    const place = agent.action.targetPlaceId
      ? this.state.places.find((p) => p.id === agent.action.targetPlaceId)
      : undefined
    if (!place || place.kind !== 'home') return false
    if (!isStanding(agent)) return false
    return isSlotTile(this.state, place, agent.x, agent.y)
  }

  private completeExamine(agent: AgentState, place: Place): void {
    const knowledge = examineKnowledgeFor(place, {
      owners: this.state.owners,
      agents: this.state.agents,
    })
    const label = placeKindLabel(place.kind)
    this.events.append({
      tick: this.state.tick,
      type: 'discovery:examined',
      agentId: agent.id,
      data: {
        target: place.id,
        placeKind: place.kind,
        knowledge,
        agentName: agent.name,
      },
      reason: `${agent.name} examined the ${label}`,
    })
    this.endAction(agent, `examined the ${label}`, {
      target: place.id,
      placeKind: place.kind,
      knowledge,
    })
    agent.action = { kind: 'idle', reason: `Examined the ${label}` }
    agent.actionTicks = 0
    agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
  }

  private rebuildNoticedCache(): void {
    this.noticedKinds.clear()
    for (const e of this.events.getAll()) {
      if (e.type !== 'discovery:noticed' || !e.agentId) continue
      const kind = String(e.data?.kind ?? '')
      if (!kind) continue
      let set = this.noticedKinds.get(e.agentId)
      if (!set) {
        set = new Set()
        this.noticedKinds.set(e.agentId, set)
      }
      set.add(kind)
    }
  }

  private emitPlaceNotices(agent: AgentState): void {
    const r2 = PLACE_VIEW_RADIUS * PLACE_VIEW_RADIUS
    let seen = this.noticedKinds.get(agent.id)
    for (const p of this.state.places) {
      const dx = p.x - agent.x
      const dy = p.y - agent.y
      if (dx * dx + dy * dy > r2) continue
      if (seen?.has(p.kind)) continue
      if (!seen) {
        seen = new Set()
        this.noticedKinds.set(agent.id, seen)
      }
      seen.add(p.kind)
      this.events.append({
        tick: this.state.tick,
        type: 'discovery:noticed',
        agentId: agent.id,
        data: {
          kind: p.kind,
          placeId: p.id,
          agentName: agent.name,
        },
        reason: `${agent.name} noticed a ${placeKindLabel(p.kind)}`,
      })
    }
  }

  private maybeRedecide(agent: AgentState, hour: number): void {
    // Mind override this tick: do not consult UtilityBrain
    if (this.externalAppliedThisTick.has(agent.id)) return

    const tick = this.state.tick
    const idle = agent.action.kind === 'idle'
    const due = tick - agent.lastDecideTick >= REDECIDE_INTERVAL
    // Urgent only for a *different* need than the one this action is serving
    const urgent = idle ? anyNeedCritical(agent) : urgentDifferentNeed(agent)

    // Participation hold (P3-2c): defer non-urgent redecide while chatting
    if (this.conversationHold.has(agent.id) && !anyNeedCritical(agent)) {
      return
    }

    // Sleep is committed while resting on a bed slot: natural wake only
    // (energy ≥ 0.95 or 07:00). Prevents scarcity thrash of sleep↔forage/social.
    // Walking home to sleep can still be redecided.
    if (
      agent.action.kind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent, hour)
    ) {
      return
    }

    // Minimum action duration: once started, no re-decide for 30 ticks
    // (urgent included — interval is the max interrupt rate).
    if (!idle && tick - agent.lastDecideTick < REDECIDE_INTERVAL) {
      return
    }

    // Don't interrupt eat/drink/forage/buy mid-action for non-urgent redecide
    if (
      (agent.action.kind === 'eat' ||
        agent.action.kind === 'drink' ||
        agent.action.kind === 'forage' ||
        agent.action.kind === 'gather' ||
        agent.action.kind === 'deliver' ||
        agent.action.kind === 'buy') &&
      this.isPerforming(agent) &&
      agent.actionTicks > 0 &&
      !urgent
    ) {
      return
    }

    // Mid-haul: finish the haul leg before redecide (never abandon cargo mid-path)
    if (
      agent.action.kind === 'work' &&
      (agent.workPhase === 'hauling' || agent.workPhase === 'returning')
    ) {
      return
    }

    // Re-decide when idle (action just finished) or on interval
    if (!idle && !due) return

    this.redecide(agent)
  }

  private redecide(agent: AgentState): void {
    const obs = makeObservation(agent, this.state)
    const intent = this.brain.decide(obs, this.rng)
    agent.lastDecideTick = this.state.tick

    const currentKind = agent.action.kind
    const sameTarget =
      currentKind === intent.kind &&
      agent.action.targetPlaceId === intent.targetPlaceId &&
      (intent.kind !== 'wander' ||
        (agent.action.targetX === intent.targetX && agent.action.targetY === intent.targetY))

    if (sameTarget && currentKind !== 'idle') {
      this.resolveCoStanding(agent)
      return // already doing it
    }

    // Hysteresis: keep current unless competitor beats by ≥ 0.15.
    if (currentKind !== 'idle' && currentKind !== 'wander') {
      // wander can be freely replaced; idle always takes new intent
      const currentScore = scoreCurrentAction(obs, currentKind)
      const newObsScore = this.scoreIntent(obs, intent)
      if (newObsScore < currentScore + HYSTERESIS) {
        this.resolveCoStanding(agent)
        return
      }
    }

    // Special: while sleeping and should keep sleeping, ignore all switches
    if (
      currentKind === 'sleep' &&
      this.isPerforming(agent) &&
      shouldKeepSleeping(agent)
    ) {
      this.resolveCoStanding(agent)
      return
    }

    // Switch action
    if (currentKind !== 'idle') {
      this.endAction(agent, `stopped ${currentKind} to ${intent.kind}`)
    }
    // Leaving work: return undelivered haul cargo to the farm (no free food)
    if (currentKind === 'work' && intent.kind !== 'work') {
      this.returnHaulCargo(agent)
    }

    this.startAction(agent, intent)
  }

  /** Return undelivered haul cargo to its source place. */
  private returnHaulCargo(agent: AgentState): void {
    if (agent.haulAmount <= 0 || !agent.haulGood) {
      agent.workPhase = null
      this.clearHaul(agent)
      return
    }
    const good = agent.haulGood
    const sourceId =
      agent.haulSourceId ??
      agent.employedAt ??
      this.state.places.find((p) => p.production?.good === good)?.id
    const amt = Math.min(agent.haulAmount, agent.inventory[good] ?? 0)
    if (sourceId && amt > 0) {
      this.transferGoods(
        { kind: 'agent', id: agent.id },
        { kind: 'place', id: sourceId },
        good,
        amt,
        `${agent.name} returned undelivered ${good} to ${sourceId}`,
      )
    }
    agent.workPhase = null
    this.clearHaul(agent)
  }

  /**
   * Later-indexed non-walking agent on a shared tile nudges to an adjacent free
   * tile (extends path on current action — no events).
   */
  private resolveCoStanding(agent: AgentState): void {
    if (isWalking(agent)) return
    const ax = Math.round(agent.x)
    const ay = Math.round(agent.y)
    const agents = this.state.agents
    const myIndex = agents.indexOf(agent)
    if (myIndex < 0) return

    let stacked = false
    for (let i = 0; i < myIndex; i++) {
      const other = agents[i]!
      if (!isStanding(other)) continue
      if (Math.round(other.x) === ax && Math.round(other.y) === ay) {
        stacked = true
        break
      }
    }
    if (!stacked) return

    const cands = nudgeCandidates(this.state, agent)
    if (cands.length === 0) return
    const pick = this.rng.pick(cands)
    extendPathTo(this.state, agent, pick[0], pick[1])
  }

  private scoreIntent(
    obs: ReturnType<typeof makeObservation>,
    intent: Intent,
  ): number {
    return scoreCurrentAction(obs, intent.kind)
  }

  private startAction(agent: AgentState, intent: Intent): void {
    let tx = intent.targetX
    let ty = intent.targetY
    let kind = intent.kind
    let targetPlaceId = intent.targetPlaceId
    let reason = intent.reason

    let place = targetPlaceId
      ? this.state.places.find((p) => p.id === targetPlaceId)
      : undefined

    // Employment: starting work hires unemployed agents when a seat is free
    if (kind === 'work' && place && (place.jobSlots ?? 0) > 0) {
      if (!agent.employedAt) {
        if (!this.hireAgent(agent, place)) {
          kind = 'wander'
          targetPlaceId = undefined
          place = undefined
          reason = 'No open jobs — wandering'
          tx = Math.round(agent.x)
          ty = Math.round(agent.y)
        }
      } else if (agent.employedAt !== place.id) {
        // Already employed elsewhere — redirect to own workplace
        const own = this.state.places.find((p) => p.id === agent.employedAt)
        if (own) {
          place = own
          targetPlaceId = own.id
          tx = own.x
          ty = own.y
        }
      }
      if (kind === 'work') {
        // Fresh tend shift — return any leftover haul first
        if (agent.haulAmount > 0) this.returnHaulCargo(agent)
        agent.workPhase = 'tend'
        this.clearHaul(agent)
      }
    }

    // Instant commission: world rule, then idle
    if (kind === 'commission') {
      const buildKind = intent.placeKind ?? 'home'
      if (this.isCommissionCooling(agent.id)) {
        agent.action = {
          kind: 'idle',
          reason: 'Could not commission',
        }
        agent.actionTicks = 0
        agent.pathIndex = 0
        agent.actionStartNeeds = cloneNeeds(agent.needs)
        return
      }
      const ok = this.commission(
        agent.id,
        buildKind,
        intent.targetX,
        intent.targetY,
      )
      this.events.append({
        tick: this.state.tick,
        type: 'action:start',
        agentId: agent.id,
        data: {
          kind: 'commission',
          target: buildKind,
          agentName: agent.name,
          ok,
        },
        reason,
      })
      agent.action = {
        kind: 'idle',
        reason: ok
          ? `Commissioned a ${buildKind === 'home' ? 'house' : buildKind} site`
          : 'Could not commission',
      }
      agent.actionTicks = 0
      agent.pathIndex = 0
      agent.actionStartNeeds = cloneNeeds(agent.needs)
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    // Instant give: adjacent agent may feed a collapsed villager (capability, not policy)
    if (kind === 'give') {
      const ok = this.giveFoodToCollapsed(agent, intent.targetAgentId ?? '')
      this.events.append({
        tick: this.state.tick,
        type: 'action:start',
        agentId: agent.id,
        data: {
          kind: 'give',
          target: intent.targetAgentId ?? '',
          agentName: agent.name,
          ok,
        },
        reason,
      })
      agent.action = {
        kind: 'idle',
        reason: ok ? 'Gave food to a collapsed neighbor' : 'Could not give food',
      }
      agent.actionTicks = 0
      agent.pathIndex = 0
      agent.actionStartNeeds = cloneNeeds(agent.needs)
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    // Instant civic acts: world mechanism, then idle
    if (kind === 'propose' || kind === 'vote' || kind === 'sanction' || kind === 'claim') {
      let ok = false
      if (kind === 'propose') {
        ok = this.propose(agent.id, intent.text ?? '')
      } else if (kind === 'vote') {
        const choice = intent.choice === 'no' ? 'no' : intent.choice === 'yes' ? 'yes' : null
        ok = choice != null && this.vote(agent.id, intent.proposalId ?? '', choice)
      } else if (kind === 'sanction') {
        ok = this.sanction(
          agent.id,
          intent.targetAgentId ?? '',
          intent.text ?? '',
          intent.ruleId,
        )
      } else {
        ok = this.claim(agent.id, intent.targetPlaceId ?? '')
      }
      this.events.append({
        tick: this.state.tick,
        type: 'action:start',
        agentId: agent.id,
        data: {
          kind,
          target:
            intent.proposalId ??
            intent.targetAgentId ??
            targetPlaceId ??
            intent.text ??
            '',
          agentName: agent.name,
          ok,
          choice: intent.choice,
          text: intent.text,
          ruleId: intent.ruleId,
        },
        reason,
      })
      agent.action = {
        kind: 'idle',
        reason: ok ? `Finished ${kind}` : `Could not ${kind}`,
      }
      agent.actionTicks = 0
      agent.pathIndex = 0
      agent.actionStartNeeds = cloneNeeds(agent.needs)
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }

    // Shore drink: no well (or not targeting one) → stand on a water-adjacent tile
    if (kind === 'drink' && (!place || place.kind !== 'well')) {
      place = undefined
      targetPlaceId = undefined
      const sx = tx !== undefined ? Math.round(tx) : NaN
      const sy = ty !== undefined ? Math.round(ty) : NaN
      const shoreOk =
        Number.isFinite(sx) &&
        Number.isFinite(sy) &&
        isWalkable(this.state, sx, sy) &&
        adjacentToWater(this.state, sx, sy)
      if (!shoreOk) {
        const shore = pickShoreStand(this.state, agent)
        if (shore) {
          tx = shore.x
          ty = shore.y
        }
      }
    }

    // Deliver: walk to a construction site that still needs carried goods
    if (kind === 'deliver') {
      if (!place || place.kind !== 'construction-site') {
        place = this.pickSiteNeedingCarried(agent)
        targetPlaceId = place?.id
      }
      if (!place || place.kind !== 'construction-site') {
        kind = 'wander'
        targetPlaceId = undefined
        place = undefined
        reason = 'Nothing to deliver — wandering'
        tx = Math.round(agent.x)
        ty = Math.round(agent.y)
      } else {
        targetPlaceId = place.id
        tx = place.x
        ty = place.y
      }
    }

    // Gather: walk to a free stand tile on/adjacent to the resource tile
    if (kind === 'gather') {
      targetPlaceId = undefined
      place = undefined
      let rx = tx !== undefined ? Math.round(tx) : NaN
      let ry = ty !== undefined ? Math.round(ty) : NaN
      const res = Number.isFinite(rx) && Number.isFinite(ry)
        ? gatherResourceAt(this.state, rx, ry)
        : gatherResourceAt(this.state, Math.round(agent.x), Math.round(agent.y))
      if (res) {
        rx = res.x
        ry = res.y
      }
      const stand =
        Number.isFinite(rx) && Number.isFinite(ry)
          ? pickGatherStand(this.state, agent, rx, ry)
          : null
      if (stand) {
        tx = stand.x
        ty = stand.y
      } else {
        kind = 'wander'
        reason = 'Nothing to gather here — wandering'
        tx = Math.round(agent.x)
        ty = Math.round(agent.y)
      }
    }

    // Bed slots: shared-home residents sleep on distinct deterministic tiles
    if (kind === 'sleep' && place && place.kind === 'home') {
      const bed = bedSlotForAgent(this.state, agent, place)
      tx = bed.x
      ty = bed.y
    } else if (kind === 'examine' && place) {
      const stand = pickExamineStand(this.state, agent, place)
      tx = stand.x
      ty = stand.y
    } else if (place && kind !== 'wander') {
      // Slot reservation: free tile within footprint only (no ring-widening)
      const preferred =
        tx !== undefined && ty !== undefined ? { x: tx, y: ty } : undefined
      const spot = reserveSpot(this.state, place, agent, this.rng, preferred)
      if (spot) {
        tx = spot.x
        ty = spot.y
        this.clearPlaceBlockStreak(agent.id)
      } else {
        // Place full — name who is in the way, then a short wander (no waiting state)
        this.notePlaceBlocked(agent, place)
        kind = 'wander'
        targetPlaceId = undefined
        reason = 'Place was full — wandering nearby'
        tx = Math.round(agent.x)
        ty = Math.round(agent.y)
        if (intent.kind === 'work') {
          agent.workPhase = null
        }
      }
    } else if ((tx === undefined || ty === undefined) && place) {
      tx = place.x
      ty = place.y
    }

    if (kind === 'wander' && (tx === undefined || ty === undefined)) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    if (tx === undefined || ty === undefined) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    if (!isWalkable(this.state, Math.round(tx), Math.round(ty))) {
      tx = Math.round(agent.x)
      ty = Math.round(agent.y)
    }

    const path = findPath(this.state, agent.x, agent.y, tx, ty)

    agent.action = {
      kind,
      targetPlaceId,
      targetX: tx,
      targetY: ty,
      path: path ?? [],
      reason,
    }
    agent.pathIndex = 0
    agent.actionTicks = 0
    agent.actionStartNeeds = cloneNeeds(agent.needs)

    const targetPlace = targetPlaceId
      ? this.state.places.find((p) => p.id === targetPlaceId)
      : undefined
    this.events.append({
      tick: this.state.tick,
      type: 'action:start',
      agentId: agent.id,
      data: {
        kind,
        target: targetPlaceId ?? `${tx},${ty}`,
        agentName: agent.name,
        placeKind: targetPlace?.kind,
      },
      reason,
    })
  }

  advanceTicks(n: number): void {
    if (n <= 0) return
    for (let i = 0; i < n; i++) {
      this.stepOne()
    }
  }

  private stepOne(): void {
    const prevTick = this.state.tick
    this.state.tick = prevTick + 1
    this.externalAppliedThisTick.clear()
    ensureMindFields(this.state)

    // Day start when crossing into a new calendar day at 00:00
    const prev = toSimTime(prevTick)
    const next = toSimTime(this.state.tick)
    if (next.day !== prev.day) {
      // Decay pairs that never met on the day that just ended
      this.stepSympathyDecay()
      this.state.sympathyMet = {}
      this.archiveCompletedDay(prev.day, prevTick)
      this.events.append({
        tick: this.state.tick,
        type: 'day:start',
        data: { day: next.day },
      })
    }

    // Wage day at 18:00: treasury → employees (partial if insolvent)
    if (prev.hour === 17 && next.hour === 18) {
      this.stepWagePayments()
      // Sheep electorate: same 18:00 world-process beat (not a brain decision)
      this.stepSheepElectorate()
    }

    // Hourly: recompute stall price + append economy stats
    if (next.hour !== prev.hour) {
      this.stepMarketPrice()
      this.stepEconomyStats()
    }

    // External (mind) intents + reflection notes + says: live inbox + replay playback
    this.applyExternalIntentsForTick()
    this.applyMindNotesForTick()
    this.applySaysForTick()

    // Close after last-second mind votes on this tick
    this.closeExpiredProposals()

    this.stepAgents()
    this.stepSympathy()
    this.stepBushRegrowth()
    this.stepTerrainRegrowth()
    this.stepProduction()

    if (this.state.tick % SNAPSHOT_INTERVAL === 0) {
      this.snapshots.add(this.makeSnapshot())
      // Pin midnight day-starts so they survive the next day's prune
      if (toSimTime(this.state.tick).hour === 0 && toSimTime(this.state.tick).minute === 0) {
        this.snapshots.pin(this.state.tick)
      }
    }
  }

  /**
   * Apply mind intents for the current tick.
   * Live: drain inbox (sorted agentId, queue order), record into log.
   * Replay: re-apply entries from intentPlayback at this tick (log already set).
   */
  private applyExternalIntentsForTick(): void {
    const tick = this.state.tick

    if (this.intentPlayback) {
      // Playback: re-apply recorded intents for this tick (do not re-record)
      const atTick = this.intentPlayback
        .filter((r) => r.tick === tick)
        .slice()
        .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
      for (const rec of atTick) {
        // Ensure log contains the record (rebuild from snapshot may already have it)
        const already = this.state.externalIntentLog.some(
          (r) =>
            r.tick === rec.tick &&
            r.agentId === rec.agentId &&
            r.intent.kind === rec.intent.kind &&
            r.meta.reasoning === rec.meta.reasoning,
        )
        if (!already) {
          this.state.externalIntentLog.push({
            tick: rec.tick,
            agentId: rec.agentId,
            intent: cloneIntent(rec.intent),
            meta: cloneExternalMeta(rec.meta),
          })
        }
        this.forceExternalIntent(rec.agentId, rec.intent, rec.meta, {
          recordLog: false,
          // Forward re-sim must rebuild mindStats the same way live did
          recordStats: true,
        })
      }
      return
    }

    // Live: drain inbox
    if (this.externalInbox.length === 0) return
    const batch = this.externalInbox.splice(0, this.externalInbox.length)
    batch.sort((a, b) =>
      a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0,
    )
    for (const item of batch) {
      this.forceExternalIntent(item.agentId, item.intent, item.meta, {
        recordLog: true,
        recordStats: true,
      })
    }
  }

  /**
   * Apply mind reflection notes for the current tick.
   * Live: drain inbox (sorted agentId, queue order), record into log.
   * Replay: re-apply entries from notePlayback at this tick (log already set).
   */
  private applyMindNotesForTick(): void {
    const tick = this.state.tick

    if (this.notePlayback) {
      const atTick = this.notePlayback
        .filter((r) => r.tick === tick)
        .slice()
        .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0))
      for (const rec of atTick) {
        const already = this.state.mindNoteLog.some(
          (r) =>
            r.tick === rec.tick &&
            r.agentId === rec.agentId &&
            r.notes.length === rec.notes.length &&
            r.notes.every((n, i) => n === rec.notes[i]),
        )
        if (!already) {
          this.state.mindNoteLog.push({
            tick: rec.tick,
            agentId: rec.agentId,
            notes: rec.notes.slice(),
            meta: cloneMindNoteMeta(rec.meta),
            ...(rec.learned && rec.learned.length > 0
              ? { learned: rec.learned.slice() }
              : {}),
          })
        }
        this.forceMindNotes(rec.agentId, rec.notes, rec.meta, {
          recordLog: false,
          learned: rec.learned,
        })
      }
      return
    }

    if (this.mindNoteInbox.length === 0) return
    const batch = this.mindNoteInbox.splice(0, this.mindNoteInbox.length)
    batch.sort((a, b) =>
      a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0,
    )
    for (const item of batch) {
      this.forceMindNotes(item.agentId, item.notes, item.meta, {
        recordLog: true,
        learned: item.learned,
      })
    }
  }

  /**
   * Apply mind notes: emit mind:reflection, optionally append mindNoteLog.
   * Does not change agent action.
   */
  private forceMindNotes(
    agentId: string,
    notes: string[],
    meta: MindNoteMeta,
    opts: { recordLog: boolean; learned?: string[] },
  ): void {
    const agent = this.state.agents.find((a) => a.id === agentId)
    const cleanNotes = notes.map((n) => String(n)).filter((n) => n.length > 0)
    const cleanLearned = (opts.learned ?? [])
      .map((n) => String(n).trim())
      .filter((n) => n.length > 0)
      .slice(0, 2)
    if (cleanNotes.length === 0) return

    if (opts.recordLog) {
      this.state.mindNoteLog.push({
        tick: this.state.tick,
        agentId,
        notes: cleanNotes.slice(),
        meta: cloneMindNoteMeta(meta),
        ...(cleanLearned.length > 0 ? { learned: cleanLearned } : {}),
      })
    }

    this.events.append({
      tick: this.state.tick,
      type: 'mind:reflection',
      agentId,
      data: {
        notes: cleanNotes.slice(),
        ...(cleanLearned.length > 0 ? { learned: cleanLearned } : {}),
        provider: meta.provider,
        latencyMs: meta.latencyMs,
        approxChars: meta.approxChars,
        source: 'luna',
        agentName: agent?.name,
      },
      reason: `${agent?.name ?? agentId} reflected on the day`,
    })
  }

  /**
   * Apply conversation utterances for the current tick.
   * Live: drain inbox (sorted agentId). Replay: re-apply from sayPlayback.
   */
  private applySaysForTick(): void {
    const tick = this.state.tick

    if (this.sayPlayback) {
      const atTick = this.sayPlayback
        .filter((r) => r.tick === tick)
        .slice()
        .sort((a, b) =>
          a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : a.turn - b.turn,
        )
      for (const rec of atTick) {
        const already = this.state.sayLog.some(
          (r) =>
            r.tick === rec.tick &&
            r.conversationId === rec.conversationId &&
            r.agentId === rec.agentId &&
            r.turn === rec.turn &&
            r.text === rec.text,
        )
        if (!already) {
          this.state.sayLog.push(cloneSayRecord(rec))
        }
        this.forceSay(rec, { recordLog: false })
      }
      return
    }

    if (this.sayInbox.length === 0) return
    const batch = this.sayInbox.splice(0, this.sayInbox.length)
    batch.sort((a, b) =>
      a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : a.turn - b.turn,
    )
    for (const item of batch) {
      this.forceSay(
        {
          tick: this.state.tick,
          conversationId: item.conversationId,
          agentId: item.agentId,
          partnerId: item.partnerId,
          turn: item.turn,
          text: item.text,
          done: item.done,
          ...(item.source ? { source: item.source } : {}),
        },
        { recordLog: true },
      )
    }
  }

  /**
   * Apply one utterance: emit mind:say (reason-free), optionally append sayLog.
   * Does not change agent action.
   */
  private forceSay(rec: SayRecord, opts: { recordLog: boolean }): void {
    const agent = this.state.agents.find((a) => a.id === rec.agentId)
    const partner = this.state.agents.find((a) => a.id === rec.partnerId)
    const text = String(rec.text)
    const source = rec.source ?? 'luna'

    if (opts.recordLog) {
      this.state.sayLog.push({
        tick: this.state.tick,
        conversationId: rec.conversationId,
        agentId: rec.agentId,
        partnerId: rec.partnerId,
        turn: rec.turn,
        text,
        done: !!rec.done,
        ...(rec.source ? { source: rec.source } : {}),
      })
    }

    this.events.append({
      tick: this.state.tick,
      type: 'mind:say',
      agentId: rec.agentId,
      data: {
        partnerId: rec.partnerId,
        conversationId: rec.conversationId,
        turn: rec.turn,
        text,
        done: !!rec.done,
        source,
        agentName: agent?.name,
        partnerName: partner?.name,
      },
    })
  }

  /**
   * Force-apply a mind intent: override current action, emit mind:decision,
   * optionally append externalIntentLog + mindStats.
   */
  private forceExternalIntent(
    agentId: string,
    intent: Intent,
    meta: ExternalIntentMeta,
    opts: { recordLog: boolean; recordStats: boolean },
  ): void {
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return

    const currentKind = agent.action.kind
    if (currentKind !== 'idle') {
      this.endAction(agent, `mind override: stopped ${currentKind}`)
    }
    if (currentKind === 'work' && intent.kind !== 'work') {
      this.returnHaulCargo(agent)
    }

    // Mind reasons are first-person; stamp on the action
    const mindIntent: Intent = {
      ...cloneIntent(intent),
      reason: meta.reasoning || intent.reason,
    }
    this.startAction(agent, mindIntent)
    agent.lastDecideTick = this.state.tick
    this.externalAppliedThisTick.add(agentId)

    if (opts.recordLog) {
      this.state.externalIntentLog.push({
        tick: this.state.tick,
        agentId,
        intent: cloneIntent(intent),
        meta: cloneExternalMeta(meta),
      })
    }

    if (opts.recordStats) {
      const stats = this.state.mindStats[agentId] ?? {
        decisions: 0,
        fallbacks: 0,
        totalLatencyMs: 0,
        approxChars: 0,
      }
      stats.decisions += 1
      if (typeof meta.latencyMs === 'number') {
        stats.totalLatencyMs += meta.latencyMs
      }
      if (typeof meta.approxChars === 'number') {
        stats.approxChars += meta.approxChars
      }
      this.state.mindStats[agentId] = stats
    }

    this.events.append({
      tick: this.state.tick,
      type: 'mind:decision',
      agentId,
      data: {
        intent: {
          kind: intent.kind,
          targetPlaceId: intent.targetPlaceId,
          targetX: intent.targetX,
          targetY: intent.targetY,
          text: intent.text,
          proposalId: intent.proposalId,
          choice: intent.choice,
          targetAgentId: intent.targetAgentId,
          ruleId: intent.ruleId,
        },
        reasoning: meta.reasoning,
        source: 'luna',
        provider: meta.provider,
        latencyMs: meta.latencyMs,
        agentName: agent.name,
        actionChanging: currentKind !== intent.kind,
      },
      reason: meta.reasoning,
    })
  }

  /** World process: +1 food per bush/spring on each kind's interval, capped. */
  private stepBushRegrowth(): void {
    if (this.state.tick <= 0) return
    const interval = presetFacts(this.state.preset).bushRegrowInterval
    const springInterval = springRegrowInterval(this.state.preset)
    const bushDue = this.state.tick % interval === 0
    const springDue = this.state.tick % springInterval === 0
    if (!bushDue && !springDue) return
    for (const place of this.state.places) {
      if (place.kind === 'berry-bush' && bushDue) {
        this.regrowPlaceFood(place, BUSH_STOCK_MAX, `Berry bush ${place.id} regrew`)
      } else if (place.kind === 'spring' && springDue) {
        this.regrowPlaceFood(place, SPRING_STOCK_MAX, `Spring ${place.id} regrew`)
      }
    }
  }

  private regrowPlaceFood(place: Place, cap: number, reasonPrefix: string): void {
    const stock = place.inventory.food ?? 0
    if (stock >= cap) return
    this.regrowGoods(
      place.id,
      'food',
      1,
      `${reasonPrefix} (stock ${stock + 1})`,
    )
  }

  /**
   * World process: any place with `production` advances growth only while a
   * worker is actively tending a slot; at growth ≥ 1, mint yield of good
   * (`goods:produced`). One code path for farm / forestry / quarry.
   */
  private stepProduction(): void {
    for (const place of this.state.places) {
      const prod = place.production
      if (!prod) continue
      let tended = false
      for (const agent of this.state.agents) {
        if (agent.action.kind !== 'work') continue
        if (agent.employedAt !== place.id) continue
        if (agent.workPhase !== null && agent.workPhase !== 'tend') continue
        if (!this.isPerforming(agent)) continue
        if (!isSlotTile(this.state, place, agent.x, agent.y)) continue
        tended = true
        break
      }
      if (!tended) continue
      const rate = 1 / prod.cycleWorkedTicks
      const g = (place.growth ?? 0) + rate
      if (g >= 1) {
        place.growth = 0
        this.produceGoods(
          place.id,
          prod.good,
          prod.yield,
          `${place.kind} ${place.id} produced +${prod.yield} ${prod.good}`,
        )
      } else {
        place.growth = g
      }
    }
  }

  private homeCommissionFee(): number {
    const n = this.state.commissionFeeCoins
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n
    return this.state.preset === 'wild' ? 0 : COMMISSION_COST
  }

  private isCommissionCooling(agentId: string): boolean {
    const until = this.state.commissionCooldownUntil?.[agentId] ?? 0
    return this.state.tick < until
  }

  private armCommissionCooldown(agentId: string): void {
    if (!this.state.commissionCooldownUntil) this.state.commissionCooldownUntil = {}
    this.state.commissionCooldownUntil[agentId] =
      this.state.tick + COMMISSION_COOLDOWN_TICKS
  }

  private clearCommissionStreak(agentId: string): void {
    if (this.state.commissionLastRefusal) {
      delete this.state.commissionLastRefusal[agentId]
    }
    if (this.state.commissionCooldownUntil) {
      delete this.state.commissionCooldownUntil[agentId]
    }
  }

  private otherBuildableKinds(ownedKind: string): string {
    return (Object.keys(BUILD_RECIPES) as BuildableKind[])
      .filter((k) => k !== ownedKind)
      .join(', ')
  }

  private commissionRefusalFelt(
    kind: string,
    why: string,
    agent: AgentState,
    recipe: { wood: number; stone: number } | null,
  ): string {
    const whyText =
      why === 'cannot-afford'
        ? `${this.homeCommissionFee()}-coin fee, you have ${agent.wallet}`
        : why === 'already-owns'
          ? `you already own a ${kind}; you could commission a different kind (${this.otherBuildableKinds(kind)})`
          : why === 'already-commissioning'
            ? 'you already have a construction site'
            : why === 'site-cap'
              ? `${MAX_ACTIVE_SITES} sites already underway`
              : why === 'unknown-kind'
                ? `unknown-kind: ${kind} — buildable kinds are ${buildableKindList()}`
                : why === 'tile-not-buildable'
                  ? 'no buildable ground'
                  : why === 'max-level'
                    ? `already at level ${MAX_PLACE_LEVEL}`
                    : why
    const skipBill =
      !recipe ||
      why === 'unknown-kind' ||
      why === 'already-owns' ||
      why === 'already-commissioning' ||
      why === 'site-cap' ||
      why === 'cannot-afford' ||
      why === 'max-level'
    if (skipBill) {
      return `could not commission a ${kind} — ${whyText}`
    }
    return `could not commission a ${kind} — ${whyText}; the site's bill is ${recipe.wood} wood / ${recipe.stone} stone, filled by deliveries over time`
  }

  private refuseCommission(
    agentId: string,
    agentName: string,
    kind: string,
    why: string,
    reason: string,
    agent: AgentState,
  ): void {
    const last = this.state.commissionLastRefusal?.[agentId]
    if (last === why) {
      this.armCommissionCooldown(agentId)
      if (this.state.commissionLastRefusal) {
        delete this.state.commissionLastRefusal[agentId]
      }
    } else {
      if (!this.state.commissionLastRefusal) this.state.commissionLastRefusal = {}
      this.state.commissionLastRefusal[agentId] = why
    }
    const recipe = isBuildableKind(kind) ? BUILD_RECIPES[kind] : null
    const felt = this.commissionRefusalFelt(kind, why, agent, recipe)
    this.events.append({
      tick: this.state.tick,
      type: 'construction:commission-refused',
      agentId,
      data: { agentName, kind, why, felt },
      reason,
    })
  }

  /**
   * Commission a structure: recipe bill + optional home coin fee →
   * create a construction-site. Owning the kind (or a commons
   * notice-board / well) routes to an upgrade site instead of a new build.
   * At most one active site per commissioner and MAX_ACTIVE_SITES island-wide.
   */
  commission(
    agentId: string,
    kind: PlaceKind | BuildableKind | string = 'home',
    x?: number,
    y?: number,
  ): boolean {
    if (this.isCommissionCooling(agentId)) return false
    const agent = this.state.agents.find((a) => a.id === agentId)
    if (!agent) return false
    const fail = (why: string, reason: string): false => {
      this.refuseCommission(agentId, agent.name, String(kind), why, reason, agent)
      return false
    }
    if (!isBuildableKind(kind)) {
      return fail('unknown-kind', `${agent.name} cannot commission an unknown structure`)
    }
    const recipe = BUILD_RECIPES[kind]
    const upgradeTarget = this.findUpgradeTarget(agentId, kind, x, y)
    if (upgradeTarget && placeLevel(upgradeTarget) >= MAX_PLACE_LEVEL) {
      const label = kind === 'home' ? 'house' : kind
      return fail(
        'max-level',
        `${agent.name} could not commission — already at level ${MAX_PLACE_LEVEL} (${label})`,
      )
    }
    const fee = !upgradeTarget && kind === 'home' ? this.homeCommissionFee() : 0
    if (!upgradeTarget && kind === 'home' && fee > 0 && agent.wallet < fee) {
      return fail(
        'cannot-afford',
        `${agent.name} could not afford the ${fee}-coin house fee`,
      )
    }
    const activeSites = this.state.places.filter((p) => p.kind === 'construction-site')
    if (activeSites.some((p) => this.state.owners[p.id] === agentId)) {
      return fail(
        'already-commissioning',
        `${agent.name} already has an active construction site`,
      )
    }
    if (
      upgradeTarget &&
      activeSites.some((p) => p.construction?.upgradeOf === upgradeTarget.id)
    ) {
      return fail(
        'already-commissioning',
        `${agent.name} could not commission — that ${kind} is already being upgraded`,
      )
    }
    if (activeSites.length >= MAX_ACTIVE_SITES) {
      return fail(
        'site-cap',
        `${agent.name} could not commission — ${MAX_ACTIVE_SITES} sites already underway`,
      )
    }

    let plot: { x: number; y: number } | null = null
    if (upgradeTarget) {
      if (x !== undefined && y !== undefined) {
        const px = Math.round(x)
        const py = Math.round(y)
        const d = Math.max(Math.abs(px - upgradeTarget.x), Math.abs(py - upgradeTarget.y))
        if (d >= 1 && d <= 2 && this.isBuildablePlot(px, py, upgradeTarget.id)) {
          plot = { x: px, y: py }
        }
      }
      if (!plot) plot = this.findUpgradePlot(upgradeTarget)
      if (!plot) {
        return fail(
          'tile-not-buildable',
          `${agent.name} found no buildable ground beside the ${kind}`,
        )
      }
    } else if (x !== undefined && y !== undefined) {
      const px = Math.round(x)
      const py = Math.round(y)
      if (!this.isBuildablePlot(px, py)) {
        return fail(
          'tile-not-buildable',
          `${agent.name} cannot build a ${kind} at ${px},${py}`,
        )
      }
      plot = { x: px, y: py }
    } else {
      plot = this.findFreeHomePlot()
      if (!plot) {
        return fail(
          'tile-not-buildable',
          `${agent.name} found no buildable ground for a ${kind}`,
        )
      }
    }

    if (!upgradeTarget && kind === 'home' && fee > 0) {
      const paid = this.transferCoins(
        agentId,
        'treasury',
        fee,
        `${agent.name} paid ${fee} coins to commission a house`,
        { kind: 'commission', good: 'home' },
      )
      if (!paid) {
        return fail(
          'cannot-afford',
          `${agent.name} could not pay the ${fee}-coin house fee`,
        )
      }
    }

    const scale = upgradeTarget ? placeLevel(upgradeTarget) : 1
    const needs: Partial<Record<Good, number>> = {}
    const wood = recipe.wood * scale
    const stone = recipe.stone * scale
    if (wood > 0) needs.wood = wood
    if (stone > 0) needs.stone = stone

    const siteId = `site-${agentId}-${this.state.tick}`
    const site: Place = {
      id: siteId,
      kind: 'construction-site',
      x: plot.x,
      y: plot.y,
      slots: 2,
      jobSlots: 2,
      wage: 7,
      inventory: emptyInventory(),
      construction: {
        needs,
        progress: 0,
        consumeTicks: 0,
        targetKind: kind,
        ...(upgradeTarget ? { upgradeOf: upgradeTarget.id } : {}),
      },
    }
    // Clear 3×3 pad so the site is walkable
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = plot.x + dx
        const py = plot.y + dy
        if (px < 0 || py < 0 || px >= this.state.width || py >= this.state.height) {
          continue
        }
        const t = this.state.tiles[py * this.state.width + px]!
        if (t.kind === 'water') continue
        t.kind = 'grass'
        t.walkable = true
      }
    }
    this.state.places.push(site)
    this.state.owners[siteId] = agentId
    this.clearCommissionStreak(agentId)
    const label = kind === 'home' ? 'house' : kind
    this.events.append({
      tick: this.state.tick,
      type: 'construction:commissioned',
      agentId,
      data: {
        agentName: agent.name,
        placeId: siteId,
        kind,
        cost: fee,
        x: plot.x,
        y: plot.y,
        ...(upgradeTarget ? { upgradeOf: upgradeTarget.id } : {}),
      },
      reason: upgradeTarget
        ? `${agent.name} commissioned an upgrade of ${label}`
        : `${agent.name} commissioned a ${label}`,
    })
    return true
  }

  /**
   * Own completed place of this kind → always upgrade (cannot found a second).
   * Commons notice-board / well: upgrade when coords are omitted or adjacent;
   * an explicit free plot founds a new one instead.
   */
  private findUpgradeTarget(
    agentId: string,
    kind: BuildableKind,
    x?: number,
    y?: number,
  ): Place | undefined {
    const owned: Place[] = []
    const commonsCivic: Place[] = []
    for (const place of this.state.places) {
      if (place.kind !== kind) continue
      const owner = this.state.owners[place.id]
      if (owner === agentId) owned.push(place)
      else if (
        (kind === 'notice-board' || kind === 'well') &&
        (owner === 'commons' || owner === undefined)
      ) {
        commonsCivic.push(place)
      }
    }
    const pick = (list: Place[]): Place | undefined => {
      if (list.length === 0) return undefined
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return list[0]
    }
    const own = pick(owned)
    if (own) return own
    const civic = pick(commonsCivic)
    if (!civic) return undefined
    if (x === undefined || y === undefined) return civic
    const d = Math.max(Math.abs(Math.round(x) - civic.x), Math.abs(Math.round(y) - civic.y))
    if (d >= 1 && d <= 2) return civic
    return undefined
  }

  /**
   * Free plot on Chebyshev ring 1, then 2, around the upgrade target.
   * Spacing ignores the target itself so the site can sit beside it.
   */
  private findUpgradePlot(target: Place): { x: number; y: number } | null {
    const candidates: Array<[number, number]> = []
    for (let maxD = 1; maxD <= 2; maxD++) {
      candidates.length = 0
      for (let dy = -maxD; dy <= maxD; dy++) {
        for (let dx = -maxD; dx <= maxD; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== maxD) continue
          const hx = target.x + dx
          const hy = target.y + dy
          if (this.isBuildablePlot(hx, hy, target.id)) candidates.push([hx, hy])
        }
      }
      if (candidates.length > 0) break
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]))
    return { x: candidates[0]![0], y: candidates[0]![1] }
  }

  /**
   * Free home plot on the village ring (radius 4–8, Chebyshev spacing ≥ 2
   * from existing homes/sites).
   */
  private findFreeHomePlot(): { x: number; y: number } | null {
    const plaza = this.state.places.find((p) => p.kind === 'plaza')
    if (!plaza) return null
    const chebyshev = (ax: number, ay: number, bx: number, by: number) =>
      Math.max(Math.abs(ax - bx), Math.abs(ay - by))
    const blocked = (hx: number, hy: number): boolean => {
      for (const p of this.state.places) {
        if (
          p.kind === 'home' ||
          p.kind === 'construction-site' ||
          p.kind === 'farm' ||
          p.kind === 'stall' ||
          p.kind === 'storehouse' ||
          p.kind === 'plaza' ||
          p.kind === 'well'
        ) {
          if (chebyshev(p.x, p.y, hx, hy) < 2) return true
        }
      }
      return false
    }
    const candidates: Array<[number, number]> = []
    for (let maxR = 7; maxR <= 8; maxR++) {
      for (let r = 4; r <= maxR; r++) {
        for (let angle = 0; angle < 48; angle++) {
          const rad = (angle / 48) * Math.PI * 2
          const hx = Math.round(plaza.x + Math.cos(rad) * r)
          const hy = Math.round(plaza.y + Math.sin(rad) * r)
          if (hx < 1 || hy < 1 || hx >= this.state.width - 1 || hy >= this.state.height - 1) {
            continue
          }
          const t = this.state.tiles[hy * this.state.width + hx]!
          if (!t.walkable || t.kind === 'water' || t.kind === 'rock') continue
          if (blocked(hx, hy)) continue
          candidates.push([hx, hy])
        }
      }
      if (candidates.length > 0) break
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => {
      const da = (a[0] - plaza.x) ** 2 + (a[1] - plaza.y) ** 2
      const db = (b[0] - plaza.x) ** 2 + (b[1] - plaza.y) ** 2
      if (da !== db) return da - db
      if (a[0] !== b[0]) return a[0] - b[0]
      return a[1] - b[1]
    })
    return { x: candidates[0]![0], y: candidates[0]![1] }
  }

  /** True when (x,y) can host a construction pad (walkable land, spaced). */
  private isBuildablePlot(hx: number, hy: number, ignorePlaceId?: string): boolean {
    if (hx < 1 || hy < 1 || hx >= this.state.width - 1 || hy >= this.state.height - 1) {
      return false
    }
    const t = this.state.tiles[hy * this.state.width + hx]
    if (!t || !t.walkable || t.kind === 'water' || t.kind === 'rock') return false
    const chebyshev = (ax: number, ay: number, bx: number, by: number) =>
      Math.max(Math.abs(ax - bx), Math.abs(ay - by))
    for (const p of this.state.places) {
      if (ignorePlaceId && p.id === ignorePlaceId) continue
      if (
        p.kind === 'home' ||
        p.kind === 'construction-site' ||
        p.kind === 'farm' ||
        p.kind === 'stall' ||
        p.kind === 'storehouse' ||
        p.kind === 'plaza' ||
        p.kind === 'well'
      ) {
        if (chebyshev(p.x, p.y, hx, hy) < 2) return false
      }
    }
    return true
  }

  /**
   * Site complete: becomes the commissioned kind; jobs dissolve; ownership deed.
   * Founder (commissioner) keeps the deed for every kind — worldgen places stay commons.
   * Upgrade sites (`construction.upgradeOf`) increment the target's level instead.
   */
  private completeConstruction(site: Place): void {
    if (site.kind !== 'construction-site') return
    const finishedKind: BuildableKind = isBuildableKind(site.construction?.targetKind ?? 'home')
      ? (site.construction!.targetKind ?? 'home')
      : 'home'
    const upgradeOf = site.construction?.upgradeOf
    if (upgradeOf) {
      const target = this.state.places.find((p) => p.id === upgradeOf)
      if (target) this.completeUpgrade(site, target, finishedKind)
      else this.removePlace(site)
      return
    }
    const commissioner = this.state.owners[site.id] ?? 'commons'
    const commissionerAgent =
      commissioner !== 'commons'
        ? this.state.agents.find((a) => a.id === commissioner)
        : undefined

    // Vacate all employees at this site
    for (const a of this.state.agents) {
      if (a.employedAt === site.id) {
        this.vacateJob(
          a,
          `${a.name}'s construction job finished — ${finishedKind} complete`,
        )
        if (a.action.kind === 'work' && a.action.targetPlaceId === site.id) {
          a.action = { kind: 'idle', reason: `${finishedKind} finished` }
          a.actionTicks = 0
          a.workPhase = null
          this.clearHaul(a)
        }
      }
    }

    this.applyCompletedPlace(site, finishedKind)

    // Deed to commissioner for every commissioned kind (firstPrivate semantics).
    if (commissioner !== 'commons') {
      if (this.state.owners[site.id] !== commissioner) {
        this.transferOwnership(site.id, commissioner, 'built and paid for it')
      } else {
        const prev = this.state.owners[site.id]
        this.events.append({
          tick: this.state.tick,
          type: 'ownership:transfer',
          data: {
            placeId: site.id,
            from: prev,
            to: commissioner,
            firstPrivate: true,
          },
          reason: 'built and paid for it',
        })
      }
      if (finishedKind === 'home' && commissionerAgent) {
        commissionerAgent.homeId = site.id
      }
    }

    this.events.append({
      tick: this.state.tick,
      type: 'construction:completed',
      agentId: commissioner !== 'commons' ? commissioner : undefined,
      data: {
        placeId: site.id,
        agentName: commissionerAgent?.name,
        kind: finishedKind,
        firstPrivate: commissioner !== 'commons',
      },
      reason: commissionerAgent
        ? `${commissionerAgent.name}'s ${finishedKind === 'home' ? 'house' : finishedKind} is finished`
        : `${finishedKind} ${site.id} is finished`,
    })

    if (commissioner !== 'commons') {
      const label = placeKindLabel(finishedKind)
      this.events.append({
        tick: this.state.tick,
        type: 'discovery:examined',
        agentId: commissioner,
        data: {
          target: site.id,
          placeKind: finishedKind,
          knowledge: EXAMINE_BY_KIND[finishedKind],
          agentName: commissionerAgent?.name,
        },
        reason: commissionerAgent
          ? `${commissionerAgent.name} built this ${label} and knows its workings`
          : `built this ${label} and knows its workings`,
      })
    }
  }

  /**
   * Upgrade site done: remove the site, increment target level, keep inventory /
   * jobs / owner. Slots +1 and production yield +1 per level above 1.
   */
  private completeUpgrade(site: Place, target: Place, kind: BuildableKind): void {
    const commissioner = this.state.owners[site.id] ?? 'commons'
    const commissionerAgent =
      commissioner !== 'commons'
        ? this.state.agents.find((a) => a.id === commissioner)
        : undefined

    for (const a of this.state.agents) {
      if (a.employedAt === site.id) {
        this.vacateJob(a, `${a.name}'s construction job finished — ${kind} upgraded`)
      }
      if (a.action.targetPlaceId === site.id) {
        a.action = { kind: 'idle', reason: `${kind} upgrade finished` }
        a.actionTicks = 0
        a.workPhase = null
        this.clearHaul(a)
      } else if (a.haulDropoffId === site.id || a.haulSourceId === site.id) {
        this.clearHaul(a)
      }
    }

    const fromLevel = placeLevel(target)
    const newLevel = Math.min(MAX_PLACE_LEVEL, fromLevel + 1)
    if (newLevel > fromLevel) {
      target.level = newLevel
      target.slots += 1
      if (target.production) target.production.yield += 1
    }

    this.removePlace(site)

    const ownerId = this.state.owners[target.id]
    const ownerAgent =
      ownerId && ownerId !== 'commons'
        ? this.state.agents.find((a) => a.id === ownerId)
        : undefined
    const kindLabel = kind === 'home' ? 'house' : kind
    this.events.append({
      tick: this.state.tick,
      type: 'construction:completed',
      agentId: commissioner !== 'commons' ? commissioner : undefined,
      data: {
        placeId: target.id,
        agentName: commissionerAgent?.name,
        kind,
        upgradeOf: target.id,
        level: newLevel,
      },
      reason: ownerAgent
        ? `${ownerAgent.name}'s ${kindLabel} was raised to level ${newLevel}`
        : `the ${kindLabel} was raised to level ${newLevel}`,
    })
  }

  private removePlace(place: Place): void {
    const i = this.state.places.indexOf(place)
    if (i >= 0) this.state.places.splice(i, 1)
    delete this.state.owners[place.id]
  }

  /**
   * Labour ticks for a site. Upgrade bill = recipe × current target level
   * (1→2 costs 1×, 2→3 costs 2×). New builds use 1×.
   */
  private constructionLabourTicks(c: NonNullable<Place['construction']>): number {
    const kind = (c.targetKind ?? 'home') as BuildableKind
    const base = BUILD_RECIPES[kind]?.labourTicks ?? CONSTRUCTION_TICKS
    if (!c.upgradeOf) return base
    const target = this.state.places.find((p) => p.id === c.upgradeOf)
    return base * placeLevel(target)
  }

  /**
   * Initialise a finished site so it matches a worldgen-spawned place of that kind.
   */
  private applyCompletedPlace(site: Place, kind: BuildableKind): void {
    site.kind = kind
    site.construction = undefined
    site.growth = undefined
    site.inventory = emptyInventory()
    site.production = undefined
    site.price = undefined
    site.jobSlots = 0
    site.wage = undefined

    const facts = presetFacts(this.state.preset)
    switch (kind) {
      case 'home':
        site.slots = 1
        break
      case 'farm':
        site.slots = 2
        site.jobSlots = 2
        site.wage = 6
        site.growth = 0
        site.production = {
          good: 'food',
          cycleWorkedTicks: 1440,
          yield: facts.farmYield,
        }
        break
      case 'forestry':
        site.slots = 2
        site.jobSlots = 2
        site.wage = 6
        site.growth = 0
        site.production = { good: 'wood', cycleWorkedTicks: 960, yield: 6 }
        break
      case 'quarry':
        site.slots = 2
        site.jobSlots = 2
        site.wage = 6
        site.growth = 0
        site.production = { good: 'stone', cycleWorkedTicks: 1200, yield: 6 }
        break
      case 'stall':
        site.slots = 4
        site.jobSlots = 1
        site.wage = 5
        site.price = { food: 11 }
        break
      case 'storehouse':
        site.slots = 2
        break
      case 'well':
        site.slots = 2
        break
      case 'notice-board':
        site.slots = 2
        break
    }
  }

  /**
   * World rule: standing on/adjacent to a construction site, move carried
   * wood/stone into the site inventory up to the remaining bill. Emits
   * `goods:transfer` per good. Returns units moved.
   */
  private depositInventoryToSite(agent: AgentState, site: Place): number {
    if (site.kind !== 'construction-site' || !site.construction) return 0
    if (!isStanding(agent)) return 0
    if (!isSlotTile(this.state, site, agent.x, agent.y)) return 0
    const c = site.construction
    let moved = 0
    for (const g of ['wood', 'stone'] as Good[]) {
      const need = Math.max(0, (c.needs[g] ?? 0) - (site.inventory[g] ?? 0))
      const have = agent.inventory[g] ?? 0
      const amt = Math.min(need, have)
      if (amt <= 0) continue
      const ok = this.transferGoods(
        { kind: 'agent', id: agent.id },
        { kind: 'place', id: site.id },
        g,
        amt,
        `${agent.name} delivered ${amt} ${g} to the build at ${site.id}`,
      )
      if (ok) moved += amt
    }
    return moved
  }

  private pickSiteNeedingCarried(agent: AgentState): Place | undefined {
    const sites = this.state.places.filter((p) => p.kind === 'construction-site')
    let best: Place | undefined
    let bestD = Infinity
    for (const site of sites) {
      const c = site.construction
      if (!c) continue
      let match = false
      for (const g of ['wood', 'stone'] as Good[]) {
        const need = Math.max(0, (c.needs[g] ?? 0) - (site.inventory[g] ?? 0))
        if (need > 0 && (agent.inventory[g] ?? 0) > 0) {
          match = true
          break
        }
      }
      if (!match) continue
      const d = (site.x - agent.x) ** 2 + (site.y - agent.y) ** 2
      if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && (!best || site.id < best.id))) {
        bestD = d
        best = site
      }
    }
    return best
  }

  private performDeliver(agent: AgentState, place: Place | undefined): void {
    const site =
      place?.kind === 'construction-site'
        ? place
        : this.pickSiteNeedingCarried(agent)
    if (!site) {
      this.endAction(agent, 'no construction site needs what they carry')
      agent.action = { kind: 'idle', reason: 'Nothing to drop off' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }
    const onSite =
      isStanding(agent) && isSlotTile(this.state, site, agent.x, agent.y)
    if (!onSite) return
    const moved = this.depositInventoryToSite(agent, site)
    this.endAction(
      agent,
      moved > 0
        ? `delivered ${moved} material${moved === 1 ? '' : 's'} to the build`
        : 'site did not need what they carry',
    )
    agent.action = {
      kind: 'idle',
      reason:
        moved > 0
          ? `Dropped off materials at the ${site.construction?.targetKind ?? 'site'}`
          : 'Nothing the site needed',
    }
    agent.actionTicks = 0
    agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
  }

  /** Gather wood (forest) / stone (rock) from the tile the agent is on or beside. */
  private performGather(agent: AgentState): void {
    const res = gatherResourceAt(
      this.state,
      Math.round(agent.x),
      Math.round(agent.y),
    )
    if (!res) {
      this.endAction(agent, 'nothing to gather here')
      agent.action = { kind: 'idle', reason: 'No wood or stone here' }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
      return
    }
    const tile = this.state.tiles[res.y * this.state.width + res.x]!
    const good: Good = tile.kind === 'forest' ? 'wood' : 'stone'
    const stock = tile.gatherStock ?? GATHER_STOCK_MAX
    const carry = agent.inventory[good] ?? 0

    if (
      agent.actionTicks > 0 &&
      agent.actionTicks % GATHER_TICKS_PER_UNIT === 0 &&
      stock > 0 &&
      carry < GATHER_CARRY_CAP
    ) {
      tile.gatherStock = stock - 1
      agent.inventory[good] = carry + 1
      this.events.append({
        tick: this.state.tick,
        type: 'goods:produced',
        agentId: agent.id,
        data: {
          good,
          amount: 1,
          placeId: `terrain:${tile.x},${tile.y}`,
          placeKind: tile.kind,
          tileX: tile.x,
          tileY: tile.y,
          terrain: tile.kind,
          source: 'gather',
        },
        reason: `${agent.name} gathered 1 ${good}`,
      })
    }

    const left = tile.gatherStock ?? GATHER_STOCK_MAX
    const held = agent.inventory[good] ?? 0
    if (held >= GATHER_CARRY_CAP || left <= 0) {
      this.endAction(
        agent,
        held >= GATHER_CARRY_CAP
          ? `gathered a full load (${held} ${good})`
          : `${tile.kind} depleted, carrying ${held} ${good}`,
      )
      agent.action = {
        kind: 'idle',
        reason:
          held >= GATHER_CARRY_CAP
            ? `Arms full of ${good}`
            : `${tile.kind} picked clean`,
      }
      agent.actionTicks = 0
      agent.lastDecideTick = this.state.tick - REDECIDE_INTERVAL
    }
  }

  /**
   * World process: forest/rock tiles recover 1 gather unit on the same
   * interval as berry-bush regrowth, capped at GATHER_STOCK_MAX.
   */
  private stepTerrainRegrowth(): void {
    if (this.state.tick <= 0) return
    const interval = presetFacts(this.state.preset).bushRegrowInterval
    if (this.state.tick % interval !== 0) return
    for (const tile of this.state.tiles) {
      if (tile.kind !== 'forest' && tile.kind !== 'rock') continue
      const stock = tile.gatherStock
      if (stock === undefined || stock >= GATHER_STOCK_MAX) continue
      tile.gatherStock = stock + 1
      const good: Good = tile.kind === 'forest' ? 'wood' : 'stone'
      this.events.append({
        tick: this.state.tick,
        type: 'goods:regrow',
        data: {
          good,
          amount: 1,
          tileX: tile.x,
          tileY: tile.y,
          terrain: tile.kind,
        },
        reason: `${tile.kind} at ${tile.x},${tile.y} regrew (stock ${tile.gatherStock})`,
      })
    }
  }

  /** Recompute stall posted price from stock each sim-hour. */
  private stepMarketPrice(): void {
    for (const place of this.state.places) {
      if (place.kind !== 'stall') continue
      const stock = place.inventory.food ?? 0
      if (!place.price) place.price = {}
      place.price.food = marketPriceFromStock(stock)
    }
  }

  /** Append hourly economy sample to world.stats. */
  private stepEconomyStats(): void {
    const stall = this.state.places.find((p) => p.kind === 'stall')
    const stock = stall?.inventory.food ?? 0
    const price = stall?.price?.food ?? marketPriceFromStock(stock)
    let employed = 0
    let collapsed = 0
    let sumW = 0
    let minW = Infinity
    let maxW = -Infinity
    for (const a of this.state.agents) {
      if (a.employedAt) employed++
      if (a.collapsed) collapsed++
      sumW += a.wallet
      if (a.wallet < minW) minW = a.wallet
      if (a.wallet > maxW) maxW = a.wallet
    }
    const n = this.state.agents.length
    const sample: EconomyStat = {
      tick: this.state.tick,
      price,
      stallStock: stock,
      treasury: this.state.treasury,
      employed,
      meanWallet: n > 0 ? sumW / n : 0,
      minWallet: n > 0 ? minW : 0,
      maxWallet: n > 0 ? maxW : 0,
      collapsed,
    }
    this.state.stats.push(sample)
  }

  /**
   * World fact: sympathy accrues when two agents stand still near each other.
   * Deliberately influences nothing — UtilityBrain never reads these numbers.
   */
  private stepSympathy(): void {
    if (!this.state.sympathyStreak) this.state.sympathyStreak = {}
    if (!this.state.sympathyMet) this.state.sympathyMet = {}

    const agents = this.state.agents
    const byId = new Map<string, AgentState>()
    for (const a of agents) {
      if (!a.sympathy) a.sympathy = {}
      byId.set(a.id, a)
    }

    // Pairwise stationary proximity (O(n²) — n=24)
    const nearKeys = new Set<string>()
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!
      if (!isStanding(a)) continue
      for (let j = i + 1; j < agents.length; j++) {
        const b = agents[j]!
        if (!isStanding(b)) continue
        if (dist2(a.x, a.y, b.x, b.y) > SOCIAL_PROXIMITY_SQ) continue
        nearKeys.add(sympathyPairKey(a.id, b.id))
      }
    }

    const nextStreak: Record<string, number> = {}
    for (const key of nearKeys) {
      const streak = (this.state.sympathyStreak[key] ?? 0) + 1
      nextStreak[key] = streak
      this.state.sympathyMet[key] = true

      if (streak % SYMPATHY_STREAK_TICKS === 0) {
        const pipe = key.indexOf('|')
        const idA = key.slice(0, pipe)
        const idB = key.slice(pipe + 1)
        const a = byId.get(idA)
        const b = byId.get(idB)
        if (a && b) this.accrueSympathyPair(a, b, SYMPATHY_ACCRUE)
      }
    }
    this.state.sympathyStreak = nextStreak
  }

  /** End-of-day decay for pairs that never shared proximity that day. */
  private stepSympathyDecay(): void {
    if (!this.state.sympathyMet) this.state.sympathyMet = {}
    const met = this.state.sympathyMet
    const byId = new Map(this.state.agents.map((a) => [a.id, a] as const))

    // Collect unique pairs that currently have sympathy
    const pairs = new Set<string>()
    for (const a of this.state.agents) {
      if (!a.sympathy) a.sympathy = {}
      for (const otherId of Object.keys(a.sympathy)) {
        pairs.add(sympathyPairKey(a.id, otherId))
      }
    }

    for (const key of pairs) {
      if (met[key]) continue
      const pipe = key.indexOf('|')
      const idA = key.slice(0, pipe)
      const idB = key.slice(pipe + 1)
      const a = byId.get(idA)
      const b = byId.get(idB)
      if (!a || !b) continue
      const old = a.sympathy[b.id] ?? b.sympathy[a.id] ?? 0
      if (old <= 0) continue
      const neu = Math.max(0, old - SYMPATHY_DECAY)
      this.setSympathyPair(a, b, neu)
    }
  }

  private accrueSympathyPair(a: AgentState, b: AgentState, delta: number): void {
    const old = a.sympathy[b.id] ?? b.sympathy[a.id] ?? 0
    const neu = clamp01(old + delta)
    this.setSympathyPair(a, b, neu)
    this.emitRelationshipMilestones(a, b, old, neu)
  }

  private setSympathyPair(a: AgentState, b: AgentState, value: number): void {
    if (!a.sympathy) a.sympathy = {}
    if (!b.sympathy) b.sympathy = {}
    if (value <= 0) {
      delete a.sympathy[b.id]
      delete b.sympathy[a.id]
    } else {
      a.sympathy[b.id] = value
      b.sympathy[a.id] = value
    }
  }

  private emitRelationshipMilestones(
    a: AgentState,
    b: AgentState,
    old: number,
    neu: number,
  ): void {
    if (old < SYMPATHY_FRIEND && neu >= SYMPATHY_FRIEND) {
      this.events.append({
        tick: this.state.tick,
        type: 'relationship:friends',
        agentId: a.id,
        data: {
          agentIdA: a.id,
          agentIdB: b.id,
          nameA: a.name,
          nameB: b.name,
          sympathy: neu,
        },
        reason: 'grown close from time spent together',
      })
    }
    if (old < SYMPATHY_CLOSE && neu >= SYMPATHY_CLOSE) {
      this.events.append({
        tick: this.state.tick,
        type: 'relationship:close',
        agentId: a.id,
        data: {
          agentIdA: a.id,
          agentIdB: b.id,
          nameA: a.name,
          nameB: b.name,
          sympathy: neu,
        },
        reason: 'grown close from time spent together',
      })
    }
  }

  /**
   * Give 1 carried food to an adjacent collapsed villager; they consume it and
   * may recover under the existing hunger threshold.
   */
  private giveFoodToCollapsed(giver: AgentState, targetId: string): boolean {
    const target = this.state.agents.find((a) => a.id === targetId)
    if (!target || target.id === giver.id) return false
    if (!target.collapsed) return false
    if ((giver.inventory.food ?? 0) < 1) return false
    const dx = Math.abs(Math.round(giver.x) - Math.round(target.x))
    const dy = Math.abs(Math.round(giver.y) - Math.round(target.y))
    if (Math.max(dx, dy) > GIVE_ADJACENCY) return false

    const moved = this.transferGoods(
      { kind: 'agent', id: giver.id },
      { kind: 'agent', id: target.id },
      'food',
      1,
      `${giver.name} gave 1 food to collapsed ${target.name}`,
    )
    if (!moved) return false
    const eaten = this.consumeGoods(
      { kind: 'agent', id: target.id },
      'food',
      1,
      `${target.name} ate food given by ${giver.name}`,
    )
    if (eaten) {
      target.needs.hunger = clamp01(target.needs.hunger + EAT_HUNGER_PER_UNIT)
      this.checkCollapse(target)
    }
    return true
  }

  /** Stall sales: private owner receives revenue; commons stalls pay treasury. */
  private stallRevenueParty(place: Place): CoinParty {
    if (!OWNER_REVENUE_KINDS.has(place.kind)) return 'treasury'
    const owner = this.state.owners[place.id]
    if (owner && owner !== 'commons') return owner
    return 'treasury'
  }

  /** Workplace wages: private owner meets payroll; commons workplaces use treasury. */
  private wagePayer(place: Place): CoinParty {
    if (!OWNER_PAYROLL_KINDS.has(place.kind)) return 'treasury'
    const owner = this.state.owners[place.id]
    if (owner && owner !== 'commons') return owner
    return 'treasury'
  }

  /**
   * 18:00 wage day: pay wage × min(1, workedTicks/300) from treasury
   * (or the private owner's wallet for owned productive places).
   * Partial if payer is short. Idle days accumulate toward job vacation.
   */
  private stepWagePayments(): void {
    for (const agent of this.state.agents) {
      if (!agent.employedAt) continue
      const place = this.state.places.find((p) => p.id === agent.employedAt)
      if (!place) {
        this.vacateJob(agent, `${agent.name}'s workplace vanished`)
        continue
      }
      const wage = place.wage ?? 0
      const due = Math.floor(wage * Math.min(1, agent.workedTicks / FULL_WAGE_TICKS))
      if (due > 0) {
        const payer = this.wagePayer(place)
        const purse = this.coinBalance(payer)
        const pay = Math.min(due, purse)
        if (pay > 0 && payer !== agent.id) {
          const partial = pay < due
          const payerLabel =
            payer === 'treasury' ? 'treasury' : 'owner'
          this.transferCoins(
            payer,
            agent.id,
            pay,
            partial
              ? `${agent.name} earned ${pay} coins (partial; ${payerLabel} short)`
              : `${agent.name} earned ${pay} coins`,
            {
              kind: 'wage',
              workedTicks: agent.workedTicks,
              wage,
              due,
              partial,
              placeId: place.id,
              placeKind: place.kind,
              fromOwner: payer !== 'treasury',
            },
          )
        }
      }

      // Abandonment: 2 consecutive days with zero work frees the seat
      if (agent.workedTicks === 0) {
        agent.daysIdleOnJob++
        if (agent.daysIdleOnJob >= 2) {
          this.vacateJob(
            agent,
            `${agent.name} abandoned their ${place.kind} job after 2 idle days`,
          )
          continue
        }
      } else {
        agent.daysIdleOnJob = 0
      }
      agent.workedTicks = 0
    }
  }

  private archiveCompletedDay(day: number, endTick: Tick): void {
    const startTick = dayStartTick(day)
    if (this.dayArchives.some((a) => a.day === day)) return
    this.snapshots.pin(startTick)
    // Ensure a snap exists at start (tick 0 always does; later midnights are interval-aligned)
    const nearest = this.snapshots.nearestAtOrBefore(startTick)
    if (!nearest || nearest.state.tick !== startTick) {
      // Should not happen on normal runs; skip prune rather than leave day unrecoverable
      this.dayArchives.push({ day, startTick, endTick })
      return
    }
    this.snapshots.pruneRange(startTick, endTick)
    this.dayArchives.push({ day, startTick, endTick })
  }

  private makeSnapshot(): SimSnapshot {
    return {
      state: deepCloneWorld(this.state),
      rngState: this.rng.getState(),
      eventSeq: this.events.getSeq(),
      events: this.events.getAll().map((e) => ({
        ...e,
        data: e.data ? { ...e.data } : undefined,
      })),
    }
  }

  snapshot(): SimSnapshot {
    return this.makeSnapshot()
  }

  static fromSnapshot(
    snap: SimSnapshot,
    events?: SimEvent[],
    opts?: {
      intentPlayback?: ExternalIntentRecord[] | null
      notePlayback?: MindNoteRecord[] | null
      sayPlayback?: SayRecord[] | null
    },
  ): Simulation {
    const ev = new EventTrace()
    const eventList = events ?? snap.events
    ev.replace(
      eventList.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
      snap.eventSeq,
    )
    const world = deepCloneWorld(snap.state)
    ensureMindFields(world)
    const sim = new Simulation(snap.state.seed, {
      state: world,
      rngState: snap.rngState,
      events: ev,
      skipInitEvents: true,
      intentPlayback: opts?.intentPlayback ?? null,
      notePlayback: opts?.notePlayback ?? null,
      sayPlayback: opts?.sayPlayback ?? null,
    })
    // Rebuild snapshot ring from restored position for further seeks on this fork
    sim.snapshots.add(sim.makeSnapshot())
    return sim
  }

  /**
   * Full persistence restore: head state + event log + day archives + snapshot ring.
   * Used by restoreSave only.
   */
  static fromSaveParts(parts: {
    seed: number
    head: SimSnapshot
    events: SimEvent[]
    dayArchives: DayArchiveMeta[]
    snaps: SimSnapshot[]
    pinned: Tick[]
  }): Simulation {
    const ev = new EventTrace()
    ev.replace(
      parts.events.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
      parts.head.eventSeq,
    )
    const store = new SnapshotStore()
    store.loadPack(parts.snaps, parts.pinned)
    // Ensure head is in the ring so seeks near live tick work after restore
    const headClone = cloneSimSnapshot(parts.head)
    headClone.events = parts.events.map((e) => ({
      ...e,
      data: e.data ? { ...e.data } : undefined,
    }))
    store.add(headClone)
    const headState = deepCloneWorld(parts.head.state)
    ensureMindFields(headState)
    return new Simulation(parts.seed, {
      state: headState,
      rngState: parts.head.rngState,
      events: ev,
      snapshots: store,
      dayArchives: parts.dayArchives,
      skipInitEvents: true,
    })
  }

  /**
   * Returns a FORKED sim at the given tick. Never mutates the live sim.
   * Fork gets its own event trace (copy-on-fork).
   * Re-sim plays back externalIntentLog + mindNoteLog + sayLog so mind calls are never re-requested.
   */
  stateAt(tick: Tick): Simulation {
    const target = Math.max(0, Math.min(tick, this.state.tick))
    ensureMindFields(this.state)
    // Full logs up to live head — re-sim applies entries at their recorded ticks
    const playback = cloneExternalIntentLog(this.state.externalIntentLog)
    const notePlayback = cloneMindNoteLog(this.state.mindNoteLog)
    const sayPlayback = cloneSayLog(this.state.sayLog)
    const nearest = this.snapshots.nearestAtOrBefore(target)
    if (!nearest) {
      // Fallback: re-sim from scratch with playback
      const fresh = new Simulation(this.state.seed, {
        intentPlayback: playback,
        notePlayback,
        sayPlayback,
        preset: this.state.preset,
      })
      if (target > 0) fresh.advanceTicks(target)
      return fresh
    }
    const fork = Simulation.fromSnapshot(nearest, undefined, {
      intentPlayback: playback,
      notePlayback,
      sayPlayback,
    })
    const remaining = target - fork.state.tick
    if (remaining > 0) fork.advanceTicks(remaining)
    return fork
  }

  hash(): string {
    return fnv1aHex(stableStringify(this.state))
  }
}

export { SNAPSHOT_INTERVAL }

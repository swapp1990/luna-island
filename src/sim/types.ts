export type Tick = number // 1 tick = 1 sim minute; 1440 ticks = 1 day

/** World-gen intensity. Same rules; lean is a harsher fact sheet; wild is unbuilt. */
export type WorldPreset = 'default' | 'lean' | 'wild'

export interface SimTime { day: number; hour: number; minute: number; tick: Tick }

export type TerrainKind = 'water' | 'sand' | 'grass' | 'forest' | 'rock'

export interface Tile {
  x: number
  y: number
  kind: TerrainKind
  walkable: boolean
  elevation: number
  /** Village footpath — agents prefer these (lower path cost). */
  path?: boolean
  /**
   * Remaining gatherable units on forest (wood) / rock (stone).
   * Missing ⇒ full stock. Additive; old saves treat as full.
   */
  gatherStock?: number
  /**
   * Cumulative completed agent steps onto this tile (minds and sheep).
   * Missing ⇒ 0. Additive; old saves treat as unworn.
   */
  wear?: number
}

export type PlaceKind =
  | 'home'
  | 'berry-bush'
  | 'well'
  | 'plaza'
  | 'farm'
  | 'stall'
  | 'forestry'
  | 'quarry'
  | 'storehouse'
  | 'construction-site'
  | 'notice-board'
  | 'spring'

/** Place kinds the engine can raise from a construction site. */
export type BuildableKind =
  | 'home'
  | 'farm'
  | 'well'
  | 'stall'
  | 'storehouse'
  | 'forestry'
  | 'quarry'
  | 'notice-board'

/** Extensible goods union. */
export type Good = 'food' | 'wood' | 'stone'

export type Inventory = Record<Good, number>

/** Workplace production rule: progress while worked; mint yield on cycle. */
export interface ProductionSpec {
  good: Good
  /** Worked ticks to complete one cycle (progress += 1/cycleWorkedTicks). */
  cycleWorkedTicks: number
  /** Units minted into place inventory on completion. */
  yield: number
}

/** Construction bill + progress for a construction-site. */
export interface ConstructionSpec {
  /** Remaining materials still to be consumed (and thus still to deliver). */
  needs: Partial<Record<Good, number>>
  /** Build progress 0..1. */
  progress: number
  /** Worked ticks accrued toward the next 1-unit material consume. */
  consumeTicks: number
  /**
   * Kind this site becomes at progress ≥ 1.
   * Missing on older saves ⇒ home.
   */
  targetKind?: BuildableKind
  /**
   * When set, this site upgrades an existing place instead of becoming a new one.
   * Missing ⇒ new construction. Additive; old saves treat as a new build.
   */
  upgradeOf?: string
  /**
   * Distinct agent ids who delivered materials or worked this site.
   * Missing ⇒ none. Additive; used to split a public-works bounty.
   */
  contributors?: string[]
}

/** Place owner: a villager id or the village commons. */
export type OwnerId = string | 'commons'

export interface Place {
  id: string
  kind: PlaceKind
  x: number
  y: number
  /** Concurrent restore / interaction capacity (agents using this place). */
  slots: number
  /** Goods held at this place. */
  inventory: Inventory
  /**
   * Production/construction visual progress 0..1.
   * For workplaces with `production`, advances while tended.
   */
  growth?: number
  /** Open employment seats (workplaces only). */
  jobSlots?: number
  /** Posted daily wage in coins (workplaces only). */
  wage?: number
  /** Posted unit prices (stall only). */
  price?: Partial<Record<Good, number>>
  /** Generic production rule (farm, forestry, quarry, …). */
  production?: ProductionSpec
  /** Present only on construction-site places. */
  construction?: ConstructionSpec
  /**
   * Coins held at this place (public-works bounty). Missing ⇒ 0.
   * Additive; old saves treat as empty. Moves only via transferCoins.
   */
  wallet?: number
  /**
   * Building tier. Missing ⇒ 1. Additive; old saves treat as level 1.
   * Only BuildableKind places level (max 3).
   */
  level?: number
}

/** Hourly economy sample (Dispatch L UI). */
export interface EconomyStat {
  tick: Tick
  price: number
  stallStock: number
  treasury: number
  employed: number
  meanWallet: number
  minWallet: number
  maxWallet: number
  /** Agents currently collapsed (hunger). */
  collapsed: number
}

/** All needs 0..1, where 1 = fully satisfied. */
export interface Needs { hunger: number; energy: number; social: number }

export type ActionKind =
  | 'idle'
  | 'walk'
  | 'sleep'
  | 'eat'
  | 'drink'
  | 'socialize'
  | 'wander'
  | 'forage'
  | 'gather'
  | 'deliver'
  | 'work'
  | 'buy'
  | 'commission'
  | 'propose'
  | 'vote'
  | 'sanction'
  | 'claim'
  | 'examine'
  | 'give'

export type VoteChoice = 'yes' | 'no'
export type ProposalStatus = 'open' | 'passed' | 'failed'

/** Posted civic proposal. Tallies are public facts. */
export interface Proposal {
  id: string
  proposerId: string
  text: string
  createdTick: Tick
  closesTick: Tick
  votes: Record<string, VoteChoice>
  status: ProposalStatus
  /**
   * Optional public-works payload. Structured — never parsed from `text`.
   * Missing ⇒ rule-only proposal. Coords omitted ⇒ plot chosen at passage.
   */
  build?: { kind: BuildableKind; x?: number; y?: number }
}

/**
 * Posted rule. Display / observation data ONLY — action mechanics must never
 * read `text` (or otherwise consult a rule) to allow, block, or alter an act.
 */
export interface Rule {
  id: string
  text: string
  proposerId: string
  enactedTick: Tick
  active: boolean
}

/** Mid-work haul phases (mechanical, not a brain script). */
export type WorkPhase = 'tend' | 'hauling' | 'returning'

export interface AgentAction {
  kind: ActionKind
  targetPlaceId?: string
  /** Tile target for wander (and reserved destinations). */
  targetX?: number
  targetY?: number
  path?: Array<[number, number]>
  /** Human-readable "why" — required, shown in the inspector. */
  reason: string
}

export interface AgentState {
  id: string
  name: string
  color: string // hex like '#e08a5b'
  x: number     // tile coords, float
  y: number
  homeId: string
  needs: Needs
  action: AgentAction
  /** Per-need decay multipliers drawn once at spawn, ~0.85–1.15. */
  needJitter: Needs
  /** Ticks spent performing current action at the target (not walking). */
  actionTicks: number
  /** Last tick we ran a full re-decide. */
  lastDecideTick: number
  /** Index of next waypoint in action.path. */
  pathIndex: number
  /** Once-per-drop flags for need:critical events. */
  criticalFired: { hunger: boolean; energy: boolean; social: boolean }
  /** Needs snapshot when the current action began (for action:end copy). */
  actionStartNeeds: Needs
  /** Carried goods. */
  inventory: Inventory
  /** Personal coins. */
  wallet: number
  /** Starvation collapse (world rule): slow move, limited restores. */
  collapsed: boolean
  /** Workplace place id, or null if unemployed. */
  employedAt: string | null
  /** Work ticks accrued today at the workplace (wage basis). */
  workedTicks: number
  /** Consecutive calendar days with zero work while employed. */
  daysIdleOnJob: number
  /** Work sub-phase (haul mechanics). */
  workPhase: WorkPhase | null
  /** Units currently hauling (0 if none / fetching empty-handed). */
  haulAmount: number
  /** Good being hauled (null if none). */
  haulGood: Good | null
  /** Place id cargo returns to if haul is abandoned. */
  haulSourceId: string | null
  /** Place id cargo is delivered to while hauling. */
  haulDropoffId: string | null
  /**
   * Sparse sympathy ledger: other agent id → [0,1].
   * Only non-zero entries; observed world fact, never read by UtilityBrain.
   */
  sympathy: Record<string, number>
}

/** Meta attached to a mind-sourced external intent (recorded for replay). */
export interface ExternalIntentMeta {
  reasoning: string
  source: 'luna'
  provider: string
  latencyMs?: number
  approxChars?: number
}

/** One applied mind decision, ordered by tick then agentId (hash / replay source). */
export interface ExternalIntentRecord {
  tick: Tick
  agentId: string
  intent: Intent
  meta: ExternalIntentMeta
}

/** Meta attached to a mind reflection note batch (recorded for replay). */
export interface MindNoteMeta {
  provider: string
  latencyMs?: number
  approxChars?: number
}

/** One applied mind reflection, ordered by tick then agentId (hash / replay source). */
export interface MindNoteRecord {
  tick: Tick
  agentId: string
  notes: string[]
  meta: MindNoteMeta
  /**
   * Distilled world-facts from this night's reflection (v5 additive).
   * Missing on older notes — treat as none.
   */
  learned?: string[]
}

/** One applied conversation utterance (recorded for replay; reason-free — text IS content). */
export interface SayRecord {
  tick: Tick
  conversationId: string
  agentId: string
  partnerId: string
  turn: number
  text: string
  /** True when this utterance ends the conversation. */
  done: boolean
  /**
   * Utterance origin (P3-2c). Optional for v4 backward compat — missing ⇒ luna.
   * 'template' = deterministic sheep reply (no LLM).
   */
  source?: 'luna' | 'template'
}

/** Per-agent mind counters (snapshots / saves; not read by UtilityBrain). */
export interface AgentMindStats {
  decisions: number
  fallbacks: number
  totalLatencyMs: number
  approxChars: number
}

export interface WorldState {
  seed: number
  tick: Tick
  width: number
  height: number
  tiles: Tile[] // row-major, length = width*height
  places: Place[]
  agents: AgentState[]
  /**
   * World-gen preset (v5 additive). Missing on older saves → treat as 'default'.
   */
  preset?: WorldPreset
  /** Village commons wallet. */
  treasury: number
  /** Ownership registry: every place → agent id or 'commons'. */
  owners: Record<string, OwnerId>
  /** Per-sim-hour economy samples. */
  stats: EconomyStat[]
  /**
   * Consecutive stationary-proximity ticks for ordered pair keys `"idA|idB"`
   * (ids sorted). Sparse — only active streaks.
   */
  sympathyStreak: Record<string, number>
  /**
   * Pair keys that shared stationary proximity at least once on the current
   * calendar day (for end-of-day decay). Sparse boolean map.
   */
  sympathyMet: Record<string, true>
  /**
   * Applied external (mind) intents — live = record, re-sim = playback.
   * Part of snapshots, saves, and the state hash.
   */
  externalIntentLog: ExternalIntentRecord[]
  /**
   * Applied mind reflection notes — live = record, re-sim = playback.
   * Part of snapshots, saves, and the state hash (mirrors externalIntentLog).
   */
  mindNoteLog: MindNoteRecord[]
  /**
   * Applied conversation utterances — live = record, re-sim = playback.
   * Part of snapshots, saves, and the state hash.
   */
  sayLog: SayRecord[]
  /** Sparse per-agent mind counters (optional; empty object when none). */
  mindStats: Record<string, AgentMindStats>
  /** Open + closed civic proposals (v5). */
  proposals: Proposal[]
  /**
   * Standing rules registry (v5). Observation/display only — never consulted
   * by action mechanics.
   */
  rules: Rule[]
  /**
   * Per-agent tick until the next commission attempt is accepted (v5 additive).
   * Missing on older saves → treat as none.
   */
  commissionCooldownUntil?: Record<string, number>
  /**
   * Home commission coin fee (v5 additive). Set by worldgen: 30 default/lean,
   * 0 wild. Missing on older saves → 30, or 0 when preset is wild.
   */
  commissionFeeCoins?: number
  /**
   * Last commission-refusal why per agent (v5 additive). Used so the cooldown
   * arms only on a second consecutive identical reason. Missing → none.
   */
  commissionLastRefusal?: Record<string, string>
  /**
   * Last place:blocked collapse key per agent (v5 additive). Consecutive
   * identical blocks (same place + owner + occupant set) do not re-emit.
   * Missing → none.
   */
  placeBlockLast?: Record<string, string>
}

export interface SimEvent {
  seq: number
  tick: Tick
  type: string // 'day:start' | 'action:start' | 'action:end' | 'need:critical' | ...
  agentId?: string
  data?: Record<string, unknown>
  /** Human-readable why. REQUIRED for 'action:start'. */
  reason?: string
}

export interface Observation { self: AgentState; time: SimTime; world: WorldState }

export interface Intent {
  kind: ActionKind
  targetPlaceId?: string
  targetX?: number
  targetY?: number
  reason: string
  /** Proposal text (propose) or public censure text (sanction). */
  text?: string
  /** Proposal id (vote). */
  proposalId?: string
  /** Vote choice. */
  choice?: VoteChoice
  /** Sanction target agent id. */
  targetAgentId?: string
  /** Optional rule id cited by a sanction (display only). */
  ruleId?: string
  /**
   * Commissioned place kind (commission). Missing ⇒ home.
   * May be a non-buildable string — sim refuses with unknown-kind.
   * Additive; old external-intent logs treat as home.
   */
  placeKind?: PlaceKind | string
  /**
   * Public-works payload on a propose intent. Structured — never parsed from
   * `text`. Missing ⇒ rule-only proposal.
   */
  build?: { kind: BuildableKind; x?: number; y?: number }
}

/** THE brain seam. UtilityBrain (Phase 1) and LunaBrain (Phase 3, LLM) both implement this. */
export interface Brain { decide(obs: Observation, rng: Rng): Intent }

export interface Rng {
  next(): number // [0,1)
  int(maxExclusive: number): number
  pick<T>(arr: T[]): T
  getState(): number
  setState(s: number): void
}

/** Zeroed inventory for all known goods. */
export function emptyInventory(): Inventory {
  return { food: 0, wood: 0, stone: 0 }
}

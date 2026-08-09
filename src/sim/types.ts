export type Tick = number // 1 tick = 1 sim minute; 1440 ticks = 1 day

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
}

export type PlaceKind = 'home' | 'berry-bush' | 'well' | 'plaza' | 'farm' | 'stall'

/** Extensible goods union — Phase 2 starts with food only. */
export type Good = 'food'

export type Inventory = Record<Good, number>

/** Place owner: a villager id or the village commons. */
export type OwnerId = string | 'commons'

export interface Place {
  id: string
  kind: PlaceKind
  x: number
  y: number
  /** Concurrent restore / interaction capacity (agents using this place). */
  slots: number
  /** Goods held at this place (bushes, farms, stall stock food here). */
  inventory: Inventory
  /** Farm crop progress 0..1 (only on farms). */
  growth?: number
  /** Open employment seats (workplaces only). */
  jobSlots?: number
  /** Posted daily wage in coins (workplaces only). */
  wage?: number
  /** Posted unit prices (stall only). */
  price?: Partial<Record<Good, number>>
}

/** Hourly economy sample (Dispatch L UI; collected now). */
export interface EconomyStat {
  tick: Tick
  price: number
  stallStock: number
  treasury: number
  employed: number
  meanWallet: number
  minWallet: number
  maxWallet: number
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
  | 'work'
  | 'buy'

/** Mid-work farm haul phases (mechanical, not a brain script). */
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
  /** Farm work sub-phase (haul mechanics). */
  workPhase: WorkPhase | null
  /** Food units currently hauling farm→stall (0 if none). */
  haulAmount: number
}

export interface WorldState {
  seed: number
  tick: Tick
  width: number
  height: number
  tiles: Tile[] // row-major, length = width*height
  places: Place[]
  agents: AgentState[]
  /** Village commons wallet. */
  treasury: number
  /** Ownership registry: every place → agent id or 'commons'. */
  owners: Record<string, OwnerId>
  /** Per-sim-hour economy samples. */
  stats: EconomyStat[]
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

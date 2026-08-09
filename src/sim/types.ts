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

export type PlaceKind = 'home' | 'berry-bush' | 'well' | 'plaza'

export interface Place { id: string; kind: PlaceKind; x: number; y: number; ownerId?: string }

/** All needs 0..1, where 1 = fully satisfied. */
export interface Needs { hunger: number; energy: number; social: number }

export type ActionKind = 'idle' | 'walk' | 'sleep' | 'eat' | 'drink' | 'socialize' | 'wander'

export interface AgentAction {
  kind: ActionKind
  targetPlaceId?: string
  /** Tile target for wander (and resolved destinations). */
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
}

export interface WorldState {
  seed: number
  tick: Tick
  width: number
  height: number
  tiles: Tile[] // row-major, length = width*height
  places: Place[]
  agents: AgentState[]
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

export type Tick = number // 1 tick = 1 sim minute; 1440 ticks = 1 day

export interface SimTime { day: number; hour: number; minute: number; tick: Tick }

export type TerrainKind = 'water' | 'sand' | 'grass' | 'forest' | 'rock'

export interface Tile { x: number; y: number; kind: TerrainKind; walkable: boolean; elevation: number }

export type PlaceKind = 'home' | 'berry-bush' | 'well' | 'plaza'

export interface Place { id: string; kind: PlaceKind; x: number; y: number; ownerId?: string }

/** All needs 0..1, where 1 = fully satisfied. */
export interface Needs { hunger: number; energy: number; social: number }

export type ActionKind = 'idle' | 'walk' | 'sleep' | 'eat' | 'drink' | 'socialize' | 'wander'

export interface AgentAction {
  kind: ActionKind
  targetPlaceId?: string
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

export interface Intent { kind: ActionKind; targetPlaceId?: string; reason: string }

/** THE brain seam. UtilityBrain (Phase 1) and LunaBrain (Phase 3, LLM) both implement this. */
export interface Brain { decide(obs: Observation, rng: Rng): Intent }

export interface Rng {
  next(): number // [0,1)
  int(maxExclusive: number): number
  pick<T>(arr: T[]): T
  getState(): number
  setState(s: number): void
}

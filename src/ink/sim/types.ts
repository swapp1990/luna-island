import type { Rng } from '../../sim/types'
import type { DayName, DayNameLong } from './config'

export type PlaceId = 'home-a' | 'home-b' | 'market' | 'center' | 'work'
export type HomeId = 'home-a' | 'home-b'
export type MindId = 'A' | 'B'

export type ActionKind =
  | 'go_home'
  | 'go_work'
  | 'go_market'
  | 'go_center'
  | 'sleep'
  | 'eat'
  | 'buy'
  | 'work'
  | 'socialize'
  | 'wait'

export type Action = ActionKind

export type IntentSource = 'rule' | 'llm' | 'fallback'

export interface Vec2 {
  x: number
  y: number
}

export interface Intent {
  action: ActionKind
  count?: number
  reason: string
}

export interface Mind {
  id: MindId
  name: string
  home: PlaceId
  at: PlaceId | null
  pos: Vec2
  path: Vec2[]
  hunger: number
  energy: number
  social: number
  money: number
  busyUntilTick: number
  asleep: boolean
  current: Intent | null
  sufferedHours: number
}

export interface InkState {
  tick: number
  seed: number
  minds: [Mind, Mind]
  fridges: Record<HomeId, number>
  seq: number
}

export interface PlaceDef {
  id: PlaceId
  label: string
  rect: { x: number; y: number; w: number; h: number }
  door: Vec2
}

export interface Observation {
  tick: number
  day: number
  dayName: DayName
  dayNameLong: DayNameLong
  hour: number
  minute: number
  isWeekend: boolean
  isNight: boolean
  marketOpen: boolean
  workOpen: boolean
  self: {
    id: MindId
    name: string
    home: PlaceId
    at: PlaceId | null
    pos: Vec2
    walking: boolean
    walkingTo: PlaceId | null
    walkMinutes: number | null
    hunger: number
    energy: number
    social: number
    money: number
    fridge: number
    asleep: boolean
    busy: boolean
    current: Intent | null
    sufferedHours: number
  }
  other: {
    id: MindId
    name: string
    at: PlaceId | null
    walking: boolean
    walkingTo: PlaceId | null
    walkMinutes: number | null
    hunger: number
    energy: number
    social: number
  }
  facts: string[]
}

export interface InkBrain {
  /** Called at each hour boundary. May return null to mean "nothing new" (keep going). */
  decide(obs: Observation, rng: Rng): Intent | null
}

export type InkBrains = { A: InkBrain; B: InkBrain }

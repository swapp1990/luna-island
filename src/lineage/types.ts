import type { Rng } from '../sim/types'

export type Room = 'fields' | 'woods' | 'hall' | 'homes' | 'road'
export type Turn = 0 | 1 | 2 | 3
export type Allele = 0 | 1

export interface Genome {
  a: Allele[]
  b: Allele[]
}

export type TraitName =
  | 'metabolism'
  | 'stamina'
  | 'sociability'
  | 'industry'
  | 'generosity'
  | 'voice'
  | 'thrift'
  | 'curiosity'
  | 'temper'
  | 'loyalty'
  | 'boldness'
  | 'caution'

export type Traits = Record<TraitName, number>
export type Band = 'low' | 'mid' | 'high'
export type LocusMode = 'additive' | 'dominant' | 'recessive'

export const TRAIT_NAMES: readonly TraitName[] = [
  'metabolism',
  'stamina',
  'sociability',
  'industry',
  'generosity',
  'voice',
  'thrift',
  'curiosity',
  'temper',
  'loyalty',
  'boldness',
  'caution',
] as const

export const TRAIT_ORDER = TRAIT_NAMES

export const TURN_NAMES: readonly ['dawn', 'noon', 'dusk', 'night'] = [
  'dawn',
  'noon',
  'dusk',
  'night',
]

export const CONSTITUTION_TRAITS: readonly TraitName[] = [
  'metabolism',
  'stamina',
  'sociability',
  'industry',
]

export const DISPOSITION_TRAITS: readonly TraitName[] = [
  'generosity',
  'voice',
  'thrift',
  'curiosity',
  'temper',
  'loyalty',
  'boldness',
  'caution',
]

export interface Villager {
  id: string
  givenName: string
  surname: string
  generation: number
  parents: [string, string] | null
  genome: Genome
  traits: Traits
  satiety: number
  energy: number
  companionship: number
  grain: number
  standing: number
  room: Room
  starvingTurns: number
  status: 'alive' | 'departed'
  courted: string[]
  talkedWith: Record<string, number>
}

export type RuleId = 'granary-open' | 'granary-closed' | 'ration-granary'

export interface Proposal {
  id: string
  rule: RuleId
  by: string
  text: string
  openedTick: number
  votes: Record<string, 'for' | 'against'>
  resolved?: 'adopted' | 'rejected'
}

export interface LineageConfig {
  seed: number
  cohortSize: number
  daysPerSeason: number
  turnsPerDay: number
  seasons: number
  harvestYield: number
  mutationRate: number
  mating: 'courtship' | 'random'
  granaryStart: number
}

export const DEFAULT_CONFIG: LineageConfig = {
  seed: 42,
  cohortSize: 12,
  daysPerSeason: 10,
  turnsPerDay: 4,
  seasons: 8,
  // 0.5, not 1.0: at ≥ 0.6 nobody ever starves (granary rescues all) and there is no
  // selection to observe. At 0.5 ≈ 15 of 96 villager-seasons leave hungry and metabolism
  // drops ~0.15 over 8 generations in both mating arms (n=40 seeds). See plans/lineage.md §6.
  harvestYield: 0.5,
  mutationRate: 0.01,
  mating: 'courtship',
  granaryStart: 6,
}

export interface LineageRecord {
  id: string
  givenName: string
  surname: string
  generation: number
  parents: [string, string] | null
  genome: Genome
  traits: Traits
  fitness?: number
  departedReason?: string
}

export interface LineageState {
  config: LineageConfig
  tick: number
  season: number
  day: number
  turn: Turn
  villagers: Villager[]
  granary: number
  rules: RuleId[]
  proposals: Proposal[]
  lineage: LineageRecord[]
  granaryTakenToday: Record<string, number>
}

export type LineageActKind =
  | 'work'
  | 'forage'
  | 'rest'
  | 'eat'
  | 'store'
  | 'withdraw'
  | 'give'
  | 'talk'
  | 'court'
  | 'propose'
  | 'vote'
  | 'shun'
  | 'idle'

export interface LineageIntent {
  kind: LineageActKind
  target?: string
  amount?: number
  text?: string
  rule?: RuleId
  proposalId?: string
  choice?: 'for' | 'against'
  reason: string
}

export interface LineageObservation {
  self: Villager
  others: Villager[]
  state: LineageState
  facts: string[]
}

export interface LineageBrain {
  decide(obs: LineageObservation, rng: Rng): LineageIntent
}

export type BrainFactory = (v: Villager) => LineageBrain

export interface LineageSummary {
  config: LineageConfig
  seasons: number
  generationsBorn: number
  departuresByStarvation: number
  traitMeansByGeneration: Record<TraitName, number[]>
  traitVarByGeneration: Record<TraitName, number[]>
  hash: string
  eventCount: number
}

export const STARVE_DEPART_REASON = 'left for the coast after four starving turns'
export const SEASON_DEPART_REASON = 'season ended; the elders leave for the coast'

export function villagerNum(id: string): number {
  const n = Number(id.slice(2))
  return Number.isFinite(n) ? n : 0
}

export function compareVillagerId(a: string, b: string): number {
  return villagerNum(a) - villagerNum(b)
}

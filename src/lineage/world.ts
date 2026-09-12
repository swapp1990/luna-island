import { createRng } from '../sim/rng'
import { EventTrace } from '../sim/events'
import type { Rng } from '../sim/types'
import { randomGenome, traitsOf } from './genome'
import type {
  LineageConfig,
  LineageRecord,
  LineageState,
  RuleId,
  Villager,
} from './types'
import { DEFAULT_CONFIG, villagerNum } from './types'

export const GIVEN_NAMES: readonly string[] = [
  'Tal', 'Bel', 'Mira', 'Ko', 'Ren', 'Ash', 'Nia', 'Bo', 'Cal', 'Dew',
  'Eve', 'Fay', 'Gil', 'Hana', 'Ira', 'Joss', 'Kai', 'Len', 'Mae', 'Ned',
  'Ora', 'Pia', 'Quin', 'Rel', 'Sif', 'Tess', 'Ula', 'Val', 'Wynn', 'Xan',
  'Yue', 'Zed', 'Arin', 'Bren', 'Cora', 'Dax', 'Elin', 'Fern', 'Goss', 'Heli',
  'Ivo', 'Juna',
]

export const SURNAMES: readonly string[] = [
  'Mirason', 'Belden', 'Ashen', 'Reed', 'Vale', 'Thorn', 'Quill', 'Wren',
  'Moss', 'Pike', 'Stone', 'Lark', 'Frost', 'Ember', 'Brook', 'Sage',
  'Flint', 'Rowan', 'Pell', 'Dorr', 'Kestrel', 'Noll',
]

export function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function mergeConfig(partial: Partial<LineageConfig> = {}): LineageConfig {
  return { ...DEFAULT_CONFIG, ...partial }
}

export function livingVillagers(state: LineageState): Villager[] {
  return state.villagers
    .filter((v) => v.status === 'alive')
    .sort((a, b) => villagerNum(a.id) - villagerNum(b.id))
}

export function hasRule(state: LineageState, rule: RuleId): boolean {
  return state.rules.includes(rule)
}

export function addRule(state: LineageState, rule: RuleId): void {
  if (!state.rules.includes(rule)) state.rules.push(rule)
  state.rules.sort()
}

export function removeRule(state: LineageState, rule: RuleId): void {
  state.rules = state.rules.filter((r) => r !== rule)
}

export function findVillager(state: LineageState, id: string): Villager | undefined {
  return state.villagers.find((v) => v.id === id)
}

export function findRecord(state: LineageState, id: string): LineageRecord | undefined {
  return state.lineage.find((r) => r.id === id)
}

export const livingOf = livingVillagers
export const recordOf = findRecord

export function emit(
  events: EventTrace,
  tick: number,
  type: string,
  extra?: { agentId?: string; data?: Record<string, unknown>; reason?: string },
) {
  return events.append({
    tick,
    type,
    agentId: extra?.agentId,
    data: extra?.data,
    reason: extra?.reason,
  })
}

export function spawnVillager(
  id: string,
  givenName: string,
  surname: string,
  generation: number,
  parents: [string, string] | null,
  genome: ReturnType<typeof randomGenome>,
): Villager {
  return makeVillager({ id, givenName, surname, generation, parents, genome })
}

export function nextVillagerId(state: LineageState): string {
  return `v-${state.lineage.length}`
}

export function fullName(v: { givenName: string; surname: string }): string {
  return `${v.givenName} ${v.surname}`
}

export function grain1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

function toRecord(v: Villager): LineageRecord {
  return {
    id: v.id,
    givenName: v.givenName,
    surname: v.surname,
    generation: v.generation,
    parents: v.parents,
    genome: { a: v.genome.a.slice(), b: v.genome.b.slice() },
    traits: { ...v.traits },
  }
}

export function makeVillager(args: {
  id: string
  givenName: string
  surname: string
  generation: number
  parents: [string, string] | null
  genome: ReturnType<typeof randomGenome>
}): Villager {
  return {
    id: args.id,
    givenName: args.givenName,
    surname: args.surname,
    generation: args.generation,
    parents: args.parents,
    genome: args.genome,
    traits: traitsOf(args.genome),
    satiety: 0.8,
    energy: 0.8,
    companionship: 0.8,
    grain: 2,
    standing: 0,
    room: 'road',
    starvingTurns: 0,
    status: 'alive',
    courted: [],
    talkedWith: {},
  }
}

export function createHamlet(
  config: LineageConfig,
  rng: Rng = createRng(config.seed),
  events: EventTrace = new EventTrace(),
): LineageState {
  const cfg = mergeConfig(config)
  const state: LineageState = {
    config: { ...cfg },
    tick: 0,
    season: 0,
    day: 0,
    turn: 0,
    villagers: [],
    granary: cfg.granaryStart,
    rules: ['granary-open'],
    proposals: [],
    lineage: [],
    granaryTakenToday: {},
  }

  for (let i = 0; i < cfg.cohortSize; i++) {
    const genome = randomGenome(rng)
    const v = makeVillager({
      id: `v-${i}`,
      givenName: rng.pick(GIVEN_NAMES as string[]),
      surname: rng.pick(SURNAMES as string[]),
      generation: 0,
      parents: null,
      genome,
    })
    state.villagers.push(v)
    state.lineage.push(toRecord(v))
  }

  events.append({
    tick: 0,
    type: 'season:start',
    data: { season: 0, generation: 0 },
  })
  events.append({
    tick: 0,
    type: 'day:start',
    data: { day: 0 },
  })

  return state
}

export { toRecord, toRecord as makeRecord }

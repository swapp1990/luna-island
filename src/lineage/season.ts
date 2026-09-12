import type { EventTrace } from '../sim/events'
import type { Rng } from '../sim/types'
import { offspringGenome } from './genome'
import type { LineageState, Villager } from './types'
import { villagerNum } from './types'
import {
  emit,
  GIVEN_NAMES,
  livingOf,
  makeRecord,
  nextVillagerId,
  recordOf,
  spawnVillager,
} from './world'

interface Pair {
  p1: Villager
  p2: Villager
  weight: number
  sampling: number
  key: string
}

function pairKey(a: string, b: string): string {
  return villagerNum(a) <= villagerNum(b) ? `${a}|${b}` : `${b}|${a}`
}

function fitnessOf(v: Villager): number {
  if (v.status !== 'alive') return 0
  return Math.max(0, 1 + 0.1 * v.grain + 0.2 * v.standing)
}

function writeFitness(state: LineageState): void {
  for (const v of state.villagers) {
    const f = fitnessOf(v)
    const rec = recordOf(state, v.id)
    if (rec) rec.fitness = f
  }
}

function courtshipPairs(living: Villager[]): Pair[] {
  const pairs: Pair[] = []
  const used = new Set<string>()
  for (const a of living) {
    for (const otherId of a.courted) {
      const b = living.find((v) => v.id === otherId)
      if (!b) continue
      if (!b.courted.includes(a.id)) continue
      const key = pairKey(a.id, b.id)
      if (used.has(key)) continue
      used.add(key)
      const p1 = villagerNum(a.id) <= villagerNum(b.id) ? a : b
      const p2 = p1 === a ? b : a
      const weight = 2
      pairs.push({
        p1,
        p2,
        weight,
        sampling: weight * (fitnessOf(p1) + fitnessOf(p2)),
        key,
      })
    }
  }

  const inMutual = new Set<string>()
  for (const p of pairs) {
    inMutual.add(p.p1.id)
    inMutual.add(p.p2.id)
  }
  const rest = living.filter((v) => !inMutual.has(v.id))
  rest.sort((a, b) => {
    const fa = fitnessOf(a)
    const fb = fitnessOf(b)
    if (fb !== fa) return fb - fa
    return villagerNum(a.id) - villagerNum(b.id)
  })
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const p1 = rest[i]!
    const p2 = rest[i + 1]!
    const weight = 1
    pairs.push({
      p1,
      p2,
      weight,
      sampling: weight * (fitnessOf(p1) + fitnessOf(p2)),
      key: pairKey(p1.id, p2.id),
    })
  }
  return pairs
}

function samplePair(pairs: Pair[], rng: Rng): Pair {
  let total = 0
  for (const p of pairs) total += p.sampling
  let r = rng.next() * total
  for (const p of pairs) {
    r -= p.sampling
    if (r < 0) return p
  }
  return pairs[pairs.length - 1]!
}

function pickTwoLiving(living: Villager[], rng: Rng): { p1: Villager; p2: Villager } {
  const i = rng.int(living.length)
  let j = rng.int(living.length - 1)
  if (j >= i) j += 1
  return { p1: living[i]!, p2: living[j]! }
}

function surnameOfParents(p1: Villager, p2: Villager): string {
  if (p1.standing !== p2.standing) {
    return p1.standing > p2.standing ? p1.surname : p2.surname
  }
  return villagerNum(p1.id) <= villagerNum(p2.id) ? p1.surname : p2.surname
}

const SEASON_LEAVE = 'season ended; the elders leave for the coast'

/** Returns true if the hamlet is extinct. */
export function endSeason(state: LineageState, rng: Rng, events: EventTrace): boolean {
  writeFitness(state)
  const living = livingOf(state)
  if (living.length < 2) {
    emit(events, state.tick, 'season:extinct', {
      data: { season: state.season, living: living.length },
    })
    return true
  }

  const courtship = state.config.mating === 'courtship'
  const pool = courtship ? courtshipPairs(living) : []
  if (courtship && pool.length === 0) {
    emit(events, state.tick, 'season:extinct', {
      data: { season: state.season, living: living.length },
    })
    return true
  }

  const born: Villager[] = []
  const used = new Set<string>()
  const k = state.config.cohortSize
  for (let i = 0; i < k; i++) {
    let p1: Villager
    let p2: Villager
    let weight: number | undefined
    if (courtship) {
      const pair = samplePair(pool, rng)
      p1 = pair.p1
      p2 = pair.p2
      weight = pair.weight
      if (!used.has(pair.key)) {
        used.add(pair.key)
        emit(events, state.tick, 'lineage:pair', {
          data: { p1: p1.id, p2: p2.id, weight },
        })
      }
    } else {
      const picked = pickTwoLiving(living, rng)
      p1 = picked.p1
      p2 = picked.p2
      const key = pairKey(p1.id, p2.id)
      if (!used.has(key)) {
        used.add(key)
        emit(events, state.tick, 'lineage:pair', {
          data: { p1: p1.id, p2: p2.id, weight: 1 },
        })
      }
    }
    const genome = offspringGenome(p1.genome, p2.genome, state.config.mutationRate, rng)
    const child = spawnVillager(
      nextVillagerId(state),
      rng.pick(GIVEN_NAMES as string[]),
      surnameOfParents(p1, p2),
      Math.max(p1.generation, p2.generation) + 1,
      [p1.id, p2.id],
      genome,
    )
    state.lineage.push(makeRecord(child))
    emit(events, state.tick, 'lineage:born', {
      agentId: child.id,
      data: { id: child.id, parents: child.parents, generation: child.generation },
    })
    born.push(child)
  }

  for (const v of livingOf(state)) {
    v.status = 'departed'
    const rec = recordOf(state, v.id)
    if (rec) rec.departedReason = SEASON_LEAVE
    emit(events, state.tick, 'villager:departed', {
      agentId: v.id,
      reason: SEASON_LEAVE,
      data: { reason: SEASON_LEAVE },
    })
  }

  const generation = born[0]?.generation ?? state.season + 1
  emit(events, state.tick, 'generation:turnover', {
    data: { season: state.season, generation, born: born.length },
  })

  state.villagers = born
  state.season += 1
  state.day = 0
  state.turn = 0
  state.granaryTakenToday = {}
  emit(events, state.tick, 'season:start', {
    data: { season: state.season, generation },
  })
  emit(events, state.tick, 'lineage:arrive', {
    data: { ids: born.map((v) => v.id) },
  })
  emit(events, state.tick, 'day:start', {
    data: { season: state.season, day: 0 },
  })
  return false
}

export { SEASON_LEAVE }

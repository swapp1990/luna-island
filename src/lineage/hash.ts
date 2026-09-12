import { villagerNum, type LineageState } from './types'

/** Deterministic JSON with sorted object keys (recursive). Same spirit as src/sim. */
function stringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return 'null'
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'undefined') return 'null'
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v)).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'undefined') continue
      parts.push(JSON.stringify(k) + ':' + stringify(v))
    }
    return '{' + parts.join(',') + '}'
  }
  return 'null'
}

/** FNV-1a 32-bit hash → lowercase hex. */
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function canonicalState(state: LineageState): unknown {
  const villagers = state.villagers
    .slice()
    .sort((a, b) => villagerNum(a.id) - villagerNum(b.id))
    .map((v) => ({
      id: v.id,
      givenName: v.givenName,
      surname: v.surname,
      generation: v.generation,
      parents: v.parents,
      genome: { a: v.genome.a.slice(), b: v.genome.b.slice() },
      traits: { ...v.traits },
      satiety: v.satiety,
      energy: v.energy,
      companionship: v.companionship,
      grain: v.grain,
      standing: v.standing,
      room: v.room,
      starvingTurns: v.starvingTurns,
      status: v.status,
      courted: v.courted.slice(),
      talkedWith: { ...v.talkedWith },
    }))
  const lineage = state.lineage.map((r) => ({
    id: r.id,
    givenName: r.givenName,
    surname: r.surname,
    generation: r.generation,
    parents: r.parents,
    genome: { a: r.genome.a.slice(), b: r.genome.b.slice() },
    traits: { ...r.traits },
    fitness: r.fitness,
    departedReason: r.departedReason,
  }))
  return {
    config: { ...state.config },
    tick: state.tick,
    season: state.season,
    day: state.day,
    turn: state.turn,
    villagers,
    granary: state.granary,
    rules: state.rules.slice().sort(),
    proposals: state.proposals.map((p) => ({
      id: p.id,
      rule: p.rule,
      by: p.by,
      text: p.text,
      openedTick: p.openedTick,
      votes: { ...p.votes },
      resolved: p.resolved,
    })),
    lineage,
    granaryTakenToday: { ...state.granaryTakenToday },
  }
}

export const idNum = villagerNum

export function lineageHash(state: LineageState): string {
  return fnv1aHex(stringify(canonicalState(state)))
}

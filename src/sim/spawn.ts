import { isWalkable } from './pathfind'
import type { AgentState, Place, Rng, WorldState } from './types'

/** Home tile + 8 neighbors — same order as bed slots in spots.ts. */
const HOME_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export const AGENT_NAMES = [
  'Mira',
  'Joss',
  'Tama',
  'Ren',
  'Ode',
  'Pia',
  'Bram',
  'Sela',
  'Nook',
  'Vero',
  'Ansel',
  'Wren',
  'Kiba',
  'Lumo',
  'Etta',
  'Faro',
  'Gale',
  'Hollis',
  'Ines',
  'Juno',
  'Kes',
  'Lark',
  'Moss',
  'Nia',
] as const

/** Fixed palette, index % 12 — no rng jitter. */
export const AGENT_COLORS = [
  '#e07a5f',
  '#81b29a',
  '#f2cc8f',
  '#6d9dc5',
  '#c98bb9',
  '#e3a857',
  '#7fb069',
  '#d95d67',
  '#8e7dbe',
  '#56a3a6',
  '#f4a259',
  '#a26769',
] as const

function needInRange(rng: Rng): number {
  // [0.6, 0.9]
  return 0.6 + rng.next() * 0.3
}

function jitterFactor(rng: Rng): number {
  // ±15% → [0.85, 1.15]
  return 0.85 + rng.next() * 0.3
}

/**
 * Spawns 24 agents onto `world.agents` using the sim rng.
 * Homes are round-robined; agents start at their home tile.
 */
export function spawnAgents(world: WorldState, rng: Rng): void {
  const homes = world.places.filter((p): p is Place => p.kind === 'home')
  if (homes.length === 0) {
    world.agents = []
    return
  }

  // Resident index per home (spawn order) for distinct standing tiles
  const homeResidentCount = new Map<string, number>()

  const agents: AgentState[] = []
  for (let i = 0; i < AGENT_NAMES.length; i++) {
    const home = homes[i % homes.length]!
    const residentIdx = homeResidentCount.get(home.id) ?? 0
    homeResidentCount.set(home.id, residentIdx + 1)

    // Distinct bed/spawn slots so shared-home residents don't stack
    let sx = home.x
    let sy = home.y
    const slots: Array<[number, number]> = []
    for (const [dx, dy] of HOME_OFFSETS) {
      const x = home.x + dx
      const y = home.y + dy
      if (isWalkable(world, x, y)) slots.push([x, y])
    }
    if (slots.length > 0) {
      const slot = slots[residentIdx % slots.length]!
      sx = slot[0]
      sy = slot[1]
    }

    const hunger = needInRange(rng)
    const energy = needInRange(rng)
    const social = needInRange(rng)
    const needs = { hunger, energy, social }
    agents.push({
      id: `agent-${i}`,
      name: AGENT_NAMES[i]!,
      color: AGENT_COLORS[i % AGENT_COLORS.length]!,
      x: sx,
      y: sy,
      homeId: home.id,
      needs: { ...needs },
      action: { kind: 'idle', reason: 'Just woke up on the island' },
      needJitter: {
        hunger: jitterFactor(rng),
        energy: jitterFactor(rng),
        social: jitterFactor(rng),
      },
      actionTicks: 0,
      lastDecideTick: 0,
      pathIndex: 0,
      criticalFired: { hunger: false, energy: false, social: false },
      actionStartNeeds: { ...needs },
    })
  }
  world.agents = agents
}

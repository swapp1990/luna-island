import type { AgentState, Place, Rng, WorldState } from './types'

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

  const agents: AgentState[] = []
  for (let i = 0; i < AGENT_NAMES.length; i++) {
    const home = homes[i % homes.length]!
    const hunger = needInRange(rng)
    const energy = needInRange(rng)
    const social = needInRange(rng)
    const needs = { hunger, energy, social }
    agents.push({
      id: `agent-${i}`,
      name: AGENT_NAMES[i]!,
      color: AGENT_COLORS[i % AGENT_COLORS.length]!,
      x: home.x,
      y: home.y,
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

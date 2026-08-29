import { firstStormObjectives, secureFood } from './firstStorm'
import { isWalkable } from './pathfind'
import { AGENT_NAMES, makeAgent } from './spawn'
import type {
  AgentState,
  BuildableKind,
  Rng,
  TownGrowthState,
  TownMilestoneId,
  WorldState,
} from './types'

export interface AppealComponent {
  id: 'housing' | 'food' | 'work' | 'water' | 'safety' | 'civic'
  label: string
  score: number
  max: number
  detail: string
}

export interface TownMilestone {
  id: TownMilestoneId
  label: string
  threshold: number
  unlock: string
}

export interface InvitationCandidate {
  id: string
  name: string
  promise: string
  preferredWork: string
}

export interface InvitationOffer {
  tier: number
  threshold: number
  candidates: [InvitationCandidate, InvitationCandidate]
}

export const TOWN_MILESTONES: readonly TownMilestone[] = [
  { id: 'camp', label: 'Camp', threshold: 0, unlock: 'Homes, farms, wells, and paths' },
  { id: 'hamlet', label: 'Hamlet', threshold: 55, unlock: 'Forestry, quarry, and storehouse construction' },
  { id: 'village', label: 'Village', threshold: 70, unlock: 'Market, notice board, and first invitation' },
  { id: 'town', label: 'Town', threshold: 85, unlock: 'Building upgrades and a second invitation' },
  { id: 'sanctuary', label: 'Sanctuary', threshold: 95, unlock: 'A third Luna invitation' },
] as const

const INVITATION_TIERS: readonly {
  threshold: number
  candidates: readonly [InvitationCandidate, InvitationCandidate]
}[] = [
  {
    threshold: 70,
    candidates: [
      { id: 'agent-0', name: 'Mira', promise: 'Frugal market keeper who hates waste', preferredWork: 'Market and trade' },
      { id: 'agent-1', name: 'Joss', promise: 'Generous neighbor who protects shared time', preferredWork: 'Food and plaza life' },
    ],
  },
  {
    threshold: 85,
    candidates: [
      { id: 'agent-2', name: 'Tama', promise: 'Story keeper who remembers the town', preferredWork: 'Notice board and civic life' },
      { id: 'agent-3', name: 'Ren', promise: 'Organizer who names problems and starts fixes', preferredWork: 'Building and public works' },
    ],
  },
  {
    threshold: 95,
    candidates: [
      { id: 'agent-4', name: 'Ode', promise: 'Restless craftsperson who wants lasting work', preferredWork: 'Forestry and construction' },
      { id: 'agent-5', name: 'Pia', promise: 'Reformer attentive to who gets left out', preferredWork: 'Civic work and services' },
    ],
  },
] as const

const STARTER_KINDS = new Set<BuildableKind>(['home', 'farm', 'well'])
const HAMLET_KINDS = new Set<BuildableKind>(['forestry', 'quarry', 'storehouse'])
const VILLAGE_KINDS = new Set<BuildableKind>(['stall', 'notice-board'])

function rounded(part: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(part)))
}

export function appealComponents(world: WorldState): AppealComponent[] {
  const population = Math.max(1, world.agents.length)
  const homeSlots = world.places
    .filter((place) => place.kind === 'home')
    .reduce((sum, place) => sum + Math.max(0, place.slots), 0)
  const housed = world.agents.filter((agent) => !!agent.homeId).length
  const foodDays = secureFood(world) / population
  const employed = world.agents.filter((agent) => !!agent.employedAt).length
  const jobSeats = world.places.reduce((sum, place) => sum + Math.max(0, place.jobSlots ?? 0), 0)
  const workReady = Math.min(population, Math.max(employed, jobSeats))
  const wells = world.places.filter((place) => place.kind === 'well').length
  const boards = world.places.filter((place) => place.kind === 'notice-board').length
  const markets = world.places.filter((place) => place.kind === 'stall').length
  const plazas = world.places.filter((place) => place.kind === 'plaza').length
  const activeRules = world.rules.filter((rule) => rule.active).length
  const scenario = world.scenario
  const prepared = scenario?.kind === 'first-storm'
    ? firstStormObjectives(world).filter((objective) => objective.met).length
    : 3
  const safetyScore = scenario?.kind !== 'first-storm'
    ? 15
    : scenario.status === 'survived'
      ? 15
      : scenario.status === 'failed'
        ? 0
        : rounded((prepared / 3) * 6, 6)

  return [
    {
      id: 'housing', label: 'Housing', max: 25,
      score: rounded((housed / population) * 25, 25),
      detail: `${housed}/${population} residents housed (${homeSlots} beds)`,
    },
    {
      id: 'food', label: 'Food reserve', max: 20,
      score: rounded((foodDays / 5) * 20, 20),
      detail: `${foodDays.toFixed(1)} days stored`,
    },
    {
      id: 'work', label: 'Work opportunity', max: 15,
      score: rounded((workReady / population) * 15, 15),
      detail: `${employed} working, ${jobSeats} seats`,
    },
    {
      id: 'water', label: 'Water access', max: 15,
      score: wells > 0 ? 15 : 0,
      detail: wells > 0 ? `${wells} sheltered well${wells === 1 ? '' : 's'}` : 'No sheltered well',
    },
    {
      id: 'safety', label: 'Safety', max: 15,
      score: safetyScore,
      detail: scenario?.kind === 'first-storm'
        ? scenario.status === 'survived'
          ? 'First storm survived'
          : scenario.status === 'failed'
            ? 'Storm promises failed'
            : `${prepared}/3 storm promises ready`
        : 'No active settlement threat',
    },
    {
      id: 'civic', label: 'Social and civic', max: 10,
      score: rounded(plazas * 2 + markets * 2 + boards * 4 + Math.min(2, activeRules), 10),
      detail: `${plazas} plaza, ${markets} market, ${boards} board`,
    },
  ]
}

export function townAppeal(world: WorldState): number {
  return appealComponents(world).reduce((sum, component) => sum + component.score, 0)
}

export function ensureTownGrowth(world: WorldState): TownGrowthState {
  if (!world.townGrowth) {
    world.townGrowth = {
      unlockedMilestoneIds: ['camp'],
      resolvedInvitationTiers: [],
      acceptedAgentIds: [],
    }
  }
  if (!world.townGrowth.unlockedMilestoneIds.includes('camp')) {
    world.townGrowth.unlockedMilestoneIds.unshift('camp')
  }
  return world.townGrowth
}

/** Permanently records newly reached milestones and returns them for event emission. */
export function syncTownGrowth(world: WorldState): TownMilestone[] {
  const state = ensureTownGrowth(world)
  const appeal = townAppeal(world)
  const reached: TownMilestone[] = []
  for (const milestone of TOWN_MILESTONES) {
    if (appeal < milestone.threshold || state.unlockedMilestoneIds.includes(milestone.id)) continue
    state.unlockedMilestoneIds.push(milestone.id)
    reached.push(milestone)
  }
  return reached
}

export function currentMilestone(world: WorldState): TownMilestone {
  const unlocked = new Set(ensureTownGrowth(world).unlockedMilestoneIds)
  return TOWN_MILESTONES.filter((milestone) => unlocked.has(milestone.id)).at(-1) ?? TOWN_MILESTONES[0]!
}

export function nextMilestone(world: WorldState): TownMilestone | null {
  const unlocked = new Set(ensureTownGrowth(world).unlockedMilestoneIds)
  return TOWN_MILESTONES.find((milestone) => !unlocked.has(milestone.id)) ?? null
}

export function isBuildUnlocked(world: WorldState, kind: BuildableKind): boolean {
  if (world.scenario?.kind !== 'first-storm') return true
  const unlocked = new Set(ensureTownGrowth(world).unlockedMilestoneIds)
  if (STARTER_KINDS.has(kind)) return true
  if (HAMLET_KINDS.has(kind)) return unlocked.has('hamlet')
  if (VILLAGE_KINDS.has(kind)) return unlocked.has('village')
  return false
}

export function buildUnlockLabel(kind: BuildableKind): string | null {
  if (STARTER_KINDS.has(kind)) return null
  if (HAMLET_KINDS.has(kind)) return 'Hamlet - 55 Appeal'
  if (VILLAGE_KINDS.has(kind)) return 'Village - 70 Appeal'
  return null
}

export function upgradesUnlocked(world: WorldState): boolean {
  if (world.scenario?.kind !== 'first-storm') return true
  return ensureTownGrowth(world).unlockedMilestoneIds.includes('town')
}

function invitationSafetyReady(world: WorldState): boolean {
  return world.scenario?.kind !== 'first-storm' || world.scenario.status === 'survived'
}

export function availableInvitation(world: WorldState): InvitationOffer | null {
  const state = ensureTownGrowth(world)
  if (!invitationSafetyReady(world)) return null
  const appeal = townAppeal(world)
  for (let tier = 0; tier < INVITATION_TIERS.length; tier++) {
    const row = INVITATION_TIERS[tier]!
    if (appeal < row.threshold || state.resolvedInvitationTiers.includes(tier)) continue
    return { tier, threshold: row.threshold, candidates: [...row.candidates] as [InvitationCandidate, InvitationCandidate] }
  }
  return null
}

function openHome(world: WorldState): string {
  const occupied = new Map<string, number>()
  for (const agent of world.agents) {
    if (agent.homeId) occupied.set(agent.homeId, (occupied.get(agent.homeId) ?? 0) + 1)
  }
  return world.places
    .filter((place) => place.kind === 'home')
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((home) => (occupied.get(home.id) ?? 0) < home.slots)?.id ?? ''
}

function arrivalSpot(world: WorldState): [number, number] | null {
  const plaza = world.places.find((place) => place.kind === 'plaza')
  if (!plaza) return null
  const occupied = new Set(world.agents.map((agent) => `${Math.round(agent.x)},${Math.round(agent.y)}`))
  for (let radius = 1; radius <= 12; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const x = plaza.x + dx
        const y = plaza.y + dy
        if (!isWalkable(world, x, y) || occupied.has(`${x},${y}`)) continue
        return [x, y]
      }
    }
  }
  return null
}

export type AcceptInvitationResult =
  | { ok: true; agent: AgentState; tier: number }
  | { ok: false; reason: 'no-invitation' | 'candidate-unavailable' | 'no-housing' }

export function acceptInvitation(world: WorldState, candidateId: string, rng: Rng): AcceptInvitationResult {
  const offer = availableInvitation(world)
  if (!offer) return { ok: false, reason: 'no-invitation' }
  if (!offer.candidates.some((candidate) => candidate.id === candidateId)) {
    return { ok: false, reason: 'candidate-unavailable' }
  }
  const homeId = openHome(world)
  if (!homeId) return { ok: false, reason: 'no-housing' }
  const spot = arrivalSpot(world)
  if (!spot) return { ok: false, reason: 'candidate-unavailable' }
  const index = Number(candidateId.replace('agent-', ''))
  if (!Number.isInteger(index) || AGENT_NAMES[index] === undefined || world.agents.some((agent) => agent.id === candidateId)) {
    return { ok: false, reason: 'candidate-unavailable' }
  }
  const agent = makeAgent(index, spot[0], spot[1], homeId, rng, 1)
  agent.needs = { hunger: 0.86, energy: 0.86, social: 0.86 }
  agent.actionStartNeeds = { ...agent.needs }
  agent.action = { kind: 'idle', reason: 'Accepted the player\'s invitation to join the town' }
  agent.observedFacts = [{
    id: `arrival-${world.tick}-${candidateId}`,
    tick: world.tick,
    text: `The player invited ${agent.name} after the town reached ${townAppeal(world)} Appeal.`,
  }]
  world.agents.push(agent)
  const state = ensureTownGrowth(world)
  state.resolvedInvitationTiers.push(offer.tier)
  state.acceptedAgentIds.push(candidateId)
  return { ok: true, agent, tier: offer.tier }
}

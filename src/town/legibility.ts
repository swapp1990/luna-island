import type { AgentState, Place, SimEvent, WorldState } from '../sim/types'
import { secureFood } from '../sim/firstStorm'
import { availableInvitation } from '../sim/townGrowth'
import { toSimTime } from '../sim/time'

export type TownAlertSeverity = 'critical' | 'warning' | 'info'

export interface TownVitals {
  population: number
  housed: number
  homeless: number
  hungry: number
  exhausted: number
  collapsed: number
  employed: number
  idle: number
  food: number
  foodDays: number
}

export interface TownAlert {
  id: string
  severity: TownAlertSeverity
  title: string
  detail: string
  agentId?: string
  placeId?: string
}

export interface TownStory {
  id: string
  tick: number
  text: string
  agentId?: string
}

function placeName(place: Place | undefined): string {
  if (!place) return 'Unknown place'
  if (place.kind === 'home') return 'House'
  if (place.kind === 'construction-site') {
    const target = place.construction?.targetKind ?? 'home'
    return `${target === 'home' ? 'House' : titleCase(target)} site`
  }
  return titleCase(place.kind)
}

export function titleCase(value: string): string {
  return value
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function agentHasHome(agent: AgentState, world: WorldState): boolean {
  return world.places.some((place) => place.id === agent.homeId && place.kind === 'home')
}

export function foodStored(world: WorldState): number {
  return Math.floor(secureFood(world))
}

export function townVitals(world: WorldState): TownVitals {
  const population = world.agents.length
  const housed = world.agents.filter((agent) => agentHasHome(agent, world)).length
  const hungry = world.agents.filter((agent) => agent.needs.hunger < 0.3).length
  const exhausted = world.agents.filter((agent) => agent.needs.energy < 0.25).length
  const collapsed = world.agents.filter((agent) => agent.collapsed).length
  const employed = world.agents.filter((agent) => agent.employedAt !== null).length
  const idle = world.agents.filter(
    (agent) => agent.action.kind === 'idle' || agent.action.kind === 'wander',
  ).length
  const food = foodStored(world)
  return {
    population,
    housed,
    homeless: Math.max(0, population - housed),
    hungry,
    exhausted,
    collapsed,
    employed,
    idle,
    food,
    // The first-season contract defines one unit per resident as one day of reserve.
    foodDays: population > 0 ? food / population : 0,
  }
}

function constructionAlert(place: Place, world: WorldState): TownAlert | null {
  if (place.kind !== 'construction-site') return null
  const workers = world.agents.filter((agent) => agent.employedAt === place.id).length
  const missing = (['wood', 'stone'] as const).filter(
    (good) => (place.construction?.needs[good] ?? 0) > (place.inventory[good] ?? 0),
  )
  const name = placeName(place)
  if (workers === 0) {
    return {
      id: `site-workers-${place.id}`,
      severity: 'warning',
      title: `${name} has no builders`,
      detail: 'Raise Building priority or free a settler from other work.',
      placeId: place.id,
    }
  }
  if (missing.length > 0) {
    return {
      id: `site-materials-${place.id}`,
      severity: 'warning',
      title: `${name} awaits ${missing.join(' and ')}`,
      detail: `${Math.round((place.construction?.progress ?? 0) * 100)}% built · ${workers} builders assigned`,
      placeId: place.id,
    }
  }
  return null
}

export function townAlerts(world: WorldState): TownAlert[] {
  const vitals = townVitals(world)
  const alerts: TownAlert[] = []
  const invitation = availableInvitation(world)
  if (invitation) {
    alerts.push({
      id: `invitation-${invitation.tier}`,
      severity: 'info',
      title: 'A Luna can join the town',
      detail: `Open Growth and choose ${invitation.candidates.map((candidate) => candidate.name).join(' or ')}.`,
    })
  }
  const collapsed = world.agents.find((agent) => agent.collapsed)
  const hungry = world.agents.find((agent) => agent.needs.hunger < 0.3)
  const exhausted = world.agents.find((agent) => agent.needs.energy < 0.25)

  if (collapsed) {
    alerts.push({
      id: 'collapsed',
      severity: 'critical',
      title: `${vitals.collapsed} settler${vitals.collapsed === 1 ? '' : 's'} collapsed`,
      detail: 'Food is urgently needed.',
      agentId: collapsed.id,
    })
  } else if (hungry) {
    alerts.push({
      id: 'hungry',
      severity: 'critical',
      title: `${vitals.hungry} settler${vitals.hungry === 1 ? '' : 's'} hungry`,
      detail: `${vitals.foodDays.toFixed(1)} days of food remain.`,
      agentId: hungry.id,
    })
  }

  if (vitals.homeless > 0) {
    const first = world.agents.find((agent) => !agentHasHome(agent, world))
    alerts.push({
      id: 'homeless',
      severity: 'warning',
      title: `${vitals.homeless} settler${vitals.homeless === 1 ? '' : 's'} without a bed`,
      detail: `${vitals.housed}/${vitals.population} housed`,
      agentId: first?.id,
    })
  }

  if (exhausted) {
    alerts.push({
      id: 'exhausted',
      severity: 'warning',
      title: `${vitals.exhausted} settler${vitals.exhausted === 1 ? '' : 's'} exhausted`,
      detail: 'Inspect their work and housing access.',
      agentId: exhausted.id,
    })
  }

  for (const place of world.places) {
    const alert = constructionAlert(place, world)
    if (alert) alerts.push(alert)
  }

  if (alerts.length === 0) {
    alerts.push({
      id: 'steady',
      severity: 'info',
      title: 'Town systems are steady',
      detail: `${vitals.employed}/${vitals.population} employed · ${vitals.foodDays.toFixed(1)} food days`,
    })
  }
  return alerts.slice(0, 5)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function eventStory(event: SimEvent): TownStory | null {
  const time = toSimTime(event.tick)
  const at = `${pad2(time.hour)}:${pad2(time.minute)}`
  const name = String(event.data?.agentName ?? event.agentId ?? 'A settler')
  switch (event.type) {
    case 'construction:completed': {
      const kind = String(event.data?.kind ?? 'building')
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${titleCase(kind)} completed`, agentId: event.agentId }
    }
    case 'relationship:friends':
    case 'relationship:close': {
      const a = String(event.data?.nameA ?? name)
      const b = String(event.data?.nameB ?? 'another settler')
      const bond = event.type === 'relationship:close' ? 'became close friends' : 'became friends'
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${a} and ${b} ${bond}`, agentId: event.agentId }
    }
    case 'institution:proposed':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name} posted a town proposal`, agentId: event.agentId }
    case 'institution:closed':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · A town proposal ${String(event.data?.status ?? 'closed')}`, agentId: event.agentId }
    case 'town:milestone':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${String(event.data?.label ?? 'Town milestone')} reached at ${String(event.data?.appeal ?? '?')} Appeal` }
    case 'town:resident-arrived':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name} accepted the town invitation`, agentId: event.agentId }
    case 'need:critical':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name} needs ${String(event.data?.need ?? 'help')}`, agentId: event.agentId }
    case 'agent:recovered':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name} recovered`, agentId: event.agentId }
    case 'job:hired':
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name} started work at the ${String(event.data?.placeKind ?? 'workplace')}`, agentId: event.agentId }
    case 'action:start': {
      const reason = event.reason?.trim()
      if (!reason) return null
      return { id: `event-${event.seq}`, tick: event.tick, text: `${at} · ${name}: ${reason}`, agentId: event.agentId }
    }
    default:
      return null
  }
}

export function townStories(world: WorldState, events: readonly SimEvent[], limit = 5): TownStory[] {
  const stories: TownStory[] = []
  const seenAgents = new Set<string>()

  for (let i = world.sayLog.length - 1; i >= 0 && stories.length < limit; i--) {
    const say = world.sayLog[i]!
    const speaker = world.agents.find((agent) => agent.id === say.agentId)?.name ?? say.agentId
    const time = toSimTime(say.tick)
    stories.push({
      id: `say-${say.conversationId}-${say.turn}`,
      tick: say.tick,
      text: `${pad2(time.hour)}:${pad2(time.minute)} · ${speaker}: “${say.text}”`,
      agentId: say.agentId,
    })
  }

  for (let i = events.length - 1; i >= 0 && stories.length < limit; i--) {
    const event = events[i]!
    if (event.tick > world.tick) continue
    const story = eventStory(event)
    if (!story) continue
    // Action rows are a fallback pulse; keep one per resident so they cannot drown real events.
    if (event.type === 'action:start' && story.agentId) {
      if (seenAgents.has(story.agentId)) continue
      seenAgents.add(story.agentId)
    }
    stories.push(story)
  }
  if (stories.length === 0) {
    const time = toSimTime(world.tick)
    stories.push({
      id: 'settlement-opening',
      tick: world.tick,
      text: `${pad2(time.hour)}:${pad2(time.minute)} · ${world.agents.length} settlers begin their first day`,
    })
  }
  return stories.slice(0, limit)
}

export function residentHomeLabel(agent: AgentState, world: WorldState): string {
  return agentHasHome(agent, world) ? placeName(world.places.find((place) => place.id === agent.homeId)) : 'No bed assigned'
}

export function residentWorkLabel(agent: AgentState, world: WorldState): string {
  return agent.employedAt ? placeName(world.places.find((place) => place.id === agent.employedAt)) : 'Unassigned'
}

export function strongestRelationship(agent: AgentState, world: WorldState): { name: string; value: number } | null {
  const entries = Object.entries(agent.sympathy ?? {}).sort((a, b) => b[1] - a[1])
  const top = entries[0]
  if (!top || top[1] <= 0) return null
  const other = world.agents.find((candidate) => candidate.id === top[0])
  return { name: other?.name ?? top[0], value: top[1] }
}

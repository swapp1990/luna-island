import type { AgentState, Place } from './types'

/** Read-only: agents currently employed at a place. */
export function workersOfPlace(
  agents: readonly AgentState[],
  placeId: string,
): AgentState[] {
  return agents.filter((a) => a.employedAt === placeId)
}

/** Read-only: free job seats at a workplace (0 if not a workplace). */
export function openJobSlots(
  place: Place,
  agents: readonly AgentState[],
): number {
  const seats = place.jobSlots ?? 0
  if (seats <= 0) return 0
  const filled = agents.filter((a) => a.employedAt === place.id).length
  return Math.max(0, seats - filled)
}

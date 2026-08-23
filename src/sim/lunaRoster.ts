/**
 * The single source of truth for which villagers have an LLM mind.
 *
 * This list used to exist twice — once here in the sim (as LUNA_MIND_IDS, which
 * decides who the UtilityBrain skips and whose vote is a "sheep" vote) and once
 * in src/mind/personas.ts (which decides who gets a persona and a LunaBrain).
 * Growing the roster in one copy and not the other silently made an agent both
 * mind-driven and sheep-driven at the same time, and let the electorate sweep
 * cast a vote on a thinking villager's behalf. Nothing failed; the two halves
 * of the world just disagreed about who someone was.
 *
 * Lives under src/sim so both layers can import it: mind depends on sim, never
 * the reverse.
 */
export const LUNA_AGENT_IDS = [
  'agent-0',
  'agent-1',
  'agent-2',
  'agent-3',
  'agent-4',
  'agent-5',
  'agent-8',
  'agent-11',
] as const

export type LunaAgentId = (typeof LUNA_AGENT_IDS)[number]

export const LUNA_AGENT_ID_SET: ReadonlySet<string> = new Set(LUNA_AGENT_IDS)

export function isLunaAgent(agentId: string): boolean {
  return LUNA_AGENT_ID_SET.has(agentId)
}

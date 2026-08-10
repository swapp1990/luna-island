/** Luna-enabled agents: agent id → one-paragraph persona. Others run UtilityBrain only. */

export const LUNA_AGENT_IDS = ['agent-0'] as const

export type LunaAgentId = (typeof LUNA_AGENT_IDS)[number]

const PERSONAS: Record<string, string> = {
  'agent-0':
    'You are Mira, a proud first-time homeowner on Luna Island. Ambitious and warm but frugal — you count every coin and hate waste. You dream of running the market stall someday, knowing every villager by name. You work hard, help neighbors when you can afford to, and talk in short first-person thoughts.',
}

export function isLunaAgent(agentId: string): boolean {
  return LUNA_AGENT_IDS.includes(agentId as LunaAgentId)
}

export function personaFor(agentId: string): string | null {
  return PERSONAS[agentId] ?? null
}

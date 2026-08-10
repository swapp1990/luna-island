/** Pure memory helpers — rebuildable at any tick from trace + note log (app-side). */

import type {
  AgentState,
  MindNoteRecord,
  SimEvent,
  WorldState,
} from '../sim/types'
import { toSimTime } from '../sim/time'

export interface MemoryLine {
  /** Compact display / prompt line. */
  text: string
  kind: 'episodic' | 'reflection'
  tick: number
  /** True when this is a first-occurrence action-kind memory (always retained). */
  isFirst?: boolean
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function stamp(tick: number): string {
  const t = toSimTime(tick)
  return `D${t.day} ${pad2(t.hour)}:${pad2(t.minute)}`
}

/** True when this agent is involved in a relationship event. */
function relationshipInvolves(e: SimEvent, agentId: string): boolean {
  if (e.agentId === agentId) return true
  const a = e.data?.agentIdA
  const b = e.data?.agentIdB
  return a === agentId || b === agentId
}

/**
 * Deterministic salience filter over the agent's own trace.
 * Keep most recent 5 salient memories plus always the agent's first action-kind firsts.
 */
export function episodicMemories(
  agentId: string,
  events: readonly SimEvent[],
): MemoryLine[] {
  const firsts: MemoryLine[] = []
  const seenKinds = new Set<string>()
  const salient: MemoryLine[] = []

  for (const e of events) {
    if (!e.agentId && !relationshipInvolves(e, agentId)) continue
    const mine =
      e.agentId === agentId ||
      (e.type.startsWith('relationship:') && relationshipInvolves(e, agentId))
    if (!mine) continue

    const when = stamp(e.tick)

    // First occurrence of each action kind
    if (e.type === 'action:start') {
      const kind = String(e.data?.kind ?? '')
      if (kind && !seenKinds.has(kind)) {
        seenKinds.add(kind)
        firsts.push({
          text: `${when} — first ${kind}`,
          kind: 'episodic',
          tick: e.tick,
          isFirst: true,
        })
      }
    }

    let line: string | null = null
    switch (e.type) {
      case 'job:hired': {
        const placeKind = String(e.data?.placeKind ?? 'workplace')
        const wage = e.data?.wage
        line =
          typeof wage === 'number'
            ? `hired at the ${placeKind} (${wage}/day)`
            : `hired at the ${placeKind}`
        break
      }
      case 'job:vacated': {
        const placeKind = e.data?.placeKind
          ? String(e.data.placeKind)
          : 'job'
        line = `left the ${placeKind}`
        break
      }
      case 'agent:collapsed':
        line = 'collapsed from hunger'
        break
      case 'agent:recovered':
        line = 'recovered from collapse'
        break
      case 'construction:commissioned':
        line = 'commissioned a house'
        break
      case 'construction:completed':
        line = 'house construction completed'
        break
      case 'relationship:friends': {
        const nameA = String(e.data?.nameA ?? '')
        const nameB = String(e.data?.nameB ?? '')
        const other =
          e.data?.agentIdA === agentId ? nameB : nameA || 'someone'
        line = `became friends with ${other}`
        break
      }
      case 'relationship:close': {
        const nameA = String(e.data?.nameA ?? '')
        const nameB = String(e.data?.nameB ?? '')
        const other =
          e.data?.agentIdA === agentId ? nameB : nameA || 'someone'
        line = `grew close with ${other}`
        break
      }
      case 'coins:transfer': {
        const amount = e.data?.amount
        if (typeof amount !== 'number' || amount < 10) break
        const from = e.data?.from
        const to = e.data?.to
        if (to === agentId) {
          line =
            from === 'treasury'
              ? `earned ${amount} coins (wage)`
              : `received ${amount} coins`
        } else if (from === agentId) {
          line =
            to === 'treasury'
              ? `spent ${amount} coins`
              : `paid out ${amount} coins`
        }
        break
      }
      default:
        break
    }

    // Purchases: action:start buy (salient even without large coin swing)
    if (e.type === 'action:start' && e.data?.kind === 'buy') {
      line = 'bought food at the stall'
    }

    if (line) {
      salient.push({
        text: `${when} — ${line}`,
        kind: 'episodic',
        tick: e.tick,
      })
    }
  }

  // Most recent 5 non-first salient lines
  const recent = salient.slice(-5)
  // Always keep firsts (dedupe by text against recent)
  const recentTexts = new Set(recent.map((m) => m.text))
  const keptFirsts = firsts.filter((f) => !recentTexts.has(f.text))
  // Order: older firsts first, then recent chronologically
  const out = [...keptFirsts, ...recent]
  // Cap total soft bound: firsts + 5 recent is intentional
  return out
}

/**
 * Last 3 reflection notes for the agent, newest first.
 * Flattens note batches; each note becomes its own MemoryLine.
 */
export function reflectionMemories(
  agentId: string,
  mindNoteLog: readonly MindNoteRecord[],
): MemoryLine[] {
  const lines: MemoryLine[] = []
  for (let i = mindNoteLog.length - 1; i >= 0; i--) {
    const rec = mindNoteLog[i]!
    if (rec.agentId !== agentId) continue
    // Newest batch first; within a batch, reverse so last note is newest
    for (let j = rec.notes.length - 1; j >= 0; j--) {
      const note = rec.notes[j]!
      if (!note) continue
      lines.push({
        text: note,
        kind: 'reflection',
        tick: rec.tick,
      })
      if (lines.length >= 3) return lines
    }
  }
  return lines
}

/**
 * Real world facts only — job, owned places, home, wallet.
 */
export function standingFacts(agent: AgentState, world: WorldState): string[] {
  const lines: string[] = []
  const job = agent.employedAt
    ? world.places.find((p) => p.id === agent.employedAt)
    : null
  if (job) {
    lines.push(`Job: ${job.kind} (${job.wage ?? 0}/day)`)
  } else {
    lines.push('Job: unemployed')
  }

  const owned = world.places.filter((p) => world.owners[p.id] === agent.id)
  if (owned.length === 0) {
    lines.push('Owns: nothing')
  } else {
    lines.push(
      `Owns: ${owned.map((p) => `${p.kind}${p.id ? ` (${p.id})` : ''}`).join(', ')}`,
    )
  }

  const home = world.places.find((p) => p.id === agent.homeId)
  if (home) {
    const owner = world.owners[home.id]
    const shared = owner === 'commons' || owner !== agent.id
    lines.push(
      shared
        ? `Home: shared ${home.kind} (${home.id})`
        : `Home: ${home.kind} (${home.id})`,
    )
  } else {
    lines.push('Home: none')
  }

  lines.push(`Wallet: ${agent.wallet} coins`)
  return lines
}

/**
 * Compact lines for the decision prompt: reflections then episodics, ≤ maxLines.
 */
export function memoryLinesForPrompt(
  agentId: string,
  events: readonly SimEvent[],
  mindNoteLog: readonly MindNoteRecord[],
  maxLines = 8,
): string[] {
  const reflections = reflectionMemories(agentId, mindNoteLog)
  const episodics = episodicMemories(agentId, events)
  const lines: string[] = []
  for (const r of reflections) {
    if (lines.length >= maxLines) break
    lines.push(r.text)
  }
  for (const e of episodics) {
    if (lines.length >= maxLines) break
    // Prefer more recent episodics when space is tight: take from end of list
    // (episodics are chronological; skip for now and take last ones that fit)
    void e
  }
  // Fill remaining with most recent episodics
  const room = maxLines - lines.length
  if (room > 0) {
    const recentEp = episodics.slice(-room)
    for (const e of recentEp) lines.push(e.text)
  }
  return lines
}

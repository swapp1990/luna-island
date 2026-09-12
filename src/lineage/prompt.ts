import type { SimEvent } from '../sim/types'
import { dnaText } from './genome'
import type {
  LineageActKind,
  LineageIntent,
  LineageObservation,
  LineageRecord,
  Proposal,
  RuleId,
  Turn,
  Villager,
} from './types'
import { TURN_NAMES } from './types'
import { fullName, grain1, livingVillagers } from './world'

export const LINEAGE_ACTS: readonly LineageActKind[] = [
  'work',
  'forage',
  'rest',
  'eat',
  'store',
  'withdraw',
  'give',
  'talk',
  'court',
  'propose',
  'vote',
  'shun',
  'idle',
]

const ACT_SET = new Set<string>(LINEAGE_ACTS)
const RULE_SET = new Set<RuleId>(['granary-open', 'granary-closed', 'ration-granary'])
const TARGET_ACTS = new Set<LineageActKind>(['give', 'talk', 'court', 'shun'])

/** Facts only. No advice, no ranking, no traits/genes/fitness/selection. */
export const WORLD_RULES_TEXT = [
  'You live in a hamlet of five rooms: fields, woods, hall, homes, and the road. The act you take places you in its room.',
  'Time is four turns a day (dawn, noon, dusk, night), ten days a season. After a season the elders leave and a new cohort arrives.',
  'Satiety, energy, and companionship sit in 0 to 1 and fall each turn. Satiety at 0 starts a starving streak; four hungry turns and you leave for the coast.',
  'You hold personal grain and public standing. The hamlet holds a shared granary and a harvest yield.',
  'work (fields): grain rises by the harvest yield; energy falls 0.2.',
  'forage (woods): grain +1 with chance one half; energy falls 0.1.',
  'rest (homes): energy +0.5.',
  'eat (any room): one personal grain becomes satiety +0.5; else the granary if the granary rule allows.',
  'store / withdraw (hall): move grain to or from the granary; withdraw follows the granary rule.',
  'give (any room): grain to a named villager; your standing +1.',
  'talk (any room): text up to 140 characters to a named villager; both companionship +0.3.',
  'court (any room): records interest toward a named villager this season. Mutual interest matters when families form at season\'s end.',
  'propose / vote (hall): rules from a fixed set that alter physics: granary-open, granary-closed, ration-granary. A proposal needs 3 votes at dusk; the side with more of those votes wins.',
  'shun (any room): text; the named villager\'s standing −1.',
  'idle (any room): nothing.',
  'Granary-open lets grain leave the granary. Granary-closed does not. Ration-granary limits each person to one granary take per day.',
].join('\n')

export const ACT_CONTRACT = `Reply with ONE JSON object and nothing else:
{"action": <one of work|forage|rest|eat|store|withdraw|give|talk|court|propose|vote|shun|idle>,
 "target": <villager name for give/talk/court/shun, else omit>,
 "amount": <number for give/store/withdraw, else omit>,
 "text": <≤140 chars for talk/propose/shun, else omit>,
 "rule": <granary-open|granary-closed|ration-granary for propose, else omit>,
 "proposalId": <id for vote, else omit>, "choice": <for|against for vote, else omit>,
 "reason": <≤160 chars, first person, why>}`

export const PROMPT_CHAR_CAP = 4400

export function extractJsonObject(text: string): string | null {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function stripFences(text: string): string {
  const extracted = extractJsonObject(text)
  return extracted ?? text.trim()
}

function parentSurnames(v: Villager, lineage: readonly LineageRecord[]): [string, string] | null {
  if (!v.parents) return null
  const p1 = lineage.find((r) => r.id === v.parents![0])
  const p2 = lineage.find((r) => r.id === v.parents![1])
  if (!p1 || !p2) return null
  return [p1.surname, p2.surname]
}

export function buildSystemPrompt(
  villager: Villager,
  opts: { dna: boolean },
  lineage: readonly LineageRecord[] = [],
): string {
  let identity = `You are ${fullName(villager)}, generation ${villager.generation} of the hamlet`
  if (villager.generation > 0) {
    const parents = parentSurnames(villager, lineage)
    if (parents) identity += `, child of ${parents[0]} and ${parents[1]}`
  }
  identity += '.'
  const parts = [identity]
  if (opts.dna) parts.push(dnaText(villager.traits))
  parts.push(WORLD_RULES_TEXT)
  parts.push(ACT_CONTRACT)
  return parts.join('\n\n')
}

function pct(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100)
}

function nameOf(state: LineageObservation['state'], id: string): string {
  const v = state.villagers.find((x) => x.id === id)
  if (v) return fullName(v)
  const r = state.lineage.find((x) => x.id === id)
  if (r) return fullName(r)
  return id
}

function seasonStartTick(events: readonly SimEvent[], season: number): number {
  let tick = 0
  for (const e of events) {
    if (e.type === 'season:start' && Number(e.data?.season ?? 0) === season) tick = e.tick
  }
  return tick
}

function lastSpeechToSelf(
  events: readonly SimEvent[],
  selfId: string,
  seasonTick: number,
): Map<string, string> {
  const inbound: SimEvent[] = []
  for (const e of events) {
    if (e.type !== 'speech') continue
    if (e.tick < seasonTick) continue
    if (String(e.data?.to ?? '') !== selfId) continue
    if (!e.agentId) continue
    inbound.push(e)
  }
  const last3 = inbound.slice(-3)
  const said = new Map<string, string>()
  for (const e of last3) {
    said.set(e.agentId!, String(e.data?.text ?? ''))
  }
  return said
}

function recentActs(events: readonly SimEvent[], selfId: string): string[] {
  let day = 0
  let turn: Turn = 0
  const rows: string[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (e.type === 'day:start') day = Number(e.data?.day ?? day)
    if (e.type === 'turn:start') turn = Number(e.data?.turn ?? turn) as Turn
    if (e.agentId !== selfId) continue
    if (e.type !== 'action:start' && e.type !== 'action:fail') continue
    const turnName = TURN_NAMES[turn] ?? 'dawn'
    if (e.type === 'action:fail') {
      const why = String(e.reason ?? e.data?.reason ?? 'fail')
      rows.push(`D${day + 1} ${turnName}: fail → ${why}`)
      continue
    }
    const kind = String(e.data?.kind ?? 'idle')
    let outcome = 'ok'
    for (let j = i + 1; j < events.length; j++) {
      const n = events[j]!
      if (n.agentId === selfId && n.type === 'action:end') {
        outcome = 'ok'
        break
      }
      if (n.agentId === selfId && n.type === 'action:fail') {
        outcome = String(n.reason ?? n.data?.reason ?? 'fail')
        break
      }
      if (n.type === 'turn:start' || n.type === 'day:start') break
    }
    rows.push(`D${day + 1} ${turnName}: ${kind} → ${outcome}`)
  }
  return rows.slice(-6)
}

function openProposal(obs: LineageObservation): Proposal | undefined {
  const open = obs.state.proposals.filter((p) => p.resolved === undefined)
  open.sort((a, b) => a.openedTick - b.openedTick || a.id.localeCompare(b.id))
  return open[0]
}

export function buildUserPrompt(
  obs: LineageObservation,
  events: readonly SimEvent[] = [],
): string {
  const { self, state } = obs
  const turnName = TURN_NAMES[state.turn] ?? 'dawn'
  const seasonTick = seasonStartTick(events, state.season)
  const said = lastSpeechToSelf(events, self.id, seasonTick)
  const others = livingVillagers(state).filter((v) => v.id !== self.id)
  const otherLines = others.map((o) => {
    let line = `${fullName(o)}, ${o.room}, standing ${o.standing}`
    const quote = said.get(o.id)
    if (quote) line += `, said: "${quote}"`
    return line
  })
  const proposal = openProposal(obs)
  let proposalLine = 'No open proposal.'
  if (proposal) {
    const votes = Object.keys(proposal.votes).length
    proposalLine = `Open proposal ${proposal.id} (${proposal.rule}) by ${nameOf(state, proposal.by)}, ${votes} votes.`
  }
  const rules = state.rules.length > 0 ? state.rules.join(', ') : 'none'
  const acts = recentActs(events, self.id)
  const courted = self.courted
    .map((id) => nameOf(state, id))
    .filter((n) => n.length > 0)

  const lines = [
    `Season ${state.season + 1}, day ${state.day + 1}, ${turnName}.`,
    `You are in the ${self.room}.`,
    `Satiety ${pct(self.satiety)}%. Energy ${pct(self.energy)}%. Companionship ${pct(self.companionship)}%.`,
    `Grain: ${grain1(self.grain)}. Standing: ${self.standing}.`,
    `Granary: ${grain1(state.granary)}. Harvest yield: ${grain1(state.config.harvestYield)} grain per turn of field work. Rules in force: ${rules}.`,
    proposalLine,
    'Others:',
    ...(otherLines.length > 0 ? otherLines : ['(none)']),
    'Your recent acts:',
    ...(acts.length > 0 ? acts : ['(none)']),
  ]
  if (courted.length > 0) lines.push(`Courted this season: ${courted.join(', ')}.`)
  return lines.join('\n')
}

export type ParseIntentResult = { intent: LineageIntent } | { error: string }

function isAct(v: unknown): v is LineageActKind {
  return typeof v === 'string' && ACT_SET.has(v)
}

function resolveTarget(
  raw: string,
  obs: LineageObservation,
): { id: string } | { error: string } {
  const n = raw.trim().toLowerCase()
  if (n.length === 0) return { error: 'missing target' }
  const all = obs.state.villagers
  const matches = all.filter((v) => {
    const given = v.givenName.toLowerCase()
    const full = fullName(v).toLowerCase()
    return given === n || full === n
  })
  if (matches.length === 0) return { error: 'unknown target' }
  const selfHit = matches.find((v) => v.id === obs.self.id)
  if (selfHit) return { error: 'self target' }
  const living = matches.find((v) => v.status === 'alive')
  if (!living) return { error: 'dead target' }
  return { id: living.id }
}

export function parseIntent(text: string, obs: LineageObservation): ParseIntentResult {
  const blob = extractJsonObject(text)
  if (!blob) return { error: 'no json object' }
  let raw: unknown
  try {
    raw = JSON.parse(blob)
  } catch {
    return { error: 'invalid json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' }
  const obj = raw as Record<string, unknown>
  if (!isAct(obj.action)) return { error: 'unknown action' }
  const action = obj.action

  const reasonRaw = obj.reason
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) return { error: 'missing reason' }
  const reason = reasonRaw.trim().slice(0, 160)

  const intent: LineageIntent = { kind: action, reason }

  if (TARGET_ACTS.has(action)) {
    if (typeof obj.target !== 'string') return { error: 'missing target' }
    const t = resolveTarget(obj.target, obs)
    if ('error' in t) return t
    intent.target = t.id
  }

  if (obj.amount !== undefined && obj.amount !== null) {
    if (typeof obj.amount !== 'number' || !Number.isFinite(obj.amount) || obj.amount <= 0) {
      return { error: 'bad amount' }
    }
    intent.amount = obj.amount
  }

  if (typeof obj.text === 'string') {
    intent.text = obj.text.trim().slice(0, 140)
  }

  if (action === 'propose') {
    if (typeof obj.rule !== 'string' || !RULE_SET.has(obj.rule as RuleId)) {
      return { error: 'bad rule' }
    }
    intent.rule = obj.rule as RuleId
  }

  if (action === 'vote') {
    if (typeof obj.proposalId !== 'string' || obj.proposalId.trim().length === 0) {
      return { error: 'missing proposal' }
    }
    const pid = obj.proposalId.trim()
    const found = obs.state.proposals.find((p) => p.id === pid)
    if (!found) return { error: 'unknown proposal' }
    if (found.resolved !== undefined) return { error: 'closed proposal' }
    intent.proposalId = pid
    if (obj.choice !== 'for' && obj.choice !== 'against') return { error: 'bad choice' }
    intent.choice = obj.choice
  }

  return { intent }
}

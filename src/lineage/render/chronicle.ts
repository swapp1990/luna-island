import type { SimEvent } from '../../sim/types'
import type { LineageActKind, LineageState } from '../types'
import { TURN_NAMES } from '../types'
import { fullName, grain1 } from '../world'

interface Name {
  given: string
  full: string
}

function nameMap(state: LineageState): Map<string, Name> {
  const m = new Map<string, Name>()
  for (const r of state.lineage) {
    m.set(r.id, { given: r.givenName, full: fullName(r) })
  }
  for (const v of state.villagers) {
    m.set(v.id, { given: v.givenName, full: fullName(v) })
  }
  return m
}

function who(names: Map<string, Name>, id: string | undefined): Name {
  if (!id) return { given: '?', full: '?' }
  return names.get(id) ?? { given: id, full: id }
}

function reasonOf(e: SimEvent): string {
  return typeof e.reason === 'string' && e.reason.length > 0 ? e.reason : ''
}

function actSentence(
  names: Map<string, Name>,
  start: SimEvent,
  end: SimEvent | undefined,
): string {
  const kind = String(start.data?.kind ?? 'idle') as LineageActKind
  const actor = who(names, start.agentId)
  const q = reasonOf(start) ? ` _"${reasonOf(start)}"_` : ''
  const fail = end?.type === 'action:fail'
  const failWhy = fail
    ? String(end?.reason ?? end?.data?.reason ?? 'it cannot be done')
    : ''
  const d = (end?.data ?? {}) as Record<string, unknown>
  const target = who(names, String(start.data?.target ?? d.target ?? ''))

  if (fail) return `**${actor.full}** fails to ${kind} (${failWhy}).${q}`

  switch (kind) {
    case 'work':
      return `**${actor.full}** works the fields (+${grain1(Number(d.grainDelta ?? 0))} grain).${q}`
    case 'forage':
      return d.found
        ? `**${actor.full}** forages the woods (+1.0 grain).${q}`
        : `**${actor.full}** forages the woods (nothing).${q}`
    case 'rest':
      return `**${actor.full}** rests.${q}`
    case 'eat':
      return `**${actor.full}** eats.${q}`
    case 'store':
      return `**${actor.full}** stores ${grain1(Number(d.amount ?? 0))} grain.${q}`
    case 'withdraw':
      return `**${actor.full}** withdraws ${grain1(Number(d.amount ?? 0))} grain.${q}`
    case 'give':
      return `**${actor.full}** gives ${grain1(Number(d.amount ?? start.data?.amount ?? 1))} grain to ${target.full}.${q}`
    case 'talk':
      return `**${actor.full}** talks to ${target.given}.${q}`
    case 'court':
      return `**${actor.full}** courts ${target.full}.${q}`
    case 'propose':
      return `**${actor.full}** proposes ${String(start.data?.rule ?? d.rule ?? 'a rule')}.${q}`
    case 'vote':
      return `**${actor.full}** votes ${String(start.data?.choice ?? d.choice ?? '')}.${q}`
    case 'shun':
      return `**${actor.full}** shuns ${target.full}.${q}`
    default:
      return `**${actor.full}** idles.${q}`
  }
}

export function renderChronicle(events: readonly SimEvent[], state: LineageState): string {
  const names = nameMap(state)
  const lines: string[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const t = e.type
    if (t === 'season:start') {
      const s = Number(e.data?.season ?? 0)
      const g = Number(e.data?.generation ?? 0)
      lines.push(`## Season ${s}, generation ${g}`)
      continue
    }
    if (t === 'day:start') {
      lines.push(`### Day ${Number(e.data?.day ?? 0)}`)
      continue
    }
    if (t === 'turn:start') {
      const name = String(e.data?.name ?? TURN_NAMES[Number(e.data?.turn ?? 0)] ?? 'dawn')
      lines.push(name)
      continue
    }
    if (t === 'action:start') {
      let end: SimEvent | undefined
      for (let j = i + 1; j < events.length; j++) {
        const n = events[j]!
        if (n.agentId === e.agentId && (n.type === 'action:end' || n.type === 'action:fail')) {
          end = n
          break
        }
        if (n.type === 'turn:start' || n.type === 'day:start') break
      }
      lines.push(actSentence(names, e, end))
      continue
    }
    if (t === 'speech') {
      const a = who(names, e.agentId)
      const b = who(names, String(e.data?.to ?? ''))
      lines.push(`> ${a.given} to ${b.given}: "${String(e.data?.text ?? '')}"`)
      continue
    }
    if (t === 'give') {
      const a = who(names, e.agentId)
      const b = who(names, String(e.data?.to ?? ''))
      lines.push(
        `**${a.full}** gives ${grain1(Number(e.data?.amount ?? 1))} grain to **${b.full}**.`,
      )
      continue
    }
    if (t === 'shun') {
      const a = who(names, e.agentId)
      const b = who(names, String(e.data?.to ?? ''))
      const text = String(e.data?.text ?? '')
      lines.push(`**${a.full}** shuns **${b.full}**${text ? `: "${text}"` : ''}.`)
      continue
    }
    if (t === 'proposal:open') {
      const a = who(names, e.agentId)
      lines.push(`**${a.full}** opens proposal ${String(e.data?.id ?? '')} (${String(e.data?.rule ?? '')}).`)
      continue
    }
    if (t === 'proposal:resolved') {
      lines.push(
        `Proposal ${String(e.data?.id ?? '')} is ${String(e.data?.result ?? '')}.`,
      )
      continue
    }
    if (t === 'rule:enacted') {
      lines.push(`Rule enacted: ${String(e.data?.rule ?? '')}.`)
      continue
    }
    if (t === 'villager:starving') {
      const a = who(names, e.agentId)
      lines.push(`**${a.full}** is starving.`)
      continue
    }
    if (t === 'villager:departed') {
      const a = who(names, e.agentId)
      const why = String(e.reason ?? e.data?.reason ?? '')
      lines.push(`**${a.full}** departs. _"${why}"_`)
      continue
    }
    if (t.startsWith('lineage:') || t === 'generation:turnover' || t === 'season:extinct' || t === 'vote' || t === 'court') {
      if (t === 'lineage:pair') {
        const p1 = who(names, String(e.data?.p1 ?? ''))
        const p2 = who(names, String(e.data?.p2 ?? ''))
        lines.push(
          `Pair ${p1.full} × ${p2.full} (weight ${String(e.data?.weight ?? '')}).`,
        )
      } else if (t === 'lineage:born') {
        const child = who(names, String(e.data?.id ?? e.agentId ?? ''))
        lines.push(`**${child.full}** is born (generation ${String(e.data?.generation ?? '')}).`)
      } else if (t === 'lineage:arrive') {
        lines.push(`The new cohort arrives by the road.`)
      } else if (t === 'generation:turnover') {
        lines.push(
          `Generation turnover: ${String(e.data?.born ?? 0)} born into generation ${String(e.data?.generation ?? '')}.`,
        )
      } else if (t === 'season:extinct') {
        lines.push(`The hamlet is extinct.`)
      } else if (t === 'vote') {
        const a = who(names, e.agentId)
        lines.push(`**${a.full}** casts a vote (${String(e.data?.choice ?? '')}).`)
      } else if (t === 'court') {
        const a = who(names, e.agentId)
        const b = who(names, String(e.data?.to ?? ''))
        lines.push(`**${a.full}** courts **${b.full}**.`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

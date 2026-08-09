import { useMemo, useState } from 'react'
import type { SimEvent } from '../sim/types'
import { toSimTime } from '../sim/time'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export interface TickerRow {
  key: string
  tick: number
  agentId: string | null
  text: string
}

/** Build ticker rows from the event trace (newest first, max 40). */
export function buildTickerRows(
  events: readonly SimEvent[],
  replayTick: number,
  dayStartTick = 0,
): TickerRow[] {
  const filtered = events.filter((e) => e.tick >= dayStartTick && e.tick <= replayTick)
  const lastKindByAgent = new Map<string, string>()
  const rows: TickerRow[] = []

  // Walk oldest → newest so kind-change detection is correct, then reverse.
  for (const ev of filtered) {
    if (ev.type === 'day:start') {
      const day = (ev.data?.day as number) ?? toSimTime(ev.tick).day
      rows.push({
        key: `day-${ev.seq}`,
        tick: ev.tick,
        agentId: null,
        text: `☀️ Day ${day} begins`,
      })
      continue
    }

    if (ev.type === 'need:critical') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const need = (ev.data?.need as string) ?? 'need'
      const needLabel =
        need === 'hunger' ? 'hungry' : need === 'energy' ? 'exhausted' : 'lonely'
      const t = toSimTime(ev.tick)
      rows.push({
        key: `crit-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · ${name} — ${needLabel}!`,
      })
      continue
    }

    if (ev.type === 'agent:collapsed') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const t = toSimTime(ev.tick)
      rows.push({
        key: `collapse-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · ${name} collapsed — needs food`,
      })
      continue
    }

    if (ev.type === 'agent:recovered') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const t = toSimTime(ev.tick)
      rows.push({
        key: `recover-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · ${name} recovered`,
      })
      continue
    }

    if (ev.type === 'job:hired') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const kind = (ev.data?.placeKind as string) ?? 'workplace'
      const wage = (ev.data?.wage as number) ?? 0
      const t = toSimTime(ev.tick)
      rows.push({
        key: `hire-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · ${name} hired at the ${kind} (${wage}/day)`,
      })
      continue
    }

    if (ev.type === 'construction:commissioned') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const t = toSimTime(ev.tick)
      rows.push({
        key: `commission-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · 🏗️ ${name} commissioned a house!`,
      })
      continue
    }

    if (ev.type === 'construction:completed') {
      const name =
        (ev.data?.agentName as string) ?? ev.agentId ?? 'Someone'
      const t = toSimTime(ev.tick)
      const first = ev.data?.firstPrivate === true
      rows.push({
        key: `built-${ev.seq}`,
        tick: ev.tick,
        agentId: ev.agentId ?? null,
        text: first
          ? `${pad2(t.hour)}:${pad2(t.minute)} · 🏠 ${name}'s house is finished — first private property!`
          : `${pad2(t.hour)}:${pad2(t.minute)} · 🏠 ${name}'s house is finished`,
      })
      continue
    }

    if (ev.type === 'coins:transfer') {
      const kind = ev.data?.kind as string | undefined
      if (kind === 'wage') {
        const amount = (ev.data?.amount as number) ?? 0
        const to = ev.data?.to as string | undefined
        // Prefer reason ("Mira earned 6 coins") for product copy
        const reason = (ev.reason ?? '').trim()
        const t = toSimTime(ev.tick)
        const text = reason
          ? `💰 ${reason}`
          : `💰 Wage paid: ${amount} coins`
        rows.push({
          key: `wage-${ev.seq}`,
          tick: ev.tick,
          agentId: to && to !== 'treasury' ? to : (ev.agentId ?? null),
          text: `${pad2(t.hour)}:${pad2(t.minute)} · ${text}`,
        })
      }
      continue
    }

    if (ev.type === 'relationship:friends' || ev.type === 'relationship:close') {
      const nameA = (ev.data?.nameA as string) ?? 'Someone'
      const nameB = (ev.data?.nameB as string) ?? 'Someone'
      const close = ev.type === 'relationship:close'
      const t = toSimTime(ev.tick)
      rows.push({
        key: `rel-${ev.seq}`,
        tick: ev.tick,
        agentId: (ev.data?.agentIdA as string) ?? ev.agentId ?? null,
        text: close
          ? `${pad2(t.hour)}:${pad2(t.minute)} · 💛 ${nameA} and ${nameB} are now close friends`
          : `${pad2(t.hour)}:${pad2(t.minute)} · 💛 ${nameA} and ${nameB} are now friends`,
      })
      continue
    }

    if (ev.type === 'action:start') {
      const agentId = ev.agentId
      if (!agentId) continue
      const kind = (ev.data?.kind as string) ?? 'action'
      const prev = lastKindByAgent.get(agentId)
      lastKindByAgent.set(agentId, kind)
      // Only when the action KIND changed — suppress wander/idle spam of same kind
      if (prev === kind) continue
      const name = (ev.data?.agentName as string) ?? agentId
      const reason = (ev.reason && ev.reason.length > 0 ? ev.reason : kind).trim()
      const t = toSimTime(ev.tick)
      rows.push({
        key: `act-${ev.seq}`,
        tick: ev.tick,
        agentId,
        text: `${pad2(t.hour)}:${pad2(t.minute)} · ${name} — ${reason}`,
      })
    }
  }

  // Newest on top, retain ~40
  return rows.reverse().slice(0, 40)
}

export function Ticker(props: {
  events: readonly SimEvent[]
  replayTick: number
  /** Inclusive lower bound for ticker (loaded day's start). */
  dayStartTick?: number
  onSelectAgent: (id: string) => void
  /** Force collapsed (e.g. when portrait dock is open). */
  collapsed?: boolean
  /** Bottom offset in px (default 72 above timeline). */
  bottomOffset?: number
}) {
  const { events, replayTick, onSelectAgent } = props
  const dayStart = props.dayStartTick ?? 0
  const [userCollapsed, setUserCollapsed] = useState(false)
  const collapsed = props.collapsed === true ? true : userCollapsed
  const bottom = props.bottomOffset ?? 72
  const rows = useMemo(
    () => buildTickerRows(events, replayTick, dayStart),
    [events, replayTick, dayStart],
  )
  const visible = rows.slice(0, 6)

  return (
    <div
      data-testid="ticker"
      style={{
        position: 'absolute',
        bottom,
        left: 16,
        width: 280,
        zIndex: 11,
        color: '#f2f4f8',
        fontSize: 11,
        userSelect: 'none',
        background: 'rgba(12, 16, 28, 0.78)',
        backdropFilter: 'blur(8px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setUserCollapsed((c) => !c)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          background: 'transparent',
          border: 'none',
          borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.08)',
          color: '#d0d6e0',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ opacity: 0.7 }}>{collapsed ? '▸' : '▾'}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>Town ticker</span>
        <span style={{ opacity: 0.45, fontWeight: 600 }}>{rows.length}</span>
      </button>

      {!collapsed && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 6 * 28,
            overflow: 'hidden',
          }}
        >
          {visible.length === 0 ? (
            <div style={{ padding: '8px 10px', opacity: 0.5 }}>Waiting for news…</div>
          ) : (
            visible.map((row) => (
              <button
                key={row.key}
                type="button"
                data-tick={row.tick}
                data-agent-id={row.agentId ?? ''}
                onClick={() => {
                  if (row.agentId) onSelectAgent(row.agentId)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  color: '#e8ecf4',
                  cursor: row.agentId ? 'pointer' : 'default',
                  fontSize: 11,
                  lineHeight: 1.35,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {row.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

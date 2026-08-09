import { useEffect, useState } from 'react'
import type { AgentState, Good, Place, SimEvent } from '../sim/types'
import { workersOfPlace } from '../sim/selectors'
import { toSimTime } from '../sim/time'
import { GOOD_ICON, SlotGrid } from './SlotGrid'

type TabId = 'overview' | 'log'

/** Home construction bill totals (render mirror of sim HOME_BILL — not state). */
const HOME_BILL: Record<'wood' | 'stone', number> = { wood: 12, stone: 6 }

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const PLACE_ICON: Record<string, string> = {
  farm: '👨‍🌾',
  stall: '🏪',
  storehouse: '🏚️',
  forestry: '🪓',
  quarry: '⛏️',
  well: '💧',
  home: '🏠',
  'construction-site': '🏗️',
  plaza: '🏛️',
  'berry-bush': '🫐',
}

const PLACE_NAME: Record<string, string> = {
  farm: 'Farm',
  stall: 'Market stall',
  storehouse: 'Storehouse',
  forestry: 'Forestry camp',
  quarry: 'Quarry',
  well: 'Well',
  home: 'Home',
  'construction-site': 'Construction site',
  plaza: 'Plaza',
  'berry-bush': 'Berry bush',
}

function ownerLabel(
  placeId: string,
  owners: Record<string, string> | undefined,
  agents: readonly AgentState[],
): string {
  const o = owners?.[placeId]
  if (!o || o === 'commons') return 'Village commons'
  const a = agents.find((x) => x.id === o)
  return a ? a.name : o
}

function formatPlaceLogRow(ev: SimEvent): { tick: number; text: string } {
  const t = toSimTime(ev.tick)
  const when = `Day ${t.day} ${pad2(t.hour)}:${pad2(t.minute)}`
  let what = ev.type
  if (ev.type === 'goods:transfer') {
    const good = (ev.data?.good as string) ?? 'goods'
    const amount = (ev.data?.amount as number) ?? 0
    const toKind = ev.data?.toKind as string | undefined
    const fromKind = ev.data?.fromKind as string | undefined
    if (toKind === 'place') what = `Received +${amount} ${good}`
    else if (fromKind === 'place') what = `Sent −${amount} ${good}`
    else what = `Transfer ${amount} ${good}`
  } else if (ev.type === 'goods:produced') {
    const good = (ev.data?.good as string) ?? 'goods'
    const amount = (ev.data?.amount as number) ?? 0
    what = `Produced +${amount} ${good}`
  } else if (ev.type === 'job:hired') {
    const name = (ev.data?.agentName as string) ?? 'Someone'
    what = `${name} hired`
  } else if (ev.type === 'job:vacated') {
    const name = (ev.data?.agentName as string) ?? 'Someone'
    what = `${name} left`
  } else if (ev.type === 'coins:transfer') {
    const kind = ev.data?.kind as string | undefined
    const amount = (ev.data?.amount as number) ?? 0
    if (kind === 'buy') what = `Sale +${amount} 🪙`
    else if (kind === 'wage') what = `Wage −${amount} 🪙`
    else what = `Coins ${amount}`
  } else if (ev.type === 'construction:commissioned') {
    what = 'Site commissioned'
  } else if (ev.type === 'construction:completed') {
    what = 'Construction completed'
  } else if (ev.reason) {
    what = ev.reason
  }
  return { tick: ev.tick, text: `${when} — ${what}` }
}

function eventTouchesPlace(ev: SimEvent, placeId: string): boolean {
  if (ev.data?.placeId === placeId) return true
  if (ev.data?.fromId === placeId || ev.data?.toId === placeId) return true
  return false
}

function MaterialsLine(props: { place: Place }) {
  const c = props.place.construction
  if (!c) return null
  const inv = props.place.inventory
  const parts: string[] = []
  for (const g of ['wood', 'stone'] as const) {
    const total = HOME_BILL[g]
    const remaining = c.needs?.[g] ?? 0
    const onHand = inv?.[g] ?? 0
    const have = Math.min(total, total - remaining + onHand)
    parts.push(`${GOOD_ICON[g]} ${have}/${total}`)
  }
  const pct = Math.round(Math.max(0, Math.min(1, c.progress ?? 0)) * 100)
  return (
    <div data-testid="materials-line" style={{ fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ marginBottom: 4 }}>{parts.join(' · ')}</div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: '#c4a574',
            borderRadius: 4,
          }}
        />
      </div>
      <div style={{ fontSize: 11, opacity: 0.65, marginTop: 3 }}>{pct}% complete</div>
    </div>
  )
}

function ProductionBar(props: { place: Place }) {
  const prod = props.place.production
  if (!prod) return null
  const g = Math.max(0, Math.min(1, props.place.growth ?? 0))
  const pct = Math.round(g * 100)
  const icon = GOOD_ICON[prod.good as Good] ?? '📦'
  return (
    <div data-testid="production-bar" style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          marginBottom: 3,
          opacity: 0.9,
        }}
      >
        <span>
          Production {icon} {prod.good}
        </span>
        <span
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          {pct}%
        </span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: '#6fbf7a',
            borderRadius: 4,
            transition: 'width 0.2s linear',
          }}
        />
      </div>
    </div>
  )
}

export function BuildingPanel(props: {
  place: Place
  agents: readonly AgentState[]
  owners?: Record<string, string>
  events: readonly SimEvent[]
  replayTick: number
  dayStartTick?: number
  onSelectAgent: (id: string) => void
  onClose: () => void
}) {
  const { place, agents, onSelectAgent, onClose } = props
  const dayStart = props.dayStartTick ?? 0
  const [tab, setTab] = useState<TabId>('overview')
  const workers = workersOfPlace(agents, place.id)
  const seats = place.jobSlots ?? 0

  useEffect(() => {
    setTab('overview')
  }, [place.id])

  const logEvents = props.events
    .filter(
      (e) =>
        e.tick >= dayStart &&
        e.tick <= props.replayTick &&
        eventTouchesPlace(e, place.id) &&
        (e.type === 'goods:transfer' ||
          e.type === 'goods:produced' ||
          e.type === 'job:hired' ||
          e.type === 'job:vacated' ||
          e.type === 'coins:transfer' ||
          e.type === 'construction:commissioned' ||
          e.type === 'construction:completed'),
    )
    .slice()
    .reverse()
    .slice(0, 30)

  const name = PLACE_NAME[place.kind] ?? place.kind
  const icon = PLACE_ICON[place.kind] ?? '📍'
  const owner = ownerLabel(place.id, props.owners, agents)

  // Inventory slots: show goods that this place can hold (at least food/wood/stone)
  const invSlots = Math.max(
    4,
    ['food', 'wood', 'stone'].filter((g) => (place.inventory?.[g as Good] ?? 0) > 0)
      .length + 1,
  )

  return (
    <div
      data-testid="building-panel"
      style={{
        position: 'absolute',
        top: 64,
        right: 14,
        width: 300,
        maxHeight: 'calc(100% - 120px)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 14px',
        background: 'rgba(12, 16, 28, 0.82)',
        backdropFilter: 'blur(10px)',
        borderRadius: 14,
        color: '#f2f4f8',
        fontSize: 13,
        zIndex: 12,
        boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{name}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }} data-testid="building-owner">
            {owner}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close building panel"
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#c8ced8',
            borderRadius: 8,
            width: 28,
            height: 28,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 2,
          marginBottom: 12,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {(
          [
            { id: 'overview' as const, label: 'Overview' },
            { id: 'log' as const, label: 'Activity' },
          ] as const
        ).map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`building-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: '6px 2px',
                background: 'transparent',
                border: 'none',
                borderBottom: active
                  ? '2px solid rgba(255,200,120,0.75)'
                  : '2px solid transparent',
                color: active ? '#ffe7c2' : '#9aa3b5',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {place.production ? <ProductionBar place={place} /> : null}
          {place.construction ? <MaterialsLine place={place} /> : null}

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                opacity: 0.55,
                marginBottom: 6,
              }}
            >
              Inventory
            </div>
            <SlotGrid inventory={place.inventory} slots={invSlots} testId="building-inv" />
          </div>

          {seats > 0 && (
            <div data-testid="worker-roster">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  opacity: 0.55,
                  marginBottom: 6,
                }}
              >
                Workers · {workers.length}/{seats}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {workers.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    data-testid="roster-chip"
                    data-agent-id={w.id}
                    onClick={() => onSelectAgent(w.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f2f4f8',
                      cursor: 'pointer',
                      fontSize: 12,
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: w.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 600 }}>{w.name}</span>
                  </button>
                ))}
                {Array.from({ length: Math.max(0, seats - workers.length) }).map((_, i) => (
                  <div
                    key={`hire-${i}`}
                    data-testid="hiring-chip"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: 'transparent',
                      border: '1px dashed rgba(255,200,120,0.35)',
                      color: '#c8b080',
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>!</span>
                    <span>Hiring</span>
                  </div>
                ))}
              </div>
              {place.wage != null && (
                <div
                  data-testid="wage-line"
                  style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}
                >
                  🪙 Wage {place.wage} coins/day
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'log' && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              opacity: 0.55,
              marginBottom: 6,
            }}
          >
            Activity log
          </div>
          <div
            data-testid="building-activity-log"
            style={{
              flex: 1,
              overflowY: 'auto',
              minHeight: 80,
              maxHeight: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {logEvents.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: 12 }}>No activity yet</div>
            ) : (
              logEvents.map((ev) => {
                const row = formatPlaceLogRow(ev)
                return (
                  <div
                    key={ev.seq}
                    data-tick={row.tick}
                    style={{
                      fontSize: 11,
                      lineHeight: 1.35,
                      opacity: 0.88,
                      padding: '5px 7px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    {row.text}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

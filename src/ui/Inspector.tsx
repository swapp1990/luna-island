import { useEffect, useMemo, useState } from 'react'
import type { AgentState, MindNoteRecord, Place, SimEvent } from '../sim/types'
import { toSimTime } from '../sim/time'
import { SlotGrid } from './SlotGrid'
import type { MindExchange } from '../mind/lunaBrain'
import { isLunaAgent } from '../mind/personas'
import { episodicMemories, reflectionMemories } from '../mind/memory'

type TabId = 'status' | 'life' | 'people' | 'work' | 'mind'

function pad2s(n: number): string {
  return n.toString().padStart(2, '0')
}

function needColor(v: number): string {
  // green → amber → red as they drop
  if (v >= 0.55) return '#6fbf7a'
  if (v >= 0.3) return '#e0b44a'
  return '#e05a5a'
}

function sympathyColor(v: number): string {
  if (v >= 0.6) return '#e8a0c8'
  if (v >= 0.3) return '#c98bb9'
  return '#8a90a0'
}

function sympathyLabel(v: number): string {
  if (v >= 0.6) return 'close friend'
  if (v >= 0.3) return 'friend'
  return 'acquaintance'
}

function actionVerb(kind: string, workPhase?: string | null): string {
  switch (kind) {
    case 'sleep':
      return 'Sleeping'
    case 'eat':
      return 'Eating'
    case 'forage':
      return 'Picking berries'
    case 'buy':
      return 'Buying food'
    case 'work':
      if (workPhase === 'hauling' || workPhase === 'returning') return 'Hauling'
      return 'Working'
    case 'commission':
      return 'Commissioning a house'
    case 'drink':
      return 'Drinking'
    case 'socialize':
      return 'Socializing'
    case 'wander':
      return 'Wandering'
    case 'walk':
      return 'Walking'
    case 'idle':
      return 'Idle'
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1)
  }
}

function jobLabel(agent: AgentState, places: Place[] | undefined): string {
  if (!agent.employedAt) return 'Unemployed'
  const place = places?.find((p) => p.id === agent.employedAt)
  if (!place) return 'Unemployed'
  const kindLabel: Record<string, string> = {
    farm: 'Farm',
    stall: 'Stall',
    forestry: 'Forestry',
    quarry: 'Quarry',
    'construction-site': 'Build site',
  }
  const kind = kindLabel[place.kind] ?? place.kind
  const wage = place.wage ?? 0
  return `${kind} · ${wage} coins/day`
}

function ownsLabel(agent: AgentState, places: Place[] | undefined, owners?: Record<string, string>): string {
  if (!places || !owners) return ''
  const owned = places.filter((p) => owners[p.id] === agent.id)
  if (owned.length === 0) return ''
  return owned
    .map((p) => {
      if (p.kind === 'home') return 'house'
      if (p.kind === 'construction-site') return 'build site'
      return p.kind
    })
    .join(', ')
}

function formatLogRow(ev: SimEvent): { tick: number; text: string } {
  const t = toSimTime(ev.tick)
  const when = `Day ${t.day} ${pad2s(t.hour)}:${pad2s(t.minute)}`
  let what = ev.type
  if (ev.type === 'action:start') {
    const kind = (ev.data?.kind as string) ?? 'action'
    what = `Started ${kind}`
  } else if (ev.type === 'action:end') {
    const kind = (ev.data?.kind as string) ?? 'action'
    const outcome = (ev.data?.outcome as string) ?? ev.reason ?? 'done'
    what = `Finished ${kind} — ${outcome}`
  } else if (ev.type === 'need:critical') {
    const need = (ev.data?.need as string) ?? 'need'
    what = `Critical ${need}`
  }
  const reason = ev.reason && ev.type === 'action:start' ? ` — ${ev.reason}` : ''
  return { tick: ev.tick, text: `${when} — ${what}${reason}` }
}

function NeedBar(props: { label: string; value: number; testId: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100)
  const color = needColor(props.value)
  return (
    <div data-testid={props.testId} style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          marginBottom: 3,
          opacity: 0.9,
        }}
      >
        <span>{props.label}</span>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
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
            background: color,
            borderRadius: 4,
            transition: 'width 0.2s linear, background 0.2s linear',
          }}
        />
      </div>
    </div>
  )
}

function SympathyBar(props: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100)
  const color = sympathyColor(props.value)
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        flex: 1,
        minWidth: 48,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
        }}
      />
    </div>
  )
}

const BASE_TABS: Array<{ id: TabId; label: string; testId: string }> = [
  { id: 'status', label: 'Status', testId: 'tab-status' },
  { id: 'life', label: 'Life', testId: 'tab-life' },
  { id: 'people', label: 'People', testId: 'tab-people' },
  { id: 'work', label: 'Work', testId: 'tab-work' },
  { id: 'mind', label: 'Mind', testId: 'tab-mind' },
]

export function Inspector(props: {
  agent: AgentState | null
  events: readonly SimEvent[]
  replayTick: number
  /** Inclusive lower bound for activity log (loaded day's start). */
  dayStartTick?: number
  places?: Place[]
  owners?: Record<string, string>
  /** All agents (for People tab name/color lookup). */
  agents?: readonly AgentState[]
  following: boolean
  onToggleFollow: () => void
  onClose: () => void
  /** LunaBrain enabled for this session and agent is luna-capable. */
  lunaEnabled?: boolean
  lastExchange?: MindExchange | null
  /** Applied mind reflections (for Memories section). */
  mindNoteLog?: readonly MindNoteRecord[]
}) {
  const { agent, events, replayTick, following, onToggleFollow, onClose } = props
  const dayStart = props.dayStartTick ?? 0
  const [tab, setTab] = useState<TabId>('status')
  const [exchangeOpen, setExchangeOpen] = useState(false)

  // Reset to Status when selecting a different villager
  useEffect(() => {
    setTab('status')
    setExchangeOpen(false)
  }, [agent?.id])

  const memoryRows = useMemo(() => {
    if (!agent) return { reflections: [] as ReturnType<typeof reflectionMemories>, episodics: [] as ReturnType<typeof episodicMemories> }
    const upTo = events.filter((e) => e.tick <= replayTick)
    const notes = (props.mindNoteLog ?? []).filter((r) => r.tick <= replayTick)
    return {
      reflections: reflectionMemories(agent.id, notes),
      episodics: episodicMemories(agent.id, upTo),
    }
  }, [agent, events, replayTick, props.mindNoteLog])

  if (!agent) return null
  const owns = ownsLabel(agent, props.places, props.owners)
  // Show mind UI for luna agents when brain is on; otherwise instinct (incl. brain=off)
  const showMind = isLunaAgent(agent.id) && !!props.lunaEnabled
  const tabs = BASE_TABS

  const logEvents = events
    .filter(
      (e) =>
        e.agentId === agent.id &&
        e.tick >= dayStart &&
        e.tick <= replayTick &&
        (e.type === 'action:start' || e.type === 'action:end' || e.type === 'need:critical'),
    )
    .slice()
    .reverse()
    .slice(0, 50)

  const people = Object.entries(agent.sympathy ?? {})
    .filter(([, v]) => v > 0)
    .map(([otherId, value]) => {
      const other = props.agents?.find((a) => a.id === otherId)
      return {
        id: otherId,
        name: other?.name ?? otherId,
        color: other?.color ?? '#888',
        value,
        label: sympathyLabel(value),
      }
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))

  const verb = actionVerb(agent.action.kind, agent.workPhase)

  return (
    <div
      data-testid="inspector"
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
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: agent.color,
            boxShadow: `0 0 8px ${agent.color}88`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{agent.name}</span>
        <button
          type="button"
          data-testid="follow-toggle"
          aria-pressed={following}
          onClick={onToggleFollow}
          style={{
            background: following ? 'rgba(255, 176, 80, 0.35)' : 'rgba(255,255,255,0.08)',
            border: following
              ? '1px solid rgba(255,200,120,0.55)'
              : '1px solid rgba(255,255,255,0.12)',
            color: following ? '#ffe7c2' : '#c8ced8',
            borderRadius: 8,
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            lineHeight: 1.2,
          }}
        >
          {following ? 'Following' : 'Follow'}
        </button>
        <button
          type="button"
          aria-label="Close inspector"
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
          paddingBottom: 0,
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={t.testId}
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
                letterSpacing: 0.2,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Status */}
      {tab === 'status' && (
        <div style={{ overflowY: 'auto' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{verb}</div>
            <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.4 }}>{agent.action.reason}</div>
          </div>
          <div style={{ marginBottom: 4 }}>
            <NeedBar label="Hunger" value={agent.needs.hunger} testId="need-hunger" />
            <NeedBar label="Energy" value={agent.needs.energy} testId="need-energy" />
            <NeedBar label="Social" value={agent.needs.social} testId="need-social" />
          </div>
        </div>
      )}

      {/* Life — activity log */}
      {tab === 'life' && (
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
            data-testid="activity-log"
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
                const row = formatLogRow(ev)
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

      {/* People — relationships */}
      {tab === 'people' && (
        <div
          data-testid="people-list"
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 80,
            maxHeight: 340,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {people.length === 0 ? (
            <div style={{ opacity: 0.5, fontSize: 12 }}>No close ties yet.</div>
          ) : (
            people.map((p) => (
              <div
                key={p.id}
                data-testid="people-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: p.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 12, minWidth: 48 }}>{p.name}</span>
                <SympathyBar value={p.value} />
                <span
                  style={{
                    fontSize: 10,
                    opacity: 0.75,
                    whiteSpace: 'nowrap',
                    minWidth: 72,
                    textAlign: 'right',
                  }}
                >
                  {p.label}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Work — job, owns, wallet, inventory */}
      {tab === 'work' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 12,
            opacity: 0.92,
          }}
        >
          <div data-testid="job-row">💼 {jobLabel(agent, props.places)}</div>
          {owns ? <div data-testid="owns-row">🏠 Owns: {owns}</div> : null}
          <div data-testid="wallet-row">🪙 {agent.wallet ?? 0} coins</div>
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
            <SlotGrid
              inventory={agent.inventory}
              slots={4}
              containerTestId="inv-row"
            />
          </div>
        </div>
      )}

      {/* Mind — LunaBrain decisions (luna agents) or instinct note */}
      {tab === 'mind' && (
        <div data-testid="mind-tab" style={{ overflowY: 'auto', fontSize: 12 }}>
          {!showMind ? (
            <div data-testid="mind-instinct" style={{ opacity: 0.7, lineHeight: 1.4 }}>
              Runs on instinct
            </div>
          ) : (
            (() => {
              const mindEvents = events
                .filter(
                  (e) =>
                    e.agentId === agent.id &&
                    e.tick >= dayStart &&
                    e.tick <= replayTick &&
                    (e.type === 'mind:decision' || e.type === 'mind:fallback'),
                )
                .slice()
                .reverse()
              const lastDecision = mindEvents.find((e) => e.type === 'mind:decision')
              const decisions = mindEvents.filter((e) => e.type === 'mind:decision').length
              const fallbacks = mindEvents.filter((e) => e.type === 'mind:fallback').length
              const latencies = mindEvents
                .map((e) => e.data?.latencyMs)
                .filter((n): n is number => typeof n === 'number')
              const meanLat =
                latencies.length > 0
                  ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
                  : 0
              const chars = mindEvents.reduce(
                (s, e) => s + (typeof e.data?.approxChars === 'number' ? e.data.approxChars : 0),
                0,
              )
              const intentKind =
                (lastDecision?.data?.intent as { kind?: string } | undefined)?.kind ??
                '—'
              const reasoning =
                (lastDecision?.data?.reasoning as string) ??
                lastDecision?.reason ??
                'No mind decision yet'

              return (
                <>
                  <div
                    data-testid="mind-last-decision"
                    style={{
                      marginBottom: 12,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'rgba(160, 140, 255, 0.1)',
                      border: '1px solid rgba(160, 140, 255, 0.28)',
                    }}
                  >
                    <div style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, marginBottom: 4 }}>
                      LAST DECISION
                    </div>
                    <div
                      data-testid="mind-last-intent"
                      style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}
                    >
                      {intentKind}
                    </div>
                    <div
                      data-testid="mind-last-reasoning"
                      style={{ fontSize: 12, opacity: 0.88, lineHeight: 1.4 }}
                    >
                      {reasoning}
                    </div>
                  </div>

                  <div
                    data-testid="mind-token-totals"
                    style={{
                      display: 'flex',
                      gap: 10,
                      marginBottom: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 11,
                      opacity: 0.85,
                    }}
                  >
                    <span>🧠 {decisions}</span>
                    <span>↩ {fallbacks}</span>
                    <span>{meanLat}ms</span>
                    <span>~{chars}ch</span>
                  </div>

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
                    Memories
                  </div>
                  <div
                    data-testid="mind-memories"
                    style={{
                      maxHeight: 160,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      marginBottom: 12,
                    }}
                  >
                    {memoryRows.reflections.length === 0 &&
                    memoryRows.episodics.length === 0 ? (
                      <div data-testid="mind-memories-empty" style={{ opacity: 0.5 }}>
                        No memories yet — she&apos;ll reflect tonight.
                      </div>
                    ) : (
                      <>
                        {memoryRows.reflections.map((m, i) => (
                          <div
                            key={`r-${m.tick}-${i}`}
                            data-testid="mind-memory-reflection"
                            style={{
                              fontSize: 11,
                              padding: '4px 6px',
                              borderRadius: 6,
                              background: 'rgba(160, 140, 255, 0.08)',
                              border: '1px solid rgba(160, 140, 255, 0.18)',
                              lineHeight: 1.35,
                            }}
                          >
                            💭 {m.text}
                          </div>
                        ))}
                        {memoryRows.episodics
                          .slice()
                          .reverse()
                          .slice(0, 8)
                          .map((m, i) => (
                            <div
                              key={`e-${m.tick}-${i}-${m.text.slice(0, 12)}`}
                              data-testid="mind-memory-episodic"
                              style={{
                                fontSize: 11,
                                padding: '4px 6px',
                                borderRadius: 6,
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.05)',
                                lineHeight: 1.35,
                              }}
                            >
                              📌 {m.text}
                            </div>
                          ))}
                      </>
                    )}
                  </div>

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
                    Decision timeline
                  </div>
                  <div
                    data-testid="mind-timeline"
                    style={{
                      maxHeight: 140,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      marginBottom: 12,
                    }}
                  >
                    {mindEvents.length === 0 ? (
                      <div style={{ opacity: 0.5 }}>No mind events yet</div>
                    ) : (
                      mindEvents.slice(0, 30).map((ev) => {
                        const t = toSimTime(ev.tick)
                        const when = `D${t.day} ${pad2s(t.hour)}:${pad2s(t.minute)}`
                        const label =
                          ev.type === 'mind:decision'
                            ? `decision: ${(ev.data?.reasoning as string) ?? ev.reason ?? ''}`
                            : `fallback: ${(ev.data?.reason as string) ?? ev.reason ?? ''}`
                        return (
                          <div
                            key={ev.seq}
                            data-tick={ev.tick}
                            style={{
                              fontSize: 11,
                              padding: '4px 6px',
                              borderRadius: 6,
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.05)',
                            }}
                          >
                            {when} — {label}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {props.lunaEnabled && props.lastExchange ? (
                    <div>
                      <button
                        type="button"
                        data-testid="mind-exchange-toggle"
                        onClick={() => setExchangeOpen((o) => !o)}
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#c8ced8',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 6,
                        }}
                      >
                        {exchangeOpen ? 'Hide' : 'Show'} last exchange
                      </button>
                      {exchangeOpen ? (
                        <pre
                          data-testid="mind-last-exchange"
                          style={{
                            fontSize: 10,
                            lineHeight: 1.35,
                            maxHeight: 160,
                            overflow: 'auto',
                            padding: 8,
                            borderRadius: 6,
                            background: 'rgba(0,0,0,0.35)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            margin: 0,
                            fontFamily:
                              'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          }}
                        >
                          {`=== SYSTEM ===\n${props.lastExchange.system}\n\n=== USER ===\n${props.lastExchange.user}\n\n=== RESPONSE ===\n${props.lastExchange.rawResponse}`}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )
            })()
          )}
        </div>
      )}
    </div>
  )
}

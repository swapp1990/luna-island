import type { AgentState, SimEvent } from '../sim/types'
import { toSimTime } from '../sim/time'

function pad2s(n: number): string {
  return n.toString().padStart(2, '0')
}

function needColor(v: number): string {
  // green → amber → red as they drop
  if (v >= 0.55) return '#6fbf7a'
  if (v >= 0.3) return '#e0b44a'
  return '#e05a5a'
}

function actionVerb(kind: string): string {
  switch (kind) {
    case 'sleep':
      return 'Sleeping'
    case 'eat':
      return 'Eating'
    case 'forage':
      return 'Picking berries'
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

export function Inspector(props: {
  agent: AgentState | null
  events: readonly SimEvent[]
  replayTick: number
  /** Inclusive lower bound for activity log (loaded day's start). */
  dayStartTick?: number
  following: boolean
  onToggleFollow: () => void
  onClose: () => void
}) {
  const { agent, events, replayTick, following, onToggleFollow, onClose } = props
  const dayStart = props.dayStartTick ?? 0
  if (!agent) return null

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

  const verb = actionVerb(agent.action.kind)

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
          marginBottom: 12,
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

      {/* Current action */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{verb}</div>
        <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.4 }}>{agent.action.reason}</div>
      </div>

      {/* Needs */}
      <div style={{ marginBottom: 12 }}>
        <NeedBar label="Hunger" value={agent.needs.hunger} testId="need-hunger" />
        <NeedBar label="Energy" value={agent.needs.energy} testId="need-energy" />
        <NeedBar label="Social" value={agent.needs.social} testId="need-social" />
      </div>

      {/* Inventory & wallet */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginBottom: 12,
          fontSize: 12,
          opacity: 0.92,
        }}
      >
        <div data-testid="inv-row">
          🎒 {agent.inventory?.food ?? 0} food
        </div>
        <div data-testid="wallet-row">
          🪙 {agent.wallet ?? 0} coins
        </div>
      </div>

      {/* Activity log */}
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
          maxHeight: 280,
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
    </div>
  )
}

import { useMemo, useState } from 'react'
import type { AgentState, Place } from '../sim/types'

const JOB_EMOJI: Record<string, string> = {
  farm: '👨‍🌾',
  stall: '🏪',
  forestry: '🪓',
  quarry: '⛏️',
  'construction-site': '🏗️',
  storehouse: '🏚️',
}

function isAsleep(agent: AgentState): boolean {
  return (
    agent.action.kind === 'sleep' &&
    (agent.action.path === undefined ||
      agent.pathIndex >= (agent.action.path?.length ?? 0))
  )
}

export function PortraitDock(props: {
  agents: AgentState[]
  places: Place[]
  selectedAgentId: string | null
  onSelectAndFollow: (id: string) => void
  /** When open, parent can lift the ticker. */
  onOpenChange?: (open: boolean) => void
}) {
  const { agents, places, selectedAgentId, onSelectAndFollow, onOpenChange } = props
  const [open, setOpen] = useState(true)

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])

  const chips = useMemo(() => {
    // Stable order by id so layout doesn't jump
    return [...agents].sort((a, b) => a.id.localeCompare(b.id))
  }, [agents])

  const setOpenState = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      data-testid="portrait-dock"
      style={{
        position: 'absolute',
        // Bottom-left; ticker lifts above this panel when open (see App bottomOffset)
        bottom: 72,
        left: 16,
        zIndex: 12,
        color: '#f2f4f8',
        fontSize: 11,
        userSelect: 'none',
        maxWidth: 420,
      }}
    >
      <button
        type="button"
        data-testid="portrait-dock-toggle"
        onClick={() => setOpenState(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: open ? 6 : 0,
          padding: '5px 10px',
          background: 'rgba(12, 16, 28, 0.78)',
          backdropFilter: 'blur(8px)',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#d0d6e0',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
        <span>Villagers</span>
        <span style={{ opacity: 0.45 }}>{chips.length}</span>
      </button>

      {open && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 8,
            background: 'rgba(12, 16, 28, 0.78)',
            backdropFilter: 'blur(8px)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
          }}
        >
          {[0, 1].map((row) => (
            <div
              key={row}
              style={{
                display: 'flex',
                flexWrap: 'nowrap',
                gap: 4,
              }}
            >
              {chips.slice(row * 12, row * 12 + 12).map((agent) => {
                const jobPlace = agent.employedAt
                  ? placeById.get(agent.employedAt)
                  : undefined
                const emoji = jobPlace ? JOB_EMOJI[jobPlace.kind] ?? '💼' : '🧍'
                const letter = (agent.name?.[0] ?? agent.id[0] ?? '?').toUpperCase()
                const selected = selectedAgentId === agent.id
                const collapsed = agent.collapsed
                const asleep = isAsleep(agent)
                const dim = asleep && !collapsed
                return (
                  <button
                    key={agent.id}
                    type="button"
                    data-testid="portrait"
                    data-agent-id={agent.id}
                    title={agent.name}
                    onClick={() => onSelectAndFollow(agent.id)}
                    style={{
                      position: 'relative',
                      width: 30,
                      height: 30,
                      padding: 0,
                      borderRadius: '50%',
                      border: selected
                        ? '2px solid #ffe7c2'
                        : collapsed
                          ? '2px solid #e05050'
                          : '2px solid rgba(255,255,255,0.18)',
                      background: agent.color,
                      cursor: 'pointer',
                      opacity: dim ? 0.45 : collapsed ? 0.95 : 1,
                      boxShadow: collapsed
                        ? '0 0 0 2px rgba(200,40,40,0.35)'
                        : selected
                          ? '0 0 0 2px rgba(255,220,140,0.35)'
                          : 'none',
                      filter: collapsed ? 'saturate(1.2) hue-rotate(-10deg)' : 'none',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 800,
                        color: '#1a1208',
                        textShadow: '0 0 2px rgba(255,255,255,0.5)',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    >
                      {letter}
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        right: -3,
                        bottom: -3,
                        fontSize: 10,
                        lineHeight: 1,
                        filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))',
                      }}
                    >
                      {emoji}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { MindBridgeState } from '../bridge'

export interface ResourceSnapshot {
  treasury: number
  stallFood: number
  storeWood: number
  storeStone: number
}

const CHIPS: Array<{
  key: keyof ResourceSnapshot
  icon: string
  label: string
  testId: string
}> = [
  { key: 'treasury', icon: '🪙', label: 'treasury', testId: 'chip-treasury' },
  { key: 'stallFood', icon: '🫐', label: 'stall stock', testId: 'chip-stall' },
  { key: 'storeWood', icon: '🪵', label: 'storehouse wood', testId: 'chip-wood' },
  {
    key: 'storeStone',
    icon: '🪨',
    label: 'storehouse stone',
    testId: 'chip-stone',
  },
]

const chipBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  whiteSpace: 'nowrap',
  transition: 'transform 0.18s ease, box-shadow 0.18s ease',
}

function Chip(props: {
  icon: string
  label: string
  value: number
  pulse: boolean
  testId: string
}) {
  return (
    <div
      data-testid={props.testId}
      style={{
        ...chipBase,
        transform: props.pulse ? 'scale(1.08)' : 'scale(1)',
        boxShadow: props.pulse
          ? '0 0 12px rgba(255,220,140,0.45)'
          : 'none',
      }}
      title={props.label}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
        {props.icon}
      </span>
      <span
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontWeight: 700,
          fontSize: 13,
          minWidth: 18,
        }}
      >
        {props.value}
      </span>
      <span style={{ fontSize: 10, opacity: 0.55, fontWeight: 600 }}>
        {props.label}
      </span>
    </div>
  )
}

function MindChip(props: { mind: MindBridgeState }) {
  const { mind } = props
  // Wall-bound thinking only (not short mock holds)
  const showThinking = (mind.thinking ?? 0) > 0
  return (
    <div
      data-testid="mind-chip"
      data-thinking={showThinking ? '1' : '0'}
      title={
        showThinking
          ? `LunaBrain (${mind.provider}) — thinking…`
          : `LunaBrain (${mind.provider}) — ${mind.decisions} decisions, ${mind.fallbacks} fallbacks`
      }
      style={{
        ...chipBase,
        background: showThinking
          ? 'rgba(160, 140, 255, 0.22)'
          : 'rgba(160, 140, 255, 0.12)',
        border: showThinking
          ? '1px solid rgba(190, 170, 255, 0.65)'
          : '1px solid rgba(160, 140, 255, 0.35)',
        transform: showThinking ? 'scale(1.06)' : 'scale(1)',
        boxShadow: showThinking
          ? '0 0 14px rgba(160, 140, 255, 0.55)'
          : 'none',
        animation: showThinking ? 'luna-mind-pulse 1.1s ease-in-out infinite' : 'none',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }} aria-hidden>
        🧠
      </span>
      {showThinking ? (
        <span
          data-testid="mind-chip-thinking"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.2,
            color: '#d8ceff',
          }}
        >
          thinking…
        </span>
      ) : (
        <>
          <span
            data-testid="mind-chip-count"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontWeight: 700,
              fontSize: 13,
              minWidth: 12,
            }}
          >
            {mind.decisions}
          </span>
          <span
            data-testid="mind-chip-provider"
            style={{ fontSize: 10, opacity: 0.7, fontWeight: 600 }}
          >
            {mind.provider}
          </span>
        </>
      )}
    </div>
  )
}

export function ResourceBar(props: {
  resources: ResourceSnapshot
  mind?: MindBridgeState | null
}) {
  const { resources, mind } = props
  const prev = useRef<ResourceSnapshot>({ ...resources })
  const [pulse, setPulse] = useState<Partial<Record<keyof ResourceSnapshot, boolean>>>(
    {},
  )

  useEffect(() => {
    const changed: Array<keyof ResourceSnapshot> = []
    for (const c of CHIPS) {
      if (prev.current[c.key] !== resources[c.key]) changed.push(c.key)
    }
    if (changed.length === 0) {
      prev.current = { ...resources }
      return
    }
    const next: Partial<Record<keyof ResourceSnapshot, boolean>> = {}
    for (const k of changed) next[k] = true
    setPulse(next)
    prev.current = { ...resources }
    const t = window.setTimeout(() => setPulse({}), 280)
    return () => window.clearTimeout(t)
  }, [resources])

  return (
    <div
      data-testid="resource-bar"
      style={{
        position: 'absolute',
        top: 12,
        left: 14,
        // Stay left of the centered HUD cluster (~half viewport minus HUD half-width)
        maxWidth: 'min(360px, calc(50vw - 220px))',
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        columnGap: 6,
        rowGap: 8,
        zIndex: 12,
        color: '#f2f4f8',
        fontSize: 12,
        userSelect: 'none',
        padding: '6px 8px',
        background: 'rgba(12, 16, 28, 0.72)',
        backdropFilter: 'blur(8px)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        @keyframes luna-mind-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(160, 140, 255, 0.35); }
          50% { box-shadow: 0 0 16px rgba(190, 170, 255, 0.75); }
        }
      `}</style>
      {CHIPS.map((c) => (
        <Chip
          key={c.key}
          icon={c.icon}
          label={c.label}
          value={resources[c.key]}
          pulse={!!pulse[c.key]}
          testId={c.testId}
        />
      ))}
      {mind?.enabled ? <MindChip mind={mind} /> : null}
    </div>
  )
}

/** Derive resource chips from view-sim state (replay-aware when called on fork). */
export function resourcesFromWorld(state: {
  treasury: number
  places: Array<{ kind: string; inventory?: { food?: number; wood?: number; stone?: number } }>
}): ResourceSnapshot {
  let stallFood = 0
  let storeWood = 0
  let storeStone = 0
  for (const p of state.places) {
    if (p.kind === 'stall') stallFood += p.inventory?.food ?? 0
    if (p.kind === 'storehouse') {
      storeWood += p.inventory?.wood ?? 0
      storeStone += p.inventory?.stone ?? 0
    }
  }
  return {
    treasury: Math.floor(state.treasury),
    stallFood: Math.floor(stallFood),
    storeWood: Math.floor(storeWood),
    storeStone: Math.floor(storeStone),
  }
}

import type { SimStateBridge } from '../bridge'

const SPEEDS: Array<{ label: string; value: number }> = [
  { label: '⏸', value: 0 },
  { label: '1×', value: 1 },
  { label: '8×', value: 8 },
  { label: '64×', value: 64 },
]

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function Hud(props: {
  state: SimStateBridge
  onSetSpeed: (n: number) => void
}) {
  const { state, onSetSpeed } = props
  const clock = `Day ${state.day} — ${pad2(state.hour)}:${pad2(state.minute)}`

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'rgba(12, 16, 28, 0.72)',
        backdropFilter: 'blur(8px)',
        borderRadius: 12,
        color: '#f2f4f8',
        fontSize: 14,
        userSelect: 'none',
        zIndex: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <span
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontWeight: 600,
          letterSpacing: 0.3,
          minWidth: 140,
        }}
      >
        {clock}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {SPEEDS.map((s) => {
          const active = state.speed === s.value
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onSetSpeed(s.value)}
              style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: 13,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 8,
                border: active ? '1px solid rgba(255,200,120,0.55)' : '1px solid rgba(255,255,255,0.12)',
                background: active ? 'rgba(255, 176, 80, 0.35)' : 'rgba(255,255,255,0.06)',
                color: active ? '#ffe7c2' : '#d0d6e0',
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

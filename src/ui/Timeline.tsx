import type { SimStateBridge } from '../bridge'
import { toSimTime } from '../sim/time'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function Timeline(props: {
  state: SimStateBridge
  liveHeadTick: number
  onScrub: (tick: number) => void
  onGoLive: () => void
}) {
  const { state, liveHeadTick, onScrub, onGoLive } = props
  const isLive = state.mode === 'live'
  const scrubTime = toSimTime(state.tick)
  const scrubLabel = `Day ${scrubTime.day} ${pad2(scrubTime.hour)}:${pad2(scrubTime.minute)}`
  const max = Math.max(0, liveHeadTick)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 14,
        left: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'rgba(12, 16, 28, 0.72)',
        backdropFilter: 'blur(8px)',
        borderRadius: 12,
        color: '#f2f4f8',
        fontSize: 13,
        userSelect: 'none',
        zIndex: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <input
        type="range"
        min={0}
        max={max}
        value={Math.min(state.tick, max)}
        onChange={(e) => onScrub(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#e08a5b', cursor: 'pointer' }}
      />
      <span
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          minWidth: 110,
          opacity: 0.9,
        }}
      >
        {scrubLabel}
      </span>
      <button
        type="button"
        onClick={() => {
          if (!isLive) onGoLive()
        }}
        style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          fontWeight: 700,
          padding: '5px 12px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          background: isLive ? 'rgba(220, 60, 60, 0.25)' : 'rgba(255,255,255,0.08)',
          color: isLive ? '#ffb0b0' : '#c8ced8',
          cursor: isLive ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          letterSpacing: 0.4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isLive ? '#e23d3d' : '#7a7f8a',
            display: 'inline-block',
          }}
        />
        {isLive ? 'LIVE' : 'GO LIVE'}
      </button>
    </div>
  )
}

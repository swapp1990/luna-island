import type { CSSProperties } from 'react'
import type { SimStateBridge } from '../bridge'
import { toSimTime } from '../sim/time'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function Timeline(props: {
  state: SimStateBridge
  liveHeadTick: number
  scrubMin: number
  scrubMax: number
  onScrub: (tick: number) => void
  onGoLive: () => void
  onLoadDay: (day: number) => void
}) {
  const { state, liveHeadTick, scrubMin, scrubMax, onScrub, onGoLive, onLoadDay } = props
  const isLive = state.mode === 'live'
  const scrubTime = toSimTime(state.tick)
  const scrubLabel = `Day ${scrubTime.day} ${pad2(scrubTime.hour)}:${pad2(scrubTime.minute)}`
  const min = Math.max(0, scrubMin)
  const max = Math.max(min, scrubMax, 0)
  const value = Math.min(Math.max(state.tick, min), max)

  const liveDay = toSimTime(liveHeadTick).day
  const viewDay = state.viewDay
  const totalDays = liveDay
  const useChips = totalDays <= 7

  const btnBase: CSSProperties = {
    fontFamily: 'system-ui, sans-serif',
    fontSize: 12,
    fontWeight: 700,
    padding: '4px 8px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.08)',
    color: '#c8ced8',
    cursor: 'pointer',
    lineHeight: 1.2,
  }

  const dayChip = (day: number) => {
    const selected = day === viewDay
    const isToday = day === liveDay
    return (
      <button
        key={day}
        type="button"
        onClick={() => onLoadDay(day)}
        style={{
          ...btnBase,
          padding: '4px 9px',
          background: selected ? 'rgba(224, 138, 91, 0.35)' : 'rgba(255,255,255,0.06)',
          border: selected
            ? '1px solid rgba(224, 138, 91, 0.65)'
            : '1px solid rgba(255,255,255,0.12)',
          color: selected ? '#ffe7c2' : '#c8ced8',
        }}
      >
        {isToday && isLive && selected ? '● LIVE' : `D${day}`}
      </button>
    )
  }

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
      <div
        data-testid="day-selector"
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
      >
        {useChips ? (
          Array.from({ length: totalDays }, (_, i) => dayChip(i + 1))
        ) : (
          <>
            <button
              type="button"
              aria-label="Previous day"
              disabled={viewDay <= 1}
              onClick={() => onLoadDay(viewDay - 1)}
              style={{
                ...btnBase,
                opacity: viewDay <= 1 ? 0.35 : 1,
                cursor: viewDay <= 1 ? 'default' : 'pointer',
              }}
            >
              ◀
            </button>
            <span
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                minWidth: 72,
                textAlign: 'center',
                fontWeight: 700,
              }}
            >
              {viewDay === liveDay && isLive ? '● LIVE' : `Day ${viewDay}`}
            </span>
            <button
              type="button"
              aria-label="Next day"
              disabled={viewDay >= liveDay}
              onClick={() => onLoadDay(viewDay + 1)}
              style={{
                ...btnBase,
                opacity: viewDay >= liveDay ? 0.35 : 1,
                cursor: viewDay >= liveDay ? 'default' : 'pointer',
              }}
            >
              ▶
            </button>
          </>
        )}
      </div>

      <input
        type="range"
        data-testid="day-scrubber"
        min={min}
        max={max}
        value={value}
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

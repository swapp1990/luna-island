import { useMemo, useState } from 'react'
import type { EconomyStat } from '../sim/types'
import { TICKS_PER_DAY } from '../sim/time'

const TRAIL_TICKS = 3 * TICKS_PER_DAY

interface ChartSeries {
  key: string
  color: string
  label: string
  values: number[]
}

function autoRange(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 }
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    return { min: min - pad, max: max + pad }
  }
  const pad = (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

function polylinePoints(
  values: number[],
  w: number,
  h: number,
  min: number,
  max: number,
  padL: number,
  padR: number,
  padT: number,
  padB: number,
): string {
  if (values.length === 0) return ''
  const span = max - min || 1
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const n = values.length
  return values
    .map((v, i) => {
      const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
      const y = padT + innerH - ((v - min) / span) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function MiniChart(props: {
  title: string
  series: ChartSeries[]
  width?: number
  height?: number
}) {
  const w = props.width ?? 280
  const h = props.height ?? 88
  const padL = 34
  const padR = 8
  const padT = 8
  const padB = 14

  const allValues = props.series.flatMap((s) => s.values)
  const { min, max } = autoRange(allValues)
  const mid = (min + max) / 2

  const fmt = (n: number) => {
    if (Math.abs(n) >= 100) return String(Math.round(n))
    if (Math.abs(n) >= 10) return n.toFixed(0)
    return n.toFixed(1)
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: '#d0d6e0',
        }}
      >
        <span>{props.title}</span>
        <span style={{ flex: 1 }} />
        {props.series.map((s) => (
          <span
            key={s.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.85,
            }}
          >
            <span
              style={{
                width: 8,
                height: 2,
                background: s.color,
                borderRadius: 1,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', background: 'rgba(0,0,0,0.18)', borderRadius: 8 }}
      >
        {/* axis labels */}
        <text x={2} y={padT + 4} fill="#7a8294" fontSize={9} fontFamily="ui-monospace, monospace">
          {fmt(max)}
        </text>
        <text
          x={2}
          y={h / 2 + 3}
          fill="#7a8294"
          fontSize={9}
          fontFamily="ui-monospace, monospace"
        >
          {fmt(mid)}
        </text>
        <text
          x={2}
          y={h - padB + 2}
          fill="#7a8294"
          fontSize={9}
          fontFamily="ui-monospace, monospace"
        >
          {fmt(min)}
        </text>
        {/* grid lines */}
        {[0, 0.5, 1].map((t) => {
          const y = padT + (h - padT - padB) * (1 - t)
          return (
            <line
              key={t}
              x1={padL}
              y1={y}
              x2={w - padR}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          )
        })}
        {props.series.map((s) => {
          const pts = polylinePoints(s.values, w, h, min, max, padL, padR, padT, padB)
          if (!pts) return null
          return (
            <polyline
              key={s.key}
              data-testid={`chart-line-${s.key}`}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={pts}
            />
          )
        })}
      </svg>
    </div>
  )
}

export function Charts(props: {
  stats: readonly EconomyStat[]
  /** Current view tick (live head or scrub position). */
  replayTick: number
  /** When the inspector is open, park the panel to its left. */
  inspectorOpen?: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelRight = props.inspectorOpen ? 328 : 14

  const windowed = useMemo(() => {
    const tMax = props.replayTick
    const tMin = Math.max(0, tMax - TRAIL_TICKS)
    return props.stats.filter((s) => s.tick >= tMin && s.tick <= tMax)
  }, [props.stats, props.replayTick])

  const priceSeries: ChartSeries[] = useMemo(
    () => [
      {
        key: 'price',
        color: '#e0b44a',
        label: 'food $',
        values: windowed.map((s) => s.price),
      },
    ],
    [windowed],
  )

  const moneySeries: ChartSeries[] = useMemo(
    () => [
      {
        key: 'treasury',
        color: '#6d9dc5',
        label: 'treasury',
        values: windowed.map((s) => s.treasury),
      },
      {
        key: 'meanWallet',
        color: '#81b29a',
        label: 'mean wallet',
        values: windowed.map((s) => s.meanWallet),
      },
    ],
    [windowed],
  )

  const laborSeries: ChartSeries[] = useMemo(() => {
    const series: ChartSeries[] = [
      {
        key: 'employed',
        color: '#c98bb9',
        label: 'employed',
        values: windowed.map((s) => s.employed),
      },
    ]
    const hasCollapsed = windowed.some((s) => typeof s.collapsed === 'number')
    if (hasCollapsed) {
      series.push({
        key: 'collapsed',
        color: '#e05a5a',
        label: 'collapsed',
        values: windowed.map((s) => s.collapsed ?? 0),
      })
    }
    return series
  }, [windowed])

  return (
    <>
      <button
        type="button"
        data-testid="charts-toggle"
        aria-label="Town charts"
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'absolute',
          top: 12,
          right: 14,
          zIndex: 14,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: open
            ? '1px solid rgba(255,200,120,0.55)'
            : '1px solid rgba(255,255,255,0.12)',
          background: open ? 'rgba(255, 176, 80, 0.35)' : 'rgba(12, 16, 28, 0.78)',
          backdropFilter: 'blur(8px)',
          color: open ? '#ffe7c2' : '#e8ecf4',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        }}
      >
        📊
      </button>

      {open && (
        <div
          data-testid="charts"
          style={{
            position: 'absolute',
            top: 56,
            right: panelRight,
            width: 300,
            zIndex: 13,
            padding: '12px 12px 6px',
            background: 'rgba(12, 16, 28, 0.88)',
            backdropFilter: 'blur(10px)',
            borderRadius: 14,
            color: '#f2f4f8',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
            maxHeight: 'calc(100% - 140px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              opacity: 0.55,
              marginBottom: 10,
            }}
          >
            Town charts · last 3 days
          </div>
          {windowed.length === 0 ? (
            <div style={{ opacity: 0.5, fontSize: 12, padding: '8px 0 12px' }}>
              No samples yet — wait for the next sim-hour.
            </div>
          ) : (
            <>
              <MiniChart title="Food price" series={priceSeries} />
              <MiniChart title="Money" series={moneySeries} />
              <MiniChart title="Labor" series={laborSeries} />
            </>
          )}
        </div>
      )}
    </>
  )
}

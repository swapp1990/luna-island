import type { LineageConfig } from '../../lineage/types'
import type { LineageSpeed } from '../bridge'

const SPEEDS: LineageSpeed[] = [1, 8, 64]

export function PlaybackBar(props: {
  turn: number
  turnCount: number
  playing: boolean
  speed: LineageSpeed
  config: LineageConfig
  accent?: string
  onPlay(): void
  onPause(): void
  onSeek(turn: number): void
  onSpeed(n: LineageSpeed): void
}) {
  const seasons = Math.max(1, props.config.seasons)
  const span = Math.max(1, props.config.daysPerSeason * props.config.turnsPerDay)
  const max = Math.max(0, props.turnCount - 1)
  const ticks: { pct: number; filled: boolean }[] = []
  for (let s = 0; s < seasons; s++) {
    const t = s * span
    if (t > max) break
    ticks.push({ pct: max === 0 ? 0 : (t / max) * 100, filled: props.turn >= t })
  }
  return (
    <footer className="playback" style={{ ['--accent' as string]: props.accent }}>
      <div className="scrubber">
        <div className="ticks">
          {ticks.map((t, i) => (
            <i key={i} className={t.filled ? 'filled' : ''} style={{ left: `${t.pct}%` }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={max}
          value={Math.min(props.turn, max)}
          aria-label="Turn scrubber"
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
      </div>
      <div className="play-row">
        <button
          type="button"
          className="play-btn"
          aria-label={props.playing ? 'Pause' : 'Play'}
          onClick={() => (props.playing ? props.onPause() : props.onPlay())}
        >
          {props.playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 2.5v11l10-5.5z" />
            </svg>
          )}
        </button>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={props.speed === s ? 'is-on' : ''}
              aria-label={`${s} times speed`}
              onClick={() => props.onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </footer>
  )
}

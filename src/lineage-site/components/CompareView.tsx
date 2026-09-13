import type { BuiltTimeline } from '../replay'
import type { LineageSpeed } from '../bridge'
import { ChronicleFeed } from './ChronicleFeed'
import { PlaybackBar } from './PlaybackBar'
import { StatusStrip } from './StatusStrip'

function eventsUpTo(tl: BuiltTimeline, turn: number) {
  const end = tl.turnStarts[Math.min(turn + 1, tl.turnStarts.length - 1)] ?? tl.events.length
  return tl.events.slice(0, end)
}

export function CompareView(props: {
  aId: string
  bId: string
  a: BuiltTimeline
  b: BuiltTimeline
  turn: number
  playing: boolean
  speed: LineageSpeed
  phone: boolean
  onPlay(): void
  onPause(): void
  onSeek(turn: number): void
  onSpeed(n: LineageSpeed): void
  onOpen(id: string): void
  onSwitch(id: string): void
}) {
  if (props.phone) {
    return (
      <div className="compare-notice">
        Compare mode needs a wider screen. Open one hamlet at a time.
        <p>
          <button type="button" className="open-btn" onClick={() => props.onSwitch(props.aId)}>
            {props.aId}
          </button>{' '}
          <button type="button" className="open-btn" onClick={() => props.onSwitch(props.bId)}>
            {props.bId}
          </button>
        </p>
      </div>
    )
  }
  const maxTurn = Math.max(props.a.snapshots.length, props.b.snapshots.length)
  const turn = Math.min(props.turn, maxTurn - 1)
  const aState = props.a.snapshots[Math.min(turn, props.a.snapshots.length - 1)]!
  const bState = props.b.snapshots[Math.min(turn, props.b.snapshots.length - 1)]!
  return (
    <div className="compare">
      <div className="compare-cols">
        <div className="compare-col">
          <StatusStrip state={aState} />
          <ChronicleFeed
            state={aState}
            events={eventsUpTo(props.a, Math.min(turn, props.a.snapshots.length - 1))}
            playing={props.playing}
            speed={props.speed}
            onOpen={props.onOpen}
          />
        </div>
        <div className="compare-col">
          <StatusStrip state={bState} />
          <ChronicleFeed
            state={bState}
            events={eventsUpTo(props.b, Math.min(turn, props.b.snapshots.length - 1))}
            playing={props.playing}
            speed={props.speed}
            onOpen={props.onOpen}
          />
        </div>
      </div>
      <PlaybackBar
        turn={turn}
        turnCount={maxTurn}
        playing={props.playing}
        speed={props.speed}
        config={aState.config}
        onPlay={props.onPlay}
        onPause={props.onPause}
        onSeek={props.onSeek}
        onSpeed={props.onSpeed}
      />
    </div>
  )
}

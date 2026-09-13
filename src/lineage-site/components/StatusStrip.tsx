import type { ReactNode } from 'react'
import type { LineageState } from '../../lineage/types'
import { seasonProgress, statusLeft, statusRight } from '../model'

export function StatusStrip(props: {
  state: LineageState
  accent?: string
  extra?: ReactNode
}) {
  const pct = Math.round(seasonProgress(props.state) * 100)
  return (
    <header className="status-strip" data-testid="status-strip">
      <span>{statusLeft(props.state)}</span>
      <div className="tools">
        {props.extra}
        <span className="right">{statusRight(props.state)}</span>
      </div>
      <div className="status-progress" style={{ ['--accent' as string]: props.accent }}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </header>
  )
}

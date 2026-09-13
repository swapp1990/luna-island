import { useEffect, useRef, type ReactNode } from 'react'
import type { LineageState } from '../../lineage/types'
import type { SimEvent } from '../../sim/types'
import { feedEntries, monogramColor, monogramLetters, tickerLine, turnName } from '../model'

function Heart() {
  return (
    <svg className="heart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 21s-6.6-4.4-9.4-8.3C.4 10 .6 6.5 3.4 4.7c2-1.3 4.6-1 6.3.8L12 8l2.3-2.5c1.7-1.8 4.3-2.1 6.3-.8 2.8 1.8 3 5.3.8 8C18.6 16.6 12 21 12 21z" />
    </svg>
  )
}

function Mono(props: { id: string; name: string }) {
  return (
    <span className="mono" style={{ background: monogramColor(props.id || props.name) }}>
      {monogramLetters(props.name || props.id)}
    </span>
  )
}

export function ChronicleFeed(props: {
  state: LineageState
  events: readonly SimEvent[]
  playing: boolean
  speed: number
  onOpen(id: string): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const entries = feedEntries(props.events, props.state)

  useEffect(() => {
    const el = ref.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [entries.length, props.state.tick])

  return (
    <section className="panel panel-feed" aria-label="Chronicle feed">
      <div className="turn-chip-row">
        <span className="turn-chip" data-testid="turn-chip">
          <i />
          {turnName(props.state.turn)}
        </span>
        {props.playing && props.speed === 64 ? <span className="ff-cue">64× fast-forward</span> : null}
      </div>
      <div
        className="feed"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {entries.map((en) => {
          if (en.kind === 'speech') {
            return (
              <article key={en.key} className="feed-entry">
                {en.actorId ? <Mono id={en.actorId} name={en.actorName} /> : <span />}
                <div className="speech-card">
                  <div className="who">
                    <Name ids={en.clickIds} names={[en.actorName, en.targetName]} onOpen={props.onOpen} />
                  </div>
                  <blockquote>“{en.text}”</blockquote>
                </div>
              </article>
            )
          }
          if (en.kind === 'court') {
            return (
              <article key={en.key} className="feed-entry">
                {en.actorId ? <Mono id={en.actorId} name={en.actorName} /> : <span />}
                <div className="court-row">
                  <span className="title">
                    <Name ids={en.clickIds} names={[en.actorName, en.targetName]} onOpen={props.onOpen} />
                    {en.targetName ? ` courts ${en.targetName}` : ''}
                  </span>
                  <Heart />
                </div>
              </article>
            )
          }
          if (en.kind === 'system') {
            return (
              <article key={en.key} className="feed-entry">
                <div className="system-card">
                  <span className="title">
                    <Name ids={en.clickIds} names={[en.actorName]} onOpen={props.onOpen} />
                    {en.title.endsWith('is starving') ? ' is starving' : en.title.replace(en.actorName, '')}
                  </span>
                  {en.reason ? <div className="reason">{en.reason}</div> : null}
                </div>
              </article>
            )
          }
          if (en.kind === 'card') {
            return (
              <article key={en.key} className="feed-entry">
                <div className="full-card">
                  <span className="title">{en.title}</span>
                  {en.text ? <div className="reason">{en.text}</div> : null}
                </div>
              </article>
            )
          }
          return (
            <article key={en.key} className="feed-entry">
              {en.actorId ? <Mono id={en.actorId} name={en.actorName} /> : <span />}
              <div className="body">
                <div className="title">
                  <Name ids={en.clickIds} names={[en.actorName, en.targetName]} onOpen={props.onOpen} label={en.title} />
                </div>
                {en.reason ? <div className="reason">{en.reason}</div> : null}
              </div>
            </article>
          )
        })}
      </div>
      <div className="ticker">{tickerLine(props.state)}</div>
    </section>
  )
}

function Name(props: {
  ids: string[]
  names: Array<string | undefined>
  onOpen(id: string): void
  label?: string
}) {
  if (props.label) {
    let rest = props.label
    const parts: ReactNode[] = []
    props.ids.forEach((id, i) => {
      const n = props.names[i]
      if (!n) return
      const at = rest.indexOf(n)
      if (at < 0) return
      if (at > 0) parts.push(rest.slice(0, at))
      parts.push(
        <button key={id + i} type="button" className="name-btn" onClick={() => props.onOpen(id)}>
          {n}
        </button>,
      )
      rest = rest.slice(at + n.length)
    })
    parts.push(rest)
    return <>{parts}</>
  }
  return (
    <button
      type="button"
      className="name-btn"
      onClick={() => props.ids[0] && props.onOpen(props.ids[0])}
    >
      {props.names.filter(Boolean).join(' → ')}
    </button>
  )
}

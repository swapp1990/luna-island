import { dnaText } from '../../lineage/genome'
import type { LineageState, Villager } from '../../lineage/types'
import type { SimEvent } from '../../sim/types'
import { currentActFor, fullName, grain1, livingList, monogramColor, monogramLetters, parentLine } from '../model'

function Need(props: { label: string; value: number; accent?: boolean }) {
  const pct = Math.round(props.value * 100)
  return (
    <div className="need">
      {props.label} {pct}%
      <div className={`need-bar${props.accent ? ' is-accent' : ''}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function VillagerCard(props: {
  state: LineageState
  events: readonly SimEvent[]
  villagerId: string | null
  onSelect(id: string): void
}) {
  const living = livingList(props.state)
  const byId = new Map(props.state.villagers.map((v) => [v.id, v]))
  const selected: Villager | undefined =
    (props.villagerId ? byId.get(props.villagerId) : undefined) ?? living[0]
  if (!selected) {
    return (
      <section className="panel panel-card" aria-label="Villager card">
        <div className="card-wrap">
          <p className="sub">No villagers remain.</p>
        </div>
      </section>
    )
  }
  const idx = Math.max(0, living.findIndex((v) => v.id === selected.id))
  const act = currentActFor(props.events, selected, props.state)
  const courted = selected.courted
    .map((id) => byId.get(id) ?? props.state.lineage.find((r) => r.id === id))
    .filter((v): v is NonNullable<typeof v> => v != null)
  const nowTitle = act
    ? act.title.replace(`${fullName(selected)} `, '')
    : 'waits'
  return (
    <section className="panel panel-card" aria-label="Villager card">
      <div className="card-wrap">
        <article className="villager-card">
          <h2>{fullName(selected)}</h2>
          <p className="sub">{parentLine(selected, props.state.lineage)}</p>
          <div className="kicker">GENOME</div>
          <p className="genome">{dnaText(selected.traits)}</p>
          <Need label="satiety" value={selected.satiety} />
          <Need label="energy" value={selected.energy} accent={selected.energy < 0.3} />
          <Need label="companionship" value={selected.companionship} />
          <div className="kicker">NOW</div>
          <p className="now-act">{nowTitle}</p>
          {act?.reason ? <p className="now-reason">“{act.reason}”</p> : null}
          <div className="courted">
            courted:{' '}
            {courted.length
              ? courted.map((v) => fullName(v)).join(', ')
              : '—'}
            <div className="courted-row">
              {courted.map((v) => {
                const id = v.id
                const name = fullName(v)
                return (
                  <button key={id} type="button" onClick={() => props.onSelect(id)} title={name}>
                    <span className="mono" style={{ background: monogramColor(id) }}>
                      {monogramLetters(name)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="meta-row">
            <span>grain {grain1(selected.grain)}</span>
            <span>standing {selected.standing}</span>
          </div>
        </article>
        {living.length > 0 ? (
          <div className="carousel">
            <button
              type="button"
              aria-label="Previous villager"
              onClick={() => {
                const n = living[(idx - 1 + living.length) % living.length]
                if (n) props.onSelect(n.id)
              }}
            >
              ‹
            </button>
            <div className="dots" aria-hidden="true">
              {living.slice(0, 8).map((v, i) => (
                <i key={v.id} className={i === idx % 8 ? 'on' : ''} />
              ))}
            </div>
            <button
              type="button"
              aria-label="Next villager"
              onClick={() => {
                const n = living[(idx + 1) % living.length]
                if (n) props.onSelect(n.id)
              }}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

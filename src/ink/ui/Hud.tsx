import { INK_CONFIG } from '../sim/config'
import { INK_SPEEDS, type InkBridgeControl, type InkBridgeState, type InkMindBridge } from '../loop'

function EngineBadge(props: { state: InkBridgeState }) {
  const e = props.state.engine
  const hole = e.brain === 'grok' && (e.fallback > 0 || e.stale > 0)
  const label = e.brain === 'grok' ? e.model || 'grok' : 'rule'
  const budget =
    e.brain === 'grok'
      ? ` · budget ${e.budget.hour}/${e.budget.maxPerHour}h ${e.budget.day}/${e.budget.maxPerDay}d`
      : ''
  const run = e.runId ? ` · ${e.runId}` : ''
  return (
    <p className="ink-engine" data-hole={hole ? '1' : '0'}>
      {label} · hour {e.hourDecisions} · llm {e.llm} / fallback {e.fallback} / stale {e.stale}
      {budget}
      {run}
    </p>
  )
}

function pct(n: number): string {
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`
}

function Need(props: { label: string; value: number }) {
  return (
    <div className="ink-need">
      <span>{props.label}</span>
      <div className="ink-bar">
        <i style={{ width: pct(props.value) }} />
      </div>
      <span>{props.value.toFixed(2)}</span>
    </div>
  )
}

function MindCard(props: { mind: InkMindBridge }) {
  const m = props.mind
  const slots = Array.from({ length: INK_CONFIG.fridgeCapacity }, (_, i) => i < m.fridge)
  return (
    <section className="ink-mind" data-source={m.source}>
      <h2>
        {m.id}
        <span>{m.at ?? 'road'} · {m.action ?? '—'}</span>
      </h2>
      <Need label="hunger" value={m.hunger} />
      <Need label="energy" value={m.energy} />
      <Need label="social" value={m.social} />
      <div className="ink-meta">
        <span>money {Math.round(m.money)}</span>
        <span data-source={m.source}>{m.source}</span>
      </div>
      <div className="ink-fridge" title={`fridge ${m.fridge}/${INK_CONFIG.fridgeCapacity}`}>
        {slots.map((full, i) => (
          <b key={i} data-full={full ? '1' : '0'} />
        ))}
      </div>
      <p className="ink-reason">
        {m.reason ? m.reason : <em>no decision yet</em>}
      </p>
    </section>
  )
}

export function Hud(props: { state: InkBridgeState; control: InkBridgeControl }) {
  const { state, control } = props
  const hh = String(state.hour).padStart(2, '0')
  const mm = String(state.minute).padStart(2, '0')
  return (
    <aside className="ink-hud">
      <h1>Ink Town</h1>
      <p className="ink-sub">
        {state.dayName} {hh}:{mm} · day {state.day} · {state.eventCount} events
      </p>
      <EngineBadge state={state} />
      <div className="ink-speeds">
        <button type="button" data-on={state.paused ? '1' : '0'} onClick={() => control.pause()}>
          pause
        </button>
        <button type="button" data-on={!state.paused ? '1' : '0'} onClick={() => control.resume()}>
          play
        </button>
        {INK_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            data-on={!state.paused && state.speed === s ? '1' : '0'}
            onClick={() => control.setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      {state.minds.map((m) => (
        <MindCard key={m.id} mind={m} />
      ))}
    </aside>
  )
}

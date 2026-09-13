import { useEffect, useState } from 'react'
import { fetchExpression, type LineageRunInfo, type ProbeInfo, type ReplicateInfo } from '../api'

const GROUP_ORDER = ['gate', 'gate2', 'gate3y1', 'courtship / random', 'mock', 'smoke']

function groupOf(run: LineageRunInfo): string {
  if (run.tag === 'courtship' || run.tag === 'random') return 'courtship / random'
  if (run.tag) return run.tag
  return 'other'
}

function configLine(run: LineageRunInfo): string {
  const bits: string[] = []
  if (run.harvestYield != null) bits.push(`yield ${run.harvestYield}`)
  if (run.seasons != null) bits.push(`${run.seasons} seasons`)
  if (run.cohort != null) bits.push(`cohort ${run.cohort}`)
  if (run.mating) bits.push(run.mating)
  if (run.dna) bits.push(`dna ${run.dna}`)
  if (run.seed != null) bits.push(`seed ${run.seed}`)
  if (run.brain) bits.push(run.brain)
  return bits.join(' · ')
}

export function ExperimentIndex(props: {
  runs: LineageRunInfo[]
  probes: ProbeInfo[]
  replicates: ReplicateInfo[]
  onOpen(id: string): void
}) {
  const [expressed, setExpressed] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    for (const r of props.runs) {
      if (!r.hasExpression) continue
      void fetchExpression(r.id).then((json) => {
        if (cancelled || !json) return
        setExpressed((prev) => ({
          ...prev,
          [r.id]: `${json.expressed}/${json.dispositionPairs} expressed`,
        }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [props.runs])

  const groups = new Map<string, LineageRunInfo[]>()
  for (const run of props.runs) {
    const g = groupOf(run)
    const list = groups.get(g) ?? []
    list.push(run)
    groups.set(g, list)
  }
  const order = [
    ...GROUP_ORDER.filter((g) => groups.has(g)),
    ...[...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ]

  return (
    <div className="index">
      <h1 className="index-title">Luna Island · Lineage — experiments in heritable minds</h1>
      <p className="index-lede">
        Recorded hamlets, replayed from their decisions. Open a run to watch the chronicle, the
        bloodlines, and whether the genome showed up in the acts.
      </p>
      {order.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          {(groups.get(g) ?? []).map((run) => {
            const extinct =
              (run.generationsBorn ?? 0) === 0 && (run.departuresByStarvation ?? 0) > 0
            return (
              <article key={run.id} className="run-card">
                <div>
                  <div>{run.id}</div>
                  <div className="cfg">{configLine(run)}</div>
                  <div className="badges">
                    {extinct ? <span className="badge extinct">extinct</span> : null}
                    {run.generationsBorn != null ? (
                      <span className="badge">{run.generationsBorn} born</span>
                    ) : null}
                    {run.departuresByStarvation != null ? (
                      <span className="badge">{run.departuresByStarvation} starved</span>
                    ) : null}
                    {expressed[run.id] ? <span className="badge">{expressed[run.id]}</span> : null}
                  </div>
                </div>
                <button type="button" className="open-btn" onClick={() => props.onOpen(run.id)}>
                  Open
                </button>
              </article>
            )
          })}
        </section>
      ))}
      <section aria-label="Probes">
        <h2>Probes</h2>
        {props.probes.length === 0 ? <p className="cfg">No probe files.</p> : null}
        {props.probes.map((p) => (
          <article key={p.id} className="probe-card">
            <div>
              <div>{p.id}</div>
              <div className="cfg">
                {p.mode ?? 'probe'}
                {p.effort ? ` · ${p.effort}` : ''}
                {p.dna ? ` · dna ${p.dna}` : ''}
                {p.band ? ` · band ${p.band}` : ''}
                {' · '}
                {p.summary.probeDisposition}/{p.summary.n} disposition on probe
                {' · '}
                {p.summary.changed}/{p.summary.n} changed
              </div>
            </div>
          </article>
        ))}
      </section>
      <section aria-label="Replicates">
        <h2>Replicates</h2>
        {props.replicates.length === 0 ? <p className="cfg">No replicate aggregates.</p> : null}
        {props.replicates.map((r) => {
          const met = r.deltas?.metabolism
          const c = met?.courtship?.mean
          const rnd = met?.random?.mean
          return (
            <article key={r.id} className="rep-card">
              <div>
                <div>{r.id}</div>
                <div className="cfg">
                  yield {r.yield ?? '?'} · n {r.n ?? '?'}
                  {c != null ? ` · metabolism Δ courtship ${c.toFixed(3)}` : ''}
                  {rnd != null ? ` · random ${rnd.toFixed(3)}` : ''}
                </div>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}

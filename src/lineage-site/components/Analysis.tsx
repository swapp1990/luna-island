import type { ExpressionJson } from '../../lineage/render/expression'
import type { LineageConfig } from '../../lineage/types'
import type { LineageMindStats, LineageRunInfo, ProbeInfo } from '../api'

function fmt(n: number): string {
  return n.toFixed(4)
}

export function Analysis(props: {
  expression: ExpressionJson | null
  rankMd: string | null
  mind: LineageMindStats | null
  config: LineageConfig
  dna: 'on' | 'off' | null
  hash: string
  replayOk: boolean | null
  probes: ProbeInfo[]
  sibling: LineageRunInfo | null
  onCompare(id: string): void
}) {
  const rows = props.expression?.rows ?? []
  const expressed = props.expression
    ? `${props.expression.expressed}/${props.expression.dispositionPairs} expressed`
    : null
  return (
    <section className="panel panel-analysis" aria-label="Analysis">
      <div className="analysis">
        <div>
          {props.replayOk === true ? (
            <span className="replay-badge ok">replay verified · hash {props.hash}</span>
          ) : props.replayOk === false ? (
            <span className="replay-badge bad">replay mismatch · hash {props.hash}</span>
          ) : (
            <span className="replay-badge">replay · hash {props.hash}</span>
          )}
        </div>
        <div>
          <h3>Config</h3>
          <p className="config-block">
            yield {props.config.harvestYield} · {props.config.seasons} seasons · cohort{' '}
            {props.config.cohortSize} · {props.config.mating}
            {props.dna ? ` · dna ${props.dna}` : ''}
            {expressed ? ` · ${expressed}` : ''}
          </p>
        </div>
        {props.mind ? (
          <div>
            <h3>Mind</h3>
            <p className="config-block">
              llm {props.mind.llm} · fallback {props.mind.fallback} · invalid {props.mind.invalid} ·
              mean {Math.round(props.mind.meanLatencyMs)} ms
            </p>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div>
            <h3>Expression</h3>
            <div className="expr-wrap">
              <div className="expr-scroll" data-testid="expr-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="expr-trait">trait</th>
                      <th>act</th>
                      <th>n_low</th>
                      <th>n_mid</th>
                      <th>n_high</th>
                      <th>mean_low</th>
                      <th>mean_mid</th>
                      <th>mean_high</th>
                      <th>slope</th>
                      <th>p</th>
                      <th className="expr-flag">expressed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.trait}-${r.act}`}>
                        <td className="expr-trait">{r.trait}</td>
                        <td>{r.act}</td>
                        <td>{r.n.low}</td>
                        <td>{r.n.mid}</td>
                        <td>{r.n.high}</td>
                        <td>{fmt(r.mean.low)}</td>
                        <td>{fmt(r.mean.mid)}</td>
                        <td>{fmt(r.mean.high)}</td>
                        <td>{fmt(r.slope)}</td>
                        <td>{fmt(r.p)}</td>
                        <td className={`expr-flag ${r.expressed ? 'yes' : 'no'}`}>
                          {r.expressed ? 'yes' : 'no'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
        {props.rankMd ? (
          <div>
            <h3>Rank correlation</h3>
            <pre className="md-pre">{props.rankMd}</pre>
          </div>
        ) : null}
        {props.sibling ? (
          <div>
            <h3>DNA on vs off</h3>
            <p className="config-block">
              Sibling run {props.sibling.id} (dna {props.sibling.dna ?? '?'}).{' '}
              <button type="button" className="open-btn" onClick={() => props.onCompare(props.sibling!.id)}>
                Compare
              </button>
            </p>
          </div>
        ) : null}
        {props.probes.length > 0 ? (
          <div>
            <h3>Probes</h3>
            {props.probes.map((p) => (
              <p key={p.id} className="config-block">
                {p.id}: {p.summary.probeDisposition}/{p.summary.n} disposition on probe ·{' '}
                {p.summary.changed}/{p.summary.n} changed
                {p.mode ? ` · ${p.mode}` : ''}
                {p.effort ? ` ${p.effort}` : ''}
                {p.dna ? ` dna ${p.dna}` : ''}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

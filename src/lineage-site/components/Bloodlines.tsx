import { useLayoutEffect, useRef, useState } from 'react'
import type { LineageState } from '../../lineage/types'
import {
  driftSparklines,
  heatRows,
  layoutTree,
  sparkPath,
  TRAIT_HEADERS,
  type Sparkline,
} from '../model'

function SparkChart(props: { spark: Sparkline }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 120, h: 36 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      setBox({
        w: Math.max(60, Math.floor(el.clientWidth) || 60),
        h: Math.max(20, Math.floor(el.clientHeight) || 36),
      })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w, h } = box
  const d = sparkPath(props.spark.values, w, h)
  const grid = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="spark">
      <h4>
        {props.spark.trait}
        {props.spark.arrow === 'up' ? ' ↑' : props.spark.arrow === 'down' ? ' ↓' : ''}
      </h4>
      <div className="spark-plot" ref={ref}>
        <svg
          className="spark-svg"
          data-testid="spark-svg"
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
          preserveAspectRatio="none"
        >
          {grid.map((g) => (
            <line
              key={g}
              className="spark-grid"
              x1={g * w}
              y1={0}
              x2={g * w}
              y2={h}
            />
          ))}
          <path d={d} />
        </svg>
      </div>
    </div>
  )
}

export function Bloodlines(props: {
  state: LineageState
  snapshots: readonly LineageState[]
  turn: number
  villagerId: string | null
  onOpen(id: string): void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [treeW, setTreeW] = useState(320)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => setTreeW(Math.max(120, Math.floor(el.clientWidth) || 320))
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const living = new Set(props.state.villagers.filter((v) => v.status === 'alive').map((v) => v.id))
  const tree = layoutTree(props.state.lineage, living, props.villagerId, treeW)
  const heat = heatRows(props.state)
  const sparks = driftSparklines(props.snapshots, props.turn)
  const gens = new Set(tree.nodes.map((n) => n.generation))
  const nonFounders = tree.nodes.filter((n) => !n.founder).length
  return (
    <section className="panel panel-blood" aria-label="Bloodlines" data-testid="bloodlines">
      <div className="blood">
        <div className="blood-block">
          <h3>Family tree</h3>
          <div className="tree-scroll" ref={wrapRef}>
            <svg
              className="tree-svg"
              data-testid="family-tree"
              data-pills={tree.nodes.length}
              data-edges={tree.edges.length}
              data-born={props.state.lineage.length}
              width="100%"
              height={tree.height}
              viewBox={`0 0 ${tree.width} ${tree.height}`}
              preserveAspectRatio="xMidYMin meet"
            >
              {[...gens].sort((a, b) => a - b).map((g) => {
                const sample = tree.nodes.find((n) => n.generation === g)
                const y = (sample?.y ?? 8) + (sample?.h ?? 26) / 2
                return (
                  <text key={`g${g}`} className="tree-gen" x={2} y={y}>
                    g{g}
                  </text>
                )
              })}
              {tree.edges.map((e, i) => (
                <path key={i} className="tree-edge" data-testid="tree-edge" d={e.d} />
              ))}
              {tree.nodes.map((n) => (
                <g
                  key={n.id}
                  data-testid="tree-pill"
                  data-founder={n.founder ? '1' : '0'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => props.onOpen(n.id)}
                >
                  <title>{n.name}</title>
                  <rect
                    className={`tree-node${n.highlighted ? ' hi' : n.glow ? ' glow' : ''}`}
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={n.h / 2}
                  />
                  <text
                    className={`tree-label${n.highlighted ? ' hi' : ''}`}
                    x={n.x + n.w / 2}
                    y={n.y + n.h / 2}
                    fontSize={n.fontSize}
                  >
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
            <span className="sr-only">
              {tree.nodes.length} pills, {tree.edges.length} edges, {nonFounders} non-founders
            </span>
          </div>
        </div>
        <div className="blood-block">
          <h3>Traits · {heat.length} living</h3>
          <div className="heat">
            <div className="heat-head">
              <span className="heat-name-h" />
              {TRAIT_HEADERS.map((h) => (
                <span key={h} className="heat-h" data-testid="heat-h">
                  <span className="heat-h-txt">{h}</span>
                </span>
              ))}
            </div>
            {heat.map((row) => (
              <button
                key={row.id}
                type="button"
                className="heat-row"
                onClick={() => props.onOpen(row.id)}
              >
                <span className="heat-name">{row.name}</span>
                {row.bands.map((b, i) => (
                  <i key={i} className={`cell ${b}`} />
                ))}
              </button>
            ))}
          </div>
        </div>
        <div className="blood-block">
          <h3>Drift</h3>
          <div className="sparks">
            {sparks.map((s) => (
              <SparkChart key={s.trait} spark={s} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

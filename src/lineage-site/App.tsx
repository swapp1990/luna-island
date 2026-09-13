import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ExpressionJson } from '../lineage/render/expression'
import type { LineageSummary } from '../lineage/types'
import {
  fetchDecisions,
  fetchExpression,
  fetchExpressionRank,
  fetchMind,
  fetchProbes,
  fetchReplicates,
  fetchRuns,
  fetchSummary,
  type LineageMindStats,
  type LineageRunInfo,
  type ProbeInfo,
  type ReplicateInfo,
} from './api'
import {
  emptyBridgeState,
  noopControl,
  publishLineage,
  type LineageBridgeControl,
  type LineageSpeed,
  type LineageView,
} from './bridge'
import { Analysis } from './components/Analysis'
import { Bloodlines } from './components/Bloodlines'
import { ChronicleFeed } from './components/ChronicleFeed'
import { CompareView } from './components/CompareView'
import { ExperimentIndex } from './components/ExperimentIndex'
import { PlaybackBar } from './components/PlaybackBar'
import { StatusStrip } from './components/StatusStrip'
import { VillagerCard } from './components/VillagerCard'
import { layoutForWidth, livingList, SPEED_MS, type LayoutName } from './model'
import { buildTimeline, type BuiltTimeline } from './replay'

const VIEWS: LineageView[] = ['feed', 'card', 'bloodlines', 'analysis']
const VIEW_LABEL: Record<LineageView, string> = {
  feed: 'Feed',
  card: 'Card',
  bloodlines: 'Bloodlines',
  analysis: 'Analysis',
}

interface RouteState {
  run: string | null
  t: number
  speed: LineageSpeed
  autoplay: boolean
  view: LineageView
  villager: string | null
  vs: string | null
}

function parseSpeed(raw: string | null): LineageSpeed {
  if (raw === '8') return 8
  if (raw === '64') return 64
  return 1
}

function parseView(raw: string | null): LineageView {
  if (raw === 'card' || raw === 'bloodlines' || raw === 'analysis') return raw
  return 'feed'
}

function parseRoute(): RouteState {
  const q = new URLSearchParams(window.location.search)
  return {
    run: q.get('run'),
    t: Math.max(0, Math.floor(Number(q.get('t') ?? 0)) || 0),
    speed: parseSpeed(q.get('speed')),
    autoplay: q.get('autoplay') === '1',
    view: parseView(q.get('view')),
    villager: q.get('villager'),
    vs: q.get('vs'),
  }
}

function writeRoute(next: RouteState, push = false): void {
  const q = new URLSearchParams()
  if (next.run) q.set('run', next.run)
  if (next.t > 0) q.set('t', String(next.t))
  if (next.speed !== 1) q.set('speed', String(next.speed))
  if (next.autoplay) q.set('autoplay', '1')
  if (next.view !== 'feed') q.set('view', next.view)
  if (next.villager) q.set('villager', next.villager)
  if (next.vs) q.set('vs', next.vs)
  const search = q.toString()
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname
  if (push) history.pushState(next, '', url)
  else history.replaceState(next, '', url)
}

function probeSourceId(p: ProbeInfo): string | null {
  if (!p.run) return null
  const parts = p.run.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || null
}

function eventsUpTo(tl: BuiltTimeline, turn: number) {
  const end = tl.turnStarts[Math.min(turn + 1, tl.turnStarts.length - 1)] ?? tl.events.length
  return tl.events.slice(0, end)
}

export function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute())
  const [width, setWidth] = useState(() => window.innerWidth)
  const [runs, setRuns] = useState<LineageRunInfo[]>([])
  const [probes, setProbes] = useState<ProbeInfo[]>([])
  const [replicates, setReplicates] = useState<ReplicateInfo[]>([])

  const go = useCallback((patch: Partial<RouteState>, push = false) => {
    setRoute((prev) => {
      const next = { ...prev, ...patch }
      writeRoute(next, push)
      return next
    })
  }, [])

  useEffect(() => {
    const onPop = () => setRoute(parseRoute())
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('popstate', onPop)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchRuns(), fetchProbes(), fetchReplicates()]).then(([r, p, rep]) => {
      if (cancelled) return
      setRuns(r)
      setProbes(p)
      setReplicates(rep)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const layout = layoutForWidth(width)
  useLayoutEffect(() => {
    document.getElementById('lineage-root')?.setAttribute('data-layout', layout)
  }, [layout])

  const controlRef = useRef<LineageBridgeControl>({ ...noopControl })

  useLayoutEffect(() => {
    controlRef.current.loadRun = (id: string) => {
      go({ run: id, vs: null, t: 0, autoplay: false, villager: null }, true)
    }
    controlRef.current.compare = (id: string | null) => {
      go({ vs: id, t: 0, autoplay: false })
    }
    controlRef.current.setView = (name: string) => {
      go({ view: parseView(name) })
    }
    controlRef.current.openVillager = (id: string | null) => {
      go({ villager: id, view: layout === 'single' && id ? 'card' : route.view })
    }
  })

  if (!route.run) {
    return (
      <IndexShell
        runs={runs}
        probes={probes}
        replicates={replicates}
        width={width}
        layout={layout}
        controlRef={controlRef}
        onOpen={(id) => go({ run: id, t: 0, autoplay: false }, true)}
      />
    )
  }

  if (route.vs) {
    return (
      <CompareShell
        route={route}
        width={width}
        layout={layout}
        go={go}
        controlRef={controlRef}
      />
    )
  }

  return (
    <RunPage
      route={route}
      width={width}
      layout={layout}
      runs={runs}
      probes={probes}
      go={go}
      controlRef={controlRef}
    />
  )
}

function IndexShell(props: {
  runs: LineageRunInfo[]
  probes: ProbeInfo[]
  replicates: ReplicateInfo[]
  width: number
  layout: LayoutName
  controlRef: { current: LineageBridgeControl }
  onOpen(id: string): void
}) {
  useLayoutEffect(() => {
    publishLineage(
      {
        ...emptyBridgeState(props.width),
        ready: true,
        view: 'index',
        width: props.width,
      },
      props.controlRef.current,
    )
  }, [props.width, props.runs.length, props.controlRef])
  return (
    <div className="lineage-shell" data-layout={props.layout} data-view="index">
      <ExperimentIndex
        runs={props.runs}
        probes={props.probes}
        replicates={props.replicates}
        onOpen={props.onOpen}
      />
    </div>
  )
}

function CompareShell(props: {
  route: RouteState
  width: number
  layout: LayoutName
  go: (patch: Partial<RouteState>, push?: boolean) => void
  controlRef: { current: LineageBridgeControl }
}) {
  const aId = props.route.run!
  const bId = props.route.vs!
  const [pair, setPair] = useState<{ a: BuiltTimeline; b: BuiltTimeline } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turn, setTurn] = useState(props.route.t)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<LineageSpeed>(props.route.speed)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    void (async () => {
      try {
        const [sa, da, sb, db] = await Promise.all([
          fetchSummary(aId),
          fetchDecisions(aId),
          fetchSummary(bId),
          fetchDecisions(bId),
        ])
        if (cancelled) return
        setPair({
          a: buildTimeline(sa.config, da, sa.hash),
          b: buildTimeline(sb.config, db, sb.hash),
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [aId, bId])

  const turnCount = pair ? Math.max(pair.a.snapshots.length, pair.b.snapshots.length) : 0
  useEffect(() => {
    if (!playing || turnCount <= 1) return
    const id = window.setInterval(() => {
      setTurn((t) => {
        if (t >= turnCount - 1) {
          setPlaying(false)
          return t
        }
        return t + 1
      })
    }, SPEED_MS[speed])
    return () => window.clearInterval(id)
  }, [playing, speed, turnCount])

  useLayoutEffect(() => {
    props.controlRef.current.play = () => setPlaying(true)
    props.controlRef.current.pause = () => setPlaying(false)
    props.controlRef.current.setSpeed = (n: number) => setSpeed(parseSpeed(String(n)))
    props.controlRef.current.seek = (t: number) => {
      setPlaying(false)
      setTurn(Math.max(0, Math.min(turnCount - 1, Math.floor(t))))
    }
    props.controlRef.current.step = (delta: number) => {
      setPlaying(false)
      setTurn((t) => Math.max(0, Math.min(turnCount - 1, t + delta)))
    }
    const aState = pair?.a.snapshots[Math.min(turn, (pair?.a.snapshots.length ?? 1) - 1)]
    publishLineage(
      {
        ready: ready && !!pair,
        runId: aId,
        turn,
        turnCount,
        season: aState?.season ?? 0,
        day: aState?.day ?? 0,
        turnOfDay: aState?.turn ?? 0,
        speed,
        playing,
        alive: aState ? livingList(aState).length : 0,
        generation: aState ? livingList(aState).reduce((g, v) => Math.max(g, v.generation), 0) : 0,
        view: 'compare',
        villagerId: props.route.villager,
        replayOk: pair ? pair.a.replayOk !== false && pair.b.replayOk !== false : null,
        width: props.width,
      },
      props.controlRef.current,
    )
  })

  useLayoutEffect(() => {
    if (pair) setReady(true)
  }, [pair])

  useEffect(() => {
    if (ready && props.route.autoplay) setPlaying(true)
  }, [ready, props.route.autoplay])

  if (error) return <div className="error">{error}</div>
  if (!pair) return <div className="loading">Replaying both hamlets…</div>
  return (
    <div className="lineage-shell" data-layout={props.layout} data-view="compare">
      <CompareView
        aId={aId}
        bId={bId}
        a={pair.a}
        b={pair.b}
        turn={turn}
        playing={playing}
        speed={speed}
        phone={props.layout === 'single'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onSeek={(t) => {
          setPlaying(false)
          setTurn(t)
        }}
        onSpeed={setSpeed}
        onOpen={(id) => props.go({ villager: id })}
        onSwitch={(id) => props.go({ run: id, vs: null }, true)}
      />
    </div>
  )
}

function RunPage(props: {
  route: RouteState
  width: number
  layout: LayoutName
  runs: LineageRunInfo[]
  probes: ProbeInfo[]
  go: (patch: Partial<RouteState>, push?: boolean) => void
  controlRef: { current: LineageBridgeControl }
}) {
  const runId = props.route.run!
  const [bundle, setBundle] = useState<{
    summary: LineageSummary
    timeline: BuiltTimeline
    expression: ExpressionJson | null
    rankMd: string | null
    mind: LineageMindStats | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [turn, setTurn] = useState(props.route.t)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<LineageSpeed>(props.route.speed)
  const [ready, setReady] = useState(false)
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setBundle(null)
    setError(null)
    void (async () => {
      try {
        const [summary, decisions, expression, rankMd, mind] = await Promise.all([
          fetchSummary(runId),
          fetchDecisions(runId),
          fetchExpression(runId),
          fetchExpressionRank(runId),
          fetchMind(runId),
        ])
        if (cancelled) return
        const timeline = buildTimeline(summary.config, decisions, summary.hash)
        setBundle({ summary, timeline, expression, rankMd, mind })
        setTurn(Math.min(props.route.t, Math.max(0, timeline.snapshots.length - 1)))
        setSpeed(props.route.speed)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const timeline = bundle?.timeline ?? null
  const turnCount = timeline?.snapshots.length ?? 0
  const snap = timeline?.snapshots[Math.min(turn, Math.max(0, turnCount - 1))] ?? null
  const events = timeline ? eventsUpTo(timeline, turn) : []
  const info = props.runs.find((r) => r.id === runId) ?? null
  const sibling =
    info && info.tag && info.dna
      ? props.runs.find((r) => r.id !== runId && r.tag === info.tag && r.dna && r.dna !== info.dna) ??
        null
      : null
  const runProbes = props.probes.filter((p) => {
    const src = probeSourceId(p)
    if (src === runId) return true
    if (src && info?.tag && src.startsWith(`${info.tag}-`)) return true
    return false
  })

  useEffect(() => {
    if (!playing || turnCount <= 1) return
    const id = window.setInterval(() => {
      setTurn((t) => {
        if (t >= turnCount - 1) {
          setPlaying(false)
          return t
        }
        return t + 1
      })
    }, SPEED_MS[speed])
    return () => window.clearInterval(id)
  }, [playing, speed, turnCount])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const span = snap?.config.turnsPerDay ?? 4
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        setTurn((t) => Math.min(turnCount - 1, t + (e.shiftKey ? span : 1)))
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        setTurn((t) => Math.max(0, t - (e.shiftKey ? span : 1)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turnCount, snap?.config.turnsPerDay])

  useLayoutEffect(() => {
    if (timeline) setReady(true)
  }, [timeline])

  useEffect(() => {
    if (ready && props.route.autoplay) setPlaying(true)
  }, [ready, props.route.autoplay])

  const openVillager = useCallback(
    (id: string | null) => {
      props.go({ villager: id })
      if (props.layout === 'single' && id && props.route.view === 'feed') setSheet(true)
      else setSheet(false)
    },
    [props, props.layout, props.route.view],
  )

  useLayoutEffect(() => {
    const c = props.controlRef.current
    c.play = () => setPlaying(true)
    c.pause = () => {
      setPlaying(false)
      writeRoute({ ...props.route, t: turn, speed, autoplay: false, villager: props.route.villager })
    }
    c.setSpeed = (n: number) => {
      const next = parseSpeed(String(n))
      setSpeed(next)
      props.go({ speed: next })
    }
    c.seek = (t: number) => {
      setPlaying(false)
      const clamped = Math.max(0, Math.min(turnCount - 1, Math.floor(t)))
      setTurn(clamped)
    }
    c.step = (delta: number) => {
      setPlaying(false)
      setTurn((t) => Math.max(0, Math.min(turnCount - 1, t + delta)))
    }
    c.setView = (name: string) => {
      setSheet(false)
      props.go({ view: parseView(name) })
    }
    c.openVillager = (id: string | null) => openVillager(id)
    const living = snap ? livingList(snap) : []
    publishLineage(
      {
        ready: ready && !!timeline,
        runId,
        turn,
        turnCount,
        season: snap?.season ?? 0,
        day: snap?.day ?? 0,
        turnOfDay: snap?.turn ?? 0,
        speed,
        playing,
        alive: living.length,
        generation: living.reduce((g, v) => Math.max(g, v.generation), 0),
        view: props.route.view,
        villagerId: props.route.villager,
        replayOk: timeline?.replayOk ?? null,
        width: props.width,
      },
      c,
    )
  })

  const view = props.route.view
  const layout = props.layout
  const accent =
    view === 'card' ? 'var(--gold)' : view === 'bloodlines' ? 'var(--teal)' : 'var(--ember)'

  if (error) return <div className="error">{error}</div>
  if (!bundle || !snap || !timeline) return <div className="loading">Replaying hamlet…</div>

  const villagerId = props.route.villager
  const analysisOpen = view === 'analysis'
  const showFeed = layout !== 'single' || view === 'feed'
  const showCard =
    layout === 'four' ||
    layout === 'three' ||
    (layout === 'two' && view !== 'analysis') ||
    (layout === 'single' && view === 'card')
  const showBlood =
    layout === 'four' ||
    layout === 'three' ||
    (layout === 'two' && view !== 'analysis') ||
    (layout === 'single' && view === 'bloodlines')
  const showAnalysis =
    layout === 'four' ||
    (layout === 'two' && view === 'analysis') ||
    (layout === 'single' && view === 'analysis')
  const showDrawer = layout === 'three' && analysisOpen

  const analysis = (
    <Analysis
      expression={bundle.expression}
      rankMd={bundle.rankMd}
      mind={bundle.mind}
      config={snap.config}
      dna={info?.dna ?? null}
      hash={timeline.hash}
      replayOk={timeline.replayOk}
      probes={runProbes}
      sibling={sibling}
      onCompare={(id) => props.go({ vs: id, t: turn })}
    />
  )

  const extra = (
    <>
      {timeline.replayOk === false ? (
        <span className="replay-badge bad">replay mismatch</span>
      ) : null}
      {layout === 'three' ? (
        <button type="button" className="open-btn" onClick={() => props.go({ view: analysisOpen ? 'feed' : 'analysis' })}>
          Analysis
        </button>
      ) : null}
    </>
  )

  return (
    <div
      className="lineage-shell"
      data-layout={layout}
      data-view={view}
      data-sheet={layout === 'single' && sheet && villagerId && view === 'feed' ? '1' : undefined}
      style={{ ['--accent' as string]: accent }}
    >
      <StatusStrip state={snap} accent={accent} extra={extra} />
      {layout === 'single' ? (
        <nav className="tabs tabs-main" aria-label="Panels">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'is-on' : ''}
              onClick={() => {
                setSheet(false)
                props.go({ view: v })
              }}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </nav>
      ) : layout === 'two' ? (
        <nav className="tabs tabs-right" aria-label="Right column">
          <button
            type="button"
            className={view !== 'analysis' ? 'is-on' : ''}
            onClick={() => props.go({ view: 'feed' })}
          >
            Hamlet
          </button>
          <button
            type="button"
            className={view === 'analysis' ? 'is-on' : ''}
            onClick={() => props.go({ view: 'analysis' })}
          >
            Analysis
          </button>
        </nav>
      ) : (
        <div />
      )}
      <div className="panels">
        {showFeed ? (
          <ChronicleFeed
            state={snap}
            events={events}
            playing={playing}
            speed={speed}
            onOpen={(id) => openVillager(id)}
          />
        ) : null}
        {layout === 'two' ? (
          <div className="right-col">
            {showAnalysis ? analysis : (
              <div className="right-scroll">
                <VillagerCard
                  state={snap}
                  events={events}
                  villagerId={villagerId}
                  onSelect={(id) => openVillager(id)}
                />
                <Bloodlines
                  state={snap}
                  snapshots={timeline.snapshots}
                  turn={turn}
                  villagerId={villagerId}
                  onOpen={(id) => openVillager(id)}
                />
              </div>
            )}
          </div>
        ) : (
          <>
            {showCard ? (
              <VillagerCard
                state={snap}
                events={events}
                villagerId={villagerId}
                onSelect={(id) => openVillager(id)}
              />
            ) : null}
            {showBlood ? (
              <Bloodlines
                state={snap}
                snapshots={timeline.snapshots}
                turn={turn}
                villagerId={villagerId}
                onOpen={(id) => openVillager(id)}
              />
            ) : null}
            {showAnalysis ? analysis : null}
          </>
        )}
      </div>
      {showDrawer ? <div className="drawer">{analysis}</div> : null}
      {layout === 'single' && sheet && villagerId && view === 'feed' ? (
        <>
          <div className="sheet-backdrop" onClick={() => setSheet(false)} />
          <div className="sheet">
            <VillagerCard
              state={snap}
              events={events}
              villagerId={villagerId}
              onSelect={(id) => openVillager(id)}
            />
          </div>
        </>
      ) : null}
      <PlaybackBar
        turn={turn}
        turnCount={turnCount}
        playing={playing}
        speed={speed}
        config={snap.config}
        accent={accent}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onSeek={(t) => {
          setPlaying(false)
          setTurn(t)
        }}
        onSpeed={(n) => {
          setSpeed(n)
          props.go({ speed: n })
        }}
      />
    </div>
  )
}

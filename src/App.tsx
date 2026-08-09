import { useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './sim/sim'
import { dayStartTick } from './sim/time'
import { createScene, type SceneHandle } from './render/scene'
import { createLoop, type LoopController } from './loop'
import { initBridge, type SimStateBridge } from './bridge'
import { Hud } from './ui/Hud'
import { Timeline } from './ui/Timeline'
import { Inspector } from './ui/Inspector'
import { Ticker } from './ui/Ticker'
import type { AgentState, Place, SimEvent } from './sim/types'

const SEED = 42
const HUD_HZ = 4

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<LoopController | null>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const liveRef = useRef<Simulation | null>(null)

  const [hud, setHud] = useState<SimStateBridge>({
    ready: false,
    mode: 'live',
    day: 1,
    hour: 6,
    minute: 0,
    tick: 0,
    speed: 1,
    agentCount: 0,
    agentIds: [],
    selectedAgentId: null,
    eventCount: 0,
    archivedDayCount: 0,
    viewDay: 1,
  })
  const [liveHeadTick, setLiveHeadTick] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null)
  const [agentEvents, setAgentEvents] = useState<readonly SimEvent[]>([])
  const [allEvents, setAllEvents] = useState<readonly SimEvent[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [owners, setOwners] = useState<Record<string, string>>({})
  const [following, setFollowing] = useState(false)
  const [scrubMin, setScrubMin] = useState(0)
  const [scrubMax, setScrubMax] = useState(0)

  const viewDayStart = useMemo(() => dayStartTick(hud.viewDay), [hud.viewDay])

  const syncFromLoop = () => {
    const loop = loopRef.current
    if (!loop) return
    const s = loop.getState()
    setHud(s)
    if (liveRef.current) setLiveHeadTick(liveRef.current.state.tick)
    const bounds = loop.getDayBounds()
    setScrubMin(bounds.startTick)
    setScrubMax(bounds.endTick)
    const sim = loop.getViewSim()
    const events = sim.getEvents()
    setAllEvents(events)
    setPlaces(sim.state.places.map((p) => ({ ...p, inventory: { ...p.inventory } })))
    setOwners({ ...sim.state.owners })
    setFollowing(loop.getFollow())
    const id = s.selectedAgentId
    if (id) {
      const agent = sim.state.agents.find((a) => a.id === id) ?? null
      setSelectedAgent(
        agent
          ? {
              ...agent,
              needs: { ...agent.needs },
              action: { ...agent.action, path: agent.action.path?.slice() },
            }
          : null,
      )
      setAgentEvents(events)
    } else {
      setSelectedAgent(null)
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const live = new Simulation(SEED)
    liveRef.current = live
    const scene = createScene(el, live.state)
    sceneRef.current = scene
    const loop = createLoop(live, scene)
    loopRef.current = loop

    const selectAgent = (id: string | null) => {
      loop.selectAgent(id)
      if (!id) {
        loop.setFollow(false)
        setFollowing(false)
      }
      const sim = loop.getViewSim()
      const agent = id ? (sim.state.agents.find((a) => a.id === id) ?? null) : null
      setSelectedAgent(agent ? { ...agent, needs: { ...agent.needs }, action: { ...agent.action } } : null)
      const events = sim.getEvents()
      setAgentEvents(events)
      setAllEvents(events)
      setHud(loop.getState())
      setFollowing(loop.getFollow())
    }

    initBridge(
      () => loop.getState(),
      {
        setSpeed: (n) => loop.setSpeed(n),
        pause: () => loop.pause(),
        scrubTo: (t) => {
          loop.scrubTo(t)
          syncFromLoop()
        },
        goLive: () => {
          loop.goLive()
          syncFromLoop()
        },
        selectAgent,
        loadDay: (day) => {
          loop.loadDay(day)
          syncFromLoop()
        },
        ffwd: (n) => {
          loop.ffwd(n)
          syncFromLoop()
        },
      },
    )

    const unbind = scene.bindSelection(selectAgent)

    const onResize = () => {
      scene.resize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)
    onResize()

    loop.start()
    setHud(loop.getState())
    setLiveHeadTick(live.state.tick)
    setAllEvents(live.getEvents())
    const b0 = loop.getDayBounds()
    setScrubMin(b0.startTick)
    setScrubMax(b0.endTick)

    const poll = window.setInterval(() => {
      syncFromLoop()
    }, 1000 / HUD_HZ)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      unbind()
      loop.stop()
      scene.dispose()
      loopRef.current = null
      sceneRef.current = null
      liveRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        id="scene"
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <Hud
        state={hud}
        onSetSpeed={(n) => {
          loopRef.current?.setSpeed(n)
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
      />
      <Ticker
        events={allEvents}
        replayTick={hud.tick}
        dayStartTick={viewDayStart}
        onSelectAgent={(id) => {
          const loop = loopRef.current
          if (!loop) return
          loop.selectAgent(id)
          const sim = loop.getViewSim()
          const agent = sim.state.agents.find((a) => a.id === id) ?? null
          setSelectedAgent(
            agent
              ? {
                  ...agent,
                  needs: { ...agent.needs },
                  action: { ...agent.action },
                }
              : null,
          )
          setAgentEvents(sim.getEvents())
          setHud(loop.getState())
        }}
      />
      <Timeline
        state={hud}
        liveHeadTick={liveHeadTick}
        scrubMin={scrubMin}
        scrubMax={scrubMax}
        onScrub={(t) => {
          loopRef.current?.scrubTo(t)
          syncFromLoop()
        }}
        onGoLive={() => {
          loopRef.current?.goLive()
          syncFromLoop()
        }}
        onLoadDay={(day) => {
          loopRef.current?.loadDay(day)
          syncFromLoop()
        }}
      />
      <Inspector
        agent={selectedAgent}
        events={agentEvents}
        replayTick={hud.tick}
        dayStartTick={viewDayStart}
        places={places}
        owners={owners}
        following={following}
        onToggleFollow={() => {
          const loop = loopRef.current
          if (!loop) return
          const next = !loop.getFollow()
          loop.setFollow(next)
          setFollowing(loop.getFollow())
        }}
        onClose={() => {
          loopRef.current?.selectAgent(null)
          loopRef.current?.setFollow(false)
          setSelectedAgent(null)
          setFollowing(false)
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
      />
    </div>
  )
}

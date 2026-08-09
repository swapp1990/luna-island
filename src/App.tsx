import { useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './sim/sim'
import { dayStartTick } from './sim/time'
import { createScene, type SceneHandle } from './render/scene'
import { createLoop, type LoopController } from './loop'
import { initBridge, type SimStateBridge } from './bridge'
import { Hud } from './ui/Hud'
import { Timeline } from './ui/Timeline'
import { Inspector } from './ui/Inspector'
import { BuildingPanel } from './ui/BuildingPanel'
import { ResourceBar, resourcesFromWorld, type ResourceSnapshot } from './ui/ResourceBar'
import { Ticker } from './ui/Ticker'
import { Charts } from './ui/Charts'
import { PortraitDock } from './ui/PortraitDock'
import type { AgentState, EconomyStat, Place, SimEvent } from './sim/types'

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
    selectedPlaceId: null,
    placeIds: [],
    eventCount: 0,
    archivedDayCount: 0,
    viewDay: 1,
  })
  const [liveHeadTick, setLiveHeadTick] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [agentEvents, setAgentEvents] = useState<readonly SimEvent[]>([])
  const [allEvents, setAllEvents] = useState<readonly SimEvent[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [owners, setOwners] = useState<Record<string, string>>({})
  const [allAgents, setAllAgents] = useState<AgentState[]>([])
  const [stats, setStats] = useState<EconomyStat[]>([])
  const [following, setFollowing] = useState(false)
  const [scrubMin, setScrubMin] = useState(0)
  const [scrubMax, setScrubMax] = useState(0)
  const [resources, setResources] = useState<ResourceSnapshot>({
    treasury: 0,
    stallFood: 0,
    storeWood: 0,
    storeStone: 0,
  })
  const [dockOpen, setDockOpen] = useState(true)

  const viewDayStart = useMemo(() => dayStartTick(hud.viewDay), [hud.viewDay])

  const cloneAgent = (agent: AgentState): AgentState => ({
    ...agent,
    needs: { ...agent.needs },
    sympathy: { ...(agent.sympathy ?? {}) },
    inventory: { ...agent.inventory },
    action: { ...agent.action, path: agent.action.path?.slice() },
  })

  const clonePlace = (p: Place): Place => ({
    ...p,
    inventory: { ...p.inventory },
    production: p.production ? { ...p.production } : undefined,
    construction: p.construction
      ? {
          ...p.construction,
          needs: { ...p.construction.needs },
        }
      : undefined,
    price: p.price ? { ...p.price } : undefined,
  })

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
    setPlaces(sim.state.places.map(clonePlace))
    setOwners({ ...sim.state.owners })
    setAllAgents(sim.state.agents.map(cloneAgent))
    setStats(sim.state.stats.map((st) => ({ ...st })))
    setResources(resourcesFromWorld(sim.state))
    setFollowing(loop.getFollow())
    const agentId = s.selectedAgentId
    const placeId = s.selectedPlaceId
    if (agentId) {
      const agent = sim.state.agents.find((a) => a.id === agentId) ?? null
      setSelectedAgent(agent ? cloneAgent(agent) : null)
      setSelectedPlace(null)
      setAgentEvents(events)
    } else if (placeId) {
      const place = sim.state.places.find((p) => p.id === placeId) ?? null
      setSelectedPlace(place ? clonePlace(place) : null)
      setSelectedAgent(null)
      setAgentEvents(events)
    } else {
      setSelectedAgent(null)
      setSelectedPlace(null)
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
      setSelectedAgent(agent ? cloneAgent(agent) : null)
      if (id) setSelectedPlace(null)
      const events = sim.getEvents()
      setAgentEvents(events)
      setAllEvents(events)
      setHud(loop.getState())
      setFollowing(loop.getFollow())
    }

    const selectPlace = (id: string | null) => {
      loop.selectPlace(id)
      loop.setFollow(false)
      setFollowing(false)
      const sim = loop.getViewSim()
      const place = id ? (sim.state.places.find((p) => p.id === id) ?? null) : null
      setSelectedPlace(place ? clonePlace(place) : null)
      if (id) setSelectedAgent(null)
      setAgentEvents(sim.getEvents())
      setAllEvents(sim.getEvents())
      setHud(loop.getState())
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
        selectPlace,
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

    const unbind = scene.bindSelection({
      onSelectAgent: selectAgent,
      onSelectPlace: selectPlace,
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectAgent(null)
        selectPlace(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const onResize = () => {
      scene.resize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)
    onResize()

    loop.start()
    setHud(loop.getState())
    setLiveHeadTick(live.state.tick)
    setAllEvents(live.getEvents())
    setAllAgents(live.state.agents.map(cloneAgent))
    setPlaces(live.state.places.map(clonePlace))
    setResources(resourcesFromWorld(live.state))
    const b0 = loop.getDayBounds()
    setScrubMin(b0.startTick)
    setScrubMax(b0.endTick)

    const poll = window.setInterval(() => {
      syncFromLoop()
    }, 1000 / HUD_HZ)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
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
      <ResourceBar resources={resources} />
      <Hud
        state={hud}
        onSetSpeed={(n) => {
          loopRef.current?.setSpeed(n)
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
      />
      <PortraitDock
        agents={allAgents}
        places={places}
        selectedAgentId={hud.selectedAgentId}
        onOpenChange={setDockOpen}
        onSelectAndFollow={(id) => {
          const loop = loopRef.current
          if (!loop) return
          loop.selectAgent(id)
          loop.setFollow(true)
          const sim = loop.getViewSim()
          const agent = sim.state.agents.find((a) => a.id === id) ?? null
          setSelectedAgent(agent ? cloneAgent(agent) : null)
          setSelectedPlace(null)
          setAgentEvents(sim.getEvents())
          setHud(loop.getState())
          setFollowing(true)
        }}
      />
      <Ticker
        events={allEvents}
        replayTick={hud.tick}
        dayStartTick={viewDayStart}
        // Lift ticker above portrait dock when dock is open (room for 2×12 chips)
        bottomOffset={dockOpen ? 200 : 72}
        onSelectAgent={(id) => {
          const loop = loopRef.current
          if (!loop) return
          loop.selectAgent(id)
          const sim = loop.getViewSim()
          const agent = sim.state.agents.find((a) => a.id === id) ?? null
          setSelectedAgent(agent ? cloneAgent(agent) : null)
          setSelectedPlace(null)
          setAgentEvents(sim.getEvents())
          setHud(loop.getState())
        }}
      />
      <Charts
        stats={stats}
        replayTick={hud.tick}
        inspectorOpen={selectedAgent !== null || selectedPlace !== null}
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
      {selectedPlace ? (
        <BuildingPanel
          place={selectedPlace}
          agents={allAgents}
          owners={owners}
          events={agentEvents}
          replayTick={hud.tick}
          dayStartTick={viewDayStart}
          onSelectAgent={(id) => {
            const loop = loopRef.current
            if (!loop) return
            loop.selectAgent(id)
            const sim = loop.getViewSim()
            const agent = sim.state.agents.find((a) => a.id === id) ?? null
            setSelectedAgent(agent ? cloneAgent(agent) : null)
            setSelectedPlace(null)
            setAgentEvents(sim.getEvents())
            setHud(loop.getState())
          }}
          onClose={() => {
            loopRef.current?.selectPlace(null)
            setSelectedPlace(null)
            if (loopRef.current) setHud(loopRef.current.getState())
          }}
        />
      ) : (
        <Inspector
          agent={selectedAgent}
          events={agentEvents}
          replayTick={hud.tick}
          dayStartTick={viewDayStart}
          places={places}
          owners={owners}
          agents={allAgents}
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
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './sim/sim'
import { dayStartTick, toSimTime } from './sim/time'
import { serializeSave, restoreSave, SaveFormatError } from './sim/persist'
import {
  loadAutosave,
  putAutosave,
  clearAutosave,
  scheduleIdle,
} from './persistStore'
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
import {
  brainModeFromLocation,
  LunaBrainService,
  mockWallDelayMsFromLocation,
} from './mind/lunaBrain'
import { isLunaAgent } from './mind/personas'
import type { AgentState, EconomyStat, Place, SimEvent } from './sim/types'

const DEFAULT_SEED = 42
const HUD_HZ = 4
/** Wall-clock autosave interval (ms). */
const AUTOSAVE_WALL_MS = 60_000

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function emptyHud(): SimStateBridge {
  return {
    ready: false,
    mode: 'live',
    day: 1,
    hour: 6,
    minute: 0,
    tick: 0,
    speed: 1,
    userSpeed: 1,
    agentCount: 0,
    agentIds: [],
    selectedAgentId: null,
    selectedPlaceId: null,
    placeIds: [],
    eventCount: 0,
    archivedDayCount: 0,
    viewDay: 1,
    lastSavedTick: null,
    seed: DEFAULT_SEED,
    agent0: null,
    mind: null,
  }
}

function cloneAgent(agent: AgentState): AgentState {
  return {
    ...agent,
    needs: { ...agent.needs },
    sympathy: { ...(agent.sympathy ?? {}) },
    inventory: { ...agent.inventory },
    action: { ...agent.action, path: agent.action.path?.slice() },
  }
}

function clonePlace(p: Place): Place {
  return {
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
  }
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<LoopController | null>(null)
  const sceneRef = useRef<SceneHandle | null>(null)
  const liveRef = useRef<Simulation | null>(null)
  const unbindRef = useRef<(() => void) | null>(null)
  const mindRef = useRef<LunaBrainService | null>(null)
  const lastAutosaveWallRef = useRef(0)
  const lastAutosaveDayRef = useRef(0)
  /** In-flight save promise so concurrent saveNow/autosave coalesce. */
  const saveInflightRef = useRef<Promise<boolean> | null>(null)
  /** Stable holder so mountWorld always sees latest React setters via closure rebuild. */
  const apiRef = useRef<{
    syncFromLoop: () => void
    performSave: () => Promise<boolean>
    mountWorld: (live: Simulation, opts?: { markSaved?: boolean }) => void
  } | null>(null)

  const [hud, setHud] = useState<SimStateBridge>(emptyHud)
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
  const [lastSavedClock, setLastSavedClock] = useState<string | null>(null)

  const viewDayStart = useMemo(() => dayStartTick(hud.viewDay), [hud.viewDay])

  // Keep apiRef methods current every render (no effect re-boot).
  apiRef.current = {
    syncFromLoop: () => {
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
      if (s.lastSavedTick != null) {
        const st = toSimTime(s.lastSavedTick)
        setLastSavedClock(`${pad2(st.hour)}:${pad2(st.minute)}`)
      }
    },

    performSave: () => {
      if (saveInflightRef.current) return saveInflightRef.current
      const live = liveRef.current
      const loop = loopRef.current
      if (!live || !loop) return Promise.resolve(false)
      if (loop.getMode() !== 'live') return Promise.resolve(false)

      const job = (async (): Promise<boolean> => {
        try {
          // Capture live state at start of idle job
          const sim = liveRef.current
          const ctl = loopRef.current
          if (!sim || !ctl || ctl.getMode() !== 'live') return false
          const save = serializeSave(sim)
          await putAutosave(save)
          // Use the tick we serialized (sim may have advanced during await)
          const savedTick = save.tick
          ctl.setLastSavedTick(savedTick)
          lastAutosaveWallRef.current = Date.now()
          lastAutosaveDayRef.current = toSimTime(savedTick).day
          const st = toSimTime(savedTick)
          setLastSavedClock(`${pad2(st.hour)}:${pad2(st.minute)}`)
          setHud(ctl.getState())
          return true
        } catch (err) {
          console.error('autosave failed', err)
          return false
        } finally {
          saveInflightRef.current = null
        }
      })()
      saveInflightRef.current = job
      return job
    },

    mountWorld: (live: Simulation, opts?: { markSaved?: boolean }) => {
      const el = containerRef.current
      if (!el) return

      unbindRef.current?.()
      unbindRef.current = null
      loopRef.current?.stop()
      sceneRef.current?.dispose()
      mindRef.current?.dispose()
      mindRef.current = null
      while (el.firstChild) el.removeChild(el.firstChild)

      liveRef.current = live
      const scene = createScene(el, live.state)
      sceneRef.current = scene
      const loop = createLoop(live, scene)
      loopRef.current = loop

      // LunaBrain: ?brain=mock|codex|off|auto
      const attachMind = (m: LunaBrainService) => {
        if (!m.isEnabled()) {
          loop.setMindHook(null)
          return
        }
        loop.setMindHook({
          onAfterTick: (sim) => m.onAfterTick(sim),
          getMeter: () => m.getMeter(),
        })
        m.onAfterTick(live)
      }
      const mode = brainModeFromLocation()
      const mind = new LunaBrainService(mode, {
        mockWallDelayMs: mode === 'mock' ? mockWallDelayMsFromLocation() : 0,
      })
      mindRef.current = mind
      if (mode === 'auto') {
        void mind.init().then(() => {
          if (mindRef.current !== mind) return
          attachMind(mind)
          setHud(loop.getState())
        })
      } else {
        void mind.init()
        attachMind(mind)
      }

      if (opts?.markSaved) {
        // Resume paused so the saved tick is exact until the player hits play.
        loop.pause()
        loop.setLastSavedTick(live.state.tick)
        const st = toSimTime(live.state.tick)
        setLastSavedClock(`${pad2(st.hour)}:${pad2(st.minute)}`)
      } else {
        loop.setLastSavedTick(null)
        setLastSavedClock(null)
      }
      lastAutosaveDayRef.current = toSimTime(live.state.tick).day
      lastAutosaveWallRef.current = Date.now()

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
            apiRef.current?.syncFromLoop()
          },
          goLive: () => {
            loop.goLive()
            apiRef.current?.syncFromLoop()
          },
          selectAgent,
          selectPlace,
          loadDay: (day) => {
            loop.loadDay(day)
            apiRef.current?.syncFromLoop()
          },
          ffwd: (n) => {
            loop.ffwd(n)
            apiRef.current?.syncFromLoop()
          },
          saveNow: () => apiRef.current?.performSave() ?? Promise.resolve(false),
          newWorld: (seed: number) => {
            void (async () => {
              await clearAutosave()
              apiRef.current?.mountWorld(new Simulation(seed))
            })()
          },
        },
      )

      unbindRef.current = scene.bindSelection({
        onSelectAgent: selectAgent,
        onSelectPlace: selectPlace,
      })

      setSelectedAgent(null)
      setSelectedPlace(null)
      setFollowing(false)

      loop.start()
      setHud(loop.getState())
      setLiveHeadTick(live.state.tick)
      setAllEvents(live.getEvents())
      setAllAgents(live.state.agents.map(cloneAgent))
      setPlaces(live.state.places.map(clonePlace))
      setOwners({ ...live.state.owners })
      setStats(live.state.stats.map((st) => ({ ...st })))
      setResources(resourcesFromWorld(live.state))
      const b0 = loop.getDayBounds()
      setScrubMin(b0.startTick)
      setScrubMax(b0.endTick)
      scene.resize(el.clientWidth, el.clientHeight)
    },
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        loopRef.current?.selectAgent(null)
        loopRef.current?.selectPlace(null)
        setSelectedAgent(null)
        setSelectedPlace(null)
        setFollowing(false)
        if (loopRef.current) setHud(loopRef.current.getState())
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const onResize = () => {
      if (containerRef.current && sceneRef.current) {
        sceneRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight,
        )
      }
    }
    window.addEventListener('resize', onResize)

    const onBeforeUnload = () => {
      const live = liveRef.current
      const loop = loopRef.current
      if (!live || !loop || loop.getMode() !== 'live') return
      try {
        const save = serializeSave(live)
        void putAutosave(save)
      } catch {
        // best-effort
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    const poll = window.setInterval(() => {
      apiRef.current?.syncFromLoop()
      const live = liveRef.current
      const loop = loopRef.current
      if (!live || !loop) return
      if (loop.getMode() !== 'live') return
      if (saveInflightRef.current) return
      const day = toSimTime(live.state.tick).day
      if (lastAutosaveDayRef.current === 0) {
        lastAutosaveDayRef.current = day
        lastAutosaveWallRef.current = Date.now()
        return
      }
      const dayBoundary = day > lastAutosaveDayRef.current
      const wallElapsed = Date.now() - lastAutosaveWallRef.current >= AUTOSAVE_WALL_MS
      if (dayBoundary || wallElapsed) {
        scheduleIdle(() => {
          void apiRef.current?.performSave()
        })
      }
    }, 1000 / HUD_HZ)

    void (async () => {
      let live: Simulation
      let fromSave = false
      try {
        const raw = await loadAutosave()
        if (cancelled) return
        if (raw) {
          live = restoreSave(raw)
          fromSave = true
        } else {
          live = new Simulation(DEFAULT_SEED)
        }
      } catch {
        live = new Simulation(DEFAULT_SEED)
        fromSave = false
      }
      if (cancelled) return
      apiRef.current?.mountWorld(live, { markSaved: fromSave })
    })()

    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('beforeunload', onBeforeUnload)
      unbindRef.current?.()
      unbindRef.current = null
      mindRef.current?.dispose()
      mindRef.current = null
      loopRef.current?.stop()
      sceneRef.current?.dispose()
      loopRef.current = null
      sceneRef.current = null
      liveRef.current = null
    }
    // Boot once — apiRef always holds latest handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExport = () => {
    const live = liveRef.current
    if (!live) return
    const save = serializeSave(live)
    const day = toSimTime(live.state.tick).day
    const blob = new Blob([JSON.stringify(save)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `luna-island-day${day}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const raw = JSON.parse(text) as unknown
      const live = restoreSave(raw)
      const save = serializeSave(live)
      await putAutosave(save)
      apiRef.current?.mountWorld(live, { markSaved: true })
    } catch (err) {
      const msg =
        err instanceof SaveFormatError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Import failed'
      console.error('Import World failed:', msg)
      window.alert(`Import failed: ${msg}`)
    }
  }

  const handleNewWorld = (seed: number) => {
    void (async () => {
      await clearAutosave()
      apiRef.current?.mountWorld(new Simulation(seed))
    })()
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        id="scene"
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <ResourceBar resources={resources} mind={hud.mind ?? null} />
      <Hud
        state={hud}
        lastSavedClock={lastSavedClock}
        onSetSpeed={(n) => {
          loopRef.current?.setSpeed(n)
          if (loopRef.current) setHud(loopRef.current.getState())
        }}
        onNewWorld={handleNewWorld}
        onExportWorld={handleExport}
        onImportWorld={(f) => {
          void handleImport(f)
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
          apiRef.current?.syncFromLoop()
        }}
        onGoLive={() => {
          loopRef.current?.goLive()
          apiRef.current?.syncFromLoop()
        }}
        onLoadDay={(day) => {
          loopRef.current?.loadDay(day)
          apiRef.current?.syncFromLoop()
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
          lunaEnabled={
            !!selectedAgent &&
            isLunaAgent(selectedAgent.id) &&
            (hud.mind?.enabled ?? false)
          }
          lastExchange={
            selectedAgent && mindRef.current
              ? mindRef.current.getLastExchange(selectedAgent.id) ?? null
              : null
          }
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

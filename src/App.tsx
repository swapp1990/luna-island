import { useEffect, useMemo, useRef, useState } from 'react'
import { Simulation } from './sim/sim'
import { dayStartTick, toSimTime } from './sim/time'
import {
  serializeSave,
  serializeStory,
  restoreSave,
  SaveFormatError,
} from './sim/persist'
import {
  loadAutosave,
  putAutosave,
  clearAutosave,
  scheduleIdle,
} from './persistStore'
import { createScene, type FrameSubjectOpts, type SceneHandle } from './render/scene'
import { createLoop, type LoopController } from './loop'
import { initBridge, type PhotoModeOpts, type SimStateBridge } from './bridge'
import { pickHighlights } from './replay/highlights'
import { describeAgent, describeDestination } from './render/actionLanguage'
import { Hud } from './ui/Hud'
import { Timeline } from './ui/Timeline'
import { Inspector } from './ui/Inspector'
import { BuildingPanel } from './ui/BuildingPanel'
import { ResourceBar, resourcesFromWorld, type ResourceSnapshot } from './ui/ResourceBar'
import { Ticker } from './ui/Ticker'
import { Charts } from './ui/Charts'
import { TownBoard } from './ui/TownBoard'
import { PortraitDock } from './ui/PortraitDock'
import {
  brainModeFromLocation,
  LunaBrainService,
  mindConcurrencyFromLocation,
  mockWallDelayMsFromLocation,
} from './mind/lunaBrain'
import { isLunaAgent } from './mind/personas'
import type {
  AgentState,
  EconomyStat,
  ExternalIntentMeta,
  Intent,
  Place,
  Proposal,
  Rule,
  SimEvent,
  WorldPreset,
} from './sim/types'

const DEFAULT_SEED = 42
const HUD_HZ = 4
/** Wall-clock autosave interval (ms). */
const AUTOSAVE_WALL_MS = 60_000

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Visual height of a place hero, in world units (house roof, bush cluster, …). */
function placeHeroHeight(kind: string | undefined): number {
  switch (kind) {
    case 'home':
      return 1.28
    case 'construction-site':
      return 1.08
    case 'berry-bush':
      return 0.78
    case 'farm':
      return 0.9
    case 'well':
      return 1.05
    case 'notice-board':
      return 1.18
    case 'stall':
      return 1.12
    case 'storehouse':
      return 1.38
    case 'plaza':
      return 0.55
    default:
      return 1.12
  }
}

function placeHeroSpan(kind: string | undefined): number {
  if (kind === 'farm') return 2.6
  if (kind === 'plaza') return 3.0
  if (kind === 'berry-bush') return 0.85
  return 0
}

const PHOTO_HEAD_Y = 0.91

function placeHeroProbes(
  x: number,
  z: number,
  height: number,
  kind: string | undefined,
): Array<{ x: number; y: number; z: number }> {
  if (kind === 'construction-site') {
    return [
      { x, y: 0.52, z },
      { x: x + 0.35, y: 0.48, z: z + 0.35 },
      { x: x - 0.35, y: 0.48, z: z - 0.35 },
    ]
  }
  if (kind === 'berry-bush') {
    return [
      { x, y: 0.38, z },
      { x, y: 0.62, z },
    ]
  }
  return [
    { x, y: height * 0.4, z },
    { x, y: height * 0.72, z },
    { x, y: Math.max(0.75, height * 0.9), z },
  ]
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
    photoMode: false,
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
  const [mindNoteLog, setMindNoteLog] = useState<
    import('./sim/types').MindNoteRecord[]
  >([])
  const [sayLog, setSayLog] = useState<import('./sim/types').SayRecord[]>([])
  const [stats, setStats] = useState<EconomyStat[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [rules, setRules] = useState<Rule[]>([])
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
  const [photoCard, setPhotoCard] = useState<{
    caption: string
    subtitle?: string
    kicker: string
  } | null>(null)

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
      // Slice: EventLog mutates one array; same ref would skip React updates
      const events = sim.getEvents().slice()
      setAllEvents(events)
      setPlaces(sim.state.places.map(clonePlace))
      setOwners({ ...sim.state.owners })
      setAllAgents(sim.state.agents.map(cloneAgent))
      setMindNoteLog(
        (sim.state.mindNoteLog ?? []).map((r) => ({
          tick: r.tick,
          agentId: r.agentId,
          notes: r.notes.slice(),
          meta: { ...r.meta },
          ...(r.learned && r.learned.length > 0
            ? { learned: r.learned.slice() }
            : {}),
        })),
      )
      setSayLog(
        (sim.state.sayLog ?? []).map((r) => ({
          tick: r.tick,
          conversationId: r.conversationId,
          agentId: r.agentId,
          partnerId: r.partnerId,
          turn: r.turn,
          text: r.text,
          done: r.done,
        })),
      )
      setStats(sim.state.stats.map((st) => ({ ...st })))
      setProposals(
        (sim.state.proposals ?? []).map((p) => ({
          ...p,
          votes: { ...p.votes },
        })),
      )
      setRules((sim.state.rules ?? []).map((r) => ({ ...r })))
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

      // LunaBrain: ?brain=mock|codex|grok|off|auto
      const attachMind = (m: LunaBrainService) => {
        if (!m.isEnabled()) {
          loop.setMindHook(null)
          return
        }
        loop.setMindHook({
          onAfterTick: (sim, opts) => m.onAfterTick(sim, opts),
          getMeter: () => m.getMeter(),
        })
        m.onAfterTick(live)
      }
      const mode = brainModeFromLocation()
      const mind = new LunaBrainService(mode, {
        mockWallDelayMs: mode === 'mock' ? mockWallDelayMsFromLocation() : 0,
        concurrency: mindConcurrencyFromLocation(),
        onPipelineChange: () => loop.notifyMindSettled(),
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
          newWorld: (seed: number, preset?: WorldPreset) => {
            void (async () => {
              await clearAutosave()
              apiRef.current?.mountWorld(new Simulation(seed, { preset }))
            })()
          },
          exportWorldJson: () => {
            const live = liveRef.current
            if (!live) return ''
            return JSON.stringify(serializeSave(live))
          },
          importWorldJson: async (json: string) => {
            const raw = JSON.parse(json) as unknown
            const live = restoreSave(raw)
            // Persist so a refresh keeps the imported timeline (same path as file import).
            try {
              await putAutosave(serializeSave(live))
            } catch {
              // non-fatal — mount regardless
            }
            apiRef.current?.mountWorld(live, { markSaved: true })
            // Exit any leftover photo chrome
            setPhotoCard(null)
            document.getElementById('app-root')?.classList.remove('photo-mode')
            loopRef.current?.setPhotoMode(false)
            sceneRef.current?.overlays.setPhotoSubject(null)
          },
          exportStoryJson: () => {
            const live = liveRef.current
            if (!live) return JSON.stringify({
              decisions: [],
              reflections: [],
              says: [],
              sanctions: [],
              proposals: [],
              discoveries: [],
            })
            return JSON.stringify(serializeStory(live))
          },
          photo: {
            enter: (opts: PhotoModeOpts) => {
              const loop = loopRef.current
              const scene = sceneRef.current
              if (!loop || !scene) return
              loop.pause()
              const sim = loop.getViewSim()
              const t = toSimTime(sim.state.tick)
              const kicker = `LUNA ISLAND — DAY ${t.day}, ${pad2(t.hour)}:${pad2(t.minute)}`
              setPhotoCard({
                caption: opts.caption ?? '',
                subtitle: opts.subtitle,
                kicker,
              })
              document.getElementById('app-root')?.classList.add('photo-mode')
              loop.setPhotoMode(true)

              const agentIds =
                opts.agentIds && opts.agentIds.length > 0
                  ? opts.agentIds
                  : opts.agentId
                    ? [opts.agentId]
                    : []
              const agentId = agentIds[0]
              const placeId = opts.placeId
              const frameOnly =
                opts.frameOnly ??
                (placeId ? 'place' : agentIds.length >= 2 ? 'pair' : 'agent')
              scene.overlays.setPhotoSubject(agentId ?? null)
              scene.overlays.clearEphemeral()

              let fx: number | null = null
              let fz: number | null = null
              let height = 1.05
              let span = 0

              const placePos = (id: string) => {
                const pos = scene.getPlaceWorldPos(id)
                if (pos) return { x: pos.x, z: pos.z }
                const place = sim.state.places.find((p) => p.id === id)
                return place ? { x: place.x, z: place.y } : null
              }

              if (frameOnly === 'pair' && agentIds.length >= 2) {
                const a = sim.state.agents.find((ag) => ag.id === agentIds[0])
                const b = sim.state.agents.find((ag) => ag.id === agentIds[1])
                if (a && b) {
                  fx = (a.x + b.x) / 2
                  fz = (a.y + b.y) / 2
                  span = Math.hypot(a.x - b.x, a.y - b.y)
                  height = 1.05
                }
              }

              if ((fx == null || fz == null) && frameOnly === 'place' && placeId) {
                const pos = placePos(placeId)
                if (pos) {
                  fx = pos.x
                  fz = pos.z
                  const kind = sim.state.places.find((p) => p.id === placeId)?.kind
                  height = placeHeroHeight(kind)
                  span = placeHeroSpan(kind)
                }
              }

              if (fx == null || fz == null) {
                const agent = agentId
                  ? sim.state.agents.find((a) => a.id === agentId)
                  : undefined
                if (agent) {
                  fx = agent.x
                  fz = agent.y
                  height = 1.05
                }
              }

              if (fx != null && fz != null) {
                const frameOpts: FrameSubjectOpts = {
                  height,
                  span,
                }
                if (frameOnly === 'pair' && agentIds.length >= 2) {
                  const a = sim.state.agents.find((ag) => ag.id === agentIds[0])
                  const b = sim.state.agents.find((ag) => ag.id === agentIds[1])
                  if (a && b) {
                    frameOpts.probes = [
                      { x: a.x, y: PHOTO_HEAD_Y, z: a.y },
                      { x: b.x, y: PHOTO_HEAD_Y, z: b.y },
                      { x: a.x, y: 0.48, z: a.y },
                      { x: b.x, y: 0.48, z: b.y },
                    ]
                    frameOpts.subjectAgentIds = [a.id, b.id]
                  }
                } else if (frameOnly === 'place' && placeId) {
                  const kind = sim.state.places.find((p) => p.id === placeId)?.kind
                  frameOpts.placeId = placeId
                  frameOpts.probes = placeHeroProbes(fx, fz, height, kind)
                  frameOpts.occluderAgents = sim.state.agents.map((ag) => ({
                    id: ag.id,
                    x: ag.x,
                    z: ag.y,
                  }))
                  frameOpts.rivalPlaces = sim.state.places
                    .filter((p) => p.kind === kind && p.id !== placeId)
                    .map((p) => {
                      const pos = placePos(p.id)
                      return pos ? { x: pos.x, z: pos.z } : { x: p.x, z: p.y }
                    })
                }
                scene.frameSubject(fx, fz, opts.zoom ?? 1, frameOpts)
              }

              // Talking subject: show speech bubble from mind:say at this tick
              if (agentId) {
                let said = false
                const events = sim.getEvents()
                for (let i = events.length - 1; i >= 0; i--) {
                  const ev = events[i]!
                  if (ev.tick < sim.state.tick - 2) break
                  if (
                    ev.type === 'mind:say' &&
                    ev.agentId === agentId &&
                    ev.tick <= sim.state.tick
                  ) {
                    const text = String(ev.data?.text ?? '')
                    if (text) {
                      scene.overlays.pushSpeech(agentId, text, performance.now())
                      said = true
                    }
                    break
                  }
                }
                // Subtitle quote fallback when no nearby mind:say
                if (!said && opts.subtitle && opts.subtitle.startsWith('"')) {
                  const q = opts.subtitle.replace(/^"|"$/g, '')
                  if (q) scene.overlays.pushSpeech(agentId, q, performance.now())
                }
              }

              if (agentId) {
                loop.selectAgent(agentId)
              } else if (placeId) {
                loop.selectPlace(placeId)
              }
              loop.forceRender()
              setHud(loop.getState())
            },
            exit: () => {
              const loop = loopRef.current
              const scene = sceneRef.current
              setPhotoCard(null)
              document.getElementById('app-root')?.classList.remove('photo-mode')
              loop?.setPhotoMode(false)
              scene?.overlays.setPhotoSubject(null)
              scene?.overlays.clearEphemeral()
              if (loop) {
                // Clear speech bubbles by resetting subject + force render
                loop.forceRender()
                setHud(loop.getState())
              }
            },
          },
          listHighlightMoments: (max = 12) => {
            const live = liveRef.current
            if (!live) return []
            const atTick = new Map<number, Pick<typeof live.state, 'agents' | 'places'>>()
            return pickHighlights(live.getEvents(), live.state, max, {
              worldAtTick: (tick) => {
                const t = Math.max(0, Math.min(Math.floor(tick), live.state.tick))
                const hit = atTick.get(t)
                if (hit) return hit
                const snap =
                  t >= live.state.tick ? live.state : live.stateAt(t).state
                atTick.set(t, snap)
                return snap
              },
            })
          },
          hashAtTick: (tick: number) => {
            const live = liveRef.current
            if (!live) return ''
            const head = live.state.tick
            const t = Math.max(0, Math.min(Math.floor(tick), head))
            if (t >= head) return live.hash()
            return live.stateAt(t).hash()
          },
          forceMindBudgetCooldown: (resetsInSec = 3600) => {
            const m = mindRef.current
            const live = liveRef.current
            if (!m || !live) return
            m.forceBudgetCooldown(live, resetsInSec)
            // Fresh slice so React/ticker see the same-tick mind:budget append
            setAllEvents(live.getEvents().slice())
            setHud(loop.getState())
            apiRef.current?.syncFromLoop()
          },
          /**
           * E2e helper: pin two luna agents in socialize-standing proximity and
           * advance until a conversation produces at least one mind:say (or maxTicks).
           */
          /** E2e/dev: count event types on the current view sim. */
          countEventTypes: () => {
            const loop = loopRef.current
            if (!loop) return {} as Record<string, number>
            const events = loop.getViewSim().getEvents()
            const out: Record<string, number> = {}
            for (const e of events) {
              out[e.type] = (out[e.type] ?? 0) + 1
            }
            return out
          },
          postIntent: (agentId: string, intent: Intent, reasoning?: string) => {
            const live = liveRef.current
            const loop = loopRef.current
            if (!live || !loop) return false
            const meta: ExternalIntentMeta = {
              reasoning: reasoning ?? intent.reason,
              source: 'luna',
              provider: 'mock',
            }
            live.postExternalIntent(agentId, intent, meta)
            loop.ffwd(1)
            apiRef.current?.syncFromLoop()
            return true
          },
          setNeeds: (agentId: string, needs: { hunger?: number; energy?: number; social?: number }) => {
            const live = liveRef.current
            if (!live) return false
            const agent = live.state.agents.find((a) => a.id === agentId)
            if (!agent) return false
            const clamp = (n: number) => Math.max(0, Math.min(1, n))
            if (typeof needs.hunger === 'number') agent.needs.hunger = clamp(needs.hunger)
            if (typeof needs.energy === 'number') agent.needs.energy = clamp(needs.energy)
            if (typeof needs.social === 'number') agent.needs.social = clamp(needs.social)
            return true
          },
          ensureWallet: (agentId: string, minCoins: number) => {
            const live = liveRef.current
            if (!live) return false
            const agent = live.state.agents.find((a) => a.id === agentId)
            if (!agent) return false
            const need = Math.max(0, Math.ceil(minCoins) - agent.wallet)
            if (need <= 0) return true
            return live.transferCoins(
              'treasury',
              agentId,
              need,
              `e2e top-up ${need} coins`,
              { kind: 'e2e-topup' },
            )
          },
          describeAgentVisual: (agentId: string) => {
            const loop = loopRef.current
            if (!loop) return null
            const sim = loop.getViewSim()
            const live = liveRef.current
            const agent = sim.state.agents.find((a) => a.id === agentId)
            if (!agent) return null
            const events = (live ?? sim)
              .getEvents()
              .filter((e) => e.tick <= sim.state.tick)
            const visual = describeAgent(agent, sim.state.tick, { events })
            const dest = describeDestination(agent)
            return { ...visual, traveling: dest !== null }
          },
          setSympathy: (agentId: string, otherId: string, value: number) => {
            const live = liveRef.current
            if (!live) return
            const agent = live.state.agents.find((a) => a.id === agentId)
            if (!agent) return
            if (!agent.sympathy) agent.sympathy = {}
            const v = Math.max(0, Math.min(1, value))
            if (v === 0) delete agent.sympathy[otherId]
            else agent.sympathy[otherId] = v
          },
          seedConversation: (opts?: {
            agentIdA?: string
            agentIdB?: string
            maxTicks?: number
            /** When true, pin mind socialize + partner mid-eat (sticky/mixed). */
            partnerEating?: boolean
            /** Min mind:say count before success (default 1; use 2+ for both sides). */
            minSays?: number
          }) => {
            const live = liveRef.current
            const loop = loopRef.current
            if (!live || !loop) return { ok: false, says: 0 }
            const idA = opts?.agentIdA ?? 'agent-0'
            const idB = opts?.agentIdB ?? 'agent-1'
            const maxTicks = opts?.maxTicks ?? 120
            const minSays = opts?.minSays ?? 1
            const plaza = live.state.places.find((p) => p.kind === 'plaza')
            if (!plaza) return { ok: false, says: 0 }
            const pin = () => {
              const a = live.state.agents.find((x) => x.id === idA)
              const b = live.state.agents.find((x) => x.id === idB)
              if (!a || !b) return
              a.x = plaza.x
              a.y = plaza.y
              b.x = plaza.x + 1
              b.y = plaza.y
              // Mind side always socializes to initiate
              a.action = {
                kind: 'socialize',
                targetPlaceId: plaza.id,
                targetX: plaza.x,
                targetY: plaza.y,
                reason: 'e2e socialize',
              }
              if (opts?.partnerEating) {
                b.action = {
                  kind: 'eat',
                  targetX: plaza.x + 1,
                  targetY: plaza.y,
                  reason: 'e2e mid-eat chat',
                }
                b.actionTicks = 5
              } else {
                b.action = {
                  kind: 'socialize',
                  targetPlaceId: plaza.id,
                  targetX: plaza.x + 1,
                  targetY: plaza.y,
                  reason: 'e2e socialize',
                }
              }
              a.action.path = undefined
              b.action.path = undefined
              a.pathIndex = 0
              b.pathIndex = 0
            }
            for (let i = 0; i < maxTicks; i++) {
              pin()
              loop.ffwd(1)
              pin()
              const says = live.getEvents().filter((e) => e.type === 'mind:say').length
              if (says >= minSays) {
                // Drain a few more ticks so transcript can grow + bubble applies
                for (let j = 0; j < 16; j++) {
                  pin()
                  loop.ffwd(1)
                  pin()
                }
                apiRef.current?.syncFromLoop()
                return {
                  ok: true,
                  says: live.getEvents().filter((e) => e.type === 'mind:say').length,
                }
              }
            }
            apiRef.current?.syncFromLoop()
            return {
              ok: false,
              says: live.getEvents().filter((e) => e.type === 'mind:say').length,
            }
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
      setMindNoteLog(
        (live.state.mindNoteLog ?? []).map((r) => ({
          tick: r.tick,
          agentId: r.agentId,
          notes: r.notes.slice(),
          meta: { ...r.meta },
        })),
      )
      setSayLog(
        (live.state.sayLog ?? []).map((r) => ({
          tick: r.tick,
          conversationId: r.conversationId,
          agentId: r.agentId,
          partnerId: r.partnerId,
          turn: r.turn,
          text: r.text,
          done: r.done,
        })),
      )
      setStats(live.state.stats.map((st) => ({ ...st })))
      setProposals(
        (live.state.proposals ?? []).map((p) => ({
          ...p,
          votes: { ...p.votes },
        })),
      )
      setRules((live.state.rules ?? []).map((r) => ({ ...r })))
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
    <div
      id="app-root"
      className={photoCard ? 'photo-mode' : undefined}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <div
        id="scene"
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <div data-photo-hide="true">
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
      <TownBoard
        proposals={proposals}
        rules={rules}
        events={allEvents}
        agents={allAgents}
        replayTick={hud.tick}
        inspectorOpen={selectedAgent !== null || selectedPlace !== null}
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
          proposals={proposals}
          rules={rules}
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
              ? mindRef.current.getLastDecisionExchange(selectedAgent.id) ??
                mindRef.current.getLastExchange(selectedAgent.id) ??
                null
              : null
          }
          mindNoteLog={mindNoteLog}
          sayLog={sayLog}
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

      {photoCard && (
        <>
          <div
            id="photo-vignette"
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 40,
              background:
                'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)',
            }}
          />
          <div
            id="photo-caption"
            data-testid="photo-caption"
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              zIndex: 50,
              pointerEvents: 'none',
              width: '40%',
              maxHeight: '30%',
              overflow: 'hidden',
              boxSizing: 'border-box',
              padding: '40px 36px 32px 40px',
              background:
                'linear-gradient(to top, rgba(8,10,18,0.88) 0%, rgba(8,10,18,0.55) 62%, transparent 100%)',
              fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
              color: '#f2f4f8',
            }}
          >
            <div
              data-testid="photo-kicker"
              style={{
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(220,228,240,0.78)',
                marginBottom: 10,
                textShadow: '0 1px 6px rgba(0,0,0,0.55)',
              }}
            >
              {photoCard.kicker}
            </div>
            <div
              data-testid="photo-headline"
              style={{
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: '-0.015em',
                lineHeight: 1.12,
                textShadow: '0 2px 14px rgba(0,0,0,0.55)',
              }}
            >
              {photoCard.caption}
            </div>
            {photoCard.subtitle ? (
              <div
                data-testid="photo-subtitle"
                style={{
                  marginTop: 10,
                  fontSize: 34,
                  fontStyle: 'italic',
                  fontWeight: 400,
                  color: 'rgba(210,218,230,0.84)',
                  lineHeight: 1.28,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  textShadow: '0 1px 8px rgba(0,0,0,0.5)',
                }}
              >
                {photoCard.subtitle}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

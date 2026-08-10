import type { SceneHandle } from './render/scene'
import { Simulation } from './sim/sim'
import { dayEndTick, dayStartTick, toSimTime } from './sim/time'
import type { MindBridgeState, SimMode, SimStateBridge } from './bridge'
import { refreshBridge } from './bridge'

export interface MindTickHook {
  onAfterTick: (sim: Simulation) => void
  getMeter: () => MindBridgeState
}

export interface LoopController {
  setSpeed: (n: number) => void
  pause: () => void
  scrubTo: (tick: number) => void
  goLive: () => void
  selectAgent: (id: string | null) => void
  selectPlace: (id: string | null) => void
  setFollow: (on: boolean) => void
  getFollow: () => boolean
  loadDay: (day: number) => void
  ffwd: (n: number) => void
  getState: () => SimStateBridge
  start: () => void
  stop: () => void
  getViewSim: () => Simulation
  /** Live sim (always the authority, never the replay fork). */
  getLiveSim: () => Simulation
  getMode: () => SimMode
  setLastSavedTick: (tick: number | null) => void
  getLastSavedTick: () => number | null
  /** Accumulator fraction toward the next tick [0,1), for render interp. */
  getAlpha: () => number
  getPrevAgentPositions: () => Map<string, { x: number; y: number }>
  /** Inclusive scrubber bounds for the currently viewed day. */
  getDayBounds: () => { startTick: number; endTick: number }
  /** Swap / clear the live mind hook (LunaBrain). */
  setMindHook: (hook: MindTickHook | null) => void
  /** User-chosen speed (not the temporary breathe throttle). */
  getUserSpeed: () => number
}

const SPEEDS = new Set([0, 1, 8, 64])
const MAX_TICKS_PER_FRAME = 256

function capturePositions(sim: Simulation): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  for (const a of sim.state.agents) {
    m.set(a.id, { x: a.x, y: a.y })
  }
  return m
}

export function createLoop(live: Simulation, scene: SceneHandle): LoopController {
  /** User's selected speed (restore target after breathe). */
  let userSpeed = 1
  /**
   * Effective sim speed for the frame accumulator / bridge.
   * While mind work is queued / in flight / rate-floor waiting and user is not
   * paused, this is 1 (auto-breathe for the whole line drain).
   */
  let speed = 1
  let mode: SimMode = 'live'
  let selectedAgentId: string | null = null
  let selectedPlaceId: string | null = null
  let follow = false
  let fork: Simulation | null = null
  let accumulator = 0
  let lastTs = 0
  let rafId = 0
  let running = false
  let ready = true
  let lastSavedTick: number | null = null
  let mindHook: MindTickHook | null = null
  let prevPositions = capturePositions(live)

  /**
   * Whole mind line: queue + in-flight + rate-floor wait (meter.thinking).
   * Holds do not throttle (mock apply lag only).
   */
  const mindThinking = (): number => {
    const m = mindHook?.getMeter()
    if (!m) return 0
    return m.thinking ?? 0
  }

  /** Recompute effective speed from user intent + whole-line mind work. */
  const applyBreathe = () => {
    if (userSpeed === 0) {
      // Manual pause always wins — never auto-unpause
      speed = 0
      return
    }
    if (mode === 'live' && mindThinking() > 0) {
      speed = 1
      return
    }
    speed = userSpeed
  }

  /**
   * Advance live sim. When respectBreathe, mid-batch thinking stops catch-up
   * so high-speed frames cannot race past an in-flight mind answer.
   * ffwd always passes respectBreathe=false — never waits on minds.
   */
  const advanceLive = (n: number, respectBreathe = false) => {
    if (n <= 0) return
    for (let i = 0; i < n; i++) {
      live.advanceTicks(1)
      if (mode === 'live') mindHook?.onAfterTick(live)
      if (respectBreathe && mode === 'live' && mindThinking() > 0 && userSpeed > 1) {
        // Enter breathe: drop remaining batch; next frames run at 1×
        applyBreathe()
        accumulator = 0
        break
      }
    }
    if (respectBreathe) applyBreathe()
  }
  /** Event count of the view sim already scanned for critical bubbles. */
  let lastCriticalEventCount = 0
  /** Live-only toast scanner cursor (never backfills on replay enter). */
  let lastToastEventCount = 0
  /** Live-only celebration FX scanner cursor. */
  let lastCelebrateEventCount = 0
  /** Live-only speech bubble scanner cursor. */
  let lastSpeechEventCount = 0
  /**
   * Calendar day scoped in the timeline. null = follow live head day.
   * Set when loadDay / scrub into a day; cleared on goLive.
   */
  let viewDayOverride: number | null = null

  const liveDay = (): number => toSimTime(live.state.tick).day

  const resolvedViewDay = (): number => {
    if (viewDayOverride !== null) return viewDayOverride
    if (mode === 'replay' && fork) return toSimTime(fork.state.tick).day
    return liveDay()
  }

  const dayBounds = (day: number): { startTick: number; endTick: number } => {
    const startTick = dayStartTick(day)
    const archive = live.archives().find((a) => a.day === day)
    if (archive) {
      return { startTick: archive.startTick, endTick: archive.endTick }
    }
    // Today (or future-safe): up to live head
    const end = Math.max(startTick, live.state.tick)
    // Cap at theoretical day end so scrubber never exceeds the calendar day
    const theoreticalEnd = dayEndTick(day)
    return { startTick, endTick: Math.min(end, theoreticalEnd) }
  }

  const getDayBounds = () => dayBounds(resolvedViewDay())

  const viewSim = (): Simulation => (mode === 'replay' && fork ? fork : live)

  const getState = (): SimStateBridge => {
    const sim = viewSim()
    const t = toSimTime(sim.state.tick)
    const placeCounts: Record<string, number> = {}
    for (const p of sim.state.places) {
      placeCounts[p.kind] = (placeCounts[p.kind] ?? 0) + 1
    }
    const a0 = live.state.agents[0]
    applyBreathe()
    return {
      ready,
      mode,
      day: t.day,
      hour: t.hour,
      minute: t.minute,
      tick: sim.state.tick,
      speed,
      userSpeed,
      agentCount: sim.state.agents.length,
      agentIds: sim.state.agents.map((a) => a.id),
      selectedAgentId,
      selectedPlaceId,
      placeIds: sim.state.places.map((p) => p.id),
      eventCount: mode === 'live' ? live.getEventCount() : sim.getEventCount(),
      archivedDayCount: live.archives().length,
      viewDay: resolvedViewDay(),
      placeCounts,
      lastSavedTick,
      seed: live.state.seed,
      agent0: a0
        ? { id: a0.id, x: a0.x, y: a0.y, wallet: a0.wallet }
        : null,
      mind: mindHook
        ? mindHook.getMeter()
        : {
            enabled: false,
            agentIds: [],
            pending: 0,
            thinking: 0,
            decisions: 0,
            fallbacks: 0,
            stales: 0,
            meanLatencyMs: 0,
            approxChars: 0,
            provider: 'off',
            decideCalls: 0,
            budgetUsedHour: 0,
            budgetMaxHour: 60,
            budgetUsedDay: 0,
            budgetMaxDay: 300,
            budgetCooldown: false,
          },
    }
  }

  const scanCriticals = (sim: Simulation, now: number) => {
    const events = sim.getEvents()
    const start = lastCriticalEventCount
    if (start >= events.length) {
      lastCriticalEventCount = events.length
      return
    }
    for (let i = start; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type === 'need:critical' && ev.agentId) {
        const need = (ev.data?.need as string) ?? 'hunger'
        scene.overlays.pushCritical(ev.agentId, need, now)
      }
    }
    lastCriticalEventCount = events.length
  }

  /** Speech bubbles from mind:say — live path prefers new events only. */
  const scanSpeech = (sim: Simulation, now: number, liveMode: boolean) => {
    if (!liveMode) {
      lastSpeechEventCount = sim.getEventCount()
      return
    }
    const events = sim.getEvents()
    const start = lastSpeechEventCount
    if (start >= events.length) {
      lastSpeechEventCount = events.length
      return
    }
    for (let i = start; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type === 'mind:say' && ev.agentId) {
        const text = String(ev.data?.text ?? '')
        if (text) scene.overlays.pushSpeech(ev.agentId, text, now)
      }
    }
    lastSpeechEventCount = events.length
  }

  /** Pickup / coin toasts — live path only, new events only (no replay backfill). */
  const scanToasts = (sim: Simulation, now: number, liveMode: boolean) => {
    if (!liveMode) {
      lastToastEventCount = sim.getEventCount()
      return
    }
    const events = sim.getEvents()
    const start = lastToastEventCount
    if (start >= events.length) {
      lastToastEventCount = events.length
      return
    }
    for (let i = start; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type === 'goods:transfer') {
        const toKind = ev.data?.toKind as string | undefined
        if (toKind === 'agent' && ev.agentId) {
          const good = (ev.data?.good as string) ?? 'food'
          const amount = (ev.data?.amount as number) ?? 1
          scene.overlays.pushToast(ev.agentId, 'goods', good, amount, now)
        }
      } else if (ev.type === 'coins:transfer') {
        const kind = ev.data?.kind as string | undefined
        const amount = (ev.data?.amount as number) ?? 0
        const to = ev.data?.to as string | undefined
        if (
          (kind === 'wage' || kind === 'buy') &&
          to &&
          to !== 'treasury' &&
          amount > 0
        ) {
          // Wage: agent receives; buy: stall/treasury receives — toast on receiver agent only for wage/agent buy refund edge
          if (kind === 'wage') {
            scene.overlays.pushToast(to, 'coins', 'coins', amount, now)
          } else if (kind === 'buy' && sim.state.agents.some((a) => a.id === to)) {
            scene.overlays.pushToast(to, 'coins', 'coins', amount, now)
          }
        }
        // Also show spend toast on buyer when coins leave an agent for a buy
        if (kind === 'buy') {
          const from = ev.data?.from as string | undefined
          if (from && from !== 'treasury' && amount > 0 && ev.agentId) {
            // Prefer agent who bought — agentId is usually the buyer when to is treasury/seller
            const buyer =
              from !== 'treasury' ? from : ev.agentId !== to ? ev.agentId : null
            if (buyer && sim.state.agents.some((a) => a.id === buyer)) {
              // Skip negative toast; pickups are positive only per spec
            }
          }
        }
      }
    }
    lastToastEventCount = events.length
  }

  /** Celebrations — live path only, no ffwd/replay backfill. */
  const scanCelebrations = (sim: Simulation, now: number, liveMode: boolean) => {
    if (!liveMode) {
      lastCelebrateEventCount = sim.getEventCount()
      return
    }
    const events = sim.getEvents()
    const start = lastCelebrateEventCount
    if (start >= events.length) {
      lastCelebrateEventCount = events.length
      return
    }
    for (let i = start; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type === 'construction:completed') {
        const placeId = (ev.data?.placeId as string) ?? null
        scene.celebrateConstruction(placeId, now)
      } else if (ev.type === 'goods:produced') {
        const placeId = (ev.data?.placeId as string) ?? null
        const good = ev.data?.good as string | undefined
        // Harvest mint at farms
        if (good === 'food' || !good) {
          const place = placeId
            ? sim.state.places.find((p) => p.id === placeId)
            : undefined
          if (!placeId || place?.kind === 'farm') {
            scene.celebrateHarvest(placeId, now)
          }
        }
      } else if (ev.type === 'relationship:close') {
        const a = (ev.data?.agentIdA as string) ?? ev.agentId
        const b = ev.data?.agentIdB as string | undefined
        if (a && b) scene.celebrateClose(a, b, now)
      }
    }
    lastCelebrateEventCount = events.length
  }

  const applyScene = (now: number) => {
    const sim = viewSim()
    const alpha = speed > 0 ? Math.min(1, accumulator) : 1
    const t = toSimTime(sim.state.tick)
    scene.setTime(t)
    scene.updateAgents(
      sim.state.agents,
      prevPositions,
      alpha,
      selectedAgentId,
      selectedPlaceId,
      sim.state.places,
      now,
    )
    if (follow && selectedAgentId) {
      scene.followAgent(sim.state.agents, prevPositions, alpha, selectedAgentId, 0.08)
    }
    scene.updateOverlays(
      sim.state.agents,
      prevPositions,
      alpha,
      selectedAgentId,
      sim.state.places,
      now,
      t,
    )
    scene.updateEconomyVisuals(sim.state.places, now)
  }

  const setSpeed = (n: number) => {
    if (!SPEEDS.has(n)) return
    // User intent always updates restore target (including mid-think)
    userSpeed = n
    applyBreathe()
  }

  const pause = () => {
    userSpeed = 0
    speed = 0
  }

  const goLive = () => {
    mode = 'live'
    fork = null
    viewDayOverride = null
    accumulator = 0
    prevPositions = capturePositions(live)
    lastCriticalEventCount = live.getEventCount()
    lastToastEventCount = live.getEventCount()
    lastCelebrateEventCount = live.getEventCount()
    applyBreathe()
    applyScene(performance.now())
  }

  const enterReplayAt = (target: number) => {
    const head = live.state.tick
    const t = Math.max(0, Math.min(Math.floor(target), head))
    if (t >= head) {
      goLive()
      return
    }
    mode = 'replay'
    fork = live.stateAt(t)
    // Hold at scrubbed tick until the user presses play
    userSpeed = 0
    speed = 0
    accumulator = 0
    prevPositions = capturePositions(fork)
    lastCriticalEventCount = fork.getEventCount()
    // Do not backfill toasts / celebrations when entering replay
    lastToastEventCount = fork.getEventCount()
    lastCelebrateEventCount = fork.getEventCount()
    applyScene(performance.now())
  }

  const scrubTo = (tick: number) => {
    const day = resolvedViewDay()
    const { startTick, endTick } = dayBounds(day)
    const head = live.state.tick
    // Clamp to the viewed day's scrubber range
    let target = Math.max(startTick, Math.min(Math.floor(tick), endTick, head))
    viewDayOverride = day

    if (target >= head && day === liveDay()) {
      goLive()
      return
    }
    enterReplayAt(target)
    viewDayOverride = day
  }

  const loadDay = (day: number) => {
    const maxDay = liveDay()
    if (!Number.isFinite(day) || day < 1 || day > maxDay) return

    viewDayOverride = day
    const { startTick, endTick } = dayBounds(day)

    if (day === maxDay) {
      // Today: scoped view — stay live at head, scrubber limited to today-so-far
      if (mode === 'replay') {
        // Jump to start of today in replay, or go live at head?
        // Spec: "scoped live view of today-so-far" → go live
        goLive()
        viewDayOverride = day
      }
      return
    }

    // Past day: fork at day start (scrubber = full day bounds)
    void endTick
    enterReplayAt(startTick)
    viewDayOverride = day
  }

  const ffwd = (n: number) => {
    if (n <= 0) return
    // Never waits on minds — respectBreathe=false
    advanceLive(n, false)
    if (mode === 'live') {
      prevPositions = capturePositions(live)
      lastCriticalEventCount = live.getEventCount()
      // Skip toast/celebration spam from large ffwd batches — advance cursor only
      lastToastEventCount = live.getEventCount()
      lastCelebrateEventCount = live.getEventCount()
      applyBreathe()
      applyScene(performance.now())
    } else if (fork) {
      // Live advanced underneath; keep replay fork as-is
      applyScene(performance.now())
    }
    refreshBridge(getState())
  }

  const setMindHook = (hook: MindTickHook | null) => {
    mindHook = hook
    applyBreathe()
  }

  const selectAgent = (id: string | null) => {
    selectedAgentId = id
    if (id) selectedPlaceId = null
    if (!id) follow = false
  }

  const selectPlace = (id: string | null) => {
    selectedPlaceId = id
    if (id) {
      selectedAgentId = null
      follow = false
    }
  }

  const setFollow = (on: boolean) => {
    follow = on && !!selectedAgentId
  }

  const getFollow = () => follow

  const frame = (ts: number) => {
    if (!running) return
    if (!lastTs) lastTs = ts
    // Higher speeds must not drop wall time on slow WebGL frames (headless + terrain).
    // Cap still bounds spiral-of-death; pure sim is >> 1k ticks/s so a 1s catch-up is fine.
    applyBreathe()
    const dtCap = speed >= 64 ? 1.0 : speed >= 8 ? 0.25 : 0.1
    const dt = Math.min(dtCap, (ts - lastTs) / 1000)
    lastTs = ts

    if (speed > 0) {
      // 1× = 1 tick per real second
      accumulator += dt * speed
      let steps = Math.floor(accumulator)
      if (steps > MAX_TICKS_PER_FRAME) steps = MAX_TICKS_PER_FRAME
      accumulator -= steps

      if (mode === 'live') {
        if (steps > 0) {
          prevPositions = capturePositions(live)
          advanceLive(steps, true)
        }
      } else if (fork) {
        if (steps > 0) {
          const head = live.state.tick
          const day = resolvedViewDay()
          const { endTick } = dayBounds(day)
          const cap = Math.min(head, endTick)
          const room = cap - fork.state.tick
          const take = Math.min(steps, Math.max(0, room))
          if (take > 0) {
            prevPositions = capturePositions(fork)
            fork.advanceTicks(take)
          }
          if (fork.state.tick >= head && day === liveDay()) {
            goLive()
          } else if (fork.state.tick >= endTick && day < liveDay()) {
            // Past day: auto-pause at day end
            userSpeed = 0
            speed = 0
            accumulator = 0
          }
        }
      }
    }

    applyBreathe()
    const sim = viewSim()
    scanCriticals(sim, ts)
    scanToasts(sim, ts, mode === 'live')
    scanCelebrations(sim, ts, mode === 'live')
    scanSpeech(sim, ts, mode === 'live')
    applyScene(ts)
    scene.render()
    refreshBridge(getState())
    rafId = requestAnimationFrame(frame)
  }

  const start = () => {
    if (running) return
    running = true
    lastTs = 0
    accumulator = 0
    prevPositions = capturePositions(viewSim())
    lastCriticalEventCount = viewSim().getEventCount()
    lastToastEventCount = viewSim().getEventCount()
    lastCelebrateEventCount = viewSim().getEventCount()
    applyBreathe()
    applyScene(performance.now())
    refreshBridge(getState())
    rafId = requestAnimationFrame(frame)
  }

  const stop = () => {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  return {
    setSpeed,
    pause,
    scrubTo,
    goLive,
    selectAgent,
    selectPlace,
    setFollow,
    getFollow,
    loadDay,
    ffwd,
    getState,
    start,
    stop,
    getViewSim: viewSim,
    getLiveSim: () => live,
    setMindHook,
    getMode: () => mode,
    setLastSavedTick: (tick: number | null) => {
      lastSavedTick = tick
    },
    getLastSavedTick: () => lastSavedTick,
    getAlpha: () => accumulator,
    getPrevAgentPositions: () => prevPositions,
    getDayBounds,
    getUserSpeed: () => userSpeed,
  }
}

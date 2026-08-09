import type { SceneHandle } from './render/scene'
import { Simulation } from './sim/sim'
import { toSimTime } from './sim/time'
import type { SimMode, SimStateBridge } from './bridge'
import { refreshBridge } from './bridge'

export interface LoopController {
  setSpeed: (n: number) => void
  pause: () => void
  scrubTo: (tick: number) => void
  goLive: () => void
  selectAgent: (id: string | null) => void
  setFollow: (on: boolean) => void
  getFollow: () => boolean
  getState: () => SimStateBridge
  start: () => void
  stop: () => void
  getViewSim: () => Simulation
  /** Accumulator fraction toward the next tick [0,1), for render interp. */
  getAlpha: () => number
  getPrevAgentPositions: () => Map<string, { x: number; y: number }>
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
  let speed = 1
  let mode: SimMode = 'live'
  let selectedAgentId: string | null = null
  let follow = false
  let fork: Simulation | null = null
  let accumulator = 0
  let lastTs = 0
  let rafId = 0
  let running = false
  let ready = true
  let prevPositions = capturePositions(live)
  /** Event count of the view sim already scanned for critical bubbles. */
  let lastCriticalEventCount = 0

  const viewSim = (): Simulation => (mode === 'replay' && fork ? fork : live)

  const getState = (): SimStateBridge => {
    const sim = viewSim()
    const t = toSimTime(sim.state.tick)
    return {
      ready,
      mode,
      day: t.day,
      hour: t.hour,
      minute: t.minute,
      tick: sim.state.tick,
      speed,
      agentCount: sim.state.agents.length,
      agentIds: sim.state.agents.map((a) => a.id),
      selectedAgentId,
      eventCount: mode === 'live' ? live.getEventCount() : sim.getEventCount(),
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

  const applyScene = (now: number) => {
    const sim = viewSim()
    const alpha = speed > 0 ? Math.min(1, accumulator) : 1
    scene.setTime(toSimTime(sim.state.tick))
    scene.updateAgents(sim.state.agents, prevPositions, alpha, selectedAgentId)
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
    )
  }

  const setSpeed = (n: number) => {
    if (!SPEEDS.has(n)) return
    speed = n
  }

  const pause = () => {
    speed = 0
  }

  const scrubTo = (tick: number) => {
    const head = live.state.tick
    const target = Math.max(0, Math.min(Math.floor(tick), head))
    if (target >= head) {
      goLive()
      return
    }
    mode = 'replay'
    fork = live.stateAt(target)
    // Hold at scrubbed tick until the user presses play (required for stable scrub UX / e2e)
    speed = 0
    accumulator = 0
    prevPositions = capturePositions(fork)
    // Don't re-fire historical criticals on scrub
    lastCriticalEventCount = fork.getEventCount()
    applyScene(performance.now())
  }

  const goLive = () => {
    mode = 'live'
    fork = null
    accumulator = 0
    prevPositions = capturePositions(live)
    lastCriticalEventCount = live.getEventCount()
    applyScene(performance.now())
  }

  const selectAgent = (id: string | null) => {
    selectedAgentId = id
    if (!id) follow = false
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
          // Positions before the batch for interp; step the whole batch at once
          prevPositions = capturePositions(live)
          live.advanceTicks(steps)
        }
      } else if (fork) {
        if (steps > 0) {
          const head = live.state.tick
          const room = head - fork.state.tick
          const take = Math.min(steps, room)
          if (take > 0) {
            prevPositions = capturePositions(fork)
            fork.advanceTicks(take)
          }
          if (fork.state.tick >= head) {
            goLive()
          }
        }
      }
    }

    const sim = viewSim()
    scanCriticals(sim, ts)
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
    setFollow,
    getFollow,
    getState,
    start,
    stop,
    getViewSim: viewSim,
    getAlpha: () => accumulator,
    getPrevAgentPositions: () => prevPositions,
  }
}

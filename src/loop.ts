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
  let fork: Simulation | null = null
  let accumulator = 0
  let lastTs = 0
  let rafId = 0
  let running = false
  let ready = true
  let prevPositions = capturePositions(live)

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

  const applyScene = () => {
    const sim = viewSim()
    scene.setTime(toSimTime(sim.state.tick))
    // alpha: progress into the next tick; after multi-step show near current
    const alpha = speed > 0 ? Math.min(1, accumulator) : 1
    scene.updateAgents(sim.state.agents, prevPositions, alpha, selectedAgentId)
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
    applyScene()
  }

  const goLive = () => {
    mode = 'live'
    fork = null
    accumulator = 0
    prevPositions = capturePositions(live)
    applyScene()
  }

  const selectAgent = (id: string | null) => {
    selectedAgentId = id
  }

  const frame = (ts: number) => {
    if (!running) return
    if (!lastTs) lastTs = ts
    const dt = Math.min(0.1, (ts - lastTs) / 1000)
    lastTs = ts

    if (speed > 0) {
      // 1× = 1 tick per real second
      accumulator += dt * speed
      let steps = Math.floor(accumulator)
      if (steps > MAX_TICKS_PER_FRAME) steps = MAX_TICKS_PER_FRAME
      accumulator -= steps

      if (mode === 'live') {
        if (steps > 0) {
          // Classic fixed-timestep: previous = state before last step in batch
          for (let i = 0; i < steps; i++) {
            prevPositions = capturePositions(live)
            live.advanceTicks(1)
          }
        }
      } else if (fork) {
        if (steps > 0) {
          const head = live.state.tick
          const room = head - fork.state.tick
          const take = Math.min(steps, room)
          for (let i = 0; i < take; i++) {
            prevPositions = capturePositions(fork)
            fork.advanceTicks(1)
          }
          if (fork.state.tick >= head) {
            goLive()
          }
        }
      }
    }

    applyScene()
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
    applyScene()
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
    getState,
    start,
    stop,
    getViewSim: viewSim,
    getAlpha: () => accumulator,
    getPrevAgentPositions: () => prevPositions,
  }
}

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
}

const SPEEDS = new Set([0, 1, 8, 64])
const MAX_TICKS_PER_FRAME = 256

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
      selectedAgentId,
      eventCount: mode === 'live' ? live.getEventCount() : sim.getEventCount(),
    }
  }

  const applySceneTime = () => {
    const sim = viewSim()
    scene.setTime(toSimTime(sim.state.tick))
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
    applySceneTime()
  }

  const goLive = () => {
    mode = 'live'
    fork = null
    accumulator = 0
    applySceneTime()
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
        if (steps > 0) live.advanceTicks(steps)
      } else if (fork) {
        if (steps > 0) {
          const head = live.state.tick
          const room = head - fork.state.tick
          const take = Math.min(steps, room)
          if (take > 0) fork.advanceTicks(take)
          if (fork.state.tick >= head) {
            goLive()
          }
        }
      }
    }

    applySceneTime()
    scene.render()
    refreshBridge(getState())
    rafId = requestAnimationFrame(frame)
  }

  const start = () => {
    if (running) return
    running = true
    lastTs = 0
    accumulator = 0
    applySceneTime()
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
  }
}

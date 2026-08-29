import { toSimTime } from '../sim/time'
import type { Simulation } from '../sim/sim'
import { capturePositions, type AgentsHandle } from './agents'
import type { CameraHandle } from './camera'
import type { CompletionFxHandle } from './completionFx'
import type { TownSpeed } from './constants'
import type { DebugHandle } from './debug'
import type { LightingHandle } from './lighting'
import { isTownSpeed, stepAccumulator } from './loopMath'
import type { PlacesHandle } from './places'
import type { TerrainHandle } from './terrain'
import type { WorldOverlaysHandle } from './worldOverlays'

export interface TownLoop {
  setSpeed: (n: TownSpeed) => void
  getSpeed: () => TownSpeed
  getAlpha: () => number
  start: () => void
  stop: () => void
  /** V6 debug override for sun/sky hour-of-day; null returns to sim time. */
  setTimeOfDay: (hourFloat: number | null) => void
  /** Force a places/terrain/lighting re-sync now (used after `ffwd`). */
  syncVisuals: () => void
  /** Advance exact live ticks while preserving the Luna mind cadence. */
  advanceTicks: (n: number, allowNewConversations?: boolean) => void
  /** Attach or clear the live Luna mind hook. */
  setMindHook: (hook: TownMindHook | null) => void
}

export interface TownMindHook {
  onAfterTick: (
    sim: Simulation,
    opts?: { allowNewConversations?: boolean },
  ) => void
}

/**
 * The town renderer used to batch `Simulation.advanceTicks`, which bypassed
 * LunaBrain entirely. Keep this tiny seam exported so the per-tick contract is
 * regression-testable without standing up WebGL.
 */
export function advanceTownTicks(
  sim: Pick<Simulation, 'advanceTicks'>,
  n: number,
  mindHook: TownMindHook | null,
  allowNewConversations: boolean,
): void {
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    sim.advanceTicks(1)
    mindHook?.onAfterTick(sim as Simulation, { allowNewConversations })
  }
}

export function createTownLoop(opts: {
  sim: Simulation
  camera: CameraHandle
  lighting: LightingHandle
  agents: AgentsHandle
  places: PlacesHandle
  terrain: TerrainHandle
  overlays?: WorldOverlaysHandle
  fx: CompletionFxHandle
  debug: DebugHandle
}): TownLoop {
  const { sim, camera, lighting, agents, places, terrain, overlays, fx, debug } = opts
  let speed: TownSpeed = 1
  let accumulator = 0
  let alpha = 1
  let lastTs = 0
  let rafId = 0
  let running = false
  let prev = capturePositions(sim.state.agents)
  let timeOverride: number | null = null
  let mindHook: TownMindHook | null = null

  const applyAgents = () => {
    agents.update(sim.state.agents, prev, alpha, sim.state.width, sim.state.height)
    overlays?.update(sim.state)
  }

  const syncVisuals = () => {
    places.update(sim.state)
    terrain.refreshWear(sim.state)
    overlays?.update(sim.state)
  }

  const publish = () => {
    const t = toSimTime(sim.state.tick)
    debug.state.day = t.day
    debug.state.hour = t.hour
    debug.state.minute = t.minute
    debug.state.tick = sim.state.tick
    debug.state.speed = speed
    debug.state.agentCount = sim.state.agents.length
    debug.state.placeCount = sim.state.places.length
    let constructing = 0
    let structureActive = 0
    let structureBuilt = 0
    for (const p of sim.state.places) {
      if (p.kind === 'construction-site') constructing += 1
      if (p.structure) {
        if (p.kind === 'construction-site') structureActive += 1
        else structureBuilt += 1
      }
    }
    debug.state.constructionCount = constructing
    debug.state.structures = { active: structureActive, built: structureBuilt }
    debug.state.drawCalls = lighting.rendererInfo().calls
    debug.writeCamera(camera.getState())
  }

  const frame = (ts: number) => {
    if (!running) return
    if (!lastTs) lastTs = ts
    const dt = (ts - lastTs) / 1000
    lastTs = ts

    const stepped = stepAccumulator(accumulator, dt, speed)
    accumulator = stepped.accumulator
    alpha = stepped.alpha
    if (stepped.steps > 0) {
      prev = capturePositions(sim.state.agents)
      advanceTownTicks(sim, stepped.steps, mindHook, speed <= 1)
      syncVisuals()
    }

    camera.update(Math.min(0.08, Math.max(0, dt)))
    applyAgents()
    const t = toSimTime(sim.state.tick)
    lighting.updateForTime(timeOverride ?? t.hour + t.minute / 60)
    fx.update(performance.now())
    lighting.render()
    debug.noteFrame(dt)
    publish()
    if (!debug.state.ready) debug.state.ready = true
    rafId = requestAnimationFrame(frame)
  }

  return {
    setSpeed: (n) => {
      if (!isTownSpeed(n)) return
      speed = n
      if (speed === 0) alpha = 1
      debug.state.speed = speed
    },
    getSpeed: () => speed,
    getAlpha: () => alpha,
    start: () => {
      if (running) return
      running = true
      lastTs = 0
      prev = capturePositions(sim.state.agents)
      applyAgents()
      publish()
      rafId = requestAnimationFrame(frame)
    },
    stop: () => {
      running = false
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
    },
    setTimeOfDay: (hourFloat) => {
      timeOverride = hourFloat
    },
    advanceTicks: (n, allowNewConversations = false) => {
      advanceTownTicks(sim, n, mindHook, allowNewConversations)
    },
    setMindHook: (hook) => {
      mindHook = hook
    },
    syncVisuals,
  }
}

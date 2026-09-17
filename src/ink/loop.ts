import { EventTrace } from '../sim/events'
import { createRng } from '../sim/rng'
import type { SimEvent } from '../sim/types'
import { createGrokPump, makeRunId, type InkEngineState } from './mind/grokBrain'
import { clockOf, INK_CONFIG } from './sim/config'
import { ruleBrain } from './sim/ruleBrain'
import { advanceTick, applyIntent } from './sim/step'
import type { InkBrains, InkState, Intent, IntentSource, MindId, Vec2 } from './sim/types'
import { createWorld, fridgeOf } from './sim/world'
import type { SceneHandle } from './render/scene'

// A live decide measures ~0.9s median and has been seen at 5.4s; 12s an hour keeps the
// slow tail inside its own hour, so a decision is rarely wasted. Faster speeds still work,
// they just spend more hours on the fallback brain.
export const MS_PER_HOUR_1X = 12000
export const MAX_TICKS_PER_FRAME = 120
export const INK_SPEEDS = [0.5, 1, 2, 4] as const

export interface InkMindBridge {
  id: MindId
  at: string | null
  pos: Vec2
  hunger: number
  energy: number
  social: number
  money: number
  fridge: number
  action: string | null
  reason: string
  source: IntentSource
  sufferedHours: number
}

export interface InkBridgeState {
  ready: boolean
  tick: number
  day: number
  dayName: string
  hour: number
  minute: number
  speed: number
  paused: boolean
  eventCount: number
  minds: InkMindBridge[]
  engine: InkEngineState
}

export interface InkBridgeControl {
  setSpeed: (n: number) => void
  pause: () => void
  resume: () => void
  step: (ticks: number) => void
  seek: (tick: number) => void
  state: () => InkBridgeState
  events: (sinceSeq?: number) => SimEvent[]
  applyIntent: (mindId: MindId, intent: Intent, source?: IntentSource) => void
}

declare global {
  interface Window {
    __inkState: InkBridgeState
    __inkControl: InkBridgeControl
  }
}

export interface InkLoop {
  start: () => void
  stop: () => void
  subscribe: (fn: () => void) => () => void
  getBridge: () => InkBridgeState
  control: InkBridgeControl
}

function snapshotMinds(state: InkState, sources: Record<MindId, IntentSource>): InkMindBridge[] {
  return state.minds.map((m) => ({
    id: m.id,
    at: m.at,
    pos: { x: m.pos.x, y: m.pos.y },
    hunger: m.hunger,
    energy: m.energy,
    social: m.social,
    money: m.money,
    fridge: fridgeOf(state, m),
    action: m.current?.action ?? null,
    reason: m.current?.reason ?? '',
    source: sources[m.id],
    sufferedHours: m.sufferedHours,
  }))
}

const ZERO_ENGINE: InkEngineState = {
  brain: 'rule',
  model: '',
  llm: 0,
  fallback: 0,
  stale: 0,
  budget: { hour: 0, day: 0, maxPerHour: 0, maxPerDay: 0 },
  runId: '',
  hourDecisions: 0,
}

function toBridge(
  state: InkState,
  speed: number,
  paused: boolean,
  events: EventTrace,
  sources: Record<MindId, IntentSource>,
  ready: boolean,
  engine: InkEngineState,
): InkBridgeState {
  const c = clockOf(state.tick)
  return {
    ready,
    tick: state.tick,
    day: c.day,
    dayName: c.dayName,
    hour: c.hour,
    minute: c.minute,
    speed,
    paused,
    eventCount: events.length,
    minds: snapshotMinds(state, sources),
    engine,
  }
}

export function createInkLoop(opts: {
  canvas: HTMLCanvasElement
  scene: SceneHandle
  seed: number
  brain?: 'rule' | 'grok'
}): InkLoop {
  const brainMode = opts.brain === 'grok' ? 'grok' : 'rule'
  const ruleBrains: InkBrains = { A: ruleBrain, B: ruleBrain }
  let state = createWorld(opts.seed)
  let events = new EventTrace()
  let rng = createRng(opts.seed)
  const sources: Record<MindId, IntentSource> = { A: 'rule', B: 'rule' }
  let speed = 1
  let userPaused = false
  let hiddenPause = false
  let ready = false
  let running = false
  let raf = 0
  let lastTs = 0
  let acc = 0
  let prev = new Map<string, Vec2>(state.minds.map((m) => [m.id, { x: m.pos.x, y: m.pos.y }]))
  const listeners = new Set<() => void>()
  let healthTimer: ReturnType<typeof setInterval> | 0 = 0

  const paused = () => userPaused || hiddenPause

  const pump =
    brainMode === 'grok'
      ? createGrokPump({
          runId: makeRunId(opts.seed, new Date()),
          seed: opts.seed,
          getState: () => state,
          getEvents: () => events,
          applyIntent: (mindId, intent, source) => {
            applyIntent(state, mindId, intent, source, events)
            sources[mindId] = source
            notify()
          },
          isLive: () => !paused(),
        })
      : null

  const brains: InkBrains = pump ? pump.brains : ruleBrains

  const engineOf = (): InkEngineState => {
    if (!pump) return ZERO_ENGINE
    return pump.stats()
  }

  const notify = () => {
    const bridge = toBridge(state, speed, paused(), events, sources, ready, engineOf())
    window.__inkState = bridge
    for (const fn of listeners) fn()
  }

  const capturePrev = () => {
    prev = new Map(state.minds.map((m) => [m.id, { x: m.pos.x, y: m.pos.y }]))
  }

  const tickOnce = (use: InkBrains = brains, source: IntentSource = 'rule') => {
    capturePrev()
    advanceTick(state, use, events, rng, source)
  }

  const stepTicks = (n: number) => {
    const count = Math.max(0, Math.floor(n))
    for (let i = 0; i < count; i++) tickOnce()
    acc = 0
    notify()
  }

  const rebuild = (seed: number) => {
    pump?.abortAll()
    state = createWorld(seed)
    events = new EventTrace()
    rng = createRng(seed)
    sources.A = 'rule'
    sources.B = 'rule'
    capturePrev()
    acc = 0
  }

  const control: InkBridgeControl = {
    setSpeed: (n) => {
      if (n <= 0) {
        userPaused = true
        speed = 1
      } else {
        speed = n
        userPaused = false
      }
      lastTs = 0
      acc = 0
      notify()
    },
    pause: () => {
      userPaused = true
      lastTs = 0
      acc = 0
      notify()
    },
    resume: () => {
      userPaused = false
      lastTs = 0
      acc = 0
      notify()
    },
    step: (ticks) => {
      stepTicks(ticks)
    },
    seek: (tick) => {
      const seed = state.seed
      rebuild(seed)
      const target = Math.max(state.tick, tick)
      while (state.tick < target) tickOnce(ruleBrains, 'rule')
      acc = 0
      notify()
    },
    state: () => toBridge(state, speed, paused(), events, sources, ready, engineOf()),
    events: (sinceSeq) => {
      const all = events.getAll()
      if (sinceSeq === undefined) return all.slice()
      return all.filter((e) => e.seq >= sinceSeq)
    },
    applyIntent: (mindId, intent, source = 'llm') => {
      applyIntent(state, mindId, intent, source, events)
      sources[mindId] = source
      notify()
    },
  }

  const msPerTick = () => MS_PER_HOUR_1X / INK_CONFIG.ticksPerHour / Math.max(speed, 0.0001)

  const frame = (ts: number) => {
    if (!running) return
    raf = requestAnimationFrame(frame)
    if (!lastTs) lastTs = ts
    const dt = Math.max(0, ts - lastTs)
    lastTs = ts
    if (!paused()) {
      acc += dt
      const cost = msPerTick()
      let n = 0
      while (acc >= cost && n < MAX_TICKS_PER_FRAME) {
        acc -= cost
        tickOnce()
        n++
      }
      if (n === MAX_TICKS_PER_FRAME) acc = 0
      if (n > 0) notify()
    }
    const alpha = paused() ? 0 : Math.min(1, acc / msPerTick())
    opts.scene.render(state, prev, alpha)
  }

  const onVis = () => {
    if (document.hidden) {
      hiddenPause = true
      lastTs = 0
      acc = 0
    } else {
      hiddenPause = false
      lastTs = 0
      acc = 0
    }
    notify()
  }

  const pollHealth = () => {
    if (!pump) return
    void fetch('/api/ink/health')
      .then((r) => r.json())
      .then((j: { model?: unknown; budget?: InkEngineState['budget'] }) => {
        if (typeof j.model === 'string' && j.model) pump.setModel(j.model)
        if (j.budget && typeof j.budget === 'object') pump.setBudget(j.budget)
        notify()
      })
      .catch(() => {
        /* sidecar optional */
      })
  }

  const start = () => {
    if (running) return
    running = true
    ready = true
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', opts.scene.resize)
    opts.scene.resize()
    window.__inkControl = control
    if (pump) {
      pump.writeRunMeta()
      pollHealth()
      healthTimer = setInterval(pollHealth, 5000)
    }
    notify()
    lastTs = 0
    raf = requestAnimationFrame(frame)
  }

  const stop = () => {
    running = false
    cancelAnimationFrame(raf)
    if (healthTimer) clearInterval(healthTimer)
    healthTimer = 0
    pump?.abortAll()
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('resize', opts.scene.resize)
  }

  window.__inkControl = control
  window.__inkState = toBridge(state, speed, paused(), events, sources, ready, engineOf())

  return {
    start,
    stop,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getBridge: () => toBridge(state, speed, paused(), events, sources, ready, engineOf()),
    control,
  }
}

import { EventTrace } from '../sim/events'
import { createRng } from '../sim/rng'
import type { SimEvent } from '../sim/types'
import { clockOf, INK_CONFIG } from './sim/config'
import { ruleBrain } from './sim/ruleBrain'
import { advanceTick, applyIntent } from './sim/step'
import type { InkBrains, InkState, Intent, IntentSource, MindId, Vec2 } from './sim/types'
import { createWorld, fridgeOf } from './sim/world'
import type { SceneHandle } from './render/scene'

export const MS_PER_HOUR_1X = 4000
export const MAX_TICKS_PER_FRAME = 120
export const INK_SPEEDS = [0.25, 1, 2, 4] as const

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

function toBridge(
  state: InkState,
  speed: number,
  paused: boolean,
  events: EventTrace,
  sources: Record<MindId, IntentSource>,
  ready: boolean,
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
  }
}

export function createInkLoop(opts: {
  canvas: HTMLCanvasElement
  scene: SceneHandle
  seed: number
}): InkLoop {
  const brains: InkBrains = { A: ruleBrain, B: ruleBrain }
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

  const paused = () => userPaused || hiddenPause

  const notify = () => {
    const bridge = toBridge(state, speed, paused(), events, sources, ready)
    window.__inkState = bridge
    for (const fn of listeners) fn()
  }

  const capturePrev = () => {
    prev = new Map(state.minds.map((m) => [m.id, { x: m.pos.x, y: m.pos.y }]))
  }

  const tickOnce = () => {
    capturePrev()
    advanceTick(state, brains, events, rng, 'rule')
  }

  const stepTicks = (n: number) => {
    const count = Math.max(0, Math.floor(n))
    for (let i = 0; i < count; i++) tickOnce()
    acc = 0
    notify()
  }

  const rebuild = (seed: number) => {
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
      while (state.tick < target) tickOnce()
      acc = 0
      notify()
    },
    state: () => toBridge(state, speed, paused(), events, sources, ready),
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

  const start = () => {
    if (running) return
    running = true
    ready = true
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', opts.scene.resize)
    opts.scene.resize()
    window.__inkControl = control
    notify()
    lastTs = 0
    raf = requestAnimationFrame(frame)
  }

  const stop = () => {
    running = false
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('resize', opts.scene.resize)
  }

  window.__inkControl = control
  window.__inkState = toBridge(state, speed, paused(), events, sources, ready)

  return {
    start,
    stop,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getBridge: () => toBridge(state, speed, paused(), events, sources, ready),
    control,
  }
}

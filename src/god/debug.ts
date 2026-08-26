import type { CameraPose } from './feel'

export type HandMode = 'idle' | 'hover' | 'carry'

export interface GodState {
  ready: boolean
  physicsBackend: 'rapier'
  fps: number
  propCount: number
  awakeCount: number
  hand: {
    x: number
    y: number
    z: number
    lift: number
    state: HandMode
    hoverId: string | null
    heldId: string | null
  }
  camera: { yaw: number; pitch: number; dist: number; tx: number; tz: number }
  counters: { grabs: number; throws: number; impacts: number; splashes: number }
  stepMs: number
  renderMs: number
  wasmInitMs: number
}

export interface GodControl {
  setCamera: (o: { yaw?: number; pitch?: number; dist?: number; tx?: number; tz?: number }) => void
  moveHandTo: (x: number, z: number, lift?: number) => void
  grabNearest: (kind?: string) => string | null
  release: () => void
  throwTo: (x: number, z: number, power?: number) => void
  /** Release the held prop through the REAL player path: releaseVelocity(handVel, mass). */
  throwWithHandVelocity: (
    vx: number,
    vy: number,
    vz: number,
  ) => { kind: string; mass: number; handSpeed: number; releaseSpeed: number } | null
  spawnProps: (n: number, kind?: string) => void
  stress: (n: number) => void
  reset: () => void
  showRefSpheres: (on: boolean) => void
  fpsProbe: (ms: number) => Promise<{ avg: number; min: number; frames: number }>
  listProps: () => Array<{ id: string; kind: string; x: number; y: number; z: number; mass: number }>
  /** DEV: force the grip pose 0 (open) → 1 (closed). null returns to live state. */
  setHandPose: (t: number | null) => void
}

declare global {
  interface Window {
    __godState?: GodState
    __godControl?: GodControl
  }
}

export interface DebugHandle {
  state: GodState
  noteFrame: (dt: number, stepMs: number, renderMs: number) => void
  fpsProbe: (ms: number) => Promise<{ avg: number; min: number; frames: number }>
  dispose: () => void
}

export function createDebug(control: GodControl, wasmInitMs: number): DebugHandle {
  const state: GodState = {
    ready: false,
    physicsBackend: 'rapier',
    fps: 0,
    propCount: 0,
    awakeCount: 0,
    hand: {
      x: 0,
      y: 0,
      z: 0,
      lift: 0,
      state: 'idle',
      hoverId: null,
      heldId: null,
    },
    camera: { yaw: 0, pitch: 0, dist: 0, tx: 0, tz: 0 },
    counters: { grabs: 0, throws: 0, impacts: 0, splashes: 0 },
    stepMs: 0,
    renderMs: 0,
    wasmInitMs,
  }

  let smoothFps = 60
  let probing = false
  let probeFrames = 0
  let probeSum = 0
  let probeMin = Infinity
  let probeUntil = 0
  let probeResolve: ((v: { avg: number; min: number; frames: number }) => void) | null = null

  const noteFrame = (dt: number, stepMs: number, renderMs: number) => {
    if (dt > 0 && dt < 1) {
      const inst = 1 / dt
      smoothFps = smoothFps + (inst - smoothFps) * Math.min(1, dt * 4)
      state.fps = smoothFps
      if (probing) {
        probeFrames += 1
        probeSum += inst
        if (inst < probeMin) probeMin = inst
        if (performance.now() >= probeUntil && probeResolve) {
          probing = false
          probeResolve({
            avg: probeSum / Math.max(1, probeFrames),
            min: probeMin === Infinity ? 0 : probeMin,
            frames: probeFrames,
          })
          probeResolve = null
        }
      }
    }
    state.stepMs = stepMs
    state.renderMs = renderMs
  }

  const fpsProbe = (ms: number): Promise<{ avg: number; min: number; frames: number }> => {
    probing = true
    probeFrames = 0
    probeSum = 0
    probeMin = Infinity
    probeUntil = performance.now() + ms
    return new Promise((resolve) => {
      probeResolve = resolve
    })
  }

  if (import.meta.env.DEV) {
    window.__godState = state
    window.__godControl = { ...control, fpsProbe }
  }

  return {
    state,
    noteFrame,
    fpsProbe,
    dispose: () => {
      if (import.meta.env.DEV) {
        delete window.__godState
        delete window.__godControl
      }
    },
  }
}

export function writeCamera(state: GodState, pose: CameraPose): void {
  state.camera.yaw = pose.yaw
  state.camera.pitch = pose.pitch
  state.camera.dist = pose.dist
  state.camera.tx = pose.tx
  state.camera.tz = pose.tz
}

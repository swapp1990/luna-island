import type { CameraPose } from './feel'
import type {
  BuildableKind,
  Good,
  WorkPriorityCategory,
  WorkPriorityLevel,
} from '../sim/types'
import type { PlaceListItem } from './places'
import type { PlayerCommandResult, TownInteractionState } from './placementController'

export interface TownAssetsState {
  loaded: number
  fallback: number
  failed: number
}

export interface ConstructionListItem {
  id: string
  kind: string
  progress: number
  stage: 'pad' | 'frame' | 'rising'
}

export interface TownState {
  ready: boolean
  day: number
  hour: number
  minute: number
  tick: number
  speed: number
  agentCount: number
  placeCount: number
  /** V5: live construction-site count. */
  constructionCount: number
  /** V2: total placed tree instances. */
  treeCount: number
  /** Perf-gate readout: renderer.info.render.calls for the last drawn frame. */
  drawCalls: number
  assets: TownAssetsState
  camera: { yaw: number; pitch: number; dist: number; tx: number; tz: number }
  fps: number
}

export interface TownControl {
  setSpeed: (n: 0 | 1 | 2 | 4) => void
  setCamera: (o: { yaw?: number; pitch?: number; dist?: number; tx?: number; tz?: number }) => void
  listPlaces: () => PlaceListItem[]
  showRefSpheres: (on: boolean) => void
  fpsProbe: (ms: number) => Promise<{ avg: number; min: number; frames: number }>
  /** Synchronously step the sim N ticks (chunked), for verifying construction/day-night without waiting real hours. Capped ~20k/call. */
  ffwd: (nTicks: number) => Promise<void>
  /** Live construction sites with their current build stage. */
  listConstruction: () => ConstructionListItem[]
  /** Debug override for the sun/sky hour-of-day; null returns to sim time. */
  setTimeOfDay: (hourFloat: number | null) => void
  /** Player-building QA bridge. Runtime UI uses the same controller. */
  beginBuild: (kind: BuildableKind) => void
  beginPath: () => void
  interactionState: () => TownInteractionState
  validateBuild: (kind: BuildableKind, x: number, y: number) => { ok: boolean; reason: string }
  validatePath: (x: number, y: number) => { ok: boolean; reason: string }
  findBuildable: (kind: BuildableKind) => { x: number; y: number } | null
  findInvalidBuild: (kind: BuildableKind) => { x: number; y: number } | null
  findPathable: () => { x: number; y: number } | null
  screenForTile: (x: number, y: number) => { x: number; y: number } | null
  screenForPlace: (placeId: string) => { x: number; y: number } | null
  screenForAgent: (agentId: string) => { x: number; y: number } | null
  issueBuild: (kind: BuildableKind, x: number, y: number) => PlayerCommandResult
  cancelConstruction: (placeId: string) => PlayerCommandResult
  demolish: (placeId: string) => PlayerCommandResult
  paintPath: (x: number, y: number, enabled?: boolean) => PlayerCommandResult
  setWorkPriority: (
    category: WorkPriorityCategory,
    level: WorkPriorityLevel,
  ) => PlayerCommandResult
  setConstructionPriority: (placeId: string, priority: 1 | 2 | 3) => PlayerCommandResult
  setStockpileFilter: (placeId: string, good: Good, enabled: boolean) => PlayerCommandResult
  upgradePlace: (placeId: string) => PlayerCommandResult
  acceptInvitation: (candidateId: string) => PlayerCommandResult
  growthSnapshot: () => {
    appeal: number
    milestone: string
    invitationCandidates: string[]
    scenarioStatus: string
  }
  socialSnapshot: () => {
    sayCount: number
    proposalCount: number
    gatheringCount: number
    mindDecisionCount: number
    mindAgentIds: string[]
    assemblyAtNoticeBoard: boolean
  }
}

declare global {
  interface Window {
    __townState?: TownState
    __townControl?: TownControl
  }
}

export interface DebugHandle {
  state: TownState
  noteFrame: (dt: number) => void
  fpsProbe: (ms: number) => Promise<{ avg: number; min: number; frames: number }>
  writeCamera: (pose: CameraPose) => void
  dispose: () => void
}

export function createDebug(control: TownControl): DebugHandle {
  const state: TownState = {
    ready: false,
    day: 1,
    hour: 6,
    minute: 0,
    tick: 0,
    speed: 1,
    agentCount: 0,
    placeCount: 0,
    constructionCount: 0,
    treeCount: 0,
    drawCalls: 0,
    assets: { loaded: 0, fallback: 0, failed: 0 },
    camera: { yaw: 0, pitch: 0, dist: 0, tx: 0, tz: 0 },
    fps: 0,
  }

  let smoothFps = 60
  let probing = false
  let probeFrames = 0
  let probeSum = 0
  let probeMin = Infinity
  let probeUntil = 0
  let probeResolve: ((v: { avg: number; min: number; frames: number }) => void) | null = null

  const noteFrame = (dt: number) => {
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

  const writeCamera = (pose: CameraPose) => {
    state.camera.yaw = pose.yaw
    state.camera.pitch = pose.pitch
    state.camera.dist = pose.dist
    state.camera.tx = pose.tx
    state.camera.tz = pose.tz
  }

  if (import.meta.env.DEV) {
    window.__townState = state
    window.__townControl = { ...control, fpsProbe }
  }

  return {
    state,
    noteFrame,
    fpsProbe,
    writeCamera,
    dispose: () => {
      if (import.meta.env.DEV) {
        delete window.__townState
        delete window.__townControl
      }
    },
  }
}

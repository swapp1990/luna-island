export type SimMode = 'live' | 'replay'

/** Mind meter on the window bridge (Phase 3 LunaBrain). */
export interface MindBridgeState {
  enabled: boolean
  agentIds: string[]
  pending: number
  decisions: number
  fallbacks: number
  meanLatencyMs: number
  approxChars: number
  /** codex | mock | off */
  provider: string
  /** Provider decide() call count (scrub must not increase). */
  decideCalls: number
}

export interface SimStateBridge {
  ready: boolean
  mode: SimMode
  day: number
  hour: number
  minute: number
  tick: number
  speed: number
  agentCount: number
  /** Ordered agent ids (additive; for E2E selection). */
  agentIds: string[]
  selectedAgentId: string | null
  /** Additive: selected place id (building panel). */
  selectedPlaceId: string | null
  /** Additive: ordered place ids (for E2E selection). */
  placeIds: string[]
  eventCount: number
  /** Number of completed days archived on the live sim. */
  archivedDayCount: number
  /** Calendar day currently scoped in the timeline (live head day when live). */
  viewDay: number
  /** Additive: counts of place kinds in the view sim (construction e2e). */
  placeCounts?: Record<string, number>
  /** Additive: last successful autosave tick, or null if never saved this session. */
  lastSavedTick: number | null
  /** Additive: world seed (new-world / layout e2e). */
  seed: number
  /** Additive: first agent layout + wallet probe for persistence e2e. */
  agent0?: { id: string; x: number; y: number; wallet: number } | null
  /** Additive: LunaBrain meter (null when never initialized). */
  mind?: MindBridgeState | null
}

export interface SimControlBridge {
  setSpeed: (n: number) => void
  pause: () => void
  scrubTo: (tick: number) => void
  goLive: () => void
  selectAgent: (id: string | null) => void
  /** Additive: select a place (building); clears agent selection. */
  selectPlace: (id: string | null) => void
  /** Load a calendar day into the scrubber (past → replay; today → scoped). */
  loadDay: (day: number) => void
  /** Synchronous batch advance of the LIVE sim (test/dev fast-step). */
  ffwd: (n: number) => void
  /** Additive: force autosave now. Resolves true on success. */
  saveNow: () => Promise<boolean>
  /** Additive: wipe autosave and start a fresh world with the given seed. */
  newWorld: (seed: number) => void
}

declare global {
  interface Window {
    __simState: SimStateBridge
    __simControl: SimControlBridge
  }
}

export function initBridge(
  getState: () => SimStateBridge,
  control: SimControlBridge,
): void {
  window.__simControl = control
  window.__simState = getState()
}

export function refreshBridge(state: SimStateBridge): void {
  window.__simState = state
}

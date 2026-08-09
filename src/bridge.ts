export type SimMode = 'live' | 'replay'

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
  eventCount: number
  /** Number of completed days archived on the live sim. */
  archivedDayCount: number
  /** Calendar day currently scoped in the timeline (live head day when live). */
  viewDay: number
}

export interface SimControlBridge {
  setSpeed: (n: number) => void
  pause: () => void
  scrubTo: (tick: number) => void
  goLive: () => void
  selectAgent: (id: string | null) => void
  /** Load a calendar day into the scrubber (past → replay; today → scoped). */
  loadDay: (day: number) => void
  /** Synchronous batch advance of the LIVE sim (test/dev fast-step). */
  ffwd: (n: number) => void
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

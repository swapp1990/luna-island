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
  selectedAgentId: string | null
  eventCount: number
}

export interface SimControlBridge {
  setSpeed: (n: number) => void
  pause: () => void
  scrubTo: (tick: number) => void
  goLive: () => void
  selectAgent: (id: string | null) => void
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

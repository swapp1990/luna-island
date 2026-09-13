export type LineageSpeed = 1 | 8 | 64
export type LineageView = 'feed' | 'card' | 'bloodlines' | 'analysis'

export interface LineageBridgeState {
  ready: boolean
  runId: string | null
  turn: number
  turnCount: number
  season: number
  day: number
  turnOfDay: 0 | 1 | 2 | 3
  speed: LineageSpeed
  playing: boolean
  alive: number
  generation: number
  view: string
  villagerId: string | null
  replayOk: boolean | null
  width: number
}

export interface LineageBridgeControl {
  play(): void
  pause(): void
  setSpeed(n: number): void
  seek(turn: number): void
  step(delta: number): void
  setView(name: string): void
  openVillager(id: string | null): void
  loadRun(id: string): void
  compare(id: string | null): void
}

const noopControl: LineageBridgeControl = {
  play() {},
  pause() {},
  setSpeed() {},
  seek() {},
  step() {},
  setView() {},
  openVillager() {},
  loadRun() {},
  compare() {},
}

declare global {
  interface Window {
    __lineage: LineageBridgeState
    __lineageControl: LineageBridgeControl
  }
}

export function emptyBridgeState(width = 0): LineageBridgeState {
  return {
    ready: false,
    runId: null,
    turn: 0,
    turnCount: 0,
    season: 0,
    day: 0,
    turnOfDay: 0,
    speed: 1,
    playing: false,
    alive: 0,
    generation: 0,
    view: 'feed',
    villagerId: null,
    replayOk: null,
    width,
  }
}

export function publishLineage(state: LineageBridgeState, control: LineageBridgeControl): void {
  window.__lineage = state
  window.__lineageControl = control
}

export function publishLineageState(state: LineageBridgeState): void {
  window.__lineage = state
}

export { noopControl }

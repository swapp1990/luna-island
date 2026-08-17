import type { Intent, WorldPreset } from './sim/types'

export type SimMode = 'live' | 'replay'

/** Mind meter on the window bridge (Phase 3 LunaBrain). */
export interface MindBridgeState {
  enabled: boolean
  agentIds: string[]
  pending: number
  /**
   * Whole mind line for auto-breathe + thinking chip: queue depth + in-flight
   * workers + rate-floor wait. Restores user speed only when fully drained.
   */
  thinking?: number
  decisions: number
  fallbacks: number
  /** Intent discarded as too old after requestTick (mind:stale). */
  stales?: number
  meanLatencyMs: number
  approxChars: number
  /** codex | mock | off */
  provider: string
  /** Actual dispatched decide requests (scrub must not increase; 429 retries don't count). */
  decideCalls: number
  /** Sidecar budget (defaults 0/60h · 0/300d when unknown). */
  budgetUsedHour?: number
  budgetMaxHour?: number
  budgetUsedDay?: number
  budgetMaxDay?: number
  /** Client cooldown after HTTP 402 — no further mind dispatches. */
  budgetCooldown?: boolean
  /** Additive: resolved soft-path cadence gap in sim ticks. */
  minGapTicks?: number
}

export interface SimStateBridge {
  ready: boolean
  mode: SimMode
  day: number
  hour: number
  minute: number
  tick: number
  /**
   * Effective sim speed (1 while auto-breathe throttles for any mind-line work).
   * Use `userSpeed` for the player's selected button highlight.
   */
  speed: number
  /** Player-selected speed / restore target after breathe (0 = paused). */
  userSpeed?: number
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
  newWorld: (seed: number, preset?: WorldPreset) => void
  /** Exact v5 save-format payload as a JSON string (no download dialog). */
  exportWorldJson: () => string
  /**
   * Qualitative extract `{ decisions, reflections, says, sanctions, proposals }`
   * with full texts/reasonings from the event trace.
   */
  exportStoryJson: () => string
  /**
   * Additive (e2e/dev): force mind budget cooldown + one mind:budget event.
   * Does not hit the sidecar.
   */
  forceMindBudgetCooldown?: (resetsInSec?: number) => void
  /**
   * Additive (e2e): pin two luna agents in socialize proximity and advance
   * until a conversation say lands (mock canned).
   */
  seedConversation?: (opts?: {
    agentIdA?: string
    agentIdB?: string
    maxTicks?: number
    partnerEating?: boolean
    minSays?: number
  }) => { ok: boolean; says: number }
  /** E2e/dev: event type histogram on the view sim. */
  countEventTypes?: () => Record<string, number>
  /**
   * Additive (e2e): post a mind intent onto the live sim and advance 1 tick
   * so it applies. Used to seed propose/vote/sanction/claim.
   */
  postIntent?: (
    agentId: string,
    intent: Intent,
    reasoning?: string,
  ) => boolean
  /** Additive (e2e): set one need 0..1 (ground-sleep / felt probes). */
  setNeeds?: (
    agentId: string,
    needs: { hunger?: number; energy?: number; social?: number },
  ) => boolean
  /** Additive (e2e): treasury → agent so civic fees can be paid. */
  ensureWallet?: (agentId: string, minCoins: number) => boolean
  /** Additive (e2e): set one sympathy edge (electorate seeding). */
  setSympathy?: (agentId: string, otherId: string, value: number) => void
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

import { ensureMindFields, Simulation, type DayArchiveMeta, type SimSnapshot } from './sim'
import type { EconomyStat, SimEvent, Tick, WorldState } from './types'

/** Current on-disk save schema version (v5 proposals+rules; v4 sayLog; v3 mindNoteLog; v2 externalIntentLog + mindStats). */
export const SAVE_FORMAT_VERSION = 5 as const

/** Oldest format we can still load (upgrades with empty mind fields as needed). */
export const SAVE_FORMAT_MIN_VERSION = 1 as const

/** Serializable world snapshot at head (reuses SimSnapshot shape without forcing full event copy at top). */
export interface SaveSnapshot {
  state: WorldState
  rngState: number
  eventSeq: number
  events: SimEvent[]
}

/**
 * Full save payload. Everything already serializes for snapshots/hash —
 * this packages head state + timeline infrastructure for round-trip restore.
 */
export interface SaveGame {
  formatVersion: typeof SAVE_FORMAT_VERSION
  seed: number
  tick: Tick
  snapshot: SaveSnapshot
  pinnedDayStartSnapshots: SaveSnapshot[]
  fineSnapshotRing: SaveSnapshot[]
  events: SimEvent[]
  dayArchives: DayArchiveMeta[]
  stats: EconomyStat[]
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveFormatError'
  }
}

/** Qualitative story extract — full texts/reasonings from the event trace. */
export interface StoryExport {
  decisions: Array<Record<string, unknown>>
  reflections: Array<Record<string, unknown>>
  says: Array<Record<string, unknown>>
  sanctions: Array<Record<string, unknown>>
  proposals: Array<Record<string, unknown>>
  /** Additive: examine / first-notice discoveries. */
  discoveries: Array<Record<string, unknown>>
}

function storyRow(e: SimEvent): Record<string, unknown> {
  return {
    seq: e.seq,
    tick: e.tick,
    type: e.type,
    agentId: e.agentId,
    reason: e.reason,
    ...(e.data ?? {}),
  }
}

/**
 * Pull the qualitative record out of the event trace for harness analysis.
 * Full decision reasonings, reflection notes, say texts, sanction/proposal copy.
 */
export function serializeStory(sim: Simulation): StoryExport {
  const decisions: StoryExport['decisions'] = []
  const reflections: StoryExport['reflections'] = []
  const says: StoryExport['says'] = []
  const sanctions: StoryExport['sanctions'] = []
  const proposals: StoryExport['proposals'] = []
  const discoveries: StoryExport['discoveries'] = []
  for (const e of sim.getEvents()) {
    if (e.type === 'mind:decision') decisions.push(storyRow(e))
    else if (e.type === 'mind:reflection') reflections.push(storyRow(e))
    else if (e.type === 'mind:say') says.push(storyRow(e))
    else if (e.type === 'institution:sanctioned') sanctions.push(storyRow(e))
    else if (e.type === 'institution:proposed') proposals.push(storyRow(e))
    else if (e.type === 'discovery:examined' || e.type === 'discovery:noticed') {
      discoveries.push(storyRow(e))
    }
  }
  return { decisions, reflections, says, sanctions, proposals, discoveries }
}

function cloneEvent(e: SimEvent): SimEvent {
  return { ...e, data: e.data ? { ...e.data } : undefined }
}

function cloneSaveSnapshot(s: SimSnapshot | SaveSnapshot): SaveSnapshot {
  // WorldState is deep-cloned via JSON path for pure serializable copy
  // (same structure as snapshot mechanism; no Date/random).
  const state = JSON.parse(JSON.stringify(s.state)) as WorldState
  ensureMindFields(state)
  return {
    state,
    rngState: s.rngState,
    eventSeq: s.eventSeq,
    events: (s.events ?? []).map(cloneEvent),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSaveSnapshot(v: unknown): v is SaveSnapshot {
  if (!isRecord(v)) return false
  if (!isRecord(v.state)) return false
  if (typeof v.rngState !== 'number') return false
  if (typeof v.eventSeq !== 'number') return false
  if (!Array.isArray(v.events)) return false
  return true
}

/**
 * Package a live Simulation into a JSON-serializable save object.
 * Pure: no Date / Math.random / DOM.
 */
export function serializeSave(sim: Simulation): SaveGame {
  const head = sim.snapshot()
  const pack = sim.exportSnapshotPack()
  const pinnedSet = new Set(pack.pinned)
  const pinnedDayStartSnapshots = pack.snaps
    .filter((s) => pinnedSet.has(s.state.tick))
    .map(cloneSaveSnapshot)
  const fineSnapshotRing = pack.snaps
    .filter((s) => !pinnedSet.has(s.state.tick))
    .map(cloneSaveSnapshot)
  const events = sim.getEvents().map(cloneEvent)
  const dayArchives = sim.archives().map((a) => ({
    day: a.day,
    startTick: a.startTick,
    endTick: a.endTick,
  }))
  const stats = sim.state.stats.map((st) => ({ ...st }))

  return {
    formatVersion: SAVE_FORMAT_VERSION,
    seed: sim.state.seed,
    tick: sim.state.tick,
    snapshot: cloneSaveSnapshot(head),
    pinnedDayStartSnapshots,
    fineSnapshotRing,
    events,
    dayArchives,
    stats,
  }
}

/**
 * Rebuild a Simulation from a save payload.
 * Accepts formatVersion 1–5 (upgrade: empty mind / institution fields as needed).
 * Rejects other versions / structural invalidity without half-loading.
 */
export function restoreSave(raw: unknown): Simulation {
  if (!isRecord(raw)) {
    throw new SaveFormatError('Save is not an object')
  }
  const ver = raw.formatVersion
  if (ver !== 1 && ver !== 2 && ver !== 3 && ver !== 4 && ver !== 5 && ver !== SAVE_FORMAT_VERSION) {
    throw new SaveFormatError(
      `Unsupported save format version: ${String(raw.formatVersion)} (expected ${SAVE_FORMAT_MIN_VERSION}–${SAVE_FORMAT_VERSION})`,
    )
  }
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) {
    throw new SaveFormatError('Save missing valid seed')
  }
  if (typeof raw.tick !== 'number' || !Number.isFinite(raw.tick)) {
    throw new SaveFormatError('Save missing valid tick')
  }
  if (!isSaveSnapshot(raw.snapshot)) {
    throw new SaveFormatError('Save missing valid snapshot')
  }
  if (!Array.isArray(raw.pinnedDayStartSnapshots)) {
    throw new SaveFormatError('Save missing pinnedDayStartSnapshots')
  }
  if (!Array.isArray(raw.fineSnapshotRing)) {
    throw new SaveFormatError('Save missing fineSnapshotRing')
  }
  if (!Array.isArray(raw.events)) {
    throw new SaveFormatError('Save missing events')
  }
  if (!Array.isArray(raw.dayArchives)) {
    throw new SaveFormatError('Save missing dayArchives')
  }

  for (const s of raw.pinnedDayStartSnapshots) {
    if (!isSaveSnapshot(s)) {
      throw new SaveFormatError('Invalid pinned day-start snapshot')
    }
  }
  for (const s of raw.fineSnapshotRing) {
    if (!isSaveSnapshot(s)) {
      throw new SaveFormatError('Invalid fine snapshot ring entry')
    }
  }

  // Prefer top-level events (full timeline); fall back to head snapshot events
  const events = (raw.events as SimEvent[]).map(cloneEvent)
  const head = cloneSaveSnapshot(raw.snapshot as SaveSnapshot)
  // v1–v4 → v5: ensure mind + institution fields (cloneSaveSnapshot already does)
  ensureMindFields(head.state)
  // Older loads: empty logs / registries when missing
  if (!Array.isArray(head.state.mindNoteLog)) head.state.mindNoteLog = []
  if (!Array.isArray(head.state.sayLog)) head.state.sayLog = []
  if (!Array.isArray(head.state.proposals)) head.state.proposals = []
  if (!Array.isArray(head.state.rules)) head.state.rules = []
  // Ensure head state tick matches declared tick when present
  if (head.state.tick !== raw.tick) {
    head.state.tick = raw.tick as number
  }
  // Stats: prefer world-state stats; allow top-level override if head empty
  if (Array.isArray(raw.stats) && raw.stats.length > 0 && head.state.stats.length === 0) {
    head.state.stats = (raw.stats as EconomyStat[]).map((st) => ({ ...st }))
  }

  const pinnedSnaps = (raw.pinnedDayStartSnapshots as SaveSnapshot[]).map(cloneSaveSnapshot)
  const fineSnaps = (raw.fineSnapshotRing as SaveSnapshot[]).map(cloneSaveSnapshot)
  for (const s of pinnedSnaps) ensureMindFields(s.state)
  for (const s of fineSnaps) ensureMindFields(s.state)
  const snaps: SimSnapshot[] = [...pinnedSnaps, ...fineSnaps]
  const pinned: Tick[] = pinnedSnaps.map((s) => s.state.tick)

  const dayArchives = (raw.dayArchives as DayArchiveMeta[]).map((a) => ({
    day: a.day,
    startTick: a.startTick,
    endTick: a.endTick,
  }))

  return Simulation.fromSaveParts({
    seed: raw.seed as number,
    head: {
      state: head.state,
      rngState: head.rngState,
      eventSeq: head.eventSeq,
      events: head.events.length > 0 ? head.events : events,
    },
    events,
    dayArchives,
    snaps,
    pinned,
  })
}

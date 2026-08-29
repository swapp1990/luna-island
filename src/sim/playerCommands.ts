import type {
  BuildableKind,
  Good,
  PlayerCommand,
  PlayerCommandRecord,
  WorkPriorityCategory,
} from './types'
import { isWorkPriorityCategory, isWorkPriorityLevel } from './workPriorities'

/** Input accepted by the public command seam. `kind` aliases make bridge/UI callers convenient. */
export type PlayerCommandInput =
  | PlayerCommand
  | ({ type: 'build'; kind: BuildableKind; x: number; y: number; rotation?: number })
  | ({ kind: 'build'; placeKind?: BuildableKind; x: number; y: number; rotation?: number })
  | ({ kind: 'place-blueprint'; blueprintId: string; x: number; y: number })
  | ({ type: 'place-blueprint'; blueprintId: string; x: number; y: number })
  | ({ kind: 'cancel-construction'; placeId: string })
  | ({ type: 'cancel'; placeId: string })
  | ({ kind: 'cancel'; placeId: string })
  | ({ kind: 'demolish'; placeId: string })
  | ({ kind: 'paint-path'; x: number; y: number; enabled?: boolean })
  | ({ kind: 'set-work-priority'; category: WorkPriorityCategory; level: number })
  | ({ kind: 'set-construction-priority'; placeId: string; priority: number })
  | ({ kind: 'set-stockpile-filter'; placeId: string; good: Good; enabled: boolean })
  | ({ kind: 'upgrade-place'; placeId: string })
  | ({ kind: 'accept-invitation'; candidateId: string })

export type PlayerCommandReason =
  | 'ok'
  | 'unknown-kind'
  | 'invalid-coordinate'
  | 'out-of-bounds'
  | 'not-walkable'
  | 'water'
  | 'rock'
  | 'slope'
  | 'collision'
  | 'site-cap'
  | 'not-found'
  | 'not-construction-site'
  | 'not-buildable'
  | 'protected'
  | 'already-set'
  | 'invalid-priority'
  | 'not-storehouse'
  | 'invalid-good'
  | 'locked'
  | 'max-level'
  | 'already-upgrading'
  | 'no-upgrade-plot'
  | 'no-invitation'
  | 'candidate-unavailable'
  | 'no-housing'
  | 'clearance'

export interface BuildPlacementValidation {
  ok: boolean
  reason: PlayerCommandReason
  reasonCode: PlayerCommandReason
  x: number
  y: number
  footprint: Array<[number, number]>
  elevationSpread: number
  requiredMaterials: { wood: number; stone: number }
  storedMaterials: { wood: number; stone: number }
  missingStoredMaterials: { wood: number; stone: number }
  /** UI-friendly warning; understocking never invalidates a designation. */
  warning?: 'missing-materials'
  blockingPlaceId?: string
  /** Present on blueprint validation: per-cell ok flags, parallel to bp.cells. */
  cellOk?: boolean[]
  blueprintId?: string
  originX?: number
  originY?: number
}

export interface PlayerCommandResult {
  ok: boolean
  reason: PlayerCommandReason
  command: PlayerCommand | null
  placeId?: string
  validation?: BuildPlacementValidation
  missingStoredMaterials?: { wood: number; stone: number }
}

/** Kept here as a stable public contract for callers importing the command module. */
export type { PlayerCommand, PlayerCommandRecord }

/** Canonical shape for the command log (used by persistence/replay code). */
export function clonePlayerCommand(command: PlayerCommand): PlayerCommand {
  if (command.type === 'build') {
    return {
      type: 'build',
      placeKind: command.placeKind,
      x: command.x,
      y: command.y,
      ...(command.rotation !== undefined ? { rotation: command.rotation } : {}),
    }
  }
  if (command.type === 'place-blueprint') {
    return {
      type: 'place-blueprint',
      blueprintId: command.blueprintId,
      x: command.x,
      y: command.y,
    }
  }
  if (command.type === 'paint-path') {
    return { type: command.type, x: command.x, y: command.y, enabled: command.enabled }
  }
  if (command.type === 'set-work-priority') {
    return { type: command.type, category: command.category, level: command.level }
  }
  if (command.type === 'set-construction-priority') {
    return { type: command.type, placeId: command.placeId, priority: command.priority }
  }
  if (command.type === 'set-stockpile-filter') {
    return {
      type: command.type,
      placeId: command.placeId,
      good: command.good,
      enabled: command.enabled,
    }
  }
  if (command.type === 'upgrade-place') {
    return { type: command.type, placeId: command.placeId }
  }
  if (command.type === 'accept-invitation') {
    return { type: command.type, candidateId: command.candidateId }
  }
  return { type: command.type, placeId: command.placeId }
}

export function clonePlayerCommandLog(
  log: PlayerCommandRecord[] | undefined,
): PlayerCommandRecord[] {
  return (log ?? []).map((record) => ({
    id: record.id,
    tick: record.tick,
    command: clonePlayerCommand(record.command),
  }))
}

/** Normalize bridge-shaped `kind` commands into the serializable `type` form. */
export function normalizePlayerCommand(input: PlayerCommandInput): PlayerCommand | null {
  const raw = input as Record<string, unknown>
  const type = raw.type ?? raw.kind
  if (type === 'build') {
    const placeKind = raw.placeKind ?? (typeof raw.kind === 'string' && raw.kind !== 'build' ? raw.kind : undefined)
    if (typeof placeKind !== 'string' || typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
    return {
      type: 'build',
      placeKind: placeKind as BuildableKind,
      x: raw.x,
      y: raw.y,
      ...(typeof raw.rotation === 'number' ? { rotation: raw.rotation } : {}),
    }
  }
  if ((type === 'cancel' || type === 'cancel-construction') && typeof raw.placeId === 'string') {
    return { type: 'cancel-construction', placeId: raw.placeId }
  }
  if (type === 'demolish' && typeof raw.placeId === 'string') {
    return { type: 'demolish', placeId: raw.placeId }
  }
  if (type === 'paint-path' && typeof raw.x === 'number' && typeof raw.y === 'number') {
    return {
      type: 'paint-path',
      x: raw.x,
      y: raw.y,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    }
  }
  if (
    type === 'set-work-priority' &&
    typeof raw.category === 'string' &&
    isWorkPriorityCategory(raw.category) &&
    typeof raw.level === 'number' &&
    isWorkPriorityLevel(raw.level)
  ) {
    return { type, category: raw.category, level: raw.level }
  }
  if (
    type === 'set-construction-priority' &&
    typeof raw.placeId === 'string' &&
    typeof raw.priority === 'number' &&
    (raw.priority === 1 || raw.priority === 2 || raw.priority === 3)
  ) {
    return { type, placeId: raw.placeId, priority: raw.priority }
  }
  if (
    type === 'set-stockpile-filter' &&
    typeof raw.placeId === 'string' &&
    (raw.good === 'food' || raw.good === 'wood' || raw.good === 'stone') &&
    typeof raw.enabled === 'boolean'
  ) {
    return { type, placeId: raw.placeId, good: raw.good, enabled: raw.enabled }
  }
  if (type === 'upgrade-place' && typeof raw.placeId === 'string') {
    return { type, placeId: raw.placeId }
  }
  if (type === 'accept-invitation' && typeof raw.candidateId === 'string') {
    return { type, candidateId: raw.candidateId }
  }
  if (
    type === 'place-blueprint' &&
    typeof raw.blueprintId === 'string' &&
    typeof raw.x === 'number' &&
    typeof raw.y === 'number'
  ) {
    return { type: 'place-blueprint', blueprintId: raw.blueprintId, x: raw.x, y: raw.y }
  }
  return null
}

/** Avoid accidentally mutating a command supplied by a UI bridge. */
export function freezePlayerCommand(command: PlayerCommand): PlayerCommand {
  return clonePlayerCommand(command)
}

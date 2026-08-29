import type {
  CellKind,
  Good,
  Inventory,
  Place,
  PlaceStructure,
  StageState,
  StructureCell,
  StructureCellState,
  WorldState,
} from './types'

export type { CellKind, StructureCell, StructureCellState, PlaceStructure, StageState } from './types'

export type StageKind = 'foundation' | 'frame' | 'wall' | 'door' | 'floor' | 'roof'

export interface StageSpec {
  kind: StageKind
  wood: number
  stone: number
  labourTicks: number
}

export type StructurePhase = 'foundation' | 'frame' | 'walls' | 'roofing' | 'done'

export interface BlueprintCell {
  kind: CellKind
  /** When true, the cell's pipeline ends with a roof stage. */
  roof: boolean
}

export interface Blueprint {
  id: string
  name: string
  width: number
  height: number
  /** Row-major, length width*height; null = outside the shape. */
  cells: Array<BlueprintCell | null>
  /** Place kind created on completion. */
  resultKind: string
}

/** Per-stage bill — the only source of blueprint material / labour costs. */
export const STAGE_COSTS: Record<StageKind, StageSpec> = {
  foundation: { kind: 'foundation', wood: 0, stone: 1, labourTicks: 8 },
  frame: { kind: 'frame', wood: 1, stone: 0, labourTicks: 10 },
  wall: { kind: 'wall', wood: 1, stone: 0, labourTicks: 12 },
  door: { kind: 'door', wood: 1, stone: 0, labourTicks: 8 },
  floor: { kind: 'floor', wood: 1, stone: 0, labourTicks: 6 },
  roof: { kind: 'roof', wood: 1, stone: 0, labourTicks: 8 },
}

/** Base pipelines (roof appended when the cell is flagged). */
export const CELL_STAGE_PIPELINES: Record<CellKind, StageKind[]> = {
  wall: ['foundation', 'frame', 'wall'],
  door: ['foundation', 'frame', 'door'],
  floor: ['floor'],
}

export const STRUCTURE_PHASE_LABEL: Record<StructurePhase, string> = {
  foundation: 'laying foundations',
  frame: 'raising the frame',
  walls: 'building walls',
  roofing: 'roofing',
  done: 'complete',
}

const CARDINAL: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const SCHOOL_ASCII = [
  'WWWDWWW',
  'W.....W',
  'W.....W',
  'W.....W',
  'WWWWWWW',
] as const

export function cellsFromAscii(rows: readonly string[]): {
  width: number
  height: number
  cells: Array<BlueprintCell | null>
} {
  const height = rows.length
  const width = height > 0 ? rows[0]!.length : 0
  const cells: Array<BlueprintCell | null> = []
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? ''
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' '
      if (ch === 'W') cells.push({ kind: 'wall', roof: false })
      else if (ch === 'D') cells.push({ kind: 'door', roof: false })
      else if (ch === '.') cells.push({ kind: 'floor', roof: false })
      else cells.push(null)
    }
  }
  return { width, height, cells }
}

const schoolShape = cellsFromAscii(SCHOOL_ASCII)

export const SCHOOL_BLUEPRINT: Blueprint = {
  id: 'school',
  name: 'School',
  width: schoolShape.width,
  height: schoolShape.height,
  cells: schoolShape.cells.map((cell) => (cell ? { ...cell, roof: true } : null)),
  resultKind: 'school',
}

export const BLUEPRINTS: Record<string, Blueprint> = {
  school: SCHOOL_BLUEPRINT,
}

export function validateBlueprint(bp: Blueprint): string[] {
  const errors: string[] = []
  if (!Number.isInteger(bp.width) || !Number.isInteger(bp.height) || bp.width < 1 || bp.height < 1) {
    errors.push('width and height must be positive integers')
  }
  if (bp.cells.length !== bp.width * bp.height) {
    errors.push('cells length does not match width*height')
  }
  let doors = 0
  const solid: number[] = []
  for (let i = 0; i < bp.cells.length; i++) {
    const cell = bp.cells[i]
    if (!cell) continue
    solid.push(i)
    if (cell.kind === 'door') doors += 1
  }
  if (doors < 1) errors.push('blueprint needs at least one door')
  if (solid.length > 0 && !orthogonallyConnected(bp, solid)) {
    errors.push('shape is not orthogonally connected')
  }
  if (!floorsReachableFromDoor(bp)) {
    errors.push('floor is not reachable from a door without crossing a wall')
  }
  return errors
}

function orthogonallyConnected(bp: Blueprint, solid: number[]): boolean {
  const want = new Set(solid)
  const start = solid[0]
  if (start === undefined) return true
  const seen = new Set<number>()
  const stack = [start]
  while (stack.length > 0) {
    const i = stack.pop()!
    if (seen.has(i)) continue
    seen.add(i)
    const x = i % bp.width
    const y = Math.floor(i / bp.width)
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= bp.width || ny >= bp.height) continue
      const ni = ny * bp.width + nx
      if (want.has(ni) && !seen.has(ni)) stack.push(ni)
    }
  }
  return seen.size === want.size
}

function floorsReachableFromDoor(bp: Blueprint): boolean {
  const floors: number[] = []
  const passable = new Set<number>()
  const doors: number[] = []
  for (let i = 0; i < bp.cells.length; i++) {
    const cell = bp.cells[i]
    if (!cell) continue
    if (cell.kind === 'floor') floors.push(i)
    if (cell.kind === 'floor' || cell.kind === 'door') passable.add(i)
    if (cell.kind === 'door') doors.push(i)
  }
  if (floors.length === 0) return true
  if (doors.length === 0) return false
  const seen = new Set<number>()
  const stack = doors.slice()
  while (stack.length > 0) {
    const i = stack.pop()!
    if (seen.has(i)) continue
    seen.add(i)
    const x = i % bp.width
    const y = Math.floor(i / bp.width)
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= bp.width || ny >= bp.height) continue
      const ni = ny * bp.width + nx
      if (passable.has(ni) && !seen.has(ni)) stack.push(ni)
    }
  }
  return floors.every((i) => seen.has(i))
}

export function cellPipeline(bp: Blueprint, index: number): StageKind[] {
  const spec = bp.cells[index]
  if (!spec) return []
  const base = CELL_STAGE_PIPELINES[spec.kind]
  return spec.roof ? [...base, 'roof'] : base.slice()
}

export function currentStageKind(bp: Blueprint, index: number, cell: StructureCell): StageKind | null {
  return cellPipeline(bp, index)[cell.stageIndex] ?? null
}

export function cellDone(bp: Blueprint, index: number, cell: StructureCell | null | undefined): boolean {
  if (!cell) return false
  const pipe = cellPipeline(bp, index)
  if (pipe.length === 0) return true
  return cell.stageIndex >= pipe.length - 1 && cell.stageState === 'built'
}

export function envelopeStageComplete(bp: Blueprint, index: number, cell: StructureCell): boolean {
  const spec = bp.cells[index]
  if (!spec || (spec.kind !== 'wall' && spec.kind !== 'door')) return true
  const pipe = cellPipeline(bp, index)
  const env = pipe.findIndex((kind) => kind === 'wall' || kind === 'door')
  if (env < 0) return true
  if (cell.stageIndex > env) return true
  return cell.stageIndex === env && cell.stageState === 'built'
}

/** True once every wall and door cell has finished its wall/door stage. */
export function roofUnlocked(structure: PlaceStructure, bp: Blueprint): boolean {
  const n = Math.min(bp.cells.length, structure.cells.length)
  for (let i = 0; i < n; i++) {
    const spec = bp.cells[i]
    if (!spec || (spec.kind !== 'wall' && spec.kind !== 'door')) continue
    const rec = structure.cells[i]
    if (!rec) return false
    if (!envelopeStageComplete(bp, i, rec)) return false
  }
  return true
}

export function derivedCellState(cell: StructureCell): StructureCellState {
  if (cell.stageState === 'built') return 'built'
  if (cell.stageIndex === 0 && cell.stageState === 'pending') return 'planned'
  return 'stocked'
}

export function blueprintBill(bp: Blueprint): { wood: number; stone: number; labourTicks: number } {
  let wood = 0
  let stone = 0
  let labourTicks = 0
  for (let i = 0; i < bp.cells.length; i++) {
    if (!bp.cells[i]) continue
    for (const stage of cellPipeline(bp, i)) {
      const cost = STAGE_COSTS[stage]
      wood += cost.wood
      stone += cost.stone
      labourTicks += cost.labourTicks
    }
  }
  return { wood, stone, labourTicks }
}

function stagedAmount(cell: StructureCell | null | undefined, good: Good): number {
  const n = cell?.staged?.[good]
  return typeof n === 'number' && n > 0 ? n : 0
}

export function unstockedStagesBill(
  bp: Blueprint,
  cells: Array<StructureCell | null>,
): { wood: number; stone: number } {
  let wood = 0
  let stone = 0
  const n = Math.min(bp.cells.length, cells.length)
  for (let i = 0; i < n; i++) {
    const rec = cells[i]
    const spec = bp.cells[i]
    if (!rec || !spec) continue
    const pipe = cellPipeline(bp, i)
    const start = rec.stageState === 'pending' ? rec.stageIndex : rec.stageIndex + 1
    for (let s = start; s < pipe.length; s++) {
      const cost = STAGE_COSTS[pipe[s]!]
      wood += cost.wood
      stone += cost.stone
      if (s === rec.stageIndex && rec.stageState === 'pending') {
        wood -= Math.min(cost.wood, stagedAmount(rec, 'wood'))
        stone -= Math.min(cost.stone, stagedAmount(rec, 'stone'))
      }
    }
  }
  return { wood, stone }
}

/** Remaining unstocked stage bill — name kept for the 7-2a call sites. */
export function plannedCellsBill(
  bp: Blueprint,
  cells: Array<StructureCell | null>,
): { wood: number; stone: number } {
  return unstockedStagesBill(bp, cells)
}

export function remainingNeedsFromBill(bill: { wood: number; stone: number }): Partial<Record<Good, number>> {
  const needs: Partial<Record<Good, number>> = {}
  if (bill.wood > 0) needs.wood = bill.wood
  if (bill.stone > 0) needs.stone = bill.stone
  return needs
}

export function makePlannedStructure(bp: Blueprint, originX: number, originY: number): PlaceStructure {
  return {
    blueprintId: bp.id,
    originX,
    originY,
    cells: bp.cells.map((cell) =>
      cell ? { stageIndex: 0, stageState: 'pending' as const, workedTicks: 0 } : null,
    ),
  }
}

export function structureCenter(bp: Blueprint, originX: number, originY: number): { x: number; y: number } {
  return {
    x: originX + Math.floor(bp.width / 2),
    y: originY + Math.floor(bp.height / 2),
  }
}

export function cellWorldTile(
  originX: number,
  originY: number,
  width: number,
  index: number,
): { x: number; y: number } {
  return {
    x: originX + (index % width),
    y: originY + Math.floor(index / width),
  }
}

export function structureCellTiles(structure: PlaceStructure, bp?: Blueprint): Array<[number, number]> {
  const width = bp?.width ?? inferWidth(structure)
  const out: Array<[number, number]> = []
  for (let i = 0; i < structure.cells.length; i++) {
    if (!structure.cells[i]) continue
    const at = cellWorldTile(structure.originX, structure.originY, width, i)
    out.push([at.x, at.y])
  }
  return out
}

function inferWidth(structure: PlaceStructure): number {
  const bp = BLUEPRINTS[structure.blueprintId]
  if (bp) return bp.width
  const n = structure.cells.length
  // Fallback: treat as a square so callers never divide by zero.
  const w = Math.max(1, Math.round(Math.sqrt(n)))
  return w
}

export function interiorFloorTiles(place: Place): Array<[number, number]> {
  const structure = place.structure
  if (!structure) return []
  const bp = BLUEPRINTS[structure.blueprintId]
  if (!bp) return []
  const out: Array<[number, number]> = []
  for (let i = 0; i < bp.cells.length; i++) {
    if (bp.cells[i]?.kind !== 'floor') continue
    if (!structure.cells[i]) continue
    const at = cellWorldTile(structure.originX, structure.originY, bp.width, i)
    out.push([at.x, at.y])
  }
  return out
}

export function clearanceTiles(bp: Blueprint, originX: number, originY: number): Array<[number, number]> {
  const occupied = new Set<string>()
  for (let i = 0; i < bp.cells.length; i++) {
    if (!bp.cells[i]) continue
    const at = cellWorldTile(originX, originY, bp.width, i)
    occupied.add(`${at.x},${at.y}`)
  }
  const ring = new Set<string>()
  const out: Array<[number, number]> = []
  for (const key of occupied) {
    const [sx, sy] = key.split(',')
    const x = Number(sx)
    const y = Number(sy)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        const nkey = `${nx},${ny}`
        if (occupied.has(nkey) || ring.has(nkey)) continue
        ring.add(nkey)
        out.push([nx, ny])
      }
    }
  }
  return out
}

export function totalStructureCells(bp: Blueprint): number {
  let n = 0
  for (const cell of bp.cells) if (cell) n += 1
  return n
}

export function countBuiltStages(
  bp: Blueprint,
  cells: Array<StructureCell | null>,
): { built: number; total: number } {
  let built = 0
  let total = 0
  const n = Math.min(bp.cells.length, cells.length)
  for (let i = 0; i < n; i++) {
    const spec = bp.cells[i]
    const rec = cells[i]
    if (!spec || !rec) continue
    const pipe = cellPipeline(bp, i)
    total += pipe.length
    if (pipe.length === 0) continue
    if (rec.stageState === 'built') built += rec.stageIndex + 1
    else built += rec.stageIndex
  }
  return { built, total }
}

export function countStructureStates(cells: Array<StructureCell | null>): {
  planned: number
  stocked: number
  built: number
  total: number
} {
  let planned = 0
  let stocked = 0
  let built = 0
  for (const cell of cells) {
    if (!cell) continue
    const state = derivedCellState(cell)
    if (state === 'planned') planned += 1
    else if (state === 'stocked') stocked += 1
    else built += 1
  }
  return { planned, stocked, built, total: planned + stocked + built }
}

export function countBuiltByKind(
  bp: Blueprint,
  cells: Array<StructureCell | null>,
): Record<CellKind, { built: number; total: number }> {
  const out: Record<CellKind, { built: number; total: number }> = {
    wall: { built: 0, total: 0 },
    door: { built: 0, total: 0 },
    floor: { built: 0, total: 0 },
  }
  const n = Math.min(bp.cells.length, cells.length)
  for (let i = 0; i < n; i++) {
    const spec = bp.cells[i]
    const rec = cells[i]
    if (!spec || !rec) continue
    out[spec.kind].total += 1
    if (cellDone(bp, i, rec)) out[spec.kind].built += 1
  }
  return out
}

export function nextStockableIndex(structure: PlaceStructure, bp: Blueprint): number {
  const unlocked = roofUnlocked(structure, bp)
  const n = Math.min(bp.cells.length, structure.cells.length)
  for (let i = 0; i < n; i++) {
    const rec = structure.cells[i]
    const spec = bp.cells[i]
    if (!rec || !spec) continue
    if (cellDone(bp, i, rec)) continue
    if (rec.stageState !== 'pending') continue
    const stage = cellPipeline(bp, i)[rec.stageIndex]
    if (!stage) continue
    if (stage === 'roof' && !unlocked) continue
    return i
  }
  return -1
}

/** Ticks without an applied work tick after which a claim is released. */
export const CLAIM_STALE_TICKS = 60

export function stageAllowsOnCell(stage: StageKind | null | undefined): boolean {
  return stage === 'foundation' || stage === 'floor'
}

export function stagedUnits(cell: StructureCell | null | undefined): Partial<Record<Good, number>> {
  const wood = stagedAmount(cell, 'wood')
  const stone = stagedAmount(cell, 'stone')
  const out: Partial<Record<Good, number>> = {}
  if (wood > 0) out.wood = wood
  if (stone > 0) out.stone = stone
  return out
}

export function cellHasStagedPile(cell: StructureCell | null | undefined): boolean {
  return stagedAmount(cell, 'wood') > 0 || stagedAmount(cell, 'stone') > 0
}

export function stageCoversCost(cell: StructureCell, cost: { wood: number; stone: number }): boolean {
  return stagedAmount(cell, 'wood') >= cost.wood && stagedAmount(cell, 'stone') >= cost.stone
}

export function cloneStaged(
  staged: Partial<Record<Good, number>> | undefined,
): Partial<Record<Good, number>> | undefined {
  if (!staged) return undefined
  const out: Partial<Record<Good, number>> = {}
  if ((staged.wood ?? 0) > 0) out.wood = staged.wood
  if ((staged.stone ?? 0) > 0) out.stone = staged.stone
  if ((staged.food ?? 0) > 0) out.food = staged.food
  return Object.keys(out).length > 0 ? out : undefined
}

export function isWorkEligibleCell(
  structure: PlaceStructure,
  bp: Blueprint,
  index: number,
): boolean {
  const rec = structure.cells[index]
  const spec = bp.cells[index]
  if (!rec || !spec) return false
  if (rec.stageState !== 'stocked') return false
  if (cellDone(bp, index, rec)) return false
  const stage = cellPipeline(bp, index)[rec.stageIndex]
  if (!stage) return false
  if (stage === 'roof' && !roofUnlocked(structure, bp)) return false
  return true
}

export function workEligibleIndices(structure: PlaceStructure, bp: Blueprint): number[] {
  const n = Math.min(bp.cells.length, structure.cells.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (isWorkEligibleCell(structure, bp, i)) out.push(i)
  }
  return out
}

export function isOrthogonalWorkStance(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  allowOnCell: boolean,
): boolean {
  if (ax === cx && ay === cy) return allowOnCell
  const dx = Math.abs(ax - cx)
  const dy = Math.abs(ay - cy)
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
}

/** Stand tiles for a cell: on-cell (floor/foundation) then cardinal neighbors. */
export function cellStandCandidates(
  originX: number,
  originY: number,
  width: number,
  index: number,
  allowOnCell: boolean,
): Array<[number, number]> {
  const at = cellWorldTile(originX, originY, width, index)
  const out: Array<[number, number]> = []
  if (allowOnCell) out.push([at.x, at.y])
  for (const [dx, dy] of CARDINAL) out.push([at.x + dx, at.y + dy])
  return out
}

export function pickNearestClaimableIndex(
  structure: PlaceStructure,
  bp: Blueprint,
  ax: number,
  ay: number,
  agentId: string,
): number {
  let best = -1
  let bestD = Infinity
  for (const i of workEligibleIndices(structure, bp)) {
    const rec = structure.cells[i]!
    if (rec.claimedBy && rec.claimedBy !== agentId) continue
    const at = cellWorldTile(structure.originX, structure.originY, bp.width, i)
    const d = chebyshev(ax, ay, at.x, at.y)
    if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && (best < 0 || i < best))) {
      bestD = d
      best = i
    }
  }
  return best
}

export function structureClaims(
  structure: PlaceStructure,
): Array<{ agentId: string; cellIndex: number }> {
  const out: Array<{ agentId: string; cellIndex: number }> = []
  for (let i = 0; i < structure.cells.length; i++) {
    const rec = structure.cells[i]
    if (rec?.claimedBy) out.push({ agentId: rec.claimedBy, cellIndex: i })
  }
  return out
}

export function countStagedPiles(cells: Array<StructureCell | null>): number {
  let n = 0
  for (const cell of cells) if (cellHasStagedPile(cell)) n += 1
  return n
}

export interface StructureCellDetail {
  index: number
  kind: CellKind | null
  stageIndex: number
  stageState: StageState
  workedTicks: number
  claimedBy?: string
  staged: Partial<Record<Good, number>>
  x: number
  y: number
}

export function listStructureCellDetail(place: Place): StructureCellDetail[] | null {
  const structure = place.structure
  if (!structure) return null
  const bp = BLUEPRINTS[structure.blueprintId]
  const out: StructureCellDetail[] = []
  for (let i = 0; i < structure.cells.length; i++) {
    const rec = structure.cells[i]
    if (!rec) continue
    const at = cellWorldTile(structure.originX, structure.originY, bp?.width ?? 1, i)
    const row: StructureCellDetail = {
      index: i,
      kind: bp?.cells[i]?.kind ?? null,
      stageIndex: rec.stageIndex,
      stageState: rec.stageState,
      workedTicks: rec.workedTicks,
      staged: stagedUnits(rec),
      x: at.x,
      y: at.y,
    }
    if (rec.claimedBy) row.claimedBy = rec.claimedBy
    out.push(row)
  }
  return out
}

export function inventoryCovers(
  inv: Inventory | undefined,
  cost: { wood: number; stone: number },
): boolean {
  return (inv?.wood ?? 0) >= cost.wood && (inv?.stone ?? 0) >= cost.stone
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

/**
 * Construction-course phase (stateless).
 *
 * Wall and door cells walk foundation → frame → wall/door → roof. The HUD course is the
 * earliest canonical step that a majority of those envelope cells have not yet completed:
 *   foundation until a majority have finished footings,
 *   frame until a majority have finished the frame,
 *   walls until every envelope cell has finished wall/door (the roof gate),
 *   roofing until every cell including floors is done.
 *
 * Completed counts only increase and a later course requires earlier ones, so the derived
 * phase cannot regress or skip. Floors are tamped earth and do not vote on frame/walls;
 * a floor-only leftover maps to foundation only when there is no envelope.
 */
function pipelineStagePassed(
  rec: StructureCell,
  pipe: StageKind[],
  kind: StageKind,
): boolean {
  const idx = pipe.indexOf(kind)
  if (idx < 0) return true
  if (rec.stageIndex > idx) return true
  return rec.stageIndex === idx && rec.stageState === 'built'
}

function envelopeIndices(bp: Blueprint, structure: PlaceStructure): number[] {
  const n = Math.min(bp.cells.length, structure.cells.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const spec = bp.cells[i]
    if (spec && (spec.kind === 'wall' || spec.kind === 'door') && structure.cells[i]) out.push(i)
  }
  return out
}

export function structurePhase(structure: PlaceStructure, bp: Blueprint): StructurePhase {
  if (structure.cells.every((cell, i) => !cell || cellDone(bp, i, cell))) return 'done'
  const envelope = envelopeIndices(bp, structure)
  if (envelope.length === 0) {
    let floorInProgress = false
    let roofInProgress = false
    const n = Math.min(bp.cells.length, structure.cells.length)
    for (let i = 0; i < n; i++) {
      const rec = structure.cells[i]
      if (!rec || cellDone(bp, i, rec)) continue
      const stage = cellPipeline(bp, i)[rec.stageIndex]
      if (stage === 'floor') floorInProgress = true
      else if (stage === 'roof') roofInProgress = true
    }
    if (floorInProgress) return 'foundation'
    if (roofInProgress) return 'roofing'
    return 'done'
  }
  const majority = Math.floor(envelope.length / 2) + 1
  let finishedFoundation = 0
  let finishedFrame = 0
  for (const i of envelope) {
    const rec = structure.cells[i]!
    const pipe = cellPipeline(bp, i)
    if (pipelineStagePassed(rec, pipe, 'foundation')) finishedFoundation += 1
    if (pipelineStagePassed(rec, pipe, 'frame')) finishedFrame += 1
  }
  if (roofUnlocked(structure, bp)) return 'roofing'
  if (finishedFoundation < majority) return 'foundation'
  if (finishedFrame < majority) return 'frame'
  return 'walls'
}

/** Collision tiles for any place — structure cells when present, else the 3×3 pad. */
export function placeOccupiedTiles(place: Place): Array<[number, number]> {
  if (place.structure) {
    const bp = BLUEPRINTS[place.structure.blueprintId]
    return structureCellTiles(place.structure, bp)
  }
  const ox = Math.round(place.x)
  const oy = Math.round(place.y)
  const tiles: Array<[number, number]> = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      tiles.push([ox + dx, oy + dy])
    }
  }
  return tiles
}

export type LegacyStructureCell = {
  stageIndex?: number
  stageState?: StageState
  workedTicks?: number
  state?: StructureCellState
  claimedBy?: string
  claimTick?: number
  staged?: Partial<Record<Good, number>>
}

function pipelineForMigration(bp: Blueprint | undefined, index: number, fallbackKind: CellKind): StageKind[] {
  if (bp && bp.cells[index]) return cellPipeline(bp, index)
  const base = CELL_STAGE_PIPELINES[fallbackKind]
  return [...base, 'roof']
}

function withClaimAndStaged(
  cell: StructureCell,
  raw: LegacyStructureCell | StructureCell,
): StructureCell {
  if (raw.claimedBy) cell.claimedBy = raw.claimedBy
  if (typeof raw.claimTick === 'number') cell.claimTick = raw.claimTick
  const staged = cloneStaged(raw.staged)
  if (staged) cell.staged = staged
  return cell
}

export function migrateStructureCell(
  raw: LegacyStructureCell | StructureCell | null | undefined,
  bp: Blueprint | undefined,
  index: number,
): StructureCell | null {
  if (!raw) return null
  const pipe = pipelineForMigration(bp, index, bp?.cells[index]?.kind ?? 'wall')
  const last = Math.max(0, pipe.length - 1)
  const lastLabour = STAGE_COSTS[pipe[last] ?? 'roof']?.labourTicks ?? 0
  if (
    typeof raw.stageIndex === 'number' &&
    (raw.stageState === 'pending' || raw.stageState === 'stocked' || raw.stageState === 'built')
  ) {
    return withClaimAndStaged(
      {
        stageIndex: raw.stageIndex,
        stageState: raw.stageState,
        workedTicks: raw.workedTicks ?? 0,
      },
      raw,
    )
  }
  const legacyState = (raw as LegacyStructureCell).state
  if (legacyState === 'built') {
    return withClaimAndStaged(
      { stageIndex: last, stageState: 'built', workedTicks: lastLabour },
      raw,
    )
  }
  if (legacyState === 'stocked') {
    return withClaimAndStaged(
      { stageIndex: 0, stageState: 'stocked', workedTicks: raw.workedTicks ?? 0 },
      raw,
    )
  }
  return withClaimAndStaged(
    { stageIndex: 0, stageState: 'pending', workedTicks: raw.workedTicks ?? 0 },
    raw,
  )
}

export function cloneStructure(structure: PlaceStructure | undefined): PlaceStructure | undefined {
  if (!structure) return undefined
  const bp = BLUEPRINTS[structure.blueprintId]
  return {
    blueprintId: structure.blueprintId,
    originX: structure.originX,
    originY: structure.originY,
    cells: structure.cells.map((cell, i) => migrateStructureCell(cell, bp, i)),
  }
}

function isLegacyCell(cell: StructureCell | null): boolean {
  if (!cell) return false
  const raw = cell as unknown as { state?: string; stageState?: string }
  return raw.stageState === undefined && typeof raw.state === 'string'
}

export function migrateWorldStructures(state: Pick<WorldState, 'places'>): void {
  for (const place of state.places) {
    if (!place.structure) continue
    if (!place.structure.cells.some(isLegacyCell)) continue
    const migrated = cloneStructure(place.structure)
    if (migrated) place.structure = migrated
  }
}

export function summarizeStructure(place: Place): {
  placeId: string
  blueprintId: string
  state: 'building' | 'built'
  cells: { planned: number; stocked: number; built: number; total: number }
  remaining: Partial<Record<'wood' | 'stone', number>>
  stages: { built: number; total: number }
  phase: StructurePhase
  claims: Array<{ agentId: string; cellIndex: number }>
  piles: number
} | null {
  const structure = place.structure
  if (!structure) return null
  const bp = BLUEPRINTS[structure.blueprintId]
  const counts = countStructureStates(structure.cells)
  const remaining: Partial<Record<'wood' | 'stone', number>> = {}
  const wood = place.construction?.needs.wood ?? 0
  const stone = place.construction?.needs.stone ?? 0
  if (wood > 0) remaining.wood = wood
  if (stone > 0) remaining.stone = stone
  const stages = bp
    ? countBuiltStages(bp, structure.cells)
    : { built: counts.built, total: counts.total }
  const phase = bp
    ? structurePhase(structure, bp)
    : counts.built === counts.total && counts.total > 0
      ? 'done'
      : 'foundation'
  return {
    placeId: place.id,
    blueprintId: structure.blueprintId,
    state: place.kind === 'construction-site' ? 'building' : 'built',
    cells: counts,
    remaining,
    stages,
    phase,
    claims: structureClaims(structure),
    piles: countStagedPiles(structure.cells),
  }
}

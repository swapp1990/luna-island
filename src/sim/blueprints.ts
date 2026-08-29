import type {
  CellKind,
  Good,
  Inventory,
  Place,
  PlaceStructure,
  StructureCell,
} from './types'

export type { CellKind, StructureCell, StructureCellState, PlaceStructure } from './types'

export interface BlueprintCell {
  kind: CellKind
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

/** Per-cell bill — the only source of blueprint material / labour costs. */
export const CELL_COSTS: Record<CellKind, { wood: number; stone: number; labourTicks: number }> = {
  wall: { wood: 1, stone: 1, labourTicks: 30 },
  door: { wood: 2, stone: 0, labourTicks: 20 },
  floor: { wood: 1, stone: 0, labourTicks: 10 },
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
      if (ch === 'W') cells.push({ kind: 'wall' })
      else if (ch === 'D') cells.push({ kind: 'door' })
      else if (ch === '.') cells.push({ kind: 'floor' })
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
  cells: schoolShape.cells,
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

export function blueprintBill(bp: Blueprint): { wood: number; stone: number; labourTicks: number } {
  let wood = 0
  let stone = 0
  let labourTicks = 0
  for (const cell of bp.cells) {
    if (!cell) continue
    const cost = CELL_COSTS[cell.kind]
    wood += cost.wood
    stone += cost.stone
    labourTicks += cost.labourTicks
  }
  return { wood, stone, labourTicks }
}

export function plannedCellsBill(
  bp: Blueprint,
  cells: Array<StructureCell | null>,
): { wood: number; stone: number } {
  let wood = 0
  let stone = 0
  const n = Math.min(bp.cells.length, cells.length)
  for (let i = 0; i < n; i++) {
    const rec = cells[i]
    const spec = bp.cells[i]
    if (!rec || !spec || rec.state !== 'planned') continue
    const cost = CELL_COSTS[spec.kind]
    wood += cost.wood
    stone += cost.stone
  }
  return { wood, stone }
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
    cells: bp.cells.map((cell) => (cell ? { state: 'planned', workedTicks: 0 } : null)),
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
    if (cell.state === 'planned') planned += 1
    else if (cell.state === 'stocked') stocked += 1
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
    if (rec.state === 'built') out[spec.kind].built += 1
  }
  return out
}

export function nextPlannedIndex(cells: Array<StructureCell | null>): number {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]?.state === 'planned') return i
  }
  return -1
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

export function cloneStructure(structure: PlaceStructure | undefined): PlaceStructure | undefined {
  if (!structure) return undefined
  return {
    blueprintId: structure.blueprintId,
    originX: structure.originX,
    originY: structure.originY,
    cells: structure.cells.map((cell) =>
      cell ? { state: cell.state, workedTicks: cell.workedTicks } : null,
    ),
  }
}

export function summarizeStructure(place: Place): {
  placeId: string
  blueprintId: string
  state: 'building' | 'built'
  cells: { planned: number; stocked: number; built: number; total: number }
  remaining: Partial<Record<'wood' | 'stone', number>>
} | null {
  const structure = place.structure
  if (!structure) return null
  const counts = countStructureStates(structure.cells)
  const remaining: Partial<Record<'wood' | 'stone', number>> = {}
  const wood = place.construction?.needs.wood ?? 0
  const stone = place.construction?.needs.stone ?? 0
  if (wood > 0) remaining.wood = wood
  if (stone > 0) remaining.stone = stone
  return {
    placeId: place.id,
    blueprintId: structure.blueprintId,
    state: place.kind === 'construction-site' ? 'building' : 'built',
    cells: counts,
    remaining,
  }
}


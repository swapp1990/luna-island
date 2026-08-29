/**
 * Per-cell greybox for blueprint sites and finished schools.
 * Keyed on stage + worked fraction; previous stages stay visible.
 */
import * as THREE from 'three'
import {
  BLUEPRINTS,
  STAGE_COSTS,
  cellDone,
  cellHasStagedPile,
  cellPipeline,
  cellWorldTile,
  currentStageKind,
  derivedCellState,
  stagedUnits,
} from '../sim/blueprints'
import type { CellKind, Place, PlaceStructure, StructureCell } from '../sim/types'
import { TILE_METRES } from './constants'

const PLANNED = 0x9a9a9a
const OUTLINE = 0xb0b0b0
const FOUNDATION = 0x8c8578
const FRAME = 0x6e5b44
const WALL_FILL = 0x8a8a8a
const DOOR = 0x7a7a7a
const FLOOR = 0x9b9b9b
const ROOF = 0xb07a4a
const PILE_WOOD = 0x6b5340
const PILE_STONE = 0x8a8580

const FRAME_H = 3
const FOUNDATION_H = 0.3
const ROOF_Y = 3
const ROOF_THICK = 0.16

function addBox(
  g: THREE.Group,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d)
  geos.push(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.castShadow = h > 0.4
  mesh.receiveShadow = true
  g.add(mesh)
  return mesh
}

function cellLocal(
  structure: PlaceStructure,
  width: number,
  index: number,
  placeX: number,
  placeY: number,
): { x: number; z: number } {
  const at = cellWorldTile(structure.originX, structure.originY, width, index)
  return {
    x: (at.x - placeX) * TILE_METRES,
    z: (at.y - placeY) * TILE_METRES,
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function stageFraction(rec: StructureCell, stageIndex: number, labour: number): number {
  if (rec.stageIndex > stageIndex) return 1
  if (rec.stageIndex < stageIndex) return 0
  if (rec.stageState === 'built') return 1
  if (rec.stageState === 'pending') return 0
  if (labour <= 0) return 0
  return clamp01(rec.workedTicks / labour)
}

function fracBucket(frac: number): number {
  return Math.floor(frac * 20 + 1e-9)
}

/**
 * Signature of cell stages + 5% fraction buckets — places.ts rebuilds only when this changes.
 */
export function structureVisualSignature(place: Place): string {
  const s = place.structure
  if (!s) return ''
  const bp = BLUEPRINTS[s.blueprintId]
  const parts: string[] = [place.kind, s.blueprintId]
  for (let i = 0; i < s.cells.length; i++) {
    const cell = s.cells[i]
    if (!cell) {
      parts.push('_')
      continue
    }
    const stage = bp ? currentStageKind(bp, i, cell) : null
    const labour = stage ? STAGE_COSTS[stage].labourTicks : 1
    const frac = cell.stageState === 'stocked' ? fracBucket(stageFraction(cell, cell.stageIndex, labour)) : 0
    const pile = stagedUnits(cell)
    const showPile =
      (pile.wood ?? 0) > 0 ||
      (pile.stone ?? 0) > 0 ||
      (cell.stageState === 'stocked' && !(bp && cellDone(bp, i, cell)))
        ? 1
        : 0
    parts.push(`${cell.stageIndex}${cell.stageState[0]}${frac}p${showPile}w${pile.wood ?? 0}s${pile.stone ?? 0}`)
  }
  return parts.join(':')
}

function drawFrame(
  group: THREE.Group,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  loc: { x: number; z: number },
  span: number,
  height: number,
): void {
  if (height < 0.04) return
  const postW = 0.16
  const inset = span / 2 - postW / 2
  const y = height / 2
  addBox(group, geos, mat, postW, height, postW, loc.x - inset, y, loc.z - inset)
  addBox(group, geos, mat, postW, height, postW, loc.x + inset, y, loc.z - inset)
  addBox(group, geos, mat, postW, height, postW, loc.x - inset, y, loc.z + inset)
  addBox(group, geos, mat, postW, height, postW, loc.x + inset, y, loc.z + inset)
  const beamY = Math.max(height - 0.08, height * 0.92)
  const beamH = 0.12
  addBox(group, geos, mat, span - postW, beamH, postW, loc.x, beamY, loc.z - inset)
  addBox(group, geos, mat, span - postW, beamH, postW, loc.x, beamY, loc.z + inset)
  addBox(group, geos, mat, postW, beamH, span - postW, loc.x - inset, beamY, loc.z)
  addBox(group, geos, mat, postW, beamH, span - postW, loc.x + inset, beamY, loc.z)
}

export function buildStructureVisuals(
  place: Place,
  geosOwned: THREE.BufferGeometry[],
  matsOwned: THREE.Material[],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'structure-cells'
  const structure = place.structure
  if (!structure) return group
  const bp = BLUEPRINTS[structure.blueprintId]
  const width = bp?.width ?? Math.max(1, Math.round(Math.sqrt(structure.cells.length)))

  const plannedMat = new THREE.MeshStandardMaterial({
    color: PLANNED,
    roughness: 0.95,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
  const outlineMat = new THREE.LineBasicMaterial({
    color: OUTLINE,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  })
  const foundationMat = new THREE.MeshStandardMaterial({ color: FOUNDATION, roughness: 0.94 })
  const frameMat = new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.88 })
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL_FILL, roughness: 0.82 })
  const doorMat = new THREE.MeshStandardMaterial({ color: DOOR, roughness: 0.8 })
  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR,
    roughness: 0.9,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  })
  const roofMat = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.78 })
  const pileWoodMat = new THREE.MeshStandardMaterial({ color: PILE_WOOD, roughness: 0.9 })
  const pileStoneMat = new THREE.MeshStandardMaterial({ color: PILE_STONE, roughness: 0.94 })
  matsOwned.push(
    plannedMat,
    outlineMat,
    foundationMat,
    frameMat,
    wallMat,
    doorMat,
    floorMat,
    roofMat,
    pileWoodMat,
    pileStoneMat,
  )

  const span = TILE_METRES * 0.92
  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(span, 0.04, span))
  geosOwned.push(outlineGeo)

  for (let i = 0; i < structure.cells.length; i++) {
    const rec = structure.cells[i]
    const specKind: CellKind | null = bp?.cells[i]?.kind ?? (rec ? 'floor' : null)
    if (!rec || !specKind) continue
    const loc = cellLocal(structure, width, i, place.x, place.y)
    const pipe = bp ? cellPipeline(bp, i) : []
    let drew = false

    if (derivedCellState(rec) === 'planned' || pipe.length === 0) {
      addBox(group, geosOwned, plannedMat, span, 0.04, span, loc.x, 0.03, loc.z)
      const outline = new THREE.LineSegments(outlineGeo, outlineMat)
      outline.position.set(loc.x, 0.05, loc.z)
      group.add(outline)
      drew = true
      if (pipe.length === 0) continue
    }

    for (let s = 0; s < pipe.length; s++) {
      const stage = pipe[s]!
      const frac = stageFraction(rec, s, STAGE_COSTS[stage].labourTicks)
      if (frac <= 0.001) continue
      drew = true

      if (stage === 'foundation') {
        const h = FOUNDATION_H * frac
        addBox(group, geosOwned, foundationMat, span, h, span, loc.x, h / 2, loc.z)
        continue
      }

      if (stage === 'frame') {
        drawFrame(group, geosOwned, frameMat, loc, span, FRAME_H * frac)
        continue
      }

      if (stage === 'wall') {
        const h = FRAME_H * frac
        const inset = span - 0.36
        addBox(group, geosOwned, wallMat, inset, h, inset, loc.x, h / 2, loc.z)
        continue
      }

      if (stage === 'door') {
        if (frac >= 1) {
          addBox(group, geosOwned, doorMat, 0.7, 1.5, 0.1, loc.x, 0.75, loc.z)
        }
        continue
      }

      if (stage === 'floor') {
        const mat = floorMat.clone()
        mat.opacity = 0.2 + 0.8 * frac
        mat.transparent = frac < 1
        matsOwned.push(mat)
        addBox(group, geosOwned, mat, span, 0.1, span, loc.x, 0.06, loc.z)
        continue
      }

      if (stage === 'roof') {
        const thick = ROOF_THICK * Math.max(0.25, frac)
        addBox(group, geosOwned, roofMat, span, thick, span, loc.x, ROOF_Y + thick / 2, loc.z)
      }
    }

    if (!drew) {
      addBox(group, geosOwned, plannedMat, span, 0.04, span, loc.x, 0.03, loc.z)
    }

    const pile = stagedUnits(rec)
    const showPile =
      cellHasStagedPile(rec) ||
      (rec.stageState === 'stocked' && !(bp && cellDone(bp, i, rec)))
    if (showPile) {
      const stage = bp ? currentStageKind(bp, i, rec) : null
      const cost = stage ? STAGE_COSTS[stage] : { wood: 0, stone: 0 }
      const woodN = Math.max(pile.wood ?? 0, rec.stageState === 'stocked' ? cost.wood : 0)
      const stoneN = Math.max(pile.stone ?? 0, rec.stageState === 'stocked' ? cost.stone : 0)
      const ox = loc.x + span * 0.28
      const oz = loc.z + span * 0.28
      for (let n = 0; n < Math.min(3, Math.max(1, woodN)); n++) {
        const geo = new THREE.CylinderGeometry(0.07, 0.08, 0.55, 6)
        geosOwned.push(geo)
        const mesh = new THREE.Mesh(geo, pileWoodMat)
        mesh.rotation.z = Math.PI / 2
        mesh.rotation.y = n * 0.35
        mesh.position.set(ox, 0.1 + n * 0.09, oz - n * 0.08)
        mesh.castShadow = true
        group.add(mesh)
      }
      for (let n = 0; n < Math.min(3, Math.max(0, stoneN)); n++) {
        addBox(
          group,
          geosOwned,
          pileStoneMat,
          0.18 + n * 0.04,
          0.12,
          0.16,
          ox - 0.22,
          0.08 + n * 0.07,
          oz + 0.16 - n * 0.1,
        )
      }
    }
  }

  return group
}

/**
 * Per-cell greybox for blueprint sites and finished schools.
 * Replaces pad/frame/rising staging for structure places only.
 */
import * as THREE from 'three'
import { BLUEPRINTS, cellWorldTile } from '../sim/blueprints'
import type { CellKind, Place, PlaceStructure } from '../sim/types'
import { TILE_METRES } from './constants'

const PLANNED = 0x9a9a9a
const STOCKED_WOOD = 0x6e5b44
const STOCKED_STONE = 0x8c8578
const BUILT_WALL = 0x8a8a8a
const BUILT_DOOR = 0x7a7a7a
const BUILT_FLOOR = 0x9b9b9b
const OUTLINE = 0xb0b0b0

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

/**
 * Signature of cell states — places.ts rebuilds only when this changes.
 */
export function structureVisualSignature(place: Place): string {
  const s = place.structure
  if (!s) return ''
  const parts: string[] = [place.kind, s.blueprintId]
  for (const cell of s.cells) {
    parts.push(cell ? cell.state[0]! : '_')
  }
  return parts.join(':')
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
  const pileWood = new THREE.MeshStandardMaterial({ color: STOCKED_WOOD, roughness: 0.88 })
  const pileStone = new THREE.MeshStandardMaterial({ color: STOCKED_STONE, roughness: 0.94 })
  const wallMat = new THREE.MeshStandardMaterial({ color: BUILT_WALL, roughness: 0.82 })
  const doorMat = new THREE.MeshStandardMaterial({ color: BUILT_DOOR, roughness: 0.8 })
  const floorMat = new THREE.MeshStandardMaterial({ color: BUILT_FLOOR, roughness: 0.9 })
  matsOwned.push(plannedMat, outlineMat, pileWood, pileStone, wallMat, doorMat, floorMat)

  const span = TILE_METRES * 0.92
  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(span, 0.04, span))
  geosOwned.push(outlineGeo)

  for (let i = 0; i < structure.cells.length; i++) {
    const rec = structure.cells[i]
    const specKind: CellKind | null = bp?.cells[i]?.kind ?? (rec ? 'floor' : null)
    if (!rec || !specKind) continue
    const loc = cellLocal(structure, width, i, place.x, place.y)

    if (rec.state === 'planned') {
      addBox(group, geosOwned, plannedMat, span, 0.04, span, loc.x, 0.03, loc.z)
      const outline = new THREE.LineSegments(outlineGeo, outlineMat)
      outline.position.set(loc.x, 0.05, loc.z)
      group.add(outline)
      continue
    }

    if (rec.state === 'stocked') {
      addBox(group, geosOwned, plannedMat, span, 0.03, span, loc.x, 0.02, loc.z)
      addBox(group, geosOwned, pileWood, 0.7, 0.32, 0.45, loc.x - 0.25, 0.18, loc.z)
      if (specKind === 'wall') {
        addBox(group, geosOwned, pileStone, 0.45, 0.28, 0.4, loc.x + 0.28, 0.16, loc.z + 0.1)
      }
      continue
    }

    if (specKind === 'floor') {
      addBox(group, geosOwned, floorMat, span, 0.12, span, loc.x, 0.07, loc.z)
      continue
    }

    if (specKind === 'door') {
      const postW = 0.28
      const gap = 1.15
      addBox(group, geosOwned, doorMat, postW, 2.2, span, loc.x - gap / 2, 1.1, loc.z)
      addBox(group, geosOwned, doorMat, postW, 2.2, span, loc.x + gap / 2, 1.1, loc.z)
      addBox(group, geosOwned, doorMat, gap + postW, 0.28, span, loc.x, 2.28, loc.z)
      addBox(group, geosOwned, floorMat, span, 0.1, span, loc.x, 0.06, loc.z)
      continue
    }

    addBox(group, geosOwned, wallMat, span, 3, span, loc.x, 1.5, loc.z)
  }

  return group
}

import * as THREE from 'three'
import type { CellKind } from '../sim/types'
import { TILE_METRES } from './constants'

export type PlacementGhostTone = 'valid' | 'warning' | 'invalid'
export type PlacementGhostMode = 'building' | 'path' | 'blueprint'

export interface BlueprintGhostCell {
  wx: number
  wy: number
  wz: number
  kind: CellKind
  tone: PlacementGhostTone
}

export interface PlacementGhostHandle {
  root: THREE.Group
  show: (
    worldX: number,
    worldY: number,
    worldZ: number,
    tone: PlacementGhostTone,
    mode?: PlacementGhostMode,
    blueprintCells?: BlueprintGhostCell[],
  ) => void
  hide: () => void
  dispose: () => void
}

const COLORS: Record<PlacementGhostTone, number> = {
  valid: 0x69d77b,
  warning: 0xf2b84b,
  invalid: 0xe65d57,
}

const KIND_HEIGHT: Record<CellKind, number> = {
  wall: 1.15,
  door: 0.7,
  floor: 0.08,
}

/**
 * Lightweight construction preview. Building/path modes keep the original 3×3
 * pad; blueprint mode draws one distinguishable tile per cell.
 */
export function createPlacementGhost(scene: THREE.Scene): PlacementGhostHandle {
  const root = new THREE.Group()
  root.name = 'placement-ghost'
  root.visible = false

  const footprint = TILE_METRES * 3
  const padGeo = new THREE.PlaneGeometry(footprint, footprint)
  padGeo.rotateX(-Math.PI / 2)
  const padMat = new THREE.MeshBasicMaterial({
    color: COLORS.valid,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const pad = new THREE.Mesh(padGeo, padMat)
  pad.position.y = 0.035
  root.add(pad)

  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(footprint, 0.18, footprint))
  const outlineMat = new THREE.LineBasicMaterial({
    color: COLORS.valid,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  })
  const outline = new THREE.LineSegments(outlineGeo, outlineMat)
  outline.position.y = 0.1
  root.add(outline)

  const frameMat = new THREE.MeshBasicMaterial({
    color: COLORS.valid,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
  })
  const postGeo = new THREE.BoxGeometry(0.22, 2.6, 0.22)
  const beamXGeo = new THREE.BoxGeometry(footprint * 0.82, 0.18, 0.18)
  const beamZGeo = new THREE.BoxGeometry(0.18, 0.18, footprint * 0.82)
  const frameParts: THREE.Mesh[] = []
  const inset = footprint * 0.41
  for (const [x, z] of [
    [-inset, -inset],
    [inset, -inset],
    [-inset, inset],
    [inset, inset],
  ] as const) {
    const post = new THREE.Mesh(postGeo, frameMat)
    post.position.set(x, 1.3, z)
    frameParts.push(post)
    root.add(post)
  }
  for (const z of [-inset, inset]) {
    const beam = new THREE.Mesh(beamXGeo, frameMat)
    beam.position.set(0, 2.52, z)
    frameParts.push(beam)
    root.add(beam)
  }
  for (const x of [-inset, inset]) {
    const beam = new THREE.Mesh(beamZGeo, frameMat)
    beam.position.set(x, 2.52, 0)
    frameParts.push(beam)
    root.add(beam)
  }

  const cellRoot = new THREE.Group()
  cellRoot.name = 'blueprint-cells'
  cellRoot.visible = false
  root.add(cellRoot)

  const cellGeo = new THREE.BoxGeometry(TILE_METRES * 0.92, 1, TILE_METRES * 0.92)
  const cellPool: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = []
  const makeCell = () => {
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS.valid,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(cellGeo, mat)
    mesh.visible = false
    cellRoot.add(mesh)
    const entry = { mesh, mat }
    cellPool.push(entry)
    return entry
  }
  for (let i = 0; i < 40; i++) makeCell()

  const setBuildingVisible = (on: boolean) => {
    pad.visible = on
    outline.visible = on
    for (const part of frameParts) part.visible = on
  }

  scene.add(root)

  return {
    root,
    show: (worldX, worldY, worldZ, tone, mode = 'building', blueprintCells) => {
      const color = COLORS[tone]
      padMat.color.setHex(color)
      outlineMat.color.setHex(color)
      frameMat.color.setHex(color)
      if (mode === 'blueprint' && blueprintCells && blueprintCells.length > 0) {
        setBuildingVisible(false)
        cellRoot.visible = true
        while (cellPool.length < blueprintCells.length) makeCell()
        for (let i = 0; i < cellPool.length; i++) {
          const entry = cellPool[i]!
          const cell = blueprintCells[i]
          if (!cell) {
            entry.mesh.visible = false
            continue
          }
          const h = KIND_HEIGHT[cell.kind]
          entry.mat.color.setHex(COLORS[cell.tone])
          entry.mat.opacity = cell.kind === 'floor' ? 0.32 : 0.5
          entry.mesh.position.set(cell.wx - worldX, h / 2, cell.wz - worldZ)
          entry.mesh.scale.set(1, h, 1)
          entry.mesh.visible = true
        }
        root.scale.set(1, 1, 1)
        root.position.set(worldX, worldY, worldZ)
        root.visible = true
        return
      }
      cellRoot.visible = false
      for (const entry of cellPool) entry.mesh.visible = false
      setBuildingVisible(true)
      const footprintScale = mode === 'path' ? 1 / 3 : 1
      root.scale.set(footprintScale, 1, footprintScale)
      for (const part of frameParts) part.visible = mode === 'building'
      root.position.set(worldX, worldY, worldZ)
      root.visible = true
    },
    hide: () => {
      root.visible = false
    },
    dispose: () => {
      scene.remove(root)
      padGeo.dispose()
      outlineGeo.dispose()
      postGeo.dispose()
      beamXGeo.dispose()
      beamZGeo.dispose()
      cellGeo.dispose()
      padMat.dispose()
      outlineMat.dispose()
      frameMat.dispose()
      for (const entry of cellPool) entry.mat.dispose()
    },
  }
}

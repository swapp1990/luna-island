import * as THREE from 'three'
import { TILE_METRES } from './constants'

export type PlacementGhostTone = 'valid' | 'warning' | 'invalid'
export type PlacementGhostMode = 'building' | 'path'

export interface PlacementGhostHandle {
  root: THREE.Group
  show: (
    worldX: number,
    worldY: number,
    worldZ: number,
    tone: PlacementGhostTone,
    mode?: PlacementGhostMode,
  ) => void
  hide: () => void
  dispose: () => void
}

const COLORS: Record<PlacementGhostTone, number> = {
  valid: 0x69d77b,
  warning: 0xf2b84b,
  invalid: 0xe65d57,
}

/**
 * Lightweight 3x3-tile construction preview. It deliberately uses procedural
 * geometry so hovering never waits for a glTF load and the ghost exactly
 * matches the simulation's construction-pad footprint.
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

  scene.add(root)

  return {
    root,
    show: (worldX, worldY, worldZ, tone, mode = 'building') => {
      const color = COLORS[tone]
      padMat.color.setHex(color)
      outlineMat.color.setHex(color)
      frameMat.color.setHex(color)
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
      padMat.dispose()
      outlineMat.dispose()
      frameMat.dispose()
    },
  }
}

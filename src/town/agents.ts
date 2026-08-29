import * as THREE from 'three'
import {
  BLUEPRINTS,
  cellPipeline,
  cellWorldTile,
  isOrthogonalWorkStance,
  stageAllowsOnCell,
} from '../sim/blueprints'
import type { AgentState, WorldState } from '../sim/types'
import { tileToWorld } from './coords'
import { clamp } from './feel'

const CAPSULE_R = 0.28
const CAPSULE_LEN = 1.1
const CAPSULE_Y = CAPSULE_LEN / 2 + CAPSULE_R

export interface AgentsHandle {
  root: THREE.Group
  /** Render object used by resident hover, selection, and world overlays. */
  objectFor: (agentId: string) => THREE.Object3D | null
  update: (
    agents: readonly AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    width: number,
    height: number,
  ) => void
  dispose: () => void
}

export function capturePositions(agents: readonly AgentState[]): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>()
  for (const a of agents) m.set(a.id, { x: a.x, y: a.y })
  return m
}

function claimedBuildTarget(
  world: WorldState | undefined,
  agent: AgentState,
): { x: number; y: number } | null {
  if (!world) return null
  if (agent.action.kind !== 'work') return null
  if (agent.workPhase === 'hauling' || agent.workPhase === 'returning') return null
  const path = agent.action.path
  if (path && agent.pathIndex < path.length) return null
  for (const place of world.places) {
    const structure = place.structure
    if (!structure) continue
    const bp = BLUEPRINTS[structure.blueprintId]
    if (!bp) continue
    for (let i = 0; i < structure.cells.length; i++) {
      const rec = structure.cells[i]
      if (!rec || rec.claimedBy !== agent.id) continue
      const stage = cellPipeline(bp, i)[rec.stageIndex]
      const at = cellWorldTile(structure.originX, structure.originY, bp.width, i)
      if (
        !isOrthogonalWorkStance(
          Math.round(agent.x),
          Math.round(agent.y),
          at.x,
          at.y,
          stageAllowsOnCell(stage),
        )
      ) {
        return null
      }
      return at
    }
  }
  return null
}

function buildHammer(): THREE.Group {
  const g = new THREE.Group()
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.55, metalness: 0.3 })
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.42, 6), stickMat)
  stick.position.y = 0.18
  g.add(stick)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), headMat)
  head.position.set(0, 0.38, 0)
  g.add(head)
  g.position.set(0.34, 0.55, 0.1)
  g.visible = false
  return g
}

export function createAgents(
  scene: THREE.Scene,
  agents: readonly AgentState[],
  getWorld?: () => WorldState,
): AgentsHandle {
  const root = new THREE.Group()
  root.name = 'residents'
  const geo = new THREE.CapsuleGeometry(CAPSULE_R, CAPSULE_LEN, 4, 8)
  const meshes = new Map<string, THREE.Mesh>()
  const hammers = new Map<string, THREE.Group>()
  const mats = new Map<string, THREE.MeshStandardMaterial>()
  const markers = new Map<string, THREE.Sprite>()
  const markerTextures = new Map<string, THREE.CanvasTexture>()
  const markerMaterials = new Map<string, THREE.SpriteMaterial>()

  const markerKey = (agent: AgentState): string | null => {
    if (agent.collapsed || agent.needs.hunger < 0.22) return 'critical'
    if (agent.needs.energy < 0.2) return 'sleep'
    if (agent.action.kind === 'socialize') return 'talk'
    if (agent.workPhase === 'hauling' || Object.values(agent.inventory).some((amount) => amount > 0)) return 'carry'
    if (agent.employedAt === null && (agent.action.kind === 'idle' || agent.action.kind === 'wander')) return 'idle'
    return null
  }

  const markerStyle = (key: string): { text: string; fill: string } => {
    if (key === 'critical') return { text: '!', fill: '#b94135' }
    if (key === 'sleep') return { text: 'Z', fill: '#536f9d' }
    if (key === 'talk') return { text: '…', fill: '#6b4f8d' }
    if (key === 'carry') return { text: '◆', fill: '#8a6733' }
    return { text: '?', fill: '#9a7432' }
  }

  const materialForMarker = (key: string): THREE.SpriteMaterial => {
    const cached = markerMaterials.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext('2d')!
    const style = markerStyle(key)
    ctx.beginPath()
    ctx.arc(48, 48, 35, 0, Math.PI * 2)
    ctx.fillStyle = style.fill
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#f5e4bd'
    ctx.stroke()
    ctx.fillStyle = '#fff9e9'
    ctx.font = 'bold 48px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(style.text, 48, key === 'talk' ? 39 : 49)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    markerTextures.set(key, texture)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    markerMaterials.set(key, material)
    return material
  }

  const updateMarker = (agent: AgentState, mesh: THREE.Mesh): void => {
    const key = markerKey(agent)
    let sprite = markers.get(agent.id)
    if (!key) {
      if (sprite) sprite.visible = false
      return
    }
    if (!sprite) {
      sprite = new THREE.Sprite(materialForMarker(key))
      sprite.scale.set(0.86, 0.86, 0.86)
      sprite.position.set(0, 1.62, 0)
      sprite.renderOrder = 120
      sprite.userData.agentId = agent.id
      markers.set(agent.id, sprite)
      mesh.add(sprite)
    } else if (sprite.userData.markerKey !== key) {
      sprite.material = materialForMarker(key)
    }
    sprite.userData.markerKey = key
    sprite.visible = true
  }

  const addAgent = (a: AgentState): THREE.Mesh => {
    const mat = new THREE.MeshStandardMaterial({
      color: a.color,
      emissive: new THREE.Color(a.color).multiplyScalar(0.16),
      emissiveIntensity: 0.55,
      roughness: 0.62,
      metalness: 0,
    })
    mats.set(a.id, mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.y = CAPSULE_Y
    mesh.userData.agentId = a.id
    const hammer = buildHammer()
    mesh.add(hammer)
    hammers.set(a.id, hammer)
    meshes.set(a.id, mesh)
    root.add(mesh)
    updateMarker(a, mesh)
    return mesh
  }

  for (const a of agents) {
    addAgent(a)
  }

  scene.add(root)

  const place = (mesh: THREE.Mesh, tx: number, ty: number, width: number, height: number) => {
    const w = tileToWorld(tx, ty, width, height)
    mesh.position.x = w.x
    mesh.position.z = w.z
  }

  return {
    root,
    objectFor: (agentId) => meshes.get(agentId) ?? null,
    update: (next, prev, alpha, width, height) => {
      const wanted = new Set(next.map((agent) => agent.id))
      for (const [id, mesh] of meshes) {
        if (wanted.has(id)) continue
        root.remove(mesh)
        meshes.delete(id)
        hammers.delete(id)
        markers.delete(id)
        mats.get(id)?.dispose()
        mats.delete(id)
      }
      const t = clamp(alpha, 0, 1)
      const world = getWorld?.()
      const bob = Math.abs(Math.sin(performance.now() / 160))
      for (const a of next) {
        const mesh = meshes.get(a.id) ?? addAgent(a)
        updateMarker(a, mesh)
        const p = prev.get(a.id)
        const ix = p ? p.x + (a.x - p.x) * t : a.x
        const iy = p ? p.y + (a.y - p.y) * t : a.y
        place(mesh, ix, iy, width, height)
        const hammer = hammers.get(a.id)
        const target = claimedBuildTarget(world, a)
        if (target && hammer) {
          hammer.visible = true
          hammer.rotation.x = -0.25 + bob * 0.95
          const from = tileToWorld(ix, iy, width, height)
          const to = tileToWorld(target.x, target.y, width, height)
          mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
        } else {
          if (hammer) {
            hammer.visible = false
            hammer.rotation.x = 0
          }
          if (p && (Math.abs(a.x - p.x) > 1e-4 || Math.abs(a.y - p.y) > 1e-4)) {
            const from = tileToWorld(p.x, p.y, width, height)
            const to = tileToWorld(a.x, a.y, width, height)
            mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
          }
        }
      }
    },
    dispose: () => {
      scene.remove(root)
      geo.dispose()
      for (const m of mats.values()) m.dispose()
      for (const material of markerMaterials.values()) material.dispose()
      for (const texture of markerTextures.values()) texture.dispose()
    },
  }
}

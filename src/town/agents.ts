import * as THREE from 'three'
import type { AgentState } from '../sim/types'
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

export function createAgents(scene: THREE.Scene, agents: readonly AgentState[]): AgentsHandle {
  const root = new THREE.Group()
  root.name = 'residents'
  const geo = new THREE.CapsuleGeometry(CAPSULE_R, CAPSULE_LEN, 4, 8)
  const meshes = new Map<string, THREE.Mesh>()
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
        markers.delete(id)
        mats.get(id)?.dispose()
        mats.delete(id)
      }
      const t = clamp(alpha, 0, 1)
      for (const a of next) {
        const mesh = meshes.get(a.id) ?? addAgent(a)
        updateMarker(a, mesh)
        const p = prev.get(a.id)
        if (!p) {
          place(mesh, a.x, a.y, width, height)
          continue
        }
        place(mesh, p.x + (a.x - p.x) * t, p.y + (a.y - p.y) * t, width, height)
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

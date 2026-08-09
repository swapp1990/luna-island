import * as THREE from 'three'
import type { AgentState } from '../sim/types'

const BODY_H = 0.55
const HEAD_R = 0.16
const BODY_R = 0.14
const GROUND_Y = 0.22

export interface AgentsHandle {
  root: THREE.Group
  /** Call each frame with current agent states, interp alpha, selection. */
  update: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
  ) => void
  /** Mesh list for raycasting (pickables). */
  getPickables: () => THREE.Object3D[]
  /** Resolve a intersected object to agent id. */
  agentIdFromObject: (obj: THREE.Object3D) => string | null
  dispose: () => void
}

function parseColor(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

function lighten(hex: string, amount: number): THREE.Color {
  const c = parseColor(hex)
  c.offsetHSL(0, 0, amount)
  return c
}

interface AgentMesh {
  id: string
  group: THREE.Group
  bodyMat: THREE.MeshStandardMaterial
  headMat: THREE.MeshStandardMaterial
  baseBody: THREE.Color
  baseHead: THREE.Color
}

export function createAgents(scene: THREE.Scene, agents: AgentState[]): AgentsHandle {
  const root = new THREE.Group()
  root.name = 'agents'
  scene.add(root)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(obj: T): T => {
    disposables.push(obj)
    return obj
  }

  const meshes = new Map<string, AgentMesh>()
  const objectToId = new Map<THREE.Object3D, string>()

  const bodyGeo = track(new THREE.CylinderGeometry(BODY_R * 0.85, BODY_R, BODY_H, 10))
  const headGeo = track(new THREE.SphereGeometry(HEAD_R, 12, 10))

  for (const agent of agents) {
    const group = new THREE.Group()
    group.name = agent.id
    group.userData.agentId = agent.id

    const baseBody = parseColor(agent.color)
    const baseHead = lighten(agent.color, 0.12)
    const bodyMat = track(
      new THREE.MeshStandardMaterial({
        color: baseBody.clone(),
        roughness: 0.75,
        metalness: 0.05,
      }),
    )
    const headMat = track(
      new THREE.MeshStandardMaterial({
        color: baseHead.clone(),
        roughness: 0.65,
        metalness: 0.05,
      }),
    )

    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = GROUND_Y + BODY_H / 2
    body.castShadow = true
    body.receiveShadow = true
    body.userData.agentId = agent.id
    group.add(body)

    const head = new THREE.Mesh(headGeo, headMat)
    head.position.y = GROUND_Y + BODY_H + HEAD_R * 0.85
    head.castShadow = true
    head.userData.agentId = agent.id
    group.add(head)

    group.position.set(agent.x, 0, agent.y)
    root.add(group)

    objectToId.set(group, agent.id)
    objectToId.set(body, agent.id)
    objectToId.set(head, agent.id)

    meshes.set(agent.id, {
      id: agent.id,
      group,
      bodyMat,
      headMat,
      baseBody,
      baseHead,
    })
  }

  // Selection ring
  const ringGeo = track(new THREE.RingGeometry(0.28, 0.4, 32))
  const ringMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = GROUND_Y + 0.04
  ring.visible = false
  root.add(ring)

  let pulseT = 0

  const update = (
    agentsIn: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
  ) => {
    pulseT += 0.05
    const a = Math.max(0, Math.min(1, alpha))

    for (const agent of agentsIn) {
      const m = meshes.get(agent.id)
      if (!m) continue

      const px = prev.get(agent.id)?.x ?? agent.x
      const py = prev.get(agent.id)?.y ?? agent.y
      const x = px + (agent.x - px) * a
      const y = py + (agent.y - py) * a
      m.group.position.set(x, 0, y)

      // Flat + dim only when actually in bed (path finished), not while walking home
      const isSleeping =
        agent.action.kind === 'sleep' &&
        (agent.action.path === undefined ||
          agent.pathIndex >= (agent.action.path?.length ?? 0))

      if (isSleeping) {
        m.group.scale.set(1, 0.5, 1)
        m.bodyMat.color.copy(m.baseBody).multiplyScalar(0.6)
        m.headMat.color.copy(m.baseHead).multiplyScalar(0.6)
      } else {
        m.group.scale.set(1, 1, 1)
        m.bodyMat.color.copy(m.baseBody)
        m.headMat.color.copy(m.baseHead)
      }
    }

    if (selectedId && meshes.has(selectedId)) {
      const m = meshes.get(selectedId)!
      ring.visible = true
      ring.position.x = m.group.position.x
      ring.position.z = m.group.position.z
      const pulse = 0.75 + Math.sin(pulseT) * 0.15
      ringMat.opacity = pulse
      const s = 1 + Math.sin(pulseT * 1.3) * 0.08
      ring.scale.set(s, s, s)
    } else {
      ring.visible = false
    }
  }

  const getPickables = (): THREE.Object3D[] => {
    const list: THREE.Object3D[] = []
    for (const m of meshes.values()) {
      list.push(m.group)
    }
    return list
  }

  const agentIdFromObject = (obj: THREE.Object3D): string | null => {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      const id = objectToId.get(cur) ?? (cur.userData.agentId as string | undefined)
      if (id) return id
      cur = cur.parent
    }
    return null
  }

  const dispose = () => {
    scene.remove(root)
    for (const d of disposables) d.dispose()
    meshes.clear()
    objectToId.clear()
  }

  return { root, update, getPickables, agentIdFromObject, dispose }
}

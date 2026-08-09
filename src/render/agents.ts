import * as THREE from 'three'
import type { AgentState, Good, Place } from '../sim/types'

const BODY_H = 0.55
const HEAD_R = 0.16
const BODY_R = 0.14
const GROUND_Y = 0.22
const BOB_AMP = 0.04
const BOB_FREQ = 14
const LEAN = 0.12

const CARRY_TINT: Record<Good, number> = {
  food: 0x5aaf4a,
  wood: 0x8b6914,
  stone: 0x8a8f98,
}

export interface AgentsHandle {
  root: THREE.Group
  /** Call each frame with current agent states, interp alpha, selection. */
  update: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId?: string | null,
    places?: Place[],
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

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

interface AgentMesh {
  id: string
  group: THREE.Group
  bodyMat: THREE.MeshStandardMaterial
  headMat: THREE.MeshStandardMaterial
  baseBody: THREE.Color
  baseHead: THREE.Color
  /** Accumulated distance for walk bob phase. */
  walkDist: number
  lastX: number
  lastZ: number
  /** Small crate/sack on back when carrying goods. */
  carryMesh: THREE.Mesh
  carryMat: THREE.MeshStandardMaterial
}

function primaryCarryGood(agent: AgentState): Good | null {
  // Prefer active haul cargo, else any inventory
  if (agent.haulGood && agent.haulAmount > 0) return agent.haulGood
  const inv = agent.inventory
  if (!inv) return null
  if ((inv.food ?? 0) > 0) return 'food'
  if ((inv.wood ?? 0) > 0) return 'wood'
  if ((inv.stone ?? 0) > 0) return 'stone'
  return null
}

function isOnPath(agent: AgentState): boolean {
  const path = agent.action.path
  return !!(path && path.length > 0 && agent.pathIndex < path.length)
}

function isPerformingSleep(agent: AgentState): boolean {
  return (
    agent.action.kind === 'sleep' &&
    (agent.action.path === undefined ||
      agent.pathIndex >= (agent.action.path?.length ?? 0))
  )
}

function isPerformingSocial(agent: AgentState): boolean {
  return (
    agent.action.kind === 'socialize' &&
    (agent.action.path === undefined ||
      agent.pathIndex >= (agent.action.path?.length ?? 0))
  )
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
  const carryGeo = track(new THREE.BoxGeometry(0.16, 0.14, 0.12))

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

    const carryMat = track(
      new THREE.MeshStandardMaterial({
        color: CARRY_TINT.food,
        roughness: 0.85,
        metalness: 0.05,
      }),
    )
    const carryMesh = new THREE.Mesh(carryGeo, carryMat)
    // On the back (local -Z when facing +Z walk direction after yaw)
    carryMesh.position.set(0, GROUND_Y + BODY_H * 0.55, -BODY_R - 0.06)
    carryMesh.castShadow = true
    carryMesh.visible = false
    carryMesh.userData.agentId = agent.id
    group.add(carryMesh)

    group.position.set(agent.x, 0, agent.y)
    root.add(group)

    objectToId.set(group, agent.id)
    objectToId.set(body, agent.id)
    objectToId.set(head, agent.id)
    objectToId.set(carryMesh, agent.id)

    meshes.set(agent.id, {
      id: agent.id,
      group,
      bodyMat,
      headMat,
      baseBody,
      baseHead,
      walkDist: 0,
      lastX: agent.x,
      lastZ: agent.y,
      carryMesh,
      carryMat,
    })
  }

  // Selection ring (agent)
  const ringGeo = track(new THREE.RingGeometry(0.28, 0.4, 32))
  const ringMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      // RTS-style: ring must stay readable on the plaza disc, paths, and behind
      // props — skip the depth test and draw late via renderOrder.
      depthTest: false,
    }),
  )
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = 999
  ring.rotation.x = -Math.PI / 2
  ring.position.y = GROUND_Y + 0.04
  ring.visible = false
  root.add(ring)

  // Larger selection ring for buildings
  const placeRingGeo = track(new THREE.RingGeometry(0.55, 0.78, 40))
  const placeRingMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  const placeRing = new THREE.Mesh(placeRingGeo, placeRingMat)
  placeRing.renderOrder = 999
  placeRing.rotation.x = -Math.PI / 2
  placeRing.position.y = GROUND_Y + 0.04
  placeRing.visible = false
  root.add(placeRing)

  let pulseT = 0

  const update = (
    agentsIn: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId: string | null = null,
    places: Place[] = [],
  ) => {
    pulseT += 0.05
    const a = Math.max(0, Math.min(1, alpha))

    // Interpolated positions for social facing
    const interp = new Map<string, { x: number; z: number; agent: AgentState }>()
    for (const agent of agentsIn) {
      const px = prev.get(agent.id)?.x ?? agent.x
      const py = prev.get(agent.id)?.y ?? agent.y
      const x = px + (agent.x - px) * a
      const z = py + (agent.y - py) * a
      interp.set(agent.id, { x, z, agent })
    }

    // Socializers currently standing (for face-nearest)
    const socialStanding: Array<{ id: string; x: number; z: number }> = []
    for (const [id, p] of interp) {
      if (isPerformingSocial(p.agent)) socialStanding.push({ id, x: p.x, z: p.z })
    }

    for (const agent of agentsIn) {
      const m = meshes.get(agent.id)
      if (!m) continue
      const p = interp.get(agent.id)!
      const x = p.x
      const z = p.z

      const dx = x - m.lastX
      const dz = z - m.lastZ
      const moved = Math.hypot(dx, dz)
      m.lastX = x
      m.lastZ = z

      const sleeping = isPerformingSleep(agent)
      const socializing = isPerformingSocial(agent)
      const walking = isOnPath(agent) && moved > 1e-5

      // Carry sack visibility + tint from inventory / haul
      const carry = primaryCarryGood(agent)
      if (carry) {
        m.carryMesh.visible = true
        m.carryMat.color.setHex(CARRY_TINT[carry])
      } else {
        m.carryMesh.visible = false
      }

      if (sleeping) {
        m.group.position.set(x, 0, z)
        m.group.scale.set(1, 0.5, 1)
        m.group.rotation.set(0, m.group.rotation.y, 0)
        m.bodyMat.color.copy(m.baseBody).multiplyScalar(0.6)
        m.headMat.color.copy(m.baseHead).multiplyScalar(0.6)
        m.carryMesh.visible = false
        continue
      }

      m.bodyMat.color.copy(m.baseBody)
      m.headMat.color.copy(m.baseHead)

      if (walking) {
        m.walkDist += moved
        const bob = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP
        m.group.position.set(x, bob, z)
        // Face + lean into walk direction (sim y → world z)
        const yaw = Math.atan2(dx, dz)
        m.group.rotation.y = yaw
        m.group.rotation.x = LEAN * Math.min(1, moved * 8)
        m.group.rotation.z = 0
        m.group.scale.set(1, 1, 1)
      } else if (socializing) {
        m.group.position.set(x, 0, z)
        m.group.rotation.x = 0
        m.group.rotation.z = 0
        // Yaw toward nearest other socializer
        let bestD = Infinity
        let faceX = 0
        let faceZ = 1
        for (const o of socialStanding) {
          if (o.id === agent.id) continue
          const ddx = o.x - x
          const ddz = o.z - z
          const d2 = ddx * ddx + ddz * ddz
          if (d2 < bestD && d2 > 1e-6) {
            bestD = d2
            faceX = ddx
            faceZ = ddz
          }
        }
        if (bestD < Infinity) {
          m.group.rotation.y = Math.atan2(faceX, faceZ)
        }
        // Micro-bounce: sharp pulse every few seconds, phase-offset per agent
        const offset = (hashId(agent.id) % 1000) / 1000
        const t = pulseT * 0.35 + offset * Math.PI * 2
        const pulse = Math.pow(Math.max(0, Math.sin(t)), 10)
        const s = 1 + pulse * 0.03
        m.group.scale.set(s, s, s)
      } else {
        m.group.position.set(x, 0, z)
        m.group.rotation.x = 0
        m.group.rotation.z = 0
        m.group.scale.set(1, 1, 1)
      }
    }

    if (selectedId && meshes.has(selectedId)) {
      const m = meshes.get(selectedId)!
      ring.visible = true
      placeRing.visible = false
      ring.position.x = m.group.position.x
      ring.position.z = m.group.position.z
      const pulse = 0.75 + Math.sin(pulseT) * 0.15
      ringMat.opacity = pulse
      const s = 1 + Math.sin(pulseT * 1.3) * 0.08
      ring.scale.set(s, s, s)
    } else if (selectedPlaceId) {
      ring.visible = false
      const place = places.find((p) => p.id === selectedPlaceId)
      if (place) {
        placeRing.visible = true
        placeRing.position.x = place.x
        placeRing.position.z = place.y
        const pulse = 0.75 + Math.sin(pulseT) * 0.15
        placeRingMat.opacity = pulse
        const s = 1 + Math.sin(pulseT * 1.3) * 0.08
        placeRing.scale.set(s, s, s)
      } else {
        placeRing.visible = false
      }
    } else {
      ring.visible = false
      placeRing.visible = false
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

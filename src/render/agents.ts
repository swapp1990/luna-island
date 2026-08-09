import * as THREE from 'three'
import type { AgentState, Good, Place } from '../sim/types'
import type { FxHandle } from './fx'

const BODY_H = 0.55
const HEAD_R = 0.16
const BODY_R = 0.14
const GROUND_Y = 0.22
const BOB_AMP = 0.04
const BOB_FREQ = 14
const LEAN = 0.12
const WORK_LEAN = 0.18
const HEAD_Y = GROUND_Y + BODY_H + HEAD_R * 0.85
const HAT_Y = HEAD_Y + HEAD_R * 0.55

const CARRY_TINT: Record<Good, number> = {
  food: 0x5aaf4a,
  wood: 0x8b6914,
  stone: 0x8a8f98,
}

const HAT_COLORS = {
  farm: 0xe0c068,
  stall: 0xc94f4f,
  forestry: 0x3d7d46,
  quarry: 0xc9b52a,
  'construction-site': 0xc9b52a,
} as const

type HatKind = keyof typeof HAT_COLORS
type ToolKind = 'hoe' | 'axe' | 'pick' | 'hammer'

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
    now?: number,
    fx?: FxHandle | null,
    treePositions?: Array<{ x: number; z: number }>,
    onTreeHit?: (x: number, z: number, now: number) => void,
  ) => void
  /** Mesh list for raycasting (pickables). */
  getPickables: () => THREE.Object3D[]
  /** Resolve a intersected object to agent id. */
  agentIdFromObject: (obj: THREE.Object3D) => string | null
  /** Visible hat / tool counts for DEV probe. */
  getJuiceCounts: () => { hats: number; tools: number }
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

interface ToolMeshes {
  hoe: THREE.Group
  axe: THREE.Group
  pick: THREE.Group
  hammer: THREE.Group
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
  /** Phase offset 0–1 for desynced crew anims. */
  phase: number
  hatRoot: THREE.Group
  hatFarm: THREE.Object3D
  hatStall: THREE.Object3D
  hatCap: THREE.Object3D
  hatHelmet: THREE.Object3D
  tools: ToolMeshes
  toolRoot: THREE.Group
  /** Last work-swing apex phase bin (0/1) for one-shot particle triggers. */
  lastApexBin: number
}

function primaryCarryGood(agent: AgentState): Good | null {
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

function isPerformingWork(agent: AgentState): boolean {
  if (agent.action.kind !== 'work') return false
  return !isOnPath(agent)
}

function isHauling(agent: AgentState): boolean {
  return agent.workPhase === 'hauling' || agent.workPhase === 'returning'
}

function jobKindFromPlace(place: Place | undefined): HatKind | null {
  if (!place) return null
  if (place.kind === 'farm') return 'farm'
  if (place.kind === 'stall') return 'stall'
  if (place.kind === 'forestry') return 'forestry'
  if (place.kind === 'quarry') return 'quarry'
  if (place.kind === 'construction-site') return 'construction-site'
  return null
}

function toolForJob(job: HatKind | null, hauling: boolean): ToolKind | null {
  if (!job || hauling) return null
  if (job === 'farm') return 'hoe'
  if (job === 'forestry') return 'axe'
  if (job === 'quarry') return 'pick'
  if (job === 'construction-site') return 'hammer'
  return null
}

function buildHoe(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const bladeMat = track(new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.55, metalness: 0.35 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 6)), stickMat)
  stick.position.y = 0.21
  g.add(stick)
  const blade = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.03, 0.06)), bladeMat)
  blade.position.set(0.05, 0.02, 0)
  g.add(blade)
  return g
}

function buildAxe(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.4 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6)), stickMat)
  stick.position.y = 0.2
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.08, 0.04)), headMat)
  head.position.set(0.06, 0.38, 0)
  g.add(head)
  return g
}

function buildPick(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.4 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6)), stickMat)
  stick.position.y = 0.2
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.04, 0.04)), headMat)
  head.position.set(0, 0.38, 0)
  g.add(head)
  return g
}

function buildHammer(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.55, metalness: 0.35 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.022, 0.32, 6)), stickMat)
  stick.position.y = 0.16
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.08, 0.06)), headMat)
  head.position.set(0, 0.32, 0)
  g.add(head)
  return g
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

  // Shared hat geometries
  const strawGeo = track(new THREE.ConeGeometry(0.22, 0.08, 10))
  const kerchiefGeo = track(new THREE.BoxGeometry(0.18, 0.06, 0.14))
  const capGeo = track(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2))
  const helmetGeo = track(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2))

  const strawMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.farm, roughness: 0.9 }))
  const kerchiefMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.stall, roughness: 0.85 }))
  const capMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.forestry, roughness: 0.8 }))
  const helmetMat = track(
    new THREE.MeshStandardMaterial({ color: HAT_COLORS.quarry, roughness: 0.55, metalness: 0.25 }),
  )

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
    head.position.y = HEAD_Y
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
    carryMesh.position.set(0, GROUND_Y + BODY_H * 0.55, -BODY_R - 0.06)
    carryMesh.castShadow = true
    carryMesh.visible = false
    carryMesh.userData.agentId = agent.id
    group.add(carryMesh)

    // Hats (shared geos, per-agent mats already shared — fine for low-poly)
    const hatRoot = new THREE.Group()
    hatRoot.position.y = HAT_Y
    const hatFarm = new THREE.Mesh(strawGeo, strawMat)
    hatFarm.rotation.x = Math.PI // flat brim sits on head
    hatFarm.position.y = 0.02
    hatFarm.visible = false
    hatRoot.add(hatFarm)
    const hatStall = new THREE.Mesh(kerchiefGeo, kerchiefMat)
    hatStall.position.y = 0.02
    hatStall.visible = false
    hatRoot.add(hatStall)
    const hatCap = new THREE.Mesh(capGeo, capMat)
    hatCap.position.y = 0.01
    hatCap.visible = false
    hatRoot.add(hatCap)
    const hatHelmet = new THREE.Mesh(helmetGeo, helmetMat)
    hatHelmet.position.y = 0.01
    hatHelmet.visible = false
    hatRoot.add(hatHelmet)
    group.add(hatRoot)

    // Tools — grip at right hip, swung via toolRoot rotation
    const toolRoot = new THREE.Group()
    toolRoot.position.set(0.14, GROUND_Y + BODY_H * 0.55, 0.06)
    const hoe = buildHoe(track)
    const axe = buildAxe(track)
    const pick = buildPick(track)
    const hammer = buildHammer(track)
    for (const t of [hoe, axe, pick, hammer]) {
      t.visible = false
      toolRoot.add(t)
    }
    group.add(toolRoot)

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
      phase: (hashId(agent.id) % 1000) / 1000,
      hatRoot,
      hatFarm,
      hatStall,
      hatCap,
      hatHelmet,
      tools: { hoe, axe, pick, hammer },
      toolRoot,
      lastApexBin: -1,
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
      depthTest: false,
    }),
  )
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = 999
  ring.rotation.x = -Math.PI / 2
  ring.position.y = GROUND_Y + 0.04
  ring.visible = false
  root.add(ring)

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
  let hatCount = 0
  let toolCount = 0

  const setHat = (m: AgentMesh, job: HatKind | null) => {
    m.hatFarm.visible = job === 'farm'
    m.hatStall.visible = job === 'stall'
    m.hatCap.visible = job === 'forestry'
    m.hatHelmet.visible = job === 'quarry' || job === 'construction-site'
  }

  const setTool = (m: AgentMesh, tool: ToolKind | null) => {
    m.tools.hoe.visible = tool === 'hoe'
    m.tools.axe.visible = tool === 'axe'
    m.tools.pick.visible = tool === 'pick'
    m.tools.hammer.visible = tool === 'hammer'
    m.toolRoot.visible = tool !== null
  }

  const nearestTree = (
    x: number,
    z: number,
    trees: Array<{ x: number; z: number }> | undefined,
    maxDist: number,
  ): { x: number; z: number } | null => {
    if (!trees || trees.length === 0) return null
    let best: { x: number; z: number } | null = null
    let bestD = maxDist * maxDist
    for (const t of trees) {
      const dx = t.x - x
      const dz = t.z - z
      const d2 = dx * dx + dz * dz
      if (d2 <= bestD) {
        bestD = d2
        best = t
      }
    }
    return best
  }

  const update = (
    agentsIn: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId: string | null = null,
    places: Place[] = [],
    now = performance.now(),
    fx: FxHandle | null = null,
    treePositions?: Array<{ x: number; z: number }>,
    onTreeHit?: (x: number, z: number, now: number) => void,
  ) => {
    pulseT += 0.05
    const a = Math.max(0, Math.min(1, alpha))
    hatCount = 0
    toolCount = 0

    const placeById = new Map(places.map((p) => [p.id, p]))

    const interp = new Map<string, { x: number; z: number; agent: AgentState }>()
    for (const agent of agentsIn) {
      const px = prev.get(agent.id)?.x ?? agent.x
      const py = prev.get(agent.id)?.y ?? agent.y
      const x = px + (agent.x - px) * a
      const z = py + (agent.y - py) * a
      interp.set(agent.id, { x, z, agent })
    }

    const socialStanding: Array<{ id: string; x: number; z: number }> = []
    for (const [id, p] of interp) {
      if (isPerformingSocial(p.agent)) socialStanding.push({ id, x: p.x, z: p.z })
    }

    // ~1 Hz swing in radians of phase; wall-time based for smooth juice
    const tSec = now / 1000

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
      const working = isPerformingWork(agent)
      const hauling = isHauling(agent)

      const jobPlace = agent.employedAt ? placeById.get(agent.employedAt) : undefined
      const job = jobKindFromPlace(jobPlace)
      setHat(m, job)
      if (job) hatCount++

      // Carry sack
      const carry = primaryCarryGood(agent)
      if (carry) {
        m.carryMesh.visible = true
        m.carryMat.color.setHex(CARRY_TINT[carry])
      } else {
        m.carryMesh.visible = false
      }

      // Collapse: red pulse until recovery
      if (agent.collapsed) {
        const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tSec * 4 + m.phase * Math.PI * 2))
        m.bodyMat.color.copy(m.baseBody).lerp(new THREE.Color(0xc03030), pulse * 0.65)
        m.headMat.color.copy(m.baseHead).lerp(new THREE.Color(0xc03030), pulse * 0.45)
      } else if (!sleeping) {
        m.bodyMat.color.copy(m.baseBody)
        m.headMat.color.copy(m.baseHead)
      }

      if (sleeping) {
        m.group.position.set(x, 0, z)
        m.group.scale.set(1, 0.5, 1)
        m.group.rotation.set(0, m.group.rotation.y, 0)
        if (!agent.collapsed) {
          m.bodyMat.color.copy(m.baseBody).multiplyScalar(0.6)
          m.headMat.color.copy(m.baseHead).multiplyScalar(0.6)
        }
        m.carryMesh.visible = false
        setTool(m, null)
        // Hat stays on while sleeping (charm)
        m.hatRoot.scale.set(1, 2, 1) // counter body squash so hat still reads
        m.hatRoot.position.y = HAT_Y
        continue
      }

      m.hatRoot.scale.set(1, 1, 1)
      m.hatRoot.position.y = HAT_Y

      // Work tool theater
      const showTool =
        working && !hauling ? toolForJob(job, false) : null
      setTool(m, showTool)
      if (showTool) toolCount++

      if (working && showTool) {
        // Face work target
        if (job === 'forestry') {
          const tree = nearestTree(x, z, treePositions, 2)
          if (tree) {
            m.group.rotation.y = Math.atan2(tree.x - x, tree.z - z)
          }
        } else if (jobPlace) {
          // Face workplace center slightly
          const fdx = jobPlace.x - x
          const fdz = jobPlace.y - z
          if (fdx * fdx + fdz * fdz > 1e-4) {
            m.group.rotation.y = Math.atan2(fdx, fdz)
          }
        }

        // ~1 Hz arc; phase-offset per agent
        const phase = tSec * Math.PI * 2 * 1.0 + m.phase * Math.PI * 2
        const swing = Math.sin(phase)
        // Apex when sin ≈ 1
        const apexBin = Math.floor((phase + Math.PI / 2) / Math.PI)
        const atApex = swing > 0.92 && apexBin !== m.lastApexBin
        if (atApex) m.lastApexBin = apexBin

        if (showTool === 'hoe' || showTool === 'axe' || showTool === 'pick') {
          m.toolRoot.rotation.x = -0.4 + swing * 0.85
          m.toolRoot.rotation.z = 0.15
        } else if (showTool === 'hammer') {
          // Bob up/down
          m.toolRoot.rotation.x = -0.2 + Math.abs(swing) * 0.7
          m.toolRoot.rotation.z = 0.1
        }

        m.group.position.set(x, 0, z)
        m.group.rotation.x = WORK_LEAN * (0.4 + 0.6 * Math.max(0, swing))
        m.group.rotation.z = 0
        m.group.scale.set(1, 1, 1)

        // Particles at apex
        if (atApex && fx) {
          const tipX = x + Math.sin(m.group.rotation.y) * 0.35
          const tipZ = z + Math.cos(m.group.rotation.y) * 0.35
          const tipY = GROUND_Y + 0.35
          if (showTool === 'axe') {
            fx.puffWoodChips(tipX, tipY, tipZ, 3 + Math.floor(Math.random() * 2))
            const tree = nearestTree(x, z, treePositions, 2)
            if (tree && onTreeHit) onTreeHit(tree.x, tree.z, now)
          } else if (showTool === 'pick') {
            fx.puffStoneChips(tipX, tipY, tipZ, 3)
            fx.spark(tipX, tipY + 0.05, tipZ)
          } else if (showTool === 'hammer') {
            fx.knockDust(tipX, GROUND_Y + 0.15, tipZ)
          }
        }
        continue
      }

      // Haul leg: no tool; sack + forward lean sells it
      if (working && hauling) {
        setTool(m, null)
        m.group.position.set(x, 0, z)
        m.group.rotation.x = LEAN * 0.7
        m.group.rotation.z = 0
        m.group.scale.set(1, 1, 1)
        if (walking || moved > 1e-5) {
          m.walkDist += moved
          const bob = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP * 0.6
          m.group.position.y = bob
          if (moved > 1e-5) m.group.rotation.y = Math.atan2(dx, dz)
        }
        continue
      }

      if (walking) {
        setTool(m, null)
        m.walkDist += moved
        const bob = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP
        m.group.position.set(x, bob, z)
        const yaw = Math.atan2(dx, dz)
        m.group.rotation.y = yaw
        m.group.rotation.x = LEAN * Math.min(1, moved * 8)
        m.group.rotation.z = 0
        m.group.scale.set(1, 1, 1)
      } else if (socializing) {
        setTool(m, null)
        m.group.position.set(x, 0, z)
        m.group.rotation.x = 0
        m.group.rotation.z = 0
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
        const offset = m.phase
        const t = pulseT * 0.35 + offset * Math.PI * 2
        const pulse = Math.pow(Math.max(0, Math.sin(t)), 10)
        const s = 1 + pulse * 0.03
        m.group.scale.set(s, s, s)
      } else {
        setTool(m, null)
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

  const getJuiceCounts = () => ({ hats: hatCount, tools: toolCount })

  const dispose = () => {
    scene.remove(root)
    for (const d of disposables) d.dispose()
    meshes.clear()
    objectToId.clear()
  }

  return { root, update, getPickables, agentIdFromObject, getJuiceCounts, dispose }
}

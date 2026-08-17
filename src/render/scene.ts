import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { AgentState, SimEvent, WorldState } from '../sim/types'
import { describeBursts } from './actionLanguage'
import { buildTerrain, type TerrainHandle } from './terrain'
import { createDayNight, type DayNightHandle } from './daynight'
import { createAgents, type AgentsHandle } from './agents'
import { createFx, type FxHandle } from './fx'
import {
  createOverlays,
  formatAgentTooltip,
  formatPlaceTooltip,
  type OverlaysHandle,
} from './overlays'
import type { SimTime } from '../sim/types'

export interface SelectionCallbacks {
  onSelectAgent: (id: string | null) => void
  onSelectPlace: (id: string | null) => void
}

/** Extra probes / occluders for photo-mode azimuth rescue. */
export interface FrameSubjectOpts {
  height?: number
  span?: number
  /** World-space visibility probes (pair heads, place center + roof). */
  probes?: Array<{ x: number; y: number; z: number }>
  /** Hero place id — hits on this mesh count as reaching the subject. */
  placeId?: string
  /** Pair / named agents that are not occluders. */
  subjectAgentIds?: string[]
  /** Non-subject agents; those near the camera ray can occlude pair/place shots. */
  occluderAgents?: Array<{ id: string; x: number; z: number }>
  /** Same-kind places; a closer rival on this azimuth counts as occlusion. */
  rivalPlaces?: Array<{ x: number; z: number }>
}

export interface SceneHandle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  terrain: TerrainHandle
  dayNight: DayNightHandle
  agents: AgentsHandle
  overlays: OverlaysHandle
  fx: FxHandle
  setTime: (time: SimTime) => void
  updateAgents: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId?: string | null,
    places?: WorldState['places'],
    now?: number,
    tick?: number,
    events?: readonly SimEvent[],
    settle?: boolean,
    photoSubjectId?: string | null,
  ) => void
  /** Wire click-to-select; returns cleanup. */
  bindSelection: (cb: SelectionCallbacks) => () => void
  /** Follow selected agent: lerp orbit target + camera by same delta. */
  followAgent: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    factor?: number,
  ) => void
  /** Project overlays for the current frame. */
  updateOverlays: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    places: WorldState['places'],
    now: number,
    time?: SimTime | null,
    tick?: number,
    events?: readonly SimEvent[],
  ) => void
  /** Sync bush berry-dot visibility to place inventory stock. */
  updateBushStock: (places: WorldState['places']) => void
  /** Sync farm growth + stall crate visuals. */
  updateEconomyVisuals: (places: WorldState['places'], now?: number) => void
  /** Live-only celebration FX from events. */
  celebrateConstruction: (placeId: string | null, now: number) => void
  celebrateHarvest: (placeId: string | null, now: number) => void
  celebrateClose: (agentIdA: string, agentIdB: string, now: number) => void
  /** Aim orbit camera at a world point (e2e / screenshots). */
  lookAt: (x: number, z: number, dist?: number) => void
  /**
   * Photo-mode hero framing. Subject fills ~1/6–1/4 of frame height,
   * camera at ~26° elevation (auto-raises if terrain occludes).
   * `zoom` multiplies closeness. `opts.height` / `opts.span` size the shot.
   * Occluded subjects fall back to a fixed azimuth list; SE is kept unless
   * a candidate has a strictly higher subject-probe score.
   */
  frameSubject: (
    x: number,
    z: number,
    zoom?: number,
    opts?: FrameSubjectOpts,
  ) => void
  resize: (w: number, h: number) => void
  dispose: () => void
  render: () => void
  /** Publish camera target for e2e / debug. */
  publishCameraTarget: () => void
  /** World xz of a place mesh, if known. */
  getPlaceWorldPos: (placeId: string) => { x: number; y: number; z: number } | null
}

declare global {
  interface Window {
    __cameraTarget?: { x: number; y: number; z: number }
    __renderProbe?: {
      hats: number
      tools: number
      particles: number
      destMarkers: number
    }
    /** DEV/e2e: aim orbit camera at world xz. */
    __renderLookAt?: (x: number, z: number, dist?: number) => void
    /** DEV/e2e: world pos of a place mesh. */
    __placePos?: (placeId: string) => { x: number; y: number; z: number } | null
    /** DEV/e2e: last photo frame azimuth (default vs rescued). */
    __photoFrame?: {
      azimuth: string
      rescued: boolean
      elevDeg: number
      hits: number
      total: number
      probeHits?: number
      probeTotal?: number
      why?: string[]
      seWhy?: string[]
    }
  }
}

export function createScene(container: HTMLElement, world: WorldState): SceneHandle {
  // Ensure container is a positioning context for overlays
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative'
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x9ed3ff)
  scene.fog = new THREE.Fog(0x9ed3ff, 40, 120)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  // Default camera frames the village (plaza), not the whole island center
  const plaza = world.places.find((p) => p.kind === 'plaza')
  const targetX = plaza?.x ?? world.width / 2
  const targetZ = plaza?.y ?? world.height / 2

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    300,
  )
  camera.position.set(targetX + 14, 13, targetZ + 14)
  camera.lookAt(targetX, 0, targetZ)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(targetX, 0.2, targetZ)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  // Photo hero shots sit at ~3–6 units; 8 was clamping every still to postcard.
  controls.minDistance = 2
  controls.maxDistance = 90
  controls.maxPolarAngle = (80 * Math.PI) / 180
  controls.update()

  const terrain = buildTerrain(scene, world)
  const dayNight = createDayNight(scene, world)
  const agents = createAgents(scene, world.agents)
  const overlays = createOverlays(container)
  const fx = createFx(scene)
  const treePositions = terrain.getTreePositions()

  // Hover / tooltip state (updated from bindSelection pointermove + interval)
  let hoverAgents: AgentState[] = world.agents
  let hoverPlaces: WorldState['places'] = world.places
  let hoverTime: SimTime | null = { day: 1, hour: 6, minute: 0, tick: 0 }
  let pointerClientX = 0
  let pointerClientY = 0
  let pointerOverCanvas = false
  let dragging = false
  let hoverDownX = 0
  let hoverDownY = 0
  let hoverStartMs = 0
  let hoverTarget: { kind: 'agent' | 'place'; id: string } | null = null
  let lastHoverPickMs = 0

  const setTime = (time: SimTime) => {
    dayNight.update(time)
    hoverTime = time
  }

  const updateAgents = (
    list: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId: string | null = null,
    places: WorldState['places'] = [],
    now = 0,
    tick = 0,
    events: readonly SimEvent[] = [],
    settle = false,
    photoSubjectId: string | null = null,
  ) => {
    hoverAgents = list
    hoverPlaces = places
    const simNow = (tick + Math.max(0, Math.min(1, alpha))) * 1000
    agents.update(
      list,
      prev,
      alpha,
      selectedId,
      selectedPlaceId,
      places,
      simNow,
      fx,
      treePositions,
      (tx, tz, tNow) => terrain.shakeTreeAt(tx, tz, tNow),
      tick,
      events,
      settle,
      photoSubjectId,
    )
    fx.update(simNow)

    const bursts = describeBursts(events, tick)
    const sites = new Map<
      string,
      { x: number; y: number; z: number; other?: { x: number; y: number; z: number }; place?: { x: number; y: number; z: number } }
    >()
    const interp = (ag: AgentState) => {
      const a = Math.max(0, Math.min(1, alpha))
      const px = prev.get(ag.id)?.x ?? ag.x
      const py = prev.get(ag.id)?.y ?? ag.y
      return { x: px + (ag.x - px) * a, z: py + (ag.y - py) * a }
    }
    for (const b of bursts) {
      const ag = list.find((x) => x.id === b.agentId)
      if (!ag) continue
      const p = interp(ag)
      const site: {
        x: number
        y: number
        z: number
        other?: { x: number; y: number; z: number }
        place?: { x: number; y: number; z: number }
      } = { x: p.x, y: 0.22, z: p.z }
      if (b.otherId) {
        const other = list.find((x) => x.id === b.otherId)
        if (other) {
          const op = interp(other)
          site.other = { x: op.x, y: 0.22, z: op.z }
        }
      }
      if (b.placeId) {
        const pos = terrain.getPlaceWorldPos(b.placeId)
        if (pos) site.place = { x: pos.x, y: pos.y, z: pos.z }
      }
      sites.set(b.agentId, site)
    }
    fx.syncBursts(bursts, sites, tick, alpha)

    // DEV-gated render probe for e2e (vite dev / e2e webServer)
    if (import.meta.env.DEV) {
      const juice = agents.getJuiceCounts()
      window.__renderProbe = {
        hats: juice.hats,
        tools: juice.tools,
        particles: fx.activeCount(),
        destMarkers: juice.destMarkers,
      }
    }
    void now
  }

  const followAgent = (
    list: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    factor = 0.08,
  ) => {
    if (!selectedId) return
    const agent = list.find((a) => a.id === selectedId)
    if (!agent) return
    const a = Math.max(0, Math.min(1, alpha))
    const px = prev.get(agent.id)?.x ?? agent.x
    const py = prev.get(agent.id)?.y ?? agent.y
    const x = px + (agent.x - px) * a
    const z = py + (agent.y - py) * a
    const desiredY = 0.2
    const dx = (x - controls.target.x) * factor
    const dy = (desiredY - controls.target.y) * factor
    const dz = (z - controls.target.z) * factor
    controls.target.x += dx
    controls.target.y += dy
    controls.target.z += dz
    camera.position.x += dx
    camera.position.y += dy
    camera.position.z += dz
  }

  const updateOverlays = (
    list: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    places: WorldState['places'],
    now: number,
    time: SimTime | null = null,
    tick = 0,
    events: readonly SimEvent[] = [],
  ) => {
    hoverAgents = list
    hoverPlaces = places
    if (time) hoverTime = time
    overlays.updateFrame({
      camera,
      width: renderer.domElement.clientWidth,
      height: renderer.domElement.clientHeight,
      selectedId,
      agents: list,
      places,
      prev,
      alpha,
      now,
      time,
      tick,
      events,
    })

    // Throttled hover tooltip (~10 Hz)
    if (pointerOverCanvas && !dragging && now - lastHoverPickMs >= 100) {
      lastHoverPickMs = now
      updateHoverTooltip(pointerClientX, pointerClientY, now)
    } else if (dragging || !pointerOverCanvas) {
      overlays.setTooltip(null, 0, 0)
      hoverTarget = null
      hoverStartMs = 0
    } else if (hoverTarget && hoverStartMs > 0 && now - hoverStartMs >= 150) {
      // Keep showing tooltip under cursor
      const text = tooltipTextFor(hoverTarget)
      if (text) overlays.setTooltip(text, pointerClientX, pointerClientY)
    }
  }

  const tooltipTextFor = (
    target: { kind: 'agent' | 'place'; id: string },
  ): string | null => {
    if (target.kind === 'agent') {
      const agent = hoverAgents.find((a) => a.id === target.id)
      if (!agent) return null
      return formatAgentTooltip(agent, hoverPlaces, hoverAgents)
    }
    const place = hoverPlaces.find((p) => p.id === target.id)
    if (!place) return null
    return formatPlaceTooltip(place, hoverAgents, hoverTime)
  }

  const updateHoverTooltip = (clientX: number, clientY: number, now: number) => {
    const canvas = renderer.domElement
    const rect = canvas.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, camera)

    let next: { kind: 'agent' | 'place'; id: string } | null = null
    const agentHits = raycaster.intersectObjects(agents.getPickables(), true)
    if (agentHits.length > 0) {
      const id = agents.agentIdFromObject(agentHits[0]!.object)
      if (id) next = { kind: 'agent', id }
    }
    if (!next) {
      const placeHits = raycaster.intersectObjects(terrain.getPlacePickables(), true)
      if (placeHits.length > 0) {
        const id = terrain.placeIdFromObject(placeHits[0]!.object)
        if (id) next = { kind: 'place', id }
      }
    }

    if (!next) {
      hoverTarget = null
      hoverStartMs = 0
      overlays.setTooltip(null, 0, 0)
      return
    }

    if (
      !hoverTarget ||
      hoverTarget.kind !== next.kind ||
      hoverTarget.id !== next.id
    ) {
      hoverTarget = next
      hoverStartMs = now
      overlays.setTooltip(null, 0, 0)
      return
    }

    if (now - hoverStartMs >= 150) {
      const text = tooltipTextFor(next)
      if (text) overlays.setTooltip(text, clientX, clientY)
    }
  }

  const updateBushStock = (places: WorldState['places']) => {
    terrain.updateBushStock(places)
  }
  const updateEconomyVisuals = (places: WorldState['places'], now = performance.now()) => {
    hoverPlaces = places
    terrain.updateEconomyVisuals(places, now)
  }

  const celebrateConstruction = (placeId: string | null, now: number) => {
    if (placeId) {
      terrain.popHome(placeId, now)
      const pos = terrain.getPlaceWorldPos(placeId)
      if (pos) fx.sparkleBurst(pos.x, pos.y, pos.z)
    }
  }

  const celebrateHarvest = (placeId: string | null, now: number) => {
    void now
    if (!placeId) return
    const pos = terrain.getPlaceWorldPos(placeId)
    if (pos) fx.greenBurst(pos.x, pos.y + 0.2, pos.z)
  }

  const celebrateClose = (agentIdA: string, agentIdB: string, now: number) => {
    overlays.pushHearts(agentIdA, agentIdB, now)
  }

  const lookAt = (x: number, z: number, dist = 12) => {
    controls.target.set(x, 0.2, z)
    camera.position.set(x + dist * 0.7, dist * 0.75, z + dist * 0.7)
    controls.update()
  }

  const photoRay = new THREE.Raycaster()
  const photoFrom = new THREE.Vector3()
  const photoTo = new THREE.Vector3()
  const photoDir = new THREE.Vector3()

  const subjectOccluded = (sx: number, sy: number, sz: number, slack: number) => {
    photoFrom.copy(camera.position)
    photoTo.set(sx, sy, sz)
    photoDir.subVectors(photoTo, photoFrom)
    const len = photoDir.length()
    if (len < 0.6) return false
    photoDir.multiplyScalar(1 / len)
    photoRay.set(photoFrom, photoDir)
    photoRay.near = 0.25
    photoRay.far = Math.max(0.35, len - slack)
    const hits = photoRay.intersectObject(terrain.root, true)
    // Grass tiles sit at y≈0.2 — ignore them; only raise for trees/rock/buildings.
    return hits.some((h) => h.point.y > 0.45)
  }

  /**
   * Hero framing: subject ~1/5 of frame height, 26° elevation, right/upper
   * third. Raises elevation (26→38) if terrain occludes — deterministic.
   * If the subject is still occluded, try a fixed SE-offset azimuth list.
   */
  const frameSubject = (
    x: number,
    z: number,
    zoom = 1,
    opts?: FrameSubjectOpts,
  ) => {
    const zMul = Math.max(0.35, Math.min(2.5, zoom || 1))
    const height = Math.max(0.45, opts?.height ?? 1.05)
    // Pair span is capped so two agents on opposite plaza edges cannot
    // pull the camera back to a postcard.
    const span = Math.min(2.2, Math.max(0, opts?.span ?? 0))

    // Perspective + off-center look-at shrinks apparent size; 0.34 lands
    // near 1/5–1/4 of frame after that loss.
    const vFov = (camera.fov * Math.PI) / 180
    const halfTan = Math.tan(vFov / 2)
    let dist = height / (2 * 0.34 * halfTan)
    if (span > 0.5) {
      const aspect = Math.max(1.2, camera.aspect || 16 / 9)
      const hFov = 2 * Math.atan(halfTan * aspect)
      const spanDist = (span + 0.55) / (2 * 0.58 * Math.tan(hFov / 2))
      if (spanDist > dist) dist = spanDist
    }
    dist = Math.max(2.4, Math.min(9.5, dist / zMul))

    // SE azimuth (village-facing). Camera-right = up × view.
    const DEFAULT_AZIM = Math.atan2(0.7, 0.62)
    const lookY = Math.min(0.42, height * 0.28)

    const prevDamp = controls.enableDamping
    controls.enableDamping = false
    controls.minDistance = 2

    const BASE_ELEV = 24
    const MAX_ELEV = 36
    const slack = Math.max(0.55, height * 0.5)
    const aimY = Math.max(0.4, height * 0.55)
    const REACH_EPS = 0.22
    const GRASS_Y = 0.45

    const poseAt = (azim: number, deg: number) => {
      const rightX = Math.sin(azim)
      const rightZ = -Math.cos(azim)
      const lookX = x - rightX * dist * 0.24
      const lookZ = z - rightZ * dist * 0.24
      const elev = (deg * Math.PI) / 180
      const horiz = dist * Math.cos(elev)
      controls.target.set(lookX, lookY, lookZ)
      camera.position.set(
        lookX + horiz * Math.cos(azim),
        lookY + dist * Math.sin(elev),
        lookZ + horiz * Math.sin(azim),
      )
      camera.updateMatrixWorld()
    }

    const subjectPlaceId = opts?.placeId ?? null
    const subjectAgentSet = new Set(opts?.subjectAgentIds ?? [])
    const probes =
      opts?.probes && opts.probes.length > 0
        ? opts.probes
        : [{ x, y: aimY, z }]
    const occluders = opts?.occluderAgents
    const rivals = opts?.rivalPlaces
    const placeHero = !!subjectPlaceId

    const isPickGhost = (obj: THREE.Object3D): boolean => {
      const mesh = obj as THREE.Mesh
      const mat = mesh.material
      if (!mat || Array.isArray(mat)) return false
      const m = mat as THREE.MeshBasicMaterial
      return m.colorWrite === false || (m.transparent === true && m.opacity === 0)
    }

    const nearSubject = (hx: number, hz: number): boolean => {
      const dx = hx - x
      const dz = hz - z
      return dx * dx + dz * dz < 0.78 * 0.78
    }

    const hitIsBuilding = (h: THREE.Intersection): boolean => {
      if (terrain.placeIdFromObject(h.object)) return true
      for (const p of hoverPlaces) {
        const dx = h.point.x - p.x
        const dz = h.point.z - p.y
        if (dx * dx + dz * dz < 0.82 * 0.82) return true
      }
      return false
    }

    const probeClear = (px: number, py: number, pz: number): boolean => {
      photoFrom.copy(camera.position)
      photoTo.set(px, py, pz)
      photoDir.subVectors(photoTo, photoFrom)
      const len = photoDir.length()
      if (len < 0.6) return true
      photoDir.multiplyScalar(1 / len)
      photoRay.set(photoFrom, photoDir)
      photoRay.near = 0.25
      photoRay.far = len
      const hits = photoRay.intersectObject(terrain.root, true)
      for (const h of hits) {
        if (isPickGhost(h.object)) continue
        if (h.point.y <= GRASS_Y) continue
        const pid = terrain.placeIdFromObject(h.object)
        if (subjectPlaceId && pid === subjectPlaceId) return true
        if (placeHero && nearSubject(h.point.x, h.point.z)) return true
        if (len - h.distance <= REACH_EPS) return true
        // Buildings only — quarry cliffs / grass / low rock are not occluders.
        if (hitIsBuilding(h)) return false
      }
      return true
    }

    const rivalBlocks = (): boolean => {
      if (!rivals || rivals.length === 0) return false
      const cam = camera.position
      const subjDist = Math.hypot(cam.x - x, cam.z - z)
      const fx = x - cam.x
      const fz = z - cam.z
      const fLen = Math.hypot(fx, fz)
      if (fLen < 0.01) return false
      const inv = 1 / fLen
      const nx = fx * inv
      const nz = fz * inv
      for (const r of rivals) {
        const dx = r.x - cam.x
        const dz = r.z - cam.z
        const distR = Math.hypot(dx, dz)
        if (distR >= subjDist - 0.45) continue
        const along = dx * nx + dz * nz
        if (along < 0.6) continue
        const perp = Math.abs(dx * nz - dz * nx)
        if (perp < 1.85) return true
      }
      return false
    }

    const nearRayBlocks = (
      items: Array<{ x: number; z: number }>,
      perpMax: number,
    ): boolean => {
      const cam = camera.position
      const vx = x - cam.x
      const vz = z - cam.z
      const vlen = Math.hypot(vx, vz)
      if (vlen < 0.5) return false
      const inv2 = 1 / (vlen * vlen)
      for (const it of items) {
        const dx = it.x - cam.x
        const dz = it.z - cam.z
        const t = (dx * vx + dz * vz) * inv2
        if (t < 0.06 || t > 0.48) continue
        const px = cam.x + vx * t
        const pz = cam.z + vz * t
        const perp = Math.hypot(it.x - px, it.z - pz)
        if (perp < perpMax && t * vlen < vlen * 0.55) return true
      }
      return false
    }

    const agentsBlock = (): boolean => {
      if (!occluders || occluders.length === 0) return false
      const cam = camera.position
      const subjDist = Math.hypot(cam.x - x, cam.z - z)
      const near = occluders.filter((a) => {
        if (subjectAgentSet.has(a.id)) return false
        const d = Math.hypot(a.x - cam.x, a.z - cam.z)
        // Small subjects (sites) tolerate a longer giant cutoff; houses don't.
        const cap = height < 1.15 ? 3.15 : 2.05
        return d < cap && d < subjDist * 0.5
      })
      return nearRayBlocks(near, 1.0)
    }

    const treesBlock = (): boolean => {
      if (!placeHero) return false
      const cam = camera.position
      const vx = x - cam.x
      const vz = z - cam.z
      const vlen = Math.hypot(vx, vz)
      if (vlen < 0.5) return false
      const inv2 = 1 / (vlen * vlen)
      for (const t of terrain.getTreePositions()) {
        const dx = t.x - cam.x
        const dz = t.z - cam.z
        const tp = (dx * vx + dz * vz) * inv2
        if (tp < 0.06 || tp > 0.34) continue
        const px = cam.x + vx * tp
        const pz = cam.z + vz * tp
        if (Math.hypot(t.x - px, t.z - pz) < 0.85) return true
      }
      return false
    }

    const heroNdcs = [new THREE.Vector2(0.08, 0.04), new THREE.Vector2(0.22, 0.0)]
    const heroRayClear = (): boolean => {
      if (!placeHero) return true
      const subjDist = Math.hypot(camera.position.x - x, camera.position.z - z)
      for (const ndc of heroNdcs) {
        photoRay.setFromCamera(ndc, camera)
        photoRay.near = 0.3
        photoRay.far = Math.max(0.8, subjDist - 0.45)
        const hits = photoRay.intersectObject(terrain.root, true)
        for (const h of hits) {
          if (isPickGhost(h.object)) continue
          if (h.point.y <= 0.55) continue
          if (nearSubject(h.point.x, h.point.z)) break
          if (hitIsBuilding(h) && h.distance < subjDist - 0.75) return false
        }
      }
      return true
    }

    const evaluatePose = () => {
      let hits = 0
      let probeHits = 0
      const why: string[] = []
      probes.forEach((p, i) => {
        if (probeClear(p.x, p.y, p.z)) {
          hits += 1
          probeHits += 1
        } else why.push(`probe${i}`)
      })
      const rivalOk = !rivalBlocks()
      const agentOk = !agentsBlock()
      const treeOk = !treesBlock()
      const heroOk = heroRayClear()
      const extra =
        (rivals && rivals.length > 0 ? 1 : 0) +
        (occluders ? 1 : 0) +
        (placeHero ? 2 : 0)
      const total = probes.length + extra
      if (rivalOk && rivals && rivals.length > 0) hits += 1
      else if (rivals && rivals.length > 0) why.push('rival')
      if (agentOk && occluders) hits += 1
      else if (occluders) why.push('agent')
      if (treeOk && placeHero) hits += 1
      else if (placeHero) why.push('tree')
      if (heroOk && placeHero) hits += 1
      else if (placeHero) why.push('heroRay')
      return {
        hits,
        total,
        clear: hits === total,
        why,
        probeHits,
        probeTotal: probes.length,
      }
    }

    type PoseScore = ReturnType<typeof evaluatePose>

    const publishFrame = (
      azimuth: string,
      rescued: boolean,
      elev: number,
      scored: PoseScore,
    ) => {
      if (!import.meta.env.DEV) return
      window.__photoFrame = {
        azimuth,
        rescued,
        elevDeg: elev,
        hits: scored.hits,
        total: scored.total,
        probeHits: scored.probeHits,
        probeTotal: scored.probeTotal,
        why: scored.why ?? [],
        seWhy: seScore.why ?? [],
      }
    }

    // Default SE + existing elevation raise (unchanged pose if then clear).
    let elevDeg = BASE_ELEV
    poseAt(DEFAULT_AZIM, elevDeg)
    while (elevDeg < MAX_ELEV && subjectOccluded(x, aimY, z, slack)) {
      elevDeg += 2
      poseAt(DEFAULT_AZIM, elevDeg)
    }

    const seScore = evaluatePose()
    const canRescue =
      (opts?.probes && opts.probes.length > 0) ||
      (opts?.occluderAgents && opts.occluderAgents.length > 0) ||
      (opts?.rivalPlaces && opts.rivalPlaces.length > 0)
    // Subject already on camera (all probes) — extra checks cannot evict SE.
    const seHasSubject = seScore.probeHits === seScore.probeTotal
    if (!canRescue || seScore.clear || seHasSubject) {
      publishFrame('default', false, elevDeg, seScore)
      controls.update()
      controls.enableDamping = prevDamp
      return
    }

    // Fixed candidate list. Rescue only if subject-probe score is STRICTLY
    // greater than SE; equal or lower keeps the default pose.
    const RESCUE: Array<{ label: string; offsetDeg: number }> = [
      { label: 'SE+30', offsetDeg: 30 },
      { label: 'SE-30', offsetDeg: -30 },
      { label: 'SE+60', offsetDeg: 60 },
      { label: 'SE-60', offsetDeg: -60 },
      { label: 'SW', offsetDeg: 90 },
      { label: 'NE', offsetDeg: -90 },
      { label: 'NW', offsetDeg: 180 },
      { label: 'SE+120', offsetDeg: 120 },
      { label: 'SE-120', offsetDeg: -120 },
      { label: 'SE+150', offsetDeg: 150 },
      { label: 'SE-150', offsetDeg: -150 },
    ]

    let bestLabel = 'default'
    let bestAzim = DEFAULT_AZIM
    let bestScore = seScore
    let bestElev = elevDeg

    for (const cand of RESCUE) {
      const azim = DEFAULT_AZIM + (cand.offsetDeg * Math.PI) / 180
      poseAt(azim, BASE_ELEV)
      const scored = evaluatePose()
      if (scored.probeHits > bestScore.probeHits) {
        bestLabel = cand.label
        bestAzim = azim
        bestScore = scored
        bestElev = BASE_ELEV
        if (scored.clear) break
      }
    }

    if (bestLabel === 'default' || bestScore.probeHits <= seScore.probeHits) {
      poseAt(DEFAULT_AZIM, elevDeg)
      publishFrame('default', false, elevDeg, seScore)
    } else {
      if (bestScore.hits < bestScore.total) {
        bestElev = Math.min(MAX_ELEV, BASE_ELEV + 8)
      }
      poseAt(bestAzim, bestElev)
      publishFrame(bestLabel, true, bestElev, bestScore)
    }

    controls.update()
    controls.enableDamping = prevDamp
  }

  const publishCameraTarget = () => {
    window.__cameraTarget = {
      x: controls.target.x,
      y: controls.target.y,
      z: controls.target.z,
    }
  }

  const bindSelection = (cb: SelectionCallbacks): (() => void) => {
    const canvas = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
      hoverDownX = e.clientX
      hoverDownY = e.clientY
      dragging = false
    }

    const onPointerMove = (e: PointerEvent) => {
      pointerClientX = e.clientX
      pointerClientY = e.clientY
      pointerOverCanvas = true
      const dx = e.clientX - hoverDownX
      const dy = e.clientY - hoverDownY
      if (e.buttons !== 0 && dx * dx + dy * dy > 25) {
        dragging = true
        overlays.setTooltip(null, 0, 0)
      }
    }

    const onPointerLeave = () => {
      pointerOverCanvas = false
      overlays.setTooltip(null, 0, 0)
      hoverTarget = null
      hoverStartMs = 0
    }

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      const wasDrag = dx * dx + dy * dy > 25 || dragging
      dragging = false
      if (wasDrag) return // drag — ignore (>5px)

      const rect = canvas.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)

      // Agents win over places
      const agentHits = raycaster.intersectObjects(agents.getPickables(), true)
      if (agentHits.length > 0) {
        const id = agents.agentIdFromObject(agentHits[0]!.object)
        if (id) {
          cb.onSelectAgent(id)
          return
        }
      }

      const placeHits = raycaster.intersectObjects(terrain.getPlacePickables(), true)
      if (placeHits.length > 0) {
        const id = terrain.placeIdFromObject(placeHits[0]!.object)
        if (id) {
          cb.onSelectPlace(id)
          return
        }
      }

      // Empty click clears both
      cb.onSelectAgent(null)
      cb.onSelectPlace(null)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }

  const resize = (w: number, h: number) => {
    const width = Math.max(1, w)
    const height = Math.max(1, h)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height)
  }

  const render = () => {
    controls.update()
    renderer.render(scene, camera)
    publishCameraTarget()
  }

  const dispose = () => {
    controls.dispose()
    terrain.dispose()
    dayNight.dispose()
    agents.dispose()
    overlays.dispose()
    fx.dispose()
    renderer.dispose()
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  // Initial day time (tick 0 = 06:00)
  setTime({ day: 1, hour: 6, minute: 0, tick: 0 })

  // DEV-gated camera helpers for e2e juice screenshots
  if (import.meta.env.DEV) {
    window.__renderLookAt = lookAt
    window.__placePos = (placeId: string) => terrain.getPlaceWorldPos(placeId)
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    terrain,
    dayNight,
    agents,
    overlays,
    fx,
    setTime,
    updateAgents,
    bindSelection,
    followAgent,
    updateOverlays,
    updateBushStock,
    updateEconomyVisuals,
    celebrateConstruction,
    celebrateHarvest,
    celebrateClose,
    lookAt,
    frameSubject,
    resize,
    dispose,
    render,
    publishCameraTarget,
    getPlaceWorldPos: (placeId: string) => terrain.getPlaceWorldPos(placeId),
  }
}

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { AgentState, WorldState } from '../sim/types'
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
  resize: (w: number, h: number) => void
  dispose: () => void
  render: () => void
  /** Publish camera target for e2e / debug. */
  publishCameraTarget: () => void
}

declare global {
  interface Window {
    __cameraTarget?: { x: number; y: number; z: number }
    __renderProbe?: { hats: number; tools: number; particles: number }
    /** DEV/e2e: aim orbit camera at world xz. */
    __renderLookAt?: (x: number, z: number, dist?: number) => void
    /** DEV/e2e: world pos of a place mesh. */
    __placePos?: (placeId: string) => { x: number; y: number; z: number } | null
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
  controls.minDistance = 8
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
    now = performance.now(),
  ) => {
    hoverAgents = list
    hoverPlaces = places
    agents.update(
      list,
      prev,
      alpha,
      selectedId,
      selectedPlaceId,
      places,
      now,
      fx,
      treePositions,
      (tx, tz, tNow) => terrain.shakeTreeAt(tx, tz, tNow),
    )
    fx.update(now)
    // DEV-gated render probe for e2e (vite dev / e2e webServer)
    if (import.meta.env.DEV) {
      const juice = agents.getJuiceCounts()
      window.__renderProbe = {
        hats: juice.hats,
        tools: juice.tools,
        particles: fx.activeCount(),
      }
    }
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
    resize,
    dispose,
    render,
    publishCameraTarget,
  }
}

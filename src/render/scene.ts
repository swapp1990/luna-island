import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { AgentState, WorldState } from '../sim/types'
import { buildTerrain, type TerrainHandle } from './terrain'
import { createDayNight, type DayNightHandle } from './daynight'
import { createAgents, type AgentsHandle } from './agents'
import type { SimTime } from '../sim/types'

export interface SceneHandle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  terrain: TerrainHandle
  dayNight: DayNightHandle
  agents: AgentsHandle
  setTime: (time: SimTime) => void
  updateAgents: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
  ) => void
  /** Wire click-to-select; returns cleanup. */
  bindSelection: (onSelect: (id: string | null) => void) => () => void
  resize: (w: number, h: number) => void
  dispose: () => void
  render: () => void
}

export function createScene(container: HTMLElement, world: WorldState): SceneHandle {
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

  const setTime = (time: SimTime) => {
    dayNight.update(time)
  }

  const updateAgents = (
    list: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
  ) => {
    agents.update(list, prev, alpha, selectedId)
  }

  const bindSelection = (onSelect: (id: string | null) => void): (() => void) => {
    const canvas = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downX = 0
    let downY = 0

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
    }

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      if (dx * dx + dy * dy > 25) return // drag — ignore (>5px)

      const rect = canvas.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)

      const hits = raycaster.intersectObjects(agents.getPickables(), true)
      if (hits.length > 0) {
        const id = agents.agentIdFromObject(hits[0]!.object)
        onSelect(id)
      } else {
        onSelect(null)
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
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
  }

  const dispose = () => {
    controls.dispose()
    terrain.dispose()
    dayNight.dispose()
    agents.dispose()
    renderer.dispose()
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement)
    }
  }

  // Initial day time (tick 0 = 06:00)
  setTime({ day: 1, hour: 6, minute: 0, tick: 0 })

  return {
    renderer,
    scene,
    camera,
    controls,
    terrain,
    dayNight,
    agents,
    setTime,
    updateAgents,
    bindSelection,
    resize,
    dispose,
    render,
  }
}

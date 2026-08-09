import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { WorldState } from '../sim/types'
import { buildTerrain, type TerrainHandle } from './terrain'
import { createDayNight, type DayNightHandle } from './daynight'
import type { SimTime } from '../sim/types'

export interface SceneHandle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  terrain: TerrainHandle
  dayNight: DayNightHandle
  setTime: (time: SimTime) => void
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

  const islandCenterX = world.width / 2
  const islandCenterZ = world.height / 2

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    300,
  )
  camera.position.set(islandCenterX + 26, 24, islandCenterZ + 26)
  camera.lookAt(islandCenterX, 0, islandCenterZ)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(islandCenterX, 0.2, islandCenterZ)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 10
  controls.maxDistance = 90
  controls.maxPolarAngle = (80 * Math.PI) / 180
  controls.update()

  const terrain = buildTerrain(scene, world)
  const dayNight = createDayNight(scene, world)

  const setTime = (time: SimTime) => {
    dayNight.update(time)
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
    setTime,
    resize,
    dispose,
    render,
  }
}

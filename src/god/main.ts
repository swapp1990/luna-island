import * as THREE from 'three'
import { createAudio } from './audio'
import { createCamera } from './camera'
import { createDebug, writeCamera, type DebugHandle, type GodControl } from './debug'
import { createHand } from './hand'
import { createImpact } from './impact'
import { createIsland, createIslandCollider } from './island'
import { createLighting } from './lighting'
import { createPhysics, getWasmInitMs, initRapier, settleWorld } from './physics'
import { createProps } from './props'
import { BOOT_SETTLE_STEPS, type PropKind } from './constants'

const mount = document.getElementById('god-root')
if (!mount) throw new Error('missing #god-root')
const root: HTMLElement = mount

async function boot(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(root.clientWidth, root.clientHeight)
  root.appendChild(renderer.domElement)
  const canvas = renderer.domElement
  canvas.style.cursor = 'none'
  canvas.style.touchAction = 'none'

  const scene = new THREE.Scene()
  const cam = createCamera(root.clientWidth / Math.max(1, root.clientHeight))
  const island = createIsland(scene)

  await initRapier()
  const physics = createPhysics()
  createIslandCollider(physics.world, physics.R, island.data)
  const props = createProps(scene, physics.world, physics.R, island)
  props.spawnBoot()
  settleWorld(physics.world, BOOT_SETTLE_STEPS)
  props.rescueWet()
  props.snap()
  props.sleepAllSlow()

  const lighting = createLighting(renderer, scene, cam.camera, island.data)
  lighting.resize(root.clientWidth, root.clientHeight)

  const hand = createHand(scene)
  const impact = createImpact(scene)
  const audio = createAudio()

  const unbindCam = cam.bind(canvas)
  const unbindHand = hand.bind(canvas, cam.camera, island)

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (hand.onWheel(e.deltaY, e.shiftKey || cam.shift())) return
    cam.applyZoom(e.deltaY)
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const resetWorld = () => {
    hand.release()
    impact.reset()
    props.clear()
    props.spawnBoot()
    settleWorld(physics.world, BOOT_SETTLE_STEPS)
    props.rescueWet()
    props.snap()
    props.sleepAllSlow()
    hand.counters.grabs = 0
    hand.counters.throws = 0
    cam.setState({ yaw: 38, pitch: 48, dist: 42, tx: 4, tz: -8 })
  }

  let debug!: DebugHandle
  const flush = () => {
    debug.state.hand = hand.getState()
    writeCamera(debug.state, cam.getState())
    debug.state.propCount = props.list().length
    debug.state.awakeCount = props.awakeCount()
    debug.state.counters.grabs = hand.counters.grabs
    debug.state.counters.throws = hand.counters.throws
    debug.state.counters.impacts = impact.counters.impacts
    debug.state.counters.splashes = impact.counters.splashes
  }

  const control: GodControl = {
    setCamera: (o) => {
      cam.setState(o)
      flush()
    },
    moveHandTo: (x, z, lift) => {
      hand.moveTo(x, z, lift)
      flush()
    },
    grabNearest: (kind) => {
      const id = hand.grabNearest(kind)
      flush()
      return id
    },
    release: () => {
      hand.release()
      flush()
    },
    throwTo: (x, z, power) => {
      hand.throwTo(x, z, power)
      flush()
    },
    throwWithHandVelocity: (vx, vy, vz) => {
      const r = hand.throwWithHandVelocity(vx, vy, vz)
      flush()
      return r
    },
    spawnProps: (n, kind) => {
      props.spawnMany(n, kind as PropKind | undefined)
      flush()
    },
    stress: (n) => {
      props.stress(n)
      flush()
    },
    reset: () => {
      resetWorld()
      flush()
    },
    showRefSpheres: (on) => lighting.showRefSpheres(on),
    fpsProbe: (ms) => debug.fpsProbe(ms),
    listProps: () =>
      props.list().map((p) => ({
        id: p.id,
        kind: p.kind,
        x: p.currPos.x,
        y: p.currPos.y,
        z: p.currPos.z,
        mass: p.mass,
      })),
    setHandPose: (t) => {
      hand.setHandPose(t)
    },
  }

  debug = createDebug(control, getWasmInitMs())
  control.fpsProbe = (ms) => debug.fpsProbe(ms)

  let last = performance.now()
  let now = 0
  let raf = 0
  let prevGrabs = 0
  let prevImpacts = 0
  let prevSplashes = 0
  let first = true

  const onResize = () => {
    const w = root.clientWidth
    const h = Math.max(1, root.clientHeight)
    renderer.setSize(w, h)
    cam.camera.aspect = w / h
    cam.camera.updateProjectionMatrix()
    lighting.resize(w, h)
  }
  window.addEventListener('resize', onResize)

  const frame = (t: number) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.08, (t - last) / 1000)
    last = t
    now += dt

    hand.update(dt, now, island, props, cam.camera, cam.getState())
    cam.frameGrip(hand.framePoint())
    cam.update(dt)

    const alpha = physics.step(dt, () => {
      props.storePrev()
      hand.applyCarry()
      props.sleepResting(hand.holding()?.id ?? null)
    })
    impact.drain(physics.events, physics.world, props)
    impact.checkWater(props, island, dt)
    props.syncBodies()
    props.interpolate(alpha)
    impact.update(dt)

    if (hand.counters.grabs > prevGrabs) audio.grab()
    if (impact.counters.impacts > prevImpacts) audio.thud(180)
    if (impact.counters.splashes > prevSplashes) audio.splash(220)
    prevGrabs = hand.counters.grabs
    prevImpacts = impact.counters.impacts
    prevSplashes = impact.counters.splashes

    const rt0 = performance.now()
    lighting.render()
    const renderMs = performance.now() - rt0

    const hs = hand.getState()
    debug.state.hand = hs
    writeCamera(debug.state, cam.getState())
    debug.state.propCount = props.list().length
    debug.state.awakeCount = props.awakeCount()
    debug.state.counters.grabs = hand.counters.grabs
    debug.state.counters.throws = hand.counters.throws
    debug.state.counters.impacts = impact.counters.impacts
    debug.state.counters.splashes = impact.counters.splashes
    debug.noteFrame(dt, physics.stepMs, renderMs)
    if (first) {
      debug.state.ready = true
      first = false
    }
  }
  raf = requestAnimationFrame(frame)

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    canvas.removeEventListener('wheel', onWheel)
    unbindCam()
    unbindHand()
    audio.dispose()
    debug.dispose()
    impact.dispose()
    hand.dispose()
    props.dispose()
    lighting.dispose()
    island.dispose()
    physics.dispose()
    renderer.dispose()
    canvas.remove()
  })
}

void boot()

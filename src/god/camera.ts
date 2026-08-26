import * as THREE from 'three'
import {
  CAMERA_DAMP,
  CAMERA_FAR,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_ORBIT_SENS,
  CAMERA_PAN_SENS,
  CAMERA_TARGET_Y,
  CAMERA_WASD_SPEED,
  CAMERA_ZOOM_STEP,
} from './constants'
import {
  clampCamera,
  clampDist,
  dampCamera,
  yieldCameraToGrip,
  type CameraPose,
} from './feel'

export interface CameraHandle {
  camera: THREE.PerspectiveCamera
  getState: () => CameraPose
  setState: (o: Partial<CameraPose>) => void
  shift: () => boolean
  /** True while right-drag orbiting — left button never sets this. */
  orbiting: () => boolean
  applyZoom: (deltaY: number) => void
  /** Keep the hand bounds framed — camera yields dist/pitch, never the legal band. */
  frameGrip: (grip: { x: number; y: number; z: number } | null) => void
  update: (dt: number) => void
  bind: (el: HTMLElement) => () => void
  dispose: () => void
}

export function createCamera(aspect: number): CameraHandle {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR)
  const target: CameraPose = clampCamera({
    yaw: 38,
    pitch: 48,
    dist: 42,
    tx: 4,
    tz: -8,
  })
  const current: CameraPose = { ...target }

  const keys = { f: false, b: false, l: false, r: false }
  let shift = false
  let orbiting = false
  let panning = false
  let lastX = 0
  let lastY = 0
  let orbitPointer = -1
  let panPointer = -1
  let grip: { x: number; y: number; z: number } | null = null

  const applyPose = (pose: CameraPose) => {
    const pitch = THREE.MathUtils.degToRad(pose.pitch)
    const yaw = THREE.MathUtils.degToRad(pose.yaw)
    const horiz = pose.dist * Math.cos(pitch)
    camera.position.set(
      pose.tx + Math.sin(yaw) * horiz,
      CAMERA_TARGET_Y + pose.dist * Math.sin(pitch),
      pose.tz + Math.cos(yaw) * horiz,
    )
    camera.lookAt(pose.tx, CAMERA_TARGET_Y, pose.tz)
  }
  applyPose(current)

  const applyZoom = (deltaY: number) => {
    const factor = Math.exp(Math.sign(deltaY) * CAMERA_ZOOM_STEP)
    target.dist = clampDist(target.dist * factor)
  }

  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = down
    if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.f = down
    if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.b = down
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.l = down
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.r = down
  }

  const bind = (el: HTMLElement): (() => void) => {
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        orbiting = true
        orbitPointer = e.pointerId
        lastX = e.clientX
        lastY = e.clientY
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
      } else if (e.button === 1) {
        panning = true
        panPointer = e.pointerId
        lastX = e.clientX
        lastY = e.clientY
        el.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    }
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (orbiting && e.pointerId === orbitPointer) {
        target.yaw += dx * CAMERA_ORBIT_SENS
        target.pitch += dy * CAMERA_ORBIT_SENS
        Object.assign(target, clampCamera(target))
        lastX = e.clientX
        lastY = e.clientY
      } else if (panning && e.pointerId === panPointer) {
        const yaw = THREE.MathUtils.degToRad(current.yaw)
        const scale = current.dist * CAMERA_PAN_SENS
        const rightX = Math.cos(yaw)
        const rightZ = -Math.sin(yaw)
        const fwdX = -Math.sin(yaw)
        const fwdZ = -Math.cos(yaw)
        target.tx += (-dx * rightX + dy * fwdX) * scale
        target.tz += (-dx * rightZ + dy * fwdZ) * scale
        Object.assign(target, clampCamera(target))
        lastX = e.clientX
        lastY = e.clientY
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === orbitPointer) {
        orbiting = false
        orbitPointer = -1
      }
      if (e.pointerId === panPointer) {
        panning = false
        panPointer = -1
      }
    }
    const onContext = (e: Event) => e.preventDefault()
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true)
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }

  const update = (dt: number) => {
    if (keys.f || keys.b || keys.l || keys.r) {
      const yaw = THREE.MathUtils.degToRad(current.yaw)
      const fwdX = -Math.sin(yaw)
      const fwdZ = -Math.cos(yaw)
      const rightX = Math.cos(yaw)
      const rightZ = -Math.sin(yaw)
      let mx = 0
      let mz = 0
      if (keys.f) {
        mx += fwdX
        mz += fwdZ
      }
      if (keys.b) {
        mx -= fwdX
        mz -= fwdZ
      }
      if (keys.l) {
        mx -= rightX
        mz -= rightZ
      }
      if (keys.r) {
        mx += rightX
        mz += rightZ
      }
      const len = Math.hypot(mx, mz) || 1
      const speed = CAMERA_WASD_SPEED * current.dist * dt
      target.tx += (mx / len) * speed
      target.tz += (mz / len) * speed
      Object.assign(target, clampCamera(target))
    }
    const aimed = grip
      ? yieldCameraToGrip(target, grip, Math.max(1e-6, camera.aspect))
      : target
    const damped = dampCamera(current, aimed, CAMERA_DAMP, dt)
    current.yaw = damped.yaw
    current.pitch = damped.pitch
    current.dist = damped.dist
    current.tx = damped.tx
    current.tz = damped.tz
    applyPose(current)
  }

  return {
    camera,
    getState: () => ({ ...current }),
    setState: (o) => {
      if (o.yaw !== undefined) target.yaw = o.yaw
      if (o.pitch !== undefined) target.pitch = o.pitch
      if (o.dist !== undefined) target.dist = o.dist
      if (o.tx !== undefined) target.tx = o.tx
      if (o.tz !== undefined) target.tz = o.tz
      Object.assign(target, clampCamera(target))
      current.yaw = target.yaw
      current.pitch = target.pitch
      current.dist = target.dist
      current.tx = target.tx
      current.tz = target.tz
      applyPose(current)
    },
    shift: () => shift,
    orbiting: () => orbiting,
    applyZoom,
    frameGrip: (next) => {
      grip = next
    },
    update,
    bind,
    dispose: () => {
      /* camera has no GPU resources of its own */
    },
  }
}

import * as THREE from 'three'

/**
 * V5 completion flourish: a cheap expanding, fading dust puff so a finished
 * building is noticeable. Purely cosmetic (wall-clock driven), not part of
 * sim state — the sim doesn't know this exists.
 */
export interface CompletionFxHandle {
  root: THREE.Group
  spawnDustPuff: (x: number, y: number, z: number) => void
  update: (nowMs: number) => void
  dispose: () => void
}

const DURATION_MS = 850
const START_SCALE = 0.3
const END_SCALE = 3.2

interface Puff {
  mesh: THREE.Mesh
  start: number
}

export function createCompletionFx(scene: THREE.Scene): CompletionFxHandle {
  const root = new THREE.Group()
  root.name = 'completion-fx'
  scene.add(root)

  const geo = new THREE.SphereGeometry(1, 10, 8)
  const active: Puff[] = []

  return {
    root,
    spawnDustPuff: (x, y, z) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd8c9a8,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y + 0.5, z)
      mesh.scale.setScalar(START_SCALE)
      root.add(mesh)
      active.push({ mesh, start: performance.now() })
    },
    update: (now) => {
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i]!
        const t = (now - p.start) / DURATION_MS
        if (t >= 1) {
          root.remove(p.mesh)
          ;(p.mesh.material as THREE.Material).dispose()
          active.splice(i, 1)
          continue
        }
        p.mesh.scale.setScalar(START_SCALE + (END_SCALE - START_SCALE) * t)
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t)
      }
    },
    dispose: () => {
      for (const p of active) {
        root.remove(p.mesh)
        ;(p.mesh.material as THREE.Material).dispose()
      }
      active.length = 0
      geo.dispose()
      scene.remove(root)
    },
  }
}

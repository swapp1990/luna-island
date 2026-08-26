import RAPIER from '@dimforge/rapier3d-compat'
import { GRAVITY_Y, PHYSICS_DT, PHYSICS_MAX_STEPS } from './constants'

export interface PhysicsHandle {
  world: RAPIER.World
  events: RAPIER.EventQueue
  R: typeof RAPIER
  /** Interpolation alpha in [0, 1) after the last stepped frame. */
  alpha: number
  stepMs: number
  /**
   * Advance the world by a fixed 1/60 with an accumulator. `onStep` runs
   * once per physics tick, before `world.step`.
   */
  step: (dt: number, onStep: () => void) => number
  dispose: () => void
}

let wasmInitMs = -1

export async function initRapier(): Promise<number> {
  const t0 = performance.now()
  await RAPIER.init()
  wasmInitMs = performance.now() - t0
  return wasmInitMs
}

export function getWasmInitMs(): number {
  return wasmInitMs
}

export function settleWorld(world: RAPIER.World, steps: number): void {
  for (let i = 0; i < steps; i++) world.step()
}

export function createPhysics(): PhysicsHandle {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 })
  world.timestep = PHYSICS_DT
  world.lengthUnit = 1
  // Slightly more slop so faceted hulls on a heightfield don't chatter forever.
  world.integrationParameters.normalizedAllowedLinearError = 0.0024
  const events = new RAPIER.EventQueue(true)
  let acc = 0
  let alpha = 0
  let stepMs = 0

  const step = (dt: number, onStep: () => void): number => {
    acc += dt
    const cap = PHYSICS_DT * PHYSICS_MAX_STEPS
    if (acc > cap) acc = cap
    const t0 = performance.now()
    while (acc >= PHYSICS_DT) {
      onStep()
      world.step(events)
      acc -= PHYSICS_DT
    }
    stepMs = performance.now() - t0
    alpha = acc / PHYSICS_DT
    return alpha
  }

  return {
    world,
    events,
    R: RAPIER,
    get alpha() {
      return alpha
    },
    get stepMs() {
      return stepMs
    },
    step,
    dispose: () => {
      events.free()
      world.free()
    },
  }
}

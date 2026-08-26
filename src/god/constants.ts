/**
 * God-game greybox constants. Metres are the render/physics unit.
 *
 * 1 tile = 3 metres. The sim's 3×3 building footprint at this scale is a 9 m
 * house, matching the manor-slice bible's 6×9 m almost exactly. Every later
 * visual decision (camera band, hand lift, prop size, lighting radii) is
 * authored in metres against this number.
 */

/** Metres per sim tile. Do not change without re-authoring the island. */
export const TILE_METRES = 3

/** Island extent in tiles along one side. */
export const ISLAND_TILES = 30

/** Island extent in metres (~90 m). */
export const ISLAND_METRES = ISLAND_TILES * TILE_METRES

export const ISLAND_HALF = ISLAND_METRES / 2

/** Vertices on one side of the heightfield (cells = n - 1). */
export const HEIGHTFIELD_VERTS = 97

export const ISLAND_SEED = 1

/** Meadow plateau — props gather here; cairns live here. */
export const MEADOW = {
  x: 4,
  z: -16,
  radius: 11,
  height: 3.35,
} as const

/** Taller hill. */
export const HILL_A = { x: -14, z: 10, height: 11, sigma: 7.6 } as const

/** Shorter, broader hill. */
export const HILL_B = { x: 18, z: -8, height: 6.4, sigma: 9.2 } as const

export const DOME_RADIUS = 38
export const DOME_HEIGHT = 4.15
export const BEACH_START = 36
export const BEACH_END = 44.2
export const SEA_DEPTH = -1.15

export const PHYSICS_DT = 1 / 60
export const PHYSICS_MAX_STEPS = 5
export const GRAVITY_Y = -9.81
/**
 * Headless physics steps after boot spawn, before the first frame. Lets
 * stacked cairns and hull-facet rocks find rest so the player never watches
 * the island empty itself.
 */
export const BOOT_SETTLE_STEPS = 240
/**
 * Max rise/run for boot placement (~6.8°). Icosahedron hulls rest on a facet
 * on this grade; anything steeper drains to the sea. Meadow core and dome
 * flats pass; hill faces do not.
 */
export const BOOT_MAX_SLOPE = 0.12
/** Keep boot props out of the beach / surf. */
export const BOOT_MIN_HEIGHT = 2.05
/** Extra metres of XZ clearance between boot props, on top of both radii. */
export const BOOT_CLEARANCE = 0.55

export const CAMERA_FOV = 45
export const CAMERA_NEAR = 0.25
export const CAMERA_FAR = 4000
export const CAMERA_PITCH_MIN_DEG = 35
export const CAMERA_PITCH_MAX_DEG = 62
export const CAMERA_DIST_MIN = 15
export const CAMERA_DIST_MAX = 80
export const CAMERA_PAN_MARGIN = 15
export const CAMERA_DAMP = 11.5
export const CAMERA_TARGET_Y = 1.15
export const CAMERA_ORBIT_SENS = 0.22
export const CAMERA_PAN_SENS = 0.0018
export const CAMERA_WASD_SPEED = 0.55
export const CAMERA_ZOOM_STEP = 0.12
/** NDC inset the hand bounds must stay inside. 0.08 ≈ 4% of the frame on each side. */
export const VIEW_MARGIN = 0.08

/** Idle hover height of the palm above terrain. */
export const HAND_HOVER_HEIGHT = 1.15
export const HAND_LIFT_MIN = 0.5
export const HAND_LIFT_MAX = 14
/**
 * Distance-compensated hand scale: `clamp(camDist / HAND_SCALE_DIST, 1, HAND_SCALE_MAX)`.
 * Feel-side containment uses the same numbers as the mesh.
 */
export const HAND_SCALE_DIST = 16
export const HAND_SCALE_MAX = 2.5
/** Grip marker in the hand's local space (matches `hand.ts` gripLocal.y). */
export const HAND_GRIP_LOCAL_Y = 0.42
/**
 * Unscaled local +Y of the highest hand-mesh vertex (closed fingertips ~1.18).
 * Containment projects group origin + HAND_MESH_TOP * scale + held radius.
 */
export const HAND_MESH_TOP = 1.22
/** Metres of lift per unit of wheel `deltaY` (scroll up is negative). */
export const HAND_LIFT_PER_DELTA = -0.01
export const HAND_GRAB_RADIUS = 2.8
export const HAND_HOVER_HYSTERESIS = 0.5
/** Critically-damped grab spring frequency (rad/s). */
export const GRAB_OMEGA = 13
/**
 * God-hand force cap in Newtons. Uncapped spring accel is mass-independent;
 * this cap is what makes a boulder lag and sag while a pebble snaps.
 */
export const HAND_FORCE_MAX = 1150
export const HELD_ANGULAR_DAMPING = 4.8
export const FREE_ANGULAR_DAMPING = 0.7
export const FREE_LINEAR_DAMPING = 0.22
export const THROW_HISTORY_S = 0.12
/**
 * Transfer at mass 1. `v_release = v_hand * clamp(THROW_TRANSFER / mass^EXP, MIN, MAX)`.
 *
 * 1/m pinned pebble at the ceiling and log/snag/boulder at the floor — three
 * of six kinds threw identically. m^-0.5 with a wider band keeps every kind
 * in-band and strictly decreasing: pebble flicks, boulder heaves.
 */
export const THROW_TRANSFER = 1.0
export const THROW_MASS_EXP = 0.5
export const THROW_MIN_TRANSFER = 0.12
export const THROW_MAX_TRANSFER = 2.05
/** Hand speed below this (m/s) is a drop, not a weak throw. */
export const THROW_DROP_SPEED = 1.55
export const THROW_SPIN = 0.55

export type PropKind = 'pebble' | 'rock' | 'boulder' | 'log' | 'cairn' | 'snag'

export interface PropDef {
  kind: PropKind
  mass: number
  /** Visual / collider characteristic size in metres. */
  size: number
  friction: number
  restitution: number
}

/**
 * Mass table. Feel notes live next to each row so later tuners don't have to
 * reverse-engineer why a boulder is 30 kg and not 50.
 */
export const PROP_DEFS: Record<PropKind, PropDef> = {
  pebble: { kind: 'pebble', mass: 0.3, size: 0.22, friction: 0.55, restitution: 0.38 },
  rock: { kind: 'rock', mass: 3, size: 0.6, friction: 0.72, restitution: 0.22 },
  boulder: { kind: 'boulder', mass: 30, size: 1.6, friction: 0.82, restitution: 0.08 },
  log: { kind: 'log', mass: 8, size: 2.5, friction: 0.48, restitution: 0.14 },
  cairn: { kind: 'cairn', mass: 2, size: 0.5, friction: 0.78, restitution: 0.05 },
  snag: { kind: 'snag', mass: 12, size: 4.4, friction: 0.7, restitution: 0.04 },
}

export const BOOT_COUNTS: Record<PropKind, number> = {
  pebble: 16,
  rock: 14,
  boulder: 6,
  log: 8,
  cairn: 12, // 3 stacks × 4 stones
  snag: 4,
}

export const IMPACT_FORCE_MIN = 55
/** Normal-component of relative contact speed (m/s). Sliding/rolling is ignored. */
export const IMPACT_NORMAL_SPEED = 1.15
export const DENT_FORCE_MIN = 420
export const DENT_MAX = 40
/** Don't stack dent decals closer than this (metres) — stops a recycled smear. */
export const DENT_MIN_SPACING = 1.6
export const DUST_LIFE = 0.7
export const SPLASH_SINK_S = 2.0
export const WATER_Y = 0
/** Resting bodies slower than this for SLEEP_STILL_TICKS are put to sleep. */
export const SLEEP_LINVEL = 0.22
export const SLEEP_ANGVEL = 0.4
export const SLEEP_STILL_TICKS = 10
/** Extra damping once a free body has slowed below this (stops creep-rolls). */
export const REST_DAMP_SPEED = 0.5

export const GREY = 0x8a8a8a
export const GREY_HAND = 0xb7b7b7
export const GREY_PROP = 0x7c7c7c
export const SEA_COLOR = 0x7a828c
/** Calibration spheres — 1 m, off the meadow so the boot hand doesn't sit on them. */
export const REF_SPHERE_RADIUS = 1
export const REF_SPHERE = { x: 14.5, z: -6.5 } as const

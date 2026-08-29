/**
 * Town-shell constants. Metres are the render unit.
 *
 * 1 tile = 3 m. The sim island is 48×48 tiles (worldgen WIDTH/HEIGHT) → 144 m.
 * Camera / lighting bands are sized to that extent; the god greybox was 90 m.
 */

/** Same seed the main app boots (`src/App.tsx` DEFAULT_SEED). */
export const TOWN_SEED = 42

/**
 * Main app calls `new Simulation(DEFAULT_SEED)` with no preset argument, which
 * `resolveWorldPreset` maps to `'default'`.
 */
export const TOWN_PRESET = 'default' as const

/** Metres per sim tile. Do not change without re-authoring buildings. */
export const TILE_METRES = 3

/** Sim island side in tiles — matches `worldgen.ts` WIDTH/HEIGHT. */
export const ISLAND_TILES = 48

/** Island extent in metres (48 × 3 = 144). */
export const ISLAND_METRES = ISLAND_TILES * TILE_METRES

export const ISLAND_HALF = ISLAND_METRES / 2

export const CAMERA_FOV = 45
export const CAMERA_NEAR = 0.25
export const CAMERA_FAR = 4000
export const CAMERA_PITCH_MIN_DEG = 35
export const CAMERA_PITCH_MAX_DEG = 62
/**
 * Dist band for a 144 m island (god used 15–80 on a 90 m island).
 * Min still inspects a 9 m house; max frames the whole island + water margin.
 */
export const CAMERA_DIST_MIN = 18
export const CAMERA_DIST_MAX = 150
export const CAMERA_PAN_MARGIN = 18
export const CAMERA_DAMP = 11.5
export const CAMERA_TARGET_Y = 1.15
export const CAMERA_ORBIT_SENS = 0.22
export const CAMERA_PAN_SENS = 0.0018
export const CAMERA_WASD_SPEED = 0.55
export const CAMERA_ZOOM_STEP = 0.12

/** 1× = 1 sim tick per wall-clock second — matches `src/loop.ts`. */
export const TICK_HZ = 1
/** Wall-seconds credited per rAF (same 1× cap as the main loop). */
export const MAX_FRAME_DT = 1.0
export const MAX_TICKS_PER_FRAME = 8

export type TownSpeed = 0 | 1 | 2 | 4
export const TOWN_SPEEDS: readonly TownSpeed[] = [0, 1, 2, 4]

export const GREY = 0x8a8a8a
export const REF_SPHERE_RADIUS = 1
export const REF_SPHERE = { x: 16.5, z: -8 } as const

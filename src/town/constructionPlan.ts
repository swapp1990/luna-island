/**
 * Pure progress → visual-stage mapping for V5. No three.js.
 */

export type ConstructionStage = 'pad' | 'frame' | 'rising'

/** < this fraction: cleared dirt pad + material piles. */
export const STAGE_PAD_MAX = 0.35
/** < this fraction (and ≥ STAGE_PAD_MAX): timber frame. ≥ this: rising GLB. */
export const STAGE_FRAME_MAX = 0.75

/** Boundaries are inclusive on the *later* stage (progress === threshold advances). */
export function stageForProgress(progress: number): ConstructionStage {
  if (progress < STAGE_PAD_MAX) return 'pad'
  if (progress < STAGE_FRAME_MAX) return 'frame'
  return 'rising'
}

/** Vertical scale for the rising-GLB stage, remapping [STAGE_FRAME_MAX, 1] → [floor, 1]. */
const RISING_MIN_SCALE_Y = 0.12

export function risingScaleY(progress: number): number {
  const t = Math.min(1, Math.max(0, (progress - STAGE_FRAME_MAX) / (1 - STAGE_FRAME_MAX)))
  return RISING_MIN_SCALE_Y + (1 - RISING_MIN_SCALE_Y) * t
}

/**
 * 0–1 height of the clip plane for the rising stage.
 * Starts above a slab so the first glimpse is already a recognisable building.
 */
export function risingHeight01(progress: number): number {
  const t = Math.min(1, Math.max(0, (progress - STAGE_FRAME_MAX) / (1 - STAGE_FRAME_MAX)))
  return 0.28 + 0.72 * t
}

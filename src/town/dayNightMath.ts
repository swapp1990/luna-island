/**
 * Pure day/night curve for V6 — sun elevation/azimuth/intensity/color and the
 * sky/fog/ambient floor, as a continuous function of hour-of-day. No three.js
 * (colors are hex numbers), so this is directly unit-testable.
 *
 * Built from a single periodic cosine in hour — continuous by construction,
 * so there is never a jump across midnight (23.999 → 0.001 is a tiny step).
 */

/** Bible baseline: sun ~25–41° elevation, warm; this is the daytime peak. */
const PEAK_ELEVATION_DEG = 42
/** Deep-night elevation (well below horizon; only intensity/ambient matter then). */
const NIGHT_ELEVATION_DEG = -55
const ELEV_MID = (PEAK_ELEVATION_DEG + NIGHT_ELEVATION_DEG) / 2
const ELEV_AMPLITUDE = (PEAK_ELEVATION_DEG - NIGHT_ELEVATION_DEG) / 2
/** Peak sits at 13:00 (early-afternoon sun, matching the bible render). */
const PEAK_HOUR = 13

const SUN_INTENSITY_PEAK = 1.5
/** Never fully dark — moonlight-equivalent floor. */
const SUN_INTENSITY_FLOOR = 0.02

/** Kept below the sun so the low-sun warmth reads instead of washing cool-blue. */
const HEMI_INTENSITY_DAY = 0.34
const HEMI_INTENSITY_NIGHT = 0.4
const AMBIENT_INTENSITY_DAY = 0.42
/** "Never the void": night ambient never crushes to black. */
const AMBIENT_INTENSITY_NIGHT = 0.42

/**
 * The bible's rig is warm at ALL daylight hours, not just dawn/dusk — its
 * reference render was shot at a permanently-low ~25° sun. `BIBLE_WARM` is
 * that daytime floor; `DAWN_DUSK_WARM` is the extra push right at the
 * horizon, and both fade toward `NIGHT_SUN` once the sun is well below it.
 */
const BIBLE_WARM = { r: 1.0, g: 0.93, b: 0.8 } // slightly orange-white, bible daytime baseline
const DAWN_DUSK_WARM = { r: 1.0, g: 0.74, b: 0.46 } // stronger swing right at the horizon
const NIGHT_SUN = { r: 0.55, g: 0.62, b: 0.78 } // cool moon tint (barely visible)

const SKY_DAY = { r: 0.8, g: 0.82, b: 0.84 } // pale desaturated blue (bible) — kept close to neutral so it doesn't cool-cast the ground
const SKY_DUSK = { r: 0.85, g: 0.62, b: 0.46 }
const SKY_NIGHT = { r: 0.09, g: 0.13, b: 0.2 }

const FOG_DAY = { r: 0.78, g: 0.76, b: 0.72 } // horizon haze — pale warm-grey, not blue
const FOG_DUSK = { r: 0.72, g: 0.55, b: 0.45 }
const FOG_NIGHT = { r: 0.09, g: 0.14, b: 0.21 }

export interface SunParams {
  elevationDeg: number
  azimuthDeg: number
  sunIntensity: number
  sunColorHex: number
  hemiIntensity: number
  ambientIntensity: number
  skyColorHex: number
  fogColorHex: number
  /** Gameplay visibility compensation; applied on top of the artistic exposure. */
  exposureMultiplier: number
  /** 0 = full night, 1 = full day — for callers that want their own blends. */
  dayFactor: number
}

function wrapHour(h: number): number {
  const w = h % 24
  return w < 0 ? w + 24 : w
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Continuous, periodic elevation curve (cosine — no seam at 0/24). */
export function sunElevationDeg(hour: number): number {
  const h = wrapHour(hour)
  const phase = (2 * Math.PI * (h - PEAK_HOUR)) / 24
  return ELEV_MID + ELEV_AMPLITUDE * Math.cos(phase)
}

/** Sun sweeps a full turn per day — periodic by construction. */
export function sunAzimuthDeg(hour: number): number {
  const h = wrapHour(hour)
  return (h / 24) * 360 + 208 // +208 keeps the existing rig's daytime-facing azimuth
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }
}

function colorToHex(c: { r: number; g: number; b: number }): number {
  const r = Math.round(clamp01(c.r) * 255)
  const g = Math.round(clamp01(c.g) * 255)
  const b = Math.round(clamp01(c.b) * 255)
  return (r << 16) | (g << 8) | b
}

/**
 * Full lighting state for `hour` (0..24, wraps). `dayFactor` rises smoothly
 * from 0 (deep night) to 1 (full day) around the horizon, and a separate
 * `warmth` peaks at the horizon (dawn/dusk) for the low-sun orange swing.
 */
export function sunParamsForHour(hour: number): SunParams {
  const elevationDeg = sunElevationDeg(hour)
  const azimuthDeg = sunAzimuthDeg(hour)

  // Day/night blend: 0 well below horizon, 1 well above it, smoothstep between.
  // Widened so dusk/dawn (a few degrees below horizon) still reads as
  // twilight rather than jumping straight to full night.
  const dayFactor = clamp01((elevationDeg + 16) / 36)
  // Warmth peaks right at the horizon (dawn/dusk swing), fades both toward
  // midday (neutral-warm bible look) and toward deep night (cool moon tint).
  const horizonCloseness = clamp01(1 - Math.abs(elevationDeg) / 20)

  const dayColor = lerpColor(BIBLE_WARM, DAWN_DUSK_WARM, horizonCloseness)
  const sunColor = elevationDeg > -5 ? dayColor : lerpColor(dayColor, NIGHT_SUN, clamp01((-5 - elevationDeg) / 30))

  const sunIntensity = SUN_INTENSITY_FLOOR + (SUN_INTENSITY_PEAK - SUN_INTENSITY_FLOOR) * dayFactor
  const hemiIntensity = HEMI_INTENSITY_NIGHT + (HEMI_INTENSITY_DAY - HEMI_INTENSITY_NIGHT) * dayFactor
  const ambientIntensity = AMBIENT_INTENSITY_NIGHT + (AMBIENT_INTENSITY_DAY - AMBIENT_INTENSITY_NIGHT) * dayFactor
  const exposureMultiplier = 1 + (1 - dayFactor) * 0.65

  const skyDayDusk = lerpColor(SKY_DAY, SKY_DUSK, horizonCloseness)
  const sky = dayFactor > 0.5 ? skyDayDusk : lerpColor(SKY_NIGHT, skyDayDusk, clamp01(dayFactor / 0.5))

  const fogDayDusk = lerpColor(FOG_DAY, FOG_DUSK, horizonCloseness)
  const fog = dayFactor > 0.5 ? fogDayDusk : lerpColor(FOG_NIGHT, fogDayDusk, clamp01(dayFactor / 0.5))

  return {
    elevationDeg,
    azimuthDeg,
    sunIntensity,
    sunColorHex: colorToHex(sunColor),
    hemiIntensity,
    ambientIntensity,
    skyColorHex: colorToHex(sky),
    fogColorHex: colorToHex(fog),
    exposureMultiplier,
    dayFactor,
  }
}

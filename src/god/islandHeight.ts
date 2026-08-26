/**
 * Authored greybox island. Pure height samples — no three.js, no rapier.
 * Render geometry and the heightfield collider are both built from
 * `buildHeightfield()` so they share one source of truth.
 */

import {
  BEACH_END,
  BEACH_START,
  DOME_HEIGHT,
  DOME_RADIUS,
  HEIGHTFIELD_VERTS,
  HILL_A,
  HILL_B,
  ISLAND_HALF,
  ISLAND_METRES,
  ISLAND_SEED,
  MEADOW,
  SEA_DEPTH,
} from './constants'
import { valueNoise } from './rng'

export interface HeightfieldData {
  /** Rows in the heights matrix (vertex count along Z). */
  nrows: number
  /** Columns in the heights matrix (vertex count along X). */
  ncols: number
  /** Column-major heights, length nrows * ncols, metres. */
  heights: Float32Array
  /** World-space size of the field (x = width, y = 1, z = depth). */
  scaleX: number
  scaleY: number
  scaleZ: number
  cell: number
}

function gauss(dx: number, dz: number, sigma: number, height: number): number {
  const r2 = dx * dx + dz * dz
  return height * Math.exp(-r2 / (2 * sigma * sigma))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Continuous authored height at world (x, z). Used only to fill the sampled
 * field; gameplay and the collider read the field via `heightAt`.
 */
export function sampleAuthoredHeight(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const rDome = Math.min(1, r / DOME_RADIUS)
  let h = DOME_HEIGHT * Math.pow(Math.cos((Math.PI * 0.5) * rDome), 1.15)

  h += gauss(x - HILL_A.x, z - HILL_A.z, HILL_A.sigma, HILL_A.height)
  h += gauss(x - HILL_B.x, z - HILL_B.z, HILL_B.sigma, HILL_B.height)

  const md = Math.hypot(x - MEADOW.x, z - MEADOW.z)
  const meadowBlend = 1 - smoothstep(MEADOW.radius * 0.62, MEADOW.radius, md)
  h = h + (MEADOW.height - h) * meadowBlend

  const beach = smoothstep(BEACH_START, BEACH_END, r)
  h = h + (SEA_DEPTH - h) * beach

  const onMeadow = md < MEADOW.radius * 0.72
  const inWater = r > BEACH_END - 0.4
  if (!onMeadow && !inWater) {
    const n = valueNoise(x * 0.55, z * 0.55, ISLAND_SEED)
    h += (n - 0.5) * 0.22
  }

  return h
}

export function buildHeightfield(): HeightfieldData {
  const nrows = HEIGHTFIELD_VERTS
  const ncols = HEIGHTFIELD_VERTS
  const cell = ISLAND_METRES / (ncols - 1)
  const heights = new Float32Array(nrows * ncols)
  for (let col = 0; col < ncols; col++) {
    const x = -ISLAND_HALF + col * cell
    for (let row = 0; row < nrows; row++) {
      const z = -ISLAND_HALF + row * cell
      heights[col * nrows + row] = sampleAuthoredHeight(x, z)
    }
  }
  return {
    nrows,
    ncols,
    heights,
    scaleX: ISLAND_METRES,
    scaleY: 1,
    scaleZ: ISLAND_METRES,
    cell,
  }
}

function bilinear(data: HeightfieldData, x: number, z: number): number {
  const u = (x + ISLAND_HALF) / data.cell
  const v = (z + ISLAND_HALF) / data.cell
  const col = Math.floor(u)
  const row = Math.floor(v)
  if (col < 0 || row < 0 || col >= data.ncols - 1 || row >= data.nrows - 1) {
    return SEA_DEPTH
  }
  const fu = u - col
  const fv = v - row
  const i00 = col * data.nrows + row
  const i10 = (col + 1) * data.nrows + row
  const h00 = data.heights[i00]!
  const h10 = data.heights[i10]!
  const h01 = data.heights[i00 + 1]!
  const h11 = data.heights[i10 + 1]!
  return h00 * (1 - fu) * (1 - fv) + h10 * fu * (1 - fv) + h01 * (1 - fu) * fv + h11 * fu * fv
}

/** World-space height from the sampled field (same data as render + collider). */
export function heightAt(data: HeightfieldData, x: number, z: number): number {
  return bilinear(data, x, z)
}

export function normalAt(
  data: HeightfieldData,
  x: number,
  z: number,
): { x: number; y: number; z: number } {
  const e = data.cell
  const hx = heightAt(data, x + e, z) - heightAt(data, x - e, z)
  const hz = heightAt(data, x, z + e) - heightAt(data, x, z - e)
  const nx = -hx / (2 * e)
  const ny = 1
  const nz = -hz / (2 * e)
  const len = Math.hypot(nx, ny, nz) || 1
  return { x: nx / len, y: ny / len, z: nz / len }
}

/**
 * Smooth lighting normal from the authored height function, not the sampled
 * grid. Using this as the mesh normal kills the repeating-facet banding on
 * hill slopes without raising collider resolution.
 */
export function authoredNormalAt(x: number, z: number): { x: number; y: number; z: number } {
  const e = 0.32
  const hx = sampleAuthoredHeight(x + e, z) - sampleAuthoredHeight(x - e, z)
  const hz = sampleAuthoredHeight(x, z + e) - sampleAuthoredHeight(x, z - e)
  const nx = -hx / (2 * e)
  const ny = 1
  const nz = -hz / (2 * e)
  const len = Math.hypot(nx, ny, nz) || 1
  return { x: nx / len, y: ny / len, z: nz / len }
}

/** Rise/run of the authored surface. 0 = flat, 1 ≈ 45°. */
export function slopeGradient(x: number, z: number): number {
  const n = authoredNormalAt(x, z)
  return Math.hypot(n.x, n.z) / Math.max(n.y, 1e-6)
}

export function meadowFlatness(data: HeightfieldData, samples = 48): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  const r = MEADOW.radius * 0.55
  for (let i = 0; i < samples; i++) {
    const ang = (i / samples) * Math.PI * 2
    const rad = r * ((i % 3) / 3)
    const x = MEADOW.x + Math.cos(ang) * rad
    const z = MEADOW.z + Math.sin(ang) * rad
    const h = heightAt(data, x, z)
    if (h < min) min = h
    if (h > max) max = h
  }
  return { min, max }
}

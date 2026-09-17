import { createRng } from '../../sim/rng'
import type { Vec2 } from '../sim/types'

export const PAPER = '#f7f5f0'
export const INK = '#161616'
export const HATCH_GREY = '#8c8880'
export const NIGHT_PAPER = '#ded9cf'

/** Cached hand-drawn paths. Cleared on resize; never rebuilt per frame. */
export const inkPathCache = new Map<string, Path2D>()

export function clearInkCache(): void {
  inkPathCache.clear()
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function cachedPath(key: string, build: () => Path2D): Path2D {
  const hit = inkPathCache.get(key)
  if (hit) return hit
  const path = build()
  inkPathCache.set(key, path)
  return path
}

/** Stable polyline for a segment. Same seed+shapeId ⇒ identical points. */
export function wobblePolyline(
  worldSeed: number,
  shapeId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments = 3,
  amplitude = 0.6,
): Vec2[] {
  const rng = createRng(worldSeed ^ hashId(shapeId))
  const pts: Vec2[] = [{ x: x1, y: y1 }]
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  for (let i = 1; i < segments; i++) {
    const t = i / segments
    const jitter = (rng.next() * 2 - 1) * amplitude
    pts.push({
      x: x1 + dx * t + nx * jitter,
      y: y1 + dy * t + ny * jitter,
    })
  }
  pts.push({ x: x2, y: y2 })
  return pts
}

function polylineToPath(pts: Vec2[]): Path2D {
  const path = new Path2D()
  const first = pts[0]
  if (!first) return path
  path.moveTo(first.x, first.y)
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]!.x, pts[i]!.y)
  return path
}

export function wobblyLine(
  worldSeed: number,
  shapeId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments = 3,
): Path2D {
  const key = `line:${shapeId}:${x1},${y1},${x2},${y2},${segments}`
  return cachedPath(key, () =>
    polylineToPath(wobblePolyline(worldSeed, shapeId, x1, y1, x2, y2, segments)),
  )
}

export function wobblyRect(
  worldSeed: number,
  shapeId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Path2D {
  const key = `rect:${shapeId}:${x},${y},${w},${h}`
  return cachedPath(key, () => {
    const path = new Path2D()
    const edges: Array<[number, number, number, number, string]> = [
      [x, y, x + w, y, `${shapeId}-n`],
      [x + w, y, x + w, y + h, `${shapeId}-e`],
      [x + w, y + h, x, y + h, `${shapeId}-s`],
      [x, y + h, x, y, `${shapeId}-w`],
    ]
    for (const [x1, y1, x2, y2, id] of edges) {
      const pts = wobblePolyline(worldSeed, id, x1, y1, x2, y2, 3)
      path.moveTo(pts[0]!.x, pts[0]!.y)
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]!.x, pts[i]!.y)
    }
    return path
  })
}

/** Diagonal hatch band. Cached. */
export function hatch(
  worldSeed: number,
  shapeId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  spacing = 1.6,
): Path2D {
  const key = `hatch:${shapeId}:${x},${y},${w},${h},${spacing}`
  return cachedPath(key, () => {
    const rng = createRng(worldSeed ^ hashId(shapeId))
    const path = new Path2D()
    let i = 0
    for (let s = -h; s < w; s += spacing) {
      const jitter = (rng.next() * 2 - 1) * 0.25
      const x1 = x + s + jitter
      const y1 = y
      const x2 = x + s + h + jitter
      const y2 = y + h
      const clip = clipLineToRect(x1, y1, x2, y2, x, y, w, h)
      if (!clip) continue
      const id = `${shapeId}-h${i++}`
      const pts = wobblePolyline(worldSeed, id, clip.x1, clip.y1, clip.x2, clip.y2, 2, 0.25)
      path.moveTo(pts[0]!.x, pts[0]!.y)
      for (let k = 1; k < pts.length; k++) path.lineTo(pts[k]!.x, pts[k]!.y)
    }
    return path
  })
}

function clipLineToRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const pts: Vec2[] = []
  const inside = (x: number, y: number) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh
  if (inside(x1, y1)) pts.push({ x: x1, y: y1 })
  if (inside(x2, y2)) pts.push({ x: x2, y: y2 })
  const edges: Array<[number, number, number, number]> = [
    [rx, ry, rx + rw, ry],
    [rx + rw, ry, rx + rw, ry + rh],
    [rx + rw, ry + rh, rx, ry + rh],
    [rx, ry + rh, rx, ry],
  ]
  for (const [ax, ay, bx, by] of edges) {
    const hit = segmentIntersect(x1, y1, x2, y2, ax, ay, bx, by)
    if (hit) pts.push(hit)
  }
  if (pts.length < 2) return null
  pts.sort((a, b) => a.x - b.x || a.y - b.y)
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  if (Math.hypot(a.x - b.x, a.y - b.y) < 0.2) return null
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

function segmentIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): Vec2 | null {
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(den) < 1e-9) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }
}

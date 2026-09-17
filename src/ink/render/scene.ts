import { clockOf, isMarketOpenAt, isWorkOpenAt } from '../sim/config'
import type { InkState, Mind, PlaceId, Vec2 } from '../sim/types'
import { PLACES, PLACE_IDS, ROAD_SEGMENTS, WORLD_SIZE } from '../sim/world'
import {
  HATCH_GREY,
  INK,
  NIGHT_PAPER,
  PAPER,
  clearInkCache,
  hatch,
  wobblyLine,
  wobblyRect,
} from './ink'

export interface SceneHandle {
  resize: () => void
  render: (state: InkState, prev: Map<string, Vec2>, alpha: number) => void
}

const WORLD_W = WORLD_SIZE.width
const WORLD_H = WORLD_SIZE.height
const DOT_R = 1.2

function doorWall(place: PlaceId): 'n' | 'e' | 's' | 'w' {
  const { rect, door } = PLACES[place]
  const dN = Math.abs(door.y - rect.y)
  const dS = Math.abs(door.y - (rect.y + rect.h))
  const dW = Math.abs(door.x - rect.x)
  const dE = Math.abs(door.x - (rect.x + rect.w))
  const m = Math.min(dN, dS, dW, dE)
  if (m === dN) return 'n'
  if (m === dS) return 's'
  if (m === dE) return 'e'
  return 'w'
}

function placeOpen(state: InkState, id: PlaceId): boolean {
  if (id === 'home-a' || id === 'home-b' || id === 'center') return true
  if (id === 'market') return isMarketOpenAt(state.tick)
  return isWorkOpenAt(state.tick)
}

export function createScene(canvas: HTMLCanvasElement, seed: number): SceneHandle {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  let cssW = 0
  let cssH = 0
  let scale = 1
  let ox = 0
  let oy = 0
  const tails: Record<string, Vec2[]> = { A: [], B: [] }

  const resize = () => {
    const parent = canvas.parentElement ?? document.body
    cssW = parent.clientWidth
    cssH = parent.clientHeight
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(cssW * dpr))
    canvas.height = Math.max(1, Math.floor(cssH * dpr))
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const fit = Math.min(cssW / WORLD_W, cssH / WORLD_H)
    scale = fit
    ox = (cssW - WORLD_W * scale) / 2
    oy = (cssH - WORLD_H * scale) / 2
    clearInkCache()
  }

  const world = () => {
    ctx.setTransform(
      (window.devicePixelRatio || 1) * scale,
      0,
      0,
      (window.devicePixelRatio || 1) * scale,
      (window.devicePixelRatio || 1) * ox,
      (window.devicePixelRatio || 1) * oy,
    )
  }

  const screen = () => {
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const strokePath = (path: Path2D, width = 0.35, color = INK) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke(path)
  }

  const drawRoads = () => {
    ctx.setLineDash([])
    for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
      const seg = ROAD_SEGMENTS[i]!
      const dx = seg.b.x - seg.a.x
      const dy = seg.b.y - seg.a.y
      const len = Math.hypot(dx, dy) || 1
      const nx = (-dy / len) * 0.55
      const ny = (dx / len) * 0.55
      strokePath(
        wobblyLine(seed, `road-l-${i}`, seg.a.x + nx, seg.a.y + ny, seg.b.x + nx, seg.b.y + ny, 3),
        0.28,
      )
      strokePath(
        wobblyLine(seed, `road-r-${i}`, seg.a.x - nx, seg.a.y - ny, seg.b.x - nx, seg.b.y - ny, 3),
        0.28,
      )
      ctx.save()
      ctx.setLineDash([1.1, 1.3])
      ctx.globalAlpha = 0.55
      strokePath(wobblyLine(seed, `road-c-${i}`, seg.a.x, seg.a.y, seg.b.x, seg.b.y, 2), 0.16, HATCH_GREY)
      ctx.restore()
    }
  }

  const drawBuilding = (id: PlaceId) => {
    const p = PLACES[id]
    const { x, y, w, h } = p.rect
    strokePath(wobblyRect(seed, `b-${id}`, x, y, w, h), 0.4)
    // Weight on south + east edges.
    strokePath(wobblyLine(seed, `b-${id}-e2`, x + w + 0.45, y + 0.4, x + w + 0.45, y + h + 0.2, 3), 0.28)
    strokePath(wobblyLine(seed, `b-${id}-s2`, x + 0.4, y + h + 0.45, x + w + 0.2, y + h + 0.45, 3), 0.28)
    ctx.strokeStyle = HATCH_GREY
    ctx.lineWidth = 0.18
    ctx.stroke(hatch(seed, `hatch-${id}`, x + w * 0.45, y + h * 0.35, w * 0.5, h * 0.6, 1.5))

    const wall = doorWall(id)
    const door = p.door
    const gap = 1.6
    ctx.save()
    ctx.strokeStyle = PAPER
    ctx.lineWidth = 0.9
    ctx.lineCap = 'butt'
    if (wall === 's' || wall === 'n') {
      ctx.beginPath()
      ctx.moveTo(door.x - gap, door.y)
      ctx.lineTo(door.x + gap, door.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(door.x, door.y - gap)
      ctx.lineTo(door.x, door.y + gap)
      ctx.stroke()
    }
    ctx.restore()

    ctx.fillStyle = INK
    ctx.font = '1.8px Georgia, "Times New Roman", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(p.label, x + w / 2, y - 0.7)
  }

  const drawClock = (state: InkState) => {
    const c = clockOf(state.tick)
    const box = wobblyRect(seed, 'clock', 2.2, 1.4, 16, 5.2)
    ctx.fillStyle = PAPER
    ctx.fill(box)
    strokePath(box, 0.32)
    ctx.fillStyle = INK
    ctx.font = '2.1px Georgia, "Times New Roman", serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const hh = String(c.hour).padStart(2, '0')
    const mm = String(c.minute).padStart(2, '0')
    ctx.fillText(`${c.dayName} ${hh}:${mm}`, 3.4, 3.5)
    ctx.save()
    ctx.translate(15.4, 3.9)
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.22
    if (c.isNight) {
      ctx.beginPath()
      ctx.arc(0, 0, 1.05, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = PAPER
      ctx.beginPath()
      ctx.arc(0.45, -0.2, 0.85, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, 0.7, 0, Math.PI * 2)
      ctx.stroke()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * 0.95, Math.sin(a) * 0.95)
        ctx.lineTo(Math.cos(a) * 1.45, Math.sin(a) * 1.45)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  const drawNight = (state: InkState) => {
    const c = clockOf(state.tick)
    if (!c.isNight) return
    ctx.fillStyle = NIGHT_PAPER
    ctx.fillRect(0, 0, WORLD_W, WORLD_H)
    for (const id of PLACE_IDS) {
      if (!placeOpen(state, id)) continue
      const p = PLACES[id]
      const cx = p.rect.x + p.rect.w / 2
      const cy = p.rect.y + p.rect.h / 2
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 11)
      g.addColorStop(0, PAPER)
      g.addColorStop(1, 'rgba(247,245,240,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, 11, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = HATCH_GREY
    ctx.lineWidth = 0.12
    ctx.globalAlpha = 0.35
    ctx.stroke(hatch(seed, 'sky', 0, 0, WORLD_W, 14, 4.2))
    ctx.stroke(hatch(seed, 'sky-x', 0, 0, WORLD_W, 14, 5.1))
    ctx.globalAlpha = 1
  }

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  const drawnPos = (mind: Mind, prev: Map<string, Vec2>, alpha: number): Vec2 => {
    const p = prev.get(mind.id)
    if (!p) return mind.pos
    return { x: lerp(p.x, mind.pos.x, alpha), y: lerp(p.y, mind.pos.y, alpha) }
  }

  const drawMind = (mind: Mind, pos: Vec2) => {
    if (mind.path.length > 0) {
      const tail = tails[mind.id] ?? []
      for (let i = 0; i < tail.length; i++) {
        const g = tail[i]!
        ctx.globalAlpha = 0.12 + i * 0.1
        ctx.beginPath()
        ctx.arc(g.x, g.y, DOT_R * 0.85, 0, Math.PI * 2)
        if (mind.id === 'A') {
          ctx.fillStyle = INK
          ctx.fill()
        } else {
          ctx.strokeStyle = INK
          ctx.lineWidth = 0.28
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, DOT_R, 0, Math.PI * 2)
    if (mind.id === 'A') {
      ctx.fillStyle = INK
      ctx.fill()
    } else {
      ctx.strokeStyle = INK
      ctx.lineWidth = 0.38
      ctx.stroke()
    }

    if (mind.asleep && mind.at === mind.home) {
      const house = PLACES[mind.home]
      ctx.fillStyle = INK
      ctx.font = '1.6px Georgia, serif'
      ctx.textAlign = 'left'
      ctx.fillText('z z', house.rect.x + house.rect.w - 3.5, house.rect.y - 1.2)
    }
    if (mind.current?.action === 'work' && mind.at === 'work') {
      ctx.strokeStyle = HATCH_GREY
      ctx.lineWidth = 0.2
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(pos.x + 1.4 + i * 0.35, pos.y - 1.2 - i * 0.4)
        ctx.lineTo(pos.x + 2.4 + i * 0.35, pos.y - 2.0 - i * 0.4)
        ctx.stroke()
      }
    }
  }

  let lastTick = -1

  const render = (state: InkState, prev: Map<string, Vec2>, alpha: number) => {
    if (cssW === 0) resize()
    screen()
    ctx.fillStyle = clockOf(state.tick).isNight ? NIGHT_PAPER : PAPER
    ctx.fillRect(0, 0, cssW, cssH)
    world()
    ctx.fillStyle = clockOf(state.tick).isNight ? NIGHT_PAPER : PAPER
    ctx.fillRect(0, 0, WORLD_W, WORLD_H)
    drawNight(state)
    drawRoads()
    for (const id of PLACE_IDS) drawBuilding(id)
    drawClock(state)

    if (state.tick !== lastTick) {
      for (const mind of state.minds) {
        const list = tails[mind.id] ?? []
        if (mind.path.length > 0) {
          list.push({ x: mind.pos.x, y: mind.pos.y })
          if (list.length > 3) list.shift()
        } else {
          list.length = 0
        }
        tails[mind.id] = list
      }
      lastTick = state.tick
    }

    for (const mind of state.minds) {
      drawMind(mind, drawnPos(mind, prev, alpha))
    }
  }

  return { resize, render }
}

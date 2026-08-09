import * as THREE from 'three'
import { nearestAgentWithin } from '../sim/spots'
import type { AgentState, Place } from '../sim/types'

const HEAD_Y = 0.22 + 0.55 + 0.16 * 0.85 // matches agents.ts head top-ish
const BUBBLE_LIFT = 0.9
const CRITICAL_TTL_MS = 3000
const CRITICAL_POOL = 5

const BUBBLE_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  left: '0',
  top: '0',
  transform: 'translate(-50%, -100%)',
  background: '#1c2333ee',
  color: '#f2f4f8',
  fontSize: '11px',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  fontWeight: '600',
  padding: '4px 8px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: '8',
  opacity: '0',
  willChange: 'transform, opacity',
  lineHeight: '1.2',
}

function applyBubbleBase(el: HTMLElement, mini = false): void {
  Object.assign(el.style, BUBBLE_STYLE)
  if (mini) {
    el.style.padding = '3px 6px'
    el.style.fontSize = '13px'
    el.style.borderRadius = '10px'
  }
  // CSS triangle tail
  el.style.setProperty('--tail', '1')
}

function ensureTailStyles(el: HTMLElement): void {
  // Use a pseudo-element via an inner span for the ▼ tail
  if (el.querySelector('[data-tail]')) return
  const tail = document.createElement('span')
  tail.dataset.tail = '1'
  tail.textContent = '▼'
  Object.assign(tail.style, {
    position: 'absolute',
    left: '50%',
    bottom: '-9px',
    transform: 'translateX(-50%)',
    fontSize: '9px',
    lineHeight: '1',
    color: '#1c2333ee',
    textShadow: '0 1px 0 rgba(255,255,255,0.08)',
    pointerEvents: 'none',
  } as CSSStyleDeclaration)
  el.appendChild(tail)
}

function project(
  worldX: number,
  worldY: number,
  worldZ: number,
  camera: THREE.Camera,
  width: number,
  height: number,
  out: THREE.Vector3,
): { x: number; y: number; behind: boolean } {
  out.set(worldX, worldY, worldZ)
  out.project(camera)
  const behind = out.z > 1
  const x = (out.x * 0.5 + 0.5) * width
  const y = (-out.y * 0.5 + 0.5) * height
  return { x, y, behind }
}

/** Destination / action micro-status for the selected-agent bubble (derived, no sim state). */
export function formatStatusBubble(
  agent: AgentState,
  places: Place[],
  agents: readonly AgentState[] = [],
): string {
  const a = agent.action
  const path = a.path
  const walking = !!(path && path.length > 0 && agent.pathIndex < path.length)

  const place = a.targetPlaceId
    ? places.find((p) => p.id === a.targetPlaceId)
    : undefined
  const placeKind = place?.kind

  // Collapse overrides other status copy
  if (agent.collapsed) {
    return '😵 Collapsed — needs food'
  }

  if (walking) {
    switch (a.kind) {
      case 'forage':
        return '🚶 → berry bushes'
      case 'buy':
        return '🛒 → market stall'
      case 'work':
        if (agent.workPhase === 'hauling') return '🧺 Hauling the harvest'
        if (placeKind === 'farm') return '🚶 → the farm'
        if (placeKind === 'stall') return '🚶 → the stall'
        return '🚶 → work'
      case 'eat':
        return '🍽️ Eating'
      case 'drink':
        return '🚶 → the well'
      case 'sleep':
        return '🏠 Heading home'
      case 'socialize':
        return '🚶 → plaza'
      case 'wander':
        return '🚶 Wandering'
      case 'walk':
        if (placeKind === 'berry-bush') return '🚶 → berry bushes'
        if (placeKind === 'well') return '🚶 → the well'
        if (placeKind === 'home') return '🏠 Heading home'
        if (placeKind === 'plaza') return '🚶 → plaza'
        if (placeKind === 'farm') return '🚶 → the farm'
        if (placeKind === 'stall') return '🚶 → the stall'
        return '🚶 Walking'
      default:
        return '🚶 Walking'
    }
  }

  switch (a.kind) {
    case 'forage':
      return '🫐 Picking berries'
    case 'buy':
      return '🛒 Buying food'
    case 'work':
      if (agent.workPhase === 'hauling') return '🧺 Hauling the harvest'
      if (placeKind === 'stall') return '🏪 Working the stall'
      if (placeKind === 'farm') return '👨‍🌾 Working the farm'
      return '👨‍🌾 Working'
    case 'eat':
      return '🍽️ Eating'
    case 'drink':
      return '💧 At the well'
    case 'sleep':
      return '😴 Sleeping'
    case 'socialize': {
      const other = nearestAgentWithin(agent, agents)
      return other
        ? `💬 Chatting with ${other.name}`
        : '💬 Looking for company'
    }
    case 'wander':
      return '🚶 Wandering'
    case 'walk':
      return '🚶 Walking'
    case 'idle':
      return '🧍 Idle'
    default:
      return a.kind
  }
}

function criticalEmoji(need: string): string {
  switch (need) {
    case 'hunger':
      return '🍽️'
    case 'energy':
      return '😴'
    case 'social':
      return '💬'
    default:
      return '❗'
  }
}

interface CriticalSlot {
  el: HTMLElement
  textEl: HTMLElement
  agentId: string | null
  born: number
  active: boolean
}

export interface OverlaysHandle {
  /** Every frame: project bubbles to screen. */
  updateFrame: (args: {
    camera: THREE.Camera
    width: number
    height: number
    selectedId: string | null
    agents: AgentState[]
    places: Place[]
    prev: Map<string, { x: number; y: number }>
    alpha: number
    now: number
  }) => void
  /** Spawn / recycle a critical-need ambient bubble. */
  pushCritical: (agentId: string, need: string, now: number) => void
  dispose: () => void
}

export function createOverlays(container: HTMLElement): OverlaysHandle {
  const root = document.createElement('div')
  root.dataset.overlays = '1'
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '8',
  } as CSSStyleDeclaration)
  container.appendChild(root)

  // Selected-agent status bubble
  const statusEl = document.createElement('div')
  statusEl.dataset.testid = 'status-bubble'
  applyBubbleBase(statusEl)
  const statusText = document.createElement('span')
  statusText.dataset.content = '1'
  statusEl.appendChild(statusText)
  ensureTailStyles(statusEl)
  root.appendChild(statusEl)

  let lastStatusText = ''
  const proj = new THREE.Vector3()

  // Pooled critical bubbles
  const pool: CriticalSlot[] = []
  for (let i = 0; i < CRITICAL_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.criticalBubble = String(i)
    applyBubbleBase(el, true)
    const textEl = document.createElement('span')
    textEl.dataset.content = '1'
    el.appendChild(textEl)
    ensureTailStyles(el)
    el.style.display = 'none'
    root.appendChild(el)
    pool.push({ el, textEl, agentId: null, born: 0, active: false })
  }

  const freeOldest = () => {
    let oldest: CriticalSlot | null = null
    for (const s of pool) {
      if (!s.active) continue
      if (!oldest || s.born < oldest.born) oldest = s
    }
    if (oldest) {
      oldest.active = false
      oldest.agentId = null
      oldest.el.style.display = 'none'
    }
  }

  const pushCritical = (agentId: string, need: string, now: number) => {
    let slot = pool.find((s) => !s.active)
    if (!slot) {
      freeOldest()
      slot = pool.find((s) => !s.active)
    }
    if (!slot) return
    slot.active = true
    slot.agentId = agentId
    slot.born = now
    slot.textEl.textContent = criticalEmoji(need)
    slot.el.style.display = 'block'
    slot.el.style.opacity = '1'
  }

  const interpPos = (
    agent: AgentState,
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
  ): { x: number; z: number } => {
    const a = Math.max(0, Math.min(1, alpha))
    const px = prev.get(agent.id)?.x ?? agent.x
    const py = prev.get(agent.id)?.y ?? agent.y
    return {
      x: px + (agent.x - px) * a,
      z: py + (agent.y - py) * a,
    }
  }

  const updateFrame = (args: {
    camera: THREE.Camera
    width: number
    height: number
    selectedId: string | null
    agents: AgentState[]
    places: Place[]
    prev: Map<string, { x: number; y: number }>
    alpha: number
    now: number
  }) => {
    const { camera, width, height, selectedId, agents, places, prev, alpha, now } =
      args

    // Status bubble
    const selected = selectedId
      ? agents.find((a) => a.id === selectedId)
      : undefined
    if (!selected) {
      statusEl.style.opacity = '0'
      statusEl.style.display = 'none'
    } else {
      const pos = interpPos(selected, prev, alpha)
      const screen = project(
        pos.x,
        HEAD_Y + BUBBLE_LIFT,
        pos.z,
        camera,
        width,
        height,
        proj,
      )
      if (screen.behind) {
        statusEl.style.opacity = '0'
        statusEl.style.display = 'none'
      } else {
        statusEl.style.display = 'block'
        statusEl.style.opacity = '1'
        statusEl.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
        const text = formatStatusBubble(selected, places, agents)
        if (text !== lastStatusText) {
          lastStatusText = text
          statusText.textContent = text
        }
      }
    }

    // Critical bubbles
    const byId = new Map(agents.map((a) => [a.id, a]))
    for (const slot of pool) {
      if (!slot.active || !slot.agentId) continue
      const age = now - slot.born
      if (age >= CRITICAL_TTL_MS) {
        slot.active = false
        slot.agentId = null
        slot.el.style.display = 'none'
        continue
      }
      const agent = byId.get(slot.agentId)
      if (!agent) {
        slot.active = false
        slot.agentId = null
        slot.el.style.display = 'none'
        continue
      }
      const pos = interpPos(agent, prev, alpha)
      const screen = project(
        pos.x,
        HEAD_Y + BUBBLE_LIFT * 0.7,
        pos.z,
        camera,
        width,
        height,
        proj,
      )
      if (screen.behind) {
        slot.el.style.opacity = '0'
        continue
      }
      // Fade in last 600ms
      const fadeStart = CRITICAL_TTL_MS - 600
      const opacity = age > fadeStart ? 1 - (age - fadeStart) / 600 : 1
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0, opacity))
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
    }
  }

  const dispose = () => {
    if (root.parentElement === container) container.removeChild(root)
  }

  return { updateFrame, pushCritical, dispose }
}

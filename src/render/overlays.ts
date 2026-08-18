import * as THREE from 'three'
import { nearestAgentWithin } from '../sim/spots'
import { openJobSlots, workersOfPlace } from '../sim/selectors'
import type { AgentState, Place, SimEvent, SimTime } from '../sim/types'
import {
  describeAgent,
  describeSpeechBubbles,
  GLYPH_EMOJI,
  SAY_WINDOW,
  type GlyphKind,
} from './actionLanguage'

const HEAD_Y = 0.22 + 0.55 + 0.16 * 0.85 // matches agents.ts head top-ish
const BUBBLE_LIFT = 0.9
const CRITICAL_TTL_MS = 3000
const CRITICAL_POOL = 5
const TOAST_TTL_MS = 1500
const TOAST_POOL = 8
const INDICATOR_POOL = 24
const ZZZ_TTL_MS = 2200
const ZZZ_POOL = 12
const HEART_TTL_MS = 1800
const HEART_POOL = 6
/** Live HTML speech pool size. Visibility is tick-window (SAY_WINDOW), not wall-clock. */
const SPEECH_POOL = 8

const HOME_BILL: Record<'wood' | 'stone', number> = { wood: 12, stone: 6 }

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
}

function ensureTailStyles(el: HTMLElement): void {
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

/** Luna agent ids get a subtle 🧠 prefix on the status bubble (subset for visual cue). */
const LUNA_BUBBLE_IDS = new Set([
  'agent-0',
  'agent-1',
  'agent-2',
  'agent-4',
  'agent-8',
  'agent-11',
])

/** Destination / action micro-status for the selected-agent bubble (derived, no sim state). */
export function formatStatusBubble(
  agent: AgentState,
  places: Place[],
  agents: readonly AgentState[] = [],
): string {
  const body = formatStatusBubbleBody(agent, places, agents)
  return LUNA_BUBBLE_IDS.has(agent.id) ? `🧠 ${body}` : body
}

function formatStatusBubbleBody(
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
        if (agent.workPhase === 'hauling' || agent.workPhase === 'returning') {
          return '🧺 Hauling'
        }
        if (placeKind === 'farm') return '🚶 → the farm'
        if (placeKind === 'stall') return '🚶 → the stall'
        if (placeKind === 'forestry') return '🚶 → the forestry camp'
        if (placeKind === 'quarry') return '🚶 → the quarry'
        if (placeKind === 'construction-site') return '🚶 → the build site'
        if (placeKind === 'storehouse') return '🚶 → the storehouse'
        return '🚶 → work'
      case 'commission':
        return '🏗️ Commissioning a house'
      case 'eat':
        return '🍽️ Eating'
      case 'drink':
        return '🚶 → the well'
      case 'sleep':
        return placeKind === 'home' ? '🏠 Heading home' : '🚶 Looking for rest'
      case 'examine':
        if (placeKind === 'notice-board') return '🚶 → the notice board'
        return '🚶 Going to look closer'
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
      if (agent.workPhase === 'hauling' || agent.workPhase === 'returning') {
        return '🧺 Hauling'
      }
      if (placeKind === 'stall') return '🏪 Working the stall'
      if (placeKind === 'farm') return '👨‍🌾 Working the farm'
      if (placeKind === 'forestry') return '🪓 Chopping wood'
      if (placeKind === 'quarry') return '⛏️ Quarrying stone'
      if (placeKind === 'construction-site') return '🏗️ Building'
      return '👨‍🌾 Working'
    case 'commission':
      return '🏗️ Commissioning a house'
    case 'eat':
      return '🍽️ Eating'
    case 'drink':
      return '💧 At the well'
    case 'sleep':
      return placeKind === 'home' ? '😴 Sleeping' : '😴 Sleeping on the ground'
    case 'examine':
      return placeKind === 'notice-board'
        ? '📌 Reading the notice board'
        : '📌 Looking closely'
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

const JOB_ICON: Record<string, string> = {
  farm: '👨‍🌾',
  stall: '🏪',
  forestry: '🪓',
  quarry: '⛏️',
  'construction-site': '🏗️',
  storehouse: '🏚️',
}

const JOB_TITLE: Record<string, string> = {
  farm: 'Farmhand',
  stall: 'Vendor',
  forestry: 'Lumberjack',
  quarry: 'Quarrier',
  'construction-site': 'Builder',
  storehouse: 'Storekeeper',
}

const PLACE_LABEL: Record<string, string> = {
  farm: 'Farm',
  stall: 'Stall',
  storehouse: 'Storehouse',
  forestry: 'Forestry',
  quarry: 'Quarry',
  well: 'Well',
  home: 'Home',
  'construction-site': 'Build site',
  'notice-board': 'Notice board',
  plaza: 'Plaza',
}

const GOOD_ICON: Record<string, string> = {
  food: '🫐',
  wood: '🪵',
  stone: '🪨',
  coins: '🪙',
}

export function formatAgentTooltip(
  agent: AgentState,
  places: Place[],
  agents: readonly AgentState[],
): string {
  const jobPlace = agent.employedAt
    ? places.find((p) => p.id === agent.employedAt)
    : undefined
  const jobIcon = jobPlace ? JOB_ICON[jobPlace.kind] ?? '💼' : '🧍'
  const jobTitle = jobPlace
    ? JOB_TITLE[jobPlace.kind] ?? jobPlace.kind
    : 'Unemployed'
  const doing = formatStatusBubble(agent, places, agents)
  let carry = ''
  if (agent.haulAmount > 0 && agent.haulGood) {
    carry = ` ${agent.haulAmount} ${agent.haulGood}`
  } else {
    const inv = agent.inventory
    if (inv) {
      const parts: string[] = []
      if (inv.food > 0) parts.push(`${inv.food} food`)
      if (inv.wood > 0) parts.push(`${inv.wood} wood`)
      if (inv.stone > 0) parts.push(`${inv.stone} stone`)
      if (parts.length) carry = ` · carrying ${parts.join(', ')}`
    }
  }
  return `${agent.name} · ${jobIcon} ${jobTitle} — ${doing}${carry}`
}

export function formatPlaceTooltip(
  place: Place,
  agents: readonly AgentState[],
  time: SimTime | null,
): string {
  const label = PLACE_LABEL[place.kind] ?? place.kind
  const parts: string[] = [label]
  if ((place.jobSlots ?? 0) > 0) {
    const n = workersOfPlace(agents, place.id).length
    parts.push(`${n} worker${n === 1 ? '' : 's'}`)
  }
  if (place.production) {
    const g = Math.max(0, Math.min(1, place.growth ?? 0))
    const remain = Math.max(0, 1 - g)
    const ticksLeft = Math.ceil(remain * place.production.cycleWorkedTicks)
    if (g > 0.01 && ticksLeft > 0) {
      const hours = Math.floor(ticksLeft / 60)
      const mins = ticksLeft % 60
      if (hours > 0) parts.push(`ready in ${hours}h${mins > 0 ? ` ${mins}m` : ''}`)
      else parts.push(`ready in ${mins}m`)
    } else if (g < 0.01) {
      parts.push('idle')
    } else {
      parts.push('ready')
    }
  }
  if (place.construction) {
    const pct = Math.round((place.construction.progress ?? 0) * 100)
    parts.push(`${pct}% built`)
  }
  if (place.kind === 'farm' && (place.inventory?.food ?? 0) >= 5) {
    parts.push('ripe')
  }
  void time
  return parts.join(' · ')
}

function placeActivelyWorked(place: Place, agents: readonly AgentState[]): boolean {
  if (!place.production && !place.construction) return false
  for (const a of agents) {
    if (a.employedAt !== place.id) continue
    if (a.action.kind !== 'work') continue
    if (a.workPhase === 'hauling' || a.workPhase === 'returning') continue
    const path = a.action.path
    const walking = !!(path && path.length > 0 && a.pathIndex < path.length)
    if (!walking) return true
  }
  return false
}

interface CriticalSlot {
  el: HTMLElement
  textEl: HTMLElement
  agentId: string | null
  born: number
  active: boolean
}

interface ToastSlot {
  el: HTMLElement
  textEl: HTMLElement
  agentId: string | null
  born: number
  active: boolean
}

interface IndicatorSlot {
  el: HTMLElement
  kind: string
  placeId: string | null
  active: boolean
}

interface ZzzSlot {
  el: HTMLElement
  agentId: string | null
  born: number
  active: boolean
}

interface HeartSlot {
  el: HTMLElement
  agentIdA: string | null
  agentIdB: string | null
  born: number
  active: boolean
}

interface SpeechSlot {
  el: HTMLElement
  textEl: HTMLElement
  agentId: string | null
  born: number
  active: boolean
}

interface GlyphSlot {
  el: HTMLElement
  agentId: string | null
  kind: GlyphKind | null
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
    time?: SimTime | null
    tick?: number
    events?: readonly SimEvent[]
  }) => void
  /** Spawn / recycle a critical-need ambient bubble. */
  pushCritical: (agentId: string, need: string, now: number) => void
  /** Live-only pickup/coin toast above an agent. */
  pushToast: (
    agentId: string,
    kind: 'goods' | 'coins',
    good: string,
    amount: number,
    now: number,
  ) => void
  /** Twin-hearts float over a pair (relationship:close, live-only). */
  pushHearts: (agentIdA: string, agentIdB: string, now: number) => void
  /** Chat speech bubble above speaker (~4s or until next say). */
  pushSpeech: (agentId: string, text: string, now: number) => void
  /** Hover tooltip (HTML, near cursor). */
  setTooltip: (text: string | null, clientX: number, clientY: number) => void
  /**
   * Photo mode: when non-null, hide all world-space indicators except speech
   * belonging to the subject agent. null = normal HUD overlays.
   */
  setPhotoSubject: (agentId: string | null) => void
  /** Clear transient bubbles (toasts/criticals/hearts/zzz) for a clean still. */
  clearEphemeral: () => void
  dispose: () => void
}

function isPerformingSleep(agent: AgentState): boolean {
  return (
    agent.action.kind === 'sleep' &&
    (agent.action.path === undefined ||
      agent.pathIndex >= (agent.action.path?.length ?? 0))
  )
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

  /** Photo-mode subject; non-null suppresses non-subject chrome. */
  let photoSubjectId: string | null = null

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

  // Speech bubbles (conversation utterances)
  const speechPool: SpeechSlot[] = []
  for (let i = 0; i < SPEECH_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.speechBubble = String(i)
    el.dataset.testid = i === 0 ? 'speech-bubble' : `speech-bubble-${i}`
    applyBubbleBase(el)
    el.style.maxWidth = '180px'
    el.style.whiteSpace = 'normal'
    el.style.textAlign = 'center'
    el.style.background = '#2a3550ee'
    el.style.border = '1px solid rgba(180,200,255,0.28)'
    const textEl = document.createElement('span')
    textEl.dataset.content = '1'
    el.appendChild(textEl)
    ensureTailStyles(el)
    el.style.display = 'none'
    root.appendChild(el)
    speechPool.push({ el, textEl, agentId: null, born: 0, active: false })
  }

  // Action-language glyphs (one per agent; update on kind change only)
  const glyphPool: GlyphSlot[] = []
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div')
    el.dataset.actionGlyph = String(i)
    if (i === 0) el.dataset.testid = 'action-glyph'
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      fontSize: '16px',
      lineHeight: '1',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.65))',
    } as CSSStyleDeclaration)
    root.appendChild(el)
    glyphPool.push({ el, agentId: null, kind: null })
  }

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

  // Pickup / coin toasts
  const toastPool: ToastSlot[] = []
  for (let i = 0; i < TOAST_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.toast = String(i)
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      color: '#ffe7c2',
      fontSize: '13px',
      fontWeight: '700',
      fontFamily: 'system-ui, sans-serif',
      textShadow: '0 1px 3px rgba(0,0,0,0.75)',
      pointerEvents: 'none',
      zIndex: '9',
      whiteSpace: 'nowrap',
      display: 'none',
    } as CSSStyleDeclaration)
    const textEl = document.createElement('span')
    el.appendChild(textEl)
    root.appendChild(el)
    toastPool.push({ el, textEl, agentId: null, born: 0, active: false })
  }

  // World indicators (progress, hiring, ripe, materials)
  const indicators: IndicatorSlot[] = []
  for (let i = 0; i < INDICATOR_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.indicator = String(i)
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      pointerEvents: 'none',
      zIndex: '7',
      display: 'none',
      whiteSpace: 'nowrap',
    } as CSSStyleDeclaration)
    root.appendChild(el)
    indicators.push({ el, kind: '', placeId: null, active: false })
  }

  // Sleeping Zzz glyphs (pooled HTML)
  const zzzPool: ZzzSlot[] = []
  for (let i = 0; i < ZZZ_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.zzz = String(i)
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      color: '#c8d0e8',
      fontSize: '14px',
      fontWeight: '800',
      fontFamily: 'Georgia, serif',
      fontStyle: 'italic',
      textShadow: '0 1px 3px rgba(0,0,0,0.65)',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
    } as CSSStyleDeclaration)
    el.textContent = 'Z'
    root.appendChild(el)
    zzzPool.push({ el, agentId: null, born: 0, active: false })
  }
  /** Last Z spawn time per sleeper. */
  const lastZzzByAgent = new Map<string, number>()

  // Twin-hearts celebration
  const heartPool: HeartSlot[] = []
  for (let i = 0; i < HEART_POOL; i++) {
    const el = document.createElement('div')
    el.dataset.hearts = String(i)
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transform: 'translate(-50%, -100%)',
      fontSize: '16px',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
      whiteSpace: 'nowrap',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))',
    } as CSSStyleDeclaration)
    el.textContent = '💛💛'
    root.appendChild(el)
    heartPool.push({ el, agentIdA: null, agentIdB: null, born: 0, active: false })
  }

  // Hover tooltip
  const tooltipEl = document.createElement('div')
  tooltipEl.dataset.testid = 'tooltip'
  Object.assign(tooltipEl.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    transform: 'translate(12px, 14px)',
    background: 'rgba(12, 16, 28, 0.92)',
    color: '#f2f4f8',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    fontWeight: '600',
    padding: '6px 10px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex: '40',
    display: 'none',
    maxWidth: '280px',
    lineHeight: '1.35',
  } as CSSStyleDeclaration)
  // Attach to document body so fixed coords work even if container clips
  document.body.appendChild(tooltipEl)

  const freeOldestCritical = () => {
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

  const freeOldestToast = () => {
    let oldest: ToastSlot | null = null
    for (const s of toastPool) {
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
      freeOldestCritical()
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

  const pushToast = (
    agentId: string,
    kind: 'goods' | 'coins',
    good: string,
    amount: number,
    now: number,
  ) => {
    let slot = toastPool.find((s) => !s.active)
    if (!slot) {
      freeOldestToast()
      slot = toastPool.find((s) => !s.active)
    }
    if (!slot) return
    slot.active = true
    slot.agentId = agentId
    slot.born = now
    const icon =
      kind === 'coins' ? '🪙' : GOOD_ICON[good] ?? (good === 'food' ? '🫐' : '📦')
    slot.textEl.textContent = `+${amount} ${icon}`
    slot.el.style.display = 'block'
    slot.el.style.opacity = '1'
  }

  const setTooltip = (text: string | null, clientX: number, clientY: number) => {
    if (!text) {
      tooltipEl.style.display = 'none'
      return
    }
    tooltipEl.textContent = text
    tooltipEl.style.display = 'block'
    tooltipEl.style.left = `${clientX}px`
    tooltipEl.style.top = `${clientY}px`
  }

  const freeOldestZzz = () => {
    let oldest: ZzzSlot | null = null
    for (const s of zzzPool) {
      if (!s.active) continue
      if (!oldest || s.born < oldest.born) oldest = s
    }
    if (oldest) {
      oldest.active = false
      oldest.agentId = null
      oldest.el.style.display = 'none'
    }
  }

  const spawnZzz = (agentId: string, now: number) => {
    let slot = zzzPool.find((s) => !s.active)
    if (!slot) {
      freeOldestZzz()
      slot = zzzPool.find((s) => !s.active)
    }
    if (!slot) return
    slot.active = true
    slot.agentId = agentId
    slot.born = now
    slot.el.style.display = 'block'
    slot.el.style.opacity = '1'
  }

  const pushSpeech = (agentId: string, text: string, now: number) => {
    // Replace existing speech for this agent (queue-safe: one bubble per speaker)
    for (const s of speechPool) {
      if (s.active && s.agentId === agentId) {
        s.active = false
        s.agentId = null
        s.el.style.display = 'none'
      }
    }
    let slot = speechPool.find((s) => !s.active)
    if (!slot) {
      let oldest: SpeechSlot | null = null
      for (const s of speechPool) {
        if (!s.active) continue
        if (!oldest || s.born < oldest.born) oldest = s
      }
      if (oldest) {
        oldest.active = false
        oldest.agentId = null
        oldest.el.style.display = 'none'
        slot = oldest
      }
    }
    if (!slot) return
    slot.active = true
    slot.agentId = agentId
    slot.born = now
    const clipped = text.length > 140 ? `${text.slice(0, 137)}…` : text
    slot.textEl.textContent = clipped
    slot.el.style.display = 'block'
    slot.el.style.opacity = '1'
  }

  const pushHearts = (agentIdA: string, agentIdB: string, now: number) => {
    let slot: HeartSlot | undefined = heartPool.find((s) => !s.active)
    if (!slot) {
      // recycle oldest
      let oldest: HeartSlot | undefined
      for (const s of heartPool) {
        if (!oldest || s.born < oldest.born) oldest = s
      }
      slot = oldest
    }
    if (!slot) return
    slot.active = true
    slot.agentIdA = agentIdA
    slot.agentIdB = agentIdB
    slot.born = now
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

  const takeIndicator = (): IndicatorSlot | null => {
    return indicators.find((s) => !s.active) ?? null
  }

  const renderRingHtml = (pct: number): string => {
    const p = Math.max(0, Math.min(100, pct))
    const r = 12
    const c = 2 * Math.PI * r
    const offset = c * (1 - p / 100)
    return `<svg width="32" height="32" viewBox="0 0 32 32" style="display:block">
      <circle cx="16" cy="16" r="${r}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>
      <circle cx="16" cy="16" r="${r}" fill="none" stroke="#6fbf7a" stroke-width="3"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 16 16)"/>
      <text x="16" y="18" text-anchor="middle" fill="#f2f4f8" font-size="8" font-weight="700" font-family="system-ui">${p}</text>
    </svg>`
  }

  const clearEphemeral = () => {
    for (const slot of pool) {
      slot.active = false
      slot.agentId = null
      slot.el.style.display = 'none'
    }
    for (const slot of toastPool) {
      slot.active = false
      slot.agentId = null
      slot.el.style.display = 'none'
    }
    for (const slot of zzzPool) {
      slot.active = false
      slot.agentId = null
      slot.el.style.display = 'none'
    }
    for (const slot of heartPool) {
      slot.active = false
      slot.agentIdA = null
      slot.agentIdB = null
      slot.el.style.display = 'none'
    }
    for (const slot of indicators) {
      slot.active = false
      slot.placeId = null
      slot.el.style.display = 'none'
      slot.el.innerHTML = ''
    }
    statusEl.style.display = 'none'
    statusEl.style.opacity = '0'
    setTooltip(null, 0, 0)
  }

  const setPhotoSubject = (agentId: string | null) => {
    photoSubjectId = agentId
    if (agentId) {
      // Drop chrome that is not the subject's speech
      clearEphemeral()
      for (const s of speechPool) {
        if (s.active && s.agentId && s.agentId !== agentId) {
          s.active = false
          s.agentId = null
          s.el.style.display = 'none'
        }
      }
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
    time?: SimTime | null
    tick?: number
    events?: readonly SimEvent[]
  }) => {
    const { camera, width, height, selectedId, agents, places, prev, alpha, now } =
      args
    const time = args.time ?? null
    const tick = args.tick ?? time?.tick ?? 0
    const events = args.events ?? []
    const photoOn = photoSubjectId !== null

    // Event-derived speech (canonical). Wall-clock pushSpeech kept as a no-cost
    // live boost; tick window is the authority for scrub/photo.
    const byId = new Map(agents.map((a) => [a.id, a]))
    const speechActiveIds = new Set<string>()
    const derived = describeSpeechBubbles(events, tick)
    const derivedById = new Map(derived.map((b) => [b.agentId, b]))
    // Sync pool from derived bubbles (hide extras).
    for (const slot of speechPool) {
      slot.active = false
      slot.agentId = null
      slot.el.style.display = 'none'
    }
    let slotIdx = 0
    for (const bubble of derived) {
      speechActiveIds.add(bubble.agentId)
      // Photo mode uses the 3D canvas sprite — skip HTML so it doesn't double.
      if (photoOn) continue
      const agent = byId.get(bubble.agentId)
      if (!agent) continue
      const slot = speechPool[slotIdx++]
      if (!slot) break
      slot.active = true
      slot.agentId = bubble.agentId
      slot.born = now - bubble.ageTicks * 1000 // cosmetic only
      slot.textEl.textContent = bubble.text
      const pos = interpPos(agent, prev, alpha)
      const screen = project(
        pos.x,
        HEAD_Y + BUBBLE_LIFT * 1.05,
        pos.z,
        camera,
        width,
        height,
        proj,
      )
      if (screen.behind) {
        slot.el.style.display = 'none'
        continue
      }
      const fade = 1 - bubble.ageTicks / (SAY_WINDOW + 1)
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0.35, fade))
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
    }
    void derivedById
    void now

    // Action-language glyphs — one per agent, speech suppresses, photo keeps subject
    for (let i = 0; i < glyphPool.length; i++) {
      const slot = glyphPool[i]!
      const agent = agents[i]
      if (!agent) {
        if (slot.kind !== null || slot.agentId !== null) {
          slot.kind = null
          slot.agentId = null
          slot.el.style.display = 'none'
          slot.el.textContent = ''
        }
        continue
      }
      if (photoOn && agent.id !== photoSubjectId) {
        if (slot.el.style.display !== 'none') slot.el.style.display = 'none'
        continue
      }
      const visual = describeAgent(agent, tick, {
        events,
        speechActive: speechActiveIds.has(agent.id),
      })
      const kind = visual.glyph
      if (!kind) {
        if (slot.kind !== null) {
          slot.kind = null
          slot.agentId = null
          slot.el.style.display = 'none'
          slot.el.textContent = ''
          delete slot.el.dataset.glyphPlaceId
        }
        continue
      }
      if (slot.kind !== kind || slot.agentId !== agent.id) {
        slot.kind = kind
        slot.agentId = agent.id
        slot.el.textContent = GLYPH_EMOJI[kind]
        slot.el.dataset.glyph = kind
        slot.el.dataset.agentId = agent.id
        slot.el.style.color = kind === 'collapsed' ? '#ff4d4d' : '#f2f4f8'
      }
      let wx = 0
      let wz = 0
      let wy = HEAD_Y + BUBBLE_LIFT * 0.85
      if (kind === 'examine' && visual.glyphPlaceId) {
        const place = places.find((p) => p.id === visual.glyphPlaceId)
        if (place) {
          wx = place.x
          wz = place.y
          wy = HEAD_Y + BUBBLE_LIFT * 1.15
          slot.el.dataset.glyphPlaceId = visual.glyphPlaceId
        } else {
          const pos = interpPos(agent, prev, alpha)
          wx = pos.x
          wz = pos.z
          delete slot.el.dataset.glyphPlaceId
        }
      } else {
        const pos = interpPos(agent, prev, alpha)
        wx = pos.x
        wz = pos.z
        delete slot.el.dataset.glyphPlaceId
      }
      const screen = project(wx, wy, wz, camera, width, height, proj)
      if (screen.behind) {
        slot.el.style.display = 'none'
        continue
      }
      slot.el.style.display = 'block'
      slot.el.style.opacity = '1'
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
    }

    // Status bubble (hidden in photo mode; hidden while speaker has speech)
    const selected = selectedId
      ? agents.find((a) => a.id === selectedId)
      : undefined
    if (photoOn || !selected || (selectedId && speechActiveIds.has(selectedId))) {
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

    // Critical bubbles (suppressed in photo mode)
    for (const slot of pool) {
      if (photoOn) {
        slot.el.style.display = 'none'
        continue
      }
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
      const fadeStart = CRITICAL_TTL_MS - 600
      const opacity = age > fadeStart ? 1 - (age - fadeStart) / 600 : 1
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0, opacity))
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
    }

    // Toasts float upward (suppressed in photo mode)
    for (const slot of toastPool) {
      if (photoOn) {
        slot.el.style.display = 'none'
        continue
      }
      if (!slot.active || !slot.agentId) continue
      const age = now - slot.born
      if (age >= TOAST_TTL_MS) {
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
      const lift = (age / TOAST_TTL_MS) * 36
      const screen = project(
        pos.x,
        HEAD_Y + BUBBLE_LIFT + 0.2,
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
      const fade = age > TOAST_TTL_MS - 400 ? 1 - (age - (TOAST_TTL_MS - 400)) / 400 : 1
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0, fade))
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y - lift}px)`
    }

    // Sleeping Zzz — emit every ~2s while sleeping (suppressed in photo mode)
    if (!photoOn) {
    for (const agent of agents) {
      if (!isPerformingSleep(agent)) {
        lastZzzByAgent.delete(agent.id)
        continue
      }
      const last = lastZzzByAgent.get(agent.id) ?? 0
      if (now - last >= 2000) {
        lastZzzByAgent.set(agent.id, now)
        spawnZzz(agent.id, now)
      }
    }
    } else {
      for (const slot of zzzPool) {
        slot.el.style.display = 'none'
      }
    }
    for (const slot of zzzPool) {
      if (photoOn) {
        slot.el.style.display = 'none'
        continue
      }
      if (!slot.active || !slot.agentId) continue
      const age = now - slot.born
      if (age >= ZZZ_TTL_MS) {
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
      const lift = (age / ZZZ_TTL_MS) * 42
      const drift = (age / ZZZ_TTL_MS) * 18
      const screen = project(
        pos.x,
        HEAD_Y + 0.35,
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
      const fade = age > ZZZ_TTL_MS - 500 ? 1 - (age - (ZZZ_TTL_MS - 500)) / 500 : 1
      const size = 12 + (age / ZZZ_TTL_MS) * 6
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0, fade * 0.9))
      slot.el.style.fontSize = `${size}px`
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x + drift}px, ${screen.y - lift}px)`
    }

    // Twin hearts float over midpoint of pair (suppressed in photo mode)
    for (const slot of heartPool) {
      if (photoOn) {
        slot.el.style.display = 'none'
        continue
      }
      if (!slot.active || !slot.agentIdA || !slot.agentIdB) continue
      const age = now - slot.born
      if (age >= HEART_TTL_MS) {
        slot.active = false
        slot.agentIdA = null
        slot.agentIdB = null
        slot.el.style.display = 'none'
        continue
      }
      const aA = byId.get(slot.agentIdA)
      const aB = byId.get(slot.agentIdB)
      if (!aA || !aB) {
        slot.active = false
        slot.el.style.display = 'none'
        continue
      }
      const pA = interpPos(aA, prev, alpha)
      const pB = interpPos(aB, prev, alpha)
      const mx = (pA.x + pB.x) / 2
      const mz = (pA.z + pB.z) / 2
      const lift = (age / HEART_TTL_MS) * 40
      const screen = project(mx, HEAD_Y + 0.5, mz, camera, width, height, proj)
      if (screen.behind) {
        slot.el.style.opacity = '0'
        continue
      }
      const fade = age > HEART_TTL_MS - 400 ? 1 - (age - (HEART_TTL_MS - 400)) / 400 : 1
      slot.el.style.display = 'block'
      slot.el.style.opacity = String(Math.max(0, fade))
      slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y - lift}px)`
    }

    // Reset indicators then rebuild (skip place chrome in photo mode)
    for (const ind of indicators) {
      ind.active = false
      ind.placeId = null
      ind.el.style.display = 'none'
    }

    if (photoOn) {
      setTooltip(null, 0, 0)
      return
    }

    const hour = time?.hour ?? 12
    const hiringHours = hour >= 6 && hour < 17

    for (const place of places) {
      const baseY = 1.15
      const screen = project(place.x, baseY, place.y, camera, width, height, proj)
      if (screen.behind) continue

      // Production progress ring while actively worked
      if (
        place.production &&
        placeActivelyWorked(place, agents) &&
        (place.growth ?? 0) > 0.01
      ) {
        const slot = takeIndicator()
        if (slot) {
          slot.active = true
          slot.kind = 'progress'
          slot.placeId = place.id
          const pct = Math.round(Math.max(0, Math.min(1, place.growth ?? 0)) * 100)
          slot.el.innerHTML = renderRingHtml(pct)
          slot.el.dataset.testid = 'prod-ring'
          slot.el.style.display = 'block'
          slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
        }
      }

      // Material chips + bar on construction sites
      if (place.kind === 'construction-site' && place.construction) {
        const slot = takeIndicator()
        if (slot) {
          slot.active = true
          slot.kind = 'materials'
          slot.placeId = place.id
          const c = place.construction
          const inv = place.inventory
          const woodHave = Math.min(
            HOME_BILL.wood,
            HOME_BILL.wood - (c.needs?.wood ?? 0) + (inv?.wood ?? 0),
          )
          const stoneHave = Math.min(
            HOME_BILL.stone,
            HOME_BILL.stone - (c.needs?.stone ?? 0) + (inv?.stone ?? 0),
          )
          const pct = Math.round(Math.max(0, Math.min(1, c.progress ?? 0)) * 100)
          slot.el.innerHTML = `<div data-testid="material-chips" style="
            background:rgba(12,16,28,0.82);border:1px solid rgba(255,255,255,0.12);
            border-radius:10px;padding:4px 8px;color:#f2f4f8;font-size:11px;font-weight:700;
            font-family:system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.35);
            text-align:center;min-width:90px">
            <div>🪵 ${woodHave}/${HOME_BILL.wood} 🪨 ${stoneHave}/${HOME_BILL.stone}</div>
            <div style="margin-top:3px;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);overflow:hidden">
              <div style="width:${pct}%;height:100%;background:#c4a574;border-radius:2px"></div>
            </div>
          </div>`
          slot.el.style.display = 'block'
          slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`
        }
      }

      // Hiring badge
      if (hiringHours && openJobSlots(place, agents) > 0) {
        const slot = takeIndicator()
        if (slot) {
          slot.active = true
          slot.kind = 'hiring'
          slot.placeId = place.id
          const bounce = Math.sin(now / 180) * 4
          slot.el.innerHTML = `<div data-testid="hiring-badge" style="
            background:#e0a040;color:#1a1208;font-weight:800;font-size:14px;
            width:22px;height:22px;border-radius:11px;display:flex;align-items:center;
            justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);
            border:2px solid #fff3c8;font-family:system-ui,sans-serif">!</div>`
          slot.el.style.display = 'block'
          slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y - 18 - bounce}px)`
        }
      }

      // Ripe badge on farms
      if (place.kind === 'farm' && (place.inventory?.food ?? 0) >= 5) {
        const slot = takeIndicator()
        if (slot) {
          slot.active = true
          slot.kind = 'ripe'
          slot.placeId = place.id
          slot.el.innerHTML = `<div data-testid="ripe-badge" style="
            background:rgba(40,90,40,0.9);color:#c8f0c0;font-size:11px;font-weight:700;
            padding:3px 7px;border-radius:8px;border:1px solid rgba(160,220,140,0.4);
            font-family:system-ui,sans-serif">🫐 Ripe</div>`
          slot.el.style.display = 'block'
          // Offset if hiring also present
          const yOff = hiringHours && openJobSlots(place, agents) > 0 ? 28 : 0
          slot.el.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y - yOff}px)`
        }
      }
    }
  }

  const dispose = () => {
    if (root.parentElement === container) container.removeChild(root)
    if (tooltipEl.parentElement) tooltipEl.parentElement.removeChild(tooltipEl)
  }

  return {
    updateFrame,
    pushCritical,
    pushToast,
    pushHearts,
    pushSpeech,
    setTooltip,
    setPhotoSubject,
    clearEphemeral,
    dispose,
  }
}

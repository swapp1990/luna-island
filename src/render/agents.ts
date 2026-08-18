import * as THREE from 'three'
import type { AgentState, Good, Place, SimEvent } from '../sim/types'
import { isLunaAgent } from '../mind/personas'
import type { FxHandle } from './fx'
import {
  describeAgent,
  describeDestination,
  describeFacingTarget,
  describeSpeechBubbles,
  examineTargetId,
  GLYPH_EMOJI,
  type GlyphKind,
  type PostureKind,
  type PropKind,
} from './actionLanguage'

const BODY_H = 0.55
const HEAD_R = 0.16
const BODY_R = 0.14
const GROUND_Y = 0.22
const BOB_AMP = 0.04
const BOB_FREQ = 14
const LEAN = 0.12
const WORK_LEAN = 0.18
const HEAD_Y = GROUND_Y + BODY_H + HEAD_R * 0.85
const HAT_Y = HEAD_Y + HEAD_R * 0.55
const EYE_R_SHEEP = 0.036
const EYE_R_MIND = 0.041
const ARM_R = 0.038
const ARM_LEN = 0.22
const SHOULDER_Y = GROUND_Y + BODY_H * 0.78
const SHOULDER_X = BODY_R * 0.95
const ARM_SWING = (18 * Math.PI) / 180
const WOOL_CREAM = 0xf3eee3

/** Per-Luna accent — 6 distinct hues that read against body tints, day and night. */
const MIND_ACCENT: Record<string, number> = {
  'agent-0': 0xd94a62,
  'agent-1': 0x2f8f6a,
  'agent-2': 0xd07a18,
  'agent-4': 0x7a3cb8,
  'agent-8': 0x2a6dcc,
  'agent-11': 0xc44e22,
}

const CARRY_TINT: Record<Good, number> = {
  food: 0x5aaf4a,
  wood: 0x8b6914,
  stone: 0x8a8f98,
}

const HAT_COLORS = {
  farm: 0xe0c068,
  stall: 0xc94f4f,
  forestry: 0x3d7d46,
  quarry: 0xc9b52a,
  'construction-site': 0xc9b52a,
} as const

type HatKind = keyof typeof HAT_COLORS
type ToolKind = 'hoe' | 'axe' | 'pick' | 'hammer' | 'berry' | 'mug' | 'scroll'

export interface AgentsHandle {
  root: THREE.Group
  /** Call each frame with current agent states, interp alpha, selection. */
  update: (
    agents: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId?: string | null,
    places?: Place[],
    now?: number,
    fx?: FxHandle | null,
    treePositions?: Array<{ x: number; z: number }>,
    onTreeHit?: (x: number, z: number, now: number) => void,
    tick?: number,
    events?: readonly SimEvent[],
    settle?: boolean,
    photoSubjectId?: string | null,
  ) => void
  /** Mesh list for raycasting (pickables). */
  getPickables: () => THREE.Object3D[]
  /** Resolve a intersected object to agent id. */
  agentIdFromObject: (obj: THREE.Object3D) => string | null
  /** Visible hat / tool counts for DEV probe. */
  getJuiceCounts: () => { hats: number; tools: number; destMarkers: number }
  /** Mesh facing for portrait framing (render-only). */
  getFacing: (id: string) => {
    x: number
    y: number
    z: number
    yaw: number
    rx: number
    hat: boolean
    variant: 'mind' | 'sheep'
  } | null
  /** Interaction-staging probe (speech / glyph place / scroll / ceremony flags). */
  getStaging: (id: string) => {
    speechText: string | null
    speechVisible: boolean
    glyphPlaceId: string | null
    glyphVisible: boolean
    prop: PropKind | null
    faceId: string | null
    faceKind: 'agent' | 'place' | null
    yaw: number
  } | null
  dispose: () => void
}

function parseColor(hex: string): THREE.Color {
  return new THREE.Color(hex)
}

function lighten(hex: string, amount: number): THREE.Color {
  const c = parseColor(hex)
  c.offsetHSL(0, 0, amount)
  return c
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

function makeGlyphTexture(kind: GlyphKind): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 96
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 96, 96)
  if (kind === 'collapsed') {
    ctx.beginPath()
    ctx.arc(48, 48, 40, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(160, 20, 20, 0.72)'
    ctx.fill()
  } else if (kind === 'examine') {
    // High-contrast disc — place-hero stills need this against sky/foliage.
    ctx.beginPath()
    ctx.arc(48, 48, 44, 0, Math.PI * 2)
    ctx.fillStyle = '#f5d76e'
    ctx.fill()
    ctx.strokeStyle = '#1c2333'
    ctx.lineWidth = 5
    ctx.stroke()
  }
  ctx.font = '64px system-ui, Segoe UI Emoji, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = kind === 'collapsed' ? '#ffe0e0' : kind === 'examine' ? '#1c2333' : '#f4f6fa'
  ctx.strokeStyle = kind === 'examine' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)'
  ctx.lineWidth = 4
  const emoji = GLYPH_EMOJI[kind]
  ctx.strokeText(emoji, 48, 52)
  ctx.fillText(emoji, 48, 52)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

/** Photo-safe speech bubble (HTML overlays do not composite into stills). */
function makeSpeechTexture(raw: string): THREE.CanvasTexture {
  // ASCII-safe: same font stack as makeGlyphTexture (proven in headless stills).
  const text = raw
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '?')
  const padX = 24
  const padY = 20
  const maxInner = 420
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  // Match glyph channel — known to fillText under Playwright headless.
  ctx.font = '28px system-ui, Segoe UI, Arial, sans-serif'
  const lines: string[] = []
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > maxInner && line) {
      lines.push(line)
      line = w
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  const use = (lines.length ? lines : [text.slice(0, 40) || '...']).slice(0, 4)
  const lineH = 34
  const textW = Math.max(100, ...use.map((l) => ctx.measureText(l).width))
  const boxH = padY * 2 + use.length * lineH
  const boxW = Math.min(480, textW + padX * 2)
  const bx = (c.width - boxW) / 2
  const by = 24
  ctx.fillStyle = 'rgba(28, 35, 51, 0.95)'
  ctx.beginPath()
  const r = 16
  ctx.moveTo(bx + r, by)
  ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r)
  ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r)
  ctx.arcTo(bx, by + boxH, bx, by, r)
  ctx.arcTo(bx, by, bx + boxW, by, r)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.5)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(c.width / 2 - 12, by + boxH)
  ctx.lineTo(c.width / 2, by + boxH + 16)
  ctx.lineTo(c.width / 2 + 12, by + boxH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(28, 35, 51, 0.95)'
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < use.length; i++) {
    const ty = by + padY + lineH * (i + 0.42)
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'
    ctx.lineWidth = 3
    ctx.strokeText(use[i]!, c.width / 2, ty)
    ctx.fillStyle = '#f4f6fa'
    ctx.fillText(use[i]!, c.width / 2, ty)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

interface ToolMeshes {
  hoe: THREE.Group
  axe: THREE.Group
  pick: THREE.Group
  hammer: THREE.Group
  berry: THREE.Group
  mug: THREE.Group
  scroll: THREE.Group
}

interface AgentMesh {
  id: string
  group: THREE.Group
  body: THREE.Mesh
  head: THREE.Mesh
  bodyMat: THREE.MeshStandardMaterial
  headMat: THREE.MeshStandardMaterial
  baseBody: THREE.Color
  baseHead: THREE.Color
  /** Accumulated distance for walk bob phase. */
  walkDist: number
  lastX: number
  lastZ: number
  /** Small crate/sack on back when carrying goods. */
  carryMesh: THREE.Mesh
  carryMat: THREE.MeshStandardMaterial
  /** Phase offset 0–1 for desynced crew anims. */
  phase: number
  hatRoot: THREE.Group
  hatFarm: THREE.Object3D
  hatStall: THREE.Object3D
  hatCap: THREE.Object3D
  hatHelmet: THREE.Object3D
  tools: ToolMeshes
  toolRoot: THREE.Group
  /** Last work-swing apex phase bin (0/1) for one-shot particle triggers. */
  lastApexBin: number
  poseInited: boolean
  poseY: number
  poseRx: number
  poseRy: number
  poseRz: number
  poseSy: number
  poseHeadY: number
  lastPosture: PostureKind
  glyphSprite: THREE.Sprite
  glyphKind: GlyphKind | null
  glyphPlaceId: string | null
  speechSprite: THREE.Sprite
  speechMat: THREE.SpriteMaterial
  speechText: string | null
  stagingFaceId: string | null
  stagingFaceKind: 'agent' | 'place' | null
  stagingProp: PropKind | null
  variant: 'mind' | 'sheep'
  eyeL: THREE.Mesh
  eyeR: THREE.Mesh
  armLRoot: THREE.Group
  armRRoot: THREE.Group
  woolRoot: THREE.Group | null
  hairMesh: THREE.Object3D | null
  scarfMesh: THREE.Object3D | null
}

function primaryCarryGood(agent: AgentState): Good | null {
  if (agent.haulGood && agent.haulAmount > 0) return agent.haulGood
  const inv = agent.inventory
  if (!inv) return null
  if ((inv.food ?? 0) > 0) return 'food'
  if ((inv.wood ?? 0) > 0) return 'wood'
  if ((inv.stone ?? 0) > 0) return 'stone'
  return null
}

function isOnPath(agent: AgentState): boolean {
  const path = agent.action.path
  return !!(path && path.length > 0 && agent.pathIndex < path.length)
}

function isPerformingSocial(agent: AgentState): boolean {
  return (
    agent.action.kind === 'socialize' &&
    (agent.action.path === undefined ||
      agent.pathIndex >= (agent.action.path?.length ?? 0))
  )
}

function isPerformingWork(agent: AgentState): boolean {
  if (agent.action.kind !== 'work') return false
  return !isOnPath(agent)
}

function isHauling(agent: AgentState): boolean {
  return agent.workPhase === 'hauling' || agent.workPhase === 'returning'
}

function jobKindFromPlace(place: Place | undefined): HatKind | null {
  if (!place) return null
  if (place.kind === 'farm') return 'farm'
  if (place.kind === 'stall') return 'stall'
  if (place.kind === 'forestry') return 'forestry'
  if (place.kind === 'quarry') return 'quarry'
  if (place.kind === 'construction-site') return 'construction-site'
  return null
}

function toolForJob(job: HatKind | null, hauling: boolean): ToolKind | null {
  if (!job || hauling) return null
  if (job === 'farm') return 'hoe'
  if (job === 'forestry') return 'axe'
  if (job === 'quarry') return 'pick'
  if (job === 'construction-site') return 'hammer'
  return null
}

function buildHoe(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const bladeMat = track(new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.55, metalness: 0.35 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 6)), stickMat)
  stick.position.y = 0.21
  g.add(stick)
  const blade = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.03, 0.06)), bladeMat)
  blade.position.set(0.05, 0.02, 0)
  g.add(blade)
  return g
}

function buildAxe(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.4 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6)), stickMat)
  stick.position.y = 0.2
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.08, 0.04)), headMat)
  head.position.set(0.06, 0.38, 0)
  g.add(head)
  return g
}

function buildPick(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.4 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6)), stickMat)
  stick.position.y = 0.2
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.04, 0.04)), headMat)
  head.position.set(0, 0.38, 0)
  g.add(head)
  return g
}

function buildHammer(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const stickMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }))
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.55, metalness: 0.35 }))
  const stick = new THREE.Mesh(track(new THREE.CylinderGeometry(0.02, 0.022, 0.32, 6)), stickMat)
  stick.position.y = 0.16
  g.add(stick)
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.08, 0.06)), headMat)
  head.position.set(0, 0.32, 0)
  g.add(head)
  return g
}

function buildBerry(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const berryMat = track(new THREE.MeshStandardMaterial({ color: 0xc43b4e, roughness: 0.55 }))
  const leafMat = track(new THREE.MeshStandardMaterial({ color: 0x3d8a4a, roughness: 0.8 }))
  const berry = new THREE.Mesh(track(new THREE.SphereGeometry(0.055, 8, 6)), berryMat)
  berry.position.y = 0.06
  g.add(berry)
  const leaf = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 0.015, 0.03)), leafMat)
  leaf.position.set(0.02, 0.11, 0)
  g.add(leaf)
  return g
}

function buildMug(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const mugMat = track(new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.7 }))
  const cup = new THREE.Mesh(track(new THREE.CylinderGeometry(0.045, 0.04, 0.08, 8)), mugMat)
  cup.position.y = 0.05
  g.add(cup)
  const handle = new THREE.Mesh(track(new THREE.TorusGeometry(0.028, 0.008, 6, 10, Math.PI)), mugMat)
  handle.rotation.y = Math.PI / 2
  handle.position.set(0.05, 0.05, 0)
  g.add(handle)
  return g
}

/** Blueprint / commission scroll held during construction:commissioned window. */
function buildScroll(track: <T extends { dispose: () => void }>(o: T) => T): THREE.Group {
  const g = new THREE.Group()
  const paper = track(
    new THREE.MeshStandardMaterial({
      color: 0xe8d9b0,
      roughness: 0.85,
      emissive: 0x3a3020,
      emissiveIntensity: 0.08,
    }),
  )
  const rod = track(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 }))
  const sheet = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.18, 0.012)), paper)
  sheet.position.y = 0.1
  g.add(sheet)
  const top = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6)), rod)
  top.rotation.z = Math.PI / 2
  top.position.y = 0.19
  g.add(top)
  const bot = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6)), rod)
  bot.rotation.z = Math.PI / 2
  bot.position.y = 0.01
  g.add(bot)
  // Tiny ink mark so it reads as a blueprint, not a blank card
  const ink = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.08, 0.01, 0.014)),
    track(new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.6 })),
  )
  ink.position.set(0, 0.12, 0.002)
  g.add(ink)
  return g
}

function shortestAngle(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export function createAgents(scene: THREE.Scene, agents: AgentState[]): AgentsHandle {
  const root = new THREE.Group()
  root.name = 'agents'
  scene.add(root)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(obj: T): T => {
    disposables.push(obj)
    return obj
  }

  const meshes = new Map<string, AgentMesh>()
  const objectToId = new Map<THREE.Object3D, string>()

  const bodyGeo = track(new THREE.CylinderGeometry(BODY_R * 0.85, BODY_R, BODY_H, 10))
  const headGeo = track(new THREE.SphereGeometry(HEAD_R, 12, 10))
  const carryGeo = track(new THREE.BoxGeometry(0.16, 0.14, 0.12))
  const eyeGeoSheep = track(new THREE.SphereGeometry(EYE_R_SHEEP, 8, 6))
  const eyeGeoMind = track(new THREE.SphereGeometry(EYE_R_MIND, 8, 6))
  const armGeo = track(new THREE.CapsuleGeometry(ARM_R, ARM_LEN, 3, 6))
  const woolGeoA = track(new THREE.SphereGeometry(0.086, 8, 6))
  const woolGeoB = track(new THREE.SphereGeometry(0.07, 8, 6))
  const woolGeoC = track(new THREE.SphereGeometry(0.064, 8, 6))
  const hairGeo = track(new THREE.SphereGeometry(HEAD_R * 1.08, 10, 8))
  const scarfGeo = track(new THREE.TorusGeometry(0.128, 0.02, 6, 12))

  const eyeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1a1520,
      roughness: 0.42,
      metalness: 0.04,
      emissive: 0x0c0a10,
      emissiveIntensity: 0.28,
    }),
  )
  const woolMat = track(
    new THREE.MeshStandardMaterial({
      color: WOOL_CREAM,
      roughness: 0.94,
      metalness: 0,
    }),
  )
  const mindAccentMats = new Map<string, THREE.MeshStandardMaterial>()
  for (const [id, hex] of Object.entries(MIND_ACCENT)) {
    mindAccentMats.set(
      id,
      track(
        new THREE.MeshStandardMaterial({
          color: hex,
          roughness: 0.62,
          metalness: 0.08,
          emissive: hex,
          emissiveIntensity: 0.12,
        }),
      ),
    )
  }

  // Shared hat geometries
  const strawGeo = track(new THREE.ConeGeometry(0.22, 0.08, 10))
  const kerchiefGeo = track(new THREE.BoxGeometry(0.18, 0.06, 0.14))
  const capGeo = track(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2))
  const helmetGeo = track(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2))

  const strawMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.farm, roughness: 0.9 }))
  const kerchiefMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.stall, roughness: 0.85 }))
  const capMat = track(new THREE.MeshStandardMaterial({ color: HAT_COLORS.forestry, roughness: 0.8 }))
  const helmetMat = track(
    new THREE.MeshStandardMaterial({ color: HAT_COLORS.quarry, roughness: 0.55, metalness: 0.25 }),
  )

  const glyphTex: Record<GlyphKind, THREE.CanvasTexture> = {
    collapsed: track(makeGlyphTexture('collapsed')),
    hunger: track(makeGlyphTexture('hunger')),
    energy: track(makeGlyphTexture('energy')),
    social: track(makeGlyphTexture('social')),
    examine: track(makeGlyphTexture('examine')),
    sleep: track(makeGlyphTexture('sleep')),
  }
  const glyphMats: Record<GlyphKind, THREE.SpriteMaterial> = {
    collapsed: track(
      new THREE.SpriteMaterial({
        map: glyphTex.collapsed,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    ),
    hunger: track(new THREE.SpriteMaterial({ map: glyphTex.hunger, transparent: true, depthTest: false, depthWrite: false })),
    energy: track(new THREE.SpriteMaterial({ map: glyphTex.energy, transparent: true, depthTest: false, depthWrite: false })),
    social: track(new THREE.SpriteMaterial({ map: glyphTex.social, transparent: true, depthTest: false, depthWrite: false })),
    examine: track(new THREE.SpriteMaterial({ map: glyphTex.examine, transparent: true, depthTest: false, depthWrite: false })),
    sleep: track(new THREE.SpriteMaterial({ map: glyphTex.sleep, transparent: true, depthTest: false, depthWrite: false })),
  }

  for (const agent of agents) {
    const group = new THREE.Group()
    group.name = agent.id
    group.userData.agentId = agent.id

    const baseBody = parseColor(agent.color)
    const baseHead = lighten(agent.color, 0.12)
    const bodyMat = track(
      new THREE.MeshStandardMaterial({
        color: baseBody.clone(),
        roughness: 0.75,
        metalness: 0.05,
      }),
    )
    const headMat = track(
      new THREE.MeshStandardMaterial({
        color: baseHead.clone(),
        roughness: 0.65,
        metalness: 0.05,
      }),
    )

    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = GROUND_Y + BODY_H / 2
    body.castShadow = true
    body.receiveShadow = true
    body.userData.agentId = agent.id
    group.add(body)

    const head = new THREE.Mesh(headGeo, headMat)
    head.position.y = HEAD_Y
    head.castShadow = true
    head.userData.agentId = agent.id
    group.add(head)

    const mind = isLunaAgent(agent.id)
    const eyeGeo = mind ? eyeGeoMind : eyeGeoSheep
    const eyeX = HEAD_R * (mind ? 0.36 : 0.33)
    const eyeY = HEAD_R * 0.08
    const eyeZ = HEAD_R * 0.84
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
    eyeL.position.set(-eyeX, eyeY, eyeZ)
    eyeL.castShadow = false
    head.add(eyeL)
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
    eyeR.position.set(eyeX, eyeY, eyeZ)
    eyeR.castShadow = false
    head.add(eyeR)

    const armLRoot = new THREE.Group()
    armLRoot.position.set(-SHOULDER_X, SHOULDER_Y, 0)
    const armL = new THREE.Mesh(armGeo, bodyMat)
    armL.position.y = -(ARM_LEN / 2 + ARM_R)
    armL.castShadow = true
    armL.userData.agentId = agent.id
    armLRoot.add(armL)
    group.add(armLRoot)

    const armRRoot = new THREE.Group()
    armRRoot.position.set(SHOULDER_X, SHOULDER_Y, 0)
    const armR = new THREE.Mesh(armGeo, bodyMat)
    armR.position.y = -(ARM_LEN / 2 + ARM_R)
    armR.castShadow = true
    armR.userData.agentId = agent.id
    armRRoot.add(armR)
    group.add(armRRoot)

    let woolRoot: THREE.Group | null = null
    let hairMesh: THREE.Object3D | null = null
    let scarfMesh: THREE.Object3D | null = null
    if (mind) {
      const accent = mindAccentMats.get(agent.id) ?? eyeMat
      const hair = new THREE.Mesh(hairGeo, accent)
      hair.scale.set(1.02, 0.52, 1.04)
      hair.position.set(0, HEAD_R * 0.42, -0.012)
      hair.castShadow = true
      head.add(hair)
      hairMesh = hair
      const scarf = new THREE.Mesh(scarfGeo, accent)
      scarf.rotation.x = Math.PI / 2
      scarf.position.y = GROUND_Y + BODY_H - 0.055
      scarf.castShadow = true
      group.add(scarf)
      scarfMesh = scarf
    } else {
      woolRoot = new THREE.Group()
      const h = hashId(agent.id)
      const puffN = 3 + (h % 3)
      const puffs: Array<{ geo: THREE.SphereGeometry; x: number; y: number; z: number }> = [
        { geo: woolGeoA, x: 0, y: HEAD_R * 0.7, z: 0.01 },
        { geo: woolGeoB, x: -0.108, y: HEAD_R * 0.26, z: 0.05 },
        { geo: woolGeoB, x: 0.108, y: HEAD_R * 0.26, z: 0.05 },
        { geo: woolGeoC, x: 0.01, y: HEAD_R * 0.36, z: -0.1 },
        { geo: woolGeoC, x: 0, y: HEAD_R * 0.58, z: 0.06 },
      ]
      for (let i = 0; i < puffN; i++) {
        const p = puffs[i]!
        const jitter = ((h >> (i * 3)) % 7) / 220
        const puff = new THREE.Mesh(p.geo, woolMat)
        puff.position.set(p.x + jitter, p.y, p.z - jitter * 0.4)
        puff.castShadow = true
        woolRoot.add(puff)
      }
      head.add(woolRoot)
    }

    const carryMat = track(
      new THREE.MeshStandardMaterial({
        color: CARRY_TINT.food,
        roughness: 0.85,
        metalness: 0.05,
      }),
    )
    const carryMesh = new THREE.Mesh(carryGeo, carryMat)
    carryMesh.position.set(0, GROUND_Y + BODY_H * 0.55, -BODY_R - 0.06)
    carryMesh.castShadow = true
    carryMesh.visible = false
    carryMesh.userData.agentId = agent.id
    group.add(carryMesh)

    // Hats (shared geos, per-agent mats already shared — fine for low-poly)
    const hatRoot = new THREE.Group()
    hatRoot.position.y = HAT_Y
    const hatFarm = new THREE.Mesh(strawGeo, strawMat)
    hatFarm.rotation.x = Math.PI // flat brim sits on head
    hatFarm.position.y = 0.02
    hatFarm.visible = false
    hatRoot.add(hatFarm)
    const hatStall = new THREE.Mesh(kerchiefGeo, kerchiefMat)
    hatStall.position.y = 0.02
    hatStall.visible = false
    hatRoot.add(hatStall)
    const hatCap = new THREE.Mesh(capGeo, capMat)
    hatCap.position.y = 0.01
    hatCap.visible = false
    hatRoot.add(hatCap)
    const hatHelmet = new THREE.Mesh(helmetGeo, helmetMat)
    hatHelmet.position.y = 0.01
    hatHelmet.visible = false
    hatRoot.add(hatHelmet)
    group.add(hatRoot)

    // Tools — grip at right hip, swung via toolRoot rotation
    const toolRoot = new THREE.Group()
    toolRoot.position.set(0.14, GROUND_Y + BODY_H * 0.55, 0.06)
    const hoe = buildHoe(track)
    const axe = buildAxe(track)
    const pick = buildPick(track)
    const hammer = buildHammer(track)
    const berry = buildBerry(track)
    const mug = buildMug(track)
    const scroll = buildScroll(track)
    for (const t of [hoe, axe, pick, hammer, berry, mug, scroll]) {
      t.visible = false
      toolRoot.add(t)
    }
    group.add(toolRoot)

    const glyphSprite = new THREE.Sprite(glyphMats.examine)
    glyphSprite.position.set(agent.x, HEAD_Y + 0.52, agent.y)
    glyphSprite.scale.set(0.45, 0.45, 1)
    glyphSprite.visible = false
    glyphSprite.renderOrder = 80
    glyphSprite.userData.agentId = agent.id
    root.add(glyphSprite)

    const speechMat = track(
      new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 1,
        color: 0xffffff,
        sizeAttenuation: true,
      }),
    )
    const speechSprite = new THREE.Sprite(speechMat)
    speechSprite.scale.set(2.2, 1.1, 1)
    speechSprite.visible = false
    speechSprite.renderOrder = 85
    speechSprite.userData.agentId = agent.id
    root.add(speechSprite)

    group.position.set(agent.x, 0, agent.y)
    root.add(group)

    objectToId.set(group, agent.id)
    objectToId.set(body, agent.id)
    objectToId.set(head, agent.id)
    objectToId.set(carryMesh, agent.id)

    meshes.set(agent.id, {
      id: agent.id,
      group,
      body,
      head,
      bodyMat,
      headMat,
      baseBody,
      baseHead,
      walkDist: 0,
      lastX: agent.x,
      lastZ: agent.y,
      carryMesh,
      carryMat,
      phase: (hashId(agent.id) % 1000) / 1000,
      hatRoot,
      hatFarm,
      hatStall,
      hatCap,
      hatHelmet,
      tools: { hoe, axe, pick, hammer, berry, mug, scroll },
      toolRoot,
      lastApexBin: -1,
      poseInited: false,
      poseY: 0,
      poseRx: 0,
      poseRy: 0,
      poseRz: 0,
      poseSy: 1,
      poseHeadY: HEAD_Y,
      lastPosture: 'standing',
      glyphSprite,
      glyphKind: null,
      glyphPlaceId: null,
      speechSprite,
      speechMat,
      speechText: null,
      stagingFaceId: null,
      stagingFaceKind: null,
      stagingProp: null,
      variant: mind ? 'mind' : 'sheep',
      eyeL,
      eyeR,
      armLRoot,
      armRRoot,
      woolRoot,
      hairMesh,
      scarfMesh,
    })
  }

  // Selection ring (agent)
  const ringGeo = track(new THREE.RingGeometry(0.28, 0.4, 32))
  const ringMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = 999
  ring.rotation.x = -Math.PI / 2
  ring.position.y = GROUND_Y + 0.04
  ring.visible = false
  root.add(ring)

  const placeRingGeo = track(new THREE.RingGeometry(0.55, 0.78, 40))
  const placeRingMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  const placeRing = new THREE.Mesh(placeRingGeo, placeRingMat)
  placeRing.renderOrder = 999
  placeRing.rotation.x = -Math.PI / 2
  placeRing.position.y = GROUND_Y + 0.04
  placeRing.visible = false
  root.add(placeRing)

  const destGeo = track(new THREE.CircleGeometry(0.2, 20))
  const destMat = track(
    new THREE.MeshBasicMaterial({
      color: 0xffe7a0,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const destDisc = new THREE.Mesh(destGeo, destMat)
  destDisc.name = 'dest-marker'
  destDisc.renderOrder = 998
  destDisc.rotation.x = -Math.PI / 2
  destDisc.position.y = GROUND_Y + 0.03
  destDisc.visible = false
  root.add(destDisc)

  let hatCount = 0
  let toolCount = 0
  let destMarkerCount = 0

  const setHat = (m: AgentMesh, job: HatKind | null) => {
    m.hatFarm.visible = job === 'farm'
    m.hatStall.visible = job === 'stall'
    m.hatCap.visible = job === 'forestry'
    m.hatHelmet.visible = job === 'quarry' || job === 'construction-site'
  }

  const setTool = (m: AgentMesh, tool: ToolKind | null) => {
    m.tools.hoe.visible = tool === 'hoe'
    m.tools.axe.visible = tool === 'axe'
    m.tools.pick.visible = tool === 'pick'
    m.tools.hammer.visible = tool === 'hammer'
    m.tools.berry.visible = tool === 'berry'
    m.tools.mug.visible = tool === 'mug'
    m.tools.scroll.visible = tool === 'scroll'
    m.toolRoot.visible = tool !== null
  }

  const applyPose = (
    m: AgentMesh,
    x: number,
    z: number,
    targetY: number,
    targetRx: number,
    targetRy: number,
    targetRz: number,
    targetSy: number,
    targetHeadY: number,
    settle: boolean,
  ) => {
    if (!m.poseInited || settle) {
      m.poseY = targetY
      m.poseRx = targetRx
      m.poseRy = targetRy
      m.poseRz = targetRz
      m.poseSy = targetSy
      m.poseHeadY = targetHeadY
      m.poseInited = true
    } else {
      const k = 0.42
      m.poseY += (targetY - m.poseY) * k
      m.poseRx += (targetRx - m.poseRx) * k
      m.poseRy += shortestAngle(m.poseRy, targetRy) * k
      m.poseRz += (targetRz - m.poseRz) * k
      m.poseSy += (targetSy - m.poseSy) * k
      m.poseHeadY += (targetHeadY - m.poseHeadY) * k
    }
    m.group.position.set(x, m.poseY, z)
    m.group.rotation.set(m.poseRx, m.poseRy, m.poseRz)
    m.group.scale.set(1, m.poseSy, 1)
    m.head.position.y = m.poseHeadY
  }

  const applyCharm = (
    m: AgentMesh,
    posture: PostureKind,
    simT: number,
    walkPhase = 0,
    workSwing = 0,
  ) => {
    const cycle = simT * 0.58 + m.phase * 13.7
    const frac = cycle - Math.floor(cycle)
    const closed = frac < 0.065 ? Math.sin((frac / 0.065) * Math.PI) : 0
    const eyeSy = 1 - closed * 0.9
    m.eyeL.scale.set(1, eyeSy, 1)
    m.eyeR.scale.set(1, eyeSy, 1)

    const restZ = 0.14
    let lrx = 0
    let lrz = restZ
    let rrx = 0
    let rrz = -restZ
    if (posture === 'walking') {
      const swing = Math.sin(walkPhase) * ARM_SWING
      lrx = swing
      rrx = -swing
    } else if (posture === 'working') {
      const raise = -0.48 - Math.max(0, workSwing) * 0.62
      lrx = raise
      rrx = raise
      lrz = 0.18
      rrz = -0.18
    } else if (posture === 'sitting') {
      rrx = -1.08
      rrz = -0.26
      lrx = 0.12
      lrz = 0.2
    } else if (posture === 'lying') {
      lrx = 0.1
      lrz = 0.4
      rrx = 0.1
      rrz = -0.4
    } else if (posture === 'fallen') {
      lrx = 0.28
      lrz = 1.22
      rrx = 0.34
      rrz = -1.22
    } else if (posture === 'lean-in') {
      rrx = -0.48
      rrz = -0.1
      lrx = 0.06
    } else if (posture === 'socializing') {
      lrz = 0.22
      rrz = -0.22
    }
    m.armLRoot.rotation.set(lrx, 0, lrz)
    m.armRRoot.rotation.set(rrx, 0, rrz)

    if (m.woolRoot) {
      const hatOn =
        m.hatFarm.visible || m.hatStall.visible || m.hatCap.visible || m.hatHelmet.visible
      const s = hatOn ? 0.88 : 1
      m.woolRoot.scale.setScalar(s)
      m.woolRoot.position.y = hatOn ? -0.006 : 0
    }
  }

  const applyGlyph = (
    m: AgentMesh,
    agentId: string,
    kind: GlyphKind | null,
    x: number,
    z: number,
    posture: PostureKind,
    subjectId: string | null,
    glyphPlaceId: string | null,
    placeById: Map<string, Place>,
  ) => {
    // Track place id for probes even when the 3D sprite is photo-only.
    m.glyphPlaceId = kind === 'examine' ? glyphPlaceId : null
    // 3D sprites are the photo-safe channel; live HUD uses HTML overlays.
    // Examine glyph may hover the TARGET place (interaction staging).
    const show =
      !!kind &&
      subjectId !== null &&
      (subjectId === agentId || (kind === 'examine' && !!glyphPlaceId))
    if (!show || !kind) {
      m.glyphSprite.visible = false
      m.glyphKind = null
      return
    }
    if (m.glyphKind !== kind) {
      m.glyphKind = kind
      m.glyphSprite.material = glyphMats[kind]
    }
    let gx = x
    let gz = z
    let gy = posture === 'fallen' || posture === 'lying' ? 0.5 : HEAD_Y + 0.55
    let gScale = 0.45
    if (kind === 'examine' && glyphPlaceId) {
      const place = placeById.get(glyphPlaceId)
      if (place) {
        gx = place.x
        gz = place.y
        gy = 2.35
        gScale = 0.95
      }
    }
    m.glyphSprite.scale.set(gScale, gScale, 1)
    m.glyphSprite.position.set(gx, gy, gz)
    m.glyphSprite.visible = true
    m.glyphSprite.renderOrder = 90
  }

  const applySpeech = (
    m: AgentMesh,
    agentId: string,
    text: string | null,
    x: number,
    z: number,
    subjectId: string | null,
  ) => {
    // Always track text for probes; 3D sprite is photo-safe (HTML covers live HUD).
    if (m.speechText !== text) {
      m.speechText = text
      if (text) {
        const prev = m.speechMat.map
        const tex = makeSpeechTexture(text)
        track(tex)
        m.speechMat.map = tex
        m.speechMat.needsUpdate = true
        if (prev) prev.dispose()
      }
    }
    const show = !!text && subjectId !== null && subjectId === agentId
    if (!show) {
      m.speechSprite.visible = false
      return
    }
    // Tight to the hat so hero cameras can keep the card in the upper third.
    m.speechSprite.position.set(x, HEAD_Y + 0.82, z)
    m.speechSprite.scale.set(2.6, 1.3, 1)
    m.speechSprite.frustumCulled = false
    m.speechSprite.visible = true
  }

  const nearestTree = (
    x: number,
    z: number,
    trees: Array<{ x: number; z: number }> | undefined,
    maxDist: number,
  ): { x: number; z: number } | null => {
    if (!trees || trees.length === 0) return null
    let best: { x: number; z: number } | null = null
    let bestD = maxDist * maxDist
    for (const t of trees) {
      const dx = t.x - x
      const dz = t.z - z
      const d2 = dx * dx + dz * dz
      if (d2 <= bestD) {
        bestD = d2
        best = t
      }
    }
    return best
  }

  const update = (
    agentsIn: AgentState[],
    prev: Map<string, { x: number; y: number }>,
    alpha: number,
    selectedId: string | null,
    selectedPlaceId: string | null = null,
    places: Place[] = [],
    now = 0,
    fx: FxHandle | null = null,
    treePositions?: Array<{ x: number; z: number }>,
    onTreeHit?: (x: number, z: number, now: number) => void,
    tick = 0,
    events: readonly SimEvent[] = [],
    settle = false,
    photoSubjectId: string | null = null,
  ) => {
    const a = Math.max(0, Math.min(1, alpha))
    const simTime = tick + a
    const simNow = simTime * 1000
    hatCount = 0
    toolCount = 0
    destMarkerCount = 0

    const placeById = new Map(places.map((p) => [p.id, p]))
    const speechByAgent = new Map(
      describeSpeechBubbles(events, tick).map((b) => [b.agentId, b.text] as const),
    )

    const interp = new Map<string, { x: number; z: number; agent: AgentState }>()
    for (const agent of agentsIn) {
      const px = prev.get(agent.id)?.x ?? agent.x
      const py = prev.get(agent.id)?.y ?? agent.y
      const x = px + (agent.x - px) * a
      const z = py + (agent.y - py) * a
      interp.set(agent.id, { x, z, agent })
    }

    const socialStanding: Array<{ id: string; x: number; z: number }> = []
    for (const [id, p] of interp) {
      if (isPerformingSocial(p.agent)) socialStanding.push({ id, x: p.x, z: p.z })
    }

    for (const agent of agentsIn) {
      const m = meshes.get(agent.id)
      if (!m) continue
      const p = interp.get(agent.id)!
      const x = p.x
      const z = p.z

      const dx = x - m.lastX
      const dz = z - m.lastZ
      const moved = Math.hypot(dx, dz)
      m.lastX = x
      m.lastZ = z

      const sayText = speechByAgent.get(agent.id) ?? null
      const visual = describeAgent(agent, tick, {
        events,
        speechActive: sayText !== null,
      })
      const posture = visual.posture
      m.stagingProp = visual.prop
      applyGlyph(
        m,
        agent.id,
        visual.glyph,
        x,
        z,
        posture,
        photoSubjectId,
        visual.glyphPlaceId ?? null,
        placeById,
      )
      applySpeech(m, agent.id, sayText, x, z, photoSubjectId)
      const hauling = isHauling(agent)
      const walking = isOnPath(agent) && moved > 1e-5
      const working = isPerformingWork(agent)

      const jobPlace = agent.employedAt ? placeById.get(agent.employedAt) : undefined
      const job = jobKindFromPlace(jobPlace)
      const hideHat = posture === 'fallen'
      setHat(m, hideHat ? null : job)
      if (job && !hideHat) hatCount++

      m.hatRoot.scale.set(1, 1, 1)
      m.hatRoot.position.y = HAT_Y

      const carry = primaryCarryGood(agent)
      if (carry && posture !== 'fallen' && posture !== 'lying' && posture !== 'sitting') {
        m.carryMesh.visible = true
        m.carryMat.color.setHex(CARRY_TINT[carry])
      } else {
        m.carryMesh.visible = false
      }

      // Tick-phased collapse tint (reads at night)
      if (agent.collapsed) {
        const pulse =
          0.55 + 0.45 * (0.5 + 0.5 * Math.sin(simTime * 4 + m.phase * Math.PI * 2))
        m.bodyMat.color.copy(m.baseBody).lerp(new THREE.Color(0xc03030), pulse * 0.7)
        m.headMat.color.copy(m.baseHead).lerp(new THREE.Color(0xc03030), pulse * 0.5)
      } else if (posture === 'lying') {
        m.bodyMat.color.copy(m.baseBody).multiplyScalar(0.6)
        m.headMat.color.copy(m.baseHead).multiplyScalar(0.6)
      } else {
        m.bodyMat.color.copy(m.baseBody)
        m.headMat.color.copy(m.baseHead)
      }

      let yaw = m.poseInited ? m.poseRy : m.group.rotation.y
      const facePlace = (place: Place | undefined) => {
        if (!place) return
        const fdx = place.x - x
        const fdz = place.y - z
        if (fdx * fdx + fdz * fdz > 1e-4) yaw = Math.atan2(fdx, fdz)
      }
      const faceAgentId = (id: string | undefined | null) => {
        if (!id) return false
        const other = interp.get(id)
        if (!other) return false
        const fdx = other.x - x
        const fdz = other.z - z
        if (fdx * fdx + fdz * fdz <= 1e-4) return false
        yaw = Math.atan2(fdx, fdz)
        return true
      }
      /** Staging facing when not pathing — path yaw wins while moving. */
      const applyStagingFace = () => {
        if (isOnPath(agent) && moved > 1e-5) {
          m.stagingFaceId = null
          m.stagingFaceKind = null
          return
        }
        const face = describeFacingTarget(agent, tick, { events })
        m.stagingFaceId = face?.id ?? null
        m.stagingFaceKind = face?.kind ?? null
        if (!face) return
        if (face.kind === 'agent') faceAgentId(face.id)
        else facePlace(placeById.get(face.id))
      }
      applyStagingFace()

      let ty = 0
      let rx = 0
      let rz = 0
      let headY = HEAD_Y
      let held: ToolKind | null = null

      if (posture === 'fallen') {
        setTool(m, null)
        ty = GROUND_Y + 0.04
        rx = Math.PI / 2 - 0.2
        rz = 0.16
        applyPose(m, x, z, ty, rx, yaw, rz, 1, HEAD_Y, settle)
        applyCharm(m, posture, simTime)
        m.lastPosture = posture
        continue
      }

      if (posture === 'lying') {
        setTool(m, null)
        ty = GROUND_Y + 0.03
        rx = Math.PI / 2
        rz = 0.04
        applyPose(m, x, z, ty, rx, yaw, rz, 1, HEAD_Y, settle)
        applyCharm(m, posture, simTime)
        m.lastPosture = posture
        continue
      }

      if (posture === 'lean-in') {
        setTool(m, null)
        // Prefer staging examine target (action + residual window).
        const examId = examineTargetId(agent, tick, events) ?? agent.action.targetPlaceId
        facePlace(examId ? placeById.get(examId) : undefined)
        if (moved > 1e-5) {
          m.walkDist += moved
          ty = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP * 0.5
          if (isOnPath(agent)) yaw = Math.atan2(dx, dz)
        }
        rx = 0.38
        headY = HEAD_Y - 0.08
        applyPose(m, x, z, ty, rx, yaw, 0, 1, headY, settle)
        applyCharm(m, posture, simTime)
        m.lastPosture = posture
        continue
      }

      if (posture === 'sitting') {
        const prop: PropKind | null = visual.prop
        held =
          prop === 'berry' ? 'berry' : prop === 'mug' ? 'mug' : prop === 'scroll' ? 'scroll' : null
        setTool(m, held)
        if (held) {
          toolCount++
          m.toolRoot.rotation.x = -0.95
          m.toolRoot.rotation.z = 0.45
        }
        const sitPlace = agent.action.targetPlaceId
          ? placeById.get(agent.action.targetPlaceId)
          : undefined
        facePlace(sitPlace)
        applyPose(m, x, z, 0, 0.08, yaw, 0, 0.62, HEAD_Y, settle)
        applyCharm(m, posture, simTime)
        m.lastPosture = posture
        continue
      }

      if (posture === 'working') {
        const showTool = working && !hauling ? toolForJob(job, false) : null
        setTool(m, showTool)
        if (showTool) toolCount++

        if (working && showTool) {
          if (job === 'forestry') {
            const tree = nearestTree(x, z, treePositions, 2)
            if (tree) yaw = Math.atan2(tree.x - x, tree.z - z)
          } else {
            facePlace(jobPlace)
          }

          const phase = simTime * Math.PI * 2 + m.phase * Math.PI * 2
          const swing = Math.sin(phase)
          const apexBin = Math.floor((phase + Math.PI / 2) / Math.PI)
          const atApex = swing > 0.92 && apexBin !== m.lastApexBin
          if (atApex) m.lastApexBin = apexBin

          if (showTool === 'hoe' || showTool === 'axe' || showTool === 'pick') {
            m.toolRoot.rotation.x = -0.4 + swing * 0.85
            m.toolRoot.rotation.z = 0.15
          } else if (showTool === 'hammer') {
            m.toolRoot.rotation.x = -0.2 + Math.abs(swing) * 0.7
            m.toolRoot.rotation.z = 0.1
          }

          rx = WORK_LEAN * (0.4 + 0.6 * Math.max(0, swing))
          applyPose(m, x, z, 0, rx, yaw, 0, 1, HEAD_Y, settle)
          applyCharm(m, posture, simTime, 0, swing)

          if (atApex && fx) {
            const tipX = x + Math.sin(yaw) * 0.35
            const tipZ = z + Math.cos(yaw) * 0.35
            const tipY = GROUND_Y + 0.35
            const seed = hashId(agent.id) + tick * 17
            const opts = { now: simNow, seed }
            if (showTool === 'axe') {
              fx.puffWoodChips(tipX, tipY, tipZ, 4, opts)
              const tree = nearestTree(x, z, treePositions, 2)
              if (tree && onTreeHit) onTreeHit(tree.x, tree.z, simNow)
            } else if (showTool === 'pick') {
              fx.puffStoneChips(tipX, tipY, tipZ, 3, opts)
              fx.spark(tipX, tipY + 0.05, tipZ, opts)
            } else if (showTool === 'hammer') {
              fx.knockDust(tipX, GROUND_Y + 0.15, tipZ, opts)
            }
          }
          m.lastPosture = posture
          continue
        }

        // Haul: sack + forward lean (no tool)
        setTool(m, null)
        if (walking || moved > 1e-5) {
          m.walkDist += moved
          ty = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP * 0.6
          if (moved > 1e-5) yaw = Math.atan2(dx, dz)
        }
        applyPose(m, x, z, ty, LEAN * 0.7, yaw, 0, 1, HEAD_Y, settle)
        applyCharm(m, walking || moved > 1e-5 ? 'walking' : posture, simTime, m.walkDist * BOB_FREQ)
        m.lastPosture = posture
        continue
      }

      if (posture === 'walking') {
        setTool(m, null)
        m.walkDist += moved
        const bob = Math.sin(m.walkDist * BOB_FREQ) * BOB_AMP
        if (moved > 1e-5) yaw = Math.atan2(dx, dz)
        rx = LEAN * Math.min(1, moved * 8)
        applyPose(m, x, z, bob, rx, yaw, 0, 1, HEAD_Y, settle)
        applyCharm(m, posture, simTime, m.walkDist * BOB_FREQ)
        m.lastPosture = posture
        continue
      }

      if (posture === 'socializing') {
        setTool(m, null)
        // Staging partner wins; else nearest socializing neighbor (legacy).
        if (!m.stagingFaceId || m.stagingFaceKind !== 'agent') {
          let bestD = Infinity
          let faceX = 0
          let faceZ = 1
          for (const o of socialStanding) {
            if (o.id === agent.id) continue
            const ddx = o.x - x
            const ddz = o.z - z
            const d2 = ddx * ddx + ddz * ddz
            if (d2 < bestD && d2 > 1e-6) {
              bestD = d2
              faceX = ddx
              faceZ = ddz
            }
          }
          if (bestD < Infinity) yaw = Math.atan2(faceX, faceZ)
        }
        const t = simTime * 2.2 + m.phase * Math.PI * 2
        const pulse = Math.pow(Math.max(0, Math.sin(t)), 10)
        const s = 1 + pulse * 0.03
        applyPose(m, x, z, 0, 0, yaw, 0, s, HEAD_Y, settle)
        applyCharm(m, posture, simTime)
        m.lastPosture = posture
        continue
      }

      // Standing / idle — scroll prop during commission window
      if (visual.prop === 'scroll') {
        setTool(m, 'scroll')
        toolCount++
        m.toolRoot.rotation.x = -0.55
        m.toolRoot.rotation.z = 0.25
      } else {
        setTool(m, null)
      }
      applyPose(m, x, z, 0, 0, yaw, 0, 1, HEAD_Y, settle)
      applyCharm(m, posture, simTime)
      m.lastPosture = posture
    }

    const ringPulse = 0.75 + Math.sin(simTime * 3) * 0.15
    const ringScale = 1 + Math.sin(simTime * 3.9) * 0.08

    if (selectedId && meshes.has(selectedId)) {
      const m = meshes.get(selectedId)!
      ring.visible = true
      placeRing.visible = false
      ring.position.x = m.group.position.x
      ring.position.z = m.group.position.z
      ringMat.opacity = ringPulse
      ring.scale.set(ringScale, ringScale, ringScale)
    } else if (selectedPlaceId) {
      ring.visible = false
      const place = places.find((p) => p.id === selectedPlaceId)
      if (place) {
        placeRing.visible = true
        placeRing.position.x = place.x
        placeRing.position.z = place.y
        placeRingMat.opacity = ringPulse
        placeRing.scale.set(ringScale, ringScale, ringScale)
      } else {
        placeRing.visible = false
      }
    } else {
      ring.visible = false
      placeRing.visible = false
    }

    destDisc.visible = false
    if (selectedId) {
      const sel = agentsIn.find((ag) => ag.id === selectedId)
      const dest = sel ? describeDestination(sel) : null
      if (dest) {
        destDisc.visible = true
        destDisc.position.x = dest.x
        destDisc.position.z = dest.y
        const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(simTime * 4))
        destMat.opacity = pulse
        const ds = 0.85 + 0.2 * (0.5 + 0.5 * Math.sin(simTime * 4 + 0.7))
        destDisc.scale.set(ds, ds, ds)
        destMarkerCount = 1
      }
    }

    void now
  }

  const getPickables = (): THREE.Object3D[] => {
    const list: THREE.Object3D[] = []
    for (const m of meshes.values()) {
      list.push(m.group)
    }
    return list
  }

  const agentIdFromObject = (obj: THREE.Object3D): string | null => {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      const id = objectToId.get(cur) ?? (cur.userData.agentId as string | undefined)
      if (id) return id
      cur = cur.parent
    }
    return null
  }

  const getJuiceCounts = () => ({ hats: hatCount, tools: toolCount, destMarkers: destMarkerCount })

  const getFacing = (id: string) => {
    const m = meshes.get(id)
    if (!m) return null
    return {
      x: m.group.position.x,
      y: m.group.position.y,
      z: m.group.position.z,
      yaw: m.group.rotation.y,
      rx: m.group.rotation.x,
      hat:
        m.hatFarm.visible || m.hatStall.visible || m.hatCap.visible || m.hatHelmet.visible,
      variant: m.variant,
    }
  }

  const getStaging = (id: string) => {
    const m = meshes.get(id)
    if (!m) return null
    return {
      speechText: m.speechText,
      speechVisible: m.speechSprite.visible,
      speechPos: {
        x: m.speechSprite.position.x,
        y: m.speechSprite.position.y,
        z: m.speechSprite.position.z,
        sx: m.speechSprite.scale.x,
        sy: m.speechSprite.scale.y,
        hasMap: !!m.speechMat.map,
      },
      glyphPlaceId: m.glyphPlaceId,
      glyphVisible: m.glyphSprite.visible,
      glyphPos: m.glyphSprite.visible
        ? {
            x: m.glyphSprite.position.x,
            y: m.glyphSprite.position.y,
            z: m.glyphSprite.position.z,
          }
        : null,
      prop: m.stagingProp,
      faceId: m.stagingFaceId,
      faceKind: m.stagingFaceKind,
      yaw: m.group.rotation.y,
    }
  }

  const dispose = () => {
    scene.remove(root)
    for (const d of disposables) d.dispose()
    meshes.clear()
    objectToId.clear()
  }

  return {
    root,
    update,
    getPickables,
    agentIdFromObject,
    getJuiceCounts,
    getFacing,
    getStaging,
    dispose,
  }
}

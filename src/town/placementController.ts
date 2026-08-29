import * as THREE from 'three'
import { BLUEPRINTS, cellWorldTile } from '../sim/blueprints'
import type { AgentState, BuildableKind, Place, WorldState } from '../sim/types'
import type { AgentsHandle } from './agents'
import { tileToWorld, worldToTile } from './coords'
import type { PlacesHandle } from './places'
import type {
  BlueprintGhostCell,
  PlacementGhostHandle,
  PlacementGhostMode,
  PlacementGhostTone,
} from './placementGhost'
import type { TerrainHandle } from './terrain'
import { groundHeight } from './terrainHeight'

export type PlacementTool = BuildableKind | 'path' | `blueprint:${string}`

export interface PlacementCheck {
  ok: boolean
  reason: string
  missing?: Partial<Record<'wood' | 'stone', number>>
  missingStoredMaterials?: Partial<Record<'wood' | 'stone', number>>
  requiredMaterials?: { wood: number; stone: number }
  cellOk?: boolean[]
}

export interface PlayerCommandResult {
  ok: boolean
  reason: string
  placeId?: string
}

export interface PlacementPreviewState {
  x: number
  y: number
  tone: PlacementGhostTone
  ok: boolean
  reason: string
  missingWood: number
  missingStone: number
  billWood: number
  billStone: number
}

export interface TownInteractionState {
  activeKind: PlacementTool | null
  preview: PlacementPreviewState | null
  selectedPlaceId: string | null
  selectedPlace: Place | null
  selectedAgentId: string | null
  selectedAgent: AgentState | null
  hovered: {
    kind: 'place' | 'agent'
    id: string
    label: string
    detail: string
    x: number
    y: number
  } | null
  message: string
}

export interface PlacementController {
  getState: () => TownInteractionState
  beginBuild: (kind: BuildableKind) => void
  beginBlueprint: (blueprintId: string) => void
  beginPath: () => void
  cancelMode: () => void
  cancelSelected: () => PlayerCommandResult
  demolishSelected: () => PlayerCommandResult
  selectPlace: (placeId: string | null) => void
  selectAgent: (agentId: string | null) => void
  refresh: () => void
  dispose: () => void
}

const FRIENDLY_REASON: Record<string, string> = {
  valid: 'Ready to designate',
  ok: 'Ready to designate',
  'out-of-bounds': 'Too close to the island edge',
  'blocked-terrain': 'The full footprint needs clear, walkable ground',
  'not-walkable': 'The full footprint needs walkable ground',
  water: 'The full footprint must stay on dry land',
  rock: 'Rock blocks this footprint',
  'too-steep': 'The footprint is too steep',
  slope: 'The footprint is too steep',
  occupied: 'Another place blocks this footprint',
  collision: 'Another place blocks this footprint',
  'site-cap': 'Too many construction sites are already active',
  'unknown-kind': 'That structure cannot be built',
  clearance: 'Need a one-tile walkable ring around the shape',
  'not-found': 'That place no longer exists',
  'not-construction-site': 'Select a construction site to cancel it',
  'not-demolishable': 'This place cannot be demolished',
  'not-buildable': 'This place cannot be demolished',
  'already-set': 'A path already covers this tile',
  protected: 'This place is protected',
  trees: 'Trees block this footprint',
}

function friendly(reason: string): string {
  return FRIENDLY_REASON[reason] ?? reason.replace(/-/g, ' ')
}

function blueprintIdOf(tool: PlacementTool): string | null {
  return tool.startsWith('blueprint:') ? tool.slice('blueprint:'.length) : null
}

function missingAmount(check: PlacementCheck, good: 'wood' | 'stone'): number {
  const n = check.missingStoredMaterials?.[good] ?? check.missing?.[good]
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.ceil(n)) : 0
}

function placeIdFromObject(object: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = object
  while (node) {
    if (typeof node.userData.placeId === 'string') return node.userData.placeId
    node = node.parent
  }
  return null
}

function agentIdFromObject(object: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = object
  while (node) {
    if (typeof node.userData.agentId === 'string') return node.userData.agentId
    node = node.parent
  }
  return null
}

export function createPlacementController(opts: {
  canvas: HTMLCanvasElement
  scene: THREE.Scene
  camera: THREE.Camera
  terrain: TerrainHandle
  places: PlacesHandle
  agents: AgentsHandle
  ghost: PlacementGhostHandle
  getWorld: () => WorldState
  validateBuild: (kind: BuildableKind, x: number, y: number) => PlacementCheck
  issueBuild: (kind: BuildableKind, x: number, y: number) => PlayerCommandResult
  validateBlueprint: (blueprintId: string, x: number, y: number) => PlacementCheck
  issueBlueprint: (blueprintId: string, x: number, y: number) => PlayerCommandResult
  validatePath: (x: number, y: number) => PlacementCheck
  issuePath: (x: number, y: number) => PlayerCommandResult
  issueCancel: (placeId: string) => PlayerCommandResult
  issueDemolish: (placeId: string) => PlayerCommandResult
  syncVisuals: () => void
}): PlacementController {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let activeKind: PlacementTool | null = null
  let preview: PlacementPreviewState | null = null
  let selectedPlaceId: string | null = null
  let selectedAgentId: string | null = null
  let hovered: TownInteractionState['hovered'] = null
  let message = 'Choose a structure to begin building.'

  const selectionMat = new THREE.LineBasicMaterial({
    color: 0xf2d07a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  })
  const selectionBox = new THREE.Box3()
  const selectionSize = new THREE.Vector3()
  const selectionCenter = new THREE.Vector3()
  let selectionLines: THREE.LineSegments | null = null

  const clearSelectionLines = () => {
    if (!selectionLines) return
    opts.scene.remove(selectionLines)
    selectionLines.geometry.dispose()
    selectionLines = null
  }

  const updateSelectionLines = () => {
    clearSelectionLines()
    if (!selectedPlaceId && !selectedAgentId) return
    const object = selectedPlaceId
      ? opts.places.objectFor(selectedPlaceId)
      : selectedAgentId
        ? opts.agents.objectFor(selectedAgentId)
        : null
    if (!object) return
    selectionBox.setFromObject(object)
    if (selectionBox.isEmpty()) return
    selectionBox.getSize(selectionSize)
    selectionBox.getCenter(selectionCenter)
    const geo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        Math.max(0.5, selectionSize.x + 0.35),
        Math.max(0.3, selectionSize.y + 0.35),
        Math.max(0.5, selectionSize.z + 0.35),
      ),
    )
    selectionLines = new THREE.LineSegments(geo, selectionMat)
    selectionLines.position.copy(selectionCenter)
    selectionLines.renderOrder = 100
    opts.scene.add(selectionLines)
  }

  const setRayFromEvent = (event: PointerEvent) => {
    const rect = opts.canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    raycaster.setFromCamera(pointer, opts.camera)
  }

  const tileFromEvent = (event: PointerEvent): { x: number; y: number } | null => {
    setRayFromEvent(event)
    const hit = raycaster.intersectObject(opts.terrain.root, true)[0]
    if (!hit) return null
    const world = opts.getWorld()
    const raw = worldToTile(hit.point.x, hit.point.z, world.width, world.height)
    return { x: Math.round(raw.tx), y: Math.round(raw.ty) }
  }

  const renderPreview = (tile: { x: number; y: number } | null) => {
    if (!activeKind || !tile) {
      preview = null
      opts.ghost.hide()
      return
    }
    const world = opts.getWorld()
    const blueprintId = blueprintIdOf(activeKind)
    const check = activeKind === 'path'
      ? opts.validatePath(tile.x, tile.y)
      : blueprintId
        ? opts.validateBlueprint(blueprintId, tile.x, tile.y)
        : opts.validateBuild(activeKind as BuildableKind, tile.x, tile.y)
    const missingWood = activeKind === 'path' ? 0 : missingAmount(check, 'wood')
    const missingStone = activeKind === 'path' ? 0 : missingAmount(check, 'stone')
    const tone: PlacementGhostTone = !check.ok
      ? 'invalid'
      : missingWood > 0 || missingStone > 0
        ? 'warning'
        : 'valid'
    const bp = blueprintId ? BLUEPRINTS[blueprintId] : undefined
    preview = {
      x: tile.x,
      y: tile.y,
      tone,
      ok: check.ok,
      reason: friendly(check.reason),
      missingWood,
      missingStone,
      billWood: check.requiredMaterials?.wood ?? 0,
      billStone: check.requiredMaterials?.stone ?? 0,
    }
    const at = tileToWorld(tile.x, tile.y, world.width, world.height)
    const tileKind = world.tiles[tile.y * world.width + tile.x]?.kind ?? 'grass'
    let mode: PlacementGhostMode = 'building'
    if (activeKind === 'path') mode = 'path'
    else if (blueprintId) mode = 'blueprint'
    let cells: BlueprintGhostCell[] | undefined
    if (bp && blueprintId) {
      cells = []
      const cellOk = check.cellOk
      for (let i = 0; i < bp.cells.length; i++) {
        const spec = bp.cells[i]
        if (!spec) continue
        const worldTile = cellWorldTile(tile.x, tile.y, bp.width, i)
        const pos = tileToWorld(worldTile.x, worldTile.y, world.width, world.height)
        const kindAt = world.tiles[worldTile.y * world.width + worldTile.x]?.kind ?? 'grass'
        const ok = cellOk ? cellOk[i] !== false : check.ok
        cells.push({
          wx: pos.x,
          wy: groundHeight(worldTile.x, worldTile.y, kindAt) + 0.04,
          wz: pos.z,
          kind: spec.kind,
          tone: ok ? (tone === 'warning' ? 'warning' : 'valid') : 'invalid',
        })
      }
    }
    opts.ghost.show(
      at.x,
      groundHeight(tile.x, tile.y, tileKind) + 0.04,
      at.z,
      tone,
      mode,
      cells,
    )
  }

  const pickTarget = (event: PointerEvent): { kind: 'place' | 'agent'; id: string } | null => {
    setRayFromEvent(event)
    for (const hit of raycaster.intersectObjects([opts.agents.root, opts.places.root], true)) {
      const agentId = agentIdFromObject(hit.object)
      if (agentId) return { kind: 'agent', id: agentId }
      const placeId = placeIdFromObject(hit.object)
      if (placeId) return { kind: 'place', id: placeId }
    }
    return null
  }

  const selectPlace = (placeId: string | null) => {
    selectedPlaceId = placeId
    selectedAgentId = null
    updateSelectionLines()
    if (!placeId) message = 'Nothing selected.'
  }

  const selectAgent = (agentId: string | null) => {
    selectedAgentId = agentId
    selectedPlaceId = null
    updateSelectionLines()
    const agent = agentId ? opts.getWorld().agents.find((candidate) => candidate.id === agentId) : null
    message = agent ? `${agent.name} selected.` : 'Nothing selected.'
  }

  const updateHover = (event: PointerEvent): void => {
    const target = pickTarget(event)
    if (!target) {
      hovered = null
      opts.canvas.style.cursor = ''
      return
    }
    const world = opts.getWorld()
    if (target.kind === 'agent') {
      const agent = world.agents.find((candidate) => candidate.id === target.id)
      hovered = agent
        ? {
            kind: 'agent',
            id: agent.id,
            label: agent.name,
            detail: `${agent.action.kind.replace(/-/g, ' ')} · ${agent.action.reason}`,
            x: event.clientX,
            y: event.clientY,
          }
        : null
    } else {
      const place = world.places.find((candidate) => candidate.id === target.id)
      hovered = place
        ? {
            kind: 'place',
            id: place.id,
            label: place.kind === 'home' ? 'House' : place.kind.replace(/-/g, ' '),
            detail: place.kind === 'construction-site'
              ? `${Math.round((place.construction?.progress ?? 0) * 100)}% built`
              : `Tile ${place.x}, ${place.y}`,
            x: event.clientX,
            y: event.clientY,
          }
        : null
    }
    opts.canvas.style.cursor = hovered ? 'pointer' : ''
  }

  const onPointerMove = (event: PointerEvent) => {
    if (activeKind) {
      hovered = null
      renderPreview(tileFromEvent(event))
      return
    }
    updateHover(event)
  }

  const onPointerLeave = () => {
    hovered = null
    if (!activeKind) opts.canvas.style.cursor = ''
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    if (activeKind) {
      renderPreview(tileFromEvent(event))
      if (!preview?.ok) {
        message = preview?.reason ?? 'Move over the island to place this structure.'
        return
      }
      const kind = activeKind
      const placedAt = { x: preview.x, y: preview.y }
      if (kind === 'path') {
        const result = opts.issuePath(placedAt.x, placedAt.y)
        message = result.ok
          ? `Path laid at ${placedAt.x}, ${placedAt.y}. Keep painting or press Escape.`
          : friendly(result.reason)
        if (result.ok) {
          opts.syncVisuals()
          renderPreview(placedAt)
        }
        return
      }
      const blueprintId = blueprintIdOf(kind)
      const result = blueprintId
        ? opts.issueBlueprint(blueprintId, placedAt.x, placedAt.y)
        : opts.issueBuild(kind as BuildableKind, placedAt.x, placedAt.y)
      const label = blueprintId
        ? (BLUEPRINTS[blueprintId]?.name ?? blueprintId)
        : kind === 'home' ? 'House' : kind
      message = result.ok
        ? `${label} site designated at ${preview.x}, ${preview.y}.`
        : friendly(result.reason)
      if (result.ok) {
        activeKind = null
        preview = null
        opts.ghost.hide()
        opts.canvas.style.cursor = ''
        opts.syncVisuals()
        const world = opts.getWorld()
        const placed = result.placeId
          ? world.places.find((p) => p.id === result.placeId)
          : world.places.find(
              (p) => p.kind === 'construction-site' && p.x === placedAt.x && p.y === placedAt.y,
            )
        selectPlace(placed?.id ?? null)
      }
      return
    }
    const target = pickTarget(event)
    if (target?.kind === 'agent') selectAgent(target.id)
    else selectPlace(target?.kind === 'place' ? target.id : null)
  }

  const onContextMenu = (event: MouseEvent) => {
    if (!activeKind) return
    event.preventDefault()
    activeKind = null
    preview = null
    opts.ghost.hide()
    opts.canvas.style.cursor = ''
    message = 'Placement cancelled.'
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return
    if (activeKind) {
      activeKind = null
      preview = null
      opts.ghost.hide()
      opts.canvas.style.cursor = ''
      message = 'Placement cancelled.'
    } else {
      selectPlace(null)
    }
  }

  opts.canvas.addEventListener('pointermove', onPointerMove)
  opts.canvas.addEventListener('pointerleave', onPointerLeave)
  opts.canvas.addEventListener('pointerdown', onPointerDown)
  opts.canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)

  const issueSelected = (
    run: (placeId: string) => PlayerCommandResult,
    success: string,
  ): PlayerCommandResult => {
    if (!selectedPlaceId) return { ok: false, reason: 'not-found' }
    const result = run(selectedPlaceId)
    message = result.ok ? success : friendly(result.reason)
    if (result.ok) {
      selectedPlaceId = null
      opts.syncVisuals()
      updateSelectionLines()
    }
    return result
  }

  return {
    getState: () => {
      const selectedPlace = selectedPlaceId
        ? opts.getWorld().places.find((p) => p.id === selectedPlaceId) ?? null
        : null
      return {
        activeKind,
        preview: preview ? { ...preview } : null,
        selectedPlaceId,
        selectedPlace,
        selectedAgentId,
        selectedAgent: selectedAgentId
          ? opts.getWorld().agents.find((agent) => agent.id === selectedAgentId) ?? null
          : null,
        hovered: hovered ? { ...hovered } : null,
        message,
      }
    },
    beginBuild: (kind) => {
      activeKind = kind
      preview = null
      selectPlace(null)
      message = `Move the ${kind === 'home' ? 'house' : kind} ghost over clear ground.`
      opts.canvas.style.cursor = 'crosshair'
    },
    beginBlueprint: (blueprintId) => {
      activeKind = `blueprint:${blueprintId}`
      preview = null
      selectPlace(null)
      const name = BLUEPRINTS[blueprintId]?.name ?? blueprintId
      message = `Move the ${name} blueprint over clear ground. Top-left cell follows the cursor.`
      opts.canvas.style.cursor = 'crosshair'
    },
    beginPath: () => {
      activeKind = 'path'
      preview = null
      selectPlace(null)
      message = 'Move over clear ground and click tiles to paint a persistent path.'
      opts.canvas.style.cursor = 'crosshair'
    },
    cancelMode: () => {
      activeKind = null
      preview = null
      opts.ghost.hide()
      opts.canvas.style.cursor = ''
      message = 'Placement cancelled.'
    },
    cancelSelected: () =>
      issueSelected(opts.issueCancel, 'Construction cancelled; unused materials were returned.'),
    demolishSelected: () => issueSelected(opts.issueDemolish, 'Building demolished.'),
    selectPlace,
    selectAgent,
    refresh: () => {
      if (selectedPlaceId && !opts.getWorld().places.some((p) => p.id === selectedPlaceId)) {
        selectedPlaceId = null
      }
      if (selectedAgentId && !opts.getWorld().agents.some((agent) => agent.id === selectedAgentId)) {
        selectedAgentId = null
      }
      updateSelectionLines()
    },
    dispose: () => {
      opts.canvas.removeEventListener('pointermove', onPointerMove)
      opts.canvas.removeEventListener('pointerleave', onPointerLeave)
      opts.canvas.removeEventListener('pointerdown', onPointerDown)
      opts.canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      clearSelectionLines()
      selectionMat.dispose()
      opts.canvas.style.cursor = ''
    },
  }
}

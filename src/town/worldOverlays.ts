import * as THREE from 'three'
import type { WorldState } from '../sim/types'
import type { AgentsHandle } from './agents'
import { footprintTiles, tileToWorld } from './coords'
import { agentHasHome } from './legibility'
import { groundHeight } from './terrainHeight'

export type TownOverlayMode =
  | 'none'
  | 'needs'
  | 'housing'
  | 'jobs'
  | 'resources'
  | 'fertility'
  | 'water'
  | 'ownership'
  | 'paths'

export interface WorldOverlaysHandle {
  setMode: (mode: TownOverlayMode) => void
  getMode: () => TownOverlayMode
  update: (world: WorldState) => void
  dispose: () => void
}

interface OverlayEntry {
  id: string
  target: 'agent' | 'place' | 'tile'
  mesh: THREE.Mesh
  tileX?: number
  tileY?: number
}

function needColor(value: number): number {
  if (value < 0.25) return 0xd75445
  if (value < 0.5) return 0xe0a743
  return 0x6ac77b
}

export function createWorldOverlays(
  scene: THREE.Scene,
  agents: AgentsHandle,
): WorldOverlaysHandle {
  const root = new THREE.Group()
  root.name = 'town-overlays'
  root.renderOrder = 90
  scene.add(root)

  const geometry = new THREE.RingGeometry(0.72, 1, 32)
  geometry.rotateX(-Math.PI / 2)
  const materials = new Map<number, THREE.MeshBasicMaterial>()
  const entries: OverlayEntry[] = []
  let mode: TownOverlayMode = 'none'
  let signature = ''

  const materialFor = (color: number): THREE.MeshBasicMaterial => {
    const cached = materials.get(color)
    if (cached) return cached
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.76,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    materials.set(color, material)
    return material
  }

  const clear = (): void => {
    for (const entry of entries) root.remove(entry.mesh)
    entries.length = 0
  }

  const add = (id: string, target: OverlayEntry['target'], color: number, scale: number): void => {
    const mesh = new THREE.Mesh(geometry, materialFor(color))
    mesh.scale.setScalar(scale)
    mesh.renderOrder = 90
    mesh.userData.overlayTarget = id
    root.add(mesh)
    entries.push({ id, target, mesh })
  }

  const addTile = (x: number, y: number, color: number, scale = 0.48): void => {
    const mesh = new THREE.Mesh(geometry, materialFor(color))
    mesh.scale.setScalar(scale)
    mesh.renderOrder = 90
    mesh.userData.overlayTile = `${x},${y}`
    root.add(mesh)
    entries.push({ id: `${x},${y}`, target: 'tile', mesh, tileX: x, tileY: y })
  }

  const wantedSignature = (world: WorldState): string => {
    if (mode === 'none') return 'none'
    if (mode === 'needs') {
      return `needs:${world.agents.map((agent) => `${agent.id}:${Math.floor(Math.min(agent.needs.hunger, agent.needs.energy, agent.needs.social) * 4)}`).join('|')}`
    }
    if (mode === 'housing') {
      return `housing:${world.places.filter((place) => place.kind === 'home').map((place) => place.id).join('|')}:${world.agents.filter((agent) => !agentHasHome(agent, world)).map((agent) => agent.id).join('|')}`
    }
    if (mode === 'jobs') {
      return `jobs:${world.places.filter((place) => (place.jobSlots ?? 0) > 0).map((place) => place.id).join('|')}:${world.agents.filter((agent) => agent.employedAt === null).map((agent) => agent.id).join('|')}`
    }
    if (mode === 'resources') {
      return `resources:${world.places.map((place) => `${place.id}:${Object.values(place.inventory).join(',')}`).join('|')}:${world.tiles.filter((tile) => tile.kind === 'forest' || tile.kind === 'rock').map((tile) => `${tile.x},${tile.y},${tile.gatherStock ?? 0}`).join('|')}`
    }
    if (mode === 'fertility') return `fertility:${world.seed}:${world.places.length}`
    if (mode === 'water') return `water:${world.places.filter((place) => place.kind === 'well' || place.kind === 'spring').map((place) => place.id).join('|')}`
    if (mode === 'ownership') return `ownership:${Object.entries(world.owners).sort().map(([id, owner]) => `${id}:${owner}`).join('|')}`
    return `paths:${world.tiles.filter((tile) => tile.path || (tile.wear ?? 0) > 0).map((tile) => `${tile.x},${tile.y},${tile.path ? 1 : 0},${Math.floor((tile.wear ?? 0) / 10)}`).join('|')}`
  }

  const rebuild = (world: WorldState): void => {
    clear()
    if (mode === 'needs') {
      for (const agent of world.agents) {
        const worst = Math.min(agent.needs.hunger, agent.needs.energy, agent.needs.social)
        add(agent.id, 'agent', needColor(worst), 0.72)
      }
      return
    }
    if (mode === 'housing') {
      for (const place of world.places) {
        if (place.kind !== 'home') continue
        const footprint = footprintTiles(place.kind)
        add(place.id, 'place', 0x63c979, Math.max(1.8, Math.max(footprint.w, footprint.d) * 1.22))
      }
      for (const agent of world.agents) {
        if (!agentHasHome(agent, world)) add(agent.id, 'agent', 0xd75445, 0.78)
      }
      return
    }
    if (mode === 'jobs') {
      for (const place of world.places) {
        if ((place.jobSlots ?? 0) <= 0) continue
        const footprint = footprintTiles(place.kind)
        add(place.id, 'place', 0x55b8d0, Math.max(1.8, Math.max(footprint.w, footprint.d) * 1.22))
      }
      for (const agent of world.agents) {
        if (agent.employedAt === null) add(agent.id, 'agent', 0xe0a743, 0.78)
      }
      return
    }
    if (mode === 'resources') {
      for (const tile of world.tiles) {
        if ((tile.x * 31 + tile.y * 17) % 5 !== 0) continue
        if (tile.kind === 'forest' && (tile.gatherStock ?? 1) > 0) addTile(tile.x, tile.y, 0x5fb06f, 0.58)
        else if (tile.kind === 'rock' && (tile.gatherStock ?? 1) > 0) addTile(tile.x, tile.y, 0xaaa18d, 0.58)
      }
      for (const place of world.places) {
        const color = place.kind === 'berry-bush' || place.kind === 'farm'
          ? 0x8bc95c
          : place.kind === 'storehouse'
            ? 0xe0b75b
            : place.kind === 'forestry'
              ? 0x5fb06f
              : place.kind === 'quarry'
                ? 0xaaa18d
                : null
        if (color === null) continue
        const footprint = footprintTiles(place.kind)
        add(place.id, 'place', color, Math.max(1.3, Math.max(footprint.w, footprint.d)))
      }
      return
    }
    if (mode === 'fertility') {
      const occupied = new Set(world.places.map((place) => `${Math.round(place.x)},${Math.round(place.y)}`))
      const plaza = world.places.find((place) => place.kind === 'plaza')
      for (const tile of world.tiles) {
        if (!tile.walkable || tile.kind !== 'grass' || occupied.has(`${tile.x},${tile.y}`)) continue
        if (!plaza || Math.hypot(tile.x - plaza.x, tile.y - plaza.y) > 14) continue
        if (tile.x % 3 !== 0 || tile.y % 3 !== 0) continue
        addTile(tile.x, tile.y, tile.elevation < 0.42 ? 0x79c86c : 0xb6bd62, 0.72)
      }
      return
    }
    if (mode === 'water') {
      for (const place of world.places) {
        if (place.kind !== 'well' && place.kind !== 'spring') continue
        add(place.id, 'place', place.kind === 'well' ? 0x55bfe2 : 0x4a9fc5, place.kind === 'well' ? 2.2 : 1.5)
      }
      return
    }
    if (mode === 'ownership') {
      for (const place of world.places) {
        if (place.kind === 'berry-bush' || place.kind === 'spring') continue
        const footprint = footprintTiles(place.kind)
        add(place.id, 'place', world.owners[place.id] === 'commons' ? 0xe0b75b : 0xa779d2, Math.max(1.4, Math.max(footprint.w, footprint.d)))
      }
      return
    }
    if (mode === 'paths') {
      for (const tile of world.tiles) {
        if (tile.path) addTile(tile.x, tile.y, 0x59b9db, 0.45)
        else if ((tile.wear ?? 0) >= 10) addTile(tile.x, tile.y, 0xd2a258, 0.34)
      }
    }
  }

  const updatePositions = (world: WorldState): void => {
    for (const entry of entries) {
      if (entry.target === 'agent') {
        const agent = world.agents.find((candidate) => candidate.id === entry.id)
        const object = agents.objectFor(entry.id)
        if (!agent || !object) {
          entry.mesh.visible = false
          continue
        }
        const tile = world.tiles[Math.round(agent.y) * world.width + Math.round(agent.x)]
        const pos = new THREE.Vector3()
        object.getWorldPosition(pos)
        entry.mesh.position.set(
          pos.x,
          tile ? groundHeight(agent.x, agent.y, tile.kind) + 0.09 : 0.09,
          pos.z,
        )
        entry.mesh.visible = true
        continue
      }
      if (entry.target === 'tile') {
        const x = entry.tileX ?? 0
        const y = entry.tileY ?? 0
        const tile = world.tiles[y * world.width + x]
        if (!tile) {
          entry.mesh.visible = false
          continue
        }
        const at = tileToWorld(x, y, world.width, world.height)
        entry.mesh.position.set(at.x, groundHeight(x, y, tile.kind) + 0.08, at.z)
        entry.mesh.visible = true
        continue
      }
      const place = world.places.find((candidate) => candidate.id === entry.id)
      if (!place) {
        entry.mesh.visible = false
        continue
      }
      const tile = world.tiles[Math.round(place.y) * world.width + Math.round(place.x)]
      const at = tileToWorld(place.x, place.y, world.width, world.height)
      entry.mesh.position.set(at.x, tile ? groundHeight(place.x, place.y, tile.kind) + 0.1 : 0.1, at.z)
      entry.mesh.visible = true
    }
  }

  return {
    setMode: (next) => {
      if (mode === next) return
      mode = next
      signature = ''
    },
    getMode: () => mode,
    update: (world) => {
      const nextSignature = wantedSignature(world)
      if (signature !== nextSignature) {
        signature = nextSignature
        rebuild(world)
      }
      updatePositions(world)
    },
    dispose: () => {
      clear()
      scene.remove(root)
      geometry.dispose()
      for (const material of materials.values()) material.dispose()
    },
  }
}

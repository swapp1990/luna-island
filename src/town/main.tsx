import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { summarizeStructure } from '../sim/blueprints'
import { Simulation } from '../sim/sim'
import { toSimTime } from '../sim/time'
import { createAgents } from './agents'
import { createAssetCache, filesForPlaces } from './assets'
import { createCamera } from './camera'
import { createCompletionFx } from './completionFx'
import { TILE_METRES, TOWN_PRESET, TOWN_SEED } from './constants'
import { stageForProgress } from './constructionPlan'
import { tileToWorld } from './coords'
import { createDebug, type ConstructionListItem, type DebugHandle, type TownControl } from './debug'
import { Hud } from './hud'
import { createLighting } from './lighting'
import { createTownLoop, type TownLoop } from './loop'
import { createPlacementController, type PlacementController } from './placementController'
import { createPlacementGhost } from './placementGhost'
import { createPlaces } from './places'
import { createTerrain } from './terrain'
import { groundHeight } from './terrainHeight'
import { prospectiveBlueprintHitsTrees, prospectiveFootprintHitsTrees, prospectivePathHitsTrees } from './treePlan'
import { createTrees } from './trees'
import { createWorldOverlays } from './worldOverlays'
import { availableInvitation, currentMilestone, townAppeal } from '../sim/townGrowth'
import {
  brainModeFromLocation,
  LunaBrainService,
  mindConcurrencyFromLocation,
  mockWallDelayMsFromLocation,
} from '../mind/lunaBrain'

const mount = document.getElementById('town-root')
if (!mount) throw new Error('missing #town-root')
const root: HTMLElement = mount

async function boot(): Promise<void> {
  const canvasHost = document.createElement('div')
  canvasHost.style.cssText = 'position:absolute;inset:0;z-index:0'
  const hudHost = document.createElement('div')
  hudHost.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none'
  root.style.position = 'relative'
  root.append(canvasHost, hudHost)

  const sim = new Simulation(TOWN_SEED, {
    preset: TOWN_PRESET,
    scenario: 'first-storm',
  })
  const world = sim.state
  const islandMetres = world.width * TILE_METRES

  const viewW = canvasHost.clientWidth || window.innerWidth
  const viewH = Math.max(1, canvasHost.clientHeight || window.innerHeight)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(viewW, viewH)
  renderer.localClippingEnabled = true
  canvasHost.appendChild(renderer.domElement)
  const canvas = renderer.domElement
  canvas.style.touchAction = 'none'
  canvas.style.width = '100%'
  canvas.style.height = '100%'

  const scene = new THREE.Scene()
  const cam = createCamera(viewW / viewH)
  const plaza = world.places.find((p) => p.kind === 'plaza')
  if (plaza) {
    const at = tileToWorld(plaza.x, plaza.y, world.width, world.height)
    cam.setState({ tx: at.x, tz: at.z, dist: 58, yaw: 38, pitch: 48 })
  }

  const terrain = createTerrain(scene, world)
  const lighting = createLighting(renderer, scene, cam.camera, islandMetres)
  lighting.resize(viewW, viewH)

  const cache = createAssetCache()
  const fx = createCompletionFx(scene)
  const places = await createPlaces(scene, world, cache, filesForPlaces(world.places), fx)
  const placementGhost = createPlacementGhost(scene)
  const trees = await createTrees(scene, world, cache)
  const agents = createAgents(scene, world.agents)
  const overlays = createWorldOverlays(scene, agents)

  const validateTownBuild = (kind: Parameters<typeof sim.validateBuildPlacement>[0], x: number, y: number) => {
    const check = sim.validateBuildPlacement(kind, x, y)
    if (check.ok && prospectiveFootprintHitsTrees(sim.state, x, y)) {
      return { ...check, ok: false, reason: 'trees', reasonCode: 'trees' }
    }
    return check
  }
  const validateTownBlueprint = (blueprintId: string, x: number, y: number) => {
    const check = sim.validateBlueprintPlacement(blueprintId, x, y)
    if (check.ok && prospectiveBlueprintHitsTrees(sim.state, check.footprint)) {
      return { ...check, ok: false, reason: 'trees', reasonCode: 'trees' }
    }
    return check
  }
  const validateTownPath = (x: number, y: number) => {
    const check = sim.validatePathPlacement(x, y)
    if (check.ok && prospectivePathHitsTrees(sim.state, x, y)) {
      return { ...check, ok: false, reason: 'trees', reasonCode: 'trees' }
    }
    return check
  }

  const unbindCam = cam.bind(canvas)

  let debug!: DebugHandle
  let loop!: TownLoop
  let interaction!: PlacementController
  let mind: LunaBrainService | null = null
  const syncAfterCommand = () => {
    loop.syncVisuals()
    interaction.refresh()
  }
  const screenForTile = (x: number, y: number): { x: number; y: number } | null => {
    const tile = sim.state.tiles[y * sim.state.width + x]
    if (!tile) return null
    const at = tileToWorld(x, y, sim.state.width, sim.state.height)
    const p = new THREE.Vector3(at.x, groundHeight(x, y, tile.kind) + 0.25, at.z)
    p.project(cam.camera)
    if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1 || p.z < -1 || p.z > 1) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + (p.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - (p.y + 1) * 0.5) * rect.height,
    }
  }
  const screenForPlace = (placeId: string): { x: number; y: number } | null => {
    const place = sim.state.places.find((candidate) => candidate.id === placeId)
    return place ? screenForTile(place.x, place.y) : null
  }
  const screenForAgent = (agentId: string): { x: number; y: number } | null => {
    const object = agents.objectFor(agentId)
    if (!object) return null
    const p = new THREE.Vector3()
    object.getWorldPosition(p)
    p.project(cam.camera)
    if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1 || p.z < -1 || p.z > 1) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + (p.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - (p.y + 1) * 0.5) * rect.height,
    }
  }
  const findVisibleBuildTile = (
    kind: Parameters<typeof sim.validateBuildPlacement>[0],
    wantValid: boolean,
  ): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect()
    const candidates: Array<{ x: number; y: number; score: number; collision: boolean }> = []
    for (let y = 1; y < sim.state.height - 1; y++) {
      for (let x = 1; x < sim.state.width - 1; x++) {
        const check = validateTownBuild(kind, x, y)
        if (check.ok !== wantValid) continue
        const point = screenForTile(x, y)
        if (!point) continue
        // Stay clear of the top resource bar and bottom build tray so a real
        // pointer event reaches the WebGL canvas during acceptance tests.
        if (
          point.x < rect.left + 32 ||
          point.x > rect.right - 32 ||
          point.y < rect.top + 96 ||
          point.y > rect.bottom - 220
        ) continue
        candidates.push({
          x,
          y,
          score: Math.hypot(point.x - (rect.left + rect.width / 2), point.y - (rect.top + rect.height / 2)),
          collision: check.reason === 'collision',
        })
      }
    }
    candidates.sort((a, b) => {
      if (a.collision !== b.collision) return a.collision ? -1 : 1
      return a.score - b.score
    })
    return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null
  }
  const findVisiblePathTile = (): { x: number; y: number } | null => {
    const rect = canvas.getBoundingClientRect()
    const candidates: Array<{ x: number; y: number; score: number }> = []
    for (let y = 0; y < sim.state.height; y++) {
      for (let x = 0; x < sim.state.width; x++) {
        if (!validateTownPath(x, y).ok) continue
        const point = screenForTile(x, y)
        if (!point) continue
        if (
          point.x < rect.left + 32 ||
          point.x > rect.right - 32 ||
          point.y < rect.top + 96 ||
          point.y > rect.bottom - 220
        ) continue
        candidates.push({
          x,
          y,
          score: Math.hypot(
            point.x - (rect.left + rect.width / 2),
            point.y - (rect.top + rect.height / 2),
          ),
        })
      }
    }
    candidates.sort((a, b) => a.score - b.score)
    return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null
  }
  const control: TownControl = {
    setSpeed: (n) => loop.setSpeed(n),
    setCamera: (o) => {
      cam.setState(o)
      debug.writeCamera(cam.getState())
    },
    listPlaces: () => places.list(),
    showRefSpheres: (on) => lighting.showRefSpheres(on),
    fpsProbe: (ms) => debug.fpsProbe(ms),
    ffwd: async (nTicks) => {
      const CAP = 20_000
      const CHUNK = 500
      let remaining = Math.max(0, Math.min(CAP, Math.floor(nTicks)))
      // Pause the normal rAF loop for the duration — otherwise its own
      // real-time tick accumulator keeps advancing the sim concurrently,
      // which would make ffwd's total tick count (and thus the world it
      // produces) depend on wall-clock timing instead of being exact.
      loop.stop()
      while (remaining > 0) {
        const step = Math.min(CHUNK, remaining)
        loop.advanceTicks(step, true)
        remaining -= step
        loop.syncVisuals()
        // Yield so the tab stays responsive across a long ffwd.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      loop.syncVisuals()
      interaction.refresh()
      // Rendering must resume even when simulation speed is 0. Paused towns
      // still need a live rAF so completed/demolished visuals reach the canvas.
      loop.start()
    },
    listConstruction: () => {
      const rows: ConstructionListItem[] = []
      for (const p of sim.state.places) {
        if (p.kind !== 'construction-site') continue
        const progress = p.construction?.progress ?? 0
        rows.push({
          id: p.id,
          kind: p.construction?.targetKind ?? 'home',
          progress,
          stage: stageForProgress(progress),
        })
      }
      return rows
    },
    setTimeOfDay: (h) => loop.setTimeOfDay(h),
    beginBuild: (kind) => interaction.beginBuild(kind),
    beginPath: () => interaction.beginPath(),
    interactionState: () => interaction.getState(),
    validateBuild: validateTownBuild,
    validatePath: validateTownPath,
    findBuildable: (kind) => {
      const visible = findVisibleBuildTile(kind, true)
      if (visible) return visible
      for (let y = 1; y < sim.state.height - 1; y++) {
        for (let x = 1; x < sim.state.width - 1; x++) {
          if (validateTownBuild(kind, x, y).ok) return { x, y }
        }
      }
      return null
    },
    findInvalidBuild: (kind) => findVisibleBuildTile(kind, false),
    findPathable: () => findVisiblePathTile(),
    screenForTile,
    screenForPlace,
    screenForAgent,
    issueBuild: (kind, x, y) => {
      const result = sim.issuePlayerCommand({ type: 'build', placeKind: kind, x, y })
      if (result.ok) syncAfterCommand()
      return result
    },
    cancelConstruction: (placeId) => {
      const result = sim.issuePlayerCommand({ type: 'cancel-construction', placeId })
      if (result.ok) syncAfterCommand()
      return result
    },
    demolish: (placeId) => {
      const result = sim.issuePlayerCommand({ type: 'demolish', placeId })
      if (result.ok) syncAfterCommand()
      return result
    },
    paintPath: (x, y, enabled = true) => {
      const result = sim.issuePlayerCommand({ type: 'paint-path', x, y, enabled })
      if (result.ok) syncAfterCommand()
      return result
    },
    setWorkPriority: (category, level) => {
      const result = sim.issuePlayerCommand({ type: 'set-work-priority', category, level })
      if (result.ok) syncAfterCommand()
      return result
    },
    setConstructionPriority: (placeId, priority) => {
      const result = sim.issuePlayerCommand({ type: 'set-construction-priority', placeId, priority })
      if (result.ok) syncAfterCommand()
      return result
    },
    setStockpileFilter: (placeId, good, enabled) => {
      const result = sim.issuePlayerCommand({ type: 'set-stockpile-filter', placeId, good, enabled })
      if (result.ok) syncAfterCommand()
      return result
    },
    upgradePlace: (placeId) => {
      const result = sim.issuePlayerCommand({ type: 'upgrade-place', placeId })
      if (result.ok) syncAfterCommand()
      return result
    },
    acceptInvitation: (candidateId) => {
      const result = sim.issuePlayerCommand({ type: 'accept-invitation', candidateId })
      if (result.ok) syncAfterCommand()
      return result
    },
    placeBlueprint: (id, x, y) => {
      const result = sim.issuePlayerCommand({ type: 'place-blueprint', blueprintId: id, x, y })
      if (result.ok) syncAfterCommand()
      return { ok: result.ok, reason: result.reason }
    },
    listStructures: () => {
      const rows = []
      for (const place of sim.state.places) {
        const row = summarizeStructure(place)
        if (row) rows.push(row)
      }
      return rows
    },
    fastForward: (ticks) => {
      const n = Math.max(0, Math.min(20_000, Math.floor(ticks)))
      loop.advanceTicks(n, true)
      loop.syncVisuals()
      interaction.refresh()
      const t = toSimTime(sim.state.tick)
      debug.state.day = t.day
      debug.state.hour = t.hour
      debug.state.minute = t.minute
      debug.state.tick = sim.state.tick
      debug.state.agentCount = sim.state.agents.length
      debug.state.placeCount = sim.state.places.length
      let constructing = 0
      let structureActive = 0
      let structureBuilt = 0
      for (const p of sim.state.places) {
        if (p.kind === 'construction-site') constructing += 1
        if (p.structure) {
          if (p.kind === 'construction-site') structureActive += 1
          else structureBuilt += 1
        }
      }
      debug.state.constructionCount = constructing
      debug.state.structures = { active: structureActive, built: structureBuilt }
    },
    validateBlueprint: validateTownBlueprint,
    getEvents: () => sim.getEvents(),
    growthSnapshot: () => ({
      appeal: townAppeal(sim.state),
      milestone: currentMilestone(sim.state).id,
      invitationCandidates: availableInvitation(sim.state)?.candidates.map((candidate) => candidate.id) ?? [],
      scenarioStatus: sim.state.scenario?.status ?? 'sandbox',
    }),
    socialSnapshot: () => ({
      sayCount: sim.state.sayLog.length,
      proposalCount: sim.state.proposals.length,
      gatheringCount: sim.state.gatherings?.length ?? 0,
      mindDecisionCount: sim.state.externalIntentLog.length,
      mindAgentIds: [...new Set(sim.state.externalIntentLog.map((record) => record.agentId))],
      assemblyAtNoticeBoard: sim.getEvents().some((event) => {
        if (event.type !== 'gathering:scheduled') return false
        const place = sim.state.places.find((candidate) => candidate.id === event.data?.placeId)
        return place?.kind === 'notice-board'
      }),
    }),
  }
  debug = createDebug(control)
  debug.state.agentCount = world.agents.length
  debug.state.placeCount = world.places.length
  debug.state.treeCount = trees.count()
  const inst = places.instanceStats()
  const files = cache.stats()
  debug.state.assets = { loaded: inst.loaded, fallback: inst.fallback, failed: files.failed }
  debug.writeCamera(cam.getState())

  loop = createTownLoop({ sim, camera: cam, lighting, agents, places, terrain, overlays, fx, debug })
  interaction = createPlacementController({
    canvas,
    scene,
    camera: cam.camera,
    terrain,
    places,
    agents,
    ghost: placementGhost,
    getWorld: () => sim.state,
    validateBuild: validateTownBuild,
    issueBuild: (kind, x, y) => sim.issuePlayerCommand({ type: 'build', placeKind: kind, x, y }),
    validateBlueprint: validateTownBlueprint,
    issueBlueprint: (id, x, y) =>
      sim.issuePlayerCommand({ type: 'place-blueprint', blueprintId: id, x, y }),
    validatePath: validateTownPath,
    issuePath: (x, y) => sim.issuePlayerCommand({ type: 'paint-path', x, y, enabled: true }),
    issueCancel: (placeId) => sim.issuePlayerCommand({ type: 'cancel-construction', placeId }),
    issueDemolish: (placeId) => sim.issuePlayerCommand({ type: 'demolish', placeId }),
    syncVisuals: () => loop.syncVisuals(),
  })

  const onResize = () => {
    const w = canvasHost.clientWidth
    const h = Math.max(1, canvasHost.clientHeight)
    renderer.setSize(w, h)
    cam.camera.aspect = w / h
    cam.camera.updateProjectionMatrix()
    lighting.resize(w, h)
  }
  window.addEventListener('resize', onResize)

  createRoot(hudHost).render(
    <Hud
      getState={() => debug.state}
      getWorld={() => sim.state}
      getInteraction={() => interaction.getState()}
      getEvents={() => sim.getEvents()}
      setSpeed={(n) => loop.setSpeed(n)}
      beginBuild={(kind) => interaction.beginBuild(kind)}
      beginBlueprint={(id) => interaction.beginBlueprint(id)}
      beginPath={() => interaction.beginPath()}
      cancelPlacement={() => interaction.cancelMode()}
      cancelSelected={() => {
        interaction.cancelSelected()
      }}
      demolishSelected={() => {
        interaction.demolishSelected()
      }}
      setWorkPriority={(category, level) => {
        const result = sim.issuePlayerCommand({ type: 'set-work-priority', category, level })
        if (result.ok) syncAfterCommand()
      }}
      setConstructionPriority={(placeId, priority) => {
        const result = sim.issuePlayerCommand({ type: 'set-construction-priority', placeId, priority })
        if (result.ok) syncAfterCommand()
      }}
      setStockpileFilter={(placeId, good, enabled) => {
        const result = sim.issuePlayerCommand({ type: 'set-stockpile-filter', placeId, good, enabled })
        if (result.ok) syncAfterCommand()
      }}
      upgradePlace={(placeId) => {
        const result = sim.issuePlayerCommand({ type: 'upgrade-place', placeId })
        if (!result.ok) return
        syncAfterCommand()
        if (result.placeId) interaction.selectPlace(result.placeId)
      }}
      acceptInvitation={(candidateId) => {
        const result = sim.issuePlayerCommand({ type: 'accept-invitation', candidateId })
        if (!result.ok) return
        syncAfterCommand()
        interaction.selectAgent(candidateId)
      }}
      selectAgent={(agentId) => interaction.selectAgent(agentId)}
      selectPlace={(placeId) => interaction.selectPlace(placeId)}
      setOverlay={(mode) => {
        overlays.setMode(mode)
        overlays.update(sim.state)
      }}
      getMindMeter={() => mind?.getMeter() ?? null}
      screenForAgent={screenForAgent}
      replayLatestMindMoment={() => {
        const record = sim.state.externalIntentLog.at(-1)
        if (!record) return null
        const before = mind?.getDecideCallCount() ?? 0
        const replay = sim.stateAt(record.tick)
        const resident = replay.state.agents.find((agent) => agent.id === record.agentId)
        const after = mind?.getDecideCallCount() ?? 0
        return {
          tick: record.tick,
          label: resident?.name ?? record.agentId,
          reason: resident?.action.reason ?? record.meta.reasoning,
          callsUnchanged: before === after,
        }
      }}
    />,
  )

  // The player town and observer now share the same production mind service.
  // No Luna is present at scenario start; the hook becomes active naturally
  // after the player accepts a named invitation.
  const brainMode = brainModeFromLocation()
  const mindService = new LunaBrainService(brainMode, {
    mockWallDelayMs: brainMode === 'mock' ? mockWallDelayMsFromLocation() : 0,
    concurrency: mindConcurrencyFromLocation(),
    sessionTokenBudget: 12_000,
    onPipelineChange: () => {
      loop.syncVisuals()
      interaction.refresh()
    },
  })
  mind = mindService
  const attachMind = () => {
    if (!mindService.isEnabled()) {
      loop.setMindHook(null)
      return
    }
    loop.setMindHook({
      onAfterTick: (live, opts) => mindService.onAfterTick(live, opts),
    })
    mindService.onAfterTick(sim, { allowNewConversations: false })
  }
  if (brainMode === 'auto') {
    void mindService.init().then(attachMind)
  } else {
    void mindService.init()
    attachMind()
  }

  loop.start()

  window.addEventListener('beforeunload', () => {
    loop.setMindHook(null)
    mindService.dispose()
    loop.stop()
    interaction.dispose()
    placementGhost.dispose()
    overlays.dispose()
    unbindCam()
    window.removeEventListener('resize', onResize)
  })
}

void boot()

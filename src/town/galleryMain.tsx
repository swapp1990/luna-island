import * as THREE from 'three'
import { useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createAssetCache, type AssetCache } from './assets'
import { createCamera } from './camera'
import { risingHeight01 } from './constructionPlan'
import {
  applyWorldClipY,
  buildFrameStage,
  buildPadStage,
  uniquifyMaterials,
} from './constructionVisuals'
import { footprintMetres, placeholderHeight } from './coords'
import {
  GALLERY_ROWS,
  GALLERY_STAGE_PROGRESS,
  stagesFor,
  type GalleryRow,
  type GalleryStage,
} from './galleryCatalog'
import { GalleryHud } from './galleryHud'
import { createLighting } from './lighting'
import { hideDressHelpers } from './materialDress'
import type { CameraLimits } from './feel'
import type { AssetEntry } from './manifest'

const mountEl = document.getElementById('gallery-root')
if (!mountEl) throw new Error('missing #gallery-root')
const mount: HTMLElement = mountEl

const INSPECT_LIMITS: CameraLimits = {
  distMin: 3.2,
  distMax: 40,
  panLimit: 14,
  pitchMin: 8,
  pitchMax: 78,
}

function missingFinished(row: GalleryRow, geos: THREE.BufferGeometry[], mats: THREE.Material[]): THREE.Object3D {
  const fp = footprintMetres(row.footprintKind)
  const h = Math.max(0.12, placeholderHeight(row.footprintKind) * (row.footprintKind === 'farm' ? 0.04 : 1))
  const geo = new THREE.BoxGeometry(fp.w * 0.9, h, fp.d * 0.9)
  const mat = new THREE.MeshStandardMaterial({
    color: row.missing ? 0x6a6560 : 0x8a8a8a,
    roughness: 0.78,
    metalness: 0,
  })
  geos.push(geo)
  mats.push(mat)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = h / 2
  mesh.castShadow = h > 0.3
  mesh.receiveShadow = true
  return mesh
}

function sitOnGround(obj: THREE.Object3D): void {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  obj.position.y -= box.min.y
}

interface WorldApi {
  show: (row: GalleryRow, stage: GalleryStage) => void
  fps: () => number
}

let selectHook: ((id: string) => void) | null = null
let stageHook: ((s: GalleryStage) => void) | null = null

function GalleryRoot(props: { world: WorldApi }): ReactElement {
  const initial = (() => {
    const h = window.location.hash.replace(/^#/, '')
    return GALLERY_ROWS.some((r) => r.id === h) ? h : GALLERY_ROWS[0]!.id
  })()
  const [id, setId] = useState(initial)
  const [stage, setStage] = useState<GalleryStage>('finished')
  const [fps, setFps] = useState(60)
  const selected = GALLERY_ROWS.find((r) => r.id === id) ?? GALLERY_ROWS[0]!

  useEffect(() => {
    selectHook = setId
    stageHook = setStage
    return () => {
      selectHook = null
      stageHook = null
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, '')
      if (GALLERY_ROWS.some((r) => r.id === h)) setId(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const allowed = stagesFor(selected)
    const st = allowed.includes(stage) ? stage : 'finished'
    if (st !== stage) {
      setStage(st)
      return
    }
    props.world.show(selected, st)
    const url = `${window.location.pathname}${window.location.search}#${id}`
    history.replaceState(null, '', url)
    if (import.meta.env.DEV) {
      const w = window as unknown as { __galleryState?: { ready: boolean; selectedId: string; stage: string } }
      if (w.__galleryState) {
        w.__galleryState.selectedId = id
        w.__galleryState.stage = st
      }
    }
  }, [id, stage, selected, props.world])

  useEffect(() => {
    const t = window.setInterval(() => setFps(props.world.fps()), 250)
    return () => window.clearInterval(t)
  }, [props.world])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = GALLERY_ROWS.findIndex((r) => r.id === id)
      if (e.code === 'ArrowDown' || e.code === 'KeyJ') {
        e.preventDefault()
        setId(GALLERY_ROWS[Math.min(GALLERY_ROWS.length - 1, i + 1)]!.id)
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyK') {
        e.preventDefault()
        setId(GALLERY_ROWS[Math.max(0, i - 1)]!.id)
      }
      const col: Record<string, GalleryStage> = {
        Digit1: 'pad',
        Digit2: 'frame',
        Digit3: 'rising',
        Digit4: 'finished',
      }
      const next = col[e.code]
      if (next && stagesFor(selected).includes(next)) setStage(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, selected])

  return (
    <GalleryHud
      fps={fps}
      selected={selected}
      stage={stage}
      onSelect={setId}
      onStage={setStage}
    />
  )
}

async function boot(): Promise<void> {
  const canvasHost = document.createElement('div')
  canvasHost.style.cssText = 'position:absolute;inset:0;z-index:0'
  const hudHost = document.createElement('div')
  hudHost.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none'
  mount.style.position = 'relative'
  mount.append(canvasHost, hudHost)

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
  const cam = createCamera(viewW / viewH, {
    limits: INSPECT_LIMITS,
    leftDragOrbit: true,
    arrowsPan: false,
  })
  const lighting = createLighting(renderer, scene, cam.camera, 40)
  lighting.resize(viewW, viewH)
  lighting.updateForTime(13)

  const geos: THREE.BufferGeometry[] = []
  const mats: THREE.Material[] = []
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x7a8f4a, roughness: 0.95 })
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0xb5a488, roughness: 0.96 })
  mats.push(grassMat, dirtMat)
  const grass = new THREE.Mesh(new THREE.CircleGeometry(16, 48), grassMat)
  grass.rotation.x = -Math.PI / 2
  grass.receiveShadow = true
  scene.add(grass)
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(6, 32), dirtMat)
  dirt.rotation.x = -Math.PI / 2
  dirt.position.y = 0.02
  dirt.receiveShadow = true
  scene.add(dirt)

  const cache: AssetCache = createAssetCache()
  const files = [...new Set(GALLERY_ROWS.map((r) => r.file).filter((f): f is string => !!f))]
  await cache.preload(files)

  const holder = new THREE.Group()
  scene.add(holder)
  let shown: THREE.Object3D | null = null

  const buildVisual = (row: GalleryRow, stage: GalleryStage): THREE.Object3D => {
    const fpM = footprintMetres(row.footprintKind)
    const eaveH = Math.max(2.2, placeholderHeight(row.footprintKind) * 0.55)
    const pitch = row.id === 'church' ? 56 : row.footprintKind === 'stall' ? 32 : 48
    if (stage === 'pad') return buildPadStage(row.id, fpM, geos, mats)
    if (stage === 'frame') return buildFrameStage(fpM, eaveH, geos, mats, { roofPitchDeg: pitch })

    const entry: AssetEntry | null = row.file ? { file: row.file } : null
    const available = entry ? cache.fileAvailable(entry.file) : false

    if (stage === 'rising') {
      const g = new THREE.Group()
      g.add(buildFrameStage(fpM, eaveH, geos, mats, { roofPitchDeg: pitch }))
      if (entry && available) {
        const obj = cache.instantiate(entry)
        if (obj) {
          uniquifyMaterials(obj)
          hideDressHelpers(obj)
          sitOnGround(obj)
          const box = new THREE.Box3().setFromObject(obj)
          const clipY = box.min.y + (box.max.y - box.min.y) * risingHeight01(GALLERY_STAGE_PROGRESS.rising)
          applyWorldClipY(obj, clipY)
          g.add(obj)
        }
      }
      return g
    }

    if (entry && available) {
      const obj = cache.instantiate(entry)
      if (obj) {
        sitOnGround(obj)
        return obj
      }
    }
    return missingFinished(row, geos, mats)
  }

  const frameItem = (obj: THREE.Object3D) => {
    obj.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(obj)
    const size = box.getSize(new THREE.Vector3())
    const c = box.getCenter(new THREE.Vector3())
    const span = Math.max(size.x, size.y, size.z, 1.4)
    cam.setState({
      tx: c.x,
      tz: c.z,
      ty: c.y,
      dist: Math.max(5.5, span * 2.2),
      pitch: 26,
      yaw: 38,
    })
  }

  const show = (row: GalleryRow, stage: GalleryStage) => {
    if (shown) {
      holder.remove(shown)
      shown = null
    }
    const visual = buildVisual(row, stage)
    holder.add(visual)
    shown = visual
    const fp = footprintMetres(row.footprintKind)
    dirt.scale.setScalar(Math.max(fp.w, fp.d) / 8 + 0.35)
    frameItem(visual)
  }

  let fps = 60
  const world: WorldApi = {
    show,
    fps: () => fps,
  }

  cam.setState({ yaw: 38, pitch: 26, dist: 12, tx: 0, tz: 0, ty: 1.4 })

  const onResize = () => {
    const w = canvasHost.clientWidth
    const h = Math.max(1, canvasHost.clientHeight)
    renderer.setSize(w, h)
    cam.camera.aspect = w / h
    cam.camera.updateProjectionMatrix()
    lighting.resize(w, h)
  }
  window.addEventListener('resize', onResize)
  const unbind = cam.bind(canvas)

  let lastTs = 0
  let raf = 0
  const tick = (ts: number) => {
    if (!lastTs) lastTs = ts
    const dt = (ts - lastTs) / 1000
    lastTs = ts
    cam.update(Math.min(0.08, Math.max(0, dt)))
    lighting.render()
    if (dt > 0 && dt < 1) fps = fps + (1 / dt - fps) * Math.min(1, dt * 4)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  createRoot(hudHost).render(<GalleryRoot world={world} />)

  if (import.meta.env.DEV) {
    const w = window as unknown as {
      __galleryState: { ready: boolean; selectedId: string; stage: string }
      __galleryControl: {
        select: (id: string) => void
        setStage: (s: string) => void
        orbit: (yaw: number) => void
      }
    }
    w.__galleryState = { ready: true, selectedId: GALLERY_ROWS[0]!.id, stage: 'finished' }
    w.__galleryControl = {
      select: (id: string) => selectHook?.(id),
      setStage: (s: string) => stageHook?.(s as GalleryStage),
      orbit: (yaw: number) => cam.setState({ yaw }),
    }
  }

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(raf)
    unbind()
    window.removeEventListener('resize', onResize)
    cache.dispose()
  })
}

void boot()

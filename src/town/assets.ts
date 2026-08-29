import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ASSET_MANIFEST, assetKey, assetUrl, type AssetEntry } from './manifest'
import { dressLoadedAsset } from './materialDress'

export {
  ASSET_FILES,
  ASSET_MANIFEST,
  assetKey,
  assetUrl,
  decidePlaceRender,
  resolveManifest,
  type AssetEntry,
  type PlaceRenderDecision,
} from './manifest'

export interface AssetStats {
  /** Distinct files that loaded. */
  loaded: number
  /** Distinct files that 404'd / failed to parse. */
  failed: number
}

/** One mesh's geometry baked into template-root space (no residual local transform). */
export interface BakedSubmesh {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export interface AssetCache {
  preload: (files: string[]) => Promise<void>
  /** Template for `file`, or null if it failed / was never asked. */
  template: (file: string) => THREE.Group | null
  fileAvailable: (file: string) => boolean
  instantiate: (entry: AssetEntry) => THREE.Object3D | null
  /** XZ/Y bounds of the unscaled, unrotated template — measured once at load (V1 footprint-fit). */
  bounds: (file: string) => THREE.Box3 | null
  /** Baked (world-space-in-template) submeshes for InstancedMesh use (V2 trees). */
  submeshes: (file: string) => BakedSubmesh[] | null
  stats: () => AssetStats
  dispose: () => void
}

/**
 * Load each distinct glTF once, cache, clone per instance.
 * A 404 is a placeholder, with one console.warn per file.
 */
export function createAssetCache(): AssetCache {
  const loader = new GLTFLoader()
  const templates = new Map<string, THREE.Group | null>()
  const boundsCache = new Map<string, THREE.Box3 | null>()
  const submeshCache = new Map<string, BakedSubmesh[] | null>()
  const warned = new Set<string>()
  let loaded = 0
  let failed = 0

  const bakeSubmeshes = (root: THREE.Group): BakedSubmesh[] => {
    root.updateMatrixWorld(true)
    const out: BakedSubmesh[] = []
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry.clone()
        geo.applyMatrix4(o.matrixWorld)
        const mat = Array.isArray(o.material) ? o.material[0]! : o.material
        out.push({ geometry: geo, material: mat })
      }
    })
    return out
  }

  const loadFile = async (file: string): Promise<THREE.Group | null> => {
    if (templates.has(file)) return templates.get(file) ?? null
    const url = assetUrl(file)
    try {
      const gltf = await loader.loadAsync(url)
      const root = gltf.scene
      try {
        dressLoadedAsset(root, file)
      } catch (err) {
        console.warn(`[town] material dress failed for ${file}`, err)
      }
      templates.set(file, root)
      boundsCache.set(file, new THREE.Box3().setFromObject(root))
      submeshCache.set(file, bakeSubmeshes(root))
      loaded += 1
      return root
    } catch (err) {
      if (!warned.has(file)) {
        console.warn(`[town] glTF missing or invalid: ${url} — using placeholder`, err)
        warned.add(file)
      }
      templates.set(file, null)
      boundsCache.set(file, null)
      submeshCache.set(file, null)
      failed += 1
      return null
    }
  }

  return {
    preload: async (files) => {
      const unique = [...new Set(files)]
      await Promise.all(unique.map((f) => loadFile(f)))
    },
    template: (file) => templates.get(file) ?? null,
    fileAvailable: (file) => templates.get(file) != null,
    instantiate: (entry) => {
      const tpl = templates.get(entry.file)
      if (!tpl) return null
      const obj = tpl.clone(true)
      if (entry.yawDeg) obj.rotation.y = THREE.MathUtils.degToRad(entry.yawDeg)
      if (entry.scale !== undefined) obj.scale.setScalar(entry.scale)
      return obj
    },
    bounds: (file) => boundsCache.get(file) ?? null,
    submeshes: (file) => submeshCache.get(file) ?? null,
    stats: () => ({ loaded, failed }),
    dispose: () => {
      for (const g of templates.values()) {
        g?.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose()
            const mat = o.material
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat.dispose()
          }
        })
      }
      for (const subs of submeshCache.values()) {
        subs?.forEach((s) => s.geometry.dispose())
      }
      templates.clear()
      boundsCache.clear()
      submeshCache.clear()
    },
  }
}

/** Unique manifest files referenced by this world's places. */
export function filesForPlaces(
  places: ReadonlyArray<{ kind: string; level?: number }>,
): string[] {
  const files = new Set<string>()
  for (const p of places) {
    const entry = ASSET_MANIFEST[assetKey(p.kind, p.level)]
    if (entry) files.add(entry.file)
  }
  return [...files]
}

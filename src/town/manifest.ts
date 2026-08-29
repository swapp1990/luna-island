/**
 * Place-kind (+ level) → glTF file. Rename an export with one line in ASSET_FILES.
 * Runtime loading (GLTFLoader, cache, clone) lives in `assets.ts`.
 */

export interface AssetEntry {
  file: string
  yawDeg?: number
  scale?: number
  /** Temporary fixture mapping — swap `file` when the manor-slice export lands. */
  temporary?: boolean
}

/** One-line rename table — matches the real exports in art/manor-slice/export/gltf/. */
export const ASSET_FILES = {
  burgageL1: 'fv_burgage_l1.glb',
  burgageL2: 'fv_burgage_l2.glb',
  church: 'fv_church_wooden.glb',
  granary: 'fv_granary_barn.glb',
  stallA: 'fv_market_stall_a.glb',
  well: 'fv_well_stone.glb',
  noticeBoard: 'fv_notice_board.glb',
  fixtureCube: 'fixture-cube.gltf',
} as const

/** Single-tree GLBs (V2) — not place-mapped, loaded + instanced separately by `trees.ts`. */
export const TREE_FILES = ['fv_tree_a.glb', 'fv_tree_b.glb', 'fv_tree_c.glb'] as const

export function assetKey(kind: string, level?: number): string {
  if (kind === 'home') {
    const lv = level && level >= 1 ? Math.min(3, Math.floor(level)) : 1
    return `home:${lv}`
  }
  return kind
}

/**
 * Manifest keyed by `assetKey(kind, level)`.
 *
 * All entries point at real manor-slice exports (P7 batch, ph7_export_batch.py).
 * `fixture-cube.gltf` remains as the loader-path test asset only.
 */
export const ASSET_MANIFEST: Record<string, AssetEntry> = {
  'home:1': { file: ASSET_FILES.burgageL1 },
  'home:2': { file: ASSET_FILES.burgageL2 },
  'home:3': { file: ASSET_FILES.burgageL2 },
  well: { file: ASSET_FILES.well },
  'notice-board': { file: ASSET_FILES.noticeBoard },
  stall: { file: ASSET_FILES.stallA },
  storehouse: { file: ASSET_FILES.granary },
  church: { file: ASSET_FILES.church },
}

export function resolveManifest(kind: string, level?: number): AssetEntry | null {
  const key = assetKey(kind, level)
  return ASSET_MANIFEST[key] ?? null
}

export type PlaceRenderDecision = 'gltf' | 'placeholder'

/**
 * Fallback-on-missing: no entry, or a known-missing file, ⇒ placeholder.
 * `fileAvailable === true` is the only path that selects glTF.
 */
export function decidePlaceRender(
  kind: string,
  level: number | undefined,
  fileAvailable: boolean,
): PlaceRenderDecision {
  const entry = resolveManifest(kind, level)
  if (!entry) return 'placeholder'
  return fileAvailable ? 'gltf' : 'placeholder'
}

export function assetUrl(file: string): string {
  return `/assets/gltf/${file}`
}

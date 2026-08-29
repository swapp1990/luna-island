/**
 * Pure kit-zoo layout. No three.js — the gallery renderer and tests both
 * read this so the grid on screen matches the catalog.
 */
import type { PlaceKind } from '../sim/types'
import { ASSET_FILES, TREE_FILES } from './manifest'

export const GALLERY_STAGES = ['pad', 'frame', 'rising', 'finished'] as const
export type GalleryStage = (typeof GALLERY_STAGES)[number]

/** Representative progress used when previewing a construction column. */
export const GALLERY_STAGE_PROGRESS: Record<Exclude<GalleryStage, 'finished'>, number> = {
  pad: 0.15,
  frame: 0.55,
  rising: 0.88,
}

export const GALLERY_STAGE_LABEL: Record<GalleryStage, string> = {
  pad: 'Pad  <35%',
  frame: 'Frame  35–75%',
  rising: 'Rising  >75%',
  finished: 'Finished',
}

export interface GalleryRow {
  id: string
  label: string
  /** Footprint source. Church isn't a PlaceKind — we borrow storehouse (3×3). */
  footprintKind: PlaceKind
  level?: number
  file?: string
  /** False → only the finished cell is filled (trees, extra stall skins). */
  hasConstruction: boolean
  /** No GLB yet — finished cell is a placeholder. */
  missing?: boolean
}

export const GALLERY_ROWS: GalleryRow[] = [
  {
    id: 'home-l1',
    label: 'House L1',
    footprintKind: 'home',
    level: 1,
    file: ASSET_FILES.burgageL1,
    hasConstruction: true,
  },
  {
    id: 'home-l2',
    label: 'House L2',
    footprintKind: 'home',
    level: 2,
    file: ASSET_FILES.burgageL2,
    hasConstruction: true,
  },
  {
    id: 'well',
    label: 'Well',
    footprintKind: 'well',
    file: ASSET_FILES.well,
    hasConstruction: true,
  },
  {
    id: 'stall-a',
    label: 'Stall A',
    footprintKind: 'stall',
    file: ASSET_FILES.stallA,
    hasConstruction: true,
  },
  {
    id: 'stall-b',
    label: 'Stall B',
    footprintKind: 'stall',
    file: 'fv_market_stall_b.glb',
    hasConstruction: true,
  },
  {
    id: 'stall-c',
    label: 'Stall C',
    footprintKind: 'stall',
    file: 'fv_market_stall_c.glb',
    hasConstruction: true,
  },
  {
    id: 'storehouse',
    label: 'Granary',
    footprintKind: 'storehouse',
    file: ASSET_FILES.granary,
    hasConstruction: true,
  },
  {
    id: 'church',
    label: 'Church',
    footprintKind: 'storehouse',
    file: ASSET_FILES.church,
    hasConstruction: true,
  },
  {
    id: 'notice-board',
    label: 'Notice-board',
    footprintKind: 'notice-board',
    file: ASSET_FILES.noticeBoard,
    hasConstruction: true,
  },
  {
    id: 'farm',
    label: 'Farm',
    footprintKind: 'farm',
    hasConstruction: true,
    missing: true,
  },
  {
    id: 'forestry',
    label: 'Forestry',
    footprintKind: 'forestry',
    hasConstruction: true,
    missing: true,
  },
  {
    id: 'quarry',
    label: 'Quarry',
    footprintKind: 'quarry',
    hasConstruction: true,
    missing: true,
  },
  {
    id: 'tree-a',
    label: 'Tree A',
    footprintKind: 'berry-bush',
    file: TREE_FILES[0],
    hasConstruction: false,
  },
  {
    id: 'tree-b',
    label: 'Tree B',
    footprintKind: 'berry-bush',
    file: TREE_FILES[1],
    hasConstruction: false,
  },
  {
    id: 'tree-c',
    label: 'Tree C',
    footprintKind: 'berry-bush',
    file: TREE_FILES[2],
    hasConstruction: false,
  },
]

export const GALLERY_COL_X: Record<GalleryStage, number> = {
  pad: -27,
  frame: -9,
  rising: 9,
  finished: 27,
}

export const GALLERY_ROW_PITCH = 12

export interface GalleryCell {
  id: string
  row: GalleryRow
  stage: GalleryStage
  x: number
  z: number
}

export function galleryRowZ(rowIndex: number, rowCount: number = GALLERY_ROWS.length): number {
  const z0 = -((rowCount - 1) / 2) * GALLERY_ROW_PITCH
  return z0 + rowIndex * GALLERY_ROW_PITCH
}

export function stagesFor(row: GalleryRow): GalleryStage[] {
  return row.hasConstruction ? [...GALLERY_STAGES] : ['finished']
}

export function galleryCells(rows: readonly GalleryRow[] = GALLERY_ROWS): GalleryCell[] {
  const out: GalleryCell[] = []
  rows.forEach((row, i) => {
    const z = galleryRowZ(i, rows.length)
    for (const stage of stagesFor(row)) {
      out.push({
        id: `${row.id}:${stage}`,
        row,
        stage,
        x: GALLERY_COL_X[stage],
        z,
      })
    }
  })
  return out
}

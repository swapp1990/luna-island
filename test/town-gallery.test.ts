import { describe, expect, it } from 'vitest'
import {
  GALLERY_ROWS,
  GALLERY_STAGES,
  stagesFor,
} from '../src/town/galleryCatalog'

describe('kit gallery catalog', () => {
  it('gives every row a unique id', () => {
    const ids = GALLERY_ROWS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists all four construction stages for buildings', () => {
    const built = GALLERY_ROWS.filter((r) => r.hasConstruction)
    expect(built.length).toBeGreaterThan(0)
    for (const row of built) {
      expect(stagesFor(row)).toEqual([...GALLERY_STAGES])
    }
  })

  it('trees inspect as finished only', () => {
    const trees = GALLERY_ROWS.filter((r) => r.id.startsWith('tree-'))
    expect(trees.length).toBe(3)
    for (const row of trees) {
      expect(stagesFor(row)).toEqual(['finished'])
    }
  })

  it('marks farm / forestry / quarry as missing finished meshes', () => {
    for (const id of ['farm', 'forestry', 'quarry']) {
      const row = GALLERY_ROWS.find((r) => r.id === id)
      expect(row?.missing).toBe(true)
      expect(row?.file).toBeUndefined()
      expect(row?.hasConstruction).toBe(true)
    }
  })
})

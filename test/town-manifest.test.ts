import { describe, expect, it } from 'vitest'
import {
  ASSET_FILES,
  ASSET_MANIFEST,
  assetKey,
  assetUrl,
  decidePlaceRender,
  resolveManifest,
} from '../src/town/manifest'

describe('town asset manifest', () => {
  it('resolves home by level', () => {
    expect(assetKey('home')).toBe('home:1')
    expect(assetKey('home', 1)).toBe('home:1')
    expect(assetKey('home', 2)).toBe('home:2')
    expect(assetKey('home', 3)).toBe('home:3')
    expect(resolveManifest('home', 1)?.file).toBe(ASSET_FILES.burgageL1)
    expect(resolveManifest('home', 2)?.file).toBe(ASSET_FILES.burgageL2)
    expect(resolveManifest('home', 3)?.file).toBe(ASSET_FILES.burgageL2)
  })

  it('resolves well to the real manor-slice export', () => {
    const well = resolveManifest('well')
    expect(well?.file).toBe(ASSET_FILES.well)
    expect(well?.temporary).toBeUndefined()
    expect(ASSET_MANIFEST.well?.file).toBe('fv_well_stone.glb')
  })

  it('resolves notice-board to the P8 example export', () => {
    expect(resolveManifest('notice-board')?.file).toBe(ASSET_FILES.noticeBoard)
    expect(decidePlaceRender('notice-board', undefined, true)).toBe('gltf')
  })

  it('unknown kind has no entry → placeholder', () => {
    expect(resolveManifest('plaza')).toBeNull()
    expect(resolveManifest('berry-bush')).toBeNull()
    expect(decidePlaceRender('plaza', undefined, true)).toBe('placeholder')
    expect(decidePlaceRender('no-such-kind', undefined, true)).toBe('placeholder')
  })

  it('fallback-on-missing: known kind, missing file → placeholder', () => {
    expect(decidePlaceRender('home', 1, false)).toBe('placeholder')
    expect(decidePlaceRender('stall', undefined, false)).toBe('placeholder')
    expect(decidePlaceRender('storehouse', undefined, false)).toBe('placeholder')
  })

  it('known kind with available file → gltf', () => {
    expect(decidePlaceRender('well', undefined, true)).toBe('gltf')
    expect(decidePlaceRender('home', 1, true)).toBe('gltf')
    expect(decidePlaceRender('stall', undefined, true)).toBe('gltf')
  })

  it('URLs resolve under /assets/gltf/', () => {
    expect(assetUrl('fixture-cube.gltf')).toBe('/assets/gltf/fixture-cube.gltf')
    expect(assetUrl(ASSET_FILES.burgageL1)).toBe('/assets/gltf/fv_burgage_l1.glb')
  })
})

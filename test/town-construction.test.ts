import { describe, expect, it } from 'vitest'
import {
  risingHeight01,
  risingScaleY,
  stageForProgress,
  STAGE_FRAME_MAX,
  STAGE_PAD_MAX,
} from '../src/town/constructionPlan'

describe('construction staging (V5)', () => {
  it('maps progress to the three stages', () => {
    expect(stageForProgress(0)).toBe('pad')
    expect(stageForProgress(0.1)).toBe('pad')
    expect(stageForProgress(0.34)).toBe('pad')
    expect(stageForProgress(0.4)).toBe('frame')
    expect(stageForProgress(0.74)).toBe('frame')
    expect(stageForProgress(0.9)).toBe('rising')
    expect(stageForProgress(1)).toBe('rising')
  })

  it('boundaries advance to the later stage', () => {
    expect(stageForProgress(STAGE_PAD_MAX)).toBe('frame')
    expect(stageForProgress(STAGE_FRAME_MAX)).toBe('rising')
  })

  it('rising scale-Y is 0 at the frame/rising boundary and 1 at completion', () => {
    expect(risingScaleY(STAGE_FRAME_MAX)).toBeCloseTo(0.12, 10)
    expect(risingScaleY(1)).toBe(1)
    expect(risingScaleY(0.875)).toBeGreaterThan(risingScaleY(STAGE_FRAME_MAX))
    expect(risingScaleY(0.875)).toBeLessThan(1)
  })

  it('rising clip height is 0.28 at the frame/rising boundary and 1 at completion', () => {
    expect(risingHeight01(STAGE_FRAME_MAX)).toBeCloseTo(0.28, 10)
    expect(risingHeight01(1)).toBe(1)
    expect(risingHeight01(0.88)).toBeGreaterThan(risingHeight01(STAGE_FRAME_MAX))
    expect(risingHeight01(0.88)).toBeLessThan(1)
  })

  it('rising scale-Y is monotonically increasing with progress', () => {
    let prev = -Infinity
    for (let p = STAGE_FRAME_MAX; p <= 1; p += 0.05) {
      const s = risingScaleY(p)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })
})

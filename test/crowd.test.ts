import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/sim'
import { isWalking } from '../src/sim/spots'

const DAY = 1440
const SAMPLE = 60

function tileKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`
}

function meanPairwiseDistance(
  pts: Array<{ x: number; y: number }>,
): number {
  if (pts.length < 2) return Infinity
  let sum = 0
  let n = 0
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i]!.x - pts[j]!.x
      const dy = pts[i]!.y - pts[j]!.y
      sum += Math.sqrt(dx * dx + dy * dy)
      n++
    }
  }
  return sum / n
}

describe('crowd spacing', () => {
  it('no tile holds >2 stationary agents over 3 days (sample every 60 ticks)', () => {
    const sim = new Simulation(42)
    const maxDays = 3 * DAY

    for (let t = 0; t <= maxDays; t++) {
      if (t % SAMPLE === 0) {
        const counts = new Map<string, number>()
        for (const a of sim.state.agents) {
          if (isWalking(a)) continue
          const k = tileKey(a.x, a.y)
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        for (const [k, n] of counts) {
          expect(n, `tick ${sim.state.tick} tile ${k} has ${n} stationary`).toBeLessThanOrEqual(2)
        }
      }
      if (t < maxDays) sim.advanceTicks(1)
    }
  })

  it('when ≥6 socialize, mean pairwise distance ≥ 1.3 tiles', () => {
    const sim = new Simulation(42)
    const maxDays = 3 * DAY
    let samplesWithCrowd = 0

    for (let t = 0; t <= maxDays; t++) {
      if (t % SAMPLE === 0) {
        const socializers = sim.state.agents.filter(
          (a) => a.action.kind === 'socialize' && !isWalking(a),
        )
        if (socializers.length >= 6) {
          samplesWithCrowd++
          const mean = meanPairwiseDistance(
            socializers.map((a) => ({ x: a.x, y: a.y })),
          )
          expect(
            mean,
            `tick ${sim.state.tick} mean dist ${mean} with ${socializers.length} socializers`,
          ).toBeGreaterThanOrEqual(1.3)
        }
      }
      if (t < maxDays) sim.advanceTicks(1)
    }

    // Sanity: plaza crowds should occur at least once over 3 days
    expect(samplesWithCrowd).toBeGreaterThanOrEqual(1)
  })

  it('reservation logic is deterministic (double-run hash equality)', () => {
    const a = new Simulation(42)
    const b = new Simulation(42)
    a.advanceTicks(3 * DAY)
    b.advanceTicks(3 * DAY)
    expect(a.hash()).toBe(b.hash())
    expect(a.getEventCount()).toBe(b.getEventCount())
  })
})

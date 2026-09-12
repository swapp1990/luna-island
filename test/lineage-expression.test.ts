import { describe, expect, it } from 'vitest'
import { createRng } from '../src/sim/rng'
import { mockDecider } from '../src/lineage/decider'
import {
  compareExpression,
  expressionReport,
} from '../src/lineage/render/expression'
import { runLineageAsync } from '../src/lineage/runAsync'

describe('lineage expression', () => {
  it('dna on expresses generosity/temper/voice; dna off expresses at most 1 of 8', async () => {
    const cfg = { seed: 42, seasons: 8, cohortSize: 24, harvestYield: 1.0 }
    const on = await runLineageAsync(cfg, mockDecider(createRng(42), true), {
      dna: true,
      concurrency: 1,
      decisionSource: 'mock',
    })
    const off = await runLineageAsync(cfg, mockDecider(createRng(42), false), {
      dna: false,
      concurrency: 1,
      decisionSource: 'mock',
    })
    const onRep = expressionReport(on.events, on.state.lineage, on.summary.config)
    const offRep = expressionReport(off.events, off.state.lineage, off.summary.config)

    const expressedOn = new Set(
      onRep.json.rows.filter((r) => r.kind === 'disposition' && r.expressed).map((r) => `${r.trait}:${r.act}`),
    )
    expect(expressedOn.has('generosity:give')).toBe(true)
    expect(expressedOn.has('temper:shun')).toBe(true)
    expect(expressedOn.has('voice:propose')).toBe(true)

    const expressedOff = offRep.json.rows.filter((r) => r.kind === 'disposition' && r.expressed)
    expect(expressedOff.length).toBeLessThanOrEqual(1)

    expect(onRep.markdown).toMatch(/\| industry \| work \|/)
    expect(offRep.markdown).toMatch(/\| industry \| work \|/)

    const cmp = compareExpression(onRep.json, offRep.json)
    expect(cmp.markdown).toContain(`DNA on: ${onRep.json.expressed}/8 expressed.`)
    expect(cmp.markdown).toContain(`DNA off: ${offRep.json.expressed}/8 expressed.`)
  }, 60_000)
})

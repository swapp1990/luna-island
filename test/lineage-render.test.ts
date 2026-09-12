import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, TRAIT_NAMES } from '../src/lineage/types'
import { runLineage } from '../src/lineage/run'
import { renderCensus } from '../src/lineage/render/census'
import { renderChronicle } from '../src/lineage/render/chronicle'
import { renderTree } from '../src/lineage/render/tree'
import { renderTrajectories } from '../src/lineage/render/trajectories'
import { livingVillagers } from '../src/lineage/world'

describe('lineage render', () => {
  it('every action:start has a non-empty reason; chronicle, census, tree, trajectories hold', () => {
    const { state, events } = runLineage({ ...DEFAULT_CONFIG, seasons: 1, seed: 42 })
    const starts = events.filter((e) => e.type === 'action:start')
    expect(starts.length).toBeGreaterThan(0)
    for (const e of starts) {
      expect(typeof e.reason).toBe('string')
      expect((e.reason ?? '').length).toBeGreaterThan(0)
    }

    const chronicle = renderChronicle(events, state)
    expect(chronicle).toMatch(/^> /m)

    const census = renderCensus(state)
    const rows = census
      .split('\n')
      .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('| name |'))
    expect(rows.length).toBe(DEFAULT_CONFIG.cohortSize)
    expect(livingVillagers(state).length).toBe(DEFAULT_CONFIG.cohortSize)

    const tree = renderTree(state.lineage)
    expect(tree).toContain('graph TD')
    const nonFounders = state.lineage.filter((r) => r.parents !== null)
    const edgeCount = (tree.match(/-->/g) ?? []).length
    expect(edgeCount).toBe(nonFounders.length * 2)
    for (const r of nonFounders) {
      expect(tree).toContain(`--> ${r.id}`)
    }

    const traj = renderTrajectories(state.lineage)
    for (const name of TRAIT_NAMES) {
      expect(traj.markdown).toContain(`| ${name} |`)
    }
    const traitRows = traj.markdown
      .split('\n')
      .filter((line) => TRAIT_NAMES.some((n) => line.startsWith(`| ${n} |`)))
    expect(traitRows.length).toBe(TRAIT_NAMES.length * 2)
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import type { RecordedDecision } from '../src/lineage/decider'
import { replayTimeline } from '../src/lineage/timeline'
import type { LineageConfig, LineageSummary } from '../src/lineage/types'

// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import { execFileSync } from 'node:child_process'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import * as fs from 'node:fs'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import * as path from 'node:path'

// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
const ROOT = process.cwd() as string
const ART = path.join(ROOT, 'artifacts', 'lineage')

function listRunDirs(): string[] {
  if (!fs.existsSync(ART)) return []
  return fs.readdirSync(ART).filter((name: string) => {
    if (name === 'probes') return false
    const dir = path.join(ART, name)
    try {
      return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'summary.json'))
    } catch {
      return false
    }
  })
}

function parseJsonl<T>(raw: string): T[] {
  const rows: T[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t) as T)
    } catch {
      // skip
    }
  }
  return rows
}

function loadRun(id: string): {
  summary: LineageSummary
  decisions: RecordedDecision[]
  events: { type: string; seq?: number; tick?: number }[]
} {
  const dir = path.join(ART, id)
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')) as LineageSummary
  const decPath = path.join(dir, 'decisions.jsonl')
  const decisions = fs.existsSync(decPath)
    ? parseJsonl<RecordedDecision>(fs.readFileSync(decPath, 'utf8'))
    : []
  const evPath = path.join(dir, 'events.jsonl')
  const events = fs.existsSync(evPath)
    ? parseJsonl<{ type: string; seq?: number; tick?: number }>(fs.readFileSync(evPath, 'utf8'))
    : []
  return { summary, decisions, events }
}

function findMockId(): string | null {
  const ids = listRunDirs().filter((n) => n.startsWith('mock-'))
  const withDec = ids.find((id) => fs.existsSync(path.join(ART, id, 'decisions.jsonl')))
  return withDec ?? ids[0] ?? null
}

describe('lineage timeline replay', () => {
  beforeAll(() => {
    if (findMockId()) return
    execFileSync(
      // @ts-expect-error tsconfig types is vite/client only
      process.execPath,
      ['scripts/lineage-run.mjs', '--brain', 'mock', '--seasons', '2', '--seed', '42'],
      { cwd: ROOT, stdio: 'inherit', timeout: 300_000 },
    )
  }, 320_000)

  it('replays the mock run: hash, snapshot count, mind events in turn ranges', () => {
    const id = findMockId()
    expect(id, 'a mock-* run must exist').toBeTruthy()
    const { summary, decisions } = loadRun(id!)
    const cfg = summary.config
    const result = replayTimeline(cfg, decisions)
    expect(result.hash).toBe(summary.hash)
    const expected =
      cfg.seasons * cfg.daysPerSeason * cfg.turnsPerDay + 1
    expect(result.snapshots.length).toBe(expected)
    expect(result.turnStarts.length).toBe(result.snapshots.length)

    const mind = result.events
      .map((e, idx) => ({ e, idx }))
      .filter((x) => x.e.type === 'mind:decision')
    expect(mind.length).toBeGreaterThan(0)
    for (const { e, idx } of mind) {
      let inside = false
      for (let t = 0; t < result.turnStarts.length - 1; t++) {
        const from = result.turnStarts[t]!
        const to = result.turnStarts[t + 1]!
        if (idx >= from && idx < to) {
          inside = true
          break
        }
      }
      expect(inside, `mind:decision seq ${e.seq} at index ${idx} outside turn ranges`).toBe(true)
    }
  })

  it('replays an instinct courtship run without decisions.jsonl', () => {
    const id = listRunDirs().find((n) => n.startsWith('courtship-seed'))
    if (!id) return
    const { summary, decisions } = loadRun(id)
    expect(decisions.length).toBe(0)
    const result = replayTimeline(summary.config, decisions)
    expect(result.hash).toBe(summary.hash)
  })

  it('hash-matches every recorded run under artifacts/lineage', () => {
    const rows: { id: string; expected: string; got: string; ok: boolean }[] = []
    for (const id of listRunDirs()) {
      const { summary, decisions } = loadRun(id)
      const result = replayTimeline(summary.config as LineageConfig, decisions)
      rows.push({
        id,
        expected: summary.hash,
        got: result.hash,
        ok: result.hash === summary.hash,
      })
    }
    expect(rows.length).toBeGreaterThan(0)
    const bad = rows.filter((r) => !r.ok)
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import * as fs from 'node:fs'
// @ts-expect-error tsconfig types is vite/client only — vitest still runs in Node
import * as path from 'node:path'

import {
  expectedPlayMs,
  listRunDirs,
  loadShotList,
  newestMock,
  parseArgs,
  parseOnly,
  resolveRun,
  validateShotList,
  VIEWPORTS,
// @ts-expect-error -- plain .mjs CLI module without a declaration file
} from '../scripts/lineage-record.mjs'

// @ts-expect-error tsconfig types is vite/client only
const ROOT = process.cwd() as string
const SHOTS_FILE = path.join(ROOT, 'shots', 'lineage-experiment-01.json')
const ART = path.join(ROOT, 'artifacts', 'lineage')

const PLAN_TURNS: Record<string, { fromTurn: number; turns: number; holdMs?: number; speed: number; view: string }> =
  {
    A1: { fromTurn: 0, turns: 320, speed: 64, view: 'feed' },
    A2: { fromTurn: 0, turns: 320, speed: 64, view: 'bloodlines' },
    A3: { fromTurn: 0, turns: 40, speed: 8, view: 'feed' },
    B1: { fromTurn: 12, turns: 28, speed: 8, view: 'feed' },
    B2: { fromTurn: 54, turns: 4, speed: 1, view: 'card' },
    B3: { fromTurn: 0, turns: 40, speed: 8, view: 'compare' },
    B4: { fromTurn: 0, turns: 0, holdMs: 6000, speed: 1, view: 'analysis' },
    C1: { fromTurn: 0, turns: 0, holdMs: 6000, speed: 1, view: 'analysis' },
  }

describe('lineage shot list', () => {
  it('parses CLI flags', () => {
    const a = parseArgs([
      '--shots',
      'shots/lineage-experiment-01.json',
      '--only',
      'A3,B2',
      '--out',
      'artifacts/lineage-site/recordings',
      '--port',
      '5231',
    ])
    expect(a.shots).toBe('shots/lineage-experiment-01.json')
    expect(a.only).toBe('A3,B2')
    expect(a.out).toBe('artifacts/lineage-site/recordings')
    expect(a.port).toBe(5231)
    expect([...parseOnly(a.only)!]).toEqual(['A3', 'B2'])
  })

  it('rejects an invalid shot object', () => {
    const v = validateShotList({
      experiment: 'x',
      shots: [{ id: 'nope', run: '', view: 'map', viewport: [1, 1], speed: 2 }],
    })
    expect(v.ok).toBe(false)
    expect(v.errors.length).toBeGreaterThan(0)
  })

  it('loads lineage-experiment-01.json and matches the plan §3 translations', () => {
    expect(fs.existsSync(SHOTS_FILE)).toBe(true)
    const list = loadShotList(SHOTS_FILE)
    expect(list.experiment).toBe('lineage-experiment-01')
    const ids = list.shots.map((s: { id: string }) => s.id)
    expect(ids).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'C1'])
    for (const s of list.shots) {
      const plan = PLAN_TURNS[s.id]
      expect(plan, s.id).toBeTruthy()
      expect(s.fromTurn, s.id).toBe(plan.fromTurn)
      expect(s.turns, s.id).toBe(plan.turns)
      expect(s.speed, s.id).toBe(plan.speed)
      expect(s.view, s.id).toBe(plan.view)
      if (plan.holdMs) expect(s.holdMs, s.id).toBe(plan.holdMs)
      expect(s.leadInMs, s.id).toBe(800)
      expect(s.tailMs, s.id).toBe(800)
      const vpOk = VIEWPORTS.some((p: number[]) => p[0] === s.viewport[0] && p[1] === s.viewport[1])
      expect(vpOk, `${s.id} viewport`).toBe(true)
    }
    const b2 = list.shots.find((s: { id: string }) => s.id === 'B2')
    expect(b2.villager).toBe('v-17')
    expect(b2.run).toBe('gate3y1-codex-dnaon-*')
    const b3 = list.shots.find((s: { id: string }) => s.id === 'B3')
    expect(b3.vs).toBe('gate2-codex-dnaoff-*')
    expect(b3.view).toBe('compare')
  })

  it('resolves every referenced run (or falls back to the mock run)', () => {
    const list = loadShotList(SHOTS_FILE)
    const mock = newestMock(ART)
    const runs = listRunDirs(ART)
    for (const s of list.shots) {
      const resolved = resolveRun(s.run, { allowMock: true, art: ART })
      expect(resolved, `${s.id} run ${s.run}`).toBeTruthy()
      expect(fs.existsSync(path.join(resolved!.dir, 'summary.json')), `${s.id} summary`).toBe(true)
      if (resolved!.fallback) {
        expect(mock, `${s.id} needs a mock fallback but none exists`).toBeTruthy()
        expect(resolved!.id.startsWith('mock-')).toBe(true)
      } else {
        expect(resolved!.id.includes('*')).toBe(false)
      }
      if (s.vs) {
        const vs = resolveRun(s.vs, { allowMock: true, art: ART })
        expect(vs, `${s.id} vs ${s.vs}`).toBeTruthy()
        expect(fs.existsSync(path.join(vs!.dir, 'summary.json')), `${s.id} vs summary`).toBe(true)
      }
    }
    // Glob that matches nothing still resolves when a mock run exists (A3 gate).
    if (mock || runs.some((r: { id: string }) => r.id.startsWith('mock-'))) {
      const miss = resolveRun('no-such-run-*', { allowMock: true, art: ART })
      expect(miss?.fallback).toBe(true)
      expect(miss?.id.startsWith('mock-')).toBe(true)
    }
  })

  it('8 seasons = 320 turns of wall time at 64× is ~7.5 s', () => {
    const list = loadShotList(SHOTS_FILE)
    const a1 = list.shots.find((s: { id: string }) => s.id === 'A1')
    expect(Math.round(expectedPlayMs(a1))).toBe(7488)
    const a3 = list.shots.find((s: { id: string }) => s.id === 'A3')
    expect(expectedPlayMs(a3)).toBe(7500)
    const b4 = list.shots.find((s: { id: string }) => s.id === 'B4')
    expect(expectedPlayMs(b4)).toBe(6000)
  })
})

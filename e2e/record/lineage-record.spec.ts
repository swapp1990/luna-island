import { expect, test, type Browser, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  appendShotEntry,
  ART,
  durationSuspect,
  filterShots,
  loadShotList,
  probeMp4,
  relFromRoot,
  resolveRun,
  ROOT,
  SPEED_MS,
  transcodeWebmToMp4,
  writeContactSheet,
} from '../../scripts/lineage-record.mjs'

type Bridge = {
  ready: boolean
  runId: string | null
  turn: number
  turnCount: number
  speed: number
  playing: boolean
  alive: number
  view: string
  villagerId: string | null
  replayOk: boolean | null
}

type Control = {
  play(): void
  pause(): void
  seek(n: number): void
  openVillager(id: string | null): void
  setView(name: string): void
  setSpeed(n: number): void
}

type Shot = {
  id: string
  run: string
  view: 'feed' | 'card' | 'bloodlines' | 'analysis' | 'compare'
  viewport: [number, number]
  speed: 1 | 8 | 64
  fromTurn: number
  turns: number
  holdMs?: number
  leadInMs: number
  tailMs: number
  villager: string | null
  vs: string | null
  note: string
}

type LineageRow = { id: string; givenName: string; surname: string; generation: number }

const shotsPath = process.env.LINEAGE_SHOTS ?? ''
const outDir = process.env.LINEAGE_OUT
  ? path.resolve(process.env.LINEAGE_OUT)
  : path.join(ROOT, 'artifacts', 'lineage-site', 'recordings')
const experiment = process.env.LINEAGE_EXPERIMENT ?? 'lineage-experiment-01'

function bridge(page: Page): Promise<Bridge | null> {
  return page.evaluate(() => (window as unknown as { __lineage?: Bridge }).__lineage ?? null)
}

async function waitReady(page: Page, timeout = 180_000) {
  await expect
    .poll(async () => (await bridge(page))?.ready === true, { timeout })
    .toBe(true)
}

function fullName(r: LineageRow): string {
  return `${r.givenName} ${r.surname}`
}

function pickVillager(rows: LineageRow[], query: string): string | null {
  const q = query.trim()
  if (!q) return null
  const byId = rows.find((r) => r.id === q)
  if (byId) return byId.id
  const lower = q.toLowerCase()
  const named = rows.filter((r) => fullName(r).toLowerCase() === lower)
  if (named.length) {
    named.sort((a, b) => a.generation - b.generation)
    return named[0]!.id
  }
  const parts = q.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const surname = parts[parts.length - 1]!.toLowerCase()
    const given = parts.slice(0, -1).join(' ').toLowerCase()
    const givenHit = rows.filter(
      (r) => r.givenName.toLowerCase() === given && r.surname.toLowerCase() === surname,
    )
    if (givenHit.length) {
      givenHit.sort((a, b) => a.generation - b.generation)
      return givenHit[0]!.id
    }
    const sur = rows.filter((r) => r.surname.toLowerCase() === surname)
    if (sur.length) {
      sur.sort((a, b) => a.generation - b.generation)
      return sur[0]!.id
    }
  }
  return null
}

async function resolveVillagerId(page: Page, runId: string, query: string | null): Promise<string | null> {
  if (!query) return null
  try {
    const res = await page.request.get(`/api/lineage/runs/${encodeURIComponent(runId)}/lineage.json`)
    if (!res.ok()) return query
    const rows = (await res.json()) as LineageRow[]
    if (!Array.isArray(rows)) return query
    return pickVillager(rows, query) ?? query
  } catch {
    return query
  }
}

function buildUrl(shot: Shot, runId: string, vsId: string | null, villagerId: string | null): string {
  const q = new URLSearchParams()
  q.set('run', runId)
  if (shot.view && shot.view !== 'compare' && shot.view !== 'feed') q.set('view', shot.view)
  if (shot.speed !== 1) q.set('speed', String(shot.speed))
  if (shot.fromTurn > 0) q.set('t', String(shot.fromTurn))
  if (villagerId) q.set('villager', villagerId)
  if (vsId) q.set('vs', vsId)
  return `/lineage?${q.toString()}`
}

async function captureShot(browser: Browser, shot: Shot) {
  const [w, h] = shot.viewport
  const run = resolveRun(shot.run, { allowMock: true, art: ART })
  if (!run) throw new Error(`${shot.id}: no run matching ${shot.run} and no mock fallback`)
  const vs = shot.vs ? resolveRun(shot.vs, { allowMock: true, art: ART }) : null
  if (shot.vs && !vs) throw new Error(`${shot.id}: no vs run matching ${shot.vs}`)

  fs.mkdirSync(outDir, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: w, height: h } },
  })
  const page = await context.newPage()
  const recStarted = Date.now()
  let readyOffsetSec = 0
  let turnStart = shot.fromTurn
  let turnEnd = shot.fromTurn
  let wallMs = 0
  let alive = 0
  let villagerId: string | null = shot.villager
  const reasons: string[] = []
  let captured = false
  let mismatch = false

  try {
    await page.goto(buildUrl(shot, run.id, vs?.id ?? null, shot.villager), { waitUntil: 'domcontentloaded' })
    await waitReady(page)
    const st0 = await bridge(page)
    if (!st0) throw new Error(`${shot.id}: window.__lineage missing after ready`)
    if (st0.replayOk === false) {
      mismatch = true
      throw new Error(`${shot.id}: replay mismatch`)
    }
    readyOffsetSec = Math.max(0, (Date.now() - recStarted) / 1000 - 0.05)

    await page.evaluate(
      ({ turn, speed, view }) => {
        const c = (window as unknown as { __lineageControl: Control }).__lineageControl
        c.pause()
        c.setSpeed(speed)
        if (view && view !== 'compare') c.setView(view)
        c.seek(turn)
      },
      { turn: shot.fromTurn, speed: shot.speed, view: shot.view },
    )

    if (shot.villager && shot.view !== 'compare') {
      villagerId = await resolveVillagerId(page, run.id, shot.villager)
      if (villagerId) {
        await page.evaluate((id) => {
          ;(window as unknown as { __lineageControl: Control }).__lineageControl.openVillager(id)
        }, villagerId)
      }
    }

    await page.waitForTimeout(shot.leadInMs)
    const before = await bridge(page)
    turnStart = before?.turn ?? shot.fromTurn
    const playTimeout = Math.max(
      30_000,
      shot.turns === 0
        ? (shot.holdMs ?? 0) + 10_000
        : shot.turns * (SPEED_MS[shot.speed] ?? 1500) * 4 + 10_000,
    )

    const t0 = Date.now()
    if (shot.turns === 0) {
      await page.waitForTimeout(shot.holdMs ?? 0)
      await page.evaluate(() => {
        ;(window as unknown as { __lineageControl: Control }).__lineageControl.pause()
      })
    } else {
      const target = shot.fromTurn + shot.turns
      await page.evaluate(() => {
        ;(window as unknown as { __lineageControl: Control }).__lineageControl.play()
      })
      try {
        await expect
          .poll(async () => (await bridge(page))?.turn ?? 0, { timeout: playTimeout, intervals: [20, 40, 80] })
          .toBeGreaterThanOrEqual(target)
      } catch (err) {
        const now = await bridge(page)
        reasons.push(
          `did not reach turn ${target} (at ${now?.turn ?? '?'}/${now?.turnCount ?? '?'}) — ${String(err).slice(0, 180)}`,
        )
      }
      await page.evaluate(() => {
        ;(window as unknown as { __lineageControl: Control }).__lineageControl.pause()
      })
    }
    wallMs = Date.now() - t0
    await page.waitForTimeout(shot.tailMs)
    const end = await bridge(page)
    turnEnd = end?.turn ?? turnStart
    alive = end?.alive ?? 0
    if (shot.turns > 0 && turnEnd < shot.fromTurn + shot.turns) {
      reasons.push(`run ended at turn ${turnEnd}, wanted ${shot.fromTurn + shot.turns}`)
    }
    if (run.fallback) reasons.push(`fell back to mock run ${run.id} (glob ${shot.run} missed)`)
    captured = true
  } finally {
    const video = page.video()
    await context.close()
    if (mismatch) {
      // Unverified replay is not footage. Leave any webm; do not emit mp4 / shots.json.
    } else if (captured && video) {
      const tmp = await video.path()
      const webm = path.join(outDir, `${shot.id}.webm`)
      if (tmp !== webm) {
        if (fs.existsSync(webm)) fs.unlinkSync(webm)
        fs.copyFileSync(tmp, webm)
        try {
          fs.unlinkSync(tmp)
        } catch {
          // leave the playwright-named copy if unlink fails
        }
      }

      const mp4 = path.join(outDir, `${shot.id}.mp4`)
      const sheet = path.join(outDir, `${shot.id}-sheet.png`)
      // Playwright's recording does not start at context creation, so a wall-clock offset
      // overshoots. Transcode everything, measure, then keep exactly the expected tail.
      const expectedSecFull = (shot.leadInMs + wallMs + shot.tailMs) / 1000
      const fullMp4 = path.join(outDir, `${shot.id}-full.mp4`)
      transcodeWebmToMp4(webm, fullMp4, { ss: 0 })
      const fullProbe = probeMp4(fullMp4)
      const tailSs = Math.max(0, fullProbe.durationSec - expectedSecFull)
      transcodeWebmToMp4(fullMp4, mp4, { ss: tailSs })
      try {
        fs.unlinkSync(fullMp4)
      } catch {
        // keep the untrimmed copy if unlink fails
      }
      console.log(`[record] ${shot.id} trim: full=${fullProbe.durationSec.toFixed(2)}s expected=${expectedSecFull.toFixed(2)}s ss=${tailSs.toFixed(2)}s (wallReadyOffset=${readyOffsetSec.toFixed(2)}s)`)
      const probe = probeMp4(mp4)
      writeContactSheet(mp4, sheet, probe.durationSec)

      const expectedMs = shot.leadInMs + wallMs + shot.tailMs
      const timing = durationSuspect(probe.durationSec, expectedMs)
      if (timing.suspect && timing.reason) reasons.push(timing.reason)
      if (probe.width !== w || probe.height !== h) {
        reasons.push(`probe ${probe.width}x${probe.height} ≠ viewport ${w}x${h}`)
      }
      if (probe.pix_fmt && probe.pix_fmt !== 'yuv420p') {
        reasons.push(`pix_fmt ${probe.pix_fmt} (wanted yuv420p)`)
      }
      if (probe.fps && Math.abs(probe.fps - 30) > 0.05) {
        reasons.push(`fps ${probe.fps} (wanted 30)`)
      }

      appendShotEntry(outDir, experiment, {
        id: shot.id,
        runDir: run.id,
        view: shot.view,
        viewport: shot.viewport,
        speed: shot.speed,
        turnStart,
        turnEnd,
        wallMs,
        alive,
        mp4: relFromRoot(mp4),
        sheet: relFromRoot(sheet),
        probe: {
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          frames: probe.frames,
          durationSec: probe.durationSec,
          pix_fmt: probe.pix_fmt,
        },
        suspect: reasons.length > 0,
        suspectReason: reasons.length ? reasons.join('; ') : null,
        fallbackMock: Boolean(run.fallback),
        vsDir: vs?.id ?? null,
        villagerId,
        note: shot.note,
      })
    }
  }
}

const enabled = Boolean(shotsPath)

test.describe('lineage record', () => {
  test.skip(!enabled, 'LINEAGE_SHOTS not set — run via scripts/lineage-record.mjs')

  test('record', async ({ browser }) => {
    const list = loadShotList(shotsPath)
    const vp = test.info().project.use.viewport
    if (!vp) throw new Error('project is missing viewport')
    const shots = filterShots(list.shots as Shot[], { only: process.env.LINEAGE_ONLY, viewport: vp })
    if (shots.length === 0) return
    for (const shot of shots) {
      // eslint-disable-next-line no-console
      console.log(`[record] ${shot.id} ${shot.view} ${shot.viewport.join('x')} run=${shot.run}`)
      await captureShot(browser, shot)
    }
  })
})

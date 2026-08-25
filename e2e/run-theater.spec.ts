import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Run Theater: browse recorded soak runs, watch one back, skip to the moments
 * the run itself recorded, and read what changed across it.
 *
 * Needs at least one recorded run in `artifacts/`. A real soak takes hours, so
 * the spec falls back to the deterministic fixture generator.
 */

const ARTIFACTS = path.join(process.cwd(), 'artifacts')

function hasRecordedRun(): boolean {
  try {
    return fs.readdirSync(ARTIFACTS).some((f) => /^soak-\d+-world\.json$/.test(f))
  } catch {
    return false
  }
}

test.beforeAll(() => {
  if (hasRecordedRun()) return
  // ~10s for a one-day world; keeps CI from needing a soak artifact checked in.
  execFileSync(
    process.execPath,
    ['scripts/make-run-fixture.mjs', '--seed', '42', '--days', '1'],
    { cwd: process.cwd(), stdio: 'inherit', timeout: 180_000 },
  )
})

async function bootAndLoadFirstRun(page: Page): Promise<string> {
  await page.goto('/?brain=off')
  await expect
    .poll(() => page.evaluate(() => (window as any).__simState?.ready === true))
    .toBe(true)

  // Smallest watchable run: every test in this file loads a world, and a long
  // soak's export is tens of megabytes — no reason to move that seven times.
  const runId = await page.evaluate(async () => {
    const runs = await (window as any).__simControl.runs.list()
    const watchable = runs.filter((r: any) => r.hasWorld)
    watchable.sort((a: any, b: any) => (a.worldBytes || 0) - (b.worldBytes || 0))
    return watchable[0]?.id ?? null
  })
  expect(runId, 'a recorded run with a world export must exist').not.toBeNull()

  const ok = await page.evaluate(
    (id) => (window as any).__simControl.runs.load(id),
    runId as string,
  )
  expect(ok).toBe(true)
  return runId as string
}

test.describe.serial('run theater', () => {
  test('lists recorded runs and mounts one parked at its start', async ({ page }) => {
    const runId = await bootAndLoadFirstRun(page)

    const state = await page.evaluate(() => (window as any).__simControl.runs.state())
    expect(state.loadedRunId).toBe(runId)
    expect(state.momentCount).toBeGreaterThan(0)
    expect(state.error).toBeNull()

    // Parked at the top of the run, in replay, not running.
    const sim = await page.evaluate(() => ({
      tick: (window as any).__simState.tick,
      mode: (window as any).__simState.mode,
      speed: (window as any).__simState.speed,
    }))
    expect(sim.tick).toBe(0)
    expect(sim.mode).toBe('replay')
    expect(sim.speed).toBe(0)
  })

  test('the moment rail is chronological and bookended by the run', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const moments = await page.evaluate(() =>
      (window as any).__simControl.runs.moments(),
    )
    expect(moments.length).toBeGreaterThan(1)
    expect(moments[0].type).toBe('run:start')
    expect(moments[moments.length - 1].type).toBe('run:end')

    const ticks = moments.map((m: any) => m.tick)
    expect(ticks).toEqual([...ticks].sort((a: number, b: number) => a - b))

    // Every chapter carries a caption and lands inside the recorded timeline.
    const head = moments[moments.length - 1].tick
    for (const m of moments) {
      expect(m.caption.length).toBeGreaterThan(0)
      expect(m.tick).toBeGreaterThanOrEqual(0)
      expect(m.tick).toBeLessThanOrEqual(head)
    }
  })

  test('jumping to a moment seeks the sim to that exact tick', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const target = await page.evaluate(() => {
      const ms = (window as any).__simControl.runs.moments()
      // Something in the middle of the run, never the bookends.
      return ms.slice(1, -1)[Math.floor((ms.length - 2) / 2)] ?? ms[1]
    })
    expect(target).toBeTruthy()

    const jumped = await page.evaluate(
      (id) => (window as any).__simControl.runs.jumpTo(id),
      target.id,
    )
    expect(jumped).toBe(true)

    await expect
      .poll(() => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(target.tick)
    const st = await page.evaluate(() => (window as any).__simControl.runs.state())
    expect(st.activeMomentId).toBe(target.id)
  })

  test('stepping walks the chapters in order', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const moments = await page.evaluate(() =>
      (window as any).__simControl.runs.moments(),
    )
    await page.evaluate((id) => (window as any).__simControl.runs.jumpTo(id), moments[1].id)
    await page.evaluate(() => (window as any).__simControl.runs.step(1))

    await expect
      .poll(() => page.evaluate(() => (window as any).__simControl.runs.state().activeMomentId))
      .toBe(moments[2].id)

    await page.evaluate(() => (window as any).__simControl.runs.step(-1))
    await expect
      .poll(() => page.evaluate(() => (window as any).__simControl.runs.state().activeMomentId))
      .toBe(moments[1].id)
  })

  test('the changelog reports the run window against the loaded world', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const { log, headTick, agentCount } = await page.evaluate(() => ({
      log: (window as any).__simControl.runs.changelog(),
      headTick: (window as any).__simControl.runs.moments().slice(-1)[0].tick,
      agentCount: (window as any).__simState.agentCount,
    }))

    expect(log).toBeTruthy()
    expect(log.toTick).toBe(headTick)
    expect(log.fromTick).toBeLessThan(log.toTick)
    expect(log.days).toBeGreaterThan(0)

    const ids = log.sections.map((s: any) => s.id)
    expect(ids).toEqual(['village', 'people', 'land', 'civic', 'minds'])

    // The "after" column must agree with the world actually mounted.
    const people = log.sections.find((s: any) => s.id === 'people')
    const villagers = people.rows.find((r: any) => r.label === 'Villagers')
    expect(Number(villagers.after)).toBe(agentCount)

    expect(log.firsts.length).toBeGreaterThan(0)
    for (const f of log.firsts) expect(f.clock).toMatch(/^D\d+ \d\d:\d\d$/)
  })

  test('the panel renders the rail and the changelog', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    await page.getByTestId('run-theater-toggle').click()
    await expect(page.getByTestId('run-theater')).toBeVisible()
    await expect(page.getByTestId('run-loaded')).toBeVisible()

    const cards = page.getByTestId('run-moment')
    expect(await cards.count()).toBeGreaterThan(0)

    // Clicking a chapter seeks the world behind the panel.
    const second = cards.nth(1)
    const wantTick = Number(await second.getAttribute('data-moment-tick'))
    await second.click()
    await expect
      .poll(() => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(wantTick)

    await page.getByTestId('run-tab-changed').click()
    await expect(page.getByTestId('run-changelog')).toBeVisible()
    expect(await page.getByTestId('changelog-section').count()).toBe(5)
    await expect(page.getByTestId('changelog-firsts')).toBeVisible()

    fs.mkdirSync(ARTIFACTS, { recursive: true })
    const shot = path.join(ARTIFACTS, 'run-theater.png')
    await page.screenshot({ path: shot })
    expect(fs.statSync(shot).size).toBeGreaterThan(20 * 1024)
  })

  test("a run's own reel becomes its chapters, stills and all", async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(() => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const reelId = await page.evaluate(async () => {
      const runs = await (window as any).__simControl.runs.list()
      return runs.find((r: any) => r.hasHighlights && r.hasWorld)?.id ?? null
    })
    // Only a soak that ran soak-highlights.mjs has a reel.
    test.skip(reelId === null, 'no recorded run in artifacts/ has a photographer reel')

    expect(await page.evaluate((id) => (window as any).__simControl.runs.load(id), reelId)).toBe(
      true,
    )

    const stills = await page.evaluate(() =>
      (window as any).__simControl.runs
        .moments()
        .filter((m: any) => m.still)
        .map((m: any) => ({ still: m.still, tick: m.tick, caption: m.caption })),
    )
    expect(stills.length).toBeGreaterThan(0)

    // Each chapter's still is really served, as a real image.
    const probe = await page.evaluate(
      async ([id, file]) => {
        const res = await fetch(`/api/runs/${id}/still/${encodeURIComponent(file)}`)
        const blob = await res.blob()
        return { status: res.status, type: res.headers.get('content-type'), size: blob.size }
      },
      [reelId as string, stills[0].still] as const,
    )
    expect(probe.status).toBe(200)
    expect(probe.type).toBe('image/png')
    expect(probe.size).toBeGreaterThan(1024)

    // A filename the manifest never named is not reachable through the API.
    const traversal = await page.evaluate(
      (id) =>
        fetch(`/api/runs/${id}/still/${encodeURIComponent('../../../package.json')}`).then(
          (r) => r.status,
        ),
      reelId as string,
    )
    expect(traversal).toBe(404)
  })

  test('watching the run rolls across a day boundary', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const head = await page.evaluate(
      () => (window as any).__simControl.runs.moments().slice(-1)[0].tick as number,
    )
    // Replay auto-pauses at each day's end; park a few ticks short of one so the
    // chaining is what is under test, not raw playback throughput (rAF starves
    // under a loaded machine and would make this a timing test).
    const boundary = Math.floor((head - 1) / 1440) * 1440 - 1
    test.skip(boundary <= 0, 'run is shorter than one full sim day')

    await page.evaluate((t) => (window as any).__simControl.runs.jumpTo(t), boundary - 5)
    await page.evaluate(() => (window as any).__simControl.runs.play(true))
    await page.evaluate(() => (window as any).__simControl.setSpeed(64))

    // Crossing needs ~6 ticks; without the chaining the view sticks at `boundary`.
    await expect
      .poll(() => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 60_000,
      })
      .toBeGreaterThan(boundary)
  })

  test('reaching the recorded head ends the watch and hands back to live', async ({ page }) => {
    await bootAndLoadFirstRun(page)

    const head = await page.evaluate(
      () => (window as any).__simControl.runs.moments().slice(-1)[0].tick as number,
    )
    // A handful of ticks from the end — enough to exercise the handoff, few
    // enough that a starved frame loop still gets there.
    await page.evaluate((t) => (window as any).__simControl.runs.jumpTo(t), head - 10)
    await page.evaluate(() => (window as any).__simControl.runs.play(true))
    await page.evaluate(() => (window as any).__simControl.setSpeed(64))

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as any).__simState.mode === 'live' ||
              (window as any).__simControl.runs.state().playing === false,
          ),
        { timeout: 60_000 },
      )
      .toBe(true)
  })
})

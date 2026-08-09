import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Day 1 ends at tick 1079; Day 2 at 1080; Day 3 at 2520. Reach Day 3 via ffwd. */
const TICKS_TO_DAY3 = 2520 + 60 // a bit into Day 3 morning

test.describe.serial('day-paged timeline', () => {
  test('ffwd to Day 3, archives present, day selector visible', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate((n) => (window as any).__simControl.ffwd(n), TICKS_TO_DAY3)

    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.day as number))
      .toBeGreaterThanOrEqual(3)

    const archived = await page.evaluate(
      () => (window as any).__simState.archivedDayCount as number,
    )
    expect(archived).toBeGreaterThanOrEqual(2)

    await expect(page.getByTestId('day-selector')).toBeVisible()

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })
    await page.waitForTimeout(300)
    const livePath = path.join(artifactsDir, 'day-archive.png')
    await page.screenshot({ path: livePath, fullPage: true })
    expect(fs.statSync(livePath).size).toBeGreaterThan(20 * 1024)
  })

  test('loadDay(1) scopes replay + scrubber + inspector log to Day 1', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate((n) => (window as any).__simControl.ffwd(n), TICKS_TO_DAY3)

    await page.evaluate(() => (window as any).__simControl.loadDay(1))

    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('replay')

    const view = await page.evaluate(() => {
      const s = (window as any).__simState
      const scrubber = document.querySelector('[data-testid="day-scrubber"]') as HTMLInputElement | null
      return {
        tick: s.tick as number,
        viewDay: s.viewDay as number,
        day: s.day as number,
        min: scrubber ? Number(scrubber.min) : -1,
        max: scrubber ? Number(scrubber.max) : -1,
      }
    })

    // Day 1: [0, 1079]
    expect(view.viewDay).toBe(1)
    expect(view.tick).toBeGreaterThanOrEqual(0)
    expect(view.tick).toBeLessThanOrEqual(1079)
    expect(view.min).toBe(0)
    expect(view.max).toBe(1079)

    // Select an agent and assert activity log ticks stay in Day 1
    await page.evaluate(() => {
      const ids = (window as any).__simState.agentIds as string[]
      ;(window as any).__simControl.selectAgent(ids[0])
    })
    await expect(page.getByTestId('inspector')).toBeVisible()

    // Scrub mid-day so the log may have rows
    await page.evaluate(() => (window as any).__simControl.scrubTo(500))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(500)

    await page.evaluate(() => {
      const ids = (window as any).__simState.agentIds as string[]
      ;(window as any).__simControl.selectAgent(ids[0])
    })

    const logTicks = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="activity-log"] [data-tick]'))
      return rows.map((el) => Number((el as HTMLElement).dataset.tick))
    })
    for (const t of logTicks) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1079)
      expect(t).toBeLessThanOrEqual(500)
    }

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })
    await page.waitForTimeout(300)
    const replayPath = path.join(artifactsDir, 'day-replay.png')
    await page.screenshot({ path: replayPath, fullPage: true })
    expect(fs.statSync(replayPath).size).toBeGreaterThan(20 * 1024)
  })

  test('goLive() returns to Day 3 live head', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate((n) => (window as any).__simControl.ffwd(n), TICKS_TO_DAY3)
    await page.evaluate(() => (window as any).__simControl.loadDay(1))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('replay')

    await page.evaluate(() => (window as any).__simControl.goLive())
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('live')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.day as number))
      .toBe(3)
  })
})

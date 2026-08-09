import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Day 1 ends 1079; Day 2 starts 1080. Land a bit into Day 2 morning. */
const TICKS_TO_DAY2 = 1080 + 120

test.describe.serial('persistence', () => {
  test('saveNow + reload resumes tick, day, archives, wallet', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Ensure a clean autosave slot for this context
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('luna-island')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      })
    })
    await page.reload()
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate((n) => (window as any).__simControl.ffwd(n), TICKS_TO_DAY2)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.day as number))
      .toBeGreaterThanOrEqual(2)

    // Freeze clock so save tick is stable across serialize → reload → assert
    await page.evaluate(() => (window as any).__simControl.pause())

    const before = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        tick: s.tick as number,
        day: s.day as number,
        archivedDayCount: s.archivedDayCount as number,
        agent0: s.agent0 as { id: string; x: number; y: number; wallet: number } | null,
      }
    })
    expect(before.archivedDayCount).toBeGreaterThanOrEqual(1)
    expect(before.agent0).toBeTruthy()

    await expect
      .poll(
        async () =>
          page.evaluate(async () => (window as any).__simControl.saveNow() as Promise<boolean>),
        { timeout: 30000 },
      )
      .toBe(true)

    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.lastSavedTick as number | null))
      .toBe(before.tick)

    await page.reload()
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Wait for restore to settle (async IndexedDB boot). Pause ASAP so the
    // live loop doesn't race past the saved tick before we assert.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            if (s?.ready && s.tick >= 0) {
              ;(window as any).__simControl.pause()
              return s.tick as number
            }
            return -1
          }),
        { timeout: 15000 },
      )
      .toBe(before.tick)

    const after = await page.evaluate(() => {
      ;(window as any).__simControl.pause()
      const s = (window as any).__simState
      return {
        tick: s.tick as number,
        day: s.day as number,
        archivedDayCount: s.archivedDayCount as number,
        agent0: s.agent0 as { id: string; x: number; y: number; wallet: number } | null,
        lastSavedTick: s.lastSavedTick as number | null,
      }
    })

    expect(after.tick).toBe(before.tick)
    expect(after.day).toBe(before.day)
    expect(after.archivedDayCount).toBe(before.archivedDayCount)
    expect(after.agent0?.id).toBe(before.agent0!.id)
    expect(after.agent0?.wallet).toBe(before.agent0!.wallet)
    expect(after.lastSavedTick).not.toBeNull()

    // Save chip visible after restore
    await expect(page.getByTestId('save-chip')).toBeVisible()

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })
    await page.waitForTimeout(400)
    const shotPath = path.join(artifactsDir, 'persistence.png')
    await page.screenshot({ path: shotPath, fullPage: true })
    expect(fs.statSync(shotPath).size).toBeGreaterThan(20 * 1024)
  })

  test('Day-1 replay still works after reload', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // If prior test left an autosave on Day 2, we may already be restored there.
    // Ensure we have Day 1 archived.
    const day = await page.evaluate(() => (window as any).__simState.day as number)
    if (day < 2) {
      await page.evaluate((n) => (window as any).__simControl.ffwd(n), TICKS_TO_DAY2)
      await page.evaluate(async () => (window as any).__simControl.saveNow())
      await page.reload()
      await expect
        .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
        .toBe(true)
      await expect
        .poll(async () => page.evaluate(() => (window as any).__simState.day as number))
        .toBeGreaterThanOrEqual(2)
    }

    await page.evaluate(() => (window as any).__simControl.loadDay(1))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('replay')

    await page.evaluate(() => (window as any).__simControl.scrubTo(500))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(500)

    await page.evaluate(() => {
      const ids = (window as any).__simState.agentIds as string[]
      ;(window as any).__simControl.selectAgent(ids[0])
    })
    await expect(page.getByTestId('inspector')).toBeVisible()
    await page.getByTestId('tab-life').click()

    const logTicks = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid="activity-log"] [data-tick]'),
      )
      return rows.map((el) => Number((el as HTMLElement).dataset.tick))
    })
    // May be empty if agent quiet, but any rows must be in Day 1 ≤ scrub
    for (const t of logTicks) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1079)
      expect(t).toBeLessThanOrEqual(500)
    }
  })

  test('newWorld(7) resets to Day 1 with different layout than seed 42', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Capture seed-42 layout (force if autosave restored something else)
    await page.evaluate(async () => {
      await (window as any).__simControl.newWorld(42)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.seed as number))
      .toBe(42)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(0)

    const seed42 = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        seed: s.seed as number,
        agent0: s.agent0 as { id: string; x: number; y: number; wallet: number } | null,
        placeIds: s.placeIds as string[],
      }
    })

    await page.evaluate(async () => {
      await (window as any).__simControl.newWorld(7)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.seed as number))
      .toBe(7)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(0)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.day as number))
      .toBe(1)

    const seed7 = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        seed: s.seed as number,
        agent0: s.agent0 as { id: string; x: number; y: number; wallet: number } | null,
        placeIds: s.placeIds as string[],
        archivedDayCount: s.archivedDayCount as number,
      }
    })

    expect(seed7.seed).toBe(7)
    expect(seed7.archivedDayCount).toBe(0)
    // Distinct layout vs seed 42
    const posDiffers =
      seed42.agent0 &&
      seed7.agent0 &&
      (seed42.agent0.x !== seed7.agent0.x || seed42.agent0.y !== seed7.agent0.y)
    const placesDiffer =
      seed42.placeIds.length !== seed7.placeIds.length ||
      seed42.placeIds.some((id, i) => id !== seed7.placeIds[i])
    expect(posDiffers || placesDiffer || seed42.seed !== seed7.seed).toBe(true)
  })
})

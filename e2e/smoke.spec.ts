import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

test.describe.serial('smoke', () => {
  test('page loads with ready state and canvas', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    const canvas = page.locator('canvas')
    await expect(canvas).toHaveCount(1)
  })

  test('time advances at speed 1', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.setSpeed(1))
    const t0 = await page.evaluate(() => (window as any).__simState.tick as number)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 3000,
      })
      .toBeGreaterThan(t0)
  })

  test('fast-forward at 64× gains ≥ 100 ticks', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.setSpeed(64))
    const t0 = await page.evaluate(() => (window as any).__simState.tick as number)
    await expect
      .poll(
        async () => {
          const t = await page.evaluate(() => (window as any).__simState.tick as number)
          return t - t0
        },
        { timeout: 2500 },
      )
      .toBeGreaterThanOrEqual(100)
  })

  test('scrub to replay and go live', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.setSpeed(64))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 10000,
      })
      .toBeGreaterThanOrEqual(200)

    const headBefore = await page.evaluate(() => (window as any).__simState.tick as number)
    await page.evaluate(() => (window as any).__simControl.scrubTo(50))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('replay')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(50)

    await page.evaluate(() => (window as any).__simControl.goLive())
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.mode as string))
      .toBe('live')
    const after = await page.evaluate(() => (window as any).__simState.tick as number)
    expect(after).toBeGreaterThanOrEqual(headBefore)
  })

  test('day and night screenshots', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })

    // Day ~14:00: tick 0 is 06:00, so 14:00 is +480 minutes → tick 480
    await page.evaluate(() => {
      const ctrl = (window as any).__simControl
      ctrl.setSpeed(64)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(480)

    await page.evaluate(() => (window as any).__simControl.scrubTo(480))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(480)
    // let a couple frames render
    await page.waitForTimeout(300)
    const dayPath = path.join(artifactsDir, 'smoke-day.png')
    await page.screenshot({ path: dayPath, fullPage: true })
    expect(fs.statSync(dayPath).size).toBeGreaterThan(20 * 1024)

    // Night ~22:00: from 06:00 is +16h = 960 minutes → tick 960
    await page.evaluate(() => {
      ;(window as any).__simControl.goLive()
      ;(window as any).__simControl.setSpeed(64)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(960)

    await page.evaluate(() => (window as any).__simControl.scrubTo(960))
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number))
      .toBe(960)
    await page.waitForTimeout(300)
    const nightPath = path.join(artifactsDir, 'smoke-night.png')
    await page.screenshot({ path: nightPath, fullPage: true })
    expect(fs.statSync(nightPath).size).toBeGreaterThan(20 * 1024)
  })
})

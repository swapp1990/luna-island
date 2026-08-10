import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

test.describe.serial('juice', () => {
  test('portrait dock renders 24 chips; click selects + follows', async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const dock = page.getByTestId('portrait-dock')
    await expect(dock).toBeVisible()

    await expect
      .poll(async () => page.getByTestId('portrait').count(), { timeout: 10000 })
      .toBe(24)

    const first = page.getByTestId('portrait').first()
    const agentId = await first.getAttribute('data-agent-id')
    expect(agentId).toBeTruthy()

    await first.click()

    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState.selectedAgentId as string | null),
      )
      .toBe(agentId)

    await expect(page.getByTestId('inspector')).toBeVisible()
    // Follow engaged via portrait dock
    await expect(page.getByTestId('follow-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('ffwd to work hours → hats visible via __renderProbe', async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Advance into afternoon of day 3 when jobs are filled and work is underway
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(2880 + 480)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 120000,
      })
      .toBeGreaterThanOrEqual(2880 + 480)

    // Let a few frames run so hats update from employedAt
    await page.evaluate(() => (window as any).__simControl.setSpeed(8))
    await page.waitForTimeout(800)

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const p = (window as any).__renderProbe as
              | { hats: number; tools: number; particles: number }
              | undefined
            return p?.hats ?? 0
          }),
        { timeout: 15000 },
      )
      .toBeGreaterThanOrEqual(1)
  })

  test('screenshots: work, night Zzz, portrait dock', async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })

    // Work closeup: day 3 afternoon near farm / workers
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(2880 + 480)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 120000,
      })
      .toBeGreaterThanOrEqual(2880 + 480)

    // Aim camera at farm; select first employed worker via portraits / inspector
    const farmId = await page.evaluate(() => {
      const ids = (window as any).__simState.placeIds as string[]
      return ids.find((id) => id.includes('farm')) ?? null
    })
    expect(farmId).toBeTruthy()
    await page.evaluate((id) => {
      const pos = (window as any).__placePos?.(id) as
        | { x: number; y: number; z: number }
        | null
        | undefined
      if (pos) (window as any).__renderLookAt?.(pos.x, pos.z, 11)
    }, farmId)

    // Prefer an employed agent (job tab) for closeup selection
    const ids = await page.evaluate(() => (window as any).__simState.agentIds as string[])
    for (const id of ids.slice(0, 16)) {
      await page.evaluate((agentId) => {
        ;(window as any).__simControl.selectAgent(agentId)
      }, id)
      await page.getByTestId('tab-work').click().catch(() => {})
      const jobText = await page
        .getByTestId('job-row')
        .innerText()
        .catch(() => '')
      if (jobText && !/Unemployed/i.test(jobText)) {
        await page.evaluate((agentId) => {
          const ctrl = (window as any).__simControl
          ctrl.selectAgent(agentId)
        }, id)
        // Click their portrait to engage follow + juice framing
        const chip = page.locator(`[data-testid="portrait"][data-agent-id="${id}"]`)
        if ((await chip.count()) > 0) await chip.click()
        break
      }
    }

    await page.evaluate(() => (window as any).__simControl.setSpeed(8))
    await page.waitForTimeout(700)
    await page.evaluate(() => (window as any).__simControl.pause())
    await page.waitForTimeout(250)

    const workPath = path.join(artifactsDir, 'juice-work.png')
    await page.screenshot({ path: workPath, fullPage: true })
    expect(fs.statSync(workPath).size).toBeGreaterThan(20 * 1024)

    // Night: advance toward sleep hours (~22:00–23:00)
    // After 2880+480 we're ~14:00 day 3; +8h = 480 → ~22:00, +1h more
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(480 + 90)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 60000,
      })
      .toBeGreaterThanOrEqual(2880 + 960)

    // Live a few seconds so Zzz emit; frame village plaza if available
    await page.evaluate(() => {
      const ids = (window as any).__simState.placeIds as string[]
      const home = ids.find((id) => id.includes('home')) ?? null
      if (home) {
        const pos = (window as any).__placePos?.(home)
        if (pos) (window as any).__renderLookAt?.(pos.x, pos.z, 14)
      }
      ;(window as any).__simControl.setSpeed(8)
    })
    await page.waitForTimeout(2800)
    await page.evaluate(() => (window as any).__simControl.pause())
    await page.waitForTimeout(250)

    const nightPath = path.join(artifactsDir, 'juice-night.png')
    await page.screenshot({ path: nightPath, fullPage: true })
    expect(fs.statSync(nightPath).size).toBeGreaterThan(20 * 1024)

    // Portrait dock open
    await page.evaluate(() => {
      ;(window as any).__simControl.goLive()
    })
    const chipCount = await page.getByTestId('portrait').count()
    if (chipCount < 24) {
      await page.getByTestId('portrait-dock-toggle').click()
    }
    await expect
      .poll(async () => page.getByTestId('portrait').count())
      .toBe(24)

    const dockPath = path.join(artifactsDir, 'juice-dock.png')
    await page.screenshot({ path: dockPath, fullPage: true })
    expect(fs.statSync(dockPath).size).toBeGreaterThan(20 * 1024)
  })
})

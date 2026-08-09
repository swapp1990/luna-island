import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

test.describe.serial('info-layer', () => {
  test('resource bar renders 4 chips; values change after work day', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const bar = page.getByTestId('resource-bar')
    await expect(bar).toBeVisible()
    await expect(page.getByTestId('chip-treasury')).toBeVisible()
    await expect(page.getByTestId('chip-stall')).toBeVisible()
    await expect(page.getByTestId('chip-wood')).toBeVisible()
    await expect(page.getByTestId('chip-stone')).toBeVisible()

    const readChips = async () =>
      page.evaluate(() => {
        const nums = (id: string) => {
          const el = document.querySelector(`[data-testid="${id}"]`)
          const t = el?.textContent ?? ''
          const m = t.match(/(\d+)/)
          return m ? Number(m[1]) : -1
        }
        return {
          treasury: nums('chip-treasury'),
          stall: nums('chip-stall'),
          wood: nums('chip-wood'),
          stone: nums('chip-stone'),
        }
      })

    const before = await readChips()
    expect(before.treasury).toBeGreaterThanOrEqual(0)
    expect(before.stall).toBeGreaterThanOrEqual(0)
    expect(before.wood).toBeGreaterThanOrEqual(0)
    expect(before.stone).toBeGreaterThanOrEqual(0)

    // One full work day
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(1440)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 120000,
      })
      .toBeGreaterThanOrEqual(1440)

    await page.waitForTimeout(300)
    const after = await readChips()
    // At least one economy number should move after a work day
    const moved =
      after.treasury !== before.treasury ||
      after.stall !== before.stall ||
      after.wood !== before.wood ||
      after.stone !== before.stone
    expect(moved, `chips before=${JSON.stringify(before)} after=${JSON.stringify(after)}`).toBe(
      true,
    )
  })

  test('selectPlace farm → building panel; roster chip selects agent', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Advance so farms have workers
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(2880)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 120000,
      })
      .toBeGreaterThanOrEqual(2880)

    const farmId = await page.evaluate(() => {
      const ids = (window as any).__simState.placeIds as string[]
      // Prefer farm-* ids
      return ids.find((id) => id.includes('farm')) ?? null
    })
    expect(farmId, 'expected a farm place id').toBeTruthy()

    await page.evaluate((id) => {
      ;(window as any).__simControl.selectPlace(id)
    }, farmId)

    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState.selectedPlaceId as string | null),
      )
      .toBe(farmId)

    const panel = page.getByTestId('building-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByTestId('worker-roster')).toBeVisible()
    await expect(page.getByTestId('production-bar')).toBeVisible()

    // If roster has a filled worker chip, click it → agent selected
    const rosterChip = page.getByTestId('roster-chip').first()
    const chipCount = await page.getByTestId('roster-chip').count()
    if (chipCount > 0) {
      await rosterChip.click()
      await expect
        .poll(async () =>
          page.evaluate(() => (window as any).__simState.selectedAgentId as string | null),
        )
        .not.toBeNull()
      await expect(page.getByTestId('inspector')).toBeVisible()
    } else {
      // Hiring chips present when no workers yet
      await expect(page.getByTestId('hiring-chip').first()).toBeVisible()
    }
  })

  test('construction site materials line', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Advance until a construction site exists (or bail with long wait)
    let found = false
    for (let i = 0; i < 12 && !found; i++) {
      await page.evaluate(() => {
        ;(window as any).__simControl.ffwd(1440)
      })
      const counts = await page.evaluate(
        () => (window as any).__simState.placeCounts as Record<string, number>,
      )
      if ((counts?.['construction-site'] ?? 0) >= 1) {
        found = true
        break
      }
    }
    expect(found, 'expected construction-site after many days').toBe(true)

    const siteId = await page.evaluate(() => {
      const ids = (window as any).__simState.placeIds as string[]
      return ids.find((id) => id.startsWith('site-') || id.includes('site')) ?? null
    })
    expect(siteId).toBeTruthy()

    await page.evaluate((id) => {
      ;(window as any).__simControl.selectPlace(id)
    }, siteId)

    await expect(page.getByTestId('building-panel')).toBeVisible()
    await expect(page.getByTestId('materials-line')).toBeVisible()
    const text = await page.getByTestId('materials-line').innerText()
    expect(text).toMatch(/🪵/)
    expect(text).toMatch(/🪨/)
    expect(text).toMatch(/\d+\/\d+/)
  })

  test('agent inventory slot grid with count badges', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => {
      const ids = (window as any).__simState.agentIds as string[]
      ;(window as any).__simControl.selectAgent(ids[0])
    })

    await expect(page.getByTestId('inspector')).toBeVisible()
    await page.getByTestId('tab-work').click()
    const inv = page.getByTestId('inv-row')
    await expect(inv).toBeVisible()
    const slots = inv.locator('[data-testid="slot"]')
    await expect.poll(async () => slots.count()).toBe(4)
  })

  test('screenshots: building panel farm + construction site', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    const artifactsDir = path.join(process.cwd(), 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })

    // Farm panel after ~2 days afternoon
    await page.evaluate(() => {
      ;(window as any).__simControl.ffwd(2880 + 480)
    })
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState.tick as number), {
        timeout: 120000,
      })
      .toBeGreaterThanOrEqual(2880)

    const farmId = await page.evaluate(() => {
      const ids = (window as any).__simState.placeIds as string[]
      return ids.find((id) => id.includes('farm')) ?? null
    })
    expect(farmId).toBeTruthy()
    await page.evaluate((id) => {
      ;(window as any).__simControl.selectPlace(id)
      ;(window as any).__simControl.pause()
    }, farmId)

    await expect(page.getByTestId('building-panel')).toBeVisible()
    await page.waitForTimeout(500)
    const buildingPath = path.join(artifactsDir, 'info-layer-building.png')
    await page.screenshot({ path: buildingPath, fullPage: true })
    expect(fs.statSync(buildingPath).size).toBeGreaterThan(20 * 1024)

    // Construction site with material chips
    let siteId: string | null = null
    for (let i = 0; i < 10 && !siteId; i++) {
      await page.evaluate(() => {
        ;(window as any).__simControl.ffwd(1440)
      })
      siteId = await page.evaluate(() => {
        const counts = (window as any).__simState.placeCounts as Record<string, number>
        if ((counts?.['construction-site'] ?? 0) < 1) return null
        const ids = (window as any).__simState.placeIds as string[]
        return ids.find((id) => id.startsWith('site-') || id.includes('site')) ?? null
      })
    }
    expect(siteId, 'construction site for screenshot').toBeTruthy()

    await page.evaluate((id) => {
      ;(window as any).__simControl.selectPlace(id)
      ;(window as any).__simControl.pause()
    }, siteId)

    await expect(page.getByTestId('building-panel')).toBeVisible()
    await expect(page.getByTestId('materials-line')).toBeVisible()
    await page.waitForTimeout(500)
    const sitePath = path.join(artifactsDir, 'info-layer-site.png')
    await page.screenshot({ path: sitePath, fullPage: true })
    expect(fs.statSync(sitePath).size).toBeGreaterThan(20 * 1024)
  })
})

import { expect, test, type Locator } from '@playwright/test'

const PHONE = { width: 390, height: 844 }

async function clickTimes(locator: Locator, times: number) {
  for (let click = 0; click < times; click += 1) {
    await expect(locator).toBeEnabled({ timeout: 2_000 })
    await locator.click()
  }
}

async function clickCell(locator: Locator) {
  await locator.evaluate((cell) => {
    const viewport = cell.closest<HTMLElement>('.map-scroll')!
    const cellRect = cell.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    viewport.scrollLeft += cellRect.left + cellRect.width / 2 - (viewportRect.left + viewportRect.width / 2)
    viewport.scrollTop += cellRect.top + cellRect.height / 2 - (viewportRect.top + viewportRect.height / 2)
  })
  await locator.click()
}

test('Age 0 keeps the map and primary controls playable on a phone', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()

  const commandBar = page.getByRole('navigation', { name: 'Town tools' })
  await expect(commandBar).toBeVisible()
  await expect(page.locator('.build-tray')).toBeHidden()
  await expect(page.locator('.context-panel')).toBeHidden()

  const layout = await page.evaluate(() => {
    const size = (selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
      return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom }
    }

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mapCell: size('[data-cell-index="22"]'),
      pause: size('[aria-label="Pause time"]'),
      build: size('.town-tools button:last-child'),
      help: size('[aria-label="Help"]'),
      settings: size('[aria-label="Settings"]'),
      advice: size('[aria-label="Toggle current advice"]'),
      cancel: size('[aria-label="Cancel placement"]'),
      command: size('.town-tools'),
    }
  })

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.mapCell.width).toBeGreaterThanOrEqual(44)
  expect(layout.mapCell.height).toBeGreaterThanOrEqual(44)
  expect(layout.pause.width).toBeGreaterThanOrEqual(44)
  expect(layout.pause.height).toBeGreaterThanOrEqual(44)
  expect(layout.build.width).toBeGreaterThanOrEqual(44)
  expect(layout.build.height).toBeGreaterThanOrEqual(44)
  expect(layout.help.width).toBeGreaterThanOrEqual(44)
  expect(layout.help.height).toBeGreaterThanOrEqual(44)
  expect(layout.settings.width).toBeGreaterThanOrEqual(44)
  expect(layout.settings.height).toBeGreaterThanOrEqual(44)
  expect(layout.advice.height).toBeGreaterThanOrEqual(44)
  expect(layout.cancel.height).toBeGreaterThanOrEqual(44)
  expect(layout.command.bottom).toBeLessThanOrEqual(PHONE.height + 1)

  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 5: Open ground' }))
  await expect(page.locator('.context-panel')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add one builder' })).toBeVisible()
  expect(await page.getByRole('button', { name: 'Add one builder' }).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  expect(await page.getByRole('button', { name: 'Close work panel' }).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)

  await page.getByRole('button', { name: 'Close work panel' }).click()
  await commandBar.getByRole('button', { name: 'BUILD' }).click()
  await expect(page.locator('.build-tray')).toBeVisible()
  await expect(page.locator('.placement-card')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Close construction menu' })).toBeVisible()
  expect(await page.getByRole('button', { name: 'Close construction menu' }).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)

  const buildButtonHeight = await page.getByRole('button', { name: /^Lean-to/ }).evaluate((button) => button.getBoundingClientRect().height)
  expect(buildButtonHeight).toBeGreaterThanOrEqual(56)
})

test('Age 0 bounds the map and panels in short mobile landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()

  const initial = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('.map-scroll')!.getBoundingClientRect()
    const command = document.querySelector<HTMLElement>('.town-tools')!.getBoundingClientRect()
    const advice = document.querySelector<HTMLElement>('.advice-panel')!.getBoundingClientRect()
    const placement = document.querySelector<HTMLElement>('.placement-card')!.getBoundingClientRect()
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mapHeight: map.height,
      commandTop: command.top,
      commandBottom: command.bottom,
      adviceHeight: advice.height,
      placementBottom: placement.bottom,
    }
  })

  expect(initial.documentWidth).toBeLessThanOrEqual(initial.viewportWidth)
  expect(initial.mapHeight).toBeCloseTo(390, 0)
  expect(initial.commandBottom).toBeLessThanOrEqual(391)
  expect(initial.adviceHeight).toBeLessThanOrEqual(44)
  expect(initial.placementBottom).toBeLessThanOrEqual(initial.commandTop + 1)

  await page.getByRole('gridcell', { name: 'Row 3, column 5: Open ground' }).click()
  await expect(page.locator('.context-panel')).toBeVisible()

  const openPanel = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.context-panel')!.getBoundingClientRect()
    const command = document.querySelector<HTMLElement>('.town-tools')!.getBoundingClientRect()
    return { top: panel.top, bottom: panel.bottom, commandTop: command.top }
  })

  expect(openPanel.top).toBeGreaterThanOrEqual(0)
  expect(openPanel.bottom).toBeLessThanOrEqual(openPanel.commandTop + 1)
})

test('a phone player can sustain the village and reach Age 1', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()
  const mobileControls = page.getByRole('navigation', { name: 'Town tools' })
  const mobileMap = mobileControls.getByRole('button', { name: 'Recenter map' })
  const mobileBuild = mobileControls.getByRole('button', { name: 'BUILD' })

  await page.getByRole('gridcell', { name: 'Row 3, column 5: Open ground' }).click()
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 6)
  await page.evaluate(() => window.__age0Control!.advanceDays(1))

  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 1, column 5: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await mobileBuild.click()
  await page.getByRole('button', { name: /^Lean-to/ }).click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 6: Open ground' }))
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 2)
  await page.evaluate(() => window.__age0Control!.advanceDays(3))

  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 4, column 6: Forest' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 2)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))
  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 5, column 7: Fiber patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 1)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))

  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: /Row 4, column 6: Forest, 2 Villagers assigned/ }))
  await clickTimes(page.getByRole('button', { name: 'Remove one Villager' }), 2)
  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: /Row 5, column 7: Fiber patch, 1 Villager assigned/ }))
  await clickTimes(page.getByRole('button', { name: 'Remove one Villager' }), 1)
  await mobileBuild.click()
  await page.getByRole('button', { name: /^Lean-to/ }).click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 7: Open ground' }))
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))

  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 2, column 7: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 5, column 3: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(7))

  await mobileMap.click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 7, column 2: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(5))

  await expect(page.getByRole('dialog', { name: 'Age 1 has begun' })).toBeVisible()
  await expect(page.locator('.context-panel')).toBeHidden()
})

test('Age 0 scales the map viewport for a portrait tablet', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/age-0')

  const tablet = await page.evaluate(() => {
    const map = document.querySelector<HTMLElement>('.map-scroll')!.getBoundingClientRect()
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mapWidth: map.width,
      mapHeight: map.height,
    }
  })

  expect(tablet.documentWidth).toBeLessThanOrEqual(tablet.viewportWidth)
  expect(tablet.mapWidth).toBeGreaterThan(600)
  expect(tablet.mapHeight).toBeCloseTo(1024, 0)
})

test('touch drag and pinch move and zoom the map without scrolling the page', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()
  const viewport = page.getByRole('region', { name: /Settlement map viewport/ })
  const box = await viewport.boundingBox()
  expect(box).not.toBeNull()
  const client = await page.context().newCDPSession(page)

  const beforePan = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + 250, y: box!.y + 360, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box!.x + 170, y: box!.y + 300, id: 1 }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const afterPan = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  expect(afterPan.left + afterPan.top).toBeGreaterThan(beforePan.left + beforePan.top)
  expect(await page.evaluate(() => window.__age0State!.cells.some((cell) => Boolean(cell.project)))).toBe(false)

  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
    { x: box!.x + 130, y: box!.y + 350, id: 1 },
    { x: box!.x + 250, y: box!.y + 350, id: 2 },
  ] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { x: box!.x + 90, y: box!.y + 350, id: 1 },
    { x: box!.x + 290, y: box!.y + 350, id: 2 },
  ] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThan(100)

  const pageScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(pageScroll).toEqual({ x: 0, y: 0, width: PHONE.width, viewport: PHONE.width })
})

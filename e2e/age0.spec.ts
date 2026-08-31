import { expect, test, type Locator } from '@playwright/test'

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

test('building placement previews the footprint and dragging moves the map without placing', async ({ page }) => {
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()

  const viewport = page.getByRole('region', { name: /Settlement map viewport/ })
  const ghost = page.locator('.placement-ghost')
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)

  const validCell = page.getByRole('gridcell', { name: 'Row 4, column 5: Open ground' })
  const validBox = await validCell.boundingBox()
  expect(validBox).not.toBeNull()
  await page.mouse.move(validBox!.x + validBox!.width / 2, validBox!.y + validBox!.height / 2)
  await expect(ghost).toBeVisible()
  await expect(ghost).toHaveAttribute('data-valid', 'true')
  await expect(page.locator('.placement-card')).toContainText('Click to place')

  const waterCell = page.getByRole('gridcell', { name: 'Row 4, column 4: Water' })
  const waterBox = await waterCell.boundingBox()
  expect(waterBox).not.toBeNull()
  await page.mouse.move(waterBox!.x + waterBox!.width / 2, waterBox!.y + waterBox!.height / 2)
  await expect(ghost).toHaveAttribute('data-valid', 'false')
  await expect(page.locator('.placement-card')).toContainText('Cannot build on water')

  const viewportBox = await viewport.boundingBox()
  expect(viewportBox).not.toBeNull()
  const before = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  const startX = viewportBox!.x + viewportBox!.width * 0.62
  const startY = viewportBox!.y + viewportBox!.height * 0.62
  await page.mouse.move(startX, startY)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(startX - 90, startY - 55, { steps: 5 })
  await page.mouse.up({ button: 'middle' })

  const after = await viewport.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  expect(after.left).toBeGreaterThan(before.left)
  expect(after.top).toBeGreaterThan(before.top)
  await expect(page.locator('.placement-card')).toBeVisible()
  expect(await page.evaluate(() => window.__age0State!.cells.some((cell) => Boolean(cell.project)))).toBe(false)
})

test('mouse wheel zoom stays centred on the pointer without scrolling the page', async ({ page }) => {
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()

  const viewport = page.getByRole('region', { name: /Settlement map viewport/ })
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  const viewportBox = await viewport.boundingBox()
  expect(viewportBox).not.toBeNull()
  const pointer = {
    x: viewportBox!.x + viewportBox!.width * 0.68,
    y: viewportBox!.y + viewportBox!.height * 0.42,
  }
  await page.mouse.move(pointer.x, pointer.y)

  const cellAtPointer = () => page.evaluate(({ x, y }) => {
    const viewport = document.querySelector<HTMLElement>('[aria-label^="Settlement map viewport"]')!
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell-index]')
    return { index: cell?.dataset.cellIndex ?? null, pageScroll: window.scrollY }
  }, pointer)
  const before = await cellAtPointer()
  expect(before.index).not.toBeNull()

  await page.mouse.wheel(0, -120)
  await expect(viewport).toHaveAttribute('data-zoom', '110')
  const zoomedIn = await cellAtPointer()
  expect(zoomedIn.index).toBe(before.index)
  expect(zoomedIn.pageScroll).toBe(0)

  await page.mouse.wheel(0, 120)
  await expect(viewport).toHaveAttribute('data-zoom', '100')
  const zoomedOut = await cellAtPointer()
  expect(zoomedOut.index).toBe(before.index)
  expect(zoomedOut.pageScroll).toBe(0)
  await expect(page.locator('.placement-ghost')).toBeVisible()
})

test('keyboard, right-click, and repeat-placement controls follow town-builder conventions', async ({ page }) => {
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()
  const viewport = page.getByRole('region', { name: /Settlement map viewport/ })

  await expect(page.locator('.placement-card')).toBeVisible()
  await viewport.click({ button: 'right', position: { x: 500, y: 320 } })
  await expect(page.locator('.placement-card')).toBeHidden()

  const before = await viewport.evaluate((element) => element.scrollLeft)
  await viewport.focus()
  await page.keyboard.press('PageUp')
  await expect(viewport).toHaveAttribute('data-zoom', '110')
  await page.keyboard.press('d')
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before)

  await page.getByRole('navigation', { name: 'Town tools' }).getByRole('button', { name: 'BUILD' }).click()
  await page.getByRole('button', { name: /^Hearth\./ }).click()
  await page.getByRole('gridcell', { name: 'Row 3, column 5: Open ground' }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.placement-card')).toBeVisible()
  await expect(page.locator('.context-panel')).toBeHidden()
  expect(await page.evaluate(() => window.__age0State!.cells.some((cell) => cell.project === 'hearth'))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.locator('.placement-card')).toBeHidden()
  await page.getByRole('navigation', { name: 'Town tools' }).getByRole('button', { name: 'WORK' }).click()
  await expect(page.locator('.context-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.context-panel')).toBeHidden()
})

test('a player can grow the Age 0 camp to Age 1 through visible controls', async ({ page }) => {
  await page.goto('/age-0')
  await page.getByRole('button', { name: 'Pause time' }).click()
  const buildTool = page.getByRole('navigation', { name: 'Town tools' }).getByRole('button', { name: 'BUILD' })
  await expect(page.getByText('Build a Hearth', { exact: true })).toBeVisible()
  await expect(page.locator('.advice-progress')).toContainText('6 / 12')

  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 5: Open ground' }))
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 6)
  await page.evaluate(() => window.__age0Control!.advanceDays(1))
  await expect(page.getByText('Assign Villagers to Food', { exact: true })).toBeVisible()

  await clickCell(page.getByRole('gridcell', { name: 'Row 1, column 5: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await buildTool.click()
  await page.getByRole('button', { name: /^Lean-to/ }).click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 6: Open ground' }))
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 2)
  await page.evaluate(() => window.__age0Control!.advanceDays(3))
  await expect(page.getByRole('button', { name: /Villagers\. 6 total, .* 9 shelter/ })).toBeVisible()

  await clickCell(page.getByRole('gridcell', { name: 'Row 4, column 6: Forest' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 2)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))
  await clickCell(page.getByRole('gridcell', { name: 'Row 5, column 7: Fiber patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 1)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))

  await clickCell(page.getByRole('gridcell', { name: /Row 4, column 6: Forest, 2 Villagers assigned/ }))
  await clickTimes(page.getByRole('button', { name: 'Remove one Villager' }), 2)
  await clickCell(page.getByRole('gridcell', { name: /Row 5, column 7: Fiber patch, 1 Villager assigned/ }))
  await clickTimes(page.getByRole('button', { name: 'Remove one Villager' }), 1)
  await buildTool.click()
  await page.getByRole('button', { name: /^Lean-to/ }).click()
  await clickCell(page.getByRole('gridcell', { name: 'Row 3, column 7: Open ground' }))
  await clickTimes(page.getByRole('button', { name: 'Add one builder' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(2))
  await expect(page.getByRole('button', { name: /Villagers\. \d+ total, .* 12 shelter/ })).toBeVisible()

  await clickCell(page.getByRole('gridcell', { name: 'Row 2, column 7: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await clickCell(page.getByRole('gridcell', { name: 'Row 5, column 3: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(7))
  await page.getByRole('button', { name: /Progression\. Age 0/ }).click()
  await expect(page.getByRole('region', { name: 'Age 1 progression' })).toBeVisible()
  await expect(page.getByText('Keep all 12 Villagers alive and supplied')).toBeVisible()
  await page.getByRole('button', { name: 'Close progression panel' }).click()

  await clickCell(page.getByRole('gridcell', { name: 'Row 7, column 2: Berry patch' }))
  await clickTimes(page.getByRole('button', { name: 'Assign one Villager' }), 4)
  await page.evaluate(() => window.__age0Control!.advanceDays(5))

  await expect(page.getByRole('dialog', { name: 'Age 1 has begun' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Age 1 has begun' })).toContainText('Permanent cottages')
})

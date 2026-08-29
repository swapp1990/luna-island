import { expect, test } from '@playwright/test'

type Point = { x: number; y: number }

async function screenForTile(
  page: import('@playwright/test').Page,
  tile: { x: number; y: number },
): Promise<Point> {
  const point = await page.evaluate(
    ([x, y]) => (window as any).__townControl.screenForTile(x, y) as Point | null,
    [tile.x, tile.y],
  )
  expect(point).not.toBeNull()
  return point!
}

async function clickPlace(page: import('@playwright/test').Page, kind: string): Promise<string> {
  const place = await page.evaluate((wanted) => {
    const control = (window as any).__townControl
    const rows = control.listPlaces() as Array<{ id: string; kind: string }>
    for (const row of rows) {
      if (row.kind !== wanted) continue
      const point = control.screenForPlace(row.id) as Point | null
      if (point && point.x > 360 && point.x < 1020 && point.y > 80 && point.y < 625) {
        return { id: row.id, point }
      }
    }
    const row = rows.find((candidate) => candidate.kind === wanted)
    return row ? { id: row.id, point: control.screenForPlace(row.id) as Point | null } : null
  }, kind)
  expect(place, `${kind} should be present in the rendered town`).not.toBeNull()
  expect(place!.point, `${kind} should project into the current camera`).not.toBeNull()
  await page.mouse.click(place!.point!.x, place!.point!.y)
  await expect.poll(() => page.evaluate(() => (window as any).__townControl.interactionState().selectedPlaceId)).toBe(place!.id)
  return place!.id
}

test('player directs production, roads, staffing, site rank, and storage through /town', async ({ page }) => {
  await page.goto('/town')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)
  await page.getByTestId('speed-0').click()

  await page.getByTestId('build-toggle').click()
  for (const kind of ['farm', 'forestry', 'quarry']) {
    await expect(page.getByTestId(`build-${kind}`)).toBeVisible()
  }

  await page.getByTestId('priorities-toggle').click()
  await expect(page.getByTestId('work-priorities-panel')).toBeVisible()
  await page.getByTestId('work-priority-wood-3').click()
  await expect(page.getByTestId('work-priority-wood-3')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('work-priority-stone-0').click()
  await expect(page.getByTestId('work-priority-stone-0')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('path-tool').click()
  const pathTile = await page.evaluate(
    () => (window as any).__townControl.findPathable() as { x: number; y: number } | null,
  )
  expect(pathTile).not.toBeNull()
  const pathPoint = await screenForTile(page, pathTile!)
  await page.mouse.move(pathPoint.x, pathPoint.y)
  await expect(page.getByTestId('placement-status')).not.toHaveAttribute('data-tone', 'invalid')
  await page.mouse.click(pathPoint.x, pathPoint.y)
  await expect(page.getByTestId('town-message')).toContainText('Path laid')
  await expect.poll(() => page.evaluate(
    ([x, y]) => (window as any).__townControl.validatePath(x, y).reason,
    [pathTile!.x, pathTile!.y],
  )).toBe('already-set')

  await page.getByTestId('build-toggle').click()
  await page.getByTestId('build-farm').click()
  const farmPlot = await page.evaluate(
    () => (window as any).__townControl.findBuildable('farm') as { x: number; y: number } | null,
  )
  expect(farmPlot).not.toBeNull()
  const farmPoint = await screenForTile(page, farmPlot!)
  await page.mouse.move(farmPoint.x, farmPoint.y)
  await page.mouse.click(farmPoint.x, farmPoint.y)
  await expect(page.getByTestId('selection-panel')).toContainText('farm site')
  await expect(page.getByTestId('construction-diagnostics')).toContainText('Original bill')
  await expect(page.getByTestId('selected-workers')).toBeVisible()
  await page.getByTestId('construction-priority-3').click()
  await expect(page.getByTestId('construction-priority-3')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('cancel-construction').click()
  await page.getByTestId('build-toggle').click()
  await expect(page.getByTestId('build-menu')).toBeHidden()
  await clickPlace(page, 'farm')
  await expect(page.getByTestId('production-diagnostics')).toContainText('Output')
  await expect(page.getByTestId('production-diagnostics')).toContainText('Cycle')

  const storeId = await clickPlace(page, 'storehouse')
  await expect(page.getByTestId('stockpile-diagnostics')).toContainText('Storehouse intake')
  await page.getByTestId('stockpile-filter-wood').click()
  await expect(page.getByTestId('stockpile-filter-wood')).toHaveText('Blocked')
  expect(await page.evaluate(
    (id) => (window as any).__townControl.listPlaces().some((place: { id: string }) => place.id === id),
    storeId,
  )).toBe(true)
})

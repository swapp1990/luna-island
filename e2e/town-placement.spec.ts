import { expect, test } from '@playwright/test'

type Point = { x: number; y: number }

async function screenFor(page: import('@playwright/test').Page, x: number, y: number): Promise<Point> {
  const point = await page.evaluate(
    ([tx, ty]) => (window as any).__townControl.screenForTile(tx, ty) as Point | null,
    [x, y],
  )
  expect(point, `tile ${x},${y} should project into the current camera`).not.toBeNull()
  return point!
}

test('player can preview, place while paused, cancel, build, and demolish through /town', async ({ page }) => {
  await page.goto('/town')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)

  await page.getByTestId('speed-0').click()
  const initial = await page.evaluate(() => ({
    tick: (window as any).__townState.tick as number,
    places: (window as any).__townControl.listPlaces().length as number,
  }))

  await page.getByTestId('build-toggle').click()
  await page.getByTestId('build-home').click()

  // Full-footprint validation drives the ghost on a visible blocked tile.
  const invalidTile = await page.evaluate(
    () => (window as any).__townControl.findInvalidBuild('home') as { x: number; y: number } | null,
  )
  expect(invalidTile).not.toBeNull()
  const invalid = await screenFor(page, invalidTile!.x, invalidTile!.y)
  await page.mouse.move(invalid.x, invalid.y)
  await expect(page.getByTestId('placement-status')).toHaveAttribute('data-tone', 'invalid')

  const validTile = await page.evaluate(
    () => (window as any).__townControl.findBuildable('home') as { x: number; y: number } | null,
  )
  expect(validTile).not.toBeNull()
  const valid = await screenFor(page, validTile!.x, validTile!.y)
  await page.mouse.move(valid.x, valid.y)
  await expect(page.getByTestId('placement-status')).not.toHaveAttribute('data-tone', 'invalid')

  // A player designation commits immediately while paused, without stealing a sim minute.
  await page.mouse.click(valid.x, valid.y)
  await expect(page.getByTestId('selection-panel')).toContainText('House site')
  await expect.poll(() => page.evaluate(() => (window as any).__townState.constructionCount)).toBe(1)
  expect(await page.evaluate(() => (window as any).__townState.tick)).toBe(initial.tick)
  expect(await page.evaluate(() => (window as any).__townControl.listPlaces().length)).toBe(initial.places + 1)

  await page.getByTestId('cancel-construction').click()
  await expect(page.getByTestId('selection-panel')).toBeHidden()
  await expect.poll(() => page.evaluate(() => (window as any).__townState.constructionCount)).toBe(0)
  expect(await page.evaluate(() => (window as any).__townControl.listPlaces().length)).toBe(initial.places)

  // Place again, then let the real economy deliver and work the bill to completion.
  await page.getByTestId('build-home').click()
  await page.mouse.move(valid.x, valid.y)
  await page.mouse.click(valid.x, valid.y)
  await expect(page.getByTestId('selection-panel')).toContainText('House site')
  const playerPlaceId = await page.evaluate(
    () => (window as any).__townControl.interactionState().selectedPlaceId as string,
  )
  expect(playerPlaceId).toMatch(/^site-player-/)

  await page.evaluate(async () => {
    await (window as any).__townControl.ffwd(12 * 1440)
  })
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__townControl.interactionState().selectedPlace?.kind),
      { timeout: 180_000 },
    )
    .toBe('home')
  await expect(page.getByTestId('selection-panel')).toContainText('House')
  await expect(page.getByTestId('demolish-building')).toBeVisible()

  await page.getByTestId('demolish-building').click()
  await expect(page.getByTestId('selection-panel')).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(
        (placeId) => (window as any).__townControl.listPlaces().some((place: { id: string }) => place.id === placeId),
        playerPlaceId,
      ),
    )
    .toBe(false)
})

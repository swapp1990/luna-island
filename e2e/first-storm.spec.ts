import { expect, test } from '@playwright/test'

type BuildKind = 'home' | 'well'

async function waitForTown(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/town')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)
  await page.getByTestId('speed-0').click()
}

async function placeVisible(
  page: import('@playwright/test').Page,
  kind: BuildKind,
): Promise<void> {
  await page.getByTestId(`build-${kind}`).click()
  const target = await page.evaluate(
    (placeKind) => {
      const control = (window as any).__townControl
      const tile = control.findBuildable(placeKind)
      return tile ? control.screenForTile(tile.x, tile.y) : null
    },
    kind,
  ) as { x: number; y: number } | null
  expect(target).not.toBeNull()
  await page.mouse.move(target!.x, target!.y)
  await expect(page.getByTestId('placement-status')).not.toHaveAttribute('data-tone', 'invalid')
  await page.mouse.click(target!.x, target!.y)
}

test('seven settlers can prepare, endure the live storm, and all remain', async ({ page }) => {
  await waitForTown(page)
  await expect(page.getByTestId('scenario-population')).toContainText('7 settlers · 4 housed')
  await expect(page.getByTestId('objective-housing')).toHaveAttribute('data-met', 'false')
  await expect(page.getByTestId('objective-food')).toHaveAttribute('data-met', 'true')
  await expect(page.getByTestId('objective-water')).toHaveAttribute('data-met', 'false')

  await page.getByTestId('build-toggle').click()
  await placeVisible(page, 'home')
  await placeVisible(page, 'well')

  await page.evaluate(async () => {
    const state = (window as any).__townState
    await (window as any).__townControl.ffwd(Math.max(0, 3601 - state.tick))
  })
  await expect(page.getByTestId('first-storm-panel')).toHaveAttribute('data-status', 'storm')
  await expect(page.getByTestId('storm-overlay')).toBeVisible()
  await expect(page.getByTestId('objective-housing')).toHaveAttribute('data-met', 'true')
  await expect(page.getByTestId('objective-water')).toHaveAttribute('data-met', 'true')
  await expect(page.getByText(/hunger doubles, fatigue rises/i)).toBeVisible()

  await page.evaluate(async () => {
    const state = (window as any).__townState
    await (window as any).__townControl.ffwd(Math.max(0, 4320 - state.tick))
  })
  await expect(page.getByTestId('first-storm-panel')).toHaveAttribute('data-status', 'survived')
  await expect(page.getByTestId('storm-overlay')).toBeHidden()
  await expect(page.getByText('The settlement held. Every settler stayed.')).toBeVisible()
  await expect(page.getByTestId('scenario-population')).toContainText('7 settlers')
})

test('breaking the housing and water promises causes a two-settler exodus', async ({ page }) => {
  await waitForTown(page)
  await page.evaluate(async () => {
    const state = (window as any).__townState
    await (window as any).__townControl.ffwd(Math.max(0, 4320 - state.tick))
  })
  await expect(page.getByTestId('first-storm-panel')).toHaveAttribute('data-status', 'failed')
  await expect(page.getByText('2 settlers left after the storm.')).toBeVisible()
  await expect(page.getByTestId('scenario-population')).toContainText('5 settlers · 4 housed')
  await expect.poll(() => page.evaluate(() => (window as any).__townState.agentCount)).toBe(5)
})

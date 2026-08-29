import { expect, test } from '@playwright/test'

type Point = { x: number; y: number }

test('town is the default product route and the legacy observer stays available', async ({ page }) => {
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)
  await expect(page.getByTestId('town-pulse')).toBeVisible()

  await page.goto('/observer?brain=off')
  await expect(page.locator('#app-root')).toBeVisible()
})

test('town surface explains residents, alerts, civic state, overlays, and visual obstacles', async ({ page }) => {
  await page.goto('/town')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)
  await page.getByTestId('speed-0').click()

  const pulse = page.getByTestId('town-pulse')
  await expect(pulse).toBeVisible()
  await expect(pulse).toContainText('4/7 housed')
  await expect(pulse).toContainText('4.6 food days')
  await expect(page.getByTestId('town-story').first()).toBeVisible()

  const housingAlert = page.getByTestId('town-alert').filter({ hasText: 'without a bed' })
  await expect(housingAlert).toBeVisible()
  await housingAlert.click()
  const resident = page.getByTestId('resident-inspector')
  await expect(resident).toBeVisible()
  await expect(resident.getByTestId('resident-needs')).toContainText('Food')
  await expect(resident).toContainText('No bed assigned')
  await expect(resident.getByTestId('resident-action')).not.toBeEmpty()

  const selectedAgentId = await page.evaluate(
    () => (window as any).__townControl.interactionState().selectedAgentId as string,
  )
  expect(selectedAgentId).toBeTruthy()

  await page.getByLabel('Close resident inspector').click()
  const residentPoint = await page.evaluate(
    (id) => (window as any).__townControl.screenForAgent(id) as Point | null,
    selectedAgentId,
  )
  expect(residentPoint).not.toBeNull()
  await page.mouse.move(residentPoint!.x, residentPoint!.y)
  await expect(page.getByTestId('world-hover-label')).toHaveAttribute('data-kind', 'agent')
  await page.mouse.click(residentPoint!.x, residentPoint!.y)
  await expect(page.getByTestId('resident-inspector')).toBeVisible()

  await page.getByTestId('overlay-needs').click()
  await expect(page.getByTestId('overlay-needs')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('overlay-housing').click()
  await expect(page.getByTestId('overlay-housing')).toHaveAttribute('aria-pressed', 'true')
  for (const mode of ['resources', 'fertility', 'water', 'ownership', 'paths']) {
    await page.getByTestId(`overlay-${mode}`).click()
    await expect(page.getByTestId(`overlay-${mode}`)).toHaveAttribute('aria-pressed', 'true')
  }

  await page.getByTestId('town-board-toggle').click()
  await expect(page.getByTestId('town-board')).toBeVisible()
  await expect(page.getByTestId('town-board')).toContainText('Open proposals')
  await expect(page.getByTestId('town-board')).toContainText('Standing rules')
  await page.getByTestId('town-board-toggle').click()

  const treeBlocked = await page.evaluate(() => {
    const control = (window as any).__townControl
    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 47; x++) {
        if (control.validateBuild('home', x, y).reason !== 'trees') continue
        const point = control.screenForTile(x, y) as Point | null
        if (!point || point.x < 360 || point.x > 900 || point.y < 90 || point.y > 470) continue
        return { x, y, point }
      }
    }
    return null
  })
  expect(treeBlocked).not.toBeNull()
  await page.getByTestId('build-toggle').click()
  await page.getByTestId('build-home').click()
  await page.mouse.move(treeBlocked!.point.x, treeBlocked!.point.y)
  await expect(page.getByTestId('placement-status')).toHaveAttribute('data-tone', 'invalid')
  await expect(page.getByTestId('placement-status')).toContainText('Trees block this footprint')
})

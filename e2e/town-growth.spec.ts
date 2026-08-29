import { expect, test } from '@playwright/test'

test('growth panel explains Appeal, milestones, locks, and the safety gate', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__townState?.ready === true)
  await page.getByTestId('speed-0').click()

  await expect(page.getByTitle('Appeal')).toContainText('53')
  await page.getByTestId('town-growth-toggle').click()
  await expect(page.getByTestId('town-growth-panel')).toContainText('53 / 100 Appeal')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Housing')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Food reserve')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Work opportunity')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Water access')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Safety')
  await expect(page.getByTestId('appeal-breakdown')).toContainText('Social and civic')
  await expect(page.getByTestId('next-milestone')).toContainText('Hamlet at 55')
  await expect(page.getByTestId('invitation-status')).toContainText('after the first storm is survived')

  await page.getByTestId('build-toggle').click()
  await expect(page.getByTestId('build-farm')).toBeEnabled()
  await expect(page.getByTestId('build-forestry')).toBeDisabled()
  await expect(page.getByTestId('build-stall')).toBeDisabled()
})

test('surviving town chooses a named Luna, exposes player facts, and commissions an upgrade', async ({ page }) => {
  await page.goto('/town.html?brain=mock&noNewConversations=1&mindWallFloorMs=0')
  await page.waitForFunction(() => window.__townState?.ready === true)
  await page.getByTestId('speed-0').click()

  const prepared = await page.evaluate(async () => {
    const control = window.__townControl!
    let plot = control.findBuildable('home')!
    const home = control.issueBuild('home', plot.x, plot.y)
    plot = control.findBuildable('well')!
    const well = control.issueBuild('well', plot.x, plot.y)
    await control.ffwd(4_500)
    plot = control.findBuildable('notice-board')!
    const civic = control.issueBuild('notice-board', plot.x, plot.y)
    await control.ffwd(1_200)
    return { home, well, civic, growth: control.growthSnapshot() }
  })
  expect(prepared.home.ok).toBe(true)
  expect(prepared.well.ok).toBe(true)
  expect(prepared.civic.ok).toBe(true)
  expect(prepared.growth.scenarioStatus).toBe('survived')
  expect(prepared.growth.appeal).toBeGreaterThanOrEqual(85)
  expect(prepared.growth.invitationCandidates).toEqual(['agent-0', 'agent-1'])

  await page.getByTestId('town-growth-toggle').click()
  await expect(page.getByTestId('invitation-offer')).toContainText('Choose one Luna resident')
  await expect(page.getByTestId('invitation-agent-0')).toContainText('Mira')
  await expect(page.getByTestId('invitation-agent-1')).toContainText('Joss')
  await page.getByTestId('invitation-agent-0').getByRole('button', { name: 'Invite' }).click()

  await expect(page.getByTestId('scenario-population')).toContainText('8 settlers')
  await expect(page.getByTestId('resident-inspector')).toContainText('Mira')
  await expect(page.getByTestId('resident-observed-facts')).toContainText('player invited Mira')
  await page.evaluate(async () => {
    await window.__townControl!.ffwd(5)
  })
  await expect(page.getByTestId('resident-mind-decision')).toContainText('Mind-authored choice')
  await expect(page.getByTestId('resident-mind-decision')).toContainText('mock mind · recorded for replay')
  await expect(page.getByTestId('resident-action')).not.toContainText("Accepted the player's invitation")

  await page.getByLabel('Close resident inspector').click()
  const homePoint = await page.evaluate(() => {
    const control = window.__townControl!
    const home = control.listPlaces().find((place) => place.kind === 'home')!
    return control.screenForPlace(home.id)
  })
  expect(homePoint).toBeTruthy()
  await page.mouse.click(homePoint!.x, homePoint!.y)
  await expect(page.getByTestId('building-tier')).toContainText('Level 1 / 3')
  await page.getByTestId('upgrade-building').click()
  await expect(page.getByTestId('selection-panel')).toContainText('site')
  await expect(page.getByTestId('construction-diagnostics')).toBeVisible()
})

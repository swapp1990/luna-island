import { expect, test } from '@playwright/test'

test('named Luna minds live socially in the player town and replay without calls', async ({ page }) => {
  await page.goto('/town.html?brain=mock&mindWallFloorMs=0&mindMinGapTicks=5')
  await page.waitForFunction(() => window.__townState?.ready === true)
  await page.getByTestId('speed-0').click()

  const prepared = await page.evaluate(async () => {
    const c = window.__townControl!
    let plot = c.findBuildable('home')!
    c.issueBuild('home', plot.x, plot.y)
    plot = c.findBuildable('well')!
    c.issueBuild('well', plot.x, plot.y)
    await c.ffwd(4_500)
    plot = c.findBuildable('notice-board')!
    c.issueBuild('notice-board', plot.x, plot.y)
    await c.ffwd(1_200)
    const board = c.listPlaces().find((place) => place.kind === 'notice-board')!
    c.upgradePlace(board.id)
    await c.ffwd(1_200)
    plot = c.findBuildable('home')!
    c.issueBuild('home', plot.x, plot.y)
    c.setWorkPriority('wood', 3)
    c.setWorkPriority('build', 3)
    await c.ffwd(8_000)
    const firstInvite = c.acceptInvitation('agent-0')
    const secondOffer = c.growthSnapshot()
    await c.ffwd(1)
    const secondInvite = c.acceptInvitation('agent-2')
    await c.ffwd(1_200)
    return { ...c.socialSnapshot(), firstInvite, secondOffer, secondInvite }
  })

  expect(prepared.firstInvite.ok).toBe(true)
  expect(prepared.secondInvite.ok, JSON.stringify({ offer: prepared.secondOffer, result: prepared.secondInvite })).toBe(true)
  expect(prepared.mindDecisionCount).toBeGreaterThan(0)
  expect(prepared.mindAgentIds).toEqual(expect.arrayContaining(['agent-0', 'agent-2']))
  expect(prepared.sayCount).toBeGreaterThan(0)
  expect(prepared.proposalCount).toBeGreaterThan(0)
  expect(prepared.assemblyAtNoticeBoard).toBe(true)
  await expect(page.getByTestId('town-mind-budget')).toContainText('/12000 tokens')

  const mira = await page.evaluate(() => window.__townControl!.screenForAgent('agent-0'))
  expect(mira).toBeTruthy()
  await page.mouse.click(mira!.x, mira!.y)
  await expect(page.getByTestId('resident-biography')).toContainText('Mira')
  await expect(page.getByTestId('resident-mind-decision')).toContainText('I noticed')

  await page.getByLabel('Close resident inspector').click()
  await page.getByTestId('town-chronicle-toggle').click()
  await expect(page.getByTestId('town-chronicle')).toContainText('Recorded mind moments')
  await page.getByTestId('replay-latest-mind').click()
  await expect(page.getByTestId('town-replay-proof')).toContainText('zero new mind calls')

  await expect(page.getByTestId('town-chronicle')).toContainText('Conversations')
  if (prepared.gatheringCount > 0) {
    await page.getByTestId('town-chronicle-toggle').click()
    await page.getByTestId('town-board-toggle').click()
    await expect(page.getByTestId('town-board-gathering')).toContainText('notice board')
  }
})

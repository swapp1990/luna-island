import { expect, test } from '@playwright/test'

test('town blueprint: school cells rise and complete', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/town')
  await expect.poll(() => page.evaluate(() => (window as any).__townState?.ready === true)).toBe(true)

  const spot = await page.evaluate(() => {
    const ctrl = (window as any).__townControl
    for (let y = 1; y < 42; y++) {
      for (let x = 1; x < 40; x++) {
        const check = ctrl.validateBlueprint('school', x, y)
        if (check.ok) return { x, y }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()

  const placed = await page.evaluate(
    ([x, y]) => (window as any).__townControl.placeBlueprint('school', x, y),
    [spot!.x, spot!.y],
  )
  expect(placed.ok).toBe(true)
  await page.evaluate(() => {
    const ctrl = (window as any).__townControl
    ctrl.setWorkPriority('wood', 3)
    ctrl.setWorkPriority('build', 3)
    ctrl.setWorkPriority('stone', 1)
  })

  const early = await page.evaluate(() => (window as any).__townControl.listStructures())
  expect(early.length).toBeGreaterThanOrEqual(1)
  expect(early[0].state).toBe('building')
  expect(early[0].cells.total).toBe(35)
  let lastBuilt = early[0].cells.built as number
  expect(lastBuilt).toBe(0)

  const contributors = new Set<string>()
  let finished = false
  for (let slice = 0; slice < 16; slice++) {
    await page.evaluate(() => (window as any).__townControl.fastForward(4000))
    const tick = await page.evaluate(() => (window as any).__townState.tick as number)
    expect(tick).toBeGreaterThan(0)
    const rows = await page.evaluate(() => (window as any).__townControl.listStructures())
    const school = rows.find((row: { blueprintId: string }) => row.blueprintId === 'school')
    expect(school).toBeTruthy()
    expect(school.cells.built).toBeGreaterThanOrEqual(lastBuilt)
    lastBuilt = school.cells.built
    const events = await page.evaluate(() => (window as any).__townControl.getEvents())
    for (const ev of events) {
      if (ev.type === 'structure:cell-built' && typeof ev.agentId === 'string') {
        contributors.add(ev.agentId)
      }
      if (ev.type === 'job:hired' && ev.data?.placeKind === 'construction-site' && typeof ev.agentId === 'string') {
        contributors.add(ev.agentId)
      }
    }
    if (school.state === 'built') {
      finished = true
      break
    }
  }

  expect(finished).toBe(true)
  expect(contributors.size).toBeGreaterThanOrEqual(3)
  const done = await page.evaluate(() => (window as any).__townControl.listStructures())
  const school = done.find((row: { blueprintId: string }) => row.blueprintId === 'school')
  expect(school.state).toBe('built')
  expect(school.cells.built).toBe(35)
  expect(school.cells.planned).toBe(0)
  const counts = await page.evaluate(() => (window as any).__townState.structures)
  expect(counts.built).toBeGreaterThanOrEqual(1)
})

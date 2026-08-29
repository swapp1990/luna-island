import { expect, test } from '@playwright/test'

const PHASE_ORDER = ['foundation', 'frame', 'walls', 'roofing', 'done'] as const

test('town blueprint: school stages rise and complete', async ({ page }) => {
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

  const rows0 = await page.evaluate(() => (window as any).__townControl.listStructures())
  const siteId = rows0[0].placeId as string

  const beforeStock = await page.evaluate((id: string) => {
    const school = (window as any).__townControl.listStructures().find(
      (row: { placeId: string }) => row.placeId === id,
    )
    const detail = (window as any).__townControl.listCellDetail(id) ?? []
    return {
      remainingWood: school?.remaining?.wood ?? 0,
      remainingStone: school?.remaining?.stone ?? 0,
      statusKey: (window as any).__townControl.actionableStatusKey(id),
      staged: detail.some(
        (cell: { staged?: { wood?: number; stone?: number } }) =>
          (cell.staged?.wood ?? 0) > 0 || (cell.staged?.stone ?? 0) > 0,
      ),
    }
  }, siteId)
  expect(beforeStock.remainingWood + beforeStock.remainingStone).toBeGreaterThan(0)
  expect(beforeStock.statusKey).not.toBe('materials')
  expect(beforeStock.staged).toBe(false)

  const stocked = await page.evaluate(
    (id) => (window as any).__townControl.stockSite(id),
    siteId,
  )
  expect(stocked.ok).toBe(true)
  await page.evaluate(() => {
    const ctrl = (window as any).__townControl
    ctrl.setWorkPriority('wood', 1)
    ctrl.setWorkPriority('build', 3)
    ctrl.setWorkPriority('stone', 1)
  })

  const early = await page.evaluate(() => (window as any).__townControl.listStructures())
  expect(early.length).toBeGreaterThanOrEqual(1)
  expect(early[0].state).toBe('building')
  expect(early[0].cells.total).toBe(35)
  expect(early[0].stages.total).toBe(110)
  expect(early[0].cells.built).toBe(0)
  expect(early[0].phase).toBe('foundation')
  expect(
    await page.evaluate((id: string) => (window as any).__townControl.actionableStatusKey(id), siteId),
  ).not.toBe('materials')

  const trace = await page.evaluate((id: string) => {
    const phases: string[] = []
    let lastBuilt = 0
    let lastEnvelope = 0
    const first = (window as any).__townControl.listStructures()[0]
    if (first?.phase) phases.push(first.phase)
    lastBuilt = first?.cells?.built ?? 0
    let finished = false
    let roofBeforeEnvelope = false
    let builtRegressed = false
    let envelopeRegressed = false
    let sawThreeClaims = false
    let claimSnapshot: Array<{ agentId: string; index: number; adjacent: boolean }> = []
    let sawStockedEmptyStaged = false
    let materialsDuring = false
    for (let tick = 0; tick < 4000; tick++) {
      ;(window as any).__townControl.fastForward(1)
      const school = (window as any).__townControl.listStructures().find(
        (row: { blueprintId: string }) => row.blueprintId === 'school',
      )
      if (!school) continue
      if (school.cells.built < lastBuilt) builtRegressed = true
      lastBuilt = school.cells.built
      if (school.phase && phases[phases.length - 1] !== school.phase) phases.push(school.phase)
      if ((window as any).__townControl.actionableStatusKey(id) === 'materials') materialsDuring = true
      const detail = (window as any).__townControl.listCellDetail(id) as Array<{
        index: number
        x: number
        y: number
        claimedBy?: string
        claimantX?: number
        claimantY?: number
        stageState: string
        staged: Record<string, number>
      }> | null
      if (detail) {
        for (const cell of detail) {
          const st = (cell.staged?.wood ?? 0) + (cell.staged?.stone ?? 0)
          if (cell.stageState === 'stocked' && st === 0) sawStockedEmptyStaged = true
        }
        const claimed = detail.filter((cell) => cell.claimedBy)
        const agents = new Set(claimed.map((cell) => cell.claimedBy))
        const cells = new Set(claimed.map((cell) => cell.index))
        const adjacent = claimed.every((cell) => {
          if (cell.claimantX === undefined || cell.claimantY === undefined) return false
          const dx = Math.abs(Math.round(cell.claimantX) - cell.x)
          const dy = Math.abs(Math.round(cell.claimantY) - cell.y)
          return (dx === 0 && dy === 0) || (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
        })
        if (agents.size >= 3 && cells.size >= 3 && adjacent) {
          sawThreeClaims = true
          claimSnapshot = claimed.map((cell) => ({
            agentId: cell.claimedBy!,
            index: cell.index,
            adjacent: true,
          }))
        }
      }
      const events = (window as any).__townControl.getEvents()
      let envelope = 0
      let roofStages = 0
      for (const ev of events) {
        if (ev.type !== 'structure:stage-built') continue
        if (ev.data?.stage === 'wall' || ev.data?.stage === 'door') envelope += 1
        if (ev.data?.stage === 'roof') roofStages += 1
      }
      if (envelope < lastEnvelope) envelopeRegressed = true
      lastEnvelope = envelope
      if (roofStages > 0 && envelope < 20) roofBeforeEnvelope = true
      if (school.state === 'built') {
        finished = true
        break
      }
    }
    const contributors = new Set<string>()
    for (const ev of (window as any).__townControl.getEvents()) {
      if (ev.type === 'structure:stage-built' && typeof ev.agentId === 'string') {
        contributors.add(ev.agentId)
      }
    }
    const done = (window as any).__townControl.listStructures().find(
      (row: { blueprintId: string }) => row.blueprintId === 'school',
    )
    return {
      phases,
      finished,
      roofBeforeEnvelope,
      builtRegressed,
      envelopeRegressed,
      contributorCount: contributors.size,
      done,
      structureCounts: (window as any).__townState.structures,
      sawThreeClaims,
      claimSnapshot,
      sawStockedEmptyStaged,
      materialsDuring,
    }
  }, siteId)

  expect(trace.builtRegressed).toBe(false)
  expect(trace.envelopeRegressed).toBe(false)
  expect(trace.roofBeforeEnvelope).toBe(false)
  expect(trace.finished).toBe(true)
  expect(trace.sawThreeClaims).toBe(true)
  expect(trace.claimSnapshot.length).toBeGreaterThanOrEqual(3)
  expect(trace.sawStockedEmptyStaged).toBe(true)
  expect(trace.materialsDuring).toBe(false)
  expect(trace.contributorCount).toBeGreaterThanOrEqual(3)
  expect(trace.phases).toEqual([...PHASE_ORDER])
  expect(trace.done.state).toBe('built')
  expect(trace.done.phase).toBe('done')
  expect(trace.done.cells.built).toBe(35)
  expect(trace.done.cells.planned).toBe(0)
  expect(trace.structureCounts.built).toBeGreaterThanOrEqual(1)
})

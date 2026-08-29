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

  const trace = await page.evaluate(() => {
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
    for (let tick = 0; tick < 2000; tick++) {
      ;(window as any).__townControl.fastForward(1)
      const school = (window as any).__townControl.listStructures().find(
        (row: { blueprintId: string }) => row.blueprintId === 'school',
      )
      if (!school) continue
      if (school.cells.built < lastBuilt) builtRegressed = true
      lastBuilt = school.cells.built
      if (school.phase && phases[phases.length - 1] !== school.phase) phases.push(school.phase)
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
    }
  })

  expect(trace.builtRegressed).toBe(false)
  expect(trace.envelopeRegressed).toBe(false)
  expect(trace.roofBeforeEnvelope).toBe(false)
  expect(trace.finished).toBe(true)
  expect(trace.contributorCount).toBeGreaterThanOrEqual(3)
  expect(trace.phases).toEqual([...PHASE_ORDER])
  expect(trace.done.state).toBe('built')
  expect(trace.done.phase).toBe('done')
  expect(trace.done.cells.built).toBe(35)
  expect(trace.done.cells.planned).toBe(0)
  expect(trace.structureCounts.built).toBeGreaterThanOrEqual(1)
})

import { test, expect } from '@playwright/test'

type Visual = {
  posture: string
  glyph: string | null
  prop: string | null
  variant?: 'mind' | 'sheep'
}

const LUNA_IDS = ['agent-0', 'agent-1', 'agent-2', 'agent-4', 'agent-8', 'agent-11']

async function readyFresh(page: import('@playwright/test').Page) {
  await page.goto('/?brain=mock')
  await expect
    .poll(async () => page.evaluate(() => window.__simState?.ready === true))
    .toBe(true)
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('luna-island')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.onblocked = () => resolve()
    })
    window.__simControl.newWorld?.(42)
  })
  await expect
    .poll(async () =>
      page.evaluate(
        () => window.__simState?.ready === true && window.__simState.seed === 42,
      ),
    )
    .toBe(true)
  await page.evaluate(() => window.__simControl.pause())
}

test.describe.serial('villager charm (P3-12)', () => {
  test('probe: 6 minds, sheep vs mind variants', async ({ page }) => {
    await readyFresh(page)

    const report = await page.evaluate((luna) => {
      const ids = window.__simState.agentIds
      const variants: Array<{ id: string; variant: string }> = []
      for (const id of ids) {
        const v = window.__simControl.describeAgentVisual?.(id) as Visual | null
        variants.push({ id, variant: v?.variant ?? 'missing' })
      }
      const minds = variants.filter((x) => x.variant === 'mind')
      const sheep = variants.filter((x) => x.variant === 'sheep')
      return {
        total: ids.length,
        mindCount: minds.length,
        sheepCount: sheep.length,
        mindIds: minds.map((x) => x.id).sort(),
        expected: [...luna].sort(),
        agent0: variants.find((x) => x.id === 'agent-0')?.variant ?? null,
        agent3: variants.find((x) => x.id === 'agent-3')?.variant ?? null,
      }
    }, LUNA_IDS)

    expect(report.total).toBe(24)
    expect(report.mindCount).toBe(6)
    expect(report.sheepCount).toBe(18)
    expect(report.mindIds).toEqual(report.expected)
    expect(report.agent0).toBe('mind')
    expect(report.agent3).toBe('sheep')
  })

  test('blink/arm paths survive 200-tick ffwd; fallen/lying/lean still probe', async ({
    page,
  }) => {
    await readyFresh(page)

    const afterFwd = await page.evaluate(() => {
      window.__simControl.ffwd(200)
      const ids = window.__simState.agentIds
      const variants: string[] = []
      for (const id of ids) {
        const v = window.__simControl.describeAgentVisual?.(id) as Visual | null
        if (!v?.variant) return { ok: false, reason: `missing variant ${id}` }
        variants.push(v.variant)
      }
      return {
        ok: true,
        tick: window.__simState.tick,
        minds: variants.filter((x) => x === 'mind').length,
        sheep: variants.filter((x) => x === 'sheep').length,
      }
    })
    expect(afterFwd.ok).toBe(true)
    expect(afterFwd.minds).toBe(6)
    expect(afterFwd.sheep).toBe(18)
    expect(afterFwd.tick).toBeGreaterThanOrEqual(200)

    const fallen = await page.evaluate(() => {
      const id = window.__simState.agentIds[3] as string
      window.__simControl.setNeeds?.(id, { hunger: 0 })
      window.__simControl.ffwd(2)
      const v = window.__simControl.describeAgentVisual?.(id) as Visual | null
      return v ? `${v.posture}/${v.glyph}/${v.variant}` : ''
    })
    expect(fallen).toBe('fallen/collapsed/sheep')

    const lean = await page.evaluate(() => {
      window.__simControl.postIntent?.(
        'agent-0',
        {
          kind: 'examine',
          targetPlaceId: 'notice-board-0',
          reason: 'I will look at that wooden post.',
        },
        'I will look at that wooden post.',
      )
      for (let i = 0; i < 400; i++) {
        const n = window.__simControl.countEventTypes?.()['discovery:examined'] ?? 0
        if (n >= 1) {
          const v = window.__simControl.describeAgentVisual?.('agent-0') as Visual | null
          return v ? `${v.posture}/${v.glyph}/${v.variant}` : ''
        }
        if (i > 0 && i % 25 === 0) {
          window.__simControl.postIntent?.(
            'agent-0',
            {
              kind: 'examine',
              targetPlaceId: 'notice-board-0',
              reason: 'I will look at that wooden post.',
            },
            'I will look at that wooden post.',
          )
        }
        window.__simControl.ffwd(1)
      }
      return 'none'
    })
    expect(lean).toBe('lean-in/examine/mind')
  })
})

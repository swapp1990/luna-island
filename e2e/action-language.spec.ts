import { test, expect } from '@playwright/test'

type Visual = { posture: string; glyph: string | null; prop: string | null }

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

test.describe.serial('action language (P3-11)', () => {
  test('collapse → fallen + ❗ via probe', async ({ page }) => {
    await readyFresh(page)

    const id = await page.evaluate(() => window.__simState.agentIds[0] as string)
    await page.evaluate((agentId) => {
      window.__simControl.setNeeds?.(agentId, { hunger: 0 })
      window.__simControl.ffwd(2)
    }, id)

    await expect
      .poll(async () =>
        page.evaluate((agentId) => {
          const v = window.__simControl.describeAgentVisual?.(agentId) as Visual | null
          return v ? `${v.posture}/${v.glyph}` : ''
        }, id),
      )
      .toBe('fallen/collapsed')
  })

  test('examine → lean-in + 🔍 after discovery event', async ({ page }) => {
    await readyFresh(page)

    const result = await page.evaluate(() => {
      const seed = () =>
        window.__simControl.postIntent?.(
          'agent-0',
          {
            kind: 'examine',
            targetPlaceId: 'notice-board-0',
            reason: 'I will look at that wooden post.',
          },
          'I will look at that wooden post.',
        )
      seed()
      for (let i = 0; i < 400; i++) {
        const n = window.__simControl.countEventTypes?.()['discovery:examined'] ?? 0
        if (n >= 1) {
          const v = window.__simControl.describeAgentVisual?.('agent-0') as Visual | null
          return { ok: true, ...v, tick: window.__simState.tick }
        }
        if (i > 0 && i % 25 === 0) seed()
        window.__simControl.ffwd(1)
      }
      return {
        ok: (window.__simControl.countEventTypes?.()['discovery:examined'] ?? 0) >= 1,
        posture: null as string | null,
        glyph: null as string | null,
        tick: window.__simState.tick,
      }
    })
    expect(result.ok).toBe(true)
    expect(result.posture).toBe('lean-in')
    expect(result.glyph).toBe('examine')
  })

  test('sleeper → lying', async ({ page }) => {
    await readyFresh(page)

    await page.evaluate(() => {
      window.__simControl.setNeeds?.('agent-0', { energy: 0.35 })
      window.__simControl.postIntent?.(
        'agent-0',
        { kind: 'sleep', reason: 'I will rest right here on the dirt.' },
        'I will rest right here on the dirt.',
      )
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const v = window.__simControl.describeAgentVisual?.('agent-0') as Visual | null
          return v?.posture ?? ''
        }),
      )
      .toBe('lying')
  })

  test('destination marker only on the selected agent', async ({ page }) => {
    await readyFresh(page)

    await page.evaluate(() => {
      window.__simControl.ffwd(80)
    })

    const walker = await page.evaluate(() => {
      const find = () => {
        for (const id of window.__simState.agentIds) {
          const v = window.__simControl.describeAgentVisual?.(id) as
            | { traveling?: boolean }
            | null
          if (v?.traveling) return id
        }
        return null
      }
      let hit = find()
      for (let i = 0; i < 10 && !hit; i++) {
        window.__simControl.ffwd(20)
        hit = find()
      }
      return hit
    })
    expect(walker).toBeTruthy()

    await page.evaluate((id) => window.__simControl.selectAgent(id), walker)
    await expect
      .poll(async () =>
        page.evaluate(() => window.__simState.actionLanguage?.destMarkerCount ?? 0),
      )
      .toBe(1)

    await page.evaluate(() => window.__simControl.selectAgent(null))
    await expect
      .poll(async () =>
        page.evaluate(() => window.__simState.actionLanguage?.destMarkerCount ?? 0),
      )
      .toBe(0)

    await page.evaluate((id) => window.__simControl.selectAgent(id), walker)
    await expect
      .poll(async () =>
        page.evaluate(() => ({
          destMarkerCount: window.__simState.actionLanguage?.destMarkerCount ?? 0,
          destMarkerAgentId: window.__simState.actionLanguage?.destMarkerAgentId ?? null,
          probeMarkers:
            (
              window as unknown as { __renderProbe?: { destMarkers?: number } }
            ).__renderProbe?.destMarkers ?? 0,
        })),
      )
      .toEqual({
        destMarkerCount: 1,
        destMarkerAgentId: walker,
        probeMarkers: 1,
      })
  })
})

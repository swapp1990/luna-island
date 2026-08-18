import { test, expect } from '@playwright/test'

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

test.describe.serial('interaction staging (P3-13)', () => {
  test('conversation: facing each other + speech bubble text matches say', async ({
    page,
  }) => {
    await readyFresh(page)

    const seeded = await page.evaluate(() =>
      window.__simControl.seedConversation?.({
        agentIdA: 'agent-0',
        agentIdB: 'agent-1',
        maxTicks: 200,
        minSays: 1,
      }),
    )
    expect(seeded?.ok).toBe(true)
    expect((seeded?.says ?? 0) >= 1).toBe(true)

    // Settle one render so mesh staging + HTML speech sync
    await page.evaluate(() => {
      window.__simControl.pause()
    })
    await page.waitForFunction(() => window.__simState?.ready === true)

    const probe = await page.evaluate(() => {
      const events = (
        window as unknown as {
          __simControl: {
            countEventTypes?: () => Record<string, number>
            describeStaging?: (id: string) => {
              speechText: string | null
              faceId: string | null
              faceKind: string | null
              yaw: number | null
            } | null
          }
        }
      ).__simControl
      const sayCount = window.__simControl.countEventTypes?.()['mind:say'] ?? 0
      const a = window.__simControl.describeStaging?.('agent-0')
      const b = window.__simControl.describeStaging?.('agent-1')
      const facingA = (
        window as unknown as {
          __agentFacing?: (id: string) => { yaw: number } | null
        }
      ).__agentFacing?.('agent-0')
      const facingB = (
        window as unknown as {
          __agentFacing?: (id: string) => { yaw: number } | null
        }
      ).__agentFacing?.('agent-1')
      return { sayCount, a, b, yawA: facingA?.yaw ?? a?.yaw, yawB: facingB?.yaw ?? b?.yaw }
    })

    expect(probe.sayCount).toBeGreaterThanOrEqual(1)
    expect(probe.a?.speechText || probe.b?.speechText).toBeTruthy()

    // At least one faces the other via staging faceId
    const faces =
      (probe.a?.faceId === 'agent-1' && probe.a?.faceKind === 'agent') ||
      (probe.b?.faceId === 'agent-0' && probe.b?.faceKind === 'agent')
    expect(faces).toBe(true)

    // Yaws should differ (facing toward each other, not parallel same direction)
    if (probe.yawA != null && probe.yawB != null) {
      let d = Math.abs(probe.yawA - probe.yawB)
      while (d > Math.PI) d = Math.abs(d - Math.PI * 2)
      // Roughly opposite-ish: not nearly identical
      expect(d).toBeGreaterThan(0.4)
    }

    // DOM speech (live HTML channel) should carry the utterance when not photo
    const domText = await page.evaluate(() => {
      const els = [
        ...document.querySelectorAll(
          '[data-testid="speech-bubble"], [data-speech-bubble]',
        ),
      ] as HTMLElement[]
      return els
        .map((el) => el.querySelector('[data-content]')?.textContent ?? el.textContent ?? '')
        .filter((t) => t && t !== '▼')
        .join(' | ')
    })
    const spoken = probe.a?.speechText || probe.b?.speechText || ''
    if (spoken) {
      expect(domText.includes(spoken.slice(0, Math.min(12, spoken.length)))).toBe(true)
    }
  })

  test('examine puts 🔍 on the target place', async ({ page }) => {
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
          const st = window.__simControl.describeStaging?.('agent-0')
          const v = window.__simControl.describeAgentVisual?.('agent-0')
          return {
            ok: true,
            glyphPlaceId: st?.glyphPlaceId ?? v?.glyphPlaceId ?? null,
            glyph: v?.glyph ?? null,
            faceId: st?.faceId ?? null,
            tick: window.__simState.tick,
          }
        }
        if (i > 0 && i % 25 === 0) seed()
        window.__simControl.ffwd(1)
      }
      return {
        ok: false,
        glyphPlaceId: null as string | null,
        glyph: null as string | null,
        faceId: null as string | null,
        tick: window.__simState.tick,
      }
    })

    expect(result.ok).toBe(true)
    expect(result.glyph).toBe('examine')
    expect(result.glyphPlaceId).toBe('notice-board-0')
    expect(result.faceId).toBe('notice-board-0')
  })

  test('commission window: scroll prop + site ceremony', async ({ page }) => {
    await readyFresh(page)

    const result = await page.evaluate(() => {
      // Solvent mind that can commission
      window.__simControl.ensureWallet?.('agent-0', 40)
      // Crowded home + commission intent
      const seed = () =>
        window.__simControl.postIntent?.(
          'agent-0',
          { kind: 'commission', reason: 'I need my own house.' },
          'I need my own house.',
        )
      seed()
      for (let i = 0; i < 30; i++) {
        const n =
          window.__simControl.countEventTypes?.()['construction:commissioned'] ?? 0
        if (n >= 1) {
          // Stay inside COMMISSION_WINDOW
          const st = window.__simControl.describeStaging?.('agent-0')
          const probe = (
            window as unknown as {
              __renderProbe?: { ceremonies?: number; props?: Record<string, string | null> }
            }
          ).__renderProbe
          return {
            ok: true,
            prop: st?.prop ?? null,
            ceremonies: st?.ceremonies ?? [],
            probeCeremonies: probe?.ceremonies ?? 0,
            faceKind: st?.faceKind ?? null,
            faceId: st?.faceId ?? null,
            tick: window.__simState.tick,
          }
        }
        window.__simControl.ffwd(1)
        if (i % 5 === 0) seed()
      }
      return {
        ok: false,
        prop: null as string | null,
        ceremonies: [] as Array<{ placeId: string }>,
        probeCeremonies: 0,
        faceKind: null as string | null,
        faceId: null as string | null,
        tick: window.__simState.tick,
      }
    })

    expect(result.ok).toBe(true)
    expect(result.prop).toBe('scroll')
    expect(result.ceremonies.length).toBeGreaterThanOrEqual(1)
    expect(result.probeCeremonies).toBeGreaterThanOrEqual(1)
    expect(result.faceKind).toBe('place')
    expect(result.faceId).toBeTruthy()
  })
})

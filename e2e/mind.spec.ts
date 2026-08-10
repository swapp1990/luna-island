import { test, expect } from '@playwright/test'

test.describe.serial('lunabrain harness', () => {
  test('?brain=mock: Mira decides; Mind tab + chip; scrub replays without new decides', async ({
    page,
  }) => {
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Clear any autosave side-effects — new world so mind starts clean
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('luna-island')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      })
    })
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    // Mind enabled with mock provider
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.enabled === true),
      )
      .toBe(true)
    const provider = await page.evaluate(
      () => (window as any).__simState?.mind?.provider as string,
    )
    expect(provider).toBe('mock')

    // 2 sim-hours = 120 ticks — Mira should have ≥1 mind decision
    await page.evaluate(() => (window as any).__simControl.ffwd(120))
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.decisions as number),
      )
      .toBeGreaterThanOrEqual(1)

    const decisionsAfter = await page.evaluate(
      () => (window as any).__simState.mind.decisions as number,
    )
    const decideCallsAfter = await page.evaluate(
      () => (window as any).__simState.mind.decideCalls as number,
    )
    expect(decisionsAfter).toBeGreaterThanOrEqual(1)

    // Chip counts up
    const chip = page.getByTestId('mind-chip')
    await expect(chip).toBeVisible()
    await expect(page.getByTestId('mind-chip-count')).toHaveText(String(decisionsAfter))
    await expect(page.getByTestId('mind-chip-provider')).toHaveText('mock')

    // Select Mira (agent-0)
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await expect(page.getByTestId('inspector')).toBeVisible()

    // Mind tab
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-tab')).toBeVisible()
    await expect(page.getByTestId('mind-last-decision')).toBeVisible()
    const reasoning = await page.getByTestId('mind-last-reasoning').textContent()
    expect(reasoning && reasoning.length).toBeGreaterThan(0)
    expect(reasoning).not.toBe('No mind decision yet')

    // Capture decision event at a known tick for scrub check
    const decisionSnap = await page.evaluate(() => {
      const events = (window as any).__simControl
      // Read from view sim via scrub state — use bridge event count + evaluate live
      void events
      const s = (window as any).__simState
      return {
        tick: s.tick as number,
        decisions: s.mind.decisions as number,
        decideCalls: s.mind.decideCalls as number,
      }
    })

    // Find first mind:decision via internal probe
    const firstDecision = await page.evaluate(() => {
      const live = (window as any).__simControl
      // Walk via ffwd-free path: use select + inspector timeline ticks
      // Bridge doesn't expose events; read from DOM timeline after opening mind tab
      const rows = Array.from(
        document.querySelectorAll('[data-testid="mind-timeline"] [data-tick]'),
      )
      if (rows.length === 0) return null
      const last = rows[rows.length - 1] as HTMLElement // timeline is newest-first; last is oldest
      const first = rows[0] as HTMLElement
      return {
        newestTick: Number(first.getAttribute('data-tick')),
        oldestTick: Number(last.getAttribute('data-tick')),
        newestText: first.textContent ?? '',
      }
    })
    expect(firstDecision).toBeTruthy()
    const decisionTick = firstDecision!.newestTick
    const decisionText = firstDecision!.newestText

    // Scrub back before decision then forward to it — decision count must not rise
    const scrubTo = Math.max(0, decisionTick - 10)
    await page.evaluate((t) => (window as any).__simControl.scrubTo(t), scrubTo)
    await page.evaluate((t) => (window as any).__simControl.scrubTo(t), decisionTick)

    // Re-open mind tab content on fork view
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()

    const afterScrub = await page.evaluate(() => {
      const s = (window as any).__simState
      const row = document.querySelector(
        `[data-testid="mind-timeline"] [data-tick="${s.tick}"]`,
      ) as HTMLElement | null
      // Prefer exact tick; else any decision row containing the tick stamp area
      const rows = Array.from(
        document.querySelectorAll('[data-testid="mind-timeline"] [data-tick]'),
      ) as HTMLElement[]
      const match = rows.find((r) => Number(r.getAttribute('data-tick')) === s.tick)
      return {
        mode: s.mode as string,
        tick: s.tick as number,
        decisions: s.mind.decisions as number,
        decideCalls: s.mind.decideCalls as number,
        rowText: match?.textContent ?? row?.textContent ?? null,
      }
    })

    // Meter is live-session cumulative; decideCalls must not increase from scrub
    expect(afterScrub.decideCalls).toBe(decideCallsAfter)
    expect(afterScrub.decisions).toBe(decisionSnap.decisions)

    // Reasoning at decision tick still present in timeline when scrubbed to that tick
    await page.evaluate((t) => (window as any).__simControl.scrubTo(t), decisionTick)
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()
    const replayed = await page.evaluate((tick) => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid="mind-timeline"] [data-tick]'),
      ) as HTMLElement[]
      const match = rows.find((r) => Number(r.getAttribute('data-tick')) === tick)
      return match?.textContent ?? null
    }, decisionTick)
    expect(replayed).toBeTruthy()
    // Same reasoning fragment as live timeline
    const reasonPart = decisionText.split('decision:')[1]?.trim() ?? decisionText
    expect(replayed).toContain(reasonPart.slice(0, 20))

    void decisionText
  })

  test('?brain=off boots clean with no mind events', async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.ffwd(120))

    const mind = await page.evaluate(() => (window as any).__simState?.mind)
    expect(mind?.enabled).toBe(false)
    expect(mind?.decisions ?? 0).toBe(0)
    expect(mind?.provider).toBe('off')

    // No mind chip
    await expect(page.getByTestId('mind-chip')).toHaveCount(0)

    // Utility agent mind tab says instinct
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-1'))
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-instinct')).toHaveText('Runs on instinct')
  })
})

import { test, expect } from '@playwright/test'

async function wipeIdb(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('luna-island')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.onblocked = () => resolve()
    })
  })
}

test.describe.serial('P3-5 soak fixes', () => {
  test('conversation starts under sustained mock decision traffic', async ({ page }) => {
    const url = '/?brain=mock&mindWallMs=200&mindConcurrency=3&mindWallFloorMs=0'
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await wipeIdb(page)
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.enabled === true),
      )
      .toBe(true)

    // Pause so rAF cannot walk the pair off the plaza during wall/floor waits.
    // userSpeed 0 still allows new conversations (loop: userSpeed <= 1).
    await page.evaluate(() => (window as any).__simControl.pause())

    const pin = async () => {
      await page.evaluate(() =>
        (window as any).__simControl.seedConversation({
          agentIdA: 'agent-0',
          agentIdB: 'agent-3',
          maxTicks: 4,
          minSays: 99,
        }),
      )
    }

    // Kick 6-mind decision traffic (K=3 in flight; floor off so the rest
    // pipeline immediately — thinking stays non-zero through the first wave).
    await page.evaluate(() => (window as any).__simControl.ffwd(4))
    await page.waitForTimeout(250)
    const thinking = await page.evaluate(
      () => ((window as any).__simState.mind.thinking as number) ?? 0,
    )
    expect(thinking).toBeGreaterThan(0)

    // Drain the first two K-batches (~200ms each) so in-flight ≤ 1, then pin.
    await page.waitForTimeout(500)
    let says = 0
    for (let i = 0; i < 16 && says < 1; i++) {
      await pin()
      await page.waitForTimeout(350)
      await page.evaluate(() => (window as any).__simControl.ffwd(3))
      const counts = await page.evaluate(
        () => (window as any).__simControl.countEventTypes?.() as Record<string, number>,
      )
      says = (counts?.['mind:say'] ?? 0) as number
    }

    expect(says).toBeGreaterThanOrEqual(1)
    const decisions = await page.evaluate(
      () => (window as any).__simState.mind.decisions as number,
    )
    expect(decisions).toBeGreaterThan(0)
  })

  test('exportWorldJson returns parseable v5 payload', async ({ page }) => {
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await wipeIdb(page)
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.ffwd(40))
    const raw = await page.evaluate(() => (window as any).__simControl.exportWorldJson())
    expect(typeof raw).toBe('string')
    const parsed = JSON.parse(raw as string) as {
      formatVersion: number
      seed: number
      tick: number
      snapshot: unknown
    }
    expect(parsed.formatVersion).toBe(5)
    expect(parsed.seed).toBe(42)
    expect(parsed.tick).toBeGreaterThan(0)
    expect(parsed.snapshot).toBeTruthy()

    const storyRaw = await page.evaluate(() =>
      (window as any).__simControl.exportStoryJson(),
    )
    const story = JSON.parse(storyRaw as string) as {
      decisions: unknown[]
      reflections: unknown[]
      says: unknown[]
      sanctions: unknown[]
      proposals: unknown[]
    }
    expect(Array.isArray(story.decisions)).toBe(true)
    expect(Array.isArray(story.reflections)).toBe(true)
    expect(Array.isArray(story.says)).toBe(true)
    expect(Array.isArray(story.sanctions)).toBe(true)
    expect(Array.isArray(story.proposals)).toBe(true)
  })

  test("newWorld(42, 'lean') boots with 6 bushes", async ({ page }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await wipeIdb(page)
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => (window as any).__simControl.newWorld(42, 'lean'))
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            return {
              ready: s?.ready === true,
              bushes: s?.placeCounts?.['berry-bush'] as number | undefined,
              seed: s?.seed as number | undefined,
              tick: s?.tick as number | undefined,
            }
          }),
        { timeout: 20_000 },
      )
      .toEqual(
        expect.objectContaining({
          ready: true,
          bushes: 6,
          seed: 42,
        }),
      )
  })
})

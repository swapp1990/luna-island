import { test, expect } from '@playwright/test'

test.describe.serial('photo mode + world import', () => {
  test('photo.enter hides HUD, shows caption; exit restores; sim state consistent', async ({
    page,
  }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => window.__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => window.__simControl.pause())
    const before = await page.evaluate(() => {
      const s = window.__simState
      return {
        tick: s.tick,
        day: s.day,
        seed: s.seed,
        agentCount: s.agentCount,
        mode: s.mode,
        photoMode: s.photoMode ?? false,
      }
    })
    expect(before.photoMode).toBe(false)
    await expect(page.getByTestId('hud-controls')).toBeVisible()

    await page.evaluate(() => {
      window.__simControl.photo.enter({
        caption: 'Mira examines the farm',
        subtitle: 'People tend the soil here.',
        agentId: window.__simState.agentIds[0],
        zoom: 1.2,
      })
    })

    await expect
      .poll(async () =>
        page.evaluate(() => window.__simState.photoMode === true),
      )
      .toBe(true)

    await expect(page.getByTestId('hud-controls')).not.toBeVisible()
    await expect(page.getByTestId('photo-caption')).toBeVisible()
    await expect(page.getByTestId('photo-headline')).toHaveText(
      'Mira examines the farm',
    )
    await expect(page.getByTestId('photo-subtitle')).toHaveText(
      'People tend the soil here.',
    )
    const kicker = await page.getByTestId('photo-kicker').innerText()
    expect(kicker).toMatch(/^LUNA ISLAND — DAY \d+, \d{2}:\d{2}$/)

    const mid = await page.evaluate(() => {
      const s = window.__simState
      return {
        tick: s.tick,
        day: s.day,
        seed: s.seed,
        agentCount: s.agentCount,
        photoMode: s.photoMode,
      }
    })
    expect(mid.tick).toBe(before.tick)
    expect(mid.day).toBe(before.day)
    expect(mid.seed).toBe(before.seed)
    expect(mid.agentCount).toBe(before.agentCount)
    expect(mid.photoMode).toBe(true)

    await page.evaluate(() => window.__simControl.photo.exit())

    await expect
      .poll(async () =>
        page.evaluate(() => window.__simState.photoMode === false),
      )
      .toBe(true)
    await expect(page.getByTestId('hud-controls')).toBeVisible()
    await expect(page.getByTestId('photo-caption')).toHaveCount(0)

    const after = await page.evaluate(() => {
      const s = window.__simState
      return { tick: s.tick, seed: s.seed, photoMode: s.photoMode }
    })
    expect(after.tick).toBe(before.tick)
    expect(after.seed).toBe(before.seed)
    expect(after.photoMode).toBe(false)
  })

  test('importWorldJson round-trips stateAt hashes at 3 probe ticks', async ({
    page,
  }) => {
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => window.__simState?.ready === true))
      .toBe(true)

    // Fresh seed, advance past day boundary so probes span archives
    await page.evaluate(() => {
      window.__simControl.newWorld(42)
    })
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            window.__simState?.ready === true &&
            window.__simState.seed === 42 &&
            window.__simState.tick < 50,
        ),
      )
      .toBe(true)

    await page.evaluate(() => window.__simControl.ffwd(2000))
    await page.evaluate(() => window.__simControl.pause())

    const probes = [100, 900, 1800]
    const before = await page.evaluate((ps) => {
      const hashes = ps.map((t) => window.__simControl.hashAtTick!(t))
      const json = window.__simControl.exportWorldJson()
      return {
        hashes,
        json,
        tick: window.__simState.tick,
        headHash: window.__simControl.hashAtTick!(window.__simState.tick),
      }
    }, probes)

    expect(before.json.length).toBeGreaterThan(100)
    expect(before.hashes.every((h) => typeof h === 'string' && h.length > 0)).toBe(
      true,
    )

    await page.evaluate(async (json) => {
      await window.__simControl.importWorldJson(json)
    }, before.json)

    await expect
      .poll(async () =>
        page.evaluate(
          (tick) =>
            window.__simState?.ready === true &&
            window.__simState.tick === tick,
          before.tick,
        ),
      )
      .toBe(true)

    const after = await page.evaluate((ps) => {
      return {
        hashes: ps.map((t) => window.__simControl.hashAtTick!(t)),
        headHash: window.__simControl.hashAtTick!(window.__simState.tick),
        tick: window.__simState.tick,
      }
    }, probes)

    expect(after.tick).toBe(before.tick)
    expect(after.headHash).toBe(before.headHash)
    expect(after.hashes).toEqual(before.hashes)

    // scrubTo lands on a past probe tick (absolute seek across days).
    // stateAt can be heavy right after a large import — poll, don't one-shot.
    await page.evaluate((t) => {
      window.__simControl.scrubTo(t)
    }, probes[1])
    await expect
      .poll(
        async () =>
          page.evaluate((t) => {
            const s = window.__simState
            return s.tick === t && s.mode === 'replay'
          }, probes[1]),
        { timeout: 60000 },
      )
      .toBe(true)
  })
})

import { test, expect } from '@playwright/test'

/**
 * P6-1b gate: the island must not empty itself. Measured regression — at P6-1
 * this lost 25 of 60 props to the sea in 30s of idle, with zero player input.
 */
test('island does not empty itself when idle', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/god')
  await page.waitForFunction(() => (window as any).__godState?.ready === true, null, {
    timeout: 45_000,
  })
  const rows = await page.evaluate(async () => {
    const st = () => (window as any).__godState
    const out: any[] = []
    for (let i = 0; i <= 12; i++) {
      out.push({
        t: i * 5,
        props: st().propCount,
        splashes: st().counters.splashes,
        impacts: st().counters.impacts,
        awake: st().awakeCount,
      })
      await new Promise((r) => setTimeout(r, 5000))
    }
    return out
  })
  console.log('IDLE ' + JSON.stringify(rows))
  const first = rows[0]
  const last = rows[rows.length - 1]
  const atTen = rows.find((r: any) => r.t === 10)

  expect(first.props - last.props, 'props lost while idle').toBeLessThanOrEqual(2)
  expect(last.splashes, 'unprompted splashes').toBeLessThanOrEqual(2)
  expect(last.impacts, 'phantom impacts from rolling/resting contacts').toBeLessThanOrEqual(5)
  expect(atTen.awake, 'bodies still awake 10s after boot').toBe(0)
})

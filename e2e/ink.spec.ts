import { expect, test, type Page } from '@playwright/test'

type InkMind = {
  id: 'A' | 'B'
  at: string | null
  pos: { x: number; y: number }
  hunger: number
  energy: number
  social: number
  money: number
  fridge: number
  action: string | null
  reason: string
  source: string
  sufferedHours: number
}

type InkState = {
  ready: boolean
  tick: number
  day: number
  dayName: string
  hour: number
  minute: number
  speed: number
  paused: boolean
  eventCount: number
  minds: InkMind[]
}

type InkEvent = {
  seq: number
  tick: number
  type: string
  agentId?: string
  data?: Record<string, unknown>
  reason?: string
}

type InkControl = {
  setSpeed: (n: number) => void
  pause: () => void
  resume: () => void
  step: (ticks: number) => void
  seek: (tick: number) => void
  state: () => InkState
  events: (sinceSeq?: number) => InkEvent[]
  applyIntent: (mindId: 'A' | 'B', intent: { action: string; count?: number; reason: string }, source?: string) => void
}

function ink(page: Page) {
  return page.evaluate(() => (window as unknown as { __inkState: InkState }).__inkState)
}

async function boot(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  await page.goto('/ink', { waitUntil: 'domcontentloaded' })
  await expect
    .poll(async () => {
      return page.evaluate(() => (window as unknown as { __inkState?: { ready?: boolean } }).__inkState?.ready === true)
    }, { timeout: 30_000 })
    .toBe(true)
  await page.evaluate(() => {
    ;(window as unknown as { __inkControl: InkControl }).__inkControl.pause()
  })
  expect(errors, errors.join('\n')).toEqual([])
}

test.describe.serial('ink town', () => {
  test('/ink boots and the bridge reports ready', async ({ page }) => {
    await boot(page)
    const state = await ink(page)
    expect(state.ready).toBe(true)
    expect(state.minds).toHaveLength(2)
    await expect(page.locator('canvas')).toHaveCount(1)
  })

  test('stepping one sim day elapses and a walking dot changes pos', async ({ page }) => {
    await boot(page)
    const before = await page.evaluate(() => {
      const w = window as unknown as { __inkState: InkState; __inkControl: InkControl }
      w.__inkControl.pause()
      return { tick: w.__inkState.tick, pos: { ...w.__inkState.minds[0]!.pos } }
    })
    await page.evaluate(() => {
      const w = window as unknown as { __inkControl: InkControl }
      w.__inkControl.step(1440)
    })
    const afterDay = await ink(page)
    expect(afterDay.tick).toBe(before.tick + 1440)

    await page.evaluate(() => {
      const w = window as unknown as { __inkControl: InkControl }
      w.__inkControl.applyIntent('A', { action: 'go_market', reason: 'e2e walk' }, 'llm')
      w.__inkControl.step(40)
    })
    const walked = await ink(page)
    expect(walked.minds[0]!.pos.x).not.toBeCloseTo(before.pos.x, 5)
    expect(walked.minds[0]!.pos.y).not.toBeCloseTo(before.pos.y, 5)
  })

  test('go_market arrives within 40 ticks', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      const w = window as unknown as { __inkControl: InkControl }
      w.__inkControl.pause()
      w.__inkControl.applyIntent('A', { action: 'go_market', reason: 'go to market' }, 'llm')
      w.__inkControl.step(40)
    })
    const state = await ink(page)
    expect(state.minds[0]!.at).toBe('market')
  })

  test('rule brain 3-day run has zero buy, zero work, and suffered hours', async ({ page }) => {
    await boot(page)
    const result = await page.evaluate(() => {
      const w = window as unknown as { __inkControl: InkControl; __inkState: InkState }
      w.__inkControl.pause()
      w.__inkControl.seek(6 * 60)
      w.__inkControl.step(3 * 1440)
      const events = w.__inkControl.events()
      const buy = events.filter((e) => e.data?.action === 'buy').length
      const work = events.filter((e) => e.data?.action === 'work').length
      return {
        buy,
        work,
        sufferedA: w.__inkState.minds[0]!.sufferedHours,
        sufferedB: w.__inkState.minds[1]!.sufferedHours,
        tick: w.__inkState.tick,
      }
    })
    expect(result.buy).toBe(0)
    expect(result.work).toBe(0)
    expect(result.sufferedA + result.sufferedB).toBeGreaterThan(0)
    expect(result.tick).toBe(6 * 60 + 3 * 1440)
  })

  test('scripted buy on Saturday fails naming the weekend', async ({ page }) => {
    await boot(page)
    const fail = await page.evaluate(() => {
      const w = window as unknown as { __inkControl: InkControl }
      w.__inkControl.pause()
      const saturdayTen = 5 * 1440 + 10 * 60
      w.__inkControl.seek(saturdayTen)
      w.__inkControl.applyIntent('A', { action: 'go_market', reason: 'walk' }, 'llm')
      w.__inkControl.step(40)
      w.__inkControl.applyIntent('A', { action: 'buy', count: 1, reason: 'buy food' }, 'llm')
      return w.__inkControl.events().filter((e) => e.type === 'action:fail' && e.data?.action === 'buy')
    })
    expect(fail.length).toBeGreaterThan(0)
    const why = String(fail[0]?.data?.why ?? fail[0]?.reason ?? '')
    expect(why).toMatch(/Saturday|weekend/i)
  })
})

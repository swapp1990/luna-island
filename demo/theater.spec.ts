import { test, type Locator, type Page } from '@playwright/test'

/**
 * Run Theater demo recording — browse recorded runs, load one, skip through the
 * chapters it recorded, watch it roll, and read what changed.
 *
 * Not a gate: it asserts almost nothing on purpose. Its output is the video.
 *   npx playwright test --config=playwright.demo.config.ts
 */

const pause = (page: Page, ms: number) => page.waitForTimeout(ms)

async function injectCalloutStyles(page: Page) {
  await page.addStyleTag({
    content: `
      .__ev_focus {
        outline: 3px solid rgba(255,160,80,.95) !important;
        outline-offset: 4px !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 4px rgba(255,160,80,.18), 0 10px 30px rgba(255,140,60,.25) !important;
      }
      .__ev_callout {
        position: fixed;
        background: linear-gradient(135deg,#ff6b35,#ff8a50);
        color: #fff; padding: 9px 15px; border-radius: 9999px;
        font: 600 13px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
        letter-spacing: .015em; white-space: nowrap; z-index: 99999;
        box-shadow: 0 6px 18px rgba(255,107,53,.5); pointer-events: none;
      }
      .__ev_title {
        position: fixed; left: 50%; transform: translateX(-50%);
        top: 84px; z-index: 99999; pointer-events: none;
        background: rgba(10,13,22,.9); color: #f2f4f8;
        border: 1px solid rgba(255,255,255,.14);
        padding: 10px 20px; border-radius: 12px;
        font: 600 15px/1.35 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,.5);
      }
    `,
  })
}

/** Ring an element and float a label above it. */
async function label(page: Page, locator: Locator, text: string) {
  const handle = await locator.elementHandle()
  if (!handle) return
  await page.evaluate(
    ({ el, t }) => {
      document.querySelectorAll('.__ev_focus').forEach((e) => e.classList.remove('__ev_focus'))
      document.querySelectorAll('.__ev_callout').forEach((e) => e.remove())
      ;(el as HTMLElement).classList.add('__ev_focus')
      const c = document.createElement('div')
      c.className = '__ev_callout'
      c.textContent = t
      document.body.appendChild(c)
      const r = (el as HTMLElement).getBoundingClientRect()
      c.style.top = `${Math.max(8, r.top - 42)}px`
      const cw = c.getBoundingClientRect().width
      c.style.left = `${Math.max(8, Math.min(window.innerWidth - cw - 8, r.left + (r.width - cw) / 2))}px`
    },
    { el: handle, t: text },
  )
}

async function clearLabels(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('.__ev_focus').forEach((e) => e.classList.remove('__ev_focus'))
    document.querySelectorAll('.__ev_callout').forEach((e) => e.remove())
  })
}

/** Centre caption that narrates the section. */
async function title(page: Page, text: string | null) {
  await page.evaluate((t) => {
    document.querySelectorAll('.__ev_title').forEach((e) => e.remove())
    if (!t) return
    const d = document.createElement('div')
    d.className = '__ev_title'
    d.textContent = t
    document.body.appendChild(d)
  }, text)
}

test('theater', async ({ page }) => {
  await page.goto('/?brain=off')
  await page.waitForFunction(() => (window as any).__simState?.ready === true, null, {
    timeout: 60_000,
  })
  await injectCalloutStyles(page)
  await pause(page, 1200)

  // ---- 1. open the theater -------------------------------------------------
  await title(page, 'Run Theater — watch a recorded soak back')
  const toggle = page.getByTestId('run-theater-toggle')
  await label(page, toggle, 'Every recorded run lives here')
  await pause(page, 1800)
  await toggle.click()
  await clearLabels(page)
  await page.getByTestId('run-list').waitFor()
  await pause(page, 1500)

  // ---- 2. pick the run that shot a reel ------------------------------------
  await title(page, 'Runs found in artifacts/ — params, counts, and whether the photographer ran')
  const cards = page.getByTestId('run-card')
  await label(page, cards.first(), 'Newest run first')
  await pause(page, 2000)

  // Prefer a run with a reel: its chapters carry the stills it actually shot.
  const reelId = await page.evaluate(async () => {
    const runs = await (window as any).__simControl.runs.list()
    return (runs.find((r: any) => r.hasHighlights && r.hasWorld) ?? runs.find((r: any) => r.hasWorld))?.id
  })
  const chosen = page.locator(`[data-testid="run-card"][data-run-id="${reelId}"]`)
  await label(page, chosen, 'This one shot a photographer reel')
  await pause(page, 2000)
  await title(page, 'Loading the run — its world export restores the whole timeline')
  await chosen.click()
  await clearLabels(page)

  await page.getByTestId('run-loaded').waitFor({ timeout: 60_000 })
  await pause(page, 2000)

  // ---- 3. the chapter rail -------------------------------------------------
  await title(page, 'Chapters the run itself recorded — not re-scored at view time')
  const moments = page.getByTestId('run-moment')
  await label(page, moments.first(), 'The run begins')
  await pause(page, 1800)

  const withStill = page.locator('[data-testid="run-moment"]:has([data-testid="run-moment-still"])')
  if (await withStill.count()) {
    await withStill.first().scrollIntoViewIfNeeded()
    await label(page, withStill.first(), 'A moment the photographer shot, with its still')
    await pause(page, 2600)
  }
  await clearLabels(page)

  // ---- 4. skipping seeks the world behind the panel ------------------------
  await title(page, 'Click a chapter — the world jumps to that exact tick')
  const clock = page.getByTestId('hud-controls')
  const count = await moments.count()
  for (const i of [1, Math.floor(count / 2), count - 2].filter((n) => n > 0 && n < count)) {
    const m = moments.nth(i)
    await m.scrollIntoViewIfNeeded()
    await m.click()
    await label(page, clock, 'Sim clock follows the chapter')
    await pause(page, 1700)
  }
  await clearLabels(page)

  // ---- 5. watch it roll ----------------------------------------------------
  await title(page, 'Watch run — replay rolls forward, chaining across day boundaries')
  const play = page.getByTestId('run-play')
  await label(page, play, 'Press play and it runs itself')
  await pause(page, 1400)
  await play.click()
  await page.evaluate(() => (window as any).__simControl.setSpeed(64))
  await clearLabels(page)
  await pause(page, 6000)
  await page.evaluate(() => (window as any).__simControl.runs.play(false))
  await pause(page, 800)

  // ---- 6. what changed -----------------------------------------------------
  await title(page, 'What changed during this run — before vs after, off its own timeline')
  const tab = page.getByTestId('run-tab-changed')
  await tab.click()
  await page.getByTestId('run-changelog').waitFor()
  await pause(page, 2200)

  const panel = page.getByTestId('run-theater')
  for (const y of [260, 520, 780, 1040]) {
    await panel.evaluate((el, top) => el.scrollTo({ top, behavior: 'smooth' }), y)
    await pause(page, 1500)
  }

  const firsts = page.getByTestId('changelog-firsts')
  if (await firsts.count()) {
    await firsts.scrollIntoViewIfNeeded()
    await label(page, firsts, 'Every first, with the exact clock it happened at')
    await pause(page, 2600)
    await clearLabels(page)
  }

  await title(page, 'Run Theater')
  await pause(page, 1800)
})

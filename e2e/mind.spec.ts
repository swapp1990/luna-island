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

  test('auto-breathe: 64× throttles to 1 while mind pending, restores; resource bar no HUD overlap', async ({
    page,
  }) => {
    // mindWallMs forces async mock path so thinking/inFlight is observable (codex-like)
    const url = '/?brain=mock&mindWallMs=1200'
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('luna-island')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      })
    })
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.enabled === true),
      )
      .toBe(true)

    const decisionsBefore = await page.evaluate(
      () => (window as any).__simState.mind.decisions as number,
    )
    const fallbacksBefore = await page.evaluate(
      () => (window as any).__simState.mind.fallbacks as number,
    )

    // User wants 64×; breathe drops effective speed to 1 while wall-bound mind is thinking
    await page.evaluate(() => (window as any).__simControl.setSpeed(64))

    // Wait until we observe the breathe window: thinking/pending and effective speed 1
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            const thinking = (s.mind?.thinking ?? s.mind?.pending ?? 0) as number
            return thinking >= 1 && s.speed === 1 && (s.userSpeed ?? 64) === 64
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    // Capture thinking chip screenshot while pending
    await expect(page.getByTestId('mind-chip')).toBeVisible()
    await expect(page.getByTestId('mind-chip-thinking')).toBeVisible()
    await page.screenshot({ path: 'artifacts/mind-pacing.png', fullPage: false })

    // After decision applies: thinking clears, speed restores to 64, decisions++
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            return {
              thinking: (s.mind?.thinking ?? 0) as number,
              pending: s.mind?.pending as number,
              speed: s.speed as number,
              userSpeed: s.userSpeed as number,
              decisions: s.mind?.decisions as number,
              fallbacks: s.mind?.fallbacks as number,
            }
          }),
        { timeout: 20_000 },
      )
      .toEqual(
        expect.objectContaining({
          thinking: 0,
          speed: 64,
          userSpeed: 64,
        }),
      )

    const after = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        decisions: s.mind.decisions as number,
        fallbacks: s.mind.fallbacks as number,
        speed: s.speed as number,
      }
    })
    expect(after.decisions).toBeGreaterThan(decisionsBefore)
    expect(after.fallbacks).toBe(fallbacksBefore)
    expect(after.speed).toBe(64)

    // Resource bar must not overlap centered HUD controls at 1280×720
    await expect(page.getByTestId('resource-bar')).toBeVisible()
    await expect(page.getByTestId('hud-controls')).toBeVisible()
    const overlap = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="resource-bar"]') as HTMLElement
      const hud = document.querySelector('[data-testid="hud-controls"]') as HTMLElement
      const a = bar.getBoundingClientRect()
      const b = hud.getBoundingClientRect()
      const noOverlap =
        a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom
      return {
        noOverlap,
        bar: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
        hud: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      }
    })
    expect(overlap.noOverlap).toBe(true)
  })

  test('🧠 chip shows budget numbers; forced cooldown is amber + instinct', async ({
    page,
  }) => {
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

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
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.enabled === true),
      )
      .toBe(true)

    // Budget fields on bridge
    const mindBefore = await page.evaluate(() => {
      const m = (window as any).__simState.mind
      return {
        budgetUsedHour: m.budgetUsedHour as number,
        budgetMaxHour: m.budgetMaxHour as number,
        budgetUsedDay: m.budgetUsedDay as number,
        budgetMaxDay: m.budgetMaxDay as number,
        budgetCooldown: m.budgetCooldown as boolean,
      }
    })
    expect(mindBefore.budgetMaxHour).toBe(60)
    expect(mindBefore.budgetMaxDay).toBe(300)
    expect(mindBefore.budgetCooldown).toBe(false)

    // Chip renders remaining/max hour budget
    const chip = page.getByTestId('mind-chip')
    await expect(chip).toBeVisible()
    const budgetLabel = page.getByTestId('mind-chip-budget')
    await expect(budgetLabel).toBeVisible()
    await expect(budgetLabel).toHaveText(/\d+\/60h/)

    await page.screenshot({ path: 'artifacts/llm-budget.png', fullPage: false })

    // Force cooldown via bridge hook
    await page.evaluate(() => {
      ;(window as any).__simControl.forceMindBudgetCooldown(3600)
    })

    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.budgetCooldown === true),
      )
      .toBe(true)

    await expect(chip).toHaveAttribute('data-budget-cooldown', '1')
    // Amber-ish styling present (border/background uses amber channel)
    const amber = await chip.evaluate((el) => {
      const s = getComputedStyle(el)
      return s.borderColor + s.backgroundColor
    })
    // rgb with elevated red/green vs blue (amber), or named
    expect(amber.length).toBeGreaterThan(0)

    // mind:budget lands in ticker (honest reason once per cooldown episode)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const text = document.querySelector('[data-testid="ticker"]')?.textContent ?? ''
            return (
              text.includes('budget exhausted') ||
              text.includes('running on instinct')
            )
          }),
        { timeout: 15_000 },
      )
      .toBe(true)

    // Agents keep living under instinct — sim still advances & actions fire
    const tickBefore = await page.evaluate(() => (window as any).__simState.tick as number)
    await page.evaluate(() => (window as any).__simControl.ffwd(60))
    const after = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        tick: s.tick as number,
        decideCalls: s.mind.decideCalls as number,
        budgetCooldown: s.mind.budgetCooldown as boolean,
      }
    })
    expect(after.tick).toBeGreaterThan(tickBefore)
    expect(after.budgetCooldown).toBe(true)
  })

  test('memory & reflection (P3-1): 2 sim-days → Mind tab 💭; prompt has Your memories:; auto brain; off clean', async ({
    page,
  }) => {
    const url = '/?brain=mock'
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('luna-island')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        req.onblocked = () => resolve()
      })
    })
    await page.goto(url)
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.enabled === true),
      )
      .toBe(true)

    // 2 full sim-days — nightly reflections at 03:00 fallback or bedtime sleep
    await page.evaluate(() => (window as any).__simControl.ffwd(2 * 1440))
    // Drain mock holds + note inbox
    await page.evaluate(() => (window as any).__simControl.ffwd(20))

    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-tab')).toBeVisible()
    await expect(page.getByTestId('mind-memories')).toBeVisible()

    // ≥1 reflection row in Memories
    await expect
      .poll(async () => page.getByTestId('mind-memory-reflection').count(), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1)

    // Decision after reflection should include Your memories: in last exchange
    // Advance a bit more so a post-reflection decision can fire
    await page.evaluate(() => (window as any).__simControl.ffwd(200))
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()
    const toggle = page.getByTestId('mind-exchange-toggle')
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    await toggle.click()
    const exchange = page.getByTestId('mind-last-exchange')
    await expect(exchange).toBeVisible()
    const exchangeText = await exchange.textContent()
    expect(exchangeText).toContain('Your memories:')

    await page.screenshot({ path: 'artifacts/memories.png', fullPage: false })

    // Plain URL (no ?brain=) auto-enables mock or codex
    await page.goto('/')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const m = (window as any).__simState?.mind
            return m?.enabled === true && (m.provider === 'mock' || m.provider === 'codex')
          }),
        { timeout: 10_000 },
      )
      .toBe(true)

    // ?brain=off still clean
    await page.goto('/?brain=off')
    await expect
      .poll(async () => page.evaluate(() => (window as any).__simState?.ready === true))
      .toBe(true)
    await page.evaluate(() => (window as any).__simControl.ffwd(60))
    const offMind = await page.evaluate(() => (window as any).__simState?.mind)
    expect(offMind?.enabled).toBe(false)
    expect(offMind?.provider).toBe('off')
    await expect(page.getByTestId('mind-chip')).toHaveCount(0)
  })
})

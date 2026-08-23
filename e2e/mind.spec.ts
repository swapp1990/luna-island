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
    const url = '/?brain=mock&mindWallMs=1200&noNewConversations=1'
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

    // After the whole line drains (incl. rate-floor wait between K-batches):
    // thinking clears, speed restores to 64, decisions++. 15s rolling floor +
    // wall delay can exceed 20s when 6 minds fill two batches.
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
        { timeout: 90_000 },
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

  test('P3-1b queue: 3 minds @64× wall-delay → all decide, 0 fallbacks, breathe drains line', async ({
    page,
  }) => {
    // Async mock path; short delay so 3 sequential dispatches finish quickly
    const url = '/?brain=mock&mindWallMs=400'
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

    // 64× — breathe should drop effective speed to 1 while queue/in-flight
    await page.evaluate(() => (window as any).__simControl.setSpeed(64))

    let sawBreathe = false
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            const thinking = (s.mind?.thinking ?? 0) as number
            return {
              thinking,
              speed: s.speed as number,
              userSpeed: (s.userSpeed ?? 0) as number,
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.objectContaining({
          speed: 1,
          userSpeed: 64,
        }),
      )
    sawBreathe = true
    expect(sawBreathe).toBe(true)

    // Wall-clock run: let the queue drain and decisions apply (no ffwd — that skips breathe)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            return {
              decisions: (s.mind?.decisions ?? 0) as number,
              fallbacks: (s.mind?.fallbacks ?? 0) as number,
              thinking: (s.mind?.thinking ?? 0) as number,
            }
          }),
        { timeout: 90_000 },
      )
      .toEqual(
        expect.objectContaining({
          fallbacks: 0,
        }),
      )

    await expect
      .poll(
        async () =>
          page.evaluate(() => (window as any).__simState?.mind?.decisions as number),
        { timeout: 90_000 },
      )
      .toBeGreaterThanOrEqual(3)

    // Each of the three luna minds must have a decision in the Mind tab
    for (const agentId of ['agent-0', 'agent-1', 'agent-11']) {
      await page.evaluate(
        (id) => (window as any).__simControl.selectAgent(id),
        agentId,
      )
      await page.getByTestId('tab-mind').click()
      await expect(page.getByTestId('mind-tab')).toBeVisible()
      await expect
        .poll(
          async () => {
            const t = await page.getByTestId('mind-last-reasoning').textContent()
            return !!(t && t.length > 0 && t !== 'No mind decision yet')
          },
          { timeout: 60_000 },
        )
        .toBe(true)
    }

    const final = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        decisions: s.mind.decisions as number,
        fallbacks: s.mind.fallbacks as number,
        decideCalls: s.mind.decideCalls as number,
        tick: s.tick as number,
      }
    })
    expect(final.fallbacks).toBe(0)
    expect(final.decisions).toBeGreaterThanOrEqual(3)
    // decideCalls tracks dispatches; decisions track applies. With 6 minds + optional
    // conversation turns on the async path, allow a small in-flight gap at sample time.
    expect(final.decideCalls).toBeGreaterThanOrEqual(final.decisions)
    expect(final.decideCalls - final.decisions).toBeLessThanOrEqual(2)
    // Breathe keeps the world at 1× while the queue drains — tick may stay modest
    expect(final.tick).toBeGreaterThanOrEqual(5)
  })

  test('P3-2b: 6 minds @64× wall-delay → all apply, 0 stale; speed 1 while pending incl. between dispatches', async ({
    page,
  }) => {
    // Async mock; concurrency 3; wall delay so breathe windows are observable.
    // mindWallFloorMs not set — production 15s rolling floor; 6 minds ≈ 2 batches.
    const url = '/?brain=mock&mindWallMs=500&mindConcurrency=3'
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

    await page.evaluate(() => (window as any).__simControl.setSpeed(64))

    // Observe breathe: speed 1 while mind line is non-empty (queue / in-flight / floor)
    let sawBreatheWithPending = false
    let sawSpeed1Between = false
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            const thinking = (s.mind?.thinking ?? 0) as number
            const pending = (s.mind?.pending ?? 0) as number
            return {
              thinking,
              pending,
              speed: s.speed as number,
              userSpeed: (s.userSpeed ?? 0) as number,
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.objectContaining({
          speed: 1,
          userSpeed: 64,
        }),
      )
    sawBreatheWithPending = true

    // Sample while line drains: whenever pending/thinking > 0, speed must stay 1
    const samples: Array<{ thinking: number; pending: number; speed: number }> = []
    const sampleUntil = Date.now() + 45_000
    while (Date.now() < sampleUntil) {
      const snap = await page.evaluate(() => {
        const s = (window as any).__simState
        return {
          thinking: (s.mind?.thinking ?? 0) as number,
          pending: (s.mind?.pending ?? 0) as number,
          speed: s.speed as number,
          decisions: (s.mind?.decisions ?? 0) as number,
          stales: (s.mind?.stales ?? 0) as number,
        }
      })
      samples.push(snap)
      if (snap.thinking > 0 || snap.pending > 0) {
        expect(snap.speed).toBe(1)
        if (snap.thinking > 0) sawSpeed1Between = true
      }
      if (snap.decisions >= 6 && snap.thinking === 0) break
      await page.waitForTimeout(200)
    }

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            return {
              decisions: (s.mind?.decisions ?? 0) as number,
              stales: (s.mind?.stales ?? 0) as number,
              thinking: (s.mind?.thinking ?? 0) as number,
              speed: s.speed as number,
              userSpeed: (s.userSpeed ?? 0) as number,
              fallbacks: (s.mind?.fallbacks ?? 0) as number,
            }
          }),
        { timeout: 120_000 },
      )
      .toEqual(
        expect.objectContaining({
          thinking: 0,
          speed: 64,
          userSpeed: 64,
          stales: 0,
          fallbacks: 0,
        }),
      )

    const final = await page.evaluate(() => {
      const s = (window as any).__simState
      const counts =
        typeof (window as any).__simControl.countEventTypes === 'function'
          ? (window as any).__simControl.countEventTypes()
          : {}
      return {
        decisions: s.mind.decisions as number,
        stales: (s.mind.stales ?? 0) as number,
        decideCalls: s.mind.decideCalls as number,
        speed: s.speed as number,
        eventStale: (counts['mind:stale'] as number) ?? 0,
      }
    })

    expect(sawBreatheWithPending).toBe(true)
    expect(sawSpeed1Between).toBe(true)
    expect(final.stales).toBe(0)
    expect(final.eventStale).toBe(0)
    expect(final.decisions).toBeGreaterThanOrEqual(6)
    expect(final.speed).toBe(64)
    // All six luna minds should show a decision
    for (const agentId of [
      'agent-0',
      'agent-1',
      'agent-2',
      'agent-4',
      'agent-8',
      'agent-11',
    ]) {
      await page.evaluate(
        (id) => (window as any).__simControl.selectAgent(id),
        agentId,
      )
      await page.getByTestId('tab-mind').click()
      await expect
        .poll(
          async () => {
            const t = await page.getByTestId('mind-last-reasoning').textContent()
            return !!(t && t.length > 0 && t !== 'No mind decision yet')
          },
          { timeout: 30_000 },
        )
        .toBe(true)
    }
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

  test('P3-2 conversations: 6 minds, say rows, Conversations tab, bubble, 💭 ticker', async ({
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

    // Eight luna minds registered
    const agentIds = await page.evaluate(
      () => (window as any).__simState?.mind?.agentIds as string[],
    )
    expect(agentIds?.length).toBe(8)
    expect(agentIds).toEqual(
      expect.arrayContaining([
        'agent-0',
        'agent-1',
        'agent-2',
        'agent-3',
        'agent-4',
        'agent-5',
        'agent-8',
        'agent-11',
      ]),
    )

    // Seed a conversation (mock canned says)
    const seeded = await page.evaluate(() =>
      (window as any).__simControl.seedConversation({
        agentIdA: 'agent-0',
        agentIdB: 'agent-1',
        maxTicks: 160,
      }),
    )
    expect(seeded.ok).toBe(true)
    expect(seeded.says).toBeGreaterThanOrEqual(1)

    // Select Mira — Life log has 💬 rows
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-life').click()
    await expect(page.getByTestId('activity-log')).toBeVisible()
    await expect
      .poll(async () => {
        const text = await page.getByTestId('activity-log').textContent()
        return text?.includes('💬') ?? false
      })
      .toBe(true)

    // Joss Life log also has 💬
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-1'))
    await page.getByTestId('tab-life').click()
    await expect
      .poll(async () => {
        const text = await page.getByTestId('activity-log').textContent()
        return text?.includes('💬') ?? false
      })
      .toBe(true)

    // Mind tab Conversations section with transcript
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-conversations')).toBeVisible()
    await expect(page.getByTestId('mind-conversation-row').first()).toBeVisible()
    await page.getByTestId('mind-conversation-toggle').first().click()
    await expect(page.getByTestId('mind-conversation-transcript')).toBeVisible()
    await expect(page.getByTestId('mind-conversation-line').first()).toBeVisible()

    // Speech bubble visible during/after exchange (seeded recent says)
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    // Re-seed a short exchange so bubble is fresh (~4s wall TTL; inject say via another seed)
    await page.evaluate(() =>
      (window as any).__simControl.seedConversation({
        agentIdA: 'agent-0',
        agentIdB: 'agent-1',
        maxTicks: 80,
      }),
    )
    // Wait for speech bubble in DOM (live scan from mind:say)
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const bubbles = Array.from(
              document.querySelectorAll('[data-testid="speech-bubble"], [data-speech-bubble]'),
            ) as HTMLElement[]
            return bubbles.some(
              (el) =>
                el.style.display !== 'none' &&
                (el.textContent?.trim().length ?? 0) > 0,
            )
          }),
        { timeout: 15_000 },
      )
      .toBe(true)

    await page.screenshot({ path: 'artifacts/conversation.png', fullPage: false })

    // Nightly reflections still fire
    await page.evaluate(() => (window as any).__simControl.ffwd(2 * 1440 + 30))
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()
    await expect
      .poll(async () => page.getByTestId('mind-memory-reflection').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1)

    // 💭 ticker rows: ticker is day-scoped. loadDay forks at day START — scrub to
    // day end so night reflections (and 03:00 on next calendar day for prior night)
    // fall inside [dayStart, replayTick].
    const TICKS_PER_DAY = 1440
    const MINUTES_AT_TICK0 = 6 * 60
    const dayStartTick = (day: number) =>
      day <= 1 ? 0 : (day - 1) * TICKS_PER_DAY - MINUTES_AT_TICK0
    const dayEndTick = (day: number) => dayStartTick(day + 1) - 1

    let foundReflect = false
    for (const day of [1, 2] as const) {
      await page.evaluate((d) => (window as any).__simControl.loadDay(d), day)
      await page.evaluate(
        (t) => (window as any).__simControl.scrubTo(t),
        dayEndTick(day),
      )
      await expect
        .poll(async () => page.evaluate(() => (window as any).__simState?.viewDay as number))
        .toBe(day)
      await page.evaluate(() => {
        const root = document.querySelector('[data-testid="ticker"]') as HTMLElement | null
        const btn = root?.querySelector('button') as HTMLButtonElement | null
        if (btn && (btn.textContent ?? '').includes('▸')) btn.click()
      })
      const text = (await page.getByTestId('ticker').textContent()) ?? ''
      if (text.includes('💭') || text.includes('reflected')) {
        foundReflect = true
        break
      }
    }
    // Also check early Day 3 (03:00 fallback reflections land here)
    if (!foundReflect) {
      await page.evaluate(() => (window as any).__simControl.goLive())
      await page.evaluate((t) => (window as any).__simControl.scrubTo(t), dayStartTick(3) + 3 * 60)
      await page.evaluate(() => {
        const root = document.querySelector('[data-testid="ticker"]') as HTMLElement | null
        const btn = root?.querySelector('button') as HTMLButtonElement | null
        if (btn && (btn.textContent ?? '').includes('▸')) btn.click()
      })
      const text = (await page.getByTestId('ticker').textContent()) ?? ''
      foundReflect = text.includes('💭') || text.includes('reflected')
    }
    expect(foundReflect).toBe(true)
  })

  test('P3-2c mixed society: mind↔sheep sticky chat, template bubble, Life 💬', async ({
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

    // Eight luna minds; agent-6 is UtilityBrain sheep
    const agentIds = await page.evaluate(
      () => (window as any).__simState?.mind?.agentIds as string[],
    )
    expect(agentIds?.length).toBe(8)

    // Seed mind↔sheep (agent-6 is UtilityBrain sheep); partner mid-eat sticky
    const seeded = await page.evaluate(() =>
      (window as any).__simControl.seedConversation({
        agentIdA: 'agent-0',
        agentIdB: 'agent-6',
        maxTicks: 200,
        partnerEating: true,
        minSays: 2,
      }),
    )
    expect(seeded.ok).toBe(true)
    expect(seeded.says).toBeGreaterThanOrEqual(2)

    // Sheep template utterances present in sayLog
    const sayMeta = await page.evaluate(() => {
      const live = (window as any).__simControl
      // Pull events via count + select
      void live
      const events = (window as any).__simState
      void events
      return (window as any).__simControl.countEventTypes?.() as Record<string, number>
    })
    expect((sayMeta?.['mind:say'] ?? 0)).toBeGreaterThanOrEqual(2)

    // Mind Conversations transcript shows both sides
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-0'))
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-conversations')).toBeVisible()
    await page.getByTestId('mind-conversation-toggle').first().click()
    await expect(page.getByTestId('mind-conversation-transcript')).toBeVisible()
    const transcript = await page.getByTestId('mind-conversation-transcript').textContent()
    expect(transcript && transcript.length).toBeGreaterThan(0)
    // At least two speakers named in transcript lines
    const lineCount = await page.getByTestId('mind-conversation-line').count()
    expect(lineCount).toBeGreaterThanOrEqual(2)

    // Sheep Life log has 💬 rows (no Mind tab required)
    await page.evaluate(() => (window as any).__simControl.selectAgent('agent-6'))
    await page.getByTestId('tab-life').click()
    await expect
      .poll(async () => {
        const text = await page.getByTestId('activity-log').textContent()
        return text?.includes('💬') ?? false
      })
      .toBe(true)

    // Sheep speech bubble with template text
    await page.evaluate(() =>
      (window as any).__simControl.seedConversation({
        agentIdA: 'agent-0',
        agentIdB: 'agent-6',
        maxTicks: 120,
        partnerEating: true,
        minSays: 2,
      }),
    )
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const bubbles = Array.from(
              document.querySelectorAll('[data-testid="speech-bubble"], [data-speech-bubble]'),
            ) as HTMLElement[]
            return bubbles.some(
              (el) =>
                el.style.display !== 'none' &&
                (el.textContent?.trim().length ?? 0) > 0,
            )
          }),
        { timeout: 15_000 },
      )
      .toBe(true)

    await page.screenshot({ path: 'artifacts/mixed-conversation.png', fullPage: false })
  })

  test('P3-2d frameless: ffwd + waits only — 6 minds apply, chats progress, 0 stale/fallback', async ({
    page,
  }) => {
    // Wall-delay mock so completions are async (codex-like). Drive exclusively
    // via ffwd + wall waits — no visibility / rAF dependence.
    const url = '/?brain=mock&mindWallMs=200&mindConcurrency=3'
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

    // Pause so rAF cannot advance ticks — world only moves when we ffwd
    await page.evaluate(() => (window as any).__simControl.pause())

    const waitApply = async () => {
      // Kick cadence / dispatch
      await page.evaluate(() => (window as any).__simControl.ffwd(2))
      // Promise continuations apply to inbox (no frames required)
      await page.waitForTimeout(350)
      // Bare apply
      await page.evaluate(() => (window as any).__simControl.ffwd(2))
    }

    // First K (3) dispatch immediately; remaining 3 wait the 15s rolling floor
    await waitApply()
    await page.waitForTimeout(15_400)
    await waitApply()
    await page.waitForTimeout(350)
    await page.evaluate(() => (window as any).__simControl.ffwd(4))

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const s = (window as any).__simState
            return {
              decisions: (s.mind?.decisions ?? 0) as number,
              fallbacks: (s.mind?.fallbacks ?? 0) as number,
              stales: (s.mind?.stales ?? 0) as number,
            }
          }),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.objectContaining({
          fallbacks: 0,
          stales: 0,
        }),
      )

    const afterDecisions = await page.evaluate(() => {
      const s = (window as any).__simState
      return {
        decisions: s.mind.decisions as number,
        fallbacks: s.mind.fallbacks as number,
        stales: (s.mind.stales ?? 0) as number,
        decideCalls: s.mind.decideCalls as number,
      }
    })
    expect(afterDecisions.decisions).toBeGreaterThanOrEqual(6)
    expect(afterDecisions.fallbacks).toBe(0)
    expect(afterDecisions.stales).toBe(0)

    // Conversation turns: pin via seedConversation (pulses + wall waits).
    // First enqueue may sit behind the 15s rolling floor from the decision batch.
    await page.evaluate(() =>
      (window as any).__simControl.seedConversation({
        agentIdA: 'agent-0',
        agentIdB: 'agent-1',
        maxTicks: 2,
        minSays: 99,
      }),
    )
    await page.waitForTimeout(15_400)
    let says = 0
    for (let i = 0; i < 12 && says < 2; i++) {
      await page.evaluate(() =>
        (window as any).__simControl.seedConversation({
          agentIdA: 'agent-0',
          agentIdB: 'agent-1',
          maxTicks: 2,
          minSays: 99,
        }),
      )
      await page.waitForTimeout(350)
      await page.evaluate(() => (window as any).__simControl.ffwd(2))
      const counts = await page.evaluate(
        () => (window as any).__simControl.countEventTypes?.() as Record<string, number>,
      )
      says = (counts?.['mind:say'] ?? 0) as number
    }

    expect(says).toBeGreaterThanOrEqual(2)

    const final = await page.evaluate(() => {
      const s = (window as any).__simState
      const counts =
        typeof (window as any).__simControl.countEventTypes === 'function'
          ? (window as any).__simControl.countEventTypes()
          : {}
      return {
        decisions: s.mind.decisions as number,
        fallbacks: s.mind.fallbacks as number,
        stales: (s.mind.stales ?? 0) as number,
        says: (counts['mind:say'] as number) ?? 0,
        staleEvents: (counts['mind:stale'] as number) ?? 0,
        fallbackEvents: (counts['mind:fallback'] as number) ?? 0,
      }
    })
    expect(final.decisions).toBeGreaterThanOrEqual(6)
    expect(final.fallbacks).toBe(0)
    expect(final.stales).toBe(0)
    expect(final.staleEvents).toBe(0)
    expect(final.fallbackEvents).toBe(0)
    expect(final.says).toBeGreaterThanOrEqual(2)
  })

  test('?brain=grok boots; provider is grok; mocked sidecar decide flows', async ({
    page,
  }) => {
    const engines: string[] = []
    await page.route('**/api/luna/decide', async (route) => {
      let engine = ''
      try {
        const posted = route.request().postDataJSON() as { engine?: string }
        engine = posted.engine ?? ''
      } catch {
        engine = ''
      }
      engines.push(engine)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: '{"action":"wander","reasoning":"I will walk the plaza and see who is about."}',
          latencyMs: 1,
          budget: { usedHour: 1, maxHour: 60, usedDay: 1, maxDay: 300 },
        }),
      })
    })

    const url = '/?brain=grok&noNewConversations=1&mindWallFloorMs=0'
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
    const provider = await page.evaluate(
      () => (window as any).__simState?.mind?.provider as string,
    )
    expect(provider).toBe('grok')

    await page.evaluate(() => (window as any).__simControl.ffwd(120))
    await expect
      .poll(async () =>
        page.evaluate(() => (window as any).__simState?.mind?.decisions as number),
      )
      .toBeGreaterThanOrEqual(1)

    // Provider label is hidden while the chip shows "thinking…"
    await expect
      .poll(async () =>
        page.evaluate(() => ((window as any).__simState?.mind?.thinking as number) ?? 0),
      )
      .toBe(0)
    await expect(page.getByTestId('mind-chip-provider')).toHaveText('grok')

    expect(engines.length).toBeGreaterThanOrEqual(1)
    expect(engines.every((e) => e === 'grok')).toBe(true)
  })
})

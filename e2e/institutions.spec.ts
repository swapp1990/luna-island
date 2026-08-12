import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ARTIFACTS = path.join(process.cwd(), 'artifacts')

test.describe.serial('institutions (P3-4)', () => {
  test('propose → board → sheep vote → pass → rule → sanction in Life logs; replay empties board', async ({
    page,
  }) => {
    await page.goto('/?brain=mock')
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __simState?: { ready?: boolean } }).__simState?.ready === true))
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
      .poll(async () => page.evaluate(() => (window as unknown as { __simState?: { ready?: boolean } }).__simState?.ready === true))
      .toBe(true)

    await page.evaluate(() => {
      const c = (window as unknown as { __simControl: { pause: () => void } }).__simControl
      c.pause()
    })

    // Seed electorate sympathy toward Nook (agent-8) so sheep vote yes
    await page.evaluate(() => {
      const w = window as unknown as {
        __simState: { agentIds: string[] }
        __simControl: {
          setSympathy?: (a: string, b: string, v: number) => void
          ensureWallet?: (a: string, n: number) => boolean
        }
      }
      const luna = new Set(['agent-0', 'agent-1', 'agent-2', 'agent-4', 'agent-8', 'agent-11'])
      for (const id of w.__simState.agentIds) {
        if (luna.has(id)) continue
        w.__simControl.setSympathy?.(id, 'agent-8', 0.3)
      }
      w.__simControl.ensureWallet?.('agent-8', 2)
      w.__simControl.ensureWallet?.('agent-11', 1)
    })

    await page.evaluate(() => {
      const w = window as unknown as {
        __simControl: {
          postIntent?: (
            agentId: string,
            intent: Record<string, unknown>,
            reasoning?: string,
          ) => boolean
        }
      }
      w.__simControl.postIntent?.(
        'agent-8',
        {
          kind: 'propose',
          text: 'Share tools at the plaza after work',
          reason: 'I will post this for the village.',
        },
        'I will post this for the village.',
      )
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (window as unknown as { __simControl: { countEventTypes?: () => Record<string, number> } })
            .__simControl
          return c.countEventTypes?.()['institution:proposed'] ?? 0
        }),
      )
      .toBeGreaterThanOrEqual(1)

    await page.getByTestId('town-board-toggle').click()
    await expect(page.getByTestId('town-board')).toBeVisible()
    await expect(page.getByTestId('town-board-proposal')).toBeVisible()
    await expect(page.getByTestId('town-board-tally')).toContainText('yes')
    await expect(page.getByTestId('town-board')).toContainText('Share tools at the plaza')

    // Advance to Day 1 18:00 so the sheep electorate votes
    await page.evaluate(() => {
      const w = window as unknown as {
        __simState: { tick: number }
        __simControl: { ffwd: (n: number) => void }
      }
      const target = 720
      const n = Math.max(0, target - w.__simState.tick)
      if (n > 0) w.__simControl.ffwd(n)
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (window as unknown as { __simControl: { countEventTypes?: () => Record<string, number> } })
            .__simControl
          return c.countEventTypes?.()['institution:voted'] ?? 0
        }),
      )
      .toBeGreaterThanOrEqual(8)

    await expect(page.getByTestId('town-board-tally')).toContainText(/yes 1[0-9]/)
    await expect(page.getByTestId('town-board-proposal')).toBeVisible()

    fs.mkdirSync(ARTIFACTS, { recursive: true })
    await page.screenshot({
      path: path.join(ARTIFACTS, 'town-board.png'),
      fullPage: true,
    })

    // Close window: createdTick+1440 (applied on the postIntent step)
    await page.evaluate(() => {
      const w = window as unknown as {
        __simState: { tick: number }
        __simControl: { ffwd: (n: number) => void }
      }
      const target = 1441
      const n = Math.max(0, target - w.__simState.tick)
      if (n > 0) w.__simControl.ffwd(n)
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (window as unknown as { __simControl: { countEventTypes?: () => Record<string, number> } })
            .__simControl
          return c.countEventTypes?.()['institution:closed'] ?? 0
        }),
      )
      .toBeGreaterThanOrEqual(1)

    await expect(page.getByTestId('town-board-rule')).toBeVisible()
    await expect(page.getByTestId('town-board-rules')).toContainText('Share tools at the plaza')
    await expect(page.getByTestId('town-board')).toContainText('No open proposals')

    // Wren sanctions Ode (mock mind intent)
    await page.evaluate(() => {
      const w = window as unknown as {
        __simControl: {
          postIntent?: (
            agentId: string,
            intent: Record<string, unknown>,
            reasoning?: string,
          ) => boolean
        }
      }
      w.__simControl.postIntent?.(
        'agent-11',
        {
          kind: 'sanction',
          targetAgentId: 'agent-4',
          text: 'Spoke over the proposal',
          reason: 'I will censure Ode for interrupting.',
        },
        'I will censure Ode for interrupting.',
      )
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (window as unknown as { __simControl: { countEventTypes?: () => Record<string, number> } })
            .__simControl
          return c.countEventTypes?.()['institution:sanctioned'] ?? 0
        }),
      )
      .toBeGreaterThanOrEqual(1)

    await expect(page.getByTestId('town-board-sanction')).toContainText('Spoke over the proposal')

    // Censure in both Life logs
    await page.evaluate(() =>
      (window as unknown as { __simControl: { selectAgent: (id: string) => void } }).__simControl.selectAgent(
        'agent-11',
      ),
    )
    await expect(page.getByTestId('inspector')).toBeVisible()
    await page.getByTestId('tab-life').click()
    await expect(page.getByTestId('activity-log')).toContainText('sanctioned')
    await expect(page.getByTestId('activity-log')).toContainText('Spoke over the proposal')

    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-timeline')).toContainText('censure Ode')

    await page.evaluate(() =>
      (window as unknown as { __simControl: { selectAgent: (id: string) => void } }).__simControl.selectAgent(
        'agent-4',
      ),
    )
    await page.getByTestId('tab-life').click()
    await expect(page.getByTestId('activity-log')).toContainText('Spoke over the proposal')

    // Replay: load Day 1 (scrubber is day-scoped) then sit at tick 0 — board empty
    await page.evaluate(() => {
      const c = window as unknown as {
        __simControl: { loadDay: (d: number) => void; scrubTo: (n: number) => void }
      }
      c.__simControl.loadDay(1)
      c.__simControl.scrubTo(0)
    })

    await expect(page.getByTestId('town-board')).toBeVisible()
    await expect(page.getByTestId('town-board-proposal')).toHaveCount(0)
    await expect(page.getByTestId('town-board')).toContainText('No open proposals')
    await expect(page.getByTestId('town-board')).toContainText('No posted rules')
  })
})

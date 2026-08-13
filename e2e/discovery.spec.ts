import { test, expect } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ARTIFACTS = path.join(process.cwd(), 'artifacts')

test.describe.serial('discovery layer (P3-6)', () => {
  test('examine board → Known + memory; unfamiliar tag; ground-sleep felt; screenshot', async ({
    page,
  }) => {
    await page.goto('/?brain=mock')
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __simState?: { ready?: boolean } }).__simState?.ready === true,
        ),
      )
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
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __simState?: { ready?: boolean } }).__simState?.ready === true,
        ),
      )
      .toBe(true)

    await page.evaluate(() => {
      const c = (window as unknown as { __simControl: { pause: () => void } }).__simControl
      c.pause()
    })

    const counts = await page.evaluate(() => {
      const s = (window as unknown as { __simState: { placeCounts?: Record<string, number> } })
        .__simState
      return s.placeCounts ?? {}
    })
    expect(counts['notice-board']).toBeGreaterThanOrEqual(1)

    // First mind decide so last-exchange exists
    await page.evaluate(() => {
      const w = window as unknown as {
        __simControl: { ffwd: (n: number) => void }
      }
      w.__simControl.ffwd(120)
    })
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            ((window as unknown as { __simState: { mind?: { decisions?: number } } }).__simState
              .mind?.decisions ?? 0) >= 1,
        ),
      )
      .toBe(true)

    await page.evaluate(() =>
      (window as unknown as { __simControl: { selectAgent: (id: string) => void } }).__simControl
        .selectAgent('agent-0'),
    )
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-tab')).toBeVisible()
    await page.getByTestId('mind-exchange-toggle').click()
    const exchange1 = await page.getByTestId('mind-last-exchange').textContent()
    expect(exchange1).toContain('(unfamiliar)')

    // Seed examine of the notice board
    await page.evaluate(() => {
      const w = window as unknown as {
        __simControl: {
          postIntent?: (
            agentId: string,
            intent: Record<string, unknown>,
            reasoning?: string,
          ) => boolean
          ffwd: (n: number) => void
        }
      }
      w.__simControl.postIntent?.(
        'agent-0',
        {
          kind: 'examine',
          targetPlaceId: 'notice-board-0',
          reason: 'I will look at that wooden post.',
        },
        'I will look at that wooden post.',
      )
      w.__simControl.ffwd(80)
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = (
            window as unknown as {
              __simControl: { countEventTypes?: () => Record<string, number> }
            }
          ).__simControl
          return c.countEventTypes?.()['discovery:examined'] ?? 0
        }),
      )
      .toBeGreaterThanOrEqual(1)

    // Another decide so Known lands in last-exchange
    await page.evaluate(() => {
      ;(window as unknown as { __simControl: { ffwd: (n: number) => void } }).__simControl.ffwd(50)
    })

    await page.evaluate(() =>
      (window as unknown as { __simControl: { selectAgent: (id: string) => void } }).__simControl
        .selectAgent('agent-0'),
    )
    await page.getByTestId('tab-mind').click()
    await expect(page.getByTestId('mind-known')).toBeVisible()
    const knownText = await page.getByTestId('mind-known').textContent()
    expect(knownText && /propose|vote|sanction|claim|board/i.test(knownText)).toBe(true)
    const memories = await page.getByTestId('mind-memories').textContent()
    expect(memories).toMatch(/examined the notice board/i)

    // Ground sleep → lesser restore felt line
    await page.evaluate(() => {
      const w = window as unknown as {
        __simControl: {
          setNeeds?: (id: string, n: { energy?: number }) => boolean
          postIntent?: (
            agentId: string,
            intent: Record<string, unknown>,
            reasoning?: string,
          ) => boolean
          ffwd: (n: number) => void
        }
      }
      w.__simControl.setNeeds?.('agent-0', { energy: 0.88 })
      w.__simControl.postIntent?.(
        'agent-0',
        { kind: 'sleep', reason: 'I will rest right here on the dirt.' },
        'I will rest right here on the dirt.',
      )
      w.__simControl.ffwd(90)
    })

    const felt = await page.evaluate(() => {
      const c = (
        window as unknown as { __simControl: { countEventTypes?: () => Record<string, number> } }
      ).__simControl
      void c
      const live = (
        window as unknown as {
          __simControl: { exportStoryJson?: () => string }
        }
      ).__simControl
      void live
      const events = (
        window as unknown as {
          __simControl: { countEventTypes?: () => Record<string, number> }
        }
      ).__simControl
      void events
      return (
        window as unknown as {
          __simControl: { exportWorldJson: () => string }
        }
      ).__simControl.exportWorldJson()
    })
    expect(felt).toContain('slept on the ground')

    // Screenshot: board selected, building panel open
    await page.evaluate(() => {
      ;(
        window as unknown as { __simControl: { selectPlace: (id: string | null) => void } }
      ).__simControl.selectPlace('notice-board-0')
    })
    await expect(page.getByTestId('building-panel')).toBeVisible()
    await expect(page.getByTestId('building-civic')).toBeVisible()

    fs.mkdirSync(ARTIFACTS, { recursive: true })
    await page.screenshot({
      path: path.join(ARTIFACTS, 'discovery-board.png'),
      fullPage: true,
    })
  })
})

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()
const ART = path.join(ROOT, 'artifacts', 'lineage')
const SHOTS = path.join(ROOT, 'artifacts', 'lineage-site', 'shots')

function hasAnyRun(): boolean {
  try {
    return fs.readdirSync(ART).some((name) => {
      if (name === 'probes') return false
      return fs.existsSync(path.join(ART, name, 'summary.json'))
    })
  } catch {
    return false
  }
}

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true })
  if (hasAnyRun()) return
  execFileSync(
    process.execPath,
    ['scripts/lineage-run.mjs', '--brain', 'mock', '--seasons', '2', '--seed', '42'],
    { cwd: ROOT, stdio: 'inherit', timeout: 300_000 },
  )
})

async function mockRunId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/lineage/runs')
  expect(res.ok()).toBeTruthy()
  const runs = (await res.json()) as Array<{ id: string; tag: string | null; hasDecisions: boolean }>
  const mock =
    runs.find((r) => r.tag === 'mock' && r.hasDecisions) ??
    runs.find((r) => r.id.startsWith('mock-')) ??
    runs[0]
  expect(mock, 'at least one lineage run').toBeTruthy()
  return mock!.id
}

function lineage(page: Page) {
  return page.evaluate(() => (window as unknown as { __lineage: { ready: boolean; turn: number; turnCount: number; view: string; villagerId: string | null } }).__lineage)
}

type LineageControl = {
  pause(): void
  seek(n: number): void
  step(n: number): void
  setView(n: string): void
}

async function seekLast(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lineage: { turnCount: number }; __lineageControl: LineageControl }
    w.__lineageControl.pause()
    w.__lineageControl.seek(Math.max(0, w.__lineage.turnCount - 1))
  })
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x + 0.5 ||
    b.x + b.width <= a.x + 0.5 ||
    a.y + a.height <= b.y + 0.5 ||
    b.y + b.height <= a.y + 0.5
  )
}

async function measureSparks(page: Page) {
  return page.evaluate(() => {
    const svgs = [...document.querySelectorAll('[data-testid="spark-svg"]')]
    return svgs.map((svg) => {
      const path = svg.querySelector('path, polyline') as SVGGeometryElement | null
      const len = path && 'getTotalLength' in path ? path.getTotalLength() : 0
      const r = svg.getBoundingClientRect()
      return { len, w: r.width, h: r.height, d: path?.getAttribute('d') ?? '' }
    })
  })
}

async function measureTree(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="family-tree"]')
    const panel = document.querySelector('[data-testid="bloodlines"]')
    const pills = document.querySelectorAll('[data-testid="tree-pill"]').length
    const edges = document.querySelectorAll('[data-testid="tree-edge"]').length
    const founders = document.querySelectorAll('[data-testid="tree-pill"][data-founder="1"]').length
    const born = Number(svg?.getAttribute('data-born') ?? 0)
    const sr = svg?.getBoundingClientRect()
    const pr = panel?.getBoundingClientRect()
    return {
      pills,
      edges,
      founders,
      born,
      svgRight: sr?.right ?? 0,
      svgWidth: sr?.width ?? 0,
      svgHeight: sr?.height ?? 0,
      panelRight: pr?.right ?? 0,
    }
  })
}

async function measureHeat(page: Page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="heat-h"]')]
    const vw = window.innerWidth
    const vh = window.innerHeight
    return cells.map((el) => {
      const r = el.getBoundingClientRect()
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        visible: r.width > 0 && r.right <= vw + 1 && r.left >= -1 && r.bottom > 0 && r.top < vh,
      }
    })
  })
}

async function waitReady(page: Page) {
  await expect
    .poll(async () => (await lineage(page))?.ready === true, { timeout: 30_000 })
    .toBe(true)
}

test.describe.serial('lineage showcase', () => {
  test('index lists at least one run and the Probes section', async ({ page }) => {
    await page.goto('/lineage')
    await expect(
      page.getByRole('heading', { name: /Luna Island · Lineage — experiments in heritable minds/ }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Probes' })).toBeVisible()
  })

  test('autoplay at 64× advances ≥ 40 turns within 3s and the status strip changes', async ({
    page,
    request,
  }) => {
    const id = await mockRunId(request)
    await page.goto(`/lineage?run=${encodeURIComponent(id)}&autoplay=1&speed=64`)
    await waitReady(page)
    const start = (await lineage(page)).turn
    const status0 = await page.getByTestId('status-strip').innerText()
    await expect
      .poll(async () => (await lineage(page)).turn, { timeout: 3000 })
      .toBeGreaterThanOrEqual(start + 40)
    const status1 = await page.getByTestId('status-strip').innerText()
    expect(status1).not.toBe(status0)
  })

  test('seek(0) then step(1) moves exactly one turn', async ({ page, request }) => {
    const id = await mockRunId(request)
    await page.goto(`/lineage?run=${encodeURIComponent(id)}`)
    await waitReady(page)
    await page.evaluate(() => {
      const c = (window as unknown as { __lineageControl: { pause(): void; seek(n: number): void; step(n: number): void } }).__lineageControl
      c.pause()
      c.seek(0)
      c.step(1)
    })
    await expect.poll(async () => (await lineage(page)).turn).toBe(1)
  })

  test('opening a villager shows the name and a GENOME block', async ({ page, request }) => {
    const id = await mockRunId(request)
    await page.goto(`/lineage?run=${encodeURIComponent(id)}&view=card`)
    await waitReady(page)
    await page.evaluate(() => {
      ;(window as unknown as { __lineageControl: { setView(n: string): void } }).__lineageControl.setView('card')
    })
    const card = page.locator('.villager-card')
    await expect(card).toContainText('GENOME')
    const name = (await card.locator('h2').innerText()).trim()
    expect(name.length).toBeGreaterThan(2)
  })

  test('four viewports: column count, no page scroll, screenshots', async ({ page, request }) => {
    const id = await mockRunId(request)
    const cases: { w: number; h: number; layout: 'single' | 'two' | 'three' | 'four' }[] = [
      { w: 390, h: 844, layout: 'single' },
      { w: 1280, h: 800, layout: 'two' },
      { w: 1920, h: 1080, layout: 'three' },
      { w: 3440, h: 1440, layout: 'four' },
    ]
    for (const c of cases) {
      await page.setViewportSize({ width: c.w, height: c.h })
      await page.goto(`/lineage?run=${encodeURIComponent(id)}`)
      await waitReady(page)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.getElementById('lineage-root')?.getAttribute('data-layout') ??
              document.querySelector('[data-layout]')?.getAttribute('data-layout'),
          ),
        )
        .toBe(c.layout)
      const box = await page.evaluate(() => ({
        layout:
          document.getElementById('lineage-root')?.getAttribute('data-layout') ??
          document.querySelector('[data-layout]')?.getAttribute('data-layout'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(box.layout, `${c.w}x${c.h}`).toBe(c.layout)
      expect(box.scrollWidth, `${c.w}x${c.h} scrollWidth`).toBeLessThanOrEqual(box.innerWidth)

      if (c.layout === 'single' || c.layout === 'two' || c.layout === 'three' || c.layout === 'four') {
        if (c.layout === 'single') {
          await page.evaluate(() => {
            ;(window as unknown as { __lineageControl: LineageControl }).__lineageControl.setView('feed')
          })
          await expect.poll(async () => (await lineage(page)).view).toBe('feed')
        }
        const chip = page.getByTestId('turn-chip')
        const firstEntry = page.locator('.panel-feed .feed-entry').first()
        await page.locator('.panel-feed .feed').evaluate((el) => {
          el.scrollTop = 0
        })
        await expect(chip).toBeVisible()
        await expect(firstEntry).toBeVisible()
        const chipBox = await chip.boundingBox()
        const entryBox = await firstEntry.boundingBox()
        expect(chipBox, `${c.w} chip box`).toBeTruthy()
        expect(entryBox, `${c.w} first feed entry`).toBeTruthy()
        expect(boxesOverlap(chipBox!, entryBox!), `${c.w} turn chip vs first feed card`).toBe(false)
      }

      if (c.layout === 'single') {
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-feed.png`) })
        await page.evaluate(() => {
          ;(window as unknown as { __lineageControl: LineageControl }).__lineageControl.setView('card')
        })
        await expect.poll(async () => (await lineage(page)).view).toBe('card')
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-card.png`) })
        await page.evaluate(() => {
          ;(window as unknown as { __lineageControl: LineageControl }).__lineageControl.setView('analysis')
        })
        await expect.poll(async () => (await lineage(page)).view).toBe('analysis')
        const expr = page.getByTestId('expr-scroll')
        await expect(expr).toBeVisible()
        const scroll = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          table: (document.querySelector('[data-testid="expr-scroll"]') as HTMLElement | null)?.scrollWidth ?? 0,
          tableClient: (document.querySelector('[data-testid="expr-scroll"]') as HTMLElement | null)?.clientWidth ?? 0,
        }))
        expect(scroll.page, `${c.w} page scrollWidth`).toBe(scroll.inner)
        expect(scroll.table, `${c.w} expr table scrolls internally`).toBeGreaterThan(scroll.tableClient)
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-analysis.png`) })
        await page.evaluate(() => {
          ;(window as unknown as { __lineageControl: LineageControl }).__lineageControl.setView('bloodlines')
        })
        await expect.poll(async () => (await lineage(page)).view).toBe('bloodlines')
      }

      await seekLast(page)
      if (c.layout === 'single') {
        await page.evaluate(() => {
          ;(window as unknown as { __lineageControl: LineageControl }).__lineageControl.setView('bloodlines')
        })
        await expect.poll(async () => (await lineage(page)).view).toBe('bloodlines')
      }

      await expect
        .poll(async () => {
          const sparks = await measureSparks(page)
          return sparks.length === 4 && sparks.every((s) => s.len > 0 && s.w >= 60 && s.h >= 20)
        }, { timeout: 10_000 })
        .toBe(true)
      const sparks = await measureSparks(page)
      expect(sparks, `${c.w} spark count`).toHaveLength(4)

      await expect
        .poll(async () => {
          const tree = await measureTree(page)
          return tree.pills > 0 && tree.svgWidth > 0 && tree.svgRight <= tree.panelRight + 1
        }, { timeout: 10_000 })
        .toBe(true)
      const tree = await measureTree(page)
      expect(tree.pills, `${c.w} pills === born`).toBe(tree.born)
      expect(tree.edges, `${c.w} edges === 2 × non-founders`).toBe(2 * (tree.pills - tree.founders))
      expect(tree.svgRight, `${c.w} tree vs panel`).toBeLessThanOrEqual(tree.panelRight + 1)

      if (c.w === 390) {
        await page.getByTestId('heat-h').first().scrollIntoViewIfNeeded()
        const heat = await measureHeat(page)
        expect(heat, '12 heatmap headers').toHaveLength(12)
        expect(
          heat.filter((h) => h.visible).length,
          '12 heatmap headers visible in viewport',
        ).toBe(12)
      }

      const s1b = { viewport: { w: c.w, h: c.h }, layout: box.layout, scrollWidth: box.scrollWidth, innerWidth: box.innerWidth, sparks, tree }
      fs.writeFileSync(
        path.join(SHOTS, `${c.w}x${c.h}-metrics.json`),
        JSON.stringify(s1b, null, 2),
      )

      if (c.layout === 'single') {
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-bloodlines.png`) })
        await page.getByTestId('family-tree').scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-tree.png`) })
      } else {
        await page.screenshot({ path: path.join(SHOTS, `${c.w}x${c.h}-composite.png`) })
      }
      if (c.w === 3440) {
        await page.getByTestId('bloodlines').screenshot({
          path: path.join(SHOTS, '3440x1440-bloodlines.png'),
        })
      }
    }
  })
})

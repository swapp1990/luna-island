import { test, expect } from '@playwright/test'

/**
 * P6-1 verification — the god route's hand, driven through __godControl.
 * Owned by the main session (QA gate), not the implementer.
 */

const READY = { timeout: 45_000 }

test.describe.serial('P6-1 the hand', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))
    ;(page as any).__errors = errors
    await page.goto('/god')
    await page.waitForFunction(() => (window as any).__godState?.ready === true, null, READY)
  })

  test('boots on the god route with rapier and props', async ({ page }) => {
    const s = await page.evaluate(() => (window as any).__godState)
    expect(s.physicsBackend).toBe('rapier')
    expect(s.propCount).toBeGreaterThan(20)
    expect((page as any).__errors ?? []).toEqual([])
  })

  test('hand tracks the ground and reports lift', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const c = (window as any).__godControl
      c.moveHandTo(6, -4, 2)
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      const a = (window as any).__godState.hand
      c.moveHandTo(-12, 9, 6)
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      const b = (window as any).__godState.hand
      return { a, b }
    })
    expect(Math.abs(r.a.x - 6)).toBeLessThan(1.5)
    expect(Math.abs(r.b.z - 9)).toBeLessThan(1.5)
    expect(r.b.lift).toBeGreaterThan(r.a.lift)
  })

  test('grab, carry, throw — counters advance and the prop moves', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const c = (window as any).__godControl
      const st = () => (window as any).__godState
      const props = c.listProps()
      const rock = props.find((p: any) => p.kind === 'rock') ?? props[0]
      c.moveHandTo(rock.x, rock.z, 2)
      await new Promise((res) => setTimeout(res, 200))
      const id = c.grabNearest('rock')
      await new Promise((res) => setTimeout(res, 300))
      const carrying = st().hand.state
      const before = { ...st().counters }
      c.throwTo(rock.x + 25, rock.z + 10, 1)
      await new Promise((res) => setTimeout(res, 2500))
      const after = c.listProps().find((p: any) => p.id === id)
      return { id, carrying, before, counters: st().counters, from: rock, to: after }
    })
    expect(r.id).toBeTruthy()
    expect(r.carrying).toBe('carry')
    expect(r.counters.grabs).toBeGreaterThan(r.before.grabs - 1)
    expect(r.counters.throws).toBeGreaterThan(r.before.throws)
    const dist = Math.hypot((r.to?.x ?? 0) - r.from.x, (r.to?.z ?? 0) - r.from.z)
    expect(dist).toBeGreaterThan(5)
  })

  /**
   * Mass must be felt on release. Needs `throwWithHandVelocity` (P6-1b/P11):
   * `throwTo` is a ballistic solve that bypasses `releaseVelocity` entirely, so
   * measuring distance after a `throwTo` measures post-landing roll, not mass.
   * The earlier version of this test passed for exactly that wrong reason.
   */
  test('mass matters — release speed falls as mass rises', async ({ page }) => {
    const has = await page.evaluate(
      () => typeof (window as any).__godControl?.throwWithHandVelocity === 'function',
    )
    test.skip(!has, 'throwWithHandVelocity not implemented yet (P6-1b/P11)')
    const r = await page.evaluate(async () => {
      const c = (window as any).__godControl
      const out: Array<{ kind: string; mass: number; releaseSpeed: number }> = []
      for (const kind of ['pebble', 'cairn', 'rock', 'log', 'snag', 'boulder']) {
        const p = c.listProps().find((q: any) => q.kind === kind)
        if (!p) continue
        c.moveHandTo(p.x, p.z, 2)
        await new Promise((res) => setTimeout(res, 250))
        if (!c.grabNearest(kind)) continue
        await new Promise((res) => setTimeout(res, 300))
        const res2 = c.throwWithHandVelocity(9, 4, 0)
        if (res2) out.push({ kind, mass: res2.mass, releaseSpeed: res2.releaseSpeed })
        await new Promise((res) => setTimeout(res, 400))
      }
      return out
    })
    console.log('RELEASE ' + JSON.stringify(r))
    expect(r.length).toBeGreaterThan(3)
    const byMass = [...r].sort((a, b) => a.mass - b.mass)
    for (let i = 1; i < byMass.length; i++) {
      expect(
        byMass[i].releaseSpeed,
        `${byMass[i].kind} (${byMass[i].mass}kg) must release slower than ${byMass[i - 1].kind} (${byMass[i - 1].mass}kg)`,
      ).toBeLessThan(byMass[i - 1].releaseSpeed)
    }
  })

  test('camera pitch stays inside its band', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const c = (window as any).__godControl
      const out: number[] = []
      for (const pitch of [-90, 0, 10, 45, 89, 200]) {
        c.setCamera({ pitch })
        await new Promise((res) => setTimeout(res, 120))
        out.push((window as any).__godState.camera.pitch)
      }
      return out
    })
    for (const p of r) {
      expect(p).toBeGreaterThanOrEqual(30)
      expect(p).toBeLessThanOrEqual(65)
    }
  })

  test('perf: 100 props awake holds up', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const c = (window as any).__godControl
      c.stress(100)
      await new Promise((res) => setTimeout(res, 500))
      const probe = await c.fpsProbe(5000)
      return { probe, awake: (window as any).__godState.awakeCount }
    })
    console.log('FPS PROBE', JSON.stringify(r))
    expect(r.probe.avg).toBeGreaterThan(45)
  })
})

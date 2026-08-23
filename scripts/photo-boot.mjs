/**
 * Shared photographer boot: own vite, ?brain=off, import/scrub/screenshot.
 * Used by soak-highlights (pattern source) and day-lapse. Zero LLM calls.
 */
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

export const arg = (argv, name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}

export const pad2 = (n) => String(n).padStart(2, '0')

export const waitForServer = async (port) => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`)
      if (r.ok || r.status === 200) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite never became ready')
}

export const spawnVite = (port, log) => {
  log(`starting vite :${port} (brain=off photographer)`)
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  )
  vite.stdout.on('data', (d) => {
    const s = String(d)
    if (/error/i.test(s)) log(`vite: ${s.trim().slice(0, 200)}`)
  })
  vite.stderr.on('data', (d) => log(`vite-err: ${String(d).trim().slice(0, 200)}`))
  return vite
}

/**
 * Boot vite + chromium at ?brain=off. Caller must shutdown().
 */
export const bootPhotographer = async ({ port, log, viewport }) => {
  const vite = spawnVite(port, log)
  let browser
  const shutdown = async (code) => {
    try {
      await browser?.close()
    } catch {}
    try {
      vite.kill()
    } catch {}
    process.exit(code)
  }
  process.on('SIGINT', () => shutdown(130))
  process.on('SIGTERM', () => shutdown(143))

  await waitForServer(port)
  log('server ready; launching chromium')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: viewport ?? { width: 1920, height: 1080 },
  })
  page.on('pageerror', (e) => log(`PAGEERROR: ${String(e).slice(0, 200)}`))

  await page.goto(`http://127.0.0.1:${port}/?brain=off`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForFunction(() => window.__simState?.ready, null, {
    timeout: 60000,
  })

  const provider = await page.evaluate(
    () => window.__simState.mind?.provider ?? 'off',
  )
  if (provider === 'codex' || provider === 'grok') {
    log(`FATAL: provider is ${provider} — photographer must make zero LLM calls`)
    await shutdown(2)
  }
  log(`provider=${provider} (ok)`)

  return { browser, page, vite, shutdown, provider }
}

export const importWorld = async (page, worldJson, log) => {
  log(`importing world (${(worldJson.length / 1e6).toFixed(1)} MB)`)
  await page.evaluate(async (json) => {
    await window.__simControl.importWorldJson(json)
  }, worldJson)

  await page.waitForFunction(
    () => window.__simState?.ready === true && window.__simState.tick > 0,
    null,
    { timeout: 120000 },
  )
  await page.evaluate(() => window.__simControl.pause())

  const head = await page.evaluate(() => ({
    tick: window.__simState.tick,
    day: window.__simState.day,
    hour: window.__simState.hour,
    minute: window.__simState.minute,
    seed: window.__simState.seed,
    eventCount: window.__simState.eventCount,
    provider: window.__simState.mind?.provider,
    decideCalls: window.__simState.mind?.decideCalls ?? 0,
  }))
  if (head.provider === 'codex' || head.provider === 'grok') {
    throw new Error(`provider became ${head.provider} after import`)
  }
  log(
    `imported tick=${head.tick} day=${head.day} events=${head.eventCount} decideCalls=${head.decideCalls}`,
  )
  return head
}

export const rAF = async (page, n = 2) => {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const step = (left) => {
          if (left <= 0) resolve()
          else requestAnimationFrame(() => step(left - 1))
        }
        step(count)
      }),
    n,
  )
}

/** Paint stills onto a canvas; returns PNG base64 (no data: prefix). */
export const composeSheet = async (page, tiles, opts) => {
  const cols = opts.cols ?? Math.min(4, Math.max(1, tiles.length))
  const rows = opts.rows ?? Math.ceil(tiles.length / cols)
  const tw = opts.tileW ?? 480
  const th = opts.tileH ?? 270
  return page.evaluate(
    async ({ tileList, cols, rows, tw, th }) => {
      const canvas = document.createElement('canvas')
      canvas.width = cols * tw
      canvas.height = rows * th
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0b1026'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < tileList.length; i++) {
        const img = new Image()
        img.src = tileList[i].dataUrl
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
        })
        const c = i % cols
        const r = Math.floor(i / cols)
        ctx.drawImage(img, c * tw, r * th, tw, th)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(c * tw, r * th + th - 28, tw, 28)
        ctx.fillStyle = '#e8ecf4'
        ctx.font = '16px system-ui,sans-serif'
        ctx.fillText(tileList[i].label ?? tileList[i].file, c * tw + 10, r * th + th - 8)
      }
      const data = canvas.toDataURL('image/png')
      return data.split(',')[1]
    },
    { tileList: tiles, cols, rows, tw, th },
  )
}

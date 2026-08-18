/**
 * P3-12 portrait gate — 2×2 sheet: Luna mind + sheep, day and night.
 *
 * Usage: node scripts/shoot-portraits.mjs [--port 5182]
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const PORT = Number(arg('port', '5182'))
const OUT_DIR = path.resolve('artifacts/portraits')
const MIND_ID = 'agent-0'
const DAY_TICK = 240
const NIGHT_TICK = 1020
const SHEEP_CANDIDATES = [
  'agent-3',
  'agent-5',
  'agent-6',
  'agent-7',
  'agent-9',
  'agent-10',
  'agent-12',
  'agent-13',
  'agent-14',
  'agent-15',
]

const log = (msg) => console.log(`[portraits] ${msg}`)

fs.mkdirSync(OUT_DIR, { recursive: true })

log(`starting vite :${PORT}`)
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
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

const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`)
      if (r.ok || r.status === 200) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite never became ready')
}

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

try {
  await waitForServer()
  log('server ready; launching chromium')
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-angle=default', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => log(`PAGEERROR: ${String(e).slice(0, 200)}`))

  await page.goto(`http://127.0.0.1:${PORT}/?brain=off`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForFunction(() => window.__simState?.ready, null, { timeout: 60000 })
  await page.evaluate(() => {
    window.__simControl.newWorld?.(42)
  })
  await page.waitForFunction(
    () => window.__simState?.ready === true && window.__simState.seed === 42,
    null,
    { timeout: 60000 },
  )
  await page.evaluate(() => window.__simControl.pause())

  const shoot = async (agentId, tick, label) => {
    log(`scrub ${tick} then portrait ${label} (${agentId})`)
    await page.evaluate((t) => {
      window.__simControl.ffwd(Math.max(0, t - window.__simState.tick))
      window.__simControl.scrubTo(t)
      window.__simControl.pause()
    }, tick)
    await page.waitForFunction((t) => window.__simState.tick === t, tick, {
      timeout: 60000,
    })
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
        ),
    )
    await page.evaluate(
      ({ id, caption }) => {
        window.__simControl.selectAgent(id)
        window.__simControl.photo.enter({
          caption,
          agentId: id,
          zoom: 2.4,
          frameOnly: 'agent',
        })
      },
      { id: agentId, caption: label },
    )
    await page.waitForFunction(() => window.__simState.photoMode === true, null, {
      timeout: 10000,
    })
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const framed = await page.evaluate((id) => {
      const fn = window.__framePortrait
      return fn ? fn(id, 2.2) : null
    }, agentId)
    log(
      `  framed yaw=${framed?.yaw ?? '?'} elev=${framed?.elev ?? '?'} clear=${framed?.rescued ?? '?'} xz=${framed?.x?.toFixed?.(1) ?? '?'},${framed?.z?.toFixed?.(1) ?? '?'}`,
    )
    const file = path.join(OUT_DIR, `${label}.png`)
    await page.screenshot({ path: file, type: 'png' })
    await page.evaluate(() => window.__simControl.photo.exit())
    await page.waitForFunction(() => window.__simState.photoMode === false, null, {
      timeout: 10000,
    })
    return file
  }

  const pickSheep = async (tick) => {
    await page.evaluate((t) => {
      window.__simControl.ffwd(Math.max(0, t - window.__simState.tick))
      window.__simControl.scrubTo(t)
      window.__simControl.pause()
    }, tick)
    await page.waitForFunction((t) => window.__simState.tick === t, tick, {
      timeout: 60000,
    })
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    )
    const id = await page.evaluate((cands) => {
      const fn = window.__agentFacing
      if (!fn) return cands[0]
      for (const id of cands) {
        const f = fn(id)
        if (f && f.variant === 'sheep' && !f.hat) return id
      }
      return cands[0]
    }, SHEEP_CANDIDATES)
    log(`picked sheep ${id} at tick ${tick}`)
    return id
  }

  const tiles = []
  const sheepId = await pickSheep(DAY_TICK)
  tiles.push(await shoot(MIND_ID, DAY_TICK, 'mind-day'))
  tiles.push(await shoot(sheepId, DAY_TICK, 'sheep-day'))
  tiles.push(await shoot(MIND_ID, 870, 'mind-night'))
  tiles.push(await shoot(sheepId, NIGHT_TICK, 'sheep-night'))

  log('compositing 2×2 sheet')
  const dataUrls = tiles.map((f) => {
    const buf = fs.readFileSync(f)
    return `data:image/png;base64,${buf.toString('base64')}`
  })
  const names = {
    'agent-0': 'Mira',
    'agent-3': 'Ren',
    'agent-5': 'Pia',
    'agent-6': 'Bram',
    'agent-7': 'Sela',
    'agent-9': 'Vero',
    'agent-10': 'Ansel',
    'agent-12': 'Kiba',
    'agent-13': 'Lumo',
    'agent-14': 'Etta',
    'agent-15': 'Faro',
  }
  const sheepName = names[sheepId] ?? sheepId
  const labels = [
    'Mira · mind · day',
    `${sheepName} · sheep · day`,
    'Mira · mind · night',
    `${sheepName} · sheep · night`,
  ]
  const sheetB64 = await page.evaluate(
    async ({ urls, captions }) => {
      const tw = 960
      const th = 540
      const canvas = document.createElement('canvas')
      canvas.width = tw * 2
      canvas.height = th * 2
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0b1026'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < urls.length; i++) {
        const img = new Image()
        img.src = urls[i]
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
        })
        const c = i % 2
        const r = Math.floor(i / 2)
        ctx.drawImage(img, c * tw, r * th, tw, th)
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(c * tw, r * th + th - 28, tw, 28)
        ctx.fillStyle = '#f2f4f8'
        ctx.font = '16px system-ui,sans-serif'
        ctx.fillText(captions[i], c * tw + 12, r * th + th - 9)
      }
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { urls: dataUrls, captions: labels },
  )
  const sheetPath = path.join(OUT_DIR, 'portraits.png')
  fs.writeFileSync(sheetPath, Buffer.from(sheetB64, 'base64'))
  log(`wrote ${sheetPath}`)
  await shutdown(0)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 400)}`)
  await shutdown(1)
}

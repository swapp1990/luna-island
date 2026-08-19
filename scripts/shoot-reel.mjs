/**
 * P3-15 first-run marketing reel — record from replay, zero LLM calls.
 *
 * Usage:
 *   node scripts/shoot-reel.mjs
 *     [--world artifacts/soak-1786938450347-world.json]
 *     [--port 5191] [--only 16x9|9x16]
 *
 * Boots its own vite on a dedicated port with ?brain=off, imports the world
 * via a local file sidecar (avoids a 39 MB CDP payload), then drives the
 * approved storyboard. Playwright records the viewport; ffmpeg trims the
 * import head using a logged marker offset.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const WORLD_PATH = path.resolve(
  arg('world', path.join('artifacts', 'soak-1786938450347-world.json')),
)
const PORT = Number(arg('port', '5191'))
const FILE_PORT = PORT + 1
const ONLY = arg('only', 'both')
const ASSEMBLE_ONLY = process.argv.includes('--assemble-only')
const OUT_DIR = path.resolve('evidence-videos')
const FFMPEG = fs.existsSync('C:/Users/swapp/bin/ffmpeg.exe')
  ? 'C:/Users/swapp/bin/ffmpeg.exe'
  : fs.existsSync('C:/FFmpeg/bin/ffmpeg.exe')
    ? 'C:/FFmpeg/bin/ffmpeg.exe'
    : 'ffmpeg'
const FFPROBE = fs.existsSync('C:/Users/swapp/bin/ffprobe.exe')
  ? 'C:/Users/swapp/bin/ffprobe.exe'
  : fs.existsSync('C:/FFmpeg/bin/ffprobe.exe')
    ? 'C:/FFmpeg/bin/ffprobe.exe'
    : 'ffprobe'

/** Manifest ticks (highlights.json) — do not re-parse the 39 MB export. */
const MANIFEST = {
  wren: { tick: 148, type: 'discovery:examined' },
  bram: { tick: 966, type: 'agent:collapsed' },
  close: { tick: 1736, type: 'relationship:close' },
  ren: { tick: 3602, type: 'construction:commissioned' },
  house: { tick: 6097, type: 'construction:completed' },
}

const BOARD_TILE = { x: 27, y: 23 }
const PLAZA_TILE = { x: 25, y: 22 }
const BOARD_ID = 'notice-board-0'
/** Village-scale lookAt dist — plaza fills the frame, villagers ≥40px at 1080p. */
const SWEEP_DIST = { landscape: 9, portrait: 16 }

const CARD_OPEN = '24 villagers. 6 think with an LLM.'
const CARD_OPEN_SUB = 'Nobody wrote their behaviour.'
const CARD_PAYOFF =
  'All 24 villagers noticed this board. In five days, not one read it.'
const CARD_END = 'What happened when we changed what they could see'

const log = (msg) => {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[reel ${ts}] ${msg}`)
}

if (!fs.existsSync(WORLD_PATH)) {
  console.error(`world file not found: ${WORLD_PATH}`)
  process.exit(2)
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const runCmd = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += String(d)
    })
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err })
      else reject(new Error(`${bin} exit ${code}\n${err.slice(-800)}`))
    })
  })

// --- vite -----------------------------------------------------------------

let vite = null
if (!ASSEMBLE_ONLY) {
log(`starting vite :${PORT} (brain=off reel)`)
vite = spawn(
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
}

const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`)
      if (r.ok || r.status === 200) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('vite never became ready')
}

// Serve the world JSON over HTTP so the page can fetch it (no 39 MB CDP).
const worldStat = fs.statSync(WORLD_PATH)
let fileServer = null
if (!ASSEMBLE_ONLY) {
fileServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if ((req.url ?? '').split('?')[0] === '/world.json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', String(worldStat.size))
    fs.createReadStream(WORLD_PATH).pipe(res)
    return
  }
  res.statusCode = 404
  res.end('no')
})
await new Promise((resolve, reject) => {
  fileServer.once('error', reject)
  fileServer.listen(FILE_PORT, '127.0.0.1', resolve)
})
log(`world sidecar :${FILE_PORT}/world.json (${(worldStat.size / 1e6).toFixed(1)} MB)`)
}

let browser
const shutdown = async (code) => {
  try {
    await browser?.close()
  } catch {
    /* ignore */
  }
  try {
    vite.kill()
  } catch {
    /* ignore */
  }
  try {
    fileServer?.close()
  } catch {
    /* ignore */
  }
  process.exit(code)
}
process.on('SIGINT', () => void shutdown(130))
process.on('SIGTERM', () => void shutdown(143))

// --- page helpers ---------------------------------------------------------

const raf = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((r) => {
        const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)))
        step(k)
      }),
    n,
  )

const hideHud = (page, on) =>
  page.evaluate((hide) => {
    const root = document.getElementById('app-root')
    if (!root) return
    if (hide) root.classList.add('photo-mode')
    else if (!document.getElementById('photo-caption')) root.classList.remove('photo-mode')
  }, on)

const clearOverlays = (page) =>
  page.evaluate(() => {
    for (const id of ['reel-marker', 'reel-card', 'reel-end']) {
      document.getElementById(id)?.remove()
    }
  })

const showMarker = (page) =>
  page.evaluate(() => {
    document.getElementById('reel-marker')?.remove()
    const el = document.createElement('div')
    el.id = 'reel-marker'
    el.setAttribute('data-testid', 'reel-marker')
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:99999',
      'background:#FF2BD6',
      'color:#11000c',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font:800 72px/1 system-ui,sans-serif',
      'letter-spacing:0.12em',
      'pointer-events:none',
    ].join(';')
    el.textContent = 'REEL-MARK'
    document.body.appendChild(el)
  })

const showPayoffCard = (page, portrait) =>
  page.evaluate((isPortrait) => {
    document.getElementById('reel-card')?.remove()
    const el = document.createElement('div')
    el.id = 'reel-card'
    el.setAttribute('data-testid', 'reel-payoff-card')
    el.setAttribute('data-reel-beat', '8')
    const pad = isPortrait ? '40px 40px 64px' : '36px 48px 40px'
    const kicker = isPortrait ? '20px' : '18px'
    const body = isPortrait ? '34px' : '36px'
    el.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:80',
      'pointer-events:none',
      `padding:${pad}`,
      'background:linear-gradient(to top,rgba(8,10,18,0.94) 0%,rgba(8,10,18,0.66) 72%,transparent 100%)',
      'color:#f2f4f8',
      'font-family:system-ui,-apple-system,Segoe UI,sans-serif',
    ].join(';')
    el.innerHTML = `
      <div style="font-size:${kicker};font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:rgba(220,228,240,0.78);margin-bottom:10px;text-shadow:0 1px 6px rgba(0,0,0,0.55)">
        LUNA ISLAND — DAY 5, 20:00
      </div>
      <div style="font-size:${body};font-weight:700;letter-spacing:-0.02em;line-height:1.18;max-width:${isPortrait ? '18ch' : '22ch'};text-shadow:0 2px 14px rgba(0,0,0,0.55)">
        All 24 villagers noticed this board. In five days, not one read it.
      </div>`
    document.body.appendChild(el)
  }, portrait)

const showEndCard = (page, portrait) =>
  page.evaluate((isPortrait) => {
    document.getElementById('reel-end')?.remove()
    const el = document.createElement('div')
    el.id = 'reel-end'
    el.setAttribute('data-testid', 'reel-end-card')
    el.setAttribute('data-reel-beat', '9')
    // Same type scale as the board payoff photo card (30px kicker / 64px headline).
    // 16ch was a skinny column; match the payoff's 64px measure and go wide
    // enough for 2 lines at 1920 and at most 3 (no clip) at 1080×1920.
    const size = '64px'
    const maxW = isPortrait ? '100%' : '1040px'
    el.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:90',
      'background:#0b1026',
      'color:#f2f4f8',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'padding:64px',
      'text-align:center',
      'font-family:system-ui,-apple-system,Segoe UI,sans-serif',
      'pointer-events:none',
    ].join(';')
    el.innerHTML = `
      <div style="font-size:30px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:rgba(220,228,240,0.78);margin-bottom:22px;text-shadow:0 1px 6px rgba(0,0,0,0.55)">
        LUNA ISLAND
      </div>
      <div style="font-size:${size};font-weight:700;letter-spacing:-0.015em;line-height:1.12;max-width:${maxW};width:100%;overflow:visible;text-shadow:0 2px 14px rgba(0,0,0,0.55)">
        What happened when we changed what they could see
      </div>`
    document.body.appendChild(el)
  }, portrait)

/** Portrait photo card is 40% of 1080 = too narrow for a 2-line 64px headline. */
const fitOpenCard = (page, portrait) => {
  if (!portrait) return Promise.resolve()
  return page.evaluate(() => {
    const el = document.getElementById('photo-caption')
    if (!el) return
    // Same pixel width as the 16:9 photo / board-payoff card (40% of 1920).
    el.style.width = '768px'
    el.style.maxWidth = '92%'
    el.style.maxHeight = 'none'
    el.style.overflow = 'visible'
  })
}

const lookAt = (page, x, z, dist) =>
  page.evaluate(
    ({ x, z, dist }) => {
      window.__renderLookAt?.(x, z, dist)
    },
    { x, z, dist },
  )

const villageDist = (portrait) =>
  portrait ? SWEEP_DIST.portrait : SWEEP_DIST.landscape

const lookVillage = (page, portrait) =>
  lookAt(page, PLAZA_TILE.x, PLAZA_TILE.y, villageDist(portrait))

const refreshKicker = async (page) => {
  await page.evaluate(() => window.__simControl.photo.refresh())
  await raf(page, 1)
}

const enterSweep = async (page, portrait) => {
  const inPhoto = await page.evaluate(() => window.__simState?.photoMode === true)
  if (inPhoto) {
    const hasHeadline = await page.evaluate(
      () => !!document.querySelector('[data-testid="photo-headline"]'),
    )
    if (hasHeadline) await exitPhoto(page)
  }
  await lookVillage(page, portrait)
  await refreshKicker(page)
  await page.waitForFunction(() => window.__simState?.photoMode === true, null, {
    timeout: 10000,
  })
  await page.waitForSelector('[data-testid="photo-caption"]', { timeout: 10000 })
  await raf(page, 2)
}

const runSweep = async (page, seconds) => {
  await setSpeed(page, 64)
  const steps = Math.max(1, Math.round(seconds / 0.5))
  for (let i = 0; i < steps; i++) {
    await sleep(500)
    await refreshKicker(page)
  }
  await pauseSim(page)
  await refreshKicker(page)
}

const pauseSim = (page) => page.evaluate(() => window.__simControl.pause())

const setSpeed = (page, n) => page.evaluate((s) => window.__simControl.setSpeed(s), n)

const loadDay = (page, day) => page.evaluate((d) => window.__simControl.loadDay(d), day)

const scrubTo = async (page, tick) => {
  await page.evaluate((t) => window.__simControl.scrubTo(t), tick)
  await page.waitForFunction((t) => window.__simState?.tick === t, tick, {
    timeout: 120000,
  })
}

const exitPhoto = async (page) => {
  await page.evaluate(() => window.__simControl.photo.exit())
  await page.waitForFunction(() => window.__simState?.photoMode === false, null, {
    timeout: 10000,
  })
}

const enterPhoto = async (page, opts) => {
  await page.evaluate((o) => {
    window.__simControl.photo.enter(o)
  }, opts)
  await page.waitForFunction(() => window.__simState?.photoMode === true, null, {
    timeout: 10000,
  })
  await page.waitForSelector('[data-testid="photo-caption"]', { timeout: 10000 })
  await raf(page, 3)
}

const pickMoment = (moments, spec) => {
  const exact = moments.find((m) => m.tick === spec.tick && m.type === spec.type)
  if (exact) return exact
  const byType = moments.find((m) => m.type === spec.type)
  return byType ?? null
}

const describeVisual = (page, agentId) =>
  page.evaluate((id) => window.__simControl.describeAgentVisual?.(id) ?? null, agentId)

const findEmptyBoardTick = async (page) => {
  const candidates = [6200, 6400, 6600, 6750, 6097]
  let best = { tick: 6600, minDist: -1, near: 99 }
  for (const tick of candidates) {
    await scrubTo(page, tick)
    await raf(page, 2)
    const info = await page.evaluate(
      ({ bx, by }) => {
        const ids = window.__simState.agentIds ?? []
        let minDist = Infinity
        let near = 0
        for (const id of ids) {
          const f = window.__agentFacing?.(id)
          if (!f) continue
          const d = Math.hypot(f.x - bx, f.z - by)
          if (d < minDist) minDist = d
          if (d < 1.5) near += 1
        }
        return { minDist: Number.isFinite(minDist) ? minDist : 99, near }
      },
      { bx: BOARD_TILE.x, by: BOARD_TILE.y },
    )
    log(
      `board probe t=${tick} minDist=${info.minDist.toFixed(2)} standingNear=${info.near}`,
    )
    if (info.near === 0 && info.minDist > best.minDist) {
      best = { tick, minDist: info.minDist, near: info.near }
    } else if (best.minDist < 0 || info.near < best.near) {
      best = { tick, minDist: info.minDist, near: info.near }
    }
    if (info.near === 0 && info.minDist >= 2) break
  }
  return best
}

const pushBoard = async (page, seconds) => {
  const steps = 16
  const dt = Math.round((seconds * 1000) / steps)
  const from = 18
  const to = 7
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const dist = from + (to - from) * t
    await lookAt(page, BOARD_TILE.x, BOARD_TILE.y, dist)
    await sleep(dt)
  }
}

// --- storyboard -----------------------------------------------------------

const driveStoryboard = async (page, { portrait, label }) => {
  const beats = []
  const mark = (id, extra = {}) => {
    const rec = { id, atMs: Date.now(), ...extra }
    beats.push(rec)
    log(`${label} beat ${id} ${JSON.stringify(extra)}`)
    return rec
  }

  const provider = await page.evaluate(() => window.__simState.mind?.provider ?? 'off')
  if (provider === 'codex' || provider === 'grok') {
    throw new Error(`FATAL: provider is ${provider} — reel must make zero LLM calls`)
  }
  log(`${label} provider=${provider} (ok)`)

  const decideBefore = await page.evaluate(
    () => window.__simState.mind?.decideCalls ?? 0,
  )

  log(`${label} importing world via sidecar`)
  const importT0 = Date.now()
  await page.evaluate(async (url) => {
    const json = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`world fetch ${r.status}`)
      return r.text()
    })
    await window.__simControl.importWorldJson(json)
  }, `http://127.0.0.1:${FILE_PORT}/world.json`)
  await page.waitForFunction(
    () => window.__simState?.ready === true && window.__simState.tick > 7000,
    null,
    { timeout: 180000 },
  )
  await pauseSim(page)
  const head = await page.evaluate(() => ({
    tick: window.__simState.tick,
    day: window.__simState.day,
    seed: window.__simState.seed,
    eventCount: window.__simState.eventCount,
    provider: window.__simState.mind?.provider ?? 'off',
    decideCalls: window.__simState.mind?.decideCalls ?? 0,
  }))
  log(
    `${label} imported in ${Date.now() - importT0}ms tick=${head.tick} day=${head.day} events=${head.eventCount} decideCalls=${head.decideCalls}`,
  )
  if (head.provider === 'codex' || head.provider === 'grok') {
    throw new Error(`FATAL: provider became ${head.provider} after import`)
  }
  if (head.decideCalls !== decideBefore) {
    throw new Error(
      `FATAL: decideCalls moved during import ${decideBefore} → ${head.decideCalls}`,
    )
  }

  log(`${label} listing highlight moments`)
  const moments = await page.evaluate(
    (max) => window.__simControl.listHighlightMoments?.(max) ?? [],
    12,
  )
  log(`${label} moments=${moments.length}`)
  const wren = pickMoment(moments, MANIFEST.wren)
  const bram = pickMoment(moments, MANIFEST.bram)
  const close = pickMoment(moments, MANIFEST.close)
  const ren = pickMoment(moments, MANIFEST.ren)
  const house = pickMoment(moments, MANIFEST.house)
  for (const [name, m] of [
    ['wren', wren],
    ['bram', bram],
    ['close', close],
    ['ren', ren],
    ['house', house],
  ]) {
    if (!m) throw new Error(`missing highlight moment: ${name}`)
    log(`${label} ${name} t=${m.tick} ${m.type} — ${m.caption}`)
  }

  const board = await findEmptyBoardTick(page)
  log(
    `${label} payoff tick=${board.tick} minDist=${board.minDist.toFixed(2)} near=${board.near}`,
  )

  // Distinctive full-frame marker so ffmpeg -ss can be verified.
  const tMarker = Date.now()
  await showMarker(page)
  await sleep(500)
  await page.evaluate(() => document.getElementById('reel-marker')?.remove())
  const tReel0 = Date.now()
  mark('marker', { holdMs: 500, tMarker })

  // ---- Beat 1: cold open, village scale, dawn D1, paused + photo card
  await loadDay(page, 1)
  await scrubTo(page, 0)
  await pauseSim(page)
  await lookVillage(page, portrait)
  await raf(page, 3)
  await enterPhoto(page, { caption: CARD_OPEN, subtitle: CARD_OPEN_SUB })
  await fitOpenCard(page, portrait)
  mark('1-start', {
    intendedS: 3.0,
    tick: 0,
    speed: 0,
    caption: CARD_OPEN,
    subtitle: CARD_OPEN_SUB,
  })
  await sleep(3200)
  mark('1-end', { tick: 0 })
  await exitPhoto(page)

  // ---- Beat 2: D1 sweep 64×, kicker clock only
  await enterSweep(page, portrait)
  mark('2-start', { intendedS: 5.0, tick: 0, speed: 64 })
  await runSweep(page, 5)
  const beat2Tick = await page.evaluate(() => window.__simState.tick)
  mark('2-end', { tick: beat2Tick })

  // ---- Beat 3: Wren examines the berry bush
  await scrubTo(page, wren.tick)
  await pauseSim(page)
  await enterPhoto(page, {
    caption: wren.caption,
    subtitle: wren.subtitle,
    agentId: wren.agentIds?.[0],
    agentIds: wren.agentIds ?? [],
    placeId: wren.placeId,
    zoom: 1,
    frameOnly: 'place',
  })
  mark('3-start', {
    intendedS: 3.0,
    tick: wren.tick,
    speed: 0,
    caption: wren.caption,
    subtitle: wren.subtitle ?? null,
  })
  await sleep(3200)
  const wrenVis = wren.agentIds?.[0]
    ? await describeVisual(page, wren.agentIds[0])
    : null
  mark('3-end', { visual: wrenVis })
  await exitPhoto(page)

  // ---- Beat 4: D1 night sweep → Bram collapses
  const bramSweepFrom = Math.max(400, bram.tick - 4 * 64)
  await loadDay(page, 1)
  await scrubTo(page, bramSweepFrom)
  await enterSweep(page, portrait)
  mark('4s-start', { intendedS: 4.0, tick: bramSweepFrom, speed: 64 })
  await runSweep(page, 4)
  const beat4sTick = await page.evaluate(() => window.__simState.tick)
  mark('4s-end', { tick: beat4sTick })
  await scrubTo(page, bram.tick)
  await enterPhoto(page, {
    caption: bram.caption,
    subtitle: bram.subtitle,
    agentId: bram.agentIds?.[0],
    agentIds: bram.agentIds ?? [],
    placeId: bram.placeId,
    zoom: 1.15,
    frameOnly: 'agent',
  })
  mark('4b-start', {
    intendedS: 3.0,
    tick: bram.tick,
    speed: 0,
    caption: bram.caption,
  })
  await sleep(3200)
  const bramVis = bram.agentIds?.[0]
    ? await describeVisual(page, bram.agentIds[0])
    : null
  mark('4b-end', { visual: bramVis })
  await exitPhoto(page)

  // ---- Beat 5: D2 sweep → relationship:close (actual: Bram & Sela)
  const closeSweepFrom = Math.max(1080, close.tick - 5 * 64)
  await loadDay(page, 2)
  await scrubTo(page, closeSweepFrom)
  await enterSweep(page, portrait)
  mark('5s-start', { intendedS: 5.0, tick: closeSweepFrom, speed: 64 })
  await runSweep(page, 5)
  const beat5sTick = await page.evaluate(() => window.__simState.tick)
  mark('5s-end', { tick: beat5sTick })
  await scrubTo(page, close.tick)
  await enterPhoto(page, {
    caption: close.caption,
    subtitle: close.subtitle,
    agentId: close.agentIds?.[0],
    agentIds: close.agentIds ?? [],
    placeId: close.placeId,
    zoom: 1,
    frameOnly: 'pair',
  })
  mark('5b-start', {
    intendedS: 2.5,
    tick: close.tick,
    speed: 0,
    caption: close.caption,
  })
  // 3.0s hold so 1-fps sampling still yields ≥3 consecutive caption frames
  await sleep(3000)
  mark('5b-end')
  await exitPhoto(page)

  // ---- Beat 6: D3 sweep → Ren commissions a house
  const renSweepFrom = Math.max(2520, ren.tick - 5 * 64)
  await loadDay(page, 3)
  await scrubTo(page, renSweepFrom)
  await enterSweep(page, portrait)
  mark('6s-start', { intendedS: 5.0, tick: renSweepFrom, speed: 64 })
  await runSweep(page, 5)
  const beat6sTick = await page.evaluate(() => window.__simState.tick)
  mark('6s-end', { tick: beat6sTick })
  await scrubTo(page, ren.tick)
  await pauseSim(page)
  await enterPhoto(page, {
    caption: ren.caption,
    subtitle: ren.subtitle,
    agentId: ren.agentIds?.[0],
    agentIds: ren.agentIds ?? [],
    placeId: ren.placeId,
    zoom: 1,
    frameOnly: 'place',
  })
  mark('6b-start', {
    intendedS: 3.0,
    tick: ren.tick,
    speed: 0,
    caption: ren.caption,
  })
  await sleep(3200)
  mark('6b-end')
  await exitPhoto(page)

  // ---- Beat 7: D4–D5 sweep → house finished
  await loadDay(page, 4)
  await scrubTo(page, 4800)
  await enterSweep(page, portrait)
  mark('7s-start', { intendedS: 6.0, tick: 4800, speed: 64 })
  await runSweep(page, 2)
  const houseSweepFrom = Math.max(5400, house.tick - 4 * 64)
  await loadDay(page, 5)
  await scrubTo(page, houseSweepFrom)
  await lookVillage(page, portrait)
  await refreshKicker(page)
  await runSweep(page, 4)
  const beat7sTick = await page.evaluate(() => window.__simState.tick)
  mark('7s-end', { tick: beat7sTick })
  await scrubTo(page, house.tick)
  await enterPhoto(page, {
    caption: house.caption,
    subtitle: house.subtitle,
    agentId: house.agentIds?.[0],
    agentIds: house.agentIds ?? [],
    placeId: house.placeId,
    zoom: 1,
    frameOnly: 'place',
  })
  mark('7b-start', {
    intendedS: 3.0,
    tick: house.tick,
    speed: 0,
    caption: house.caption,
  })
  await sleep(3200)
  mark('7b-end')
  await exitPhoto(page)

  // ---- Beat 8: slow push onto notice-board, nobody near it
  await scrubTo(page, board.tick)
  await pauseSim(page)
  await hideHud(page, true)
  await lookAt(page, BOARD_TILE.x, BOARD_TILE.y, portrait ? 12 : 16)
  await raf(page, 2)
  mark('8-start', {
    intendedS: 5.0,
    tick: board.tick,
    speed: 0,
    caption: CARD_PAYOFF,
    boardMinDist: board.minDist,
    boardNear: board.near,
  })
  if (portrait) {
    // Photo hero framing is 16:9-tuned and clips the board + caption on 9:16.
    await showPayoffCard(page, true)
    await pushBoard(page, 1.5)
    await sleep(3500)
    await clearOverlays(page)
  } else {
    await pushBoard(page, 1.6)
    await enterPhoto(page, {
      caption: CARD_PAYOFF,
      placeId: BOARD_ID,
      zoom: 1.05,
      frameOnly: 'place',
    })
    await sleep(3600)
    await exitPhoto(page)
  }
  mark('8-end', { tick: board.tick })

  // ---- Beat 9: end card
  await hideHud(page, true)
  await showEndCard(page, portrait)
  mark('9-start', { intendedS: 3.0, speed: 0, caption: CARD_END })
  await sleep(3200)
  mark('9-end')
  await sleep(250)

  const decideAfter = await page.evaluate(
    () => window.__simState.mind?.decideCalls ?? 0,
  )
  if (decideAfter !== decideBefore) {
    throw new Error(`FATAL: decideCalls ${decideBefore} → ${decideAfter}`)
  }
  log(`${label} decideCalls unchanged at ${decideAfter} (zero LLM ok)`)

  return {
    tMarker,
    tReel0,
    decideCalls: { before: decideBefore, after: decideAfter },
    provider,
    head,
    moments: { wren, bram, close, ren, house },
    board,
    beats,
  }
}

const shootAspect = async ({ width, height, tag, outMp4 }) => {
  const tmpDir = path.join(OUT_DIR, `.tmp-${tag}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const portrait = height > width
  log(`launching chromium ${width}x${height} headed gpu`)
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: tmpDir, size: { width, height } },
  })
  const page = await context.newPage()
  page.setDefaultTimeout(180000)
  page.on('pageerror', (e) => log(`PAGEERROR ${tag}: ${String(e).slice(0, 240)}`))
  const tPage = Date.now()
  await page.goto(`http://127.0.0.1:${PORT}/?brain=off`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForFunction(() => window.__simState?.ready, null, { timeout: 60000 })
  await pauseSim(page)

  const story = await driveStoryboard(page, { portrait, label: tag })
  const tClose = Date.now()
  const video = page.video()
  await page.close()
  await context.close()
  const webmPath = video ? await video.path() : null
  if (!webmPath || !fs.existsSync(webmPath)) {
    throw new Error(`${tag}: no webm recorded`)
  }
  const staged = path.join(tmpDir, `${tag}.webm`)
  fs.copyFileSync(webmPath, staged)
  const offsetSec = (story.tReel0 - tPage) / 1000
  log(`${tag} raw webm=${webmPath} offset=${offsetSec.toFixed(3)}s page→reel0`)

  const rawMp4 = path.join(tmpDir, `${tag}-raw.mp4`)
  await runCmd(FFMPEG, [
    '-y',
    '-i',
    staged,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '22',
    '-an',
    rawMp4,
  ])

  // Trim import head + inter-beat dead air (probes, scrubs) so the file
  // is the storyboard holds, beginning at beat 1.
  await assembleReel(rawMp4, tPage, story.beats, outMp4)
  log(`${tag} wrote ${outMp4}`)

  // Drop intermediate webms — mp4 only in evidence-videos/.
  try {
    fs.unlinkSync(staged)
  } catch {
    /* ignore */
  }
  try {
    if (webmPath !== staged && fs.existsSync(webmPath)) fs.unlinkSync(webmPath)
  } catch {
    /* ignore */
  }

  const elapsed = tClose - tPage
  return { ...story, tPage, tClose, offsetSec, elapsedMs: elapsed, outMp4, tag }
}

/** Beat windows to keep — intended duration from each start mark (drop dead air). */
const beatWindows = (beats, originMs) => {
  const byId = Object.fromEntries(beats.map((b) => [b.id, b]))
  const rel = (id) => (byId[id].atMs - originMs) / 1000
  const intended = (id) => Number(byId[id].intendedS)
  const windows = [
    { id: '1', start: rel('1-start'), dur: intended('1-start') },
    { id: '2', start: rel('2-start'), dur: intended('2-start') },
    { id: '3', start: rel('3-start'), dur: intended('3-start') },
    { id: '4s', start: rel('4s-start'), dur: intended('4s-start') },
    { id: '4b', start: rel('4b-start'), dur: intended('4b-start') },
    { id: '5s', start: rel('5s-start'), dur: intended('5s-start') },
    { id: '5b', start: rel('5b-start'), dur: intended('5b-start') },
    { id: '6s', start: rel('6s-start'), dur: intended('6s-start') },
    { id: '6b', start: rel('6b-start'), dur: intended('6b-start') },
    { id: '7s', start: rel('7s-start'), dur: intended('7s-start') },
    { id: '7b', start: rel('7b-start'), dur: intended('7b-start') },
  ]
  // Payoff: keep the last 5s of beat 8 (caption on after the push/enter).
  const eightEnd = rel('8-end')
  const eightDur = intended('8-start')
  windows.push({ id: '8', start: Math.max(rel('8-start'), eightEnd - eightDur), dur: eightDur })
  windows.push({ id: '9', start: rel('9-start'), dur: intended('9-start') })
  return windows
}

const assembleReel = async (rawMp4, originMs, beats, outMp4) => {
  const windows = beatWindows(beats, originMs)
  const total = windows.reduce((s, w) => s + w.dur, 0)
  log(
    `assemble ${path.basename(outMp4)} ${windows.length} segs total=${total.toFixed(2)}s from ${path.basename(rawMp4)}`,
  )
  const args = ['-y']
  for (const w of windows) {
    args.push('-ss', w.start.toFixed(3), '-t', w.dur.toFixed(3), '-i', rawMp4)
  }
  const n = windows.length
  const labels = windows.map((_, i) => `[${i}:v]`).join('')
  args.push(
    '-filter_complex',
    `${labels}concat=n=${n}:v=1:a=0[v]`,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '22',
    '-an',
    outMp4,
  )
  await runCmd(FFMPEG, args)
  log(`assembled ${outMp4}`)
  return { windows, total }
}

const probeVideo = async (file) => {
  const { out } = await runCmd(FFPROBE, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration,r_frame_rate,nb_frames,codec_name',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file,
  ])
  return JSON.parse(out)
}

const buildContactSheet = async (mp4) => {
  const framesDir = path.join(OUT_DIR, '.tmp-frames')
  fs.rmSync(framesDir, { recursive: true, force: true })
  fs.mkdirSync(framesDir, { recursive: true })
  await runCmd(FFMPEG, [
    '-y',
    '-i',
    mp4,
    '-vf',
    "fps=1,scale=600:-1,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{frame_num}':x=10:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.65",
    path.join(framesDir, 'f-%03d.png'),
  ])
  const files = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
  log(`contact frames: ${files.length}`)
  const cols = 8
  const rows = Math.max(1, Math.ceil(files.length / cols))
  const need = cols * rows
  if (files.length < need) {
    const last = path.join(framesDir, files[files.length - 1])
    for (let i = files.length + 1; i <= need; i++) {
      fs.copyFileSync(last, path.join(framesDir, `f-${String(i).padStart(3, '0')}.png`))
    }
  }
  const sheet = path.join(OUT_DIR, 'reel-contact-sheet.png')
  await runCmd(FFMPEG, [
    '-y',
    '-i',
    path.join(framesDir, 'f-%03d.png'),
    '-frames:v',
    '1',
    '-vf',
    `tile=${cols}x${rows}:padding=4:margin=4:color=0x0b1026`,
    sheet,
  ])
  log(`wrote ${sheet}`)
  return { sheet, count: files.length, framesDir, files }
}

// --- main -----------------------------------------------------------------

try {
  if (ASSEMBLE_ONLY) {
    const summaryPath = path.join(OUT_DIR, 'reel-summary.json')
    const prev = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    const assembled = {}
    for (const tag of ['16x9', '9x16']) {
      if (ONLY !== 'both' && ONLY !== tag) continue
      const rawMp4 = path.join(OUT_DIR, `.tmp-${tag}`, `${tag}-raw.mp4`)
      const outMp4 = path.join(OUT_DIR, `luna-island-first-run-${tag}.mp4`)
      if (!fs.existsSync(rawMp4)) throw new Error(`missing ${rawMp4}`)
      const beats = prev.beats[tag]
      const tReel0 = beats.find((b) => b.id === 'marker').atMs
      const tPage = tReel0 - prev.offsets[tag] * 1000
      assembled[tag] = await assembleReel(rawMp4, tPage, beats, outMp4)
    }
    const probes = {}
    for (const tag of Object.keys(assembled)) {
      const outMp4 = path.join(OUT_DIR, `luna-island-first-run-${tag}.mp4`)
      probes[tag] = await probeVideo(outMp4)
      log(`${tag} probe ${JSON.stringify(probes[tag])}`)
    }
    let contact = null
    if (assembled['16x9']) {
      contact = await buildContactSheet(
        path.join(OUT_DIR, 'luna-island-first-run-16x9.mp4'),
      )
    }
    const next = {
      ...prev,
      assembled,
      probes,
      contactSheet: contact?.sheet ?? prev.contactSheet,
      contactFrames: contact?.count ?? prev.contactFrames,
    }
    fs.writeFileSync(summaryPath, JSON.stringify(next, null, 2))
    log(`wrote ${summaryPath}`)
    log('DONE assemble-only')
    await shutdown(0)
  }

  await waitForServer()
  log('server ready')
  browser = await chromium.launch({
    headless: false,
    args: [
      '--enable-webgl',
      '--use-angle=default',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-position=40,40',
    ],
  })

  const results = {}
  if (ONLY === 'both' || ONLY === '16x9') {
    results['16x9'] = await shootAspect({
      width: 1920,
      height: 1080,
      tag: '16x9',
      outMp4: path.join(OUT_DIR, 'luna-island-first-run-16x9.mp4'),
    })
  }
  if (ONLY === 'both' || ONLY === '9x16') {
    results['9x16'] = await shootAspect({
      width: 1080,
      height: 1920,
      tag: '9x16',
      outMp4: path.join(OUT_DIR, 'luna-island-first-run-9x16.mp4'),
    })
  }

  const probes = {}
  for (const [k, r] of Object.entries(results)) {
    probes[k] = await probeVideo(r.outMp4)
    log(`${k} probe ${JSON.stringify(probes[k])}`)
  }

  let contact = null
  if (results['16x9']) {
    contact = await buildContactSheet(results['16x9'].outMp4)
  }

  const summary = {
    world: WORLD_PATH,
    port: PORT,
    ffmpeg: FFMPEG,
    decideCalls: results['16x9']?.decideCalls ?? results['9x16']?.decideCalls,
    provider: results['16x9']?.provider ?? results['9x16']?.provider,
    offsets: Object.fromEntries(
      Object.entries(results).map(([k, r]) => [k, r.offsetSec]),
    ),
    board: results['16x9']?.board ?? results['9x16']?.board,
    beats: Object.fromEntries(
      Object.entries(results).map(([k, r]) => [k, r.beats]),
    ),
    probes,
    contactSheet: contact?.sheet ?? null,
    contactFrames: contact?.count ?? 0,
  }
  const summaryPath = path.join(OUT_DIR, 'reel-summary.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  log(`wrote ${summaryPath}`)
  log('DONE')
  await shutdown(0)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 800)}`)
  if (e?.stack) log(e.stack.split('\n').slice(0, 8).join(' | '))
  await shutdown(1)
}

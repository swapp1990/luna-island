/**
 * Photographer — load a world export, scrub to highlight moments, shoot stills.
 *
 * Usage:
 *   node scripts/soak-highlights.mjs <world.json>
 *     [--out artifacts/highlights/<basename>] [--max 12] [--port 5181]
 *
 * ZERO LLM calls: boots with ?brain=off and asserts provider is not codex/grok.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const worldArg = process.argv[2]
if (!worldArg || worldArg.startsWith('--')) {
  console.error(
    'Usage: node scripts/soak-highlights.mjs <world.json> [--out dir] [--max 12] [--port 5181]',
  )
  process.exit(2)
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const WORLD_PATH = path.resolve(worldArg)
const basen = path.basename(WORLD_PATH, path.extname(WORLD_PATH))
const OUT = path.resolve(arg('out', path.join('artifacts', 'highlights', basen)))
const MAX = Number(arg('max', '12'))
const PORT = Number(arg('port', '5181'))

const log = (msg) => console.log(`[highlights] ${msg}`)

if (!fs.existsSync(WORLD_PATH)) {
  console.error(`world file not found: ${WORLD_PATH}`)
  process.exit(2)
}

const worldJson = fs.readFileSync(WORLD_PATH, 'utf8')
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) {
  if (/^\d{2}-.*\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f))
}

/** Place-hero failed if the subject is missing or a hard occluder won the frame. */
const placeHeroFailed = (frame, type) => {
  if (!frame) return true
  if (frame.hits >= frame.total && frame.total > 0) return false
  const probesOk = (frame.probeHits ?? 0) >= (frame.probeTotal ?? 1)
  // Finished house already on camera — nearby villagers must not evict SE.
  if (type === 'construction:completed' && probesOk) return false
  const why = frame.why ?? []
  return why.some((w) => w.startsWith('probe') || w === 'rival' || w === 'agent')
}

log(`starting vite :${PORT} (brain=off photographer)`)
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

const pad2 = (n) => String(n).padStart(2, '0')
const typeSlug = (t) => String(t).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')

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
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  })
  page.on('pageerror', (e) => log(`PAGEERROR: ${String(e).slice(0, 200)}`))

  await page.goto(`http://127.0.0.1:${PORT}/?brain=off`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForFunction(() => window.__simState?.ready, null, {
    timeout: 60000,
  })

  // Assert no LLM provider
  const provider = await page.evaluate(() => window.__simState.mind?.provider ?? 'off')
  if (provider === 'codex' || provider === 'grok') {
    log(`FATAL: provider is ${provider} — photographer must make zero LLM calls`)
    await shutdown(2)
  }
  log(`provider=${provider} (ok)`)

  // Import world (large payload — pass via evaluate handle carefully)
  log(`importing ${WORLD_PATH} (${(worldJson.length / 1e6).toFixed(1)} MB)`)
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
    seed: window.__simState.seed,
    eventCount: window.__simState.eventCount,
    provider: window.__simState.mind?.provider,
    decideCalls: window.__simState.mind?.decideCalls ?? 0,
  }))
  log(
    `imported tick=${head.tick} day=${head.day} events=${head.eventCount} decideCalls=${head.decideCalls}`,
  )
  if (head.provider === 'codex' || head.provider === 'grok') {
    log(`FATAL: provider became ${head.provider} after import`)
    await shutdown(2)
  }

  const moments = await page.evaluate((max) => {
    return window.__simControl.listHighlightMoments?.(max) ?? []
  }, MAX)
  log(`selected ${moments.length} moments (max ${MAX})`)

  const agentNames = await page.evaluate(() => {
    // Build id→name from current world via highlight moments / agents
    // Use live export of agent list from bridge
    const ids = window.__simState.agentIds ?? []
    // names not on bridge — recover from listHighlightMoments captions is weak;
    // re-read from a tiny evaluate using events is fine via control
    return ids
  })
  void agentNames

  const shots = []
  const decideBefore = head.decideCalls

  for (let i = 0; i < moments.length; i++) {
    const m = moments[i]
    const nn = pad2(i + 1)
    try {
      log(`shot ${nn}/${moments.length}: t=${m.tick} ${m.type} — ${m.caption}`)

      await page.evaluate((tick) => {
        window.__simControl.scrubTo(tick)
      }, m.tick)

      await page.waitForFunction(
        (tick) =>
          window.__simState?.ready &&
          window.__simState.tick === tick &&
          window.__simState.mode === 'replay',
        m.tick,
        { timeout: 120000 },
      )

      // One more frame settle
      await page.evaluate(() => window.__simControl.pause())
      await page.waitForFunction(
        (tick) => window.__simState.tick === tick,
        m.tick,
        { timeout: 10000 },
      )

      const clock = await page.evaluate(() => ({
        day: window.__simState.day,
        hour: window.__simState.hour,
        minute: window.__simState.minute,
      }))

      const placeFirst = /^(construction:|discovery:examined$|ownership:transfer$)/.test(
        m.type,
      )
      const pairShot = m.type === 'relationship:close' || m.type === 'mind:say'
      let frameOnly = placeFirst ? 'place' : pairShot ? 'pair' : 'agent'
      let hero = placeFirst ? 'place' : 'agent'

      const enterPhoto = async (only) => {
        await page.evaluate((opts) => {
          window.__simControl.photo.enter(opts)
        }, {
          caption: m.caption,
          subtitle: m.subtitle,
          agentId: m.agentIds?.[0],
          agentIds: m.agentIds ?? [],
          placeId: m.placeId,
          zoom: 1,
          frameOnly: only,
        })
        await page.waitForFunction(
          () => window.__simState.photoMode === true,
          null,
          { timeout: 10000 },
        )
        await page.waitForSelector('[data-testid="photo-caption"]', {
          timeout: 10000,
        })
        await page.evaluate(
          () =>
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        )
        return page.evaluate(() => window.__photoFrame ?? null)
      }

      let frame = await enterPhoto(frameOnly)
      if (placeFirst) {
        log(
          `shot ${nn} place-hero azimuth=${frame?.azimuth ?? '?'} vis=${frame?.hits ?? '?'}/${frame?.total ?? '?'} probes=${frame?.probeHits ?? '?'}/${frame?.probeTotal ?? '?'} why=${(frame?.why ?? []).join(',') || '-'}`,
        )
      }
      if (placeFirst && placeHeroFailed(frame, m.type) && m.agentIds?.[0]) {
        frameOnly = 'agent'
        hero = 'agent'
        frame = await enterPhoto('agent')
        log(`shot ${nn} place-hero failed vis; fallback agent-hero`)
      }

      const hhmm = `${pad2(clock.hour)}${pad2(clock.minute)}`
      const file = `${nn}-${typeSlug(m.type)}-D${clock.day}-${hhmm}.png`
      const filePath = path.join(OUT, file)
      await page.screenshot({ path: filePath, type: 'png' })
      log(
        `shot ${nn} hero=${hero} azimuth=${frame?.azimuth ?? 'default'}${frame?.rescued ? ' (rescued)' : ''} elev=${frame?.elevDeg ?? '?'} vis=${frame?.hits ?? '?'}/${frame?.total ?? '?'} probes=${frame?.probeHits ?? '?'}/${frame?.probeTotal ?? '?'}`,
      )

      shots.push({
        file,
        tick: m.tick,
        day: clock.day,
        time: `${pad2(clock.hour)}:${pad2(clock.minute)}`,
        type: m.type,
        agents: m.agentIds ?? [],
        caption: m.caption,
        subtitle: m.subtitle ?? null,
        hero,
        azimuth: frame?.azimuth ?? 'default',
        rescued: !!frame?.rescued,
        elevDeg: frame?.elevDeg ?? null,
        visHits: frame?.hits ?? null,
        visTotal: frame?.total ?? null,
        probeHits: frame?.probeHits ?? null,
        probeTotal: frame?.probeTotal ?? null,
      })

      await page.evaluate(() => window.__simControl.photo.exit())
      await page.waitForFunction(
        () => window.__simState.photoMode === false,
        null,
        { timeout: 10000 },
      )
    } catch (err) {
      log(`FAIL shot ${nn} (continuing): ${String(err).slice(0, 240)}`)
      try {
        await page.evaluate(() => window.__simControl.photo.exit())
      } catch {}
    }
  }

  // Resolve agent names from the world JSON on the node side
  let idToName = {}
  try {
    const w = JSON.parse(worldJson)
    for (const a of w.snapshot?.state?.agents ?? []) {
      if (a?.id && a?.name) idToName[a.id] = a.name
    }
  } catch {}
  for (const s of shots) {
    s.agents = (s.agents ?? []).map((id) => idToName[id] ?? id)
  }

  const decideAfter = await page.evaluate(
    () => window.__simState.mind?.decideCalls ?? 0,
  )
  if (decideAfter !== decideBefore) {
    log(
      `WARNING: decideCalls changed ${decideBefore} → ${decideAfter} (expected zero LLM)`,
    )
  } else {
    log(`decideCalls unchanged at ${decideAfter} (zero LLM ok)`)
  }

  // Contact sheet via canvas in-page
  const shotFiles = shots.map((s) => s.file)
  if (shotFiles.length > 0) {
    log('building contact sheet')
    const contactPath = path.join(OUT, 'contact-sheet.png')
    // Load each still as data URL
    const tiles = []
    for (const f of shotFiles) {
      const buf = fs.readFileSync(path.join(OUT, f))
      tiles.push({
        file: f,
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      })
    }
    const sheetB64 = await page.evaluate(async (tileList) => {
      const cols = Math.min(4, Math.max(1, tileList.length))
      const rows = Math.ceil(tileList.length / cols)
      const tw = 480
      const th = 270
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
        ctx.fillRect(c * tw, r * th + th - 22, tw, 22)
        ctx.fillStyle = '#e8ecf4'
        ctx.font = '12px system-ui,sans-serif'
        ctx.fillText(tileList[i].file, c * tw + 6, r * th + th - 7)
      }
      const data = canvas.toDataURL('image/png')
      return data.split(',')[1]
    }, tiles)
    fs.writeFileSync(contactPath, Buffer.from(sheetB64, 'base64'))
    log(`wrote ${contactPath}`)

    // Timeline-size proof: each still at 600px wide, same tile grid.
    const thumbPath = path.join(OUT, 'contact-sheet-thumb.png')
    const thumbB64 = await page.evaluate(async (tileList) => {
      const cols = Math.min(4, Math.max(1, tileList.length))
      const rows = Math.ceil(tileList.length / cols)
      const tw = 600
      const th = Math.round((600 * 1080) / 1920)
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
        ctx.fillRect(c * tw, r * th + th - 24, tw, 24)
        ctx.fillStyle = '#e8ecf4'
        ctx.font = '14px system-ui,sans-serif'
        ctx.fillText(tileList[i].file, c * tw + 8, r * th + th - 7)
      }
      const data = canvas.toDataURL('image/png')
      return data.split(',')[1]
    }, tiles)
    fs.writeFileSync(thumbPath, Buffer.from(thumbB64, 'base64'))
    log(`wrote ${thumbPath}`)
  }

  const manifest = {
    params: {
      world: WORLD_PATH,
      out: OUT,
      max: MAX,
      port: PORT,
      brain: 'off',
    },
    head,
    decideCalls: { before: decideBefore, after: decideAfter },
    shotCount: shots.length,
    shots,
    contactSheet: shotFiles.length > 0 ? 'contact-sheet.png' : null,
    contactSheetThumb: shotFiles.length > 0 ? 'contact-sheet-thumb.png' : null,
  }
  const manifestPath = path.join(OUT, 'highlights.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log(`wrote ${manifestPath} (${shots.length} stills)`)
  if (shots.length < 8) {
    log(`WARNING: only ${shots.length} stills (gate expects ≥8)`)
  }

  await shutdown(shots.length > 0 ? 0 : 1)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 400)}`)
  await shutdown(1)
}

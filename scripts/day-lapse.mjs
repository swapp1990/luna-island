/**
 * Day-lapse photographer — same-camera stills at each day's morning.
 *
 * Usage:
 *   node scripts/day-lapse.mjs <world.json>
 *     [--out artifacts/day-lapse/<basename>] [--port 5182] [--hour 10]
 *
 * ZERO LLM calls: boots with ?brain=off and asserts provider is not codex/grok.
 *
 * Recorded soak worlds predate wear; their strips show growth/economy only.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  arg,
  bootPhotographer,
  composeSheet,
  importWorld,
  pad2,
  rAF,
} from './photo-boot.mjs'

const worldArg = process.argv[2]
if (!worldArg || worldArg.startsWith('--')) {
  console.error(
    'Usage: node scripts/day-lapse.mjs <world.json> [--out dir] [--port 5182] [--hour 10]',
  )
  process.exit(2)
}

const WORLD_PATH = path.resolve(worldArg)
const basen = path.basename(WORLD_PATH, path.extname(WORLD_PATH))
const OUT = path.resolve(arg(process.argv, 'out', path.join('artifacts', 'day-lapse', basen)))
const PORT = Number(arg(process.argv, 'port', '5182'))
const HOUR = Number(arg(process.argv, 'hour', '10'))

const log = (msg) => console.log(`[day-lapse] ${msg}`)

if (!fs.existsSync(WORLD_PATH)) {
  console.error(`world file not found: ${WORLD_PATH}`)
  process.exit(2)
}

const worldJson = fs.readFileSync(WORLD_PATH, 'utf8')
const save = JSON.parse(worldJson)
const headTick = Number(save.tick)
const places = save.snapshot?.state?.places ?? []
const plaza = places.find((p) => p.kind === 'plaza') ?? {
  x: (save.snapshot?.state?.width ?? 48) / 2,
  y: (save.snapshot?.state?.height ?? 48) / 2,
  id: null,
}

const villageCam = (() => {
  let minX = plaza.x
  let maxX = plaza.x
  let minZ = plaza.y
  let maxZ = plaza.y
  for (const p of places) {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minZ) minZ = p.y
    if (p.y > maxZ) maxZ = p.y
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 10)
  const dist = Math.max(20, Math.min(40, span * 1.35 + 6))
  return {
    targetX: plaza.x,
    targetZ: plaza.y,
    dist,
    posX: plaza.x + dist * 0.7,
    posY: dist * 0.75,
    posZ: plaza.y + dist * 0.7,
  }
})()

/** Day d at `hour` → tick (d-1)*1440 + (hour-6)*60. World starts day 1 06:00 at tick 0. */
const tickAtDayHour = (day, hour) => (day - 1) * 1440 + (hour - 6) * 60

const headAbs = headTick + 6 * 60
const headDay = Math.floor(headAbs / 1440) + 1

const shots = []
for (let d = 1; d <= headDay; d++) {
  const tick = tickAtDayHour(d, HOUR)
  if (tick < 0 || tick > headTick) continue
  shots.push({
    day: d,
    tick,
    hour: HOUR,
    minute: 0,
    kind: 'morning',
    file: `day-${pad2(d)}.png`,
    label: `Day ${d} · ${pad2(HOUR)}:00`,
  })
}
if (shots.every((s) => s.tick !== headTick)) {
  const abs = headTick + 6 * 60
  const day = Math.floor(abs / 1440) + 1
  const mod = ((abs % 1440) + 1440) % 1440
  const hour = Math.floor(mod / 60)
  const minute = mod % 60
  const file = `day-${pad2(day)}.png`
  const taken = shots.some((s) => s.file === file)
  shots.push({
    day,
    tick: headTick,
    hour,
    minute,
    kind: 'final',
    file: taken ? 'final.png' : file,
    label: `Day ${day} · ${pad2(hour)}:${pad2(minute)} (end)`,
  })
}

fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) {
  if (/^day-\d{2}\.png$/.test(f) || f === 'final.png' || f === 'strip.png') {
    fs.unlinkSync(path.join(OUT, f))
  }
}

log(
  `${shots.length} stills (hour=${HOUR}) headTick=${headTick} headDay=${headDay} cam dist=${villageCam.dist.toFixed(1)} plaza=${plaza.x},${plaza.y}`,
)

const { page, shutdown } = await bootPhotographer({ port: PORT, log })

try {
  const head = await importWorld(page, worldJson, log)
  const decideBefore = head.decideCalls

  await page.evaluate((cam) => {
    window.__renderLookAt?.(cam.targetX, cam.targetZ, cam.dist)
  }, villageCam)
  await rAF(page, 3)

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    log(`shot ${s.file}: t=${s.tick} ${s.label}`)

    await page.evaluate((tick) => {
      window.__simControl.scrubTo(tick)
    }, s.tick)

    const atHead = s.tick >= head.tick
    await page.waitForFunction(
      ({ tick, atHead }) => {
        if (!window.__simState?.ready) return false
        if (window.__simState.tick !== tick) return false
        if (atHead) return window.__simState.mode === 'live'
        return window.__simState.mode === 'replay'
      },
      { tick: s.tick, atHead },
      { timeout: 120000 },
    )
    await page.evaluate(() => window.__simControl.pause())

    // Captions only — do not pass placeId/frameOnly or photo.enter will
    // hero-frame the plaza and break the fixed village camera.
    await page.evaluate((opts) => {
      window.__simControl.selectAgent(null)
      window.__simControl.photo.enter({
        caption: opts.caption,
        subtitle: opts.subtitle,
      })
    }, {
      caption: s.label,
      subtitle: s.kind === 'final' ? 'Export head' : 'Day-lapse',
    })
    await page.waitForFunction(() => window.__simState.photoMode === true, null, {
      timeout: 10000,
    })
    await page.waitForSelector('[data-testid="photo-caption"]', { timeout: 10000 })

    await page.evaluate((cam) => {
      window.__renderLookAt?.(cam.targetX, cam.targetZ, cam.dist)
    }, villageCam)
    await rAF(page, 4)

    const camNow = await page.evaluate(() => ({
      pos: window.__cameraPos ?? null,
      target: window.__cameraTarget ?? null,
    }))
    s.camera = camNow

    const filePath = path.join(OUT, s.file)
    await page.screenshot({ path: filePath, type: 'png' })
    s.bytes = fs.statSync(filePath).size
    log(`wrote ${s.file} (${s.bytes} bytes)`)

    await page.evaluate(() => window.__simControl.photo.exit())
    await page.waitForFunction(() => window.__simState.photoMode === false, null, {
      timeout: 10000,
    })
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

  for (const s of shots) {
    if ((s.bytes ?? 0) < 30_000) {
      throw new Error(`${s.file} is ${(s.bytes ?? 0)} bytes (expected >30KB)`)
    }
  }

  log('building strip')
  const tiles = shots.map((s) => {
    const buf = fs.readFileSync(path.join(OUT, s.file))
    return {
      file: s.file,
      label: s.label,
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    }
  })
  const stripB64 = await composeSheet(page, tiles, {
    cols: tiles.length,
    rows: 1,
    tileW: 480,
    tileH: 270,
  })
  const stripPath = path.join(OUT, 'strip.png')
  fs.writeFileSync(stripPath, Buffer.from(stripB64, 'base64'))
  log(`wrote ${stripPath}`)

  const manifest = {
    params: {
      world: WORLD_PATH,
      out: OUT,
      port: PORT,
      hour: HOUR,
      brain: 'off',
    },
    head,
    decideCalls: { before: decideBefore, after: decideAfter },
    camera: villageCam,
    shotCount: shots.length,
    shots: shots.map((s) => ({
      file: s.file,
      tick: s.tick,
      day: s.day,
      time: `${pad2(s.hour)}:${pad2(s.minute)}`,
      kind: s.kind,
      bytes: s.bytes ?? null,
      camera: s.camera ?? null,
    })),
    strip: 'strip.png',
  }
  const manifestPath = path.join(OUT, 'day-lapse.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log(`wrote ${manifestPath} (${shots.length} stills)`)

  await shutdown(0)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 400)}`)
  await shutdown(1)
}

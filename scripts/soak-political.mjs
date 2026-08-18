/**
 * Political soak harness — runs the island unattended in a HEADED browser
 * (rAF fires without a human watching) against its own vite instance with
 * consciously raised mind budgets. Appends a JSONL journal and prints
 * notable civic/mind events to stdout for the orchestrator's monitor.
 *
 * Usage: node scripts/soak-political.mjs [--minutes 120] [--port 5178] [--seed 42] [--preset lean]
 *   [--min-gap 15] [--budget-hour 900] [--budget-day 3000] [--concurrency 3] [--brain codex]
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const MINUTES = Number(arg('minutes', '120'))
const PORT = Number(arg('port', '5178'))
const SEED = Number(arg('seed', '42'))
const PRESET = arg('preset', 'default') === 'lean' ? 'lean' : 'default'
const MIN_GAP = Number(arg('min-gap', '15'))
const BUDGET_HOUR = Number(arg('budget-hour', '900'))
const BUDGET_DAY = Number(arg('budget-day', '3000'))
const CONCURRENCY = Number(arg('concurrency', '3'))
const BRAIN = String(arg('brain', 'codex'))
const NO_HIGHLIGHTS = process.argv.includes('--no-highlights')
const JOURNAL = path.resolve('artifacts', `soak-political-${Date.now()}.jsonl`)
fs.mkdirSync('artifacts', { recursive: true })

const log = (msg) => console.log(`[soak] ${msg}`)

// 1. Own vite instance with raised budget caps (sidecar reads env at boot).
log(`starting vite :${PORT} (budget ${BUDGET_HOUR}/h, ${BUDGET_DAY}/day, concurrency=${CONCURRENCY})`)
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    env: {
      ...process.env,
      LUNA_MAX_PER_HOUR: String(BUDGET_HOUR),
      LUNA_MAX_PER_DAY: String(BUDGET_DAY),
      LUNA_CONCURRENCY: String(CONCURRENCY),
    },
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
      const r = await fetch(`http://127.0.0.1:${PORT}/api/luna/health`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite/sidecar never became healthy')
}

const CIVIC = [
  'institution:proposed',
  'institution:voted',
  'institution:closed',
  'institution:sanctioned',
  'institution:claimed',
  'mind:say',
  'mind:reflection',
  'agent:collapsed',
  'construction:commissioned',
  'ownership:transfer',
  'discovery:examined',
  'discovery:noticed',
]

const clock = (snap) => `${snap.hour}:${String(snap.minute).padStart(2, '0')}`

function examinedByAgentFromStory(storyObj) {
  const out = {}
  const rows = storyObj?.discoveries
  if (!Array.isArray(rows)) return out
  for (const d of rows) {
    if (!d || d.type !== 'discovery:examined') continue
    const id = d.agentId || 'unknown'
    if (!out[id]) out[id] = { count: 0, targets: [] }
    out[id].count += 1
    if (d.target) out[id].targets.push(d.target)
  }
  return out
}

function examinedByAgentFromWorld(worldObj) {
  const out = {}
  const events = worldObj?.events
  if (!Array.isArray(events)) return out
  for (const e of events) {
    if (!e || e.type !== 'discovery:examined') continue
    const id = e.agentId || 'unknown'
    if (!out[id]) out[id] = { count: 0, targets: [] }
    out[id].count += 1
    const target = e.data?.target
    if (target) out[id].targets.push(target)
  }
  return out
}

let browser
const shutdown = async (code) => {
  try { await browser?.close() } catch {}
  try { vite.kill() } catch {}
  process.exit(code)
}
process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

try {
  await waitForServer()
  log('server healthy; launching headed chromium')
  browser = await chromium.launch({
    headless: false,
    args: [
      // Headed soaks lose foreground; without these Chrome 1-fps-throttles rAF.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--enable-webgl',
      '--use-angle=default',
      '--ignore-gpu-blocklist',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (e) => log(`PAGEERROR: ${String(e).slice(0, 200)}`))
  // Explicit brain param: auto-detect races on a cold profile (health probe
  // fires during first-load module transform); the param is the reliable path.
  await page.goto(`http://127.0.0.1:${PORT}/?brain=${encodeURIComponent(BRAIN)}&mindMinGapTicks=${MIN_GAP}`)
  await page.waitForFunction(() => window.__simState?.ready, null, { timeout: 30000 })

  await page.evaluate(({ seed, preset }) => window.__simControl.newWorld(seed, preset), {
    seed: SEED,
    preset: PRESET,
  })
  await page.waitForFunction(
    (seed) =>
      window.__simState?.ready &&
      window.__simState.seed === seed &&
      window.__simState.tick < 100 &&
      window.__simState.mind?.minGapTicks != null,
    SEED,
    { timeout: 30000 },
  )
  await page.evaluate(() => window.__simControl.setSpeed(1))
  const boot = await page.evaluate(() => {
    const s = window.__simState
    return {
      provider: s.mind?.provider,
      minGapTicks: s.mind?.minGapTicks,
      tick: s.tick,
    }
  })
  log(`world ${SEED} preset=${PRESET} live at 1x, provider=${boot.provider}, minGapTicks=${boot.minGapTicks}, minds=6, soaking ${MINUTES}min → ${JOURNAL}`)
  if (boot.provider !== BRAIN) {
    log(`WARNING: provider is ${boot.provider}, expected ${BRAIN} — aborting`)
    await shutdown(2)
  }
  if (boot.minGapTicks !== MIN_GAP) {
    log(`WARNING: minGapTicks is ${boot.minGapTicks}, expected ${MIN_GAP} — aborting`)
    await shutdown(2)
  }

  const seen = {}
  const t0 = Date.now()
  let lastTick = boot.tick ?? 0
  let lastDecisions = 0
  let lastExamined = 0
  let throttleBudget = false
  let lastFallbacks = 0
  let lastStale = 0
  while (Date.now() - t0 < MINUTES * 60_000) {
    await new Promise((r) => setTimeout(r, 60_000))
    const snap = await page.evaluate((civic) => {
      const s = window.__simState
      const counts = window.__simControl.countEventTypes(civic)
      return {
        day: s.day, hour: s.hour, minute: s.minute, tick: s.tick, speed: s.speed,
        mind: {
          pending: s.mind.pending,
          thinking: s.mind.thinking,
          decisions: s.mind.decisions,
          fallbacks: s.mind.fallbacks,
          budgetH: s.mind.budgetUsedHour,
          stale: counts['mind:stale'] || 0,
          meanLatencyMs: s.mind.meanLatencyMs,
          decideCalls: s.mind.decideCalls,
          minGapTicks: s.mind.minGapTicks,
          budgetUsedDay: s.mind.budgetUsedDay,
          budgetMaxHour: s.mind.budgetMaxHour,
        },
        counts,
      }
    }, CIVIC)
    snap.wallMin = Math.round((Date.now() - t0) / 60000)
    const ticksSoFar = Math.max(0, snap.tick - (boot.tick ?? 0))
    snap.ticksThisMin = snap.tick - lastTick
    snap.breathePct = snap.wallMin > 0
      ? 100 * (1 - ticksSoFar / (60 * snap.wallMin))
      : 0
    snap.decisionsThisMin = (snap.mind.decisions || 0) - lastDecisions
    snap.examinedThisMin = (snap.counts['discovery:examined'] || 0) - lastExamined
    lastTick = snap.tick
    lastDecisions = snap.mind.decisions || 0
    lastExamined = snap.counts['discovery:examined'] || 0
    const usedHour = snap.mind.budgetH ?? 0
    const maxHour = snap.mind.budgetMaxHour ?? 0
    const { budgetMaxHour: _omitMaxHour, ...mindForJournal } = snap.mind
    fs.appendFileSync(JOURNAL, JSON.stringify({ ...snap, mind: mindForJournal }) + '\n')
    const prevNoticed = seen['discovery:noticed'] || 0
    for (const k of Object.keys(snap.counts)) {
      const prev = seen[k] || 0
      if (snap.counts[k] > prev) {
        if (k.startsWith('institution:')) log(`CIVIC ${k} -> ${snap.counts[k]} (D${snap.day} ${clock(snap)})`)
        if (k === 'discovery:examined') log(`DISCOVERY examined -> ${snap.counts[k]} (D${snap.day} ${clock(snap)})`)
        seen[k] = snap.counts[k]
      }
    }
    const noticed = snap.counts['discovery:noticed'] || 0
    if (noticed > prevNoticed) {
      log(`DISCOVERY noticed -> ${noticed} (D${snap.day} ${clock(snap)})`)
    }
    const stale = snap.mind.stale || 0
    const fallbacks = snap.mind.fallbacks || 0
    if (!throttleBudget && maxHour > 0 && usedHour >= 0.9 * maxHour) {
      log(`THROTTLE budgetUsedHour ${usedHour}/${maxHour} (>= 90%)`)
      throttleBudget = true
    }
    if (fallbacks > lastFallbacks) log(`THROTTLE mind:fallback -> ${fallbacks} (D${snap.day} ${clock(snap)})`)
    if (stale > lastStale) log(`THROTTLE mind:stale -> ${stale} (D${snap.day} ${clock(snap)})`)
    lastFallbacks = fallbacks
    lastStale = stale
    const breatheShown = Math.round(snap.breathePct)
    const lat = snap.mind.meanLatencyMs ?? 0
    const decideCalls = snap.mind.decideCalls ?? 0
    const thinking = snap.mind.thinking ?? 0
    log(`t+${snap.wallMin}m D${snap.day} ${clock(snap)} decisions=${snap.mind.decisions} say=${snap.counts['mind:say'] || 0} budgetH=${snap.mind.budgetH} decideCalls=${decideCalls} thinking=${thinking} pending=${snap.mind.pending} breathe=${breatheShown}% lat=${lat}ms BUDGET ${usedHour}/${maxHour}`)
  }

  log('soak window complete — exporting world + story, then IDB save')
  await page.evaluate(() => window.__simControl.pause())
  const exportTs = Date.now()
  const worldJson = await page.evaluate(() => window.__simControl.exportWorldJson())
  const storyJson = await page.evaluate(() => window.__simControl.exportStoryJson())
  const worldPath = path.resolve('artifacts', `soak-${exportTs}-world.json`)
  const storyPath = path.resolve('artifacts', `soak-${exportTs}-story.json`)
  fs.writeFileSync(worldPath, worldJson)
  fs.writeFileSync(storyPath, storyJson)
  log(`wrote ${worldPath}`)
  log(`wrote ${storyPath}`)
  await page.evaluate(async () => { await window.__simControl.saveNow() })
  const finale = await page.evaluate((civic) => window.__simControl.countEventTypes(civic), CIVIC)
  const finaleMind = await page.evaluate(() => {
    const m = window.__simState.mind
    const s = window.__simState
    return {
      day: s.day,
      tick: s.tick,
      meanLatencyMs: m?.meanLatencyMs ?? 0,
      decisions: m?.decisions ?? 0,
      decideCalls: m?.decideCalls ?? 0,
      minGapTicks: m?.minGapTicks,
      budgetUsedDay: m?.budgetUsedDay ?? 0,
    }
  })
  try {
    let examinedByAgent = {}
    try {
      examinedByAgent = examinedByAgentFromStory(JSON.parse(storyJson))
    } catch {}
    if (Object.keys(examinedByAgent).length === 0) {
      try {
        examinedByAgent = examinedByAgentFromWorld(JSON.parse(worldJson))
      } catch {}
    }
    const lastLine = (() => {
      try {
        const lines = fs.readFileSync(JOURNAL, 'utf8').trim().split('\n')
        return JSON.parse(lines[lines.length - 1])
      } catch {
        return null
      }
    })()
    const wallMin = lastLine?.wallMin ?? MINUTES
    const ticksSoFar = Math.max(0, (finaleMind.tick ?? 0) - (boot.tick ?? 0))
    const breathePct = lastLine?.breathePct ?? (wallMin > 0 ? 100 * (1 - ticksSoFar / (60 * wallMin)) : 0)
    const summary = {
      params: {
        seed: SEED,
        preset: PRESET,
        minGap: MIN_GAP,
        budgetHour: BUDGET_HOUR,
        budgetDay: BUDGET_DAY,
        concurrency: CONCURRENCY,
        brain: BRAIN,
        minutes: MINUTES,
        port: PORT,
      },
      wallMin,
      tick: finaleMind.tick,
      simDays: (finaleMind.tick ?? 0) / 1440,
      day: finaleMind.day,
      breathePct,
      meanLatencyMs: finaleMind.meanLatencyMs,
      decisions: finaleMind.decisions,
      decideCalls: finaleMind.decideCalls,
      decisionsPerWallHour: wallMin > 0 ? finaleMind.decisions / (wallMin / 60) : 0,
      counts: finale,
      examinedByAgent,
      journal: JOURNAL,
      world: worldPath,
      story: storyPath,
    }
    const summaryPath = path.resolve('artifacts', `soak-${exportTs}-summary.json`)
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
    log(`wrote ${summaryPath}`)
  } catch (err) {
    log(`summary writer failed (world/story already saved): ${String(err).slice(0, 200)}`)
  }
  log(`FINAL ${JSON.stringify(finale)}`)
  log(`journal: ${JOURNAL}`)

  // Photographer reel (fail-soft — never affects soak exit code or artifacts)
  if (!NO_HIGHLIGHTS) {
    try {
      log(`highlights: invoking photographer on ${worldPath}`)
      await new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          [
            path.resolve('scripts', 'soak-highlights.mjs'),
            worldPath,
            '--out',
            path.resolve('artifacts', 'highlights', path.basename(worldPath, '.json')),
          ],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
            shell: false,
          },
        )
        child.stdout.on('data', (d) => {
          const lines = String(d).trim().split('\n')
          for (const line of lines) {
            if (line) log(`highlights| ${line.slice(0, 200)}`)
          }
        })
        child.stderr.on('data', (d) => {
          log(`highlights-err: ${String(d).trim().slice(0, 200)}`)
        })
        child.on('close', (code) => {
          log(`highlights: child exited ${code} (fail-soft)`)
          resolve()
        })
        child.on('error', (err) => {
          log(`highlights: spawn failed (fail-soft): ${String(err).slice(0, 200)}`)
          resolve()
        })
      })
    } catch (err) {
      log(`highlights: unexpected (fail-soft): ${String(err).slice(0, 200)}`)
    }
  } else {
    log('highlights: skipped (--no-highlights)')
  }

  await shutdown(0)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 300)}`)
  await shutdown(1)
}

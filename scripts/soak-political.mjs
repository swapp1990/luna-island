/**
 * Political soak harness — runs the island unattended in a HEADED browser
 * (rAF fires without a human watching) against its own vite instance with
 * consciously raised mind budgets. Appends a JSONL journal and prints
 * notable civic/mind events to stdout for the orchestrator's monitor.
 *
 * Usage: node scripts/soak-political.mjs [--minutes 120] [--port 5178] [--seed 42]
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
const JOURNAL = path.resolve('artifacts', `soak-political-${Date.now()}.jsonl`)
fs.mkdirSync('artifacts', { recursive: true })

const log = (msg) => console.log(`[soak] ${msg}`)

// 1. Own vite instance with raised budget caps (sidecar reads env at boot).
log(`starting vite :${PORT} (budget 240/h, 2000/day)`)
const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
  {
    env: { ...process.env, LUNA_MAX_PER_HOUR: '240', LUNA_MAX_PER_DAY: '2000' },
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
]

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
  browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (e) => log(`PAGEERROR: ${String(e).slice(0, 200)}`))
  // Explicit brain param: auto-detect races on a cold profile (health probe
  // fires during first-load module transform); the param is the reliable path.
  await page.goto(`http://127.0.0.1:${PORT}/?brain=codex`)
  await page.waitForFunction(() => window.__simState?.ready, null, { timeout: 30000 })

  await page.evaluate((seed) => window.__simControl.newWorld(seed), SEED)
  await page.waitForFunction(() => window.__simState?.ready && window.__simState.tick < 100, null, { timeout: 30000 })
  await page.evaluate(() => window.__simControl.setSpeed(1))
  const provider = await page.evaluate(() => window.__simState.mind.provider)
  log(`world ${SEED} live at 1x, provider=${provider}, minds=6, soaking ${MINUTES}min → ${JOURNAL}`)
  if (provider !== 'codex') log('WARNING: provider is not codex — aborting')
  if (provider !== 'codex') await shutdown(2)

  const seen = {}
  const t0 = Date.now()
  while (Date.now() - t0 < MINUTES * 60_000) {
    await new Promise((r) => setTimeout(r, 60_000))
    const snap = await page.evaluate((civic) => {
      const s = window.__simState
      const counts = window.__simControl.countEventTypes(civic)
      return {
        day: s.day, hour: s.hour, minute: s.minute, tick: s.tick, speed: s.speed,
        mind: { pending: s.mind.pending, decisions: s.mind.decisions, fallbacks: s.mind.fallbacks,
                budgetH: s.mind.budgetUsedHour, stale: counts['mind:stale'] || 0 },
        counts,
      }
    }, CIVIC)
    snap.wallMin = Math.round((Date.now() - t0) / 60000)
    fs.appendFileSync(JOURNAL, JSON.stringify(snap) + '\n')
    for (const k of Object.keys(snap.counts)) {
      const prev = seen[k] || 0
      if (snap.counts[k] > prev) {
        if (k.startsWith('institution:')) log(`CIVIC ${k} -> ${snap.counts[k]} (D${snap.day} ${snap.hour}:${String(snap.minute).padStart(2, '0')})`)
        seen[k] = snap.counts[k]
      }
    }
    log(`t+${snap.wallMin}m D${snap.day} ${snap.hour}:${String(snap.minute).padStart(2, '0')} decisions=${snap.mind.decisions} say=${snap.counts['mind:say'] || 0} budgetH=${snap.mind.budgetH}`)
  }

  log('soak window complete — saving world')
  await page.evaluate(async () => { window.__simControl.pause(); await window.__simControl.saveNow() })
  const finale = await page.evaluate((civic) => window.__simControl.countEventTypes(civic), CIVIC)
  log(`FINAL ${JSON.stringify(finale)}`)
  log(`journal: ${JOURNAL}`)
  await shutdown(0)
} catch (e) {
  log(`FATAL: ${String(e).slice(0, 300)}`)
  await shutdown(1)
}

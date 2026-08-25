/**
 * Write a small, deterministic recorded run into `artifacts/` so Run Theater
 * has something to show without waiting on a two-hour political soak.
 *
 * It is a real run — the sim actually advances on UtilityBrain instinct and the
 * journal samples it the way the soak harness does (one row per simulated wall
 * minute, 60 ticks at 1x). It is NOT an LLM run: `params.brain` is `fixture`
 * and the mind counters are honestly zero.
 *
 * Usage: node scripts/make-run-fixture.mjs [--seed 42] [--days 3] [--preset default]
 */
import { createServer } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitStamp } from './run-stamp.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const SEED = Number(arg('seed', '42'))
const DAYS = Number(arg('days', '3'))
const PRESET = String(arg('preset', 'default'))
const OUT = path.resolve(ROOT, arg('out', 'artifacts'))

/** Same civic slice the political soak journals. */
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
  'construction:completed',
  'ownership:transfer',
  'discovery:examined',
  'discovery:noticed',
  'relationship:close',
  'relationship:friends',
  'gathering:scheduled',
  'gathering:started',
]

const TICKS_PER_SAMPLE = 60

fs.mkdirSync(OUT, { recursive: true })

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5198, strictPort: false },
})
await server.listen()

try {
  const simMod = await server.ssrLoadModule('/src/sim/sim.ts')
  const persist = await server.ssrLoadModule('/src/sim/persist.ts')
  const timeMod = await server.ssrLoadModule('/src/sim/time.ts')

  const startTs = Date.now()
  const sim = new simMod.Simulation(SEED, { preset: PRESET })
  const totalTicks = Math.max(1, Math.round(DAYS * 1440))
  const samples = Math.ceil(totalTicks / TICKS_PER_SAMPLE)

  const journalPath = path.join(OUT, `soak-political-${startTs}.jsonl`)
  const journalLines = []

  const countTypes = () => {
    const wanted = new Set(CIVIC)
    const out = {}
    for (const e of sim.getEvents()) {
      if (!wanted.has(e.type)) continue
      out[e.type] = (out[e.type] ?? 0) + 1
    }
    return out
  }

  let lastTick = 0
  for (let i = 0; i < samples; i++) {
    const take = Math.min(TICKS_PER_SAMPLE, totalTicks - sim.state.tick)
    if (take > 0) sim.advanceTicks(take)
    const t = timeMod.toSimTime(sim.state.tick)
    const row = {
      wallMin: i + 1,
      day: t.day,
      hour: t.hour,
      minute: t.minute,
      tick: sim.state.tick,
      speed: 1,
      ticksThisMin: sim.state.tick - lastTick,
      breathePct: 0,
      placesByKind: sim.state.places.reduce((acc, p) => {
        acc[p.kind] = (acc[p.kind] ?? 0) + 1
        return acc
      }, {}),
      mind: {
        pending: 0,
        thinking: 0,
        decisions: 0,
        fallbacks: 0,
        budgetH: 0,
        stale: 0,
        meanLatencyMs: 0,
        decideCalls: 0,
        minGapTicks: null,
        budgetUsedDay: 0,
      },
      counts: countTypes(),
    }
    lastTick = sim.state.tick
    journalLines.push(JSON.stringify(row))
    if (sim.state.tick >= totalTicks) break
  }

  fs.writeFileSync(journalPath, journalLines.join('\n') + '\n')

  const exportTs = Date.now()
  const worldPath = path.join(OUT, `soak-${exportTs}-world.json`)
  const storyPath = path.join(OUT, `soak-${exportTs}-story.json`)
  const summaryPath = path.join(OUT, `soak-${exportTs}-summary.json`)

  fs.writeFileSync(worldPath, JSON.stringify(persist.serializeSave(sim)))
  fs.writeFileSync(storyPath, JSON.stringify(persist.serializeStory(sim)))

  const finalTime = timeMod.toSimTime(sim.state.tick)
  const summary = {
    fixture: true,
    git: gitStamp(),
    params: {
      seed: SEED,
      preset: PRESET,
      brain: 'fixture',
      minutes: journalLines.length,
      minGap: null,
      budgetHour: 0,
      budgetDay: 0,
      concurrency: 0,
    },
    wallMin: journalLines.length,
    tick: sim.state.tick,
    simDays: sim.state.tick / 1440,
    day: finalTime.day,
    breathePct: 0,
    meanLatencyMs: 0,
    decisions: 0,
    decideCalls: 0,
    decisionsPerWallHour: 0,
    counts: countTypes(),
    examinedByAgent: {},
    journal: journalPath,
    world: worldPath,
    story: storyPath,
  }
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

  console.log(
    JSON.stringify(
      {
        id: String(exportTs),
        tick: sim.state.tick,
        day: finalTime.day,
        events: sim.getEventCount(),
        journalRows: journalLines.length,
        world: path.relative(ROOT, worldPath),
        summary: path.relative(ROOT, summaryPath),
        journal: path.relative(ROOT, journalPath),
      },
      null,
      2,
    ),
  )
} finally {
  await server.close()
}

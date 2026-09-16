/**
 * Run the lineage hamlet from Node.
 *
 *   node scripts/lineage-run.mjs [--seed 42] [--seasons 8] [--mating courtship|random]
 *     [--yield 0.5] [--mutation 0.01] [--cohort 12] [--days 10] [--seeds 1..20]
 *     [--brain instinct|llm|mock] [--engine codex|grok|openrouter] [--model <id>] [--dna on|off]
 *     [--concurrency 3] [--budget-hour 2500] [--budget-day 6000]
 *     [--replay <dir>] [--tag <label>] [--out artifacts/lineage]
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

function parseSeeds(raw) {
  if (raw === undefined) return null
  const m = String(raw).match(/^(\d+)\.\.(\d+)$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const out = []
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    for (let i = lo; i <= hi; i++) out.push(i)
    return out
  }
  return [Number(raw)]
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function stampNow() {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function mean(xs) {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

function sd(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) {
    const d = x - m
    s += d * d
  }
  return Math.sqrt(s / (xs.length - 1))
}

function fmt(n) {
  const sign = n < 0 ? '' : n === 0 ? '' : ''
  return `${sign}${n.toFixed(4)}`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function makeSemaphore(n) {
  let active = 0
  const wait = []
  return {
    async acquire() {
      if (active >= n) await new Promise((res) => wait.push(res))
      active += 1
    },
    release() {
      active = Math.max(0, active - 1)
      const next = wait.shift()
      if (next) next()
    },
  }
}

function fmtWall(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function fmtMean(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

function sidecarDecider(port, engine, sem, hooks) {
  let exhaustedLogged = false
  return {
    async decide(input) {
      await sem.acquire()
      const deadline = Date.now() + 90_000
      try {
        while (Date.now() < deadline) {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/api/luna/decide`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                system: input.system,
                user: input.user,
                engine,
                kind: 'decision',
              }),
            })
            if (res.status === 429) {
              await sleep(750)
              continue
            }
            if (res.status === 402) {
              if (!exhaustedLogged) {
                exhaustedLogged = true
                hooks.onExhausted()
              }
              return { fallback: true, error: 'budget' }
            }
            if (!res.ok) return { fallback: true, error: `http ${res.status}` }
            const json = await res.json()
            if (json.budget) hooks.onBudget(json.budget)
            if (json.usage) hooks.onUsage(json.usage)
            return {
              text: String(json.text ?? ''),
              latencyMs: Number(json.latencyMs ?? 0),
              ...(json.usage ? { usage: json.usage } : {}),
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (Date.now() + 750 >= deadline) return { fallback: true, error: msg }
            await sleep(750)
          }
        }
        return { fallback: true, error: 'deadline' }
      } finally {
        sem.release()
      }
    },
  }
}

const SEED = Number(arg('seed', '42'))
const SEASONS = Number(arg('seasons', '8'))
const MATING = String(arg('mating', 'courtship'))
const YIELD = Number(arg('yield', '0.5'))
const MUTATION = Number(arg('mutation', '0.01'))
const COHORT = Number(arg('cohort', '12'))
const DAYS = Number(arg('days', '10'))
const OUT = path.resolve(ROOT, arg('out', 'artifacts/lineage'))
const seeds = parseSeeds(arg('seeds'))
const BRAIN = String(arg('brain', 'instinct'))
const ENGINE_RAW = String(arg('engine', 'openrouter'))
const ENGINE = ['codex', 'grok', 'openrouter'].includes(ENGINE_RAW) ? ENGINE_RAW : 'codex'
const MODEL = arg('model')
const DNA_ON = String(arg('dna', 'on')) !== 'off'
const REPLAY = arg('replay')
const TAG = arg('tag')
const CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(arg('concurrency', BRAIN === 'llm' ? '3' : '1'))),
)
const BUDGET_HOUR = Number(arg('budget-hour', '2500'))
const BUDGET_DAY = Number(arg('budget-day', '6000'))

if (BRAIN === 'llm' && !REPLAY) {
  process.env.LUNA_MAX_PER_HOUR = String(BUDGET_HOUR)
  process.env.LUNA_MAX_PER_DAY = String(BUDGET_DAY)
  process.env.LUNA_CONCURRENCY = String(CONCURRENCY)
  process.env.LUNA_ENGINE = ENGINE
  if (MODEL != null) process.env.LUNA_OPENROUTER_MODEL = String(MODEL)
}

fs.mkdirSync(OUT, { recursive: true })

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5199, strictPort: false },
})
await server.listen()
const addr = server.httpServer?.address()
const PORT = typeof addr === 'object' && addr ? addr.port : 5199

const t0 = Date.now()
let outDir = OUT
const pending = {
  outDir: null,
  decisions: [],
  mind: null,
  flushed: false,
}

function flushPartial() {
  if (pending.flushed || !pending.outDir) return
  pending.flushed = true
  fs.mkdirSync(pending.outDir, { recursive: true })
  const lines = pending.decisions.map((d) => JSON.stringify(d))
  fs.writeFileSync(
    path.join(pending.outDir, 'decisions.jsonl'),
    lines.length ? lines.join('\n') + '\n' : '',
  )
  if (pending.mind) {
    fs.writeFileSync(path.join(pending.outDir, 'mind.json'), JSON.stringify(pending.mind, null, 2))
  }
}

process.on('SIGINT', () => {
  flushPartial()
  server.close().finally(() => process.exit(130))
})

try {
  const runMod = await server.ssrLoadModule('/src/lineage/run.ts')
  const asyncMod = await server.ssrLoadModule('/src/lineage/runAsync.ts')
  const deciderMod = await server.ssrLoadModule('/src/lineage/decider.ts')
  const exprMod = await server.ssrLoadModule('/src/lineage/render/expression.ts')
  const rngMod = await server.ssrLoadModule('/src/sim/rng.ts')

  const TRAITS = [
    'metabolism',
    'stamina',
    'sociability',
    'industry',
    'generosity',
    'voice',
    'thrift',
    'curiosity',
    'temper',
    'loyalty',
    'boldness',
    'caution',
  ]

  const base = {
    seasons: SEASONS,
    harvestYield: YIELD,
    mutationRate: MUTATION,
    cohortSize: COHORT,
    daysPerSeason: DAYS,
  }

  function writeRun(dir, result) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'chronicle.md'),
      runMod.renderChronicle(result.events, result.state),
    )
    fs.writeFileSync(path.join(dir, 'census.md'), runMod.renderCensus(result.state))
    fs.writeFileSync(path.join(dir, 'tree.md'), runMod.renderTree(result.state.lineage))
    fs.writeFileSync(
      path.join(dir, 'trajectories.md'),
      runMod.renderTrajectories(result.state.lineage).markdown,
    )
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(result.summary, null, 2))
    const lines = result.events.map((e) => JSON.stringify(e))
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.join('\n') + '\n')
    fs.writeFileSync(path.join(dir, 'lineage.json'), JSON.stringify(result.state.lineage, null, 2))
    fs.writeFileSync(path.join(dir, 'stamp.json'), JSON.stringify(gitStamp(), null, 2))
  }

  function writePromptSamples(dir, samples) {
    const parts = ['# Prompt samples', '']
    for (const s of samples) {
      const when = `Season ${s.season + 1} day ${s.day + 1} ${['dawn', 'noon', 'dusk', 'night'][s.turn] ?? 'dawn'}`
      parts.push(`## ${when} — ${s.name}`, '', '### System', '', s.system, '', '### User', '', s.user, '')
    }
    fs.writeFileSync(path.join(dir, 'prompts-sample.md'), parts.join('\n'))
  }

  if (REPLAY) {
    const dir = path.resolve(ROOT, REPLAY)
    const summaryPath = path.join(dir, 'summary.json')
    const decPath = path.join(dir, 'decisions.jsonl')
    if (!fs.existsSync(summaryPath) || !fs.existsSync(decPath)) {
      console.error(`replay missing summary.json or decisions.jsonl in ${dir}`)
      process.exitCode = 1
    } else {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
      const decisions = fs
        .readFileSync(decPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l))
      const result = runMod.runLineage(summary.config, deciderMod.recordedBrainFactory(decisions))
      const match =
        result.summary.hash === summary.hash && result.summary.eventCount === summary.eventCount
      console.log(
        `replay hash ${result.summary.hash} events ${result.summary.eventCount} — ${match ? 'MATCH' : 'MISMATCH'}`,
      )
      if (!match) {
        console.error(`recorded hash ${summary.hash} events ${summary.eventCount}`)
        process.exitCode = 1
      }
    }
  } else if (seeds) {
    const arms = ['courtship', 'random']
    const byArm = { courtship: [], random: [] }
    const tSim = Date.now()
    for (const seed of seeds) {
      for (const mating of arms) {
        const result = runMod.runLineage({ ...base, seed, mating })
        byArm[mating].push(result.summary)
      }
    }
    console.log(`sim ${Date.now() - tSim} ms`)

    const stamp = stampNow()
    outDir = path.join(OUT, `replicate-y${YIELD}-${stamp}`)
    fs.mkdirSync(outDir, { recursive: true })

    const gens = Math.max(
      0,
      ...byArm.courtship.map((s) => (s.traitMeansByGeneration.metabolism ?? []).length - 1),
    )

    function armTable(arm) {
      const runs = byArm[arm]
      const lines = [`## ${arm}`, '']
      const header = ['trait', ...Array.from({ length: gens + 1 }, (_, g) => `g${g}`)]
      lines.push(`| ${header.join(' | ')} |`)
      lines.push(`|${header.map(() => '---').join('|')}|`)
      for (const trait of TRAITS) {
        const cells = [trait]
        for (let g = 0; g <= gens; g++) {
          const vals = runs
            .map((r) => r.traitMeansByGeneration[trait]?.[g])
            .filter((n) => typeof n === 'number')
          cells.push(`${mean(vals).toFixed(3)} ± ${sd(vals).toFixed(3)}`)
        }
        lines.push(`| ${cells.join(' | ')} |`)
      }
      lines.push('')
      return lines
    }

    const deltaLines = []
    const deltaJson = {}
    for (const trait of TRAITS) {
      const deltas = (arm) =>
        byArm[arm]
          .map((r) => {
            const arr = r.traitMeansByGeneration[trait] ?? []
            if (arr.length < 8) return null
            return arr[7] - arr[0]
          })
          .filter((n) => n !== null)
      const c = deltas('courtship')
      const r = deltas('random')
      const line = `Δ gen0→gen7 ${trait}: courtship = ${fmt(mean(c))} ± ${sd(c).toFixed(4)}, random = ${fmt(mean(r))} ± ${sd(r).toFixed(4)}`
      deltaLines.push(line)
      deltaJson[trait] = {
        courtship: { mean: mean(c), sd: sd(c) },
        random: { mean: mean(r), sd: sd(r) },
      }
    }

    const md = [
      '# Lineage replicate',
      '',
      `seeds ${seeds[0]}..${seeds[seeds.length - 1]}, ${SEASONS} seasons, cohort ${COHORT}`,
      '',
      ...armTable('courtship'),
      ...armTable('random'),
      '## Deltas',
      '',
      ...deltaLines.map((l) => `- ${l}`),
      '',
    ].join('\n')

    fs.writeFileSync(path.join(outDir, 'aggregate.md'), md)
    fs.writeFileSync(
      path.join(outDir, 'aggregate.json'),
      JSON.stringify(
        {
          seeds,
          seasons: SEASONS,
          cohort: COHORT,
          yield: YIELD,
          mutation: MUTATION,
          n: seeds.length,
          deltas: deltaJson,
          courtship: byArm.courtship,
          random: byArm.random,
          git: gitStamp(),
        },
        null,
        2,
      ),
    )
    fs.writeFileSync(path.join(outDir, 'stamp.json'), JSON.stringify(gitStamp(), null, 2))
  } else if (BRAIN === 'instinct') {
    const result = runMod.runLineage({ ...base, seed: SEED, mating: MATING })
    outDir = path.join(OUT, `${MATING}-seed${SEED}-${stampNow()}`)
    writeRun(outDir, result)
  } else {
    const dnaLabel = DNA_ON ? 'on' : 'off'
    const label = TAG || BRAIN
    outDir = path.join(OUT, `${label}-${ENGINE}-dna${dnaLabel}-seed${SEED}-${stampNow()}`)
    fs.mkdirSync(outDir, { recursive: true })
    pending.outDir = outDir
    pending.decisions = []
    pending.mind = {
      llm: 0,
      fallback: 0,
      invalid: 0,
      meanLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      budgetAtEnd: null,
      wallMs: 0,
    }

    let lastBudget = null
    let clock = { season: 0, day: 0 }
    const usageTotals = { promptTokens: 0, completionTokens: 0, costUsd: 0, costSeen: false }
    const useTotals = (u) => {
      if (typeof u.promptTokens === 'number') usageTotals.promptTokens += u.promptTokens
      if (typeof u.completionTokens === 'number') usageTotals.completionTokens += u.completionTokens
      if (typeof u.costUsd === 'number') {
        usageTotals.costUsd += u.costUsd
        usageTotals.costSeen = true
      }
    }

    const logProgress = (mind) => {
      const budget = lastBudget
        ? `${lastBudget.usedHour}/${lastBudget.maxHour}h`
        : `${0}/${BUDGET_HOUR}h`
      const meanMs = mind.meanLatencyMs ?? 0
      const costTail = usageTotals.costSeen ? ` | cost $${usageTotals.costUsd.toFixed(4)}` : ''
      const line = `S${clock.season + 1} D${clock.day + 1} | llm ${mind.llm} fallback ${mind.fallback} | mean ${fmtMean(meanMs)} | budget ${budget} | wall ${fmtWall(Date.now() - t0)}${costTail}`
      console.log(line)
      fs.appendFileSync(path.join(outDir, 'progress.log'), line + '\n')
    }

    let decider
    if (BRAIN === 'mock') {
      decider = deciderMod.mockDecider(rngMod.createRng(SEED), DNA_ON)
    } else {
      try {
        const hr = await fetch(`http://127.0.0.1:${PORT}/api/luna/health`)
        if (!hr.ok) {
          console.error(`sidecar health failed: HTTP ${hr.status} at 127.0.0.1:${PORT}`)
          process.exitCode = 1
          throw new Error('health')
        }
        const health = await hr.json()
        const worker = health.worker ?? '?'
        const engine = health.engine ?? ENGINE
        const model = health.openrouter?.model ?? (MODEL != null ? String(MODEL) : '-')
        const keySource = health.openrouter?.keySource ?? '-'
        console.log(`health engine=${engine} worker=${worker} model=${model} key=${keySource}`)
        if (ENGINE === 'openrouter' && keySource === 'missing') {
          console.error('openrouter key missing')
          process.exitCode = 1
          throw new Error('openrouter key missing')
        }
        if (health.budget) lastBudget = health.budget
      } catch (err) {
        if (process.exitCode === 1) throw err
        console.error(`sidecar health failed: ${err instanceof Error ? err.message : String(err)}`)
        process.exitCode = 1
        throw err
      }
      const sem = makeSemaphore(CONCURRENCY)
      decider = sidecarDecider(PORT, ENGINE, sem, {
        onBudget: (b) => {
          lastBudget = b
        },
        onUsage: (u) => {
          useTotals(u)
        },
        onExhausted: () => {
          console.log(`BUDGET EXHAUSTED at S${clock.season + 1}/D${clock.day + 1}/T${clock.turn ?? 0}`)
        },
      })
    }

    const result = await asyncMod.runLineageAsync(
      { ...base, seed: SEED, mating: MATING },
      decider,
      {
        dna: DNA_ON,
        concurrency: CONCURRENCY,
        decisionSource: BRAIN === 'mock' ? 'mock' : 'llm',
        onDecision: (d) => {
          pending.decisions.push(d)
          clock = { season: d.season, day: d.day, turn: d.turn }
        },
        onDay: (info) => {
          clock = { season: info.season, day: info.day }
          const n = pending.decisions.length
          const fb = pending.decisions.filter((d) => d.source === 'fallback').length
          const lat = pending.decisions.reduce((s, d) => s + (d.latencyMs ?? 0), 0)
          logProgress({
            llm: n - fb,
            fallback: fb,
            meanLatencyMs: n > 0 ? lat / n : 0,
          })
        },
      },
    )

    pending.decisions = result.decisions
    pending.mind = {
      llm: result.mind.llm,
      fallback: result.mind.fallback,
      invalid: result.mind.invalid,
      meanLatencyMs: result.mind.meanLatencyMs,
      promptTokens: usageTotals.promptTokens,
      completionTokens: usageTotals.completionTokens,
      costUsd: usageTotals.costUsd,
      budgetAtEnd: lastBudget,
      wallMs: Date.now() - t0,
    }
    writeRun(outDir, result)
    fs.writeFileSync(
      path.join(outDir, 'decisions.jsonl'),
      result.decisions.map((d) => JSON.stringify(d)).join('\n') + (result.decisions.length ? '\n' : ''),
    )
    fs.writeFileSync(path.join(outDir, 'mind.json'), JSON.stringify(pending.mind, null, 2))
    writePromptSamples(outDir, result.promptSamples ?? [])
    const expr = exprMod.expressionReport(result.events, result.state.lineage, result.summary.config)
    fs.writeFileSync(path.join(outDir, 'expression.md'), expr.markdown)
    fs.writeFileSync(path.join(outDir, 'expression.json'), JSON.stringify(expr.json, null, 2))
    pending.flushed = true
  }
} finally {
  await server.close()
}

const ms = Date.now() - t0
console.log(`out ${path.relative(ROOT, outDir)}`)
console.log(`wall ${ms} ms`)

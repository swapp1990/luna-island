/**
 * Run the lineage hamlet from Node.
 *
 *   node scripts/lineage-run.mjs [--seed 42] [--seasons 8] [--mating courtship|random]
 *     [--yield 1.0] [--mutation 0.01] [--cohort 12] [--seeds 1..20]
 *     [--out artifacts/lineage]
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

const SEED = Number(arg('seed', '42'))
const SEASONS = Number(arg('seasons', '8'))
const MATING = String(arg('mating', 'courtship'))
const YIELD = Number(arg('yield', '1.0'))
const MUTATION = Number(arg('mutation', '0.01'))
const COHORT = Number(arg('cohort', '12'))
const OUT = path.resolve(ROOT, arg('out', 'artifacts/lineage'))
const seeds = parseSeeds(arg('seeds'))

fs.mkdirSync(OUT, { recursive: true })

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5199, strictPort: false },
})
await server.listen()

const t0 = Date.now()
let outDir = OUT

try {
  const runMod = await server.ssrLoadModule('/src/lineage/run.ts')
  const TRAITS = Object.keys(runMod.DEFAULT_CONFIG).length
    ? [
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
    : []

  const base = {
    seasons: SEASONS,
    harvestYield: YIELD,
    mutationRate: MUTATION,
    cohortSize: COHORT,
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
    fs.writeFileSync(path.join(dir, 'stamp.json'), JSON.stringify(gitStamp(), null, 2))
  }

  if (seeds) {
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
  } else {
    const result = runMod.runLineage({ ...base, seed: SEED, mating: MATING })
    outDir = path.join(OUT, `${MATING}-seed${SEED}-${stampNow()}`)
    writeRun(outDir, result)
  }
} finally {
  await server.close()
}

const ms = Date.now() - t0
console.log(`out ${path.relative(ROOT, outDir)}`)
console.log(`wall ${ms} ms`)

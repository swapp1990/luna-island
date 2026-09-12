/**
 * Rank-correlation view of phenotype expression, for traits whose low band is too
 * thin for the band table (dominant voice/temper at K=12: P(low) ≈ 0.06).
 *
 *   node scripts/lineage-expression-rank.mjs <runDir> [<runDir> ...]
 *
 * Per villager: act rate = action:start of that kind / living days, where living
 * days = (mind:decision + mind:fallback events for that villager) / turnsPerDay.
 * Spearman rho between the continuous trait value and the rate across all
 * villagers who lived ≥ 1 day, with a 2,000-shuffle permutation p (one-sided,
 * rho ≥ observed). Reads lineage.json, events.jsonl, summary.json only.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const PAIRS = [
  ['generosity', 'give'],
  ['voice', 'propose'],
  ['temper', 'shun'],
  ['boldness', 'forage'],
  ['thrift', 'store'],
  ['sociability', 'court'],
  ['curiosity', 'new-talk'],
  ['caution', 'rest'],
  ['industry', 'work'],
]

function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}

function pearson(a, b) {
  const n = a.length
  const ma = a.reduce((x, y) => x + y, 0) / n
  const mb = b.reduce((x, y) => x + y, 0) / n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    sab += da * db; saa += da * da; sbb += db * db
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb)
}

function spearman(x, y) {
  return pearson(ranks(x), ranks(y))
}

function analyse(dir) {
  const lineage = JSON.parse(fs.readFileSync(path.join(dir, 'lineage.json'), 'utf8'))
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'))
  const turnsPerDay = summary.config.turnsPerDay ?? 4
  const events = fs
    .readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))

  const turns = new Map()
  const acts = new Map()
  const talked = new Map()
  for (const e of events) {
    const id = e.agentId
    if (!id) continue
    if (e.type === 'mind:decision' || e.type === 'mind:fallback') {
      turns.set(id, (turns.get(id) ?? 0) + 1)
    } else if (e.type === 'action:start') {
      const k = e.data?.kind
      if (!acts.has(id)) acts.set(id, new Map())
      const m = acts.get(id)
      m.set(k, (m.get(k) ?? 0) + 1)
    } else if (e.type === 'speech') {
      if (!talked.has(id)) talked.set(id, new Set())
      const s = talked.get(id)
      if (!s.has(e.data?.to)) {
        s.add(e.data?.to)
        if (!acts.has(id)) acts.set(id, new Map())
        const m = acts.get(id)
        m.set('new-talk', (m.get('new-talk') ?? 0) + 1)
      }
    }
  }

  const villagers = lineage.filter((r) => (turns.get(r.id) ?? 0) >= turnsPerDay)
  const rows = []
  for (const [trait, act] of PAIRS) {
    const x = villagers.map((r) => r.traits[trait])
    const y = villagers.map((r) => ((acts.get(r.id)?.get(act) ?? 0) * turnsPerDay) / (turns.get(r.id) ?? 1))
    const rho = spearman(x, y)
    const rnd = lcg(summary.config.seed + 11)
    let ge = 0
    const N = 2000
    const ys = y.slice()
    for (let t = 0; t < N; t++) {
      for (let i = ys.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        const tmp = ys[i]; ys[i] = ys[j]; ys[j] = tmp
      }
      if (spearman(x, ys) >= rho) ge++
    }
    const p = (ge + 1) / (N + 1)
    const anyAct = y.some((v) => v > 0)
    rows.push({ trait, act, n: villagers.length, rho, p, meanRate: y.reduce((a, b) => a + b, 0) / y.length, anyAct })
  }
  return rows
}

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('usage: node scripts/lineage-expression-rank.mjs <runDir> [...]')
  process.exit(2)
}
const out = ['# Rank-correlation expression', '']
for (const dir of dirs) {
  const rows = analyse(dir)
  out.push(`## ${path.basename(dir)}`, '', '| trait | act | n | mean rate/day | rho | p | expressed (rho>0, p<0.05) |', '|---|---|---|---|---|---|---|')
  let k = 0
  for (const r of rows) {
    const ex = r.rho > 0 && r.p < 0.05
    if (ex && r.trait !== 'industry') k++
    out.push(`| ${r.trait} | ${r.act} | ${r.n} | ${r.meanRate.toFixed(3)} | ${r.rho.toFixed(3)} | ${r.p.toFixed(4)} | ${ex ? 'yes' : 'no'}${r.anyAct ? '' : ' (act never taken)'} |`)
  }
  out.push('', `Expressed by rank: ${k} of 8 disposition pairs`, '')
}
const md = out.join('\n')
console.log(md)
if (dirs.length === 1) fs.writeFileSync(path.join(dirs[0], 'expression-rank.md'), md)

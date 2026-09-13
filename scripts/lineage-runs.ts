/**
 * Vite plugin: read-only Lineage showcase API over artifacts/lineage.
 *
 *   GET /api/lineage/runs
 *   GET /api/lineage/runs/:id/:file
 *   GET /api/lineage/probes
 *   GET /api/lineage/probes/:id
 *   GET /api/lineage/replicates
 *
 * Never writes. Ids are matched against readdir, so a path from the client
 * can never escape the lineage directory.
 */
import type { Connect, Plugin } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ID_RE = /^[A-Za-z0-9._-]+$/

const RUN_FILES = new Set([
  'summary.json',
  'events.jsonl',
  'decisions.jsonl',
  'lineage.json',
  'mind.json',
  'expression.json',
  'expression-rank.md',
  'expression.md',
  'chronicle.md',
  'census.md',
  'tree.md',
  'trajectories.md',
  'progress.log',
  'prompts-sample.md',
])

const CONTENT_TYPE: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
}

const DNA_DIR =
  /^(.*)-(codex|grok)-dna(on|off)-seed(\d+)-(.+)$/
const MATING_DIR = /^(courtship|random)-seed(\d+)-(.+)$/

const DISP_ACTS = new Set([
  'give',
  'propose',
  'shun',
  'forage',
  'store',
  'court',
  'talk',
  'rest',
])

function lineageDir(): string {
  return path.resolve(process.env.LUNA_LINEAGE_DIR ?? 'artifacts/lineage')
}

function listNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function send(
  res: Parameters<Connect.NextHandleFunction>[1],
  code: number,
  body: string,
  type = 'application/json; charset=utf-8',
): void {
  res.statusCode = code
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

export function parseRunDirName(id: string): {
  tag: string | null
  brain: string | null
  engine: string | null
  dna: 'on' | 'off' | null
  seed: number | null
} {
  const dna = DNA_DIR.exec(id)
  if (dna) {
    let tag = dna[1]!
    if (tag.endsWith('-on') || tag.endsWith('-off')) tag = tag.replace(/-(on|off)$/, '')
    const engine = dna[2]!
    const on = dna[3] === 'on'
    const seed = Number(dna[4])
    let brain: string | null = 'llm'
    if (tag === 'mock') brain = 'mock'
    return { tag, brain, engine, dna: on ? 'on' : 'off', seed }
  }
  const mating = MATING_DIR.exec(id)
  if (mating) {
    return {
      tag: mating[1]!,
      brain: 'instinct',
      engine: null,
      dna: null,
      seed: Number(mating[2]),
    }
  }
  if (id.startsWith('replicate-')) {
    return { tag: 'replicate', brain: null, engine: null, dna: null, seed: null }
  }
  return { tag: null, brain: null, engine: null, dna: null, seed: null }
}

function describeRun(root: string, id: string): Record<string, unknown> | null {
  const dir = path.join(root, id)
  const summaryPath = path.join(dir, 'summary.json')
  if (!fs.existsSync(summaryPath) || !fs.statSync(summaryPath).isFile()) return null
  const summary = readJson(summaryPath)
  if (!summary) return null
  const parsed = parseRunDirName(id)
  const config =
    summary.config && typeof summary.config === 'object'
      ? (summary.config as Record<string, unknown>)
      : {}
  const mind = readJson(path.join(dir, 'mind.json'))
  const stamp = readJson(path.join(dir, 'stamp.json'))
  let mtime = 0
  try {
    mtime = fs.statSync(summaryPath).mtimeMs
  } catch {
    mtime = 0
  }
  const hasDecisions = fs.existsSync(path.join(dir, 'decisions.jsonl'))
  const hasExpression = fs.existsSync(path.join(dir, 'expression.json'))
  const mindOut = mind
    ? {
        llm: num(mind.llm) ?? 0,
        fallback: num(mind.fallback) ?? 0,
        invalid: num(mind.invalid) ?? 0,
        meanLatencyMs: num(mind.meanLatencyMs) ?? 0,
      }
    : undefined
  const stampOut = stamp
    ? {
        commit: str(stamp.shortSha) ?? str(stamp.sha),
        dirty: stamp.dirty === true,
        at: mtime || null,
      }
    : undefined
  return {
    id,
    tag: parsed.tag,
    brain: hasDecisions ? parsed.brain : parsed.brain ?? 'instinct',
    engine: parsed.engine,
    dna: parsed.dna,
    seed: parsed.seed ?? num(config.seed),
    harvestYield: num(config.harvestYield),
    seasons: num(summary.seasons) ?? num(config.seasons),
    cohort: num(config.cohortSize),
    mating: str(config.mating),
    generationsBorn: num(summary.generationsBorn),
    departuresByStarvation: num(summary.departuresByStarvation),
    hash: str(summary.hash),
    eventCount: num(summary.eventCount),
    mind: mindOut,
    stamp: stampOut,
    hasDecisions,
    hasExpression,
    mtime,
  }
}

function kindOf(rec: unknown): string {
  if (!rec || typeof rec !== 'object') return ''
  const k = (rec as { kind?: unknown }).kind
  return typeof k === 'string' ? k : ''
}

function describeProbe(root: string, file: string): Record<string, unknown> | null {
  const full = path.join(root, 'probes', file)
  const json = readJson(full)
  if (!json) return null
  const id = file.replace(/\.json$/i, '')
  const results = Array.isArray(json.results) ? json.results : []
  let recordedDisposition = 0
  let probeDisposition = 0
  let changed = 0
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const rec = kindOf((row as { recorded?: unknown }).recorded)
    const probe = kindOf((row as { probe?: unknown }).probe)
    if (DISP_ACTS.has(rec)) recordedDisposition += 1
    if (DISP_ACTS.has(probe)) probeDisposition += 1
    if (rec !== probe) changed += 1
  }
  const dnaMatch = /dna(on|off)/i.exec(id)
  const tokens = id.split('-')
  const bands = tokens.filter((t) => t === 'low' || t === 'mid' || t === 'high')
  const effort = str(json.effort)
  let band: string | null = null
  if (bands.length >= 2) band = bands[1]!
  else if (bands.length === 1 && bands[0] !== effort) band = bands[0]!
  return {
    id,
    mode: str(json.mode),
    effort,
    dna: dnaMatch ? (dnaMatch[1]!.toLowerCase() === 'on' ? 'on' : 'off') : null,
    band,
    summary: {
      n: results.length,
      recordedDisposition,
      probeDisposition,
      changed,
    },
    run: str(json.run),
  }
}

function rewriteLineage(req: { url?: string }): void {
  const raw = req.url ?? ''
  const qIndex = raw.indexOf('?')
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const query = qIndex >= 0 ? raw.slice(qIndex) : ''
  if (pathname === '/lineage' || pathname === '/lineage/') {
    req.url = `/lineage.html${query}`
  }
}

export function lineageMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (!url.startsWith('/api/lineage')) return next()
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'GET only' }))

    const root = lineageDir()

    if (url === '/api/lineage/runs' || url === '/api/lineage/runs/') {
      const names = listNames(root)
      const runs: Record<string, unknown>[] = []
      for (const name of names) {
        if (name === 'probes') continue
        let st: fs.Stats
        try {
          st = fs.statSync(path.join(root, name))
        } catch {
          continue
        }
        if (!st.isDirectory()) continue
        const row = describeRun(root, name)
        if (row) runs.push(row)
      }
      runs.sort((a, b) => Number(b.mtime ?? 0) - Number(a.mtime ?? 0))
      return send(res, 200, JSON.stringify(runs))
    }

    if (url === '/api/lineage/probes' || url === '/api/lineage/probes/') {
      const names = listNames(path.join(root, 'probes')).filter((n) => n.endsWith('.json'))
      const probes: Record<string, unknown>[] = []
      for (const name of names) {
        const row = describeProbe(root, name)
        if (row) probes.push(row)
      }
      return send(res, 200, JSON.stringify(probes))
    }

    const probeOne = /^\/api\/lineage\/probes\/([^/]+)$/.exec(url)
    if (probeOne) {
      const id = decodeURIComponent(probeOne[1]!)
      if (!ID_RE.test(id)) return send(res, 400, JSON.stringify({ error: 'bad id' }))
      const names = listNames(path.join(root, 'probes'))
      const file = `${id}.json`
      if (!names.includes(file)) return send(res, 404, JSON.stringify({ error: `probe ${id} not found` }))
      try {
        const buf = fs.readFileSync(path.join(root, 'probes', file))
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        return res.end(buf)
      } catch (err) {
        return send(res, 404, JSON.stringify({ error: String(err).slice(0, 200) }))
      }
    }

    if (url === '/api/lineage/replicates' || url === '/api/lineage/replicates/') {
      const names = listNames(root).filter((n) => n.startsWith('replicate-'))
      const rows: Record<string, unknown>[] = []
      for (const name of names) {
        const file = path.join(root, name, 'aggregate.json')
        if (!fs.existsSync(file)) continue
        const json = readJson(file)
        if (!json) continue
        rows.push({
          id: name,
          yield: num(json.yield),
          n: num(json.n),
          deltas: json.deltas ?? null,
        })
      }
      return send(res, 200, JSON.stringify(rows))
    }

    const runFile = /^\/api\/lineage\/runs\/([^/]+)\/([^/]+)$/.exec(url)
    if (!runFile) return send(res, 404, JSON.stringify({ error: 'no such lineage route' }))

    const id = decodeURIComponent(runFile[1]!)
    const file = decodeURIComponent(runFile[2]!)
    if (!ID_RE.test(id)) return send(res, 400, JSON.stringify({ error: 'bad id' }))
    if (!RUN_FILES.has(file)) return send(res, 404, JSON.stringify({ error: 'no such file' }))

    const names = listNames(root)
    if (!names.includes(id)) return send(res, 404, JSON.stringify({ error: `run ${id} not found` }))

    const full = path.join(root, id, file)
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return send(res, 404, JSON.stringify({ error: `run ${id} has no ${file}` }))
    }
    const ext = path.extname(file).toLowerCase()
    try {
      const buf = fs.readFileSync(full)
      res.statusCode = 200
      res.setHeader('Content-Type', CONTENT_TYPE[ext] ?? 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-store')
      return res.end(buf)
    } catch (err) {
      return send(res, 404, JSON.stringify({ error: String(err).slice(0, 200) }))
    }
  }
}

export function lineageRunsPlugin(): Plugin {
  return {
    name: 'luna-lineage-runs',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewriteLineage(req)
        next()
      })
      server.middlewares.use(lineageMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewriteLineage(req)
        next()
      })
      server.middlewares.use(lineageMiddleware())
    },
  }
}

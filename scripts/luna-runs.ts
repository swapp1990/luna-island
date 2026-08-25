/**
 * Vite plugin: read-only Run Theater API over recorded soak artifacts.
 *
 *   GET /api/runs                 → { runs: RunIndexEntry[] }   (newest first)
 *   GET /api/runs/:id/world       → the raw world save JSON
 *   GET /api/runs/:id/summary     → the run's summary JSON
 *   GET /api/runs/:id/story       → the run's qualitative story JSON
 *   GET /api/runs/:id/journal     → { rows: JournalRow[] }      (parsed JSONL)
 *   GET /api/runs/:id/highlights  → the photographer manifest the run shot
 *   GET /api/runs/:id/still/:file → one still from that manifest (PNG)
 *
 * Never writes. Ids are matched against the scanned directory listing, so a
 * path from the client can never escape the runs directory.
 */
import type { Connect, Plugin } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  groupRunFiles,
  type RunFileGroup,
  type RunIndexEntry,
} from './luna-run-files'

export type { RunFileGroup, RunIndexEntry } from './luna-run-files'
export { groupRunFiles, isWatchable } from './luna-run-files'
/** Run ids are opaque timestamps; anything else never reaches the disk. */
const ID_RE = /^[A-Za-z0-9_-]+$/

function runsDir(): string {
  return path.resolve(process.env.LUNA_RUNS_DIR ?? 'artifacts')
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

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/** Parse a soak journal, skipping corrupt lines rather than failing the run. */
export function parseJournal(raw: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t) as Record<string, unknown>)
    } catch {
      // a killed harness can leave a half-written last line
    }
  }
  return rows
}

/**
 * Where `soak-highlights.mjs` parks a run's reel:
 * `<dir>/highlights/<world basename without .json>/highlights.json`.
 */
export function highlightsDirFor(dir: string, worldName: string | undefined): string | null {
  if (!worldName) return null
  return path.join(dir, 'highlights', path.basename(worldName, '.json'))
}

/** Describe one grouped run for the browser list. */
export function describeRun(dir: string, g: RunFileGroup): RunIndexEntry {
  const summary = g.summary ? readJson(path.join(dir, g.summary)) : null
  const params =
    summary && typeof summary.params === 'object' && summary.params !== null
      ? (summary.params as Record<string, unknown>)
      : null
  const counts =
    summary && typeof summary.counts === 'object' && summary.counts !== null
      ? (summary.counts as Record<string, number>)
      : null

  const day = summary ? num(summary.day) : null
  const wallMin = summary ? num(summary.wallMin) : null
  const seed = params ? num(params.seed) : null
  const bits: string[] = []
  if (day != null) bits.push(`Day ${day}`)
  if (wallMin != null) bits.push(`${wallMin}m`)
  if (seed != null) bits.push(`seed ${seed}`)
  if (bits.length === 0) bits.push(g.world ? 'recorded run' : 'journal only')

  const reelDir = highlightsDirFor(dir, g.world)
  return {
    id: g.id,
    label: bits.join(' · '),
    exportTs: g.exportTs,
    startTs: g.startTs,
    hasWorld: !!g.world,
    hasJournal: !!g.journal,
    hasHighlights: !!reelDir && fs.existsSync(path.join(reelDir, 'highlights.json')),
    worldBytes: g.world ? sizeOf(path.join(dir, g.world)) : 0,
    params,
    git:
      summary && typeof summary.git === 'object' && summary.git !== null
        ? (summary.git as RunIndexEntry['git'])
        : null,
    headline: summary
      ? {
          wallMin,
          simDays: num(summary.simDays),
          day,
          decisions: num(summary.decisions),
          breathePct: num(summary.breathePct),
          counts,
        }
      : null,
  }
}

function send(res: Parameters<Connect.NextHandleFunction>[1], code: number, body: string): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

export function runsMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (!url.startsWith('/api/runs')) return next()
    if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'GET only' }))

    const dir = runsDir()
    const groups = groupRunFiles(listNames(dir))

    if (url === '/api/runs' || url === '/api/runs/') {
      const runs = groups.map((g) => describeRun(dir, g))
      return send(res, 200, JSON.stringify({ dir, runs }))
    }

    // The photographer's own reel for this run, plus the stills it shot.
    const reel = /^\/api\/runs\/([^/]+)\/(highlights|still\/([^/]+))$/.exec(url)
    if (reel) {
      const id = decodeURIComponent(reel[1]!)
      if (!ID_RE.test(id)) return send(res, 400, JSON.stringify({ error: 'bad id' }))
      const g = groups.find((x) => x.id === id)
      const reelDir = g ? highlightsDirFor(dir, g.world) : null
      if (!reelDir) return send(res, 404, JSON.stringify({ error: `run ${id} has no reel` }))

      const manifestPath = path.join(reelDir, 'highlights.json')
      const manifest = readJson(manifestPath)
      if (!manifest) {
        return send(res, 404, JSON.stringify({ error: `run ${id} has no reel` }))
      }
      if (reel[2] === 'highlights') return send(res, 200, JSON.stringify(manifest))

      // Serve a still only if the manifest itself names it — the request never
      // reaches the filesystem on its own.
      const wanted = decodeURIComponent(reel[3]!)
      const shots = Array.isArray(manifest.shots) ? manifest.shots : []
      const named = shots.some(
        (s) => typeof (s as { file?: unknown })?.file === 'string' && s.file === wanted,
      )
      if (!named) return send(res, 404, JSON.stringify({ error: 'no such still' }))
      try {
        const buf = fs.readFileSync(path.join(reelDir, wanted))
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'no-store')
        return res.end(buf)
      } catch (err) {
        return send(res, 404, JSON.stringify({ error: String(err).slice(0, 200) }))
      }
    }

    const m = /^\/api\/runs\/([^/]+)\/(world|summary|story|journal)$/.exec(url)
    if (!m) return send(res, 404, JSON.stringify({ error: 'no such run route' }))

    const id = decodeURIComponent(m[1]!)
    const role = m[2] as 'world' | 'summary' | 'story' | 'journal'
    if (!ID_RE.test(id)) return send(res, 400, JSON.stringify({ error: 'bad id' }))

    const g = groups.find((x) => x.id === id)
    if (!g) return send(res, 404, JSON.stringify({ error: `run ${id} not found` }))
    const name = g[role]
    if (!name) return send(res, 404, JSON.stringify({ error: `run ${id} has no ${role}` }))

    // `name` came from readdir on `dir`, never from the request.
    const file = path.join(dir, name)

    // A journal is small and needs parsing; a world export is tens of
    // megabytes. Reading one synchronously would block the dev server's only
    // thread long enough to stall every other page it is serving — stream it.
    if (role === 'journal') {
      try {
        return send(res, 200, JSON.stringify({ rows: parseJournal(fs.readFileSync(file, 'utf8')) }))
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: String(err).slice(0, 200) }))
      }
    }

    let size = 0
    try {
      size = fs.statSync(file).size
    } catch (err) {
      return send(res, 404, JSON.stringify({ error: String(err).slice(0, 200) }))
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', String(size))
    res.setHeader('Cache-Control', 'no-store')
    const stream = fs.createReadStream(file)
    stream.on('error', () => {
      // Headers are already out; the client sees a truncated body and throws.
      res.end()
    })
    return stream.pipe(res)
  }
}

export function lunaRunsPlugin(): Plugin {
  return {
    name: 'luna-runs',
    configureServer(server) {
      server.middlewares.use(runsMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(runsMiddleware())
    },
  }
}

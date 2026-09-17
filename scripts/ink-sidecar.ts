/**
 * Vite plugin: Ink Town grok-mind sidecar.
 * GET  /api/ink/health
 * POST /api/ink/decide  { system, user, mindId, tick } → { text, latencyMs, usage }
 * POST /api/ink/journal { runId, ... } → append one JSONL line
 *
 * Own budget, own key, own routes. Does not touch luna-sidecar.
 */
import type { Connect, Plugin } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  DEFAULT_XAI_MODEL,
  XAI_KILL_MS,
  listXaiModelIds,
  resolveInkModel,
  resolveXaiKey,
  runXaiWithDeps,
} from './luna-xai'

const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_MAX_PER_HOUR = 600
const DEFAULT_MAX_PER_DAY = 4000
const MAX_IN_FLIGHT = 4

function parseEnvInt(name: string, fallback: number, env: Record<string, string | undefined>): number {
  const raw = env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(
  res: Connect.ServerResponse,
  status: number,
  json: unknown,
): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(json))
}

function preview(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= 120 ? t : `${t.slice(0, 117)}...`
}

function dayKeyAt(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hourKeyAt(ms: number): string {
  const d = new Date(ms)
  return `${dayKeyAt(ms)}-${String(d.getHours()).padStart(2, '0')}`
}

class InkBudget {
  hourKey = ''
  dayKey = ''
  hour = 0
  day = 0
  constructor(
    readonly maxPerHour: number,
    readonly maxPerDay: number,
    private readonly now: () => number,
  ) {}

  private roll(): void {
    const n = this.now()
    const h = hourKeyAt(n)
    const d = dayKeyAt(n)
    if (h !== this.hourKey) {
      this.hourKey = h
      this.hour = 0
    }
    if (d !== this.dayKey) {
      this.dayKey = d
      this.day = 0
    }
  }

  snapshot(): { hour: number; day: number; maxPerHour: number; maxPerDay: number } {
    this.roll()
    return {
      hour: this.hour,
      day: this.day,
      maxPerHour: this.maxPerHour,
      maxPerDay: this.maxPerDay,
    }
  }

  spent(): boolean {
    this.roll()
    return this.hour >= this.maxPerHour || this.day >= this.maxPerDay
  }

  take(): void {
    this.roll()
    this.hour += 1
    this.day += 1
  }
}

function fetchInk(
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  },
): Promise<Response> {
  if (init.method === 'GET' || init.method === 'HEAD') {
    return fetch(url, { method: init.method, headers: init.headers, signal: init.signal })
  }
  return fetch(url, init)
}

export function inkSidecarPlugin(): Plugin {
  return {
    name: 'ink-sidecar',
    configureServer(server) {
      const env = process.env
      const cwd = process.cwd()
      const resolved = resolveXaiKey(env, (p) => fs.readFileSync(p, 'utf8'), cwd)
      const model = resolveInkModel(env)
      const maxPerHour = parseEnvInt('INK_MAX_PER_HOUR', DEFAULT_MAX_PER_HOUR, env)
      const maxPerDay = parseEnvInt('INK_MAX_PER_DAY', DEFAULT_MAX_PER_DAY, env)
      const debug = env.INK_DEBUG === '1'
      const budget = new InkBudget(maxPerHour, maxPerDay, () => Date.now())
      let inFlight = 0
      let modelListed = false

      // eslint-disable-next-line no-console
      console.log(
        `[ink-sidecar] model=${model} key=${resolved.source} maxPerHour=${maxPerHour} maxPerDay=${maxPerDay}`,
      )

      if (resolved.key && !process.env.VITEST) {
        void listXaiModelIds({
          apiKey: resolved.key,
          timeoutMs: 3000,
          fetchImpl: fetchInk,
        })
          .then((ids) => {
            // eslint-disable-next-line no-console
            console.log(`[ink-sidecar] models: ${ids.join(', ')}`)
            modelListed = ids.includes(model)
            if (!modelListed) {
              // eslint-disable-next-line no-console
              console.log(
                `[ink-sidecar] configured model ${model} is not in the account list: ${ids.join(', ')}`,
              )
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            // eslint-disable-next-line no-console
            console.log(`[ink-sidecar] model list failed: ${msg.slice(0, 120)}`)
          })
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === '/api/ink/health' && req.method === 'GET') {
          send(res, 200, {
            ok: resolved.source !== 'missing',
            model,
            keySource: resolved.source,
            modelListed,
            budget: budget.snapshot(),
            inFlight,
          })
          return
        }

        if (url === '/api/ink/decide' && req.method === 'POST') {
          try {
            const raw = await readBody(req)
            let body: { system?: unknown; user?: unknown; mindId?: unknown; tick?: unknown }
            try {
              body = JSON.parse(raw) as typeof body
            } catch {
              send(res, 400, { error: 'invalid JSON body' })
              return
            }
            if (typeof body.system !== 'string' || typeof body.user !== 'string') {
              send(res, 400, { error: 'system and user required' })
              return
            }
            if (!resolved.key) {
              send(res, 503, { error: 'no-key' })
              return
            }
            if (budget.spent()) {
              send(res, 402, { error: 'budget' })
              return
            }
            if (inFlight >= MAX_IN_FLIGHT) {
              send(res, 429, { error: 'busy' })
              return
            }

            if (debug) {
              const mind = typeof body.mindId === 'string' ? body.mindId : '?'
              // eslint-disable-next-line no-console
              console.log(
                `[ink-sidecar] decide mind=${mind} sys=${preview(body.system)} user=${preview(body.user)}`,
              )
            }

            inFlight += 1
            budget.take()
            try {
              const result = await runXaiWithDeps(body.system, body.user, {
                apiKey: resolved.key,
                model,
                killMs: XAI_KILL_MS,
                jsonMode: true,
                now: () => Date.now(),
                fetchImpl: fetchInk,
                sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
              })
              if (debug) {
                // eslint-disable-next-line no-console
                console.log(`[ink-sidecar] reply ${preview(result.text)}`)
              }
              send(res, 200, {
                text: result.text,
                latencyMs: result.latencyMs,
                usage: result.usage,
              })
            } catch (err) {
              const detail = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
              send(res, 502, { error: 'upstream', detail })
            } finally {
              inFlight -= 1
            }
          } catch (err) {
            next(err)
          }
          return
        }

        if (url === '/api/ink/journal' && req.method === 'POST') {
          try {
            const raw = await readBody(req)
            let body: unknown
            try {
              body = JSON.parse(raw)
            } catch {
              send(res, 400, { error: 'invalid JSON body' })
              return
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              send(res, 400, { error: 'record must be an object' })
              return
            }
            const runId = (body as { runId?: unknown }).runId
            if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) {
              send(res, 400, { error: 'bad-run-id' })
              return
            }
            const dir = path.join(cwd, 'artifacts', 'ink', runId)
            fs.mkdirSync(dir, { recursive: true })
            const file = path.join(dir, 'journal.jsonl')
            fs.appendFileSync(file, `${JSON.stringify(body)}\n`, 'utf8')
            send(res, 200, { ok: true })
          } catch (err) {
            next(err)
          }
          return
        }

        next()
      })
    },
  }
}

export { DEFAULT_XAI_MODEL, DEFAULT_MAX_PER_HOUR, DEFAULT_MAX_PER_DAY }

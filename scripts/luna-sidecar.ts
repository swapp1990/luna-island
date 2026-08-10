/**
 * Vite plugin: Codex sidecar for LunaBrain.
 * GET  /api/luna/health
 * POST /api/luna/decide  { system, user } → { text }
 *
 * Spawns `codex exec -s read-only -` with cwd = empty scratch dir.
 * One in-flight request; extras get 429.
 */
import type { Plugin, Connect } from 'vite'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const SCRATCH = path.join(os.tmpdir(), 'luna-mind')
// Measured: a cold `codex exec` round-trip takes ~30s on this machine — the
// original 25s ceiling killed healthy calls. The sim never blocks on a mind.
const KILL_MS = 60_000

function ensureScratch(): void {
  fs.mkdirSync(SCRATCH, { recursive: true })
}

function extractJsonObject(text: string): string | null {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function stripFences(text: string): string {
  const extracted = extractJsonObject(text)
  return extracted ?? text.trim()
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function runCodex(system: string, user: string): Promise<{ text: string; latencyMs: number }> {
  const prompt = `${system}\n\n---\n\n${user}\n`
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    // --skip-git-repo-check: scratch cwd is intentionally not a git repo
    const child = spawn(
      'codex',
      ['exec', '-s', 'read-only', '--skip-git-repo-check', '-'],
      {
        cwd: SCRATCH,
        env: { ...process.env },
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500)
      reject(new Error(`codex kill-timeout after ${KILL_MS}ms`))
    }, KILL_MS)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const latencyMs = Date.now() - t0
      if (code !== 0 && !stdout.trim()) {
        reject(
          new Error(
            `codex exit ${code}: ${stderr.slice(0, 400) || 'no output'}`,
          ),
        )
        return
      }
      resolve({ text: stripFences(stdout), latencyMs })
    })
    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

function attachMiddleware(
  middlewares: Connect.Server,
  busy: { current: boolean },
): void {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url === '/api/luna/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, scratch: SCRATCH }))
      return
    }
    if (url === '/api/luna/decide' && req.method === 'POST') {
      if (busy.current) {
        res.statusCode = 429
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'busy' }))
        return
      }
      try {
        const raw = await readBody(req)
        let body: { system?: string; user?: string }
        try {
          body = JSON.parse(raw) as { system?: string; user?: string }
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'invalid JSON body' }))
          return
        }
        const system = body.system ?? ''
        const user = body.user ?? ''
        busy.current = true
        try {
          const { text, latencyMs } = await runCodex(system, user)
          // eslint-disable-next-line no-console
          console.log(`[luna-sidecar] decide ${latencyMs}ms chars=${text.length}`)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text, latencyMs }))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // eslint-disable-next-line no-console
          console.error(`[luna-sidecar] error: ${msg}`)
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: msg }))
        } finally {
          busy.current = false
        }
      } catch (err) {
        busy.current = false
        next(err)
      }
      return
    }
    next()
  })
}

export function lunaSidecarPlugin(): Plugin {
  ensureScratch()
  const busy = { current: false }
  return {
    name: 'luna-sidecar',
    configureServer(server) {
      attachMiddleware(server.middlewares, busy)
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, busy)
    },
  }
}

export default lunaSidecarPlugin

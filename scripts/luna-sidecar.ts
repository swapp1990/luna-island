/**
 * Vite plugin: Codex sidecar for LunaBrain.
 * GET  /api/luna/health
 * POST /api/luna/decide  { system, user } → { text }
 *
 * Spawns `codex exec -s read-only -` with cwd = empty scratch dir.
 * One in-flight request; extras get 429.
 * Hard budget gates (hour + day) → 402 before any codex spawn.
 */
import type { Plugin, Connect } from 'vite'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  BudgetTracker,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_MAX_PER_HOUR,
  handleDecide,
  healthPayload,
  type BudgetSnapshot,
  type CodexRunner,
  type SidecarDeps,
} from './luna-budget'

export {
  BudgetTracker,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_MAX_PER_HOUR,
  handleDecide,
  healthPayload,
}
export type { BudgetSnapshot, CodexRunner, SidecarDeps }

const SCRATCH = path.join(os.tmpdir(), 'luna-mind')
// Measured: a cold `codex exec` round-trip takes ~30s on this machine — the
// original 25s ceiling killed healthy calls. The sim never blocks on a mind.
const KILL_MS = 60_000

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

function ensureScratch(): void {
  fs.mkdirSync(SCRATCH, { recursive: true })
}

function filePersist(scratchDir: string) {
  const p = path.join(scratchDir, 'budget.json')
  return {
    load(): string | null {
      try {
        return fs.readFileSync(p, 'utf8')
      } catch {
        return null
      }
    },
    save(json: string): void {
      fs.mkdirSync(scratchDir, { recursive: true })
      fs.writeFileSync(p, json, 'utf8')
    },
  }
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

export function runCodex(system: string, user: string): Promise<{ text: string; latencyMs: number }> {
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
  deps: SidecarDeps,
  scratchDir: string,
): void {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url === '/api/luna/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(healthPayload(deps.budget, scratchDir)))
      return
    }
    if (url === '/api/luna/decide' && req.method === 'POST') {
      try {
        // Budget is the first gate inside handleDecide — before busy / runner.
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
        const result = await handleDecide(deps, body)
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        const b = result.json.budget as BudgetSnapshot | undefined
        if (b) {
          res.setHeader('X-Luna-Budget-Used-Hour', String(b.usedHour))
          res.setHeader('X-Luna-Budget-Max-Hour', String(b.maxHour))
          res.setHeader('X-Luna-Budget-Used-Day', String(b.usedDay))
          res.setHeader('X-Luna-Budget-Max-Day', String(b.maxDay))
        }
        res.end(JSON.stringify(result.json))
      } catch (err) {
        deps.busy.current = false
        next(err)
      }
      return
    }
    next()
  })
}

export function lunaSidecarPlugin(): Plugin {
  ensureScratch()
  const limits = {
    maxPerHour: parseEnvInt('LUNA_MAX_PER_HOUR', DEFAULT_MAX_PER_HOUR),
    maxPerDay: parseEnvInt('LUNA_MAX_PER_DAY', DEFAULT_MAX_PER_DAY),
  }
  const budget = new BudgetTracker(limits, {
    persist: filePersist(SCRATCH),
  })
  const busy = { current: false }
  const deps: SidecarDeps = {
    busy,
    budget,
    runner: runCodex,
  }
  return {
    name: 'luna-sidecar',
    configureServer(server) {
      attachMiddleware(server.middlewares, deps, SCRATCH)
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, deps, SCRATCH)
    },
  }
}

export default lunaSidecarPlugin

/**
 * Vite plugin: Codex sidecar for LunaBrain.
 * GET  /api/luna/health
 * POST /api/luna/decide  { system, user } → { text }
 *
 * Primary path: one persistent `codex mcp-server` (stdio JSON-RPC; concurrent
 * tools/call measured), each decide a fresh `codex` tool call. Cold `codex exec`
 * is the fallback.
 * Up to K concurrent in-flight requests (LUNA_CONCURRENCY, default 3, clamp 1–4);
 * extras get 429. Hard budget gates (hour + day) → 402 before any worker call.
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
  type SidecarDeps,
  type WorkerHealth,
} from './luna-budget'
import {
  createMindWorkerPool,
  stripFences,
  type McpTransport,
  type MindWorkerPool,
} from './luna-mcp-worker'

export {
  BudgetTracker,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_MAX_PER_HOUR,
  handleDecide,
  healthPayload,
}
export type { BudgetSnapshot, SidecarDeps, WorkerHealth }

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

/** Sidecar worker pool size: LUNA_CONCURRENCY env, default 3, clamp 1–4. */
function resolveSidecarConcurrency(): number {
  const n = parseEnvInt('LUNA_CONCURRENCY', 3)
  return Math.max(1, Math.min(4, n))
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

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Spawn `codex mcp-server` matching today's exec guarantees.
 * mcp-server has no `--skip-git-repo-check` flag; `-c skip_git_repo_check=true`
 * plus per-request `config` is the equivalent. Sandbox via `-c` and per-request.
 */
export function spawnCodexMcpTransport(scratchDir: string): McpTransport {
  const child = spawn(
    'codex',
    [
      'mcp-server',
      '-c',
      'sandbox_mode="read-only"',
      '-c',
      'approval_policy="never"',
      '-c',
      'skip_git_repo_check=true',
    ],
    {
      cwd: scratchDir,
      env: { ...process.env },
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  child.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString('utf8').trim()
    if (!msg) return
    // eslint-disable-next-line no-console
    console.error(`[luna-sidecar] mcp-server: ${msg.slice(0, 400)}`)
  })
  return {
    write(line: string): void {
      child.stdin?.write(line.endsWith('\n') ? line : `${line}\n`)
    },
    onChunk(cb: (chunk: string) => void): void {
      child.stdout?.on('data', (d: Buffer) => {
        cb(d.toString('utf8'))
      })
    },
    onExit(cb: (code: number | null, signal: string | null) => void): void {
      child.on('close', (code, signal) => {
        cb(code, signal)
      })
    },
    kill(signal?: string): void {
      child.kill((signal as NodeJS.Signals | undefined) ?? 'SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500)
    },
  }
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
  getWorker: () => WorkerHealth,
): void {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url === '/api/luna/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(healthPayload(deps.budget, scratchDir, getWorker())))
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
        // handleDecide always releases its lane in finally; nothing to clear here.
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
  const concurrency = resolveSidecarConcurrency()
  const busy = { count: 0, max: concurrency }
  // One mcp-server multiplexes overlapping `codex` tool calls (measured:
  // two in-flight calls finished in ~max, not ~sum). HTTP still caps at K.
  const pool: MindWorkerPool = createMindWorkerPool({
    createTransport: () => spawnCodexMcpTransport(SCRATCH),
    fallback: runCodex,
    maxWorkers: 1,
    scratchDir: SCRATCH,
    killMs: KILL_MS,
  })
  // eslint-disable-next-line no-console
  console.log(`[luna-sidecar] concurrency=${concurrency} worker=mcp`)
  const deps: SidecarDeps = {
    busy,
    budget,
    runner: (system, user) => pool.decide(system, user),
  }
  return {
    name: 'luna-sidecar',
    configureServer(server) {
      attachMiddleware(server.middlewares, deps, SCRATCH, () => pool.status())
      server.httpServer?.on('close', () => pool.dispose())
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares, deps, SCRATCH, () => pool.status())
      server.httpServer?.on('close', () => pool.dispose())
    },
  }
}

export default lunaSidecarPlugin

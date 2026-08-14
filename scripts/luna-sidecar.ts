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
  type MindEngine,
  type SidecarDeps,
  type WorkerHealth,
} from './luna-budget'
import {
  createMindWorkerPool,
  type McpTransport,
  type MindWorkerPool,
} from './luna-mcp-worker'
import {
  DEFAULT_GROK_MODEL,
  GROK_KILL_MS,
  runGrokWithDeps,
} from './luna-grok'
import {
  REFLECT_EFFORT,
  classifyMindRequest,
  effortOverrideFor,
  ensureMindHome,
  mcpServerArgs,
  mindHomePath,
  recopyAuth,
  resolveDecideEffort,
  withCodexHome,
  type MindHomeFs,
} from './luna-mind-home'
import {
  CODEX_KILL_MS,
  runCodexWithDeps,
  type CodexSpawnChild,
  type CodexSpawnOptions,
} from './luna-codex-exec'

export { DEFAULT_GROK_MODEL, GROK_KILL_MS, runGrokWithDeps } from './luna-grok'
export { runCodexWithDeps } from './luna-codex-exec'

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
const KILL_MS = CODEX_KILL_MS

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

/** Default engine when the request omits `engine`. LUNA_ENGINE, default `codex`. */
export function resolveDefaultEngine(): MindEngine {
  return process.env.LUNA_ENGINE === 'grok' ? 'grok' : 'codex'
}

/** Grok CLI model id. LUNA_GROK_MODEL, default `grok-4.6`. */
export function resolveGrokModel(): string {
  const raw = process.env.LUNA_GROK_MODEL
  if (raw == null || raw.trim() === '') return DEFAULT_GROK_MODEL
  return raw.trim()
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

export interface CodexMcpSpawnOpts {
  env?: Record<string, string | undefined>
  win32?: boolean
  spawnImpl?: (
    command: string,
    args: string[],
    options: CodexSpawnOptions,
  ) => CodexSpawnChild
}

/**
 * Spawn `codex mcp-server` matching today's exec guarantees.
 * mcp-server has no `--skip-git-repo-check` flag; `-c skip_git_repo_check=true`
 * plus per-request `config` is the equivalent. Sandbox via `-c` and per-request.
 */
export function spawnCodexMcpTransport(
  scratchDir: string,
  opts?: CodexMcpSpawnOpts,
): McpTransport {
  const env = opts?.env ?? withCodexHome({ ...process.env }, mindHomePath(os.tmpdir()))
  const spawnImpl = opts?.spawnImpl ?? spawn
  const win32 = opts?.win32 ?? process.platform === 'win32'
  const child = spawnImpl('codex', mcpServerArgs(), {
    cwd: scratchDir,
    env,
    shell: win32,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
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

export function runCodex(
  system: string,
  user: string,
  opts?: {
    effort?: string
    recopyAuth?: () => void
    env?: Record<string, string | undefined>
  },
): Promise<{ text: string; latencyMs: number }> {
  return runCodexWithDeps(system, user, {
    scratchDir: SCRATCH,
    env: opts?.env ?? withCodexHome({ ...process.env }, mindHomePath(os.tmpdir())),
    effort: opts?.effort,
    win32: process.platform === 'win32',
    now: () => Date.now(),
    recopyAuth: opts?.recopyAuth,
    spawnImpl: (command, args, options) => spawn(command, args, options),
  })
}

/**
 * One-shot `grok --prompt-file` per decide. Prompt file is unique per request
 * and always unlinked (success, nonzero exit, spawn error, kill-timeout).
 */
export function runGrok(
  system: string,
  user: string,
): Promise<{ text: string; latencyMs: number; worker: 'grok' }> {
  return runGrokWithDeps(system, user, {
    scratchDir: SCRATCH,
    model: resolveGrokModel(),
    killMs: GROK_KILL_MS,
    now: () => Date.now(),
    pid: process.pid,
    win32: process.platform === 'win32',
    env: { ...process.env },
    spawnImpl: (command, args, options) => spawn(command, args, options),
    writeFile: (p, data) => fs.writeFileSync(p, data, 'utf8'),
    unlink: (p) => fs.unlinkSync(p),
    mkdir: (p) => {
      fs.mkdirSync(p, { recursive: true })
    },
  })
}

function attachMiddleware(
  middlewares: Connect.Server,
  deps: SidecarDeps,
  scratchDir: string,
  getWorker: () => WorkerHealth,
  mindHome: boolean,
): void {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url === '/api/luna/health' && req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify(healthPayload(deps.budget, scratchDir, getWorker(), mindHome)),
      )
      return
    }
    if (url === '/api/luna/decide' && req.method === 'POST') {
      try {
        // Budget is the first gate inside handleDecide — before busy / runner.
        const raw = await readBody(req)
        let body: { system?: string; user?: string; engine?: string; kind?: string }
        try {
          body = JSON.parse(raw) as {
            system?: string
            user?: string
            engine?: string
            kind?: string
          }
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

function realMindFs(): MindHomeFs {
  return {
    mkdir: (dirPath) => {
      fs.mkdirSync(dirPath, { recursive: true })
    },
    writeFile: (filePath, data) => {
      fs.writeFileSync(filePath, data, 'utf8')
    },
    readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
  }
}

export function lunaSidecarPlugin(): Plugin {
  ensureScratch()
  const mindFs = realMindFs()
  const mindLog = (msg: string) => {
    // eslint-disable-next-line no-console
    console.log(msg)
  }
  const mind = ensureMindHome({
    tmpdir: os.tmpdir(),
    homedir: os.homedir(),
    env: process.env,
    fs: mindFs,
    log: mindLog,
  })
  const reflectMind = ensureMindHome({
    tmpdir: os.tmpdir(),
    homedir: os.homedir(),
    env: process.env,
    fs: mindFs,
    variant: 'reflect',
    log: mindLog,
  })
  const homeEffort = resolveDecideEffort(process.env)
  const mindEnv = withCodexHome({ ...process.env }, mind.home)
  const reflectEnv = withCodexHome({ ...process.env }, reflectMind.home)
  const recopyMindAuth = () => {
    recopyAuth({
      tmpdir: os.tmpdir(),
      homedir: os.homedir(),
      fs: mindFs,
      log: mindLog,
    })
    recopyAuth({
      tmpdir: os.tmpdir(),
      homedir: os.homedir(),
      fs: mindFs,
      variant: 'reflect',
      log: mindLog,
    })
  }
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
    createTransport: () =>
      spawnCodexMcpTransport(SCRATCH, {
        env: mindEnv,
      }),
    fallback: (system, user, effort) =>
      runCodex(system, user, {
        effort,
        recopyAuth: recopyMindAuth,
        env: mindEnv,
      }),
    maxWorkers: 1,
    scratchDir: SCRATCH,
    killMs: KILL_MS,
    onUnauthorized: recopyMindAuth,
  })
  const defaultEngine = resolveDefaultEngine()
  const workerLabel = defaultEngine === 'grok' ? 'grok' : 'mcp'
  // eslint-disable-next-line no-console
  console.log(`[luna-sidecar] concurrency=${concurrency} worker=${workerLabel}`)
  const deps: SidecarDeps = {
    busy,
    budget,
    runner: (system, user, meta) => {
      const kind = classifyMindRequest({ system, user, kind: meta?.kind })
      if (kind === 'reflect') {
        const effort = effortOverrideFor(kind, REFLECT_EFFORT)
        return runCodex(system, user, {
          effort,
          recopyAuth: recopyMindAuth,
          env: reflectEnv,
        }).then((r) => ({ ...r, worker: 'exec' as const }))
      }
      const effort = effortOverrideFor(kind, homeEffort)
      return pool.decide(system, user, effort)
    },
    grokRunner: (system, user) => runGrok(system, user),
    defaultEngine,
  }
  return {
    name: 'luna-sidecar',
    configureServer(server) {
      attachMiddleware(
        server.middlewares,
        deps,
        SCRATCH,
        () => pool.status(),
        mind.ready && reflectMind.ready,
      )
      server.httpServer?.on('close', () => pool.dispose())
    },
    configurePreviewServer(server) {
      attachMiddleware(
        server.middlewares,
        deps,
        SCRATCH,
        () => pool.status(),
        mind.ready && reflectMind.ready,
      )
      server.httpServer?.on('close', () => pool.dispose())
    },
  }
}

export default lunaSidecarPlugin

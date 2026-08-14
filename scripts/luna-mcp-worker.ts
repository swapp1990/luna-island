/**
 * Persistent Codex MCP worker pool for the Luna sidecar.
 *
 * Isolation law: every decide is tools/call name="codex" (fresh conversation).
 * Never call "codex-reply" / continue / threadId.
 */
import type { CodexRunner, WorkerHealth, WorkerKind } from './luna-budget'

export const MCP_FRESH_TOOL = 'codex'

export type JsonRpcId = number | string

export interface McpTransport {
  write(line: string): void
  onChunk(cb: (chunk: string) => void): void
  onExit(cb: (code: number | null, signal: string | null) => void): void
  kill(signal?: string): void
}

export interface CodexRunnerResult {
  text: string
  latencyMs: number
  worker: WorkerKind
}

export type FallbackRunner = (
  system: string,
  user: string,
) => Promise<{ text: string; latencyMs: number }>

export interface MindWorkerPool {
  decide(system: string, user: string): Promise<CodexRunnerResult>
  status(): WorkerHealth
  dispose(): void
}

export interface MindWorkerPoolOpts {
  createTransport: () => McpTransport
  fallback: FallbackRunner
  maxWorkers: number
  scratchDir: string
  killMs?: number
  cancelGraceMs?: number
  handshakeTimeoutMs?: number
  now?: () => number
  maxRestarts?: number
  restartWindowMs?: number
  backoffMs?: (attemptInWindow: number) => number
}

const DEFAULT_KILL_MS = 60_000
const DEFAULT_CANCEL_GRACE_MS = 1_000
const DEFAULT_HANDSHAKE_MS = 20_000
const DEFAULT_MAX_RESTARTS = 3
const DEFAULT_RESTART_WINDOW_MS = 5 * 60 * 1000

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  timedOut: boolean
}

export function extractJsonObject(text: string): string | null {
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

export function stripFences(text: string): string {
  const extracted = extractJsonObject(text)
  return extracted ?? text.trim()
}

export function extractMcpText(result: unknown): string {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const rec = result as Record<string, unknown>
  const structured = rec.structuredContent
  if (structured && typeof structured === 'object') {
    const content = (structured as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  const content = rec.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          return (item as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

export function mcpToolResult(text: string, threadId = 'thread-test'): unknown {
  return {
    structuredContent: { threadId, content: text },
    content: [{ type: 'text', text }],
  }
}

export function combinePrompt(system: string, user: string): string {
  return `${system}\n\n---\n\n${user}\n`
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultBackoff(attemptInWindow: number): number {
  return Math.min(8_000, 250 * 2 ** Math.max(0, attemptInWindow - 1))
}

class McpSession {
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, Pending>()
  private buf = ''
  private dead = false
  private intentionalKill = false
  readonly ready: Promise<void>
  private unexpectedExit: (() => void) | null = null

  constructor(
    private readonly transport: McpTransport,
    private readonly handshakeTimeoutMs: number,
  ) {
    this.transport.onChunk((chunk) => this.onChunk(chunk))
    this.transport.onExit(() => this.onExit())
    this.ready = this.handshake()
  }

  onUnexpectedExit(cb: () => void): void {
    this.unexpectedExit = cb
  }

  get alive(): boolean {
    return !this.dead
  }

  private write(msg: object): void {
    if (this.dead) return
    this.transport.write(JSON.stringify(msg) + '\n')
  }

  private onChunk(chunk: string): void {
    this.buf += chunk
    let nl = this.buf.indexOf('\n')
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (line) this.onLine(line)
      nl = this.buf.indexOf('\n')
    }
  }

  private onLine(line: string): void {
    let msg: {
      id?: JsonRpcId
      result?: unknown
      error?: { code?: number; message?: string }
      method?: string
    }
    try {
      msg = JSON.parse(line) as typeof msg
    } catch {
      return
    }
    if (msg.id == null) return
    const rec = this.pending.get(msg.id)
    if (!rec) return
    this.pending.delete(msg.id)
    clearTimeout(rec.timer)
    if (rec.timedOut) return
    if (msg.error) {
      rec.reject(new Error(msg.error.message ?? `mcp error ${msg.error.code ?? '?'}`))
      return
    }
    rec.resolve(msg.result)
  }

  private onExit(): void {
    if (this.dead) return
    this.dead = true
    for (const [id, rec] of this.pending) {
      this.pending.delete(id)
      clearTimeout(rec.timer)
      if (!rec.timedOut) rec.reject(new Error('mcp worker exited'))
    }
    if (!this.intentionalKill) this.unexpectedExit?.()
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error('mcp worker dead'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const rec = this.pending.get(id)
        if (!rec) return
        rec.timedOut = true
        const err = new Error(`codex kill-timeout after ${timeoutMs}ms`) as Error & {
          code?: string
          requestId?: JsonRpcId
        }
        err.code = 'TIMEOUT'
        err.requestId = id
        reject(err)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, timedOut: false })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private async handshake(): Promise<void> {
    await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'luna-sidecar', version: '0.1.0' },
      },
      this.handshakeTimeoutMs,
    )
    this.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  cancel(requestId: JsonRpcId): void {
    this.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId, reason: 'luna kill-timeout' },
    })
  }

  hasPending(requestId: JsonRpcId): boolean {
    return this.pending.has(requestId)
  }

  kill(signal = 'SIGTERM'): void {
    if (this.dead) return
    this.intentionalKill = true
    this.dead = true
    for (const [id, rec] of this.pending) {
      this.pending.delete(id)
      clearTimeout(rec.timer)
      if (!rec.timedOut) rec.reject(new Error('mcp worker killed'))
    }
    this.transport.kill(signal)
  }

  async callFresh(prompt: string, cwd: string, timeoutMs: number, cancelGraceMs: number): Promise<string> {
    await this.ready
    const params = {
      name: MCP_FRESH_TOOL,
      arguments: {
        prompt,
        sandbox: 'read-only',
        cwd,
        'approval-policy': 'never',
        config: { skip_git_repo_check: true },
      },
    }
    try {
      const result = await this.request('tools/call', params, timeoutMs)
      return extractMcpText(result)
    } catch (err) {
      const e = err as Error & { code?: string; requestId?: JsonRpcId; wedged?: boolean }
      if (e.code === 'TIMEOUT' && e.requestId != null) {
        this.cancel(e.requestId)
        await sleep(cancelGraceMs)
        if (this.hasPending(e.requestId)) {
          e.wedged = true
          this.kill()
        }
        throw e
      }
      throw err
    }
  }
}

type Slot = {
  id: number
  session: McpSession | null
  busy: boolean
}

export function createMindWorkerPool(opts: MindWorkerPoolOpts): MindWorkerPool {
  const killMs = opts.killMs ?? DEFAULT_KILL_MS
  const cancelGraceMs = opts.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS
  const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_MS
  const nowFn = opts.now ?? (() => Date.now())
  const maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS
  const restartWindowMs = opts.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS
  const backoffFn = opts.backoffMs ?? defaultBackoff
  const maxWorkers = Math.max(1, opts.maxWorkers)

  const slots: Slot[] = []
  const waiters: Array<() => void> = []
  const restartTimes: number[] = []
  let mode: Exclude<WorkerHealth, 'restarting'> = 'up'
  let disposed = false
  let restarting = false
  let recoverPromise: Promise<void> | null = null

  function pruneRestarts(now: number): void {
    const cutoff = now - restartWindowMs
    for (let i = restartTimes.length - 1; i >= 0; i--) {
      if (restartTimes[i]! <= cutoff) restartTimes.splice(i, 1)
    }
  }

  function allowRestart(): boolean {
    const now = nowFn()
    pruneRestarts(now)
    if (restartTimes.length >= maxRestarts) {
      mode = 'fallback'
      return false
    }
    restartTimes.push(now)
    return true
  }

  function notifyWaiters(): void {
    const wake = waiters.splice(0)
    for (const w of wake) w()
  }

  function hasHealthy(): boolean {
    return slots.some((s) => s.session?.alive)
  }

  function status(): WorkerHealth {
    if (mode === 'fallback') return 'fallback'
    if (restarting && !hasHealthy()) return 'restarting'
    return 'up'
  }

  async function spawnSession(): Promise<McpSession> {
    const session = new McpSession(opts.createTransport(), handshakeTimeoutMs)
    await session.ready
    return session
  }

  async function attachSession(slot: Slot): Promise<McpSession> {
    const session = await spawnSession()
    if (disposed) {
      session.kill()
      throw new Error('mcp pool disposed')
    }
    slot.session = session
    session.onUnexpectedExit(() => {
      slot.session = null
      void recover(slot)
    })
    mode = 'up'
    return session
  }

  async function recover(slot: Slot): Promise<void> {
    if (disposed || mode === 'fallback') return
    if (recoverPromise) {
      await recoverPromise
      return
    }
    recoverPromise = doRecover(slot)
    try {
      await recoverPromise
    } finally {
      recoverPromise = null
    }
  }

  async function doRecover(slot: Slot): Promise<void> {
    restarting = true
    try {
      slot.session?.kill()
      slot.session = null
      while (allowRestart()) {
        await sleep(backoffFn(restartTimes.length))
        if (disposed || mode === 'fallback') return
        try {
          await attachSession(slot)
          return
        } catch {
          /* budget still open → next attempt */
        }
      }
      mode = 'fallback'
    } finally {
      restarting = false
      notifyWaiters()
    }
  }

  let startPromise: Promise<Slot> | null = null

  async function acquire(): Promise<Slot> {
    const t0 = nowFn()
    for (;;) {
      if (disposed) throw new Error('mcp pool disposed')
      if (mode === 'fallback') throw new Error('mcp pool fallback')
      if (recoverPromise) await recoverPromise
      // One mcp-server handles overlapping tools/call (measured); share a live session.
      const live = slots.find((s) => s.session?.alive)
      if (live) {
        live.busy = true
        return live
      }
      if (startPromise) {
        const started = await startPromise
        if (started.session?.alive) {
          started.busy = true
          return started
        }
        continue
      }
      if (slots.length < maxWorkers) {
        const slot: Slot = { id: slots.length + 1, session: null, busy: true }
        slots.push(slot)
        startPromise = (async () => {
          try {
            await attachSession(slot)
            return slot
          } catch {
            await recover(slot)
            return slot
          } finally {
            startPromise = null
          }
        })()
        const started = await startPromise
        if (started.session?.alive) return started
        slot.busy = false
        throw new Error('mcp worker unavailable')
      }
      if (nowFn() - t0 > killMs) throw new Error('mcp worker acquire timeout')
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  function release(slot: Slot): void {
    slot.busy = false
    notifyWaiters()
  }

  async function decide(system: string, user: string): Promise<CodexRunnerResult> {
    const t0 = Date.now()
    if (disposed || mode === 'fallback') {
      const r = await opts.fallback(system, user)
      return { text: stripFences(r.text), latencyMs: r.latencyMs, worker: 'exec' }
    }

    let slot: Slot | null = null
    try {
      slot = await acquire()
    } catch {
      const r = await opts.fallback(system, user)
      return { text: stripFences(r.text), latencyMs: r.latencyMs, worker: 'exec' }
    }

    try {
      const session = slot.session
      if (!session?.alive) throw new Error('mcp worker unavailable')
      const raw = await session.callFresh(
        combinePrompt(system, user),
        opts.scratchDir,
        killMs,
        cancelGraceMs,
      )
      return {
        text: stripFences(raw),
        latencyMs: Date.now() - t0,
        worker: 'mcp',
      }
    } catch (err) {
      const e = err as Error & { code?: string; wedged?: boolean }
      if (e.code === 'TIMEOUT') {
        if (e.wedged) void recover(slot)
        throw err
      }
      void recover(slot)
      const r = await opts.fallback(system, user)
      return { text: stripFences(r.text), latencyMs: r.latencyMs, worker: 'exec' }
    } finally {
      if (slot) release(slot)
    }
  }

  function dispose(): void {
    disposed = true
    for (const slot of slots) {
      slot.session?.kill()
      slot.session = null
    }
    notifyWaiters()
  }

  return { decide, status, dispose }
}

/** Wrap a pool as the sidecar CodexRunner. */
export function poolRunner(pool: MindWorkerPool): CodexRunner {
  return (system, user) => pool.decide(system, user)
}

export type FakeCall = {
  id: JsonRpcId
  name: string
  args: Record<string, unknown>
  respond: (result: unknown) => void
  error: (message: string) => void
}

export type FakeCallHandler = (call: FakeCall) => void

/** In-memory MCP stdio stand-in for unit tests. */
export class FakeMcpServer {
  readonly written: object[] = []
  readonly toolCalls: Array<{ id: JsonRpcId; name: string; args: Record<string, unknown> }> = []
  readonly cancelled: JsonRpcId[] = []
  readonly killed: Array<string | undefined> = []
  handler: FakeCallHandler

  private readonly chunkCbs: Array<(chunk: string) => void> = []
  private readonly exitCbs: Array<(code: number | null, signal: string | null) => void> = []
  private exited = false

  constructor(handler?: FakeCallHandler) {
    this.handler =
      handler ??
      ((call) => {
        call.respond(mcpToolResult('{"ok":true}'))
      })
  }

  transport(): McpTransport {
    return {
      write: (line) => this.onClientWrite(line),
      onChunk: (cb) => {
        this.chunkCbs.push(cb)
      },
      onExit: (cb) => {
        this.exitCbs.push(cb)
      },
      kill: (signal) => {
        this.killed.push(signal)
        this.emitExit(0, signal ?? null)
      },
    }
  }

  push(msg: object): void {
    const line = JSON.stringify(msg) + '\n'
    for (const cb of this.chunkCbs) cb(line)
  }

  crash(code = 1): void {
    this.emitExit(code, null)
  }

  private emitExit(code: number | null, signal: string | null): void {
    if (this.exited) return
    this.exited = true
    for (const cb of this.exitCbs) cb(code, signal)
  }

  private onClientWrite(raw: string): void {
    const lines = raw.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let msg: {
        jsonrpc?: string
        id?: JsonRpcId
        method?: string
        params?: Record<string, unknown>
      }
      try {
        msg = JSON.parse(trimmed) as typeof msg
      } catch {
        continue
      }
      this.written.push(msg)
      if (msg.method === 'initialize') {
        this.push({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'fake-mcp' },
          },
        })
        continue
      }
      if (msg.method === 'notifications/initialized') continue
      if (msg.method === 'notifications/cancelled') {
        const requestId = msg.params?.requestId as JsonRpcId | undefined
        if (requestId != null) this.cancelled.push(requestId)
        continue
      }
      if (msg.method === 'tools/call') {
        const name = String(msg.params?.name ?? '')
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const id = msg.id ?? -1
        this.toolCalls.push({ id, name, args })
        this.handler({
          id,
          name,
          args,
          respond: (result) => this.push({ jsonrpc: '2.0', id, result }),
          error: (message) =>
            this.push({ jsonrpc: '2.0', id, error: { code: -32000, message } }),
        })
      }
    }
  }
}

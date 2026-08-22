import { describe, expect, it } from 'vitest'
import { BudgetTracker, healthPayload } from '../scripts/luna-budget'
import {
  DECIDE_EFFORT,
  DEFAULT_CODEX_MODEL,
  REFLECT_EFFORT,
  classifyMindRequest,
  effortForClass,
  effortOverrideFor,
  ensureMindHome,
  execArgs,
  isUnauthorizedError,
  isUnauthorizedText,
  mcpCallConfig,
  mcpServerArgs,
  mindHomePath,
  readRealAuthJson,
  realAuthJsonPath,
  recopyAuth,
  renderMindConfig,
  resolveDecideEffort,
  resolveMindModel,
  withAuthRetry,
  withCodexHome,
  type MindHomeFs,
} from '../scripts/luna-mind-home'
import { runCodexWithDeps } from '../scripts/luna-codex-exec'
import {
  FakeMcpServer,
  createMindWorkerPool,
  mcpToolResult,
} from '../scripts/luna-mcp-worker'

function fakeFs(init?: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(init ?? {}))
  const ops: Array<{ op: 'read' | 'write' | 'mkdir'; path: string }> = []
  const fs: MindHomeFs & {
    files: Map<string, string>
    ops: typeof ops
  } = {
    files,
    ops,
    mkdir: (dirPath: string) => {
      ops.push({ op: 'mkdir', path: dirPath })
    },
    writeFile: (filePath: string, data: string) => {
      ops.push({ op: 'write', path: filePath })
      files.set(filePath, data)
    },
    readFile: (filePath: string) => {
      ops.push({ op: 'read', path: filePath })
      const v = files.get(filePath)
      if (v == null) throw new Error(`ENOENT ${filePath}`)
      return v
    },
  }
  return fs
}

const TMP = '/tmp'
const HOME = '/users/me'
const REAL_AUTH = realAuthJsonPath(HOME)
const AUTH_JSON = '{"tokens":{"access":"tok-1"}}'

describe('mind home create/refresh (P3-8)', () => {
  it('creates config.toml (model+effort only) and copies auth.json', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    const r = ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs })
    expect(r.ready).toBe(true)
    expect(r.home).toBe(mindHomePath(TMP, 'decide'))
    expect(fs.files.get(`${r.home}/config.toml`)).toBe(
      renderMindConfig(DEFAULT_CODEX_MODEL, DECIDE_EFFORT),
    )
    expect(fs.files.get(`${r.home}/auth.json`)).toBe(AUTH_JSON)
    const keys = [...fs.files.keys()].filter((p) => p.startsWith(r.home))
    expect(keys.sort()).toEqual([`${r.home}/auth.json`, `${r.home}/config.toml`])
  })

  it('honors LUNA_CODEX_MODEL and LUNA_MIND_EFFORT', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    const r = ensureMindHome({
      tmpdir: TMP,
      homedir: HOME,
      env: { LUNA_CODEX_MODEL: 'gpt-test', LUNA_MIND_EFFORT: 'medium' },
      fs,
    })
    expect(fs.files.get(`${r.home}/config.toml`)).toBe(
      renderMindConfig('gpt-test', 'medium'),
    )
  })

  it('reflect home differs only by effort=medium', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    const decide = ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs, variant: 'decide' })
    const reflect = ensureMindHome({
      tmpdir: TMP,
      homedir: HOME,
      env: {},
      fs,
      variant: 'reflect',
    })
    expect(reflect.home).toBe(mindHomePath(TMP, 'reflect'))
    expect(reflect.home).not.toBe(decide.home)
    expect(fs.files.get(`${reflect.home}/config.toml`)).toBe(
      renderMindConfig(DEFAULT_CODEX_MODEL, REFLECT_EFFORT),
    )
    expect(fs.files.get(`${decide.home}/config.toml`)).toBe(
      renderMindConfig(DEFAULT_CODEX_MODEL, DECIDE_EFFORT),
    )
  })

  it('refresh rewrites config.toml', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs })
    const r = ensureMindHome({
      tmpdir: TMP,
      homedir: HOME,
      env: { LUNA_CODEX_MODEL: 'gpt-refreshed' },
      fs,
    })
    expect(fs.files.get(`${r.home}/config.toml`)).toContain('gpt-refreshed')
  })

  it('ready=false when real auth is missing; still writes config', () => {
    const fs = fakeFs()
    const r = ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs })
    expect(r.ready).toBe(false)
    expect(fs.files.has(`${r.home}/config.toml`)).toBe(true)
    expect(fs.files.has(`${r.home}/auth.json`)).toBe(false)
  })

  it('the only real ~/.codex op is readFile(auth.json) — never write', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs })
    recopyAuth({ tmpdir: TMP, homedir: HOME, fs })
    const againstReal = fs.ops.filter((op) => op.path.includes('/.codex'))
    expect(againstReal.length).toBeGreaterThan(0)
    for (const op of againstReal) {
      expect(op.op).toBe('read')
      expect(op.path).toBe(REAL_AUTH)
    }
    expect(readRealAuthJson(fs.readFile, HOME)).toBe(AUTH_JSON)
  })
})

describe('auth copy + 401 retry', () => {
  it('recopyAuth overwrites mind-home auth from the real home', () => {
    const fs = fakeFs({ [REAL_AUTH]: AUTH_JSON })
    const r = ensureMindHome({ tmpdir: TMP, homedir: HOME, env: {}, fs })
    fs.files.set(REAL_AUTH, '{"tokens":{"access":"tok-2"}}')
    const logs: string[] = []
    recopyAuth({
      tmpdir: TMP,
      homedir: HOME,
      fs,
      log: (m) => logs.push(m),
    })
    expect(fs.files.get(`${r.home}/auth.json`)).toBe('{"tokens":{"access":"tok-2"}}')
    expect(logs.some((l) => l.includes('recopy auth.json'))).toBe(true)
  })

  it('401 → recopy once → retry once → success', async () => {
    let calls = 0
    let recopies = 0
    const text = await withAuthRetry(async () => {
      calls += 1
      if (calls === 1) {
        const err = new Error('codex exit 1: 401 Unauthorized') as Error & {
          code?: string
        }
        err.code = 'UNAUTHORIZED'
        throw err
      }
      return '{"ok":true}'
    }, () => {
      recopies += 1
    })
    expect(text).toBe('{"ok":true}')
    expect(calls).toBe(2)
    expect(recopies).toBe(1)
  })

  it('second 401 surfaces the error (no third try)', async () => {
    let calls = 0
    let recopies = 0
    await expect(
      withAuthRetry(async () => {
        calls += 1
        throw new Error('401 Unauthorized')
      }, () => {
        recopies += 1
      }),
    ).rejects.toThrow(/401/)
    expect(calls).toBe(2)
    expect(recopies).toBe(1)
  })

  it('non-401 errors are not retried', async () => {
    let calls = 0
    await expect(
      withAuthRetry(async () => {
        calls += 1
        throw new Error('codex kill-timeout after 60000ms')
      }, () => {
        throw new Error('should not recopy')
      }),
    ).rejects.toThrow(/kill-timeout/)
    expect(calls).toBe(1)
  })

  it('detects 401 in text and errors', () => {
    expect(isUnauthorizedText('HTTP 401 from chatgpt.com')).toBe(true)
    expect(isUnauthorizedText('unauthorized token')).toBe(true)
    expect(isUnauthorizedText('ok')).toBe(false)
    expect(isUnauthorizedError(Object.assign(new Error('nope'), { code: 'UNAUTHORIZED' }))).toBe(
      true,
    )
  })
})

describe('env injection + effort selection', () => {
  it('withCodexHome sets CODEX_HOME on both spawn-shaped envs', () => {
    const home = mindHomePath(TMP)
    const execEnv = withCodexHome({ PATH: '/bin', FOO: '1' }, home)
    const mcpEnv = withCodexHome({ PATH: '/bin' }, home)
    expect(execEnv.CODEX_HOME).toBe(home)
    expect(mcpEnv.CODEX_HOME).toBe(home)
    expect(execEnv.FOO).toBe('1')
    expect(execArgs()).toEqual(expect.arrayContaining(['exec', '-s', 'read-only']))
    expect(mcpServerArgs()[0]).toBe('mcp-server')
  })

  it('decides stay at low; reflections request medium', () => {
    expect(classifyMindRequest({ kind: 'decision', system: 's', user: 'u' })).toBe(
      'decide',
    )
    expect(classifyMindRequest({ kind: 'conversation' })).toBe('decide')
    expect(classifyMindRequest({ kind: 'reflection' })).toBe('reflect')
    expect(
      classifyMindRequest({
        system: 'You are reflecting on your day before sleep. Reply ONLY with one JSON object',
        user: 'Day 1',
      }),
    ).toBe('reflect')
    expect(effortForClass('decide')).toBe(DECIDE_EFFORT)
    expect(effortForClass('reflect')).toBe(REFLECT_EFFORT)
    expect(effortOverrideFor('decide', DECIDE_EFFORT)).toBeUndefined()
    expect(effortOverrideFor('reflect', DECIDE_EFFORT)).toBe(REFLECT_EFFORT)
    // LUNA_MIND_EFFORT must survive to the request: a home configured above
    // the DECIDE_EFFORT constant must not be overridden back down to it.
    expect(effortForClass('decide', 'high')).toBe('high')
    expect(effortOverrideFor('decide', 'high', 'high')).toBeUndefined()
    expect(execArgs(REFLECT_EFFORT)).toContain(`model_reasoning_effort="${REFLECT_EFFORT}"`)
    expect(mcpCallConfig(REFLECT_EFFORT).model_reasoning_effort).toBe(REFLECT_EFFORT)
    expect(mcpCallConfig(undefined).model_reasoning_effort).toBeUndefined()
  })

  it('MCP pool passes effort into tools/call config and retries 401 once', async () => {
    let n = 0
    let recopies = 0
    const server = new FakeMcpServer((call) => {
      n += 1
      if (n === 1) {
        call.error('401 Unauthorized')
        return
      }
      call.respond(mcpToolResult('{"notes":["ok"]}'))
    })
    const pool = createMindWorkerPool({
      createTransport: () => server.transport(),
      fallback: async () => ({ text: 'FALLBACK', latencyMs: 1 }),
      maxWorkers: 1,
      scratchDir: '/tmp/luna-mind-test',
      handshakeTimeoutMs: 200,
      backoffMs: () => 0,
      onUnauthorized: () => {
        recopies += 1
      },
    })
    const r = await pool.decide(
      'You are reflecting on your day before sleep.',
      'notes',
      REFLECT_EFFORT,
    )
    expect(r.worker).toBe('mcp')
    expect(r.text).toBe('{"notes":["ok"]}')
    expect(n).toBe(2)
    expect(recopies).toBe(1)
    const cfg = server.toolCalls[0]?.args.config as Record<string, unknown>
    expect(cfg.model_reasoning_effort).toBe(REFLECT_EFFORT)
    expect(cfg.skip_git_repo_check).toBe(true)
    pool.dispose()
  })

  it('exec spawn args + env include CODEX_HOME and optional effort', async () => {
    const home = mindHomePath(TMP)
    const captured: Array<{ args: string[]; env?: Record<string, string | undefined> }> =
      []
    const r = await runCodexWithDeps('SYS', 'USER', {
      scratchDir: '/tmp/luna-mind-test',
      env: withCodexHome({ PATH: '/bin' }, home),
      effort: REFLECT_EFFORT,
      win32: false,
      now: () => 10,
      spawnImpl: (_cmd, args, options) => {
        captured.push({ args, env: options.env })
        return fakeExecChild({ stdout: '{"action":"wander","reasoning":"ok"}' })
      },
    })
    expect(r.text).toBe('{"action":"wander","reasoning":"ok"}')
    expect(captured[0]?.env?.CODEX_HOME).toBe(home)
    expect(captured[0]?.args).toContain(`model_reasoning_effort="${REFLECT_EFFORT}"`)
  })

  it('runCodexWithDeps recopies once on 401 then succeeds', async () => {
    let n = 0
    let recopies = 0
    const r = await runCodexWithDeps('s', 'u', {
      scratchDir: '/tmp/luna-mind-test',
      env: { CODEX_HOME: '/tmp/luna-mind-home' },
      win32: false,
      now: () => 0,
      recopyAuth: () => {
        recopies += 1
      },
      spawnImpl: () => {
        n += 1
        if (n === 1) return fakeExecChild({ exitCode: 1, stderr: '401 Unauthorized', stdout: '' })
        return fakeExecChild({ stdout: '{"ok":1}' })
      },
    })
    expect(r.text).toBe('{"ok":1}')
    expect(n).toBe(2)
    expect(recopies).toBe(1)
  })

  it('health payload includes mindHome when provided', () => {
    const budget = new BudgetTracker({ maxPerHour: 60, maxPerDay: 300 }, { skipLoad: true })
    expect(healthPayload(budget, '/tmp/luna-mind', 'up', true).mindHome).toBe(true)
    expect(healthPayload(budget, '/tmp/luna-mind', 'up', false).mindHome).toBe(false)
    expect(resolveMindModel({})).toBe(DEFAULT_CODEX_MODEL)
    expect(resolveDecideEffort({})).toBe(DECIDE_EFFORT)
  })
})

function fakeExecChild(opts: { stdout?: string; stderr?: string; exitCode?: number }) {
  const dataCbs: Array<(d: { toString(): string }) => void> = []
  const errCbs: Array<(d: { toString(): string }) => void> = []
  const closeCbs: Array<(code: number | null) => void> = []
  return {
    stdin: { write() {}, end() {} },
    stdout: {
      on(_e: string, cb: (d: { toString(): string }) => void) {
        dataCbs.push(cb)
      },
    },
    stderr: {
      on(_e: string, cb: (d: { toString(): string }) => void) {
        errCbs.push(cb)
      },
    },
    on(event: 'error' | 'close', cb: ((err: Error) => void) | ((code: number | null) => void)) {
      if (event === 'close') {
        closeCbs.push(cb as (code: number | null) => void)
        queueMicrotask(() => {
          if (opts.stdout) {
            for (const fn of dataCbs) fn({ toString: () => opts.stdout! })
          }
          if (opts.stderr) {
            for (const fn of errCbs) fn({ toString: () => opts.stderr! })
          }
          for (const fn of closeCbs) fn(opts.exitCode ?? 0)
        })
      }
    },
    kill() {},
  }
}


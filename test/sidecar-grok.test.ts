import { describe, expect, it } from 'vitest'
import { BudgetTracker, handleDecide, type SidecarDeps } from '../scripts/luna-budget'
import {
  runGrokWithDeps,
  type GrokChunk,
  type GrokSpawnChild,
  type GrokSpawnOptions,
  type RunGrokDeps,
} from '../scripts/luna-grok'
import { parseBrainQuery } from '../src/mind/lunaBrain'
import { GrokProvider } from '../src/mind/providers'

function makeBudget(maxPerHour = 60, maxPerDay = 300): BudgetTracker {
  return new BudgetTracker({ maxPerHour, maxPerDay }, { skipLoad: true })
}

function memFs() {
  const files = new Map<string, string>()
  return {
    files,
    writeFile: (p: string, data: string) => {
      files.set(p, data)
    },
    unlink: (p: string) => {
      files.delete(p)
    },
    mkdir: () => {},
  }
}

function chunkOf(text: string): GrokChunk {
  return { toString: () => text }
}

function fakeChild(opts?: {
  stdout?: string
  stderr?: string
  exitCode?: number
  hang?: boolean
}): GrokSpawnChild & { killed: string[] } {
  const killed: string[] = []
  const dataCbs: Array<(d: GrokChunk) => void> = []
  const errDataCbs: Array<(d: GrokChunk) => void> = []
  const closeCbs: Array<(code: number | null) => void> = []
  const flush = (code: number | null) => {
    if (opts?.stdout) {
      for (const cb of dataCbs) cb(chunkOf(opts.stdout))
    }
    if (opts?.stderr) {
      for (const cb of errDataCbs) cb(chunkOf(opts.stderr))
    }
    for (const cb of closeCbs) cb(code)
  }
  return {
    killed,
    stdout: {
      on: (_e: string, cb: (d: GrokChunk) => void) => {
        dataCbs.push(cb)
      },
    },
    stderr: {
      on: (_e: string, cb: (d: GrokChunk) => void) => {
        errDataCbs.push(cb)
      },
    },
    on(event: 'error' | 'close', cb: ((err: Error) => void) | ((code: number | null) => void)) {
      if (event === 'close') {
        closeCbs.push(cb as (code: number | null) => void)
        if (!opts?.hang) queueMicrotask(() => flush(opts?.exitCode ?? 0))
      }
    },
    kill(signal?: string) {
      killed.push(String(signal ?? 'SIGTERM'))
      if (opts?.hang) queueMicrotask(() => flush(1))
    },
  }
}

function grokDeps(
  fs: ReturnType<typeof memFs>,
  extra: Partial<RunGrokDeps> & Pick<RunGrokDeps, 'spawnImpl'>,
): RunGrokDeps {
  return {
    scratchDir: extra.scratchDir ?? '/tmp/luna-mind-test',
    model: extra.model ?? 'grok-4.6',
    killMs: extra.killMs ?? 30_000,
    now: extra.now ?? (() => 0),
    pid: extra.pid ?? 1,
    win32: extra.win32 ?? false,
    writeFile: extra.writeFile ?? fs.writeFile,
    unlink: extra.unlink ?? fs.unlink,
    mkdir: extra.mkdir ?? fs.mkdir,
    spawnImpl: extra.spawnImpl,
    env: extra.env,
  }
}

describe('grok engine routing (P3-7b)', () => {
  it('body engine=grok selects grokRunner, not the codex runner', async () => {
    const hits: string[] = []
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(),
      runner: async () => {
        hits.push('codex')
        return { text: 'codex', latencyMs: 1, worker: 'mcp' }
      },
      grokRunner: async () => {
        hits.push('grok')
        return { text: '{"action":"wander","reasoning":"ok"}', latencyMs: 2, worker: 'grok' }
      },
    }
    const r = await handleDecide(deps, { system: 's', user: 'u', engine: 'grok' })
    expect(r.status).toBe(200)
    expect(hits).toEqual(['grok'])
    expect(r.json.text).toBe('{"action":"wander","reasoning":"ok"}')
  })

  it('body engine=codex selects the codex runner even when defaultEngine is grok', async () => {
    const hits: string[] = []
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(),
      defaultEngine: 'grok',
      runner: async () => {
        hits.push('codex')
        return { text: 'codex', latencyMs: 1, worker: 'exec' }
      },
      grokRunner: async () => {
        hits.push('grok')
        return { text: 'grok', latencyMs: 1, worker: 'grok' }
      },
    }
    const r = await handleDecide(deps, { system: 's', user: 'u', engine: 'codex' })
    expect(r.status).toBe(200)
    expect(hits).toEqual(['codex'])
  })

  it('omitted engine uses defaultEngine=grok', async () => {
    const hits: string[] = []
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(),
      defaultEngine: 'grok',
      runner: async () => {
        hits.push('codex')
        return { text: 'codex', latencyMs: 1, worker: 'mcp' }
      },
      grokRunner: async () => {
        hits.push('grok')
        return { text: 'g', latencyMs: 1, worker: 'grok' }
      },
    }
    const r = await handleDecide(deps, { system: 's', user: 'u' })
    expect(r.status).toBe(200)
    expect(hits).toEqual(['grok'])
  })

  it('budget gate precedes grok spawn (402, grokRunner never called)', async () => {
    let grokCalls = 0
    let codexCalls = 0
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(0, 300),
      runner: async () => {
        codexCalls += 1
        return { text: 'c', latencyMs: 1, worker: 'exec' }
      },
      grokRunner: async () => {
        grokCalls += 1
        return { text: 'g', latencyMs: 1, worker: 'grok' }
      },
    }
    const blocked = await handleDecide(deps, { system: 's', user: 'u', engine: 'grok' })
    expect(blocked.status).toBe(402)
    expect(blocked.json.error).toBe('budget')
    expect(grokCalls).toBe(0)
    expect(codexCalls).toBe(0)
  })

  it('?brain=grok parses as grok (not auto)', () => {
    expect(parseBrainQuery('?brain=grok')).toBe('grok')
    expect(parseBrainQuery('?brain=codex')).toBe('codex')
    expect(parseBrainQuery('?brain=mock')).toBe('mock')
  })

  it('GrokProvider.name is grok', () => {
    expect(new GrokProvider().name).toBe('grok')
  })
})

describe('runGrok prompt file + timeout (fake spawn)', () => {
  it('spawns grok --prompt-file and cleans up the temp file on success', async () => {
    const fs = memFs()
    let captured: { cmd: string; args: string[]; options: GrokSpawnOptions } | null =
      null
    const r = await runGrokWithDeps(
      'SYS',
      'USER-OBS',
      grokDeps(fs, {
        spawnImpl: (cmd, args, options) => {
          captured = { cmd, args, options }
          expect(fs.files.size).toBe(1)
          const [onlyPath] = [...fs.files.keys()]
          expect(fs.files.get(onlyPath!)).toContain('SYS')
          expect(fs.files.get(onlyPath!)).toContain('USER-OBS')
          return fakeChild({
            stdout: '{"action":"wander","reasoning":"plaza is quiet"}',
          })
        },
      }),
    )
    expect(r.worker).toBe('grok')
    expect(r.text).toBe('{"action":"wander","reasoning":"plaza is quiet"}')
    expect(captured).not.toBeNull()
    expect(captured!.cmd).toBe('grok')
    expect(captured!.args[0]).toBe('--prompt-file')
    expect(captured!.args[1]).toMatch(/grok-prompt-/)
    expect(captured!.args).toEqual([
      '--prompt-file',
      captured!.args[1],
      '--output-format',
      'plain',
      '-m',
      'grok-4.6',
    ])
    expect(captured!.options.cwd).toBe('/tmp/luna-mind-test')
    expect(fs.files.size).toBe(0)
  })

  it('cleans up the temp prompt file when the child fails', async () => {
    const fs = memFs()
    await expect(
      runGrokWithDeps(
        's',
        'u',
        grokDeps(fs, {
          spawnImpl: () => fakeChild({ exitCode: 1, stderr: 'boom', stdout: '' }),
        }),
      ),
    ).rejects.toThrow(/grok exit 1/)
    expect(fs.files.size).toBe(0)
  })

  it('cleans up the temp prompt file when spawn throws', async () => {
    const fs = memFs()
    await expect(
      runGrokWithDeps(
        's',
        'u',
        grokDeps(fs, {
          spawnImpl: () => {
            throw new Error('ENOENT grok')
          },
        }),
      ),
    ).rejects.toThrow(/ENOENT grok/)
    expect(fs.files.size).toBe(0)
  })

  it('kill-timeout SIGTERMs a hung grok and cleans up the prompt file', async () => {
    const fs = memFs()
    const child = fakeChild({ hang: true })
    const p = runGrokWithDeps(
      's',
      'u',
      grokDeps(fs, {
        killMs: 25,
        spawnImpl: () => child,
      }),
    )
    await expect(p).rejects.toThrow(/grok kill-timeout after 25ms/)
    expect(child.killed).toContain('SIGTERM')
    expect(fs.files.size).toBe(0)
  })
})

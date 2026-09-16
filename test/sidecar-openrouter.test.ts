import { describe, expect, it } from 'vitest'
import {
  BudgetTracker,
  handleDecide,
  healthPayload,
  resolveRequestEngine,
  type SidecarDeps,
} from '../scripts/luna-budget'
import {
  OPENROUTER_URL,
  resolveOpenRouterKey,
  runOpenRouterWithDeps,
  type RunOpenRouterDeps,
} from '../scripts/luna-openrouter'

function makeBudget(maxPerHour = 60, maxPerDay = 300): BudgetTracker {
  return new BudgetTracker({ maxPerHour, maxPerDay }, { skipLoad: true })
}

function resp(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: async () => body }
}

function bodyOf(content: unknown, usage?: unknown): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  })
}

function baseDeps(overrides: Partial<RunOpenRouterDeps> = {}): RunOpenRouterDeps {
  return {
    apiKey: 'test-key',
    model: 'test-model',
    killMs: 60_000,
    jsonMode: true,
    now: () => 0,
    fetchImpl: async () => resp(200, '{}'),
    sleep: async () => {},
    ...overrides,
  }
}

describe('runOpenRouterWithDeps (success path)', () => {
  it('posts to the chat-completions URL with headers, both messages and usage.include', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = []
    const deps = baseDeps({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return resp(200, bodyOf('{"action":"wander"}'))
      },
    })
    const r = await runOpenRouterWithDeps('SYS', 'USR', deps)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(OPENROUTER_URL)
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer test-key')
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json')
    expect(calls[0]!.init.headers['X-Title']).toBe('luna-island')
    const body = JSON.parse(calls[0]!.init.body) as {
      model: string
      messages: unknown
      usage: unknown
      response_format?: unknown
    }
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ])
    expect(body.usage).toEqual({ include: true })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(r.worker).toBe('openrouter')
  })

  it('strips fences, maps usage, and omits response_format when jsonMode is off', async () => {
    const bodies: string[] = []
    const deps = baseDeps({
      jsonMode: false,
      fetchImpl: async (_url, init) => {
        bodies.push(init.body)
        return resp(
          200,
          bodyOf('```json\n{"action":"rest"}\n```', {
            prompt_tokens: 12,
            completion_tokens: 7,
            cost: 0.00123,
          }),
        )
      },
    })
    const r = await runOpenRouterWithDeps('s', 'u', deps)

    expect(r.text).toBe('{"action":"rest"}')
    expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 7, costUsd: 0.00123 })
    expect(JSON.parse(bodies[0]!)).not.toHaveProperty('response_format')
  })

  it('omits costUsd when the response carries no cost', async () => {
    const deps = baseDeps({
      fetchImpl: async () =>
        resp(200, bodyOf('{"a":1}', { prompt_tokens: 3, completion_tokens: 2 })),
    })
    const r = await runOpenRouterWithDeps('s', 'u', deps)
    expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 2 })
    expect(r.usage && 'costUsd' in r.usage).toBe(false)
  })
})

describe('runOpenRouterWithDeps (retry + failure)', () => {
  it('retries once after sleep(2000) on 429 then succeeds', async () => {
    const sleeps: number[] = []
    let n = 0
    const deps = baseDeps({
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      fetchImpl: async () => {
        n += 1
        return n === 1 ? resp(429, 'rate limited') : resp(200, bodyOf('{"a":1}'))
      },
    })
    const r = await runOpenRouterWithDeps('s', 'u', deps)
    expect(r.text).toBe('{"a":1}')
    expect(n).toBe(2)
    expect(sleeps).toEqual([2000])
  })

  it('throws with status + body excerpt (and no key) after two 500s', async () => {
    const deps = baseDeps({
      apiKey: 'sk-super-secret-key',
      fetchImpl: async () => resp(500, `server exploded ${'x'.repeat(400)}`),
    })
    let err: unknown
    try {
      await runOpenRouterWithDeps('s', 'u', deps)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toMatch(/^openrouter 500: server exploded/)
    expect(msg).not.toContain('sk-super-secret-key')
    expect(msg.length).toBeLessThanOrEqual(220)
  })

  it('aborts the attempt at killMs and rejects', async () => {
    let aborted = false
    const deps = baseDeps({
      killMs: 20,
      sleep: async () => {},
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => {
            aborted = true
            reject(new Error('aborted by signal'))
          }
          if (init.signal?.aborted) onAbort()
          else init.signal?.addEventListener('abort', onAbort)
        }),
    })
    const t0 = Date.now()
    await expect(runOpenRouterWithDeps('s', 'u', deps)).rejects.toThrow(/aborted/)
    expect(aborted).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('throws openrouter: empty completion on empty or missing content', async () => {
    await expect(
      runOpenRouterWithDeps('s', 'u', baseDeps({ fetchImpl: async () => resp(200, bodyOf('')) })),
    ).rejects.toThrow('openrouter: empty completion')
    await expect(
      runOpenRouterWithDeps(
        's',
        'u',
        baseDeps({ fetchImpl: async () => resp(200, JSON.stringify({ choices: [] })) }),
      ),
    ).rejects.toThrow('openrouter: empty completion')
  })
})

describe('resolveOpenRouterKey', () => {
  it('env wins over the opencode auth file', () => {
    const readFile = () => JSON.stringify({ openrouter: { key: 'file-key' } })
    expect(resolveOpenRouterKey({ OPENROUTER_API_KEY: 'env-key' }, readFile, '/home/u')).toEqual({
      key: 'env-key',
      source: 'env',
    })
  })

  it('reads the file when env is empty and reports the opencode source', () => {
    const seen: string[] = []
    const readFile = (p: string) => {
      seen.push(p)
      return JSON.stringify({ openrouter: { key: 'file-key' } })
    }
    expect(resolveOpenRouterKey({ OPENROUTER_API_KEY: '   ' }, readFile, '/home/u')).toEqual({
      key: 'file-key',
      source: 'opencode',
    })
    expect(seen[0]).toBe('/home/u/.local/share/opencode/auth.json')
  })

  it('malformed file and missing file both report missing', () => {
    expect(resolveOpenRouterKey({}, () => 'not json{', '/home/u')).toEqual({
      key: null,
      source: 'missing',
    })
    expect(
      resolveOpenRouterKey(
        {},
        () => {
          throw new Error('ENOENT')
        },
        '/home/u',
      ),
    ).toEqual({ key: null, source: 'missing' })
    expect(resolveOpenRouterKey({}, () => JSON.stringify({}), '/home/u')).toEqual({
      key: null,
      source: 'missing',
    })
  })
})

describe('openrouter engine routing + health', () => {
  it('resolveRequestEngine maps openrouter and falls back for unknown engines', () => {
    expect(resolveRequestEngine({ engine: 'openrouter' })).toBe('openrouter')
    expect(resolveRequestEngine({ engine: 'nope' }, 'grok')).toBe('grok')
    expect(resolveRequestEngine({}, 'codex')).toBe('codex')
  })

  it('routes engine=openrouter to openRouterRunner and passes usage through', async () => {
    const hits: string[] = []
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(),
      runner: async () => {
        hits.push('codex')
        return { text: 'codex', latencyMs: 1, worker: 'exec' }
      },
      openRouterRunner: async () => {
        hits.push('openrouter')
        return {
          text: 'openrouter',
          latencyMs: 2,
          worker: 'openrouter',
          usage: { promptTokens: 3, completionTokens: 4, costUsd: 0.0005 },
        }
      },
    }
    const r = await handleDecide(deps, { system: 's', user: 'u', engine: 'openrouter' })
    expect(r.status).toBe(200)
    expect(hits).toEqual(['openrouter'])
    expect(r.json.usage).toEqual({ promptTokens: 3, completionTokens: 4, costUsd: 0.0005 })
  })

  it('returns 502 openrouter engine not configured when no runner is wired', async () => {
    const deps: SidecarDeps = {
      busy: { count: 0, max: 3 },
      budget: makeBudget(),
      runner: async () => ({ text: 'codex', latencyMs: 1, worker: 'exec' }),
    }
    const r = await handleDecide(deps, { system: 's', user: 'u', engine: 'openrouter' })
    expect(r.status).toBe(502)
    expect(r.json.error).toBe('openrouter engine not configured')
  })

  it('healthPayload carries engine and, only for openrouter, the openrouter block', () => {
    const budget = makeBudget()
    const hp = healthPayload(budget, undefined, undefined, undefined, 'openrouter', {
      model: 'deepseek/deepseek-v4.1-flash',
      keySource: 'env',
    })
    expect(hp.engine).toBe('openrouter')
    expect(hp.openrouter).toEqual({
      model: 'deepseek/deepseek-v4.1-flash',
      keySource: 'env',
    })

    const codexHp = healthPayload(budget, undefined, undefined, undefined, 'codex', {
      model: 'x',
      keySource: 'missing',
    })
    expect(codexHp.engine).toBe('codex')
    expect(codexHp).not.toHaveProperty('openrouter')
  })
})

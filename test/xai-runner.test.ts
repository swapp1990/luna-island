import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  XAI_URL,
  resolveXaiKey,
  runXaiWithDeps,
  type RunXaiDeps,
} from '../scripts/luna-xai'

function resp(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: async () => body }
}

function bodyOf(content: unknown, usage?: unknown): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  })
}

const SECRET = 'sk-super-secret-key-never-log'

function baseDeps(overrides: Partial<RunXaiDeps> = {}): RunXaiDeps {
  return {
    apiKey: SECRET,
    model: 'test-model',
    killMs: 20_000,
    jsonMode: true,
    now: () => 0,
    fetchImpl: async () => resp(200, '{}'),
    sleep: async () => {},
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runXaiWithDeps (success path)', () => {
  it('posts chat-completions with json_object and never logs the key', async () => {
    const logs: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '))
    })
    const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '))
    })
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = []
    const deps = baseDeps({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return resp(
          200,
          bodyOf('{"action":"wait","reason":"ok"}', {
            prompt_tokens: 12,
            completion_tokens: 7,
          }),
        )
      },
    })
    const r = await runXaiWithDeps('SYS', 'USR', deps)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(XAI_URL)
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${SECRET}`)
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(calls[0]!.init.body) as {
      model: string
      messages: unknown
      temperature: number
      max_tokens: number
      response_format?: unknown
    }
    expect(body.model).toBe('test-model')
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ])
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(200)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(r.worker).toBe('xai')
    expect(r.text).toBe('{"action":"wait","reason":"ok"}')
    expect(r.usage).toEqual({ promptTokens: 12, completionTokens: 7 })
    expect(JSON.stringify(logs)).not.toContain(SECRET)
    log.mockRestore()
    error.mockRestore()
  })

  it('omits response_format when jsonMode is off and strips fences', async () => {
    const bodies: string[] = []
    const deps = baseDeps({
      jsonMode: false,
      fetchImpl: async (_url, init) => {
        bodies.push(init.body)
        return resp(200, bodyOf('```json\n{"action":"eat"}\n```'))
      },
    })
    const r = await runXaiWithDeps('s', 'u', deps)
    expect(r.text).toBe('{"action":"eat"}')
    expect(JSON.parse(bodies[0]!)).not.toHaveProperty('response_format')
  })
})

describe('runXaiWithDeps (retry + failure)', () => {
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
    const r = await runXaiWithDeps('s', 'u', deps)
    expect(r.text).toBe('{"a":1}')
    expect(n).toBe(2)
    expect(sleeps).toEqual([2000])
  })

  it('throws with status + body excerpt and never includes the key', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '))
    })
    const deps = baseDeps({
      fetchImpl: async () => resp(500, `server exploded ${'x'.repeat(400)}`),
    })
    let err: unknown
    try {
      await runXaiWithDeps('s', 'u', deps)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toMatch(/^xai 500: server exploded/)
    expect(msg).not.toContain(SECRET)
    expect(msg.length).toBeLessThanOrEqual(220)
    expect(JSON.stringify(logs)).not.toContain(SECRET)
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
    await expect(runXaiWithDeps('s', 'u', deps)).rejects.toThrow(/aborted/)
    expect(aborted).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('throws xai: empty completion on malformed body', async () => {
    await expect(
      runXaiWithDeps('s', 'u', baseDeps({ fetchImpl: async () => resp(200, 'not-json{{{') })),
    ).rejects.toThrow('xai: empty completion')
    await expect(
      runXaiWithDeps('s', 'u', baseDeps({ fetchImpl: async () => resp(200, bodyOf('')) })),
    ).rejects.toThrow('xai: empty completion')
  })
})

describe('resolveXaiKey', () => {
  it('env XAI_API_KEY wins, then GROK_API_KEY, then dotenv', () => {
    expect(
      resolveXaiKey({ XAI_API_KEY: 'env-key', GROK_API_KEY: 'grok-key' }, () => 'XAI_API_KEY=file', '/repo'),
    ).toEqual({ key: 'env-key', source: 'env' })
    expect(resolveXaiKey({ GROK_API_KEY: 'grok-key' }, () => 'XAI_API_KEY=file', '/repo')).toEqual({
      key: 'grok-key',
      source: 'env-grok',
    })
    const seen: string[] = []
    const readFile = (p: string) => {
      seen.push(p)
      return 'XAI_API_KEY="file-key"\n'
    }
    expect(resolveXaiKey({}, readFile, '/repo/')).toEqual({ key: 'file-key', source: 'dotenv' })
    expect(seen[0]).toBe('/repo/.env.local')
  })

  it('missing file and empty values report missing', () => {
    expect(
      resolveXaiKey(
        {},
        () => {
          throw new Error('ENOENT')
        },
        '/repo',
      ),
    ).toEqual({ key: null, source: 'missing' })
    expect(resolveXaiKey({ XAI_API_KEY: '   ' }, () => '', '/repo')).toEqual({
      key: null,
      source: 'missing',
    })
  })
})

/**
 * xAI chat-completions runner — no node: imports (testable from src/test tsc).
 * The sidecar injects the real fetch/key/clock; unit tests inject fakes.
 */
import { stripFences } from './luna-mcp-worker'

export const XAI_URL = 'https://api.x.ai/v1/chat/completions'
export const XAI_MODELS_URL = 'https://api.x.ai/v1/language-models'
export const DEFAULT_XAI_MODEL = 'grok-4.20-0309-non-reasoning'
export const XAI_KILL_MS = 20_000

export type XaiUsage = {
  promptTokens: number
  completionTokens: number
}

export interface RunXaiDeps {
  apiKey: string
  model: string
  killMs: number
  jsonMode: boolean
  now: () => number
  fetchImpl: (
    url: string,
    init: {
      method: string
      headers: Record<string, string>
      body: string
      signal?: AbortSignal
    },
  ) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>
  sleep: (ms: number) => Promise<void>
}

interface XaiResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
  }
}

function mapUsage(raw: XaiResponse['usage']): XaiUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return {
    promptTokens: typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : 0,
    completionTokens: typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0,
  }
}

export function runXaiWithDeps(
  system: string,
  user: string,
  deps: RunXaiDeps,
): Promise<{
  text: string
  latencyMs: number
  worker: 'xai'
  usage?: XaiUsage
}> {
  const t0 = deps.now()
  const payload: Record<string, unknown> = {
    model: deps.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: 200,
  }
  if (deps.jsonMode) payload.response_format = { type: 'json_object' }
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${deps.apiKey}`,
    'Content-Type': 'application/json',
  }

  const attempt = async (): Promise<{ ok: boolean; status: number; text: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.killMs)
    try {
      const res = await deps.fetchImpl(XAI_URL, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })
      const text = await res.text()
      return { ok: res.ok, status: res.status, text }
    } finally {
      clearTimeout(timer)
    }
  }

  return (async () => {
    let lastError: Error | null = null
    for (let attemptNo = 0; attemptNo < 2; attemptNo += 1) {
      let outcome: { ok: boolean; status: number; text: string }
      try {
        outcome = await attempt()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attemptNo === 0) {
          await deps.sleep(2000)
          continue
        }
        throw lastError
      }

      if (outcome.ok) {
        let parsed: XaiResponse
        try {
          parsed = JSON.parse(outcome.text) as XaiResponse
        } catch {
          throw new Error('xai: empty completion')
        }
        const content = parsed.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error('xai: empty completion')
        }
        const usage = mapUsage(parsed.usage)
        return {
          text: stripFences(content),
          latencyMs: deps.now() - t0,
          worker: 'xai',
          ...(usage ? { usage } : {}),
        }
      }

      if (outcome.status === 429 || outcome.status >= 500) {
        lastError = new Error(`xai ${outcome.status}: ${outcome.text.slice(0, 200)}`)
        if (attemptNo === 0) {
          await deps.sleep(2000)
          continue
        }
        throw lastError
      }
      throw new Error(`xai ${outcome.status}: ${outcome.text.slice(0, 200)}`)
    }
    throw lastError ?? new Error('xai: request failed')
  })()
}

export function parseDotenvXaiKey(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^XAI_API_KEY\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[1]!.trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (v.trim() !== '') return v.trim()
  }
  return null
}

export function resolveXaiKey(
  env: Record<string, string | undefined>,
  readFile: (p: string) => string,
  cwd: string,
):
  | { key: string; source: 'env' | 'env-grok' | 'dotenv' }
  | { key: null; source: 'missing' } {
  const fromEnv = env.XAI_API_KEY
  if (fromEnv != null && fromEnv.trim() !== '') {
    return { key: fromEnv.trim(), source: 'env' }
  }
  const fromGrok = env.GROK_API_KEY
  if (fromGrok != null && fromGrok.trim() !== '') {
    return { key: fromGrok.trim(), source: 'env-grok' }
  }
  const trimmedCwd = cwd.replace(/[\\/]+$/, '')
  try {
    const raw = readFile(`${trimmedCwd}/.env.local`)
    const key = parseDotenvXaiKey(raw)
    if (key) return { key, source: 'dotenv' }
  } catch {
    /* missing file → missing */
  }
  return { key: null, source: 'missing' }
}

export function parseXaiModelIds(text: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const ids: string[] = []
  const take = (arr: unknown): void => {
    if (!Array.isArray(arr)) return
    for (const item of arr) {
      if (typeof item === 'string' && item.trim() !== '') ids.push(item)
      else if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        const id = (item as { id: string }).id.trim()
        if (id) ids.push(id)
      }
    }
  }
  if (Array.isArray(raw)) take(raw)
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    take(o.models)
    take(o.data)
  }
  return [...new Set(ids)]
}

export function listXaiModelIds(
  deps: {
    apiKey: string
    fetchImpl: RunXaiDeps['fetchImpl']
    timeoutMs: number
  },
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  return (async () => {
    try {
      const res = await deps.fetchImpl(XAI_MODELS_URL, {
        method: 'GET',
        headers: { Authorization: `Bearer ${deps.apiKey}` },
        body: '',
        signal: controller.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`xai models ${res.status}`)
      return parseXaiModelIds(text)
    } finally {
      clearTimeout(timer)
    }
  })()
}

export function resolveInkModel(env: Record<string, string | undefined>): string {
  const raw = env.INK_MODEL
  if (raw != null && raw.trim() !== '') return raw.trim()
  return DEFAULT_XAI_MODEL
}

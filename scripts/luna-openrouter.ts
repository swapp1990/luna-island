/**
 * OpenRouter chat-completions runner — no node: imports (testable from src/test tsc).
 * The sidecar injects the real fetch/key/clock; unit tests inject fakes.
 */
import { stripFences } from './luna-mcp-worker'

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash'
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_KILL_MS = 60_000

export type OpenRouterUsage = {
  promptTokens: number
  completionTokens: number
  costUsd?: number
}

export interface RunOpenRouterDeps {
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

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: unknown } }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    cost?: unknown
  }
}

function mapUsage(raw: OpenRouterResponse['usage']): OpenRouterUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const usage: OpenRouterUsage = {
    promptTokens: typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : 0,
    completionTokens:
      typeof raw.completion_tokens === 'number' ? raw.completion_tokens : 0,
  }
  if (typeof raw.cost === 'number') usage.costUsd = raw.cost
  return usage
}

export function runOpenRouterWithDeps(
  system: string,
  user: string,
  deps: RunOpenRouterDeps,
): Promise<{
  text: string
  latencyMs: number
  worker: 'openrouter'
  usage?: OpenRouterUsage
}> {
  const t0 = deps.now()
  const payload: Record<string, unknown> = {
    model: deps.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    usage: { include: true },
  }
  if (deps.jsonMode) payload.response_format = { type: 'json_object' }
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${deps.apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'luna-island',
  }

  const attempt = async (): Promise<{ ok: boolean; status: number; text: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.killMs)
    try {
      const res = await deps.fetchImpl(OPENROUTER_URL, {
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
        let parsed: OpenRouterResponse
        try {
          parsed = JSON.parse(outcome.text) as OpenRouterResponse
        } catch {
          throw new Error('openrouter: empty completion')
        }
        const content = parsed.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error('openrouter: empty completion')
        }
        const usage = mapUsage(parsed.usage)
        return {
          text: stripFences(content),
          latencyMs: deps.now() - t0,
          worker: 'openrouter',
          ...(usage ? { usage } : {}),
        }
      }

      if (outcome.status === 429 || outcome.status >= 500) {
        lastError = new Error(
          `openrouter ${outcome.status}: ${outcome.text.slice(0, 200)}`,
        )
        if (attemptNo === 0) {
          await deps.sleep(2000)
          continue
        }
        throw lastError
      }
      throw new Error(`openrouter ${outcome.status}: ${outcome.text.slice(0, 200)}`)
    }
    throw lastError ?? new Error('openrouter: request failed')
  })()
}

export function resolveOpenRouterKey(
  env: Record<string, string | undefined>,
  readFile: (p: string) => string,
  homedir: string,
): { key: string; source: 'env' | 'opencode' } | { key: null; source: 'missing' } {
  const fromEnv = env.OPENROUTER_API_KEY
  if (fromEnv != null && fromEnv.trim() !== '') {
    return { key: fromEnv.trim(), source: 'env' }
  }
  const trimmedHome = homedir.replace(/[\\/]+$/, '')
  try {
    const raw = readFile(`${trimmedHome}/.local/share/opencode/auth.json`)
    const parsed = JSON.parse(raw) as {
      openrouter?: { key?: unknown }
    }
    const key = parsed?.openrouter?.key
    if (typeof key === 'string' && key.trim() !== '') {
      return { key: key.trim(), source: 'opencode' }
    }
  } catch {
    /* missing file or bad JSON → missing */
  }
  return { key: null, source: 'missing' }
}

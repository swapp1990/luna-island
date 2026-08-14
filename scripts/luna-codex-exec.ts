/**
 * Cold `codex exec` runner — no node: imports (testable from src/test tsc).
 * Sidecar supplies real spawn; unit tests inject fakes.
 */
import { stripFences } from './luna-mcp-worker'
import {
  execArgs,
  isUnauthorizedText,
  withAuthRetry,
} from './luna-mind-home'

export const CODEX_KILL_MS = 60_000

export type CodexChunk = { toString(encoding?: string): string }

export interface CodexSpawnChild {
  stdin?: { write(s: string): void; end(): void } | null
  stdout?: { on(event: 'data', cb: (d: CodexChunk) => void): void } | null
  stderr?: { on(event: 'data', cb: (d: CodexChunk) => void): void } | null
  on(event: 'error', cb: (err: Error) => void): void
  on(event: 'close', cb: (code: number | null, signal?: string | null) => void): void
  kill(signal?: string): boolean | void
}

export interface CodexSpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  shell?: boolean
  stdio?: unknown
}

export interface RunCodexDeps {
  scratchDir: string
  env: Record<string, string | undefined>
  effort?: string
  win32: boolean
  now: () => number
  spawnImpl: (
    command: string,
    args: string[],
    options: CodexSpawnOptions,
  ) => CodexSpawnChild
  recopyAuth?: () => void
}

function runCodexOnce(
  system: string,
  user: string,
  deps: RunCodexDeps,
): Promise<{ text: string; latencyMs: number }> {
  const prompt = `${system}\n\n---\n\n${user}\n`
  const t0 = deps.now()
  return new Promise((resolve, reject) => {
    let child: CodexSpawnChild
    try {
      child = deps.spawnImpl('codex', execArgs(deps.effort), {
        cwd: deps.scratchDir,
        env: deps.env,
        shell: deps.win32,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500)
      reject(new Error(`codex kill-timeout after ${CODEX_KILL_MS}ms`))
    }, CODEX_KILL_MS)

    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d) => {
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
      const latencyMs = deps.now() - t0
      const combined = `${stdout}\n${stderr}`
      if (isUnauthorizedText(combined)) {
        const err = new Error(
          `codex exit ${code}: ${stderr.slice(0, 400) || '401 Unauthorized'}`,
        ) as Error & { code?: string }
        err.code = 'UNAUTHORIZED'
        reject(err)
        return
      }
      if (code !== 0 && !stdout.trim()) {
        reject(
          new Error(`codex exit ${code}: ${stderr.slice(0, 400) || 'no output'}`),
        )
        return
      }
      resolve({ text: stripFences(stdout), latencyMs })
    })
    child.stdin?.write(prompt)
    child.stdin?.end()
  })
}

export function runCodexWithDeps(
  system: string,
  user: string,
  deps: RunCodexDeps,
): Promise<{ text: string; latencyMs: number }> {
  return withAuthRetry(
    () => runCodexOnce(system, user, deps),
    () => {
      deps.recopyAuth?.()
    },
  )
}

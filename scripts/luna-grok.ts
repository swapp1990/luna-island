/**
 * Grok one-shot runner — no node: imports (testable from src/test tsc).
 * Sidecar supplies real spawn/fs; unit tests inject fakes.
 */
import { combinePrompt, stripFences } from './luna-mcp-worker'

// Measured: realistic ~1200-token decides run 20-27s (2 of 3 healthy calls
// died at the original 30s ceiling). Same deadline as the codex path.
export const GROK_KILL_MS = 60_000
export const DEFAULT_GROK_MODEL = 'grok-4.6'

let grokPromptSeq = 0

export type GrokChunk = { toString(encoding?: string): string }

export interface GrokSpawnChild {
  stdout?: { on(event: 'data', cb: (d: GrokChunk) => void): void } | null
  stderr?: { on(event: 'data', cb: (d: GrokChunk) => void): void } | null
  on(event: 'error', cb: (err: Error) => void): void
  on(event: 'close', cb: (code: number | null, signal?: string | null) => void): void
  kill(signal?: string): boolean | void
}

export interface GrokSpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  shell?: boolean
  stdio?: unknown
}

export interface RunGrokDeps {
  scratchDir: string
  model: string
  killMs: number
  now: () => number
  pid: number
  win32: boolean
  spawnImpl: (
    command: string,
    args: string[],
    options: GrokSpawnOptions,
  ) => GrokSpawnChild
  writeFile: (filePath: string, data: string) => void
  unlink: (filePath: string) => void
  mkdir: (dirPath: string) => void
  env?: Record<string, string | undefined>
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  if (dir.endsWith('/') || dir.endsWith('\\')) return `${dir}${file}`
  return `${dir}${sep}${file}`
}

export function runGrokWithDeps(
  system: string,
  user: string,
  deps: RunGrokDeps,
): Promise<{ text: string; latencyMs: number; worker: 'grok' }> {
  deps.mkdir(deps.scratchDir)
  grokPromptSeq += 1
  const promptPath = joinPath(
    deps.scratchDir,
    `grok-prompt-${deps.pid}-${grokPromptSeq}.txt`,
  )
  deps.writeFile(promptPath, combinePrompt(system, user))

  const t0 = deps.now()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      try {
        deps.unlink(promptPath)
      } catch {
        /* already gone */
      }
    }
    const finish = (err: Error | null, text?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      cleanup()
      if (err) {
        reject(err)
        return
      }
      resolve({
        text: stripFences(text ?? ''),
        latencyMs: deps.now() - t0,
        worker: 'grok',
      })
    }

    let child: GrokSpawnChild
    try {
      child = deps.spawnImpl(
        'grok',
        ['--prompt-file', promptPath, '--output-format', 'plain', '-m', deps.model],
        {
          cwd: deps.scratchDir,
          env: deps.env,
          shell: deps.win32,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)))
      return
    }

    timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500)
      finish(new Error(`grok kill-timeout after ${deps.killMs}ms`))
    }, deps.killMs)

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      finish(err)
    })
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        finish(
          new Error(`grok exit ${code}: ${stderr.slice(0, 400) || 'no output'}`),
        )
        return
      }
      finish(null, stdout)
    })
  })
}

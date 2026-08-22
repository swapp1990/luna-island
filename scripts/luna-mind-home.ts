/**
 * Dedicated Codex home for Luna minds.
 * Real ~/.codex is read-only (auth.json only). Never write there.
 */

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-luna'
export const DECIDE_EFFORT = 'low'
export const REFLECT_EFFORT = 'medium'
export const MIND_HOME_NAME = 'luna-mind-home'
export const REFLECT_HOME_NAME = 'luna-mind-home-reflect'

export type MindRequestClass = 'decide' | 'reflect'

export interface MindHomeFs {
  mkdir: (dirPath: string) => void
  writeFile: (filePath: string, data: string) => void
  readFile: (filePath: string) => string
}

export interface MindHomeResult {
  home: string
  ready: boolean
}

function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  let out = dir
  for (const part of parts) {
    if (out.endsWith('/') || out.endsWith('\\')) out = `${out}${part}`
    else out = `${out}${sep}${part}`
  }
  return out
}

export function realAuthJsonPath(homedir: string): string {
  return joinPath(homedir, '.codex', 'auth.json')
}

export function mindHomePath(tmpdir: string, variant: MindRequestClass = 'decide'): string {
  return joinPath(tmpdir, variant === 'reflect' ? REFLECT_HOME_NAME : MIND_HOME_NAME)
}

export function renderMindConfig(model: string, effort: string): string {
  return `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`
}

export function resolveMindModel(env: Record<string, string | undefined>): string {
  const raw = env.LUNA_CODEX_MODEL
  if (raw == null || raw.trim() === '') return DEFAULT_CODEX_MODEL
  return raw.trim()
}

export function resolveDecideEffort(env: Record<string, string | undefined>): string {
  const raw = env.LUNA_MIND_EFFORT
  if (raw == null || raw.trim() === '') return DECIDE_EFFORT
  return raw.trim()
}

export function classifyMindRequest(body: {
  kind?: string
  system?: string
  user?: string
}): MindRequestClass {
  if (body.kind === 'reflection' || body.kind === 'reflect') return 'reflect'
  const blob = `${body.system ?? ''}\n${body.user ?? ''}`
  if (blob.includes('You are reflecting on your day before sleep')) return 'reflect'
  return 'decide'
}

export function effortForClass(
  kind: MindRequestClass,
  decideEffort: string = DECIDE_EFFORT,
): string {
  return kind === 'reflect' ? REFLECT_EFFORT : decideEffort
}

/** Per-request -c / MCP config override. Undefined when home config already matches. */
export function effortOverrideFor(
  kind: MindRequestClass,
  homeEffort: string,
  decideEffort: string = DECIDE_EFFORT,
): string | undefined {
  const want = effortForClass(kind, decideEffort)
  return want === homeEffort ? undefined : want
}

export function withCodexHome(
  base: Record<string, string | undefined>,
  mindHome: string,
): Record<string, string | undefined> {
  return { ...base, CODEX_HOME: mindHome }
}

export function execArgs(effort?: string): string[] {
  const args = ['exec', '-s', 'read-only', '--skip-git-repo-check']
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`)
  args.push('-')
  return args
}

export function mcpServerArgs(): string[] {
  return [
    'mcp-server',
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    '-c',
    'skip_git_repo_check=true',
  ]
}

export function mcpCallConfig(effort?: string): Record<string, unknown> {
  const config: Record<string, unknown> = { skip_git_repo_check: true }
  if (effort) config.model_reasoning_effort = effort
  return config
}

export function isUnauthorizedText(text: string): boolean {
  if (!text) return false
  return /\b401\b/.test(text) || /unauthoriz/i.test(text)
}

export function isUnauthorizedError(err: unknown): boolean {
  if (err == null) return false
  const rec = err as { code?: string; message?: string }
  if (rec.code === 'UNAUTHORIZED') return true
  const msg = err instanceof Error ? err.message : String(err)
  return isUnauthorizedText(msg)
}

/**
 * The ONLY filesystem operation allowed against the real ~/.codex.
 * Read auth.json — never write, never list, never touch any other file.
 */
export function readRealAuthJson(
  readFile: (filePath: string) => string,
  homedir: string,
): string {
  return readFile(realAuthJsonPath(homedir))
}

export function ensureMindHome(opts: {
  tmpdir: string
  homedir: string
  env: Record<string, string | undefined>
  fs: MindHomeFs
  variant?: MindRequestClass
  log?: (msg: string) => void
}): MindHomeResult {
  const variant = opts.variant ?? 'decide'
  const home = mindHomePath(opts.tmpdir, variant)
  const model = resolveMindModel(opts.env)
  const effort = variant === 'reflect' ? REFLECT_EFFORT : resolveDecideEffort(opts.env)
  opts.fs.mkdir(home)
  opts.fs.writeFile(joinPath(home, 'config.toml'), renderMindConfig(model, effort))
  try {
    const auth = readRealAuthJson(opts.fs.readFile, opts.homedir)
    opts.fs.writeFile(joinPath(home, 'auth.json'), auth)
    opts.log?.(`[luna-sidecar] mindHome=${home} ready=true effort=${effort}`)
    return { home, ready: true }
  } catch {
    opts.log?.(`[luna-sidecar] mindHome=${home} ready=false (auth copy failed)`)
    return { home, ready: false }
  }
}

export function recopyAuth(opts: {
  tmpdir: string
  homedir: string
  fs: MindHomeFs
  variant?: MindRequestClass
  log?: (msg: string) => void
}): void {
  const home = mindHomePath(opts.tmpdir, opts.variant ?? 'decide')
  const auth = readRealAuthJson(opts.fs.readFile, opts.homedir)
  opts.fs.writeFile(joinPath(home, 'auth.json'), auth)
  opts.log?.('[luna-sidecar] recopy auth.json from real Codex home')
}

export async function withAuthRetry<T>(
  run: () => Promise<T>,
  recopy: () => void,
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!isUnauthorizedError(err)) throw err
    recopy()
    return await run()
  }
}

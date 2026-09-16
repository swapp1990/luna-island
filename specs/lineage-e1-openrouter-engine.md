# Dispatch LINEAGE-E1 — OpenRouter decision engine for the lineage runner

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents or background tasks. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, anything under `src/**` (the sim and lineage modules stay pure and unchanged), or `test/sidecar-grok.test.ts`. If a gate will not go green after 3 distinct fix attempts, STOP and write what you tried into the report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first.

Read before writing, in this order:
- `scripts/luna-grok.ts` end to end (the one-shot runner you are mirroring: injected deps, kill timeout, `stripFences`).
- `scripts/luna-budget.ts` lines 1–40 (`WorkerKind`, `MindEngine`, `CodexRunner`) and 213–330 (`SidecarDeps`, `resolveRequestEngine`, `handleDecide`, `healthPayload`).
- `scripts/luna-sidecar.ts` lines 80–100 (`resolveDefaultEngine`, `resolveGrokModel`), 205–235 (`runGrok`), 236–290 (middleware), 340–420 (plugin boot, `deps`).
- `scripts/lineage-run.mjs` lines 1–30 (usage block), 100–160 (`sidecarDecider`, flags), 395–470 (boot, health check, progress line, `pending.mind` summary).
- `scripts/lineage-probe.mjs` lines 30–60 and 150–180 (env set before vite boot; `engine: 'codex'` in the request body).
- `test/sidecar-grok.test.ts` end to end (the test style you copy: fakes injected, no network, no real spawn).

## What this dispatch builds

A third mind engine, `openrouter`, that calls the OpenRouter chat-completions HTTP API directly from the sidecar (no CLI in the middle), and makes it the default engine for the lineage runner and the lineage probe. Model default `deepseek/deepseek-v4.1-flash`. The browser-side LunaBrain (`src/mind/**`, `?mind=` parsing) is out of scope and untouched.

## Files

```
scripts/luna-openrouter.ts          NEW: runOpenRouterWithDeps, resolveOpenRouterKey, DEFAULT_OPENROUTER_MODEL, OPENROUTER_KILL_MS
scripts/luna-budget.ts              EDIT: engine/worker unions, SidecarDeps.openRouterRunner, dispatch, usage passthrough, healthPayload extra
scripts/luna-sidecar.ts             EDIT: resolveDefaultEngine, resolveOpenRouterModel, runOpenRouter, deps wiring, worker label
scripts/lineage-run.mjs             EDIT: --engine codex|grok|openrouter (default openrouter), --model, health print, cost/tokens in summary
scripts/lineage-probe.mjs           EDIT: --engine flag (default openrouter), request body uses it
test/sidecar-openrouter.test.ts     NEW
audit-reports/lineage-e1-report.md  NEW
```

## 1. `scripts/luna-openrouter.ts`

No `node:*` imports (same rule as `luna-grok.ts`; unit tests import it under the src tsc). Everything that touches the world is injected.

```ts
export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash'
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_KILL_MS = 60_000

export type OpenRouterUsage = { promptTokens: number; completionTokens: number; costUsd?: number }

export interface RunOpenRouterDeps {
  apiKey: string
  model: string
  killMs: number
  jsonMode: boolean
  now: () => number
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>
  sleep: (ms: number) => Promise<void>
}

export function runOpenRouterWithDeps(system: string, user: string, deps: RunOpenRouterDeps):
  Promise<{ text: string; latencyMs: number; worker: 'openrouter'; usage?: OpenRouterUsage }>
```

Behaviour to pin:
- Request body: `{ model, messages: [{role:'system', content: system}, {role:'user', content: user}], usage: { include: true } }` plus `response_format: { type: 'json_object' }` when `jsonMode`. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`, `X-Title: luna-island`.
- One attempt aborts at `killMs` via `AbortController`. On HTTP 429 or 5xx or a network/abort error, retry ONCE after `sleep(2000)`. A second failure throws `Error` with `openrouter <status>: <first 200 chars of body>` (or the network message). Never include the key in any message.
- Success: `text = stripFences(choices[0].message.content)` (import `stripFences` from `./luna-mcp-worker` exactly as `luna-grok.ts` does). Empty or missing content throws `openrouter: empty completion`. `latencyMs` is wall time across attempts. `usage` maps `prompt_tokens`, `completion_tokens`, and `cost` (present when OpenRouter honours `usage.include`) when the response carries them.

```ts
export function resolveOpenRouterKey(env: Record<string, string | undefined>, readFile: (p: string) => string, homedir: string):
  { key: string; source: 'env' | 'opencode' } | { key: null; source: 'missing' }
```
Order: `env.OPENROUTER_API_KEY` (non-empty) → `<homedir>/.local/share/opencode/auth.json` field `openrouter.key` (parse errors and missing file count as missing) → missing. The sidecar never logs the key or its length.

## 2. `scripts/luna-budget.ts`

- `WorkerKind = 'mcp' | 'exec' | 'grok' | 'openrouter'`; `MindEngine = 'codex' | 'grok' | 'openrouter'`.
- `resolveRequestEngine`: body `engine === 'openrouter'` returns `'openrouter'`; unknown still falls to default.
- `SidecarDeps.openRouterRunner?: CodexRunner` (same signature as `grokRunner`). Dispatch: `openrouter → deps.openRouterRunner`, `grok → deps.grokRunner`, else `deps.runner`. The existing 502 `"<engine> engine not configured"` covers a missing runner.
- The runner result type gains optional `usage?: OpenRouterUsage`; `handleDecide` passes it through as `json.usage` when present. Budget accounting (`recordSuccess`, 402, 429) applies to every engine identically; do not special-case.
- `healthPayload` gains `engine: MindEngine` (the default engine) and, only when it is `openrouter`, `openrouter: { model: string; keySource: 'env' | 'opencode' | 'missing' }`. Thread these in through parameters, not module state.

## 3. `scripts/luna-sidecar.ts`

- `resolveDefaultEngine`: `LUNA_ENGINE=openrouter` → `'openrouter'`; grok as before; default stays `codex` (the browser app is unaffected).
- `resolveOpenRouterModel()`: `LUNA_OPENROUTER_MODEL`, default `DEFAULT_OPENROUTER_MODEL`. `LUNA_OPENROUTER_JSON=0` turns `jsonMode` off; default on.
- `runOpenRouter(system, user)` builds deps with real `fetch`, `Date.now`, `setTimeout` sleep, the resolved key (via `fs.readFileSync` + `os.homedir()`), model, `OPENROUTER_KILL_MS`.
- Wire `openRouterRunner` into `deps`. Worker label in the boot log: `openrouter` when that is the default engine. If the default engine is `openrouter` and the key source is `missing`, log one clear line at boot (`[luna-sidecar] openrouter: no API key (set OPENROUTER_API_KEY or log in with opencode)`) and let health report it; do not throw at boot.
- Do not change how the codex pool is created; it may stay idle.

## 4. `scripts/lineage-run.mjs`

- `--engine codex|grok|openrouter`, default `openrouter`. `--model <id>` (openrouter only) sets `process.env.LUNA_OPENROUTER_MODEL` before vite boots; update the usage block at the top of the file.
- After the health fetch, print `health engine=<engine> worker=<worker> model=<model or ->  key=<keySource or ->`. If `ENGINE === 'openrouter'` and `keySource === 'missing'`, print `openrouter key missing` and exit 1 before any decision.
- `sidecarDecider` returns `usage` when the response has it. Sum into `pending.mind`: `promptTokens`, `completionTokens`, `costUsd` (0 when absent). Progress line appends ` | cost $<costUsd to 4 dp>` when any cost has been seen. The run's written summary (wherever `pending.mind` lands today) carries the three new fields.
- Run-dir naming already includes `${ENGINE}`; leave it.

## 5. `scripts/lineage-probe.mjs`

`--engine` flag, default `openrouter`, sets `LUNA_ENGINE` before boot and is sent as `engine` in every request body. No other change.

## 6. Tests — `test/sidecar-openrouter.test.ts`

Fakes only, no network, no real spawn, no real files. Cover:
1. Success path: correct URL, `Authorization` header, `X-Title`, both messages, `usage.include`, `response_format` present with `jsonMode` on and absent with it off; fences stripped; `usage` mapped; `worker === 'openrouter'`.
2. 429 then 200 → success after one `sleep(2000)`; 500 then 500 → throws with status and body excerpt, no key in the message.
3. Abort: `fetchImpl` never resolves until the signal aborts → rejects within `killMs` (use fake timers or an injected `now`).
4. Empty content → `openrouter: empty completion`.
5. `resolveOpenRouterKey`: env wins over file; file parsed when env empty; malformed file → missing; both absent → missing.
6. `resolveRequestEngine({engine:'openrouter'})`; `handleDecide` with `openRouterRunner` set routes there and passes `usage` through; without it returns 502 `openrouter engine not configured`; `healthPayload` carries `engine` and `openrouter` fields.

Gates: the type-check that `npm run build` performs (confirm the exact command from `package.json`) and `npx vitest run test/sidecar-*.test.ts test/lineage-*.test.ts` green. `npm run check` has a pre-existing timeout flake in unrelated suites (conversation/economy/wild-screenplay); if only those fail, note it and move on.

## 7. Smoke run — at most 20 real calls

```
node scripts/lineage-run.mjs --brain llm --engine openrouter --seeds 42 --seasons 1 --days 1 --cohort 4 --tag e1-smoke
```
That is 4 villagers × 4 turns = 16 decisions. Confirm in the run dir: 16 recorded decisions, `fallback 0`, `invalid` count, mean latency, tokens and cost summed, health line printed with `key=opencode` (or `env`). If OpenRouter rejects `response_format` for this model (4xx mentioning it), set `jsonMode` default to off, rerun the smoke once, and say so in the report. Do NOT run anything larger than this.

## 8. Report — `audit-reports/lineage-e1-report.md`

Under 60 lines: files touched, the smoke numbers (decisions, fallbacks, invalid, latency mean/max, prompt+completion tokens, cost), whether JSON mode is on, test counts, anything you could not finish and why.

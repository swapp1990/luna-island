# Dispatch INK-P2 — Ink Town: two grok minds that decide for themselves

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER
spawn subagents. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`,
`plans/`, `specs/`, or anything under `src/sim/**`, `src/town/**`, `src/lineage/**`,
`src/mind/**`. You may read all of those. You may edit `src/ink/**` (INK-P1's output) and
create the new files listed below. If a gate will not go green after 3 distinct fix
attempts, STOP and report honestly in your audit report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md`, then
`plans/ink-town.md`, then `specs/ink-p1-world-and-ink.md` (the world you are plugging
into), then the P1 code under `src/ink/`. Where anything disagrees with this spec, this
spec wins.

Read these before writing: `scripts/luna-openrouter.ts` end to end (this is the exact
shape your xAI runner copies — injected `fetchImpl`, injected clock, one retry, no
`node:` imports so it stays unit-testable), `scripts/luna-sidecar.ts` sections that wire a
runner into a vite plugin and gate on budget, `src/lineage/prompt.ts` (facts-only world
text and the one-JSON-object contract), `src/lineage/decider.ts`, and `src/mind/parse.ts`
(how a sloppy model reply gets salvaged).

## What this dispatch builds

The two dots stop being driven by the four-line rule brain and start being driven by a
cheap grok model that gets **world facts and nothing else** — no strategy, no hints, no
"remember to buy food before the weekend". One decision per mind per sim hour. The clock
never waits for it.

## Files you create

```
scripts/luna-xai.ts            xAI chat-completions runner (no node: imports)
scripts/ink-sidecar.ts         vite plugin: /api/ink/health, /api/ink/decide, /api/ink/journal
src/ink/mind/prompt.ts         buildSystem(), buildUser(obs, memory)
src/ink/mind/parse.ts          parseIntent(text) returns Intent or a ParseError
src/ink/mind/memory.ts         rolling 8-hour per-mind log
src/ink/mind/grokBrain.ts      async brain: requests at the hour boundary, never blocks
test/ink-prompt.test.ts
test/ink-parse.test.ts
test/ink-memory.test.ts
test/xai-runner.test.ts
audit-reports/ink-p2-report.md your report (section 9)
```

Files you edit: `src/ink/main.tsx` (brain selection + journal posting), `src/ink/loop.ts`
(only if the decision pump needs a hook), `src/ink/ui/Hud.tsx` (engine badge, section 7),
`vite.config.ts` (register `inkSidecarPlugin()` alongside the existing plugins — add the
import and the array entry, change nothing else).

## 0. Measured ground truth — do not re-derive this, and do not burn calls checking it

A single live probe was run against this account on 2026-09-17 with a draft of the
section 3 prompt. These are facts, not estimates:

- The account's `GET https://api.x.ai/v1/language-models` returns exactly:
  `grok-4.20-0309-non-reasoning`, `grok-4.20-0309-reasoning`, `grok-4.20-multi-agent-0309`,
  `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-build-0.1`. **There is no `fast` tier on this
  key** — any spec, doc or memory naming `grok-4-fast-*` or `grok-4-1-fast-*` is stale.
- Cheapest general models are `grok-4.20-0309-non-reasoning` and `grok-4.3`, tied at
  12500 prompt / 25000 completion price units per token. `grok-4.20-0309-non-reasoning` is
  the default here because it returned `reasoning_tokens: 0` — no hidden thinking spend.
- One decide measured **842 ms**, `prompt_tokens: 617`, `completion_tokens: 35`,
  `cost_in_usd_ticks: 7243500` (a small fraction of a cent). 128 prompt tokens came back
  cached, so a stable system prompt gets cheaper as the run goes on — another reason the
  system half must be built once per run and not rebuilt per hour.
- `response_format: { type: 'json_object' }` was honoured; the reply parsed on the first
  attempt and carried a situational reason. It also emitted `"count": 1` on a non-`buy`
  action, which is exactly why section 5 drops a stray `count` instead of failing.

The key is already present at the repo root in `.env.local` as `XAI_API_KEY` (gitignored
by the existing `*.local` rule). **Never read, copy, print or log that value**, and never
add it to a committed file.

## 1. The xAI runner (`scripts/luna-xai.ts`)

OpenAI-compatible chat completions at `https://api.x.ai/v1/chat/completions`.

```ts
export const XAI_URL = 'https://api.x.ai/v1/chat/completions'
export const XAI_MODELS_URL = 'https://api.x.ai/v1/language-models'
export const DEFAULT_XAI_MODEL = 'grok-4.20-0309-non-reasoning'
export const XAI_KILL_MS = 20_000

export interface RunXaiDeps {
  apiKey: string; model: string; killMs: number; jsonMode: boolean
  now: () => number
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>
  sleep: (ms: number) => Promise<void>
}

export function runXaiWithDeps(system: string, user: string, deps: RunXaiDeps): Promise<{
  text: string; latencyMs: number; worker: 'xai'
  usage?: { promptTokens: number; completionTokens: number }
}>
```

Mirror `luna-openrouter.ts` exactly in structure: `AbortController` on `killMs`, one retry
after a 2s sleep on a network error or a 429/5xx, `response_format: { type: 'json_object' }`
when `jsonMode`, `temperature: 0.7`, `max_tokens: 200`. Strip code fences from the reply
(reuse `stripFences` from `scripts/luna-mcp-worker.ts`). **Never log the key, its length,
or any prefix of it.**

Key resolution, in order: `env.XAI_API_KEY`, then `env.GROK_API_KEY`, then a
`XAI_API_KEY=` line in a `.env.local` at the repo root (parse it yourself, no dotenv
dependency), then missing. Export `resolveXaiKey(env, readFile, cwd)` returning
`{ key, source: 'env' | 'env-grok' | 'dotenv' | 'missing' }`, the same shape
`resolveOpenRouterKey` uses.

**Model resolution.** `INK_MODEL` overrides `DEFAULT_XAI_MODEL`. At boot, if a key exists,
`GET XAI_MODELS_URL` once (3s timeout, failure is non-fatal and silent beyond one log
line) and log the available ids as a single line. If the configured model is absent from
that list, log a clear line naming the configured model and the ids that were offered, and
keep the configured model anyway — do not guess a substitute. Health reports the resolved
model and whether it was found in the list.

## 2. The sidecar (`scripts/ink-sidecar.ts`)

A **new, small** vite plugin. Do not modify or extend `scripts/luna-sidecar.ts` — that one
is tangled with codex/mcp and the colony's budget, and this track must not be able to break it.

- `GET /api/ink/health` returns
  `{ ok, model, keySource, modelListed, budget: { hour, day, maxPerHour, maxPerDay }, inFlight }`.
- `POST /api/ink/decide` with `{ system, user, mindId, tick }` returns
  `{ text, latencyMs, usage }` on success.
  - 402 with `{ error: 'budget' }` when the hour or day cap is spent.
  - 429 with `{ error: 'busy' }` above 4 in-flight requests.
  - 503 with `{ error: 'no-key' }` when the key is missing.
  - 502 with `{ error, detail }` on an upstream failure.
- `POST /api/ink/journal` with a JSON-serialisable record appends one JSON line to
  `artifacts/ink/<runId>/journal.jsonl`, creating directories as needed. `runId` comes
  from the body and must be sanitised to `[A-Za-z0-9_-]{1,64}` — reject anything else with
  400 and never join an unsanitised path.

Budget caps: `INK_MAX_PER_HOUR` (default 600), `INK_MAX_PER_DAY` (default 4000), counted in
requests, held in memory, keyed on the wall-clock hour and day. Log one boot line:
`[ink-sidecar] model=<m> key=<source> maxPerHour=<n> maxPerDay=<n>`. Never log prompts or
replies in full — a truncated 120-character preview is fine at `INK_DEBUG=1` only.

## 3. The system prompt (`src/ink/mind/prompt.ts`)

Facts only. This is the experiment: nothing in the prompt may tell a mind what is a good
idea, what it should plan for, or what any need means for its wellbeing. The discipline is
`src/lineage/prompt.ts` — go read `WORLD_RULES_TEXT` before you write yours.

`buildSystem()` returns, in this order:

1. One line of identity: the mind's name and that it lives in a small town.
2. The world facts, generated **from `INK_CONFIG` and the place table**, never
   hand-copied numbers (a test asserts the prompt changes when the config changes):
   - the five places, and that an action only works where it works;
   - that hunger, energy and company sit between 0 and 1 and fall every hour;
   - that eating needs a meal in your own fridge and your fridge holds at most 6;
   - that meals are bought at the market for 20 each and the market is open 09:00-18:00
     Monday to Friday;
   - that the workshop pays 15 an hour and is open 09:00-17:00 Monday to Friday;
   - that company rises only while both of you are in the town centre at the same time;
   - that walking between places takes minutes and you decide again each hour.
3. The action contract, exactly one JSON object and nothing else:

```
{"action": <go_home|go_work|go_market|go_center|sleep|eat|buy|work|socialize|wait>,
 "count": <1-6, only for buy>,
 "reason": <at most 100 characters, first person, why>}
```

**Forbidden in the system prompt** — a test greps for these and fails the build: any of the
words "should", "make sure", "remember to", "important", "try to", "strategy", "plan
ahead", "stock up", "in advance", "don't forget", "goal", "score", "survive", "optimal",
"best". If you find yourself wanting one, you are writing choreography instead of a world.

`buildUser(obs, memory)` is the changing half:

- `It is Thursday, 14:00.` plus whether the market and workshop are open **right now**,
  and, when shut, the next hour they open.
- Where you are (a place or "walking to X, about N minutes away").
- Your hunger, energy and company to two decimals; your money; how many meals are in your
  fridge and the capacity.
- Where the other mind is right now, by name. Nothing else about it — no needs, no plans.
- `In the last 8 hours:` the memory lines (section 4). `Nothing yet.` on the first hour.

Keep the whole user message under about 400 tokens. Do not include the event trace, past
reasons of the other mind, or anything the mind could not plausibly perceive.

## 4. Memory (`src/ink/mind/memory.ts`)

A rolling window of the mind's own last 8 decided hours, one line each:

```
13:00 you chose buy 3 — bought 3 meals for 60
12:00 you chose work — worked, earned 15
11:00 you chose work — you are at home-a, not at the workshop
```

Built from the P1 event trace (`decision` + the `action:ok` / `action:fail` that follows
it), not from a parallel bookkeeping structure — invariant 3. Failures appear verbatim with
their reason: the mind reading back its own failed hour is the only feedback loop in the system.

## 5. Parsing (`src/ink/mind/parse.ts`)

`parseIntent(text)` returns `{ ok: true, intent }` or `{ ok: false, error }`. It must:

- find the first balanced `{...}` in the text (models prepend chatter even in JSON mode);
- accept only the ten action names, case-insensitively, trimmed;
- coerce `count` to an integer 1..6 and default it to 1 for `buy`; reject `count` on any
  other action by dropping it, not by failing;
- truncate `reason` to 100 characters, and supply `"(no reason given)"` when absent;
- fail with a short machine reason (`no-json`, `unknown-action`, `bad-count`) that is
  recorded in the journal.

A parse failure is a fallback, never a crash and never a retry — one call per mind-hour is
the budget, full stop.

## 6. The brain (`src/ink/mind/grokBrain.ts`) — the clock never waits

At each hour boundary, for each mind, in mind-id order:

1. Build system and user, POST to `/api/ink/decide`.
2. **Return `null` immediately** so `step.ts` keeps the mind doing what it was doing.
3. When the reply lands, parse it and call `applyIntent(state, mindId, intent, 'llm')`.
4. If it has not landed by the **next** hour boundary, abandon it (a late reply for a
   stale hour is dropped, never applied — stamp `stale` in the journal) and let the P1 rule
   brain decide that hour with `source: 'fallback'`.
5. Any 402/429/503/502 or a parse failure also falls back, with the reason recorded.

One in-flight request per mind at a time. Never queue a backlog. When the sim is paused or
the tab is hidden, no requests are issued at all.

Every decision writes one journal line via `/api/ink/journal`:

```json
{"runId","tick","day","hour","mindId","source","action","count","reason",
 "raw","latencyMs","promptTokens","completionTokens","error","stale",
 "state":{"hunger","energy","social","money","fridge","at"}}
```

`runId` is generated once at boot (`ink-<seed>-<YYYYMMDD-HHmm>`), shown in the HUD, and
also written once as a first line of run metadata (seed, model, config snapshot).

## 7. Wiring and the UI badge

- Brain selection by URL query: `/ink` uses the rule brain (unchanged P1 behaviour,
  deterministic, zero cost); `/ink?brain=grok` uses the grok brain. Default stays the rule
  brain so nobody spends money by opening a tab.
- The HUD gains one compact line: model name, decisions this hour, spend-free counters
  `llm / fallback / stale`, and the budget state. Make a fallback visually obvious — a
  fallback-driven hour is a *hole in the experiment*, not a detail.
- Extend the bridge without breaking P1's shape:
  `window.__inkState.engine = { brain: 'rule' | 'grok', model, llm, fallback, stale, budget }`.

## 8. Gates — all must be green

1. `npm run build` clean.
2. `npm run test` green, including:
   - `xai-runner.test.ts`: injected `fetchImpl` covering success, 429-then-success retry,
     timeout abort, malformed body; asserts the request carries `response_format` in JSON
     mode and that **the key never appears in any thrown message or log call**.
   - `ink-prompt.test.ts`: the system prompt contains no forbidden word (section 3); the
     facts change when `INK_CONFIG` changes (flip `mealPrice` and assert the text moves);
     the user message contains the other mind's location and no needs of the other mind;
     a shut market renders its next opening.
   - `ink-parse.test.ts`: clean JSON, fenced JSON, JSON with prose around it, unknown
     action, `count` of 0 / 9 / "three", missing reason, a 400-character reason, empty string.
   - `ink-memory.test.ts`: the window is exactly the last 8 decided hours, includes failure
     reasons verbatim, and is derived from the trace.
3. **One real end-to-end call, and only one.** With a key present, run a single scripted
   decide against the live API (a tiny node script, not a soak) and paste the raw reply,
   the latency and the token counts into your report. If the key is missing, say so and
   report the gate as blocked — do not fake it.
4. `npx playwright test e2e/ink.spec.ts` still green (P1's assertions must not regress
   under the default rule brain).
5. A **90-minute-of-sim** dry run with a stubbed decide endpoint (returns a fixed valid
   JSON after a 1500 ms delay) shows: zero blocked ticks, every hour decided, no request
   backlog, and the clock rate unchanged from P1. Report the measured numbers.

## 9. Your report — `audit-reports/ink-p2-report.md`

Gate results verbatim. The exact system prompt as sent, in a fenced block, and its token
count. One real user message. The single live reply from gate 3 with latency and tokens,
and the measured cost per decision from the model's published price. Fallback and stale
counts from gate 5. Every deviation from this spec, with why. If a gate is blocked, say
blocked — never green.

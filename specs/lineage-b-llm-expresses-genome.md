# Dispatch LINEAGE-B — The LLM expresses the genome

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, anything under `src/sim/**`, `src/mind/**`, or `scripts/luna-*.ts` (you only import from or call them). No web page, no React. If a gate will not go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first, then `plans/lineage.md` end to end (Phase B is §6), then `audit-reports/lineage-a-report.md` (what Phase A measured and why yield is 0.5). Where this spec and the plan disagree, this spec wins.

Read before writing, in this order: `src/lineage/types.ts`, `src/lineage/step.ts`, `src/lineage/run.ts`, `src/lineage/genome.ts` (`dnaText`, `bandOf`), `src/lineage/instinctBrain.ts`, `scripts/lineage-run.mjs`, then the seam you will call: `scripts/luna-budget.ts` lines 230–320 (`handleDecide`: body `{system,user,engine,kind}` → `{text,latencyMs,budget}`, 402 = budget exhausted, 429 = all lanes busy), `scripts/luna-sidecar.ts` lines 80–100 and 340–360 (env knobs `LUNA_ENGINE`, `LUNA_CONCURRENCY` clamped 1–4, `LUNA_MAX_PER_HOUR`, `LUNA_MAX_PER_DAY`, read once at vite boot), `scripts/soak-political.mjs` lines 20–60 (how a Node script boots its own vite with those env vars), `src/mind/prompt.ts` lines 28–90 and 300–380 (the tone of the existing system/user prompts and the JSON contract), and `scripts/luna-mcp-worker.ts` `extractJsonObject` / `stripFences` (copy the logic into pure code; do not import Node-side files into `src/lineage`).

## What this dispatch builds

An LLM brain for the text hamlet, the harness that runs it against the existing sidecar, a recorded-decision replay, and the **phenotype-expression report** that decides Phase B's go/no-go: does a villager whose DNA block says "generous" actually give more, does "voice" propose more, does "temper" shun more, in a dose-response across low/mid/high bands, and does the effect vanish when the DNA block is removed from the prompt.

You build and test everything with a deterministic mock decider and may spend at most **20 real LLM calls** on one smoke run. The main session runs the gate (~2,000 calls). Do NOT run anything larger.

## Files

```
src/lineage/prompt.ts              buildSystemPrompt, buildUserPrompt, parseIntent, WORLD_RULES_TEXT, ACT_CONTRACT
src/lineage/decider.ts             Decider interface, RecordedDecision, recordedBrainFactory, mockDecider
src/lineage/runAsync.ts            runLineageAsync(config, decider, opts) — same loop as run.ts, async per turn
src/lineage/render/expression.ts   expressionReport(events, lineage, config) → { markdown, json }
src/lineage/step.ts                EDIT: export observe(state, villager): LineageObservation (extract the existing builder)
scripts/lineage-run.mjs            EDIT: --brain instinct|llm|mock, --engine codex|grok, --dna on|off, --concurrency, --budget-hour, --budget-day, --replay <dir>, --tag <label>
scripts/lineage-expression.mjs     CLI: <runDirA> [<runDirB>] → expression.md (+ .json) comparing arms
test/lineage-prompt.test.ts
test/lineage-decider.test.ts
test/lineage-runasync.test.ts
test/lineage-expression.test.ts
audit-reports/lineage-b-report.md
```

Everything under `src/lineage/**` stays pure: no `node:*`, no `fetch`, no `three`, `react`, DOM, `Math.random`, `Date`, `performance`. The network lives only in `scripts/lineage-run.mjs`.

## 1. Simultaneous decisions (pin this)

The sync engine stays as it is. Each turn:

1. Snapshot: for every living villager in id order, `observe(state, v)` at turn start. Everyone decides from the same snapshot (simultaneous moves), so decisions can be requested in parallel.
2. Request all decisions through the `Decider` (bounded by `concurrency`), collect `RecordedDecision[]`.
3. Call the existing `advanceTurn(state, brainFor, rng, trace)` with a `brainFor` that returns, for each villager, a brain whose `decide()` hands back the pre-decided intent. Acts still resolve in id order through the unchanged `step.ts` rules.

```ts
export interface DeciderInput { villager: Villager; obs: LineageObservation; system: string; user: string; season: number; day: number; turn: Turn }
export interface RecordedDecision {
  season: number; day: number; turn: Turn; villagerId: string
  intent: LineageIntent
  source: 'llm' | 'fallback' | 'replay' | 'mock'
  raw?: string            // model text, kept in decisions.jsonl only
  error?: string          // parse/validation error when source === 'fallback'
  latencyMs?: number
}
export interface Decider { decide(input: DeciderInput): Promise<{ text: string; latencyMs: number } | { fallback: true; error: string }> }
```

`runLineageAsync(config, decider, { dna: boolean; concurrency: number; onDecision?: (d: RecordedDecision) => void; fallbackBrain?: LineageBrain })` returns `LineageRunResult & { decisions: RecordedDecision[]; mind: { llm: number; fallback: number; invalid: number; meanLatencyMs: number } }`. Every decision appends a trace event: `mind:decision { villagerId, source, latencyMs }` or `mind:fallback { villagerId, error }`. Raw model text goes to `decisions.jsonl`, never into the trace (keeps the chronicle small).

**Replay.** `recordedBrainFactory(decisions)` builds a sync `BrainFactory` that returns the recorded intent keyed by `(season, day, turn, villagerId)`; missing key → the instinct brain. `runLineage(config, recordedBrainFactory(decisions))` on the same config MUST reproduce the recorded run's `hash` and `eventCount` exactly. This is the "replay never calls an API" gate, and it is how Run Theater will later mount these runs.

## 2. Prompt (`prompt.ts`)

**System** = identity + optional DNA block + world rules + contract. Identity: `You are <Given Surname>, generation <g> of the hamlet` plus, for generation > 0, `child of <p1 surname> and <p2 surname>`. DNA block: `dnaText(villager.traits)` verbatim when `dna` is on; omitted entirely when off (the control arm; nothing else changes). World rules: a fixed ≤ 18-line digest of `plans/lineage.md` §2 in plain second person: the five rooms, the three needs and that four hungry turns means leaving for the coast, what each of the thirteen acts does with its numbers, how the granary and the three rules work, that a proposal needs three votes at dusk, that courting records interest and that mutual interest matters when families form at season's end. State facts only; never say what to do, never rank acts, never mention traits, genes, fitness, or selection. Contract:

```
Reply with ONE JSON object and nothing else:
{"action": <one of work|forage|rest|eat|store|withdraw|give|talk|court|propose|vote|shun|idle>,
 "target": <villager name for give/talk/court/shun, else omit>,
 "amount": <number for give/store/withdraw, else omit>,
 "text": <≤140 chars for talk/propose/shun, else omit>,
 "rule": <granary-open|granary-closed|ration-granary for propose, else omit>,
 "proposalId": <id for vote, else omit>, "choice": <for|against for vote, else omit>,
 "reason": <≤160 chars, first person, why>}
```

**User** = observation, in this order, one line each: `Season s, day d, <dawn|noon|dusk|night>.`; `You are in the <room>.`; needs as percentages; `Grain: x. Standing: y.`; `Granary: n. Rules in force: …`; open proposal (id, rule, by, votes so far) or `No open proposal.`; `Others:` then one line per living villager: name, room, standing, and the last thing they said to you this season if any (from `speech` events, ≤ 3); `Your recent acts:` last 6 of your `action:start`/`action:fail` events as `<turn>: <act> → <outcome>`; `Courted this season: …` if any. Keep system + user under ~1,100 tokens (≈ 4,400 chars); assert the cap in tests on a full 12-villager state.

**`parseIntent(text, obs): { intent } | { error }`.** Strip fences, take the first balanced `{…}`, `JSON.parse`. Validate: `action` in the act list; `target` resolves case-insensitively to a living villager by given name or full name and is not self (required for give/talk/court/shun, ignored otherwise); `amount` positive finite when present; `text` trimmed to 140; `rule` in the set for propose; `proposalId` matches an open proposal and `choice` valid for vote; `reason` non-empty, trimmed to 160. Any failure → `{ error }` with a short reason string. Never "repair" an invalid action into a different one.

## 3. Decider implementations (`decider.ts`, `scripts/lineage-run.mjs`)

- **`mockDecider(rng)`** (pure, in `decider.ts`): returns JSON text derived from the villager's trait bands so the whole pipeline and the expression report can be tested without a network. Rules: if satiety < 0.3 and grain ≥ 1 → eat; energy < 0.25 → rest; else pick by bands with the seeded rng: generosity high → `give` 1 grain to the lowest-standing other with p 0.5 (mid 0.2, low 0.05); voice high → `propose ration-granary` when no proposal is open with p 0.3 (mid 0.1, low 0.02), else `vote for` if one is open; temper high → `shun` a random other with p 0.25 (mid 0.08, low 0.01); boldness high → `forage` else `work`; thrift high → `store` when grain > 3; sociability high → `court` the most-talked-with other from day 3 (mid day 6, low never); otherwise `talk` with a fixed line. Also, with p 0.03, return deliberately malformed text (`"I will work"`) so the fallback path is exercised. When `dna` is off the mock ignores bands and uses the mid probabilities everywhere. This mock is a test fixture; say so in a comment.
- **`sidecarDecider`** (in `scripts/lineage-run.mjs`, Node): POST `http://127.0.0.1:<port>/api/luna/decide` with `{ system, user, engine, kind: 'decision' }`. 429 → wait 750 ms and retry (the sidecar is saying all lanes are busy), up to the per-decision deadline of 90 s; 402 → `{ fallback: true, error: 'budget' }` and set a flag so the run logs `BUDGET EXHAUSTED at season/day/turn` once; network error or deadline → `{ fallback: true, error }`. Concurrency: a simple semaphore of size `--concurrency` (default 3, matching `LUNA_CONCURRENCY`).
- The script must set `LUNA_MAX_PER_HOUR`, `LUNA_MAX_PER_DAY`, `LUNA_CONCURRENCY`, and `LUNA_ENGINE` in `process.env` BEFORE `createServer()` (the sidecar reads them at boot), exactly as `soak-political.mjs` does. Defaults for `--brain llm`: `--budget-hour 2500 --budget-day 6000 --concurrency 3 --engine codex`. Poll `GET /api/luna/health` once before the first decision and print the worker/engine line; if health fails, exit non-zero with a clear message instead of running 960 fallbacks.

## 4. Runner flags and outputs

`node scripts/lineage-run.mjs --brain llm --dna on --seasons 2 --seed 42 [--engine codex] [--tag gate]`

- Output dir `artifacts/lineage/<tag or brain>-<engine>-dna<on|off>-seed<seed>-<stamp>/` with everything Phase A writes plus `decisions.jsonl`, `prompts-sample.md` (the first villager's full system + user prompt at season 1 day 1 dawn and at season 2 day 5 dusk, verbatim), `mind.json` (`{llm, fallback, invalid, meanLatencyMs, budgetAtEnd, wallMs}`), and `expression.md` / `expression.json` (§5) for that run alone.
- Progress: print one line per sim day: `S1 D3 | llm 132 fallback 4 | mean 6.2s | budget 136/2500h | wall 4m10s`. Also append the same line to `<outdir>/progress.log` so a watcher can tail it.
- `--brain mock` runs the same async path with `mockDecider`; `--brain instinct` is the Phase A path unchanged.
- `--replay <dir>`: read `<dir>/summary.json` config and `<dir>/decisions.jsonl`, run the sync `runLineage` with `recordedBrainFactory`, print `replay hash <h> events <n> — MATCH|MISMATCH` against the recorded summary, exit non-zero on mismatch. Must not start the sidecar or make any request.
- Ctrl-C / SIGINT: flush `decisions.jsonl` and `mind.json` for what ran so far, then exit.

## 5. Expression report (`render/expression.ts`, `scripts/lineage-expression.mjs`)

Pure function of `(events, lineage records, config)`. For each **trait → act** pair below, compute per villager the act rate = count of that villager's `action:start` of that kind ÷ that villager's living days (from `season:start`/`lineage:arrive` to departure), then group villagers by `bandOf(traits[trait])`:

| trait | act | expectation |
|---|---|---|
| generosity | give | high > low |
| voice | propose | high > low |
| temper | shun | high > low |
| boldness | forage | high > low |
| thrift | store | high > low |
| sociability | court | high > low |
| curiosity | talk to a *new* partner (first `speech` to that id) | high > low |
| caution | rest | high > low |

Per pair output: n per band, mean rate per band, `slope = mean(high) − mean(low)`, and a permutation p-value: shuffle band labels across villagers 2,000 times with a `createRng(config.seed + 7)` and count slopes ≥ observed. Mark a pair **expressed** when slope > 0, `n(high) ≥ 5`, `n(low) ≥ 5`, and p < 0.05. Also compute the same for the four constitution traits as a sanity row (industry → work should be flat or weak; it acts through yield, not choice).

Markdown: one table for the run, then a verdict line: `Expressed: k of 8 disposition pairs`. `scripts/lineage-expression.mjs <dirA> [<dirB>]` renders both and, with two dirs, a side-by-side table (dna on vs off) with a final line: `DNA on: k/8 expressed. DNA off: m/8 expressed.` JSON alongside. Exact numbers, no adjectives.

## 6. Tests (vitest, `environment: node`, seeded rng everywhere)

- `lineage-prompt.test.ts`: system prompt with `dna: true` contains `dnaText(traits)` verbatim and with `dna: false` contains none of its clauses; the world-rules text never contains "should", "must", "trait", "gene", "fitness", "select"; system + user ≤ 4,400 chars on a full 12-villager state at day 5 dusk with an open proposal and prior speech; `parseIntent` accepts a fenced valid object, rejects an unknown action, a self-target, a dead target, a vote on a closed proposal, and missing reason, each with a distinct error; a `talk` with 200-char text is trimmed to 140.
- `lineage-decider.test.ts`: `mockDecider` on a hand-built high-generosity villager returns `give` more often than on a low-generosity one over 500 seeded draws; malformed output occurs at ≈ 3%; `recordedBrainFactory` returns the recorded intent for a known key and the instinct decision for a missing one.
- `lineage-runasync.test.ts`: `runLineageAsync` with `mockDecider`, 2 seasons, seed 42 → then `runLineage` with `recordedBrainFactory(decisions)` yields the identical `hash` and `eventCount`; every `mind:fallback` has an `error`; `mind.llm + mind.fallback` equals the number of villager-turns; the run with `dna: false` and the same seed has a different hash (the mock branches on dna, so it must).
- `lineage-expression.test.ts`: on the mock run with `dna: true`, at least generosity→give, temper→shun, and voice→propose are marked expressed; on the `dna: false` mock run, at most 1 of 8 is marked expressed (false positives at p<0.05 happen); the industry→work sanity row is present; the two-dir markdown contains both verdict lines.

Gates: `npx tsc --noEmit` exit 0; `npx vite build` green; all `test/lineage-*.test.ts` green (Phase A's 17 included); purity grep over `src/lineage/**` (`node:|fetch\(|three|react|document|window|Math\.random|Date\.|performance`) → no matches; `git status --short src/sim src/mind scripts/luna-*.ts` shows nothing changed by you (read-only evidence). Do not run the full `npm run check`; its pre-existing timeout flake is known.

**Smoke (≤ 20 real calls):** `node scripts/lineage-run.mjs --brain llm --dna on --cohort 4 --days 1 --seasons 1 --seed 7 --tag smoke` = 16 decisions. Report the health line, llm/fallback counts, mean latency, one full prompt from `prompts-sample.md`, and one raw model reply. Then `--replay` that dir and paste the MATCH line. If health fails or every call falls back, report that and stop; do not retry more than once.

## 7. Report (`audit-reports/lineage-b-report.md`)

1. Files and line counts. 2. Gate outputs verbatim (tsc, build, vitest summary, purity grep, the read-only status line). 3. Mock end-to-end: the expression table for `--brain mock --dna on` and `--dna off` at 2 seasons seed 42, and the replay MATCH lines. 4. Smoke: numbers listed above. 5. Anything skipped, unsure, or that you would change about the prompt after reading real replies (do not change the spec'd prompt on your own; write the suggestion down). 6. "Questions for main" if any.

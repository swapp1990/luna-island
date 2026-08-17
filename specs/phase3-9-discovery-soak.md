# Dispatch P3-9 — Fast-mind discovery soak harness (denser thinking + autopsy)

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously with Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas go in DEVIATIONS as suggestions. Minimal diffs; the orchestrator red-teams your report against the diff. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**You do NOT run the real soak.** The orchestrator runs the 2-hour codex-backed soak after your gates are green. Your job is the harness, the pacing knob, and the autopsy tool — proven with a short MOCK run.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants, `scripts/soak-political.mjs`, `src/mind/lunaBrain.ts` (cadence + rate window + location-param helpers), `scripts/luna-sidecar.ts` (budget env) first.

## Why (measured, by the orchestrator)

P3-8 gave the minds a dedicated `CODEX_HOME`: **33.4s → 4.9s** mean per decide (6.8×). The Aug-13 baseline soak (`artifacts/soak-political-1786664117410.jsonl`, 120 wall-min, seed 42) shows what the old latency cost us:

- 3830 ticks in 120 min — the world was **breathing (paused waiting on minds) ~47% of wall time**
- 230 decisions total (~115/wall-hour), each agent effectively re-thinking only every ~100 sim-min (pinned near the 120-tick HARD gap, never the 30-tick soft gap)
- **`discovery:examined` = 1** for the entire run. Curiosity had no room to happen.

The surplus gets spent on **denser thinking**: halve the soft cadence gap so a villager can re-think every 15 sim-min instead of 30. Two things would otherwise silently throttle that and must move with it: the sidecar wall-hour budget (240/h — we now expect 600–900/h) and nothing else. The rate window (K dispatches / 15s) stays as-is; if it becomes the binding constraint that is a finding to report, not a thing to tune here.

## 1. Cadence as a knob, not a new default (`src/mind/lunaBrain.ts`)

- `MIND_MIN_GAP_TICKS` keeps its value of **30**. Do not change the constant, and do not change `MIND_HARD_GAP_TICKS`.
- Add an override that mirrors the existing `mindWallFloorMsFromLocation()` pattern exactly: URL param `?mindMinGapTicks=N`, clamped **5–120**, plus a `minGapTicks` field on `LunaBrainOptions` (options win over location, location wins over the constant).
- The resolved value is what the soft-path cadence check uses (the `since >= MIND_MIN_GAP_TICKS` comparison), and is exposed on the bridge as `window.__simState.mind.minGapTicks` so the harness can prove it took effect. Bridge shape is additive — do not remove or rename existing `__simState.mind` fields (CLAUDE.md invariant 8).

## 2. Soak harness (`scripts/soak-political.mjs`)

New flags, all with defaults that make the bare command the run we actually want:

| flag | default | effect |
|---|---|---|
| `--minutes` | 120 | unchanged |
| `--port` | 5178 | unchanged |
| `--seed` | 42 | unchanged |
| `--preset` | default | unchanged |
| `--min-gap` | 15 | appended as `&mindMinGapTicks=` to the page URL |
| `--budget-hour` | 900 | `LUNA_MAX_PER_HOUR` for the child vite |
| `--budget-day` | 3000 | `LUNA_MAX_PER_DAY` for the child vite |
| `--concurrency` | 3 | `LUNA_CONCURRENCY` for the child vite |
| `--brain` | codex | `?brain=` value; **`mock` also relaxes the provider abort** so the harness can be smoke-tested without burning calls |

Startup assertions (same fail-fast style as the existing provider check, and log the reason before exiting): provider matches `--brain`, and `__simState.mind.minGapTicks` equals `--min-gap`. A soak that silently ran the old cadence is worse than no soak.

Per-minute journal line gains (keep every existing field — the autopsy compares against old journals):

- `ticksThisMin` and cumulative `breathePct` — `100 * (1 - ticksSoFar / (60 * wallMin))` at speed 1, the direct read on how much wall time went to waiting on minds
- `mind.meanLatencyMs`, `mind.decideCalls`, `mind.minGapTicks`, `mind.budgetUsedDay`
- `decisionsThisMin` and `examinedThisMin`

Stdout (this is what the orchestrator's monitor greps — keep lines one-per-event, prefixed):

- keep the existing `t+Nm …` heartbeat, extended with `breathe=NN% lat=NNNNms`
- `DISCOVERY examined -> N (D{day} {hh:mm})` on every `discovery:examined` increment, and the same for `discovery:noticed` rolled up (noticed is chatty — one line per minute max)
- `BUDGET usedHour/maxHour` on the heartbeat, and a loud `THROTTLE` line the first time `budgetUsedHour >= 0.9 * maxHour` or any `mind:fallback` / `mind:stale` count increases

At shutdown, keep the existing world/story export + `saveNow` + `FINAL` line, and additionally write `artifacts/soak-<ts>-summary.json`: the final counts, per-agent `discovery:examined` targets (from the story export if available, else the trace), sim-days lived, mean latency, breathe %, decisions/wall-hour, and the run's parameters (seed/preset/min-gap/budgets/concurrency/brain). Fail soft — a summary-writer exception must not lose the world export.

## 3. Autopsy tool (`scripts/soak-report.mjs`)

`node scripts/soak-report.mjs <journal.jsonl> [--baseline <journal.jsonl>] [--story <story.json>]` → prints a markdown report to stdout (no file writes, no browser, no network):

- **Run shape:** wall minutes, sim-days lived, ticks/wall-min, breathe %, decisions, decisions/wall-hour, mean latency, fallbacks, stales, budget peak
- **Discovery:** `discovery:examined` / `discovery:noticed` totals and the timeline of every examine (day + hour), per-agent breakdown and target when the story export is supplied; `mind:say` and `mind:reflection` counts; any `learned` facts present in the story export
- **Society:** institution events, collapses, constructions, ownership transfers, friendships
- **vs baseline:** a side-by-side table of the same metrics with deltas and ×-ratios when `--baseline` is given
- Robust to old journals missing the new fields (print `—`, never crash).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; use `PLAYWRIGHT_PORT` if 5175 is busy); purity grep of `src/sim/` empty (no three/React/DOM, no `Math.random`/`Date.now`/`performance.now`); `src/brains/utilityBrain.ts` untouched (quote its SHA256 before/after).
2. New vitest coverage: `mindMinGapTicks` param parsing + clamping (5–120, garbage → default), options-over-location-over-constant precedence, **default stays 30 when nothing is set**, the soft-path cadence honors the resolved value (an agent with `since = 20` is eligible at gap 15 and skipped at gap 30), and `minGapTicks` present on the bridge snapshot.
3. **Harness smoke (this is the proof the 2-hour run won't die at minute 1):** `node scripts/soak-political.mjs --minutes 2 --brain mock --port 5179 --min-gap 15` completes exit 0, the startup assertions pass, the journal has the new fields on every line, and the world/story/summary artifacts are written. Paste the last journal line and the `FINAL` line.
4. `node scripts/soak-report.mjs` on (a) your fresh mock journal with `--baseline artifacts/soak-political-1786664117410.jsonl` and (b) the Aug-13 baseline alone — both print a clean report, exit 0. Paste report (b) in full; it is the baseline column the orchestrator will read the real run against.

## Final report (exact structure)

**BUILT** / **GATES** (evidence: commands + key output lines, SHA256s) / **BASELINE REPORT** (gate 4b, pasted) / **DEVIATIONS** (justified, minimal-diff) / **KNOWN GAPS**.

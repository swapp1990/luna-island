# LINEAGE-E1 — OpenRouter decision engine

Date: 2026-09-16. Dispatch: `specs/lineage-e1-openrouter-engine.md`.

## Files touched

- `scripts/luna-openrouter.ts` — NEW (section 1, already complete/reviewed): `runOpenRouterWithDeps`, `resolveOpenRouterKey`, `DEFAULT_OPENROUTER_MODEL`, `OPENROUTER_KILL_MS`, `OpenRouterUsage`.
- `scripts/luna-budget.ts` — section 2 (already applied): `WorkerKind`/`MindEngine` unions, `SidecarDeps.openRouterRunner`, dispatch, `usage` passthrough, `healthPayload` `engine` + `openrouter` block.
- `scripts/luna-sidecar.ts` — section 3 finished: `resolveDefaultEngine` (+openrouter), `resolveOpenRouterModel`, JSON-mode env, `runOpenRouter` (real fetch/Date.now/setTimeout + key), `openRouterRunner` wired into deps, `worker=openrouter` boot label, missing-key boot line, health threading.
- `scripts/lineage-run.mjs` — section 4: `--engine codex|grok|openrouter` (default openrouter), `--model`, health line `engine/worker/model/key`, hard exit before decisions when key missing, `usage` capture + token/cost sums in `mind.json`, `cost $` on the progress line.
- `scripts/lineage-probe.mjs` — section 5: `--engine` (default openrouter), sets `LUNA_ENGINE` before vite boot, sent in every request body.
- `test/sidecar-openrouter.test.ts` — NEW, 14 tests.
- `audit-reports/lineage-e1-report.md` — NEW (this file).

## Gates

- `npm run build` (= `tsc --noEmit && vite build`, confirmed in `package.json`) — **green** (tsc clean; vite built in 6.22s).
- `npx vitest run test/sidecar-*.test.ts test/lineage-*.test.ts` — **green**: 13 files, **59 tests passed**, 0 failed. New file contributes 14.
- Never touched `src/**`, `README.md`, `CLAUDE.md`, `plans/`, `specs/`, or `test/sidecar-grok.test.ts`.

## Smoke run (16 real calls)

```
node scripts/lineage-run.mjs --brain llm --engine openrouter --seed 42 --seasons 1 --days 1 --cohort 4 --tag e1-smoke
```

Run dir: `artifacts/lineage/e1-smoke-openrouter-dnaon-seed42-20260916-140352`

- decisions **16**, fallback **0**, invalid **0**, source `llm` 16/16.
- latency mean **16,790 ms**, max **39,818 ms**.
- tokens: prompt **13,983**, completion **16,806**; cost **$0.02110622** (4 dp `$0.0211`).
- health line: `health engine=openrouter worker=up model=deepseek/deepseek-v4.1-flash key=opencode`.
- **JSON mode is ON** (`response_format: {type:'json_object'}` accepted by the model; no 4xx, all 16 parsed). Default kept on.

## Deviations / could not finish

- The spec's smoke command uses `--seeds 42`; in `lineage-run.mjs` `--seeds` selects the
  deterministic replicate branch, so it runs **no decisions** (verified: it booted
  `worker=openrouter` then wrote `replicate-y0.5-*` in 6 ms sim). The smoke was therefore
  executed as `--seed 42` (singular) to reach the spec's stated 16-decision target. No other
  deviation.
- One extra `artifacts/lineage/replicate-y0.5-20260916-140239/` dir was produced while
  confirming the `--seeds` behaviour; harmless, no API calls.

Everything in sections 1–8 is complete.
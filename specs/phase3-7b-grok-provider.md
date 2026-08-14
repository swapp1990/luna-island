# Dispatch P3-7b — GrokProvider: 4× faster minds via provider swap

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas → DEVIATIONS. Minimal diffs; the orchestrator red-teams the report. 3 failed fix attempts on a gate → STOP and report. MockProvider covers automated gates; real-CLI measurements are report evidence.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `scripts/luna-sidecar.ts` (incl. P3-7's worker/fallback structure) and `src/mind/providers.ts` first.

## Why (measured, identical trivial prompt)

codex exec cold: 29.0s · codex persistent mcp worker: 27.9s (P3-7 null result — cost is per-conversation session setup) · **grok CLI one-shot: 7.1s**. Same flat-cost economics, already installed (`grok`, v1.0.0+). The `MindProvider` seam exists for exactly this.

## The change

1. **Sidecar grok runner** (`scripts/luna-sidecar.ts`): a `grok` engine alongside codex — per decide, spawn `grok --prompt-file <tmpfile> --output-format plain -m <model>` with cwd = the same scratch dir, prompt written to a temp file (system + user combined; unique file per request, cleaned up after). One-shot per request = per-thought isolation by construction. Kill-timeout 30 s (grok is fast; a slow call is a wedged call). Budget gate unchanged — FIRST statement, provider-agnostic (all engines share the one budget).
   - Model: env `LUNA_GROK_MODEL` (default `grok-4.6`); investigate whether a faster variant id exists via `grok --help`/models listing and note options in the report (do NOT change the default beyond `grok-4.6`).
   - Engine selection: request body gains optional `engine: 'codex' | 'grok'`; sidecar default from env `LUNA_ENGINE` (default stays `codex` for now — the orchestrator flips it after a quality soak). Log lines show `worker=grok`.
2. **Client** (`src/mind/providers.ts` + boot): `?brain=grok` selects the grok engine (CodexProvider generalizes or a sibling GrokProvider posts `engine:'grok'` — smallest diff wins); `?brain=codex` unchanged; auto/mock/off unchanged. `__simState.mind.provider` reports `grok` when active.
3. **Concurrency:** grok one-shots pool exactly like cold codex spawns under the existing K-lane limits — no new machinery.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New tests (fake spawn/transport): engine routing (body param → runner), temp prompt-file cleanup on success AND failure, budget-before-spawn for the grok path, timeout kill.
3. **Real-CLI measurements in the report:** a REALISTIC decide prompt (~1200-token observation, the real system prompt) through both engines via the dev sidecar, 3 samples each — wall ms table. Plus one full raw grok decide response demonstrating the JSON contract parses (paste it).
4. E2e (mock): `?brain=grok` boots, provider reports `grok`, a mock-driven decide flows (fake engine in e2e — no real grok spawns in CI).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **MEASUREMENTS** (latency table + raw decide) / **DEVIATIONS** / **KNOWN GAPS**.

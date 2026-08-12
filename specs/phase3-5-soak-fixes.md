# Dispatch P3-5 — Soak fixes: conversation lane, world export, lean-island preset

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec — better ideas go in DEVIATIONS as suggestions. No refactors beyond need; every deviation needs a minimal-diff justification; the orchestrator red-teams the report against the diff. If a gate won't go green after 3 distinct fix attempts, STOP and report. MockProvider covers all gates.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Context: findings from the first political soak (2h, 2.1 sim-days, journal-verified)

1. All 8 conversations happened before D1 09:00, then ZERO for 1.8 sim-days — the P3-2d "quiet-line gate" (no new conversations unless the dispatch queue is fully idle) never opens at 1× with 6 minds (a decision dispatches every ~40s, each takes ~35s). A test-observability deviation strangled the social fabric in production.
2. The harness's end-of-run save went to the ephemeral browser's IndexedDB — the run's qualitative record (reasonings, reflections, transcripts) evaporated on close.
3. Two comfortable sim-days produced zero politics. The next experiment needs a leaner environment.

## 1. Fix: conversation headroom instead of quiet-line (`src/mind/`)

- REMOVE the full-quiet requirement for starting conversations. New rule: a conversation may start whenever **at most K−2 lanes are in flight** (with K=3: at most 1 busy — always preserving one lane of headroom for decisions), all other eligibility unchanged (adjacency, cooldowns, 2-active cap, at-most-one-per-quiet-tick).
- Keep the existing suppression of NEW conversations at speeds above 1× (that part was correct).
- The e2e that depended on quiet-line drains: rework it to force the condition explicitly (e.g. `?mindConcurrency=1` or a test-only flag) rather than relying on production gating. Note the rework in DEVIATIONS.
- **The regression gate for the flatline:** vitest with wall-delay mock — 6 minds generating steady decision traffic for 2+ simulated days at 1×-equivalent pacing; assert conversations START during the run (mind:say count grows well past the first morning; specifically ≥ 3 distinct conversationIds after day 1).

## 2. World export for harnesses (`src/bridge.ts` + persistence)

- Additive bridge: `__simControl.exportWorldJson(): string` — the exact save-format payload (v5) as a JSON string (reuse Dispatch M's export path; no download dialog, just the string), and `__simControl.exportStoryJson(): string` — `{ decisions, reflections, says, sanctions, proposals }` extracted from the event trace WITH their full texts/reasonings, for qualitative analysis.
- Update `scripts/soak-political.mjs`: before closing, write both to `artifacts/soak-<ts>-world.json` and `artifacts/soak-<ts>-story.json` (page.evaluate → fs.writeFileSync). Keep the IDB saveNow too (harmless).
- Gate: vitest — `restoreSave(JSON.parse(exportWorldJson()))`-equivalent round-trip yields identical state hash.

## 3. Lean-island preset (`src/sim/worldgen.ts` + bridge)

- `newWorld(seed, preset?: 'default' | 'lean')` (bridge additive; default unchanged). `lean` differs ONLY in world facts: 6 berry bushes (default 10), bush regrowth +1/300 ticks (default /100), farm production yield 8 (default 14), agents spawn with 2 food (default 4). Same rules, harsher environment — no event scripting, no behavior changes.
- Deterministic: same seed+preset → same world (hash-gated). The preset name rides in world state + saves (v5 stays; additive field with default).
- The soak harness gains `--preset lean` arg passed through to newWorld.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. The flatline regression gate (§1), export round-trip gate (§2), lean-preset determinism + fact-diff gate (§3: assert exactly the four listed facts differ between presets at the same seed).
3. E2e: conversation starts under sustained mock decision traffic; `exportWorldJson` returns parseable v5 payload in-browser; `newWorld(42, 'lean')` boots with 6 bushes (assert via placeCounts or an additive bushes count).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** (justified) / **KNOWN GAPS**.

# Dispatch P3-8 — Dedicated mind CODEX_HOME: 3× faster thoughts, measured

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas → DEVIATIONS. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report. MockProvider/fake-fs cover automated gates; real-CLI measurements are report evidence.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `scripts/luna-sidecar.ts`, `scripts/luna-mcp-worker.ts`, `scripts/luna-grok.ts` first.

## Why (measured by the orchestrator)

The user's global `~/.codex/config.toml` (built for coding sessions) rides on every villager thought: `model_reasoning_effort = "xhigh"`, MCP add-ons that handshake and fail per call. CLI `-c` overrides silently lose to config.toml (this is why earlier dial probes showed nothing). Clean-room `CODEX_HOME` with minimal config: trivial reply 29s → 7.5s, realistic ~1200-token decide 31s → **10.0s**. Model is and stays `gpt-5.6-luna`.

## The change (sidecar-side)

1. **Mind home** (`scripts/luna-sidecar.ts`): on boot, create/refresh `<os.tmpdir()>/luna-mind-home/` containing exactly:
   - `config.toml`: `model = "gpt-5.6-luna"`, `model_reasoning_effort = "low"`, nothing else (no mcp_servers, no other keys). Env overrides: `LUNA_CODEX_MODEL`, `LUNA_MIND_EFFORT`.
   - `auth.json`: COPIED from the user's real `~/.codex/auth.json` (READ-ONLY access to the real home — never write, never modify anything under `~/.codex`; gate this structurally).
2. **All codex spawns** (cold `codex exec` AND the persistent `codex mcp-server` worker) get `env: { ...process.env, CODEX_HOME: <mind home> }`.
3. **Token rotation resilience:** on a 401 from any codex call, re-copy `auth.json` from the real home once and retry that request once; if still 401, surface the error (existing fallback/error paths). Log the re-copy.
4. **Effort tiering (investigate, then implement the cheapest working form):** decides at `low`; reflections at `medium`. Under a clean home, test whether `-c model_reasoning_effort="medium"` now actually overrides (it may work when config.toml doesn't conflict — measure!). If overrides work: pass per-request. If not: a second home dir (`luna-mind-home-reflect/` differing only in effort) selected per request class. Report which reality you found with timing evidence.
5. Grok path untouched. Health endpoint gains `mindHome: true/false`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched; NOTHING writes under the real `~/.codex` (structural: the only fs op against it is `readFile(auth.json)` — quote the code in the report).
2. New tests (fake fs): mind-home creation/refresh, auth copy, 401→re-copy→retry-once, env injection on both spawn paths, effort selection per request class.
3. **Real-CLI measurements in the report:** realistic decide through the dev sidecar before/after mind-home (3 samples each, wall ms table — expect ~30s → ~10s); one reflection-class call at its effort tier; paste one raw decide response.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **MEASUREMENTS** / **DEVIATIONS** / **KNOWN GAPS**.

# Dispatch P3-7 — Persistent mind worker: pay startup once, not per thought

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas → DEVIATIONS as suggestions. No refactors beyond need; deviations need minimal-diff justification; the orchestrator red-teams the report against the diff. If a gate won't go green after 3 distinct fix attempts, STOP and report. MockProvider covers automated gates; real-codex measurements are report evidence.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `scripts/luna-sidecar.ts` + `scripts/luna-budget.ts` first.

## Why (measured)

Every mind decision spawns a cold `codex exec`: measured 29.0 s wall for a ~1 s generation — ~95% process boot/auth/session overhead, paid 400+ times per soak. `codex mcp-server` (stdio) exists: one persistent process, each request its own fresh conversation.

## The change (`scripts/luna-sidecar.ts` — server-side only; client contract unchanged)

1. **Worker lifecycle:** on first decide, the sidecar spawns ONE persistent `codex mcp-server` child (stdio JSON-RPC, MCP protocol), configured to match today's guarantees: read-only sandbox, scratch cwd (`tmpdir/luna-mind`), `--skip-git-repo-check`-equivalent (however the mcp-server accepts config — flags, env, or per-request params; investigate `codex mcp-server --help` and the MCP tool schema first and document what you found in the report).
2. **Per-request isolation is LAW:** each decide must be a NEW conversation (the fresh-conversation tool; NEVER any continue/reply variant). No request may ever see another request's content.
3. **Request path:** decide → budget gate (unchanged, first statement) → MCP tool call with the same combined prompt → extract text (existing fence/JSON extraction) → respond. Per-call kill-timeout 60 s retained (on timeout: cancel the MCP request; if the worker wedges, kill + restart it).
4. **Resilience:** worker crash/nonresponse → restart with backoff (max 3 in 5 min, then fall back); **cold `codex exec` remains as automatic fallback** whenever the worker is unavailable. Health endpoint gains `{ worker: 'up' | 'restarting' | 'fallback' }`.
5. **Concurrency:** investigate whether one mcp-server handles concurrent requests (issue two overlapping calls, measure). If it serializes, spawn up to `LUNA_CONCURRENCY` workers (same config each). Report which reality you found with evidence.
6. Log lines gain worker latency: `[luna-sidecar] decide 3480ms worker=mcp lane=1/3 budget=…`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock — the worker is server-side; unit-test the sidecar handler with an injected fake MCP transport); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched; client code (`src/mind/`) untouched unless strictly necessary (justify).
2. New tests (fake transport): fresh-conversation-per-request enforced; timeout → cancel + restart path; fallback to cold exec when worker down; budget gate still precedes every call.
3. **Real-codex evidence in the report (run manually, not in CI):**
   - **Isolation proof:** request A: "Remember the codeword BLUEMOON. Reply {\"ok\":1}". Request B: "What codeword were you told? Reply {\"codeword\":\"<answer or NONE>\"}". B must answer NONE (or equivalent ignorance). Paste both raw responses.
   - **Latency table:** 3 cold `codex exec` calls vs 3 persistent-worker calls, same trivial prompt — wall ms each. Expect worker ≪ cold; report honestly whatever you measure.
   - One end-to-end decide through the running dev sidecar (curl) showing `worker=mcp` in the log line.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **MEASUREMENTS** (isolation proof + latency table) / **DEVIATIONS** (justified) / **KNOWN GAPS**.

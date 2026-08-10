# Dispatch P3-2b — Breathe spans the whole line + concurrency-3 mind pool

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Surgical changes to the mind layer + sidecar; read the current code first (P3-0..P3-2). MockProvider covers all gates. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Bug (live, measured at 64× with real codex)

`mind:stale: 5` vs 6 applied decisions, and the sim visibly NOT throttling while minds waited. Root cause: breathe keys off "request in flight"; the 15 s wall-floor between dispatches leaves windows where nothing is in flight (but the queue is full) → the world sprints at 64×, observations go stale, completed decisions get discarded. Wasted calls, starved minds, and no adjacent-socialize windows for conversations.

## Fix 1 — Breathe spans the whole line

The loop throttles to 1× whenever **any mind work is queued OR in flight OR waiting out the rate floor** — i.e., whenever the dispatch queue is non-empty in ANY sense — and restores the user's chosen speed only when the queue is truly drained. User pause still wins; user speed changes mid-queue update the restore target (existing semantics).

## Fix 2 — Concurrency-3 worker pool (one mind one voice stays law)

- **Client** (`dispatchQueue.ts`): up to `LUNA_CONCURRENCY` (default 3; read from `localStorage['luna.concurrency']` or `?mindConcurrency=`, clamp 1–4) requests in flight simultaneously. FIFO with the existing priority (decisions > conversation turns > reflections). **Conversation lane rule:** turns belonging to one conversation are strictly sequential (turn N+1 never dispatches before turn N applied); separate conversations and decisions may run in parallel lanes.
- **Sidecar** (`luna-sidecar.ts`): in-flight limit 1 → K (`LUNA_CONCURRENCY` env, default 3, clamp 1–4); 429 only beyond K. Budget check stays the FIRST statement per call (unchanged law). Log lines gain a lane indicator (`[luna-sidecar] decide … lane=2/3`).
- **Rate floor reshaped:** replace "15 s between consecutive dispatches" with a rolling window cap: at most K dispatches per 15 s (token-bucket or timestamp window). Same spam protection, batch-aware. `decideCalls === applied` semantics preserved.
- Dispatch-time observation refresh, duplicate-coalescing, and staleness backstop (45 sim-min → `mind:stale`) all stay.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New/updated vitest (mock with wall-frame delays):
   - **Zero-stale at speed (the acceptance):** 3+ minds, simulated 64×, multi-day → every completed decision APPLIES, `mind:stale` count 0, throttle engaged for the ENTIRE queue drain (assert speed stays 1 across floor-wait windows), restore only on empty queue.
   - Pool: up to 3 concurrent dispatches, never 4; rolling-window rate cap enforced; FIFO priority preserved across lanes.
   - Conversation lane: within one conversation, turn N+1 never dispatches before turn N applies; a decision may run in parallel with an active conversation.
3. E2e (mock, wall-delay): 6 minds at 64× → decisions for all minds apply with 0 stale; `__simState.speed === 1` while `mind.pending > 0` including between dispatches; restores after.

## Final report

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

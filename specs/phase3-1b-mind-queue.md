# Dispatch P3-1b — Client-side mind queue: three minds, one polite line

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Surgical change to the mind layer; read the current code first. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Bug (live, measured)

Three luna minds, one serialized ~35-40s sidecar slot: concurrent client requests fight via 429/LUNA_BUSY; the two waiting clients exhaust their patience and record `mind:fallback` — while their server-side codex calls COMPLETE and get discarded. Observed: sidecar log shows 3 healthy completions (budget charged 3), client shows 1 decision + 2 fallbacks. Budget waste + mind starvation, and it worsens linearly with mind count (P3-3 has 24).

## Fix: one in-flight request app-wide, local FIFO for the rest

- `src/mind/` gains a tiny global dispatch queue: all sidecar calls (decisions AND reflections) enqueue; exactly ONE fetch is in flight at any time; the rest wait locally WITHOUT contacting the sidecar (no 429 churn). FIFO order; per-entry the full provider timeout applies only once dispatched (queue wait doesn't consume it).
- Queue hygiene: if an agent hits a new cadence point while already queued/in-flight, do NOT enqueue a duplicate (keep the existing entry; refresh its observation payload AT DISPATCH TIME so the prompt reflects the world when actually sent, not when queued — this also reduces staleness). If an entry's agent becomes invalid (world reset/newWorld), drop it.
- Breathe integration: the loop's throttle-while-thinking now keys off "queue non-empty or in-flight" so the world breathes through the whole line, not just the head request.
- 429/LUNA_BUSY handling stays as a defensive path but should be structurally unreachable (single dispatcher); if it ever fires, log a console warning (it means a second app instance shares the sidecar).
- Reflections and decisions share the queue; reflections enqueue at low priority (decisions jump ahead of queued reflections, never preempt in-flight).
- Cap queue depth at mind count; anything beyond logs and drops oldest reflection first.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New vitest (MockProvider with wall-frame delays): 3 minds hitting cadence in the same window → all 3 decisions eventually apply, ZERO fallbacks, ZERO duplicate dispatches, dispatch order FIFO, observations refreshed at dispatch (assert the prompt's tick equals dispatch-time tick, not enqueue-time). Reflection+decision priority ordering. decideCalls === applied decisions + applied reflections.
3. E2e (mock, wall-delay param): 3 minds at 64× over 2 sim-days → decisions for ALL THREE agents present in the trace, 0 fallbacks; breathe engages while the queue drains.

## Final report

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

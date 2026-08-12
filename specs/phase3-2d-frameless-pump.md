# Dispatch P3-2d — The village thinks even when nobody's looking

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the mind service (dispatchQueue, lunaBrain, conversation) first; surgical change. MockProvider covers all gates. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Bug (live, verified)

With the browser tab hidden (`document.hidden === true`), completed codex responses never apply: 6 dispatched calls, 6 healthy sidecar completions (all lanes), `pending: 6`, `decisions: 0`. The mind service's completion processing (response → validate → post to sim inbox → advance queue → breathe bookkeeping) runs inside the rAF loop; hidden pages get no frames. P3-2c made TURN SCHEDULING tick-driven but response processing one layer up is still frame-driven. This blocks unattended soaks — the whole point of the mixed-society build.

## Fix — apply-on-resolve (NOT a timer pump)

- **Primary path:** each dispatched request's own promise continuation does the full completion work the moment the response resolves: validate → `postExternalIntent` / `postSay` / `postMindNotes` (these only QUEUE; actual state change still happens at the next `advanceTicks`, preserving determinism) → mark lane free → dispatch the next queued entry (respecting the rolling rate window via `setTimeout` for the floor wait) → update `__simState.mind` counters and breathe bookkeeping. No dependence on frames anywhere in this chain.
- **Why not timers:** Chrome throttles hidden-tab timers to 1/s, and to 1/min after ~5 minutes (intensive throttling). Promise continuations and network callbacks are not throttled. `setTimeout` is acceptable ONLY for the rate-floor wait (its delay may stretch under throttling — that's harmless, it just spaces calls more).
- **Safety sweep:** keep/add a 1 s `setInterval` sweep as a belt (idempotent: it only picks up anything a continuation somehow missed); it must be a no-op in the normal path (assert via test that completions apply WITHOUT it firing).
- **The rAF loop keeps owning:** sim time advancement, rendering, per-frame UI. A hidden page's world simply doesn't advance ticks unless driven (`ffwd`) — that's by design; queued inbox items apply at the next advance, whoever causes it.
- **Breathe correctness while hidden:** breathe state must not wedge — when the tab becomes visible again (or `ffwd` runs), speed/restore semantics must be consistent (no stuck 1× after the queue drained while hidden).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New vitest (the acceptance — simulate "hidden page"): drive the mind service with wall-delay MockProvider while NEVER invoking any frame/pump callback — completions must post to the inbox on their own; a subsequent bare `advanceTicks` applies them; the queue dispatches its next entries without frames; the safety sweep counter stays 0 in this path. Also: breathe restore not wedged after a hidden-drain.
3. E2e (mock, wall-delay): drive exclusively via `ffwd` + waits (no reliance on visibility): 6 minds → all decisions apply, conversation turns progress, zero stale, zero fallbacks.

## Final report

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

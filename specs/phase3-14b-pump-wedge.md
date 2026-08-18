# Dispatch P3-14b — The dispatch pump wedged under P3-14: diagnose from evidence, fix, prove with a 2-min smoke

## Your role — the leash

SOLE IMPLEMENTER. Synchronous. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diff. Diagnose BEFORE changing anything — no guess-fixes. 3 failed attempts → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What happened (orchestrator killed the run at t+6m)

The P3-14 confirmation soak (`node scripts/soak-political.mjs --minutes 120 --budget-hour 1200 --budget-day 3500`) wedged from minute 1. Evidence, all preserved:

- Log: `logs/soak-p14.log`. Journal: `artifacts/soak-political-1787032547831.jsonl`.
- t+1m: `decisions=9 say=2 budgetH=72 breathe=90% lat=4409ms` — **72 budget calls for 9 decisions in the first minute** (63 calls unaccounted: conversation turns? retries? double-counting?).
- t+2..6m: budgetH crawls (72→77), `pending: 0`, breathe pinned 90%, `ticksThisMin: 6`, `decisionsThisMin: 0–3`. The world advanced 36 ticks in 6 wall-minutes.
- The cadence — exactly ~6 ticks and ~3 decisions per minute with pending=0 — matches the SAFETY SWEEP interval (~10s). Hypothesis: the main dispatch pump is dead or starved; only `startSafetySweep` advances anything, while auto-breathe holds the world at ~0 speed.
- `fallbacks=0, stale=0`, no PAGEERROR/THROTTLE lines. `discovery:examined` reached 6 (the reframe works — villagers examine immediately).
- Healthy reference (pre-P3-14, same harness): `logs/soak-smoke-codex.log` — t+1m `decisions=9 breathe=3%`, t+2m `decisions=17 breathe=2%`, ~60 ticks/wall-min.

## Suspects (P3-14 was the only change; its diff is commit `494c851`)

Rank and eliminate with evidence — read `src/mind/lunaBrain.ts` breathe/pump/rate-floor/conversation paths against each:

1. **Conversation seeding storm at t=0:** say=2..7 in minute 1 with 72 budget calls — did conversation turns burn the window/budget and then wedge (participants' cadence suspended, next turn never dispatched, breathe held by an "active conversation" that never completes)?
2. **1-tick examine loop interacting with breathe:** examine completes same-tick → agent immediately eligible-ish → auto-breathe holds world between decides → ticks can't advance → cadence gap (15 ticks) unreachable → queue empty forever while breathe stays engaged. (If THIS is the mechanism, the fix is a design decision — bring it as a finding with the exact loop traced, and implement the minimal correct break: e.g. breathe should not engage when the queue is empty and nothing is pending.)
3. **Prompt-build exception in the pump path** (my P3-14 Goals/memory/knowledge code) caught somewhere that kills the pump silently while the sweep's path survives.
4. **maintenanceOnlyIds / utility-fallback interaction** starving the pump for minded agents.
5. **Budget/window accounting change**: 72 calls in min 1 — check what increments budgetH (busy retries? conversation turns? sheep-talk?) and whether the rolling rate window wedged permanently after the burst.

## Fix requirements

- Root cause stated in one sentence with the exact code path, THEN the minimal fix. If two independent problems exist (e.g. a t=0 conversation storm AND a breathe-with-empty-queue hold), fix both minimally.
- Invariant: auto-breathe must never hold the world when `pending == 0` AND the dispatch queue is empty AND no conversation turn is in flight. Whatever else you fix, that invariant should hold and be unit-tested.
- Do not revert P3-14's features (Never-examined, Goals, gating, adjacency, cooldown). The reframe's immediate-examine behavior is DESIRED; the world freezing is the bug.

## Gates

1. `npm run build` exit 0; `npm run test` all pass (+ new unit test for the breathe invariant / the specific root cause); `npm run e2e` all pass; determinism green; purity grep empty.
2. **The smoke that failed is the gate:** `node scripts/soak-political.mjs --minutes 3 --brain codex --port 5179` must show by t+2m: breathe ≤ 20%, ticks/wall-min ≥ 45, decisions ≥ 8, budgetH plausible (≈ decisions + say turns, no mystery ×8 multiplier). Paste all three heartbeat lines.
3. If the wedge reproduces in mock (try `--brain mock --minutes 2` with a wall-delay param if one exists), add it as a regression e2e; if it needs real latency, say so and leave the smoke as the documented gate.

## Final report

**ROOT CAUSE** / **FIXED** (diff summary) / **GATES** (evidence incl. the 3 heartbeats) / **BUDGET ACCOUNTING** (what the 72 actually was) / **KNOWN GAPS**.

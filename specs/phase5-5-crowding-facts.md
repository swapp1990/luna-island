# Dispatch P5-5 — Crowding you can feel: the facts that make upgrading wanted

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Working directory is the worktree `D:\MyProjects\Claude\luna-island-p55` — work ONLY there; never touch `D:\MyProjects\Claude\luna-island`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, or other `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang and killed.

Read before writing (paths relative to the worktree):

- `src/sim/sim.ts` — the sleep path (~2129: bed rate vs `SLEEP_GROUND_ENERGY` when not on a bed slot; ~3087 `isOnBedSlot`-style predicate; ~3569 bed-slot assignment), `place:blocked` emission (P4-7), P5-2 upgrade routing (level adds +1 slot), the felt-line helpers in `src/sim/examine.ts` (`blockedFeltLine`).
- `src/mind/knowledge.ts` — `feltConsequenceLines` (how felt events become prompt lines), `formatNearbyPlaceLine`.
- `src/mind/prompt.ts` — civic/census block from P5-4, `Recently felt:` section.
- `scripts/mind-probe.mjs` — G13/G14 fixture patterns for the rung you add.

## Why (measured)

Building tiers (P5-2) shipped with real mechanical effects (+1 slot, +1 yield) and three soaks later **no building has ever been upgraded organically** — `leveled places: none` in every export. The affordance is stated once in WORLD_RULES, but nothing in a villager's lived day ever makes an upgrade *wanted*: sleeping on the floor of a full home produces worse rest (physics since P3) yet **no felt line says so**; a workplace or well turning villagers away fires `place:blocked` per event, but nobody can see that a place is *chronically* crowded. Same bug class as P4-8 and the census: the behavior is absent because the information is absent. Fix the information; add zero motivation.

Scaffold, not script: facts about crowding, never "you should upgrade". The remedy (commission-to-upgrade, +1 slot) already exists and is already stated; whether anyone connects fact to remedy is the Brain's business — and exactly what we measure.

## A. Felt crowding (sim → felt lines)

1. **Floor-sleep is felt.** When a sleeper wakes (or at sleep start — pick the seam that already emits sleep-related events and say so) having slept off a bed slot IN a home whose bed slots were occupied, emit a felt event with an honest reason: `the beds at home were full — slept on the floor`. Sleeping rough *outside* any home keeps its existing framing (do not double-report). One line per night per agent, max.
2. **Chronic contention is visible.** Track per-place, per-day blocked counts (a small additive map reset at day start — derive from the existing `place:blocked` emission point, don't re-detect). A place blocked ≥ 3 times in the current day reads as crowded in the observation: `formatNearbyPlaceLine` appends `busy` → e.g. `well (8 food, busy)`; examine says `It was crowded today — turned people away N times.` Numbers derived, never hand-written; below threshold shows nothing.
3. No new mechanics: no queues, no pricing, no need changes. Information only.

## B. What a mind reads (facts only)

- The floor-sleep felt line appears in `Recently felt:` like every other felt consequence.
- The `busy` tag and examine sentence per A2.
- NOTHING else. No WORLD_RULES change (the upgrade affordance is already stated there). If you find yourself writing "could be upgraded" or "needs more room" anywhere — stop; that's the line between fact and advice.

## C. Measurement (no LLM calls)

New probe rung **G15 `crowded-home`** in `scripts/mind-probe.mjs`: slack fixture where the agent OWNS a level-1 home (standing facts show it), has wood/stone within reach or in inventory context, and the felt lines show two nights of `beds were full — slept on the floor` plus a `busy` workplace nearby. Grade: `commission` (upgrade of owned home) / `gather` (toward materials) / civic acts / else. `--dump` verify only; the orchestrator runs it live.

## Gates

1. `npm run check` exit 0. `npx playwright test --workers=1` all pass (call playwright directly — `npm run e2e -- --workers=1` drops the flag on this Windows npm). Purity grep of `src/sim/` empty.
2. New vitest: floor-sleep in a full home emits the felt line exactly once per night; a bed-slot sleeper emits nothing; rough sleep outside homes is unchanged; blocked-count map resets daily, `busy` appears at the threshold and not below; counts derive from actual `place:blocked` events; save round-trip + `stateAt` re-sim of the daily map (or state it's derived-only and excluded from the hash — justify either way); determinism double-run exact.
3. `node scripts/mind-probe.mjs --only G15 --dump` prints the fixture; zero model calls.
4. Both recorded soak worlds still import.
5. Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

## Final report (exact structure)

**BUILT** (felt-line seam chosen + exact line texts verbatim; busy threshold + reset math; what is state vs derived) / **GATES** (evidence) / **G15 DUMP** (fixture verbatim) / **DEVIATIONS** / **KNOWN GAPS**.

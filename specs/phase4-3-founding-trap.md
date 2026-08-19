# Dispatch P4-3 — The founding trap: a coin fee nobody can pay, and a cooldown that punishes trying

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read your P4-1/P4-2 work: `BUILD_RECIPES`, `commission`, `COMMISSION_COST`, `findFreeHomePlot`, the commission cooldown (`commissionCooldownUntil`), and `src/sim/worldgen.ts` presets.

## What the live wild run showed (orchestrator killed it at t+40 of 120)

Evidence: `artifacts/soak-political-1787122934122.jsonl`, `logs/soak-wild.log`. At Day 2 22:00 (tick 2400) with 6 LLM minds:

- `placesByKind` = `{plaza: 1, berry-bush: 10}` — **nothing founded**.
- `construction:commission-refused` = **2** — minds DID try to found something and were refused.
- `goods:produced` frozen at **144** between t+20m and t+40m — gathering started, then stopped dead.
- `discovery:examined` 31, `mind:say` 232, breathe 0%, latency 3.7s — the minds were healthy and active; this is not a performance problem.

**Diagnosed cause (verify, then fix):** `commission` charges `COMMISSION_COST` (30 coins) for `kind === 'home'` on top of the material recipe. The `wild` starting kit is **20 coins**, and a wild island has no employers (no farm/forestry/quarry/stall), so there are no wages — 30 coins is unreachable forever. Homeless villagers ask for homes, get `cannot-afford`, and each failure arms a **1-sim-day** cooldown, so six minds burn roughly five attempts across a five-sim-day run and the island can never be built.

## Fixes

### 1. The coin fee becomes a world parameter, not a constant

- Make the home commission fee a **preset/world-level value** (e.g. `commissionFeeCoins` on world state, set by worldgen): **30 for `default`/`lean`, 0 for `wild`**. A coin permit is a market mechanism; a world with no market cannot express it. Materials + labour remain the real cost in every preset.
- `default`/`lean` behaviour must be byte-identical to today (the 8-day economy tests and determinism hashes must not move).

### 2. The cooldown must punish repetition, not attempts

Today any failure arms a full sim-day of silence. Change it so:
- The cooldown keys on **(agent, refusal reason)** and only arms on the **second consecutive identical** refusal — one honest failure costs nothing.
- Shorten it to **~240 ticks** (4 sim-hours) instead of 1440. It exists to stop the instinct layer's thousands-of-attempts spam (which it still will: repeated identical failures arm it immediately on the second try), not to end a mind's building career.
- Keep the silent-reject behaviour while armed (no event spam).

### 3. Tell the mind why it failed

A refusal currently lands in the trace but may not reach the next prompt usefully. Ensure a refused commission surfaces in that agent's observation as a plain fact for at least a few decisions — e.g. in the existing "Recently felt" / recent-trace lines: `could not commission a home — 12 wood 6 stone needed, you carry 0`. State exactly what you did. No advice, no suggestion of what to build instead — just the reason and the shortfall.

### 4. Investigate the gathering stall (diagnose before fixing)

`goods:produced` froze at 144. Find out why and report the mechanism before changing anything. Prime suspects: agent inventory cap reached with no sink (no storehouse, no site to `deliver` to) so the utility score for `gather` collapses; or gather-tile stock depleted near the plaza with slow regrow. If it is the inventory-with-no-sink deadlock, the correct fix is a world rule (e.g. agents may drop/stockpile goods on a walkable tile, or carry cap raised), NOT a behavioural nudge. If the deadlock only exists because nothing can be commissioned, say so — fix 1 may resolve it, and then no change is needed here.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; determinism green for `default` AND `wild`; save version answer stated; both recorded soak worlds still import.
2. New vitest: wild fee is 0 and a home can be commissioned with 0 coins when materials are present; default fee still 30 and still refuses at 29 coins; one refusal does NOT arm the cooldown; two consecutive identical refusals DO, for ~240 ticks; a different refusal reason resets; refusal reason reaches the agent's observation lines.
3. **Founding smoke (mock brain, no LLM):** headless wild fast-forward where a scripted-in-test agent gathers 2 wood and commissions a `notice-board` with 0 coins — assert the site appears, `deliver` fills the bill, and the board completes and meshes. This is the end-to-end chain the live run never reached.
4. **Founding reachability probe (real model, budget now raised):** `scripts/mind-probe.mjs` with a wild fixture (empty island, forest/rock nearby, comfortable needs, no home), N=10. Report the action histogram and 3 verbatim reasonings. This tells us what minds actually ask for on a wild island — the thing the killed run was going to answer.

## Final report (exact structure)

**DIAGNOSIS** (confirmed cause + the gathering-stall mechanism) / **FIXED** / **GATES** (evidence) / **PROBE** (histogram + reasonings) / **DEVIATIONS** / **KNOWN GAPS**.

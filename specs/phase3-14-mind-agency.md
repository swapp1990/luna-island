# Dispatch P3-14 — Mind agency: kill the incuriosity instruction, fix the boundary, prove it with narrow probes

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants (esp. 7: engine = what is possible, brain = what to do), `src/mind/prompt.ts`, `src/mind/knowledge.ts`, `src/mind/memory.ts`, `src/mind/lunaBrain.ts` (decide cadence + how utility fallback interleaves), `src/sim/sim.ts` (examine slot rule ~grep 'examine', commission path), `scripts/luna-sidecar.ts` (decide endpoint shape) first.

## Why (measured from the 5-sim-day soak, journal `soak-political-1786931238950.jsonl`)

545 Luna decisions: food 361, sleep 333, curiosity 6, civic 0. Root causes found in code, in order of depth:

1. `prompt.ts` RESPONSE_CONTRACT ends: `If unsure, prefer a safe need-serving action (eat/forage/sleep/work).` An LLM choosing 1 of 16 actions is almost always "unsure" — this line IS the famine diet.
2. The observation is a needs dashboard; the experiment's object surfaces only as `notice-board (unfamiliar)` inside a semicolon list; reflection intentions have no standing slot, so every thought restarts from hunger.
3. The utility layer makes STRATEGIC moves for minded agents whenever the mind is silent: 2,536 failed `commission` attempts by UtilityBrain on Luna agents (Joss alone 1,036) while no Luna mind was ever effectively positioned to decide it. Plus a world bug: `examine` borrows a work slot, so 2 of 6 examine intents died "Place was full."

## Part A — the fixes

### A1. Prompt reframe (`src/mind/prompt.ts`, `knowledge.ts`, `memory.ts`)

- DELETE the safe-default sentence. Replace with nothing, or at most: `When nothing is urgent, act on who you are.`
- **Unfamiliar gets its own section.** After Nearby places, when unfamiliar places are in view: `Never examined: notice-board (8 tiles NE, on the plaza), quarry (3 tiles S)` — plain distance+direction facts, NO editorial nudge ("mysterious", "you're curious") — visibility, not desire.
- **Goals become standing.** A `Goals:` section fed from the agent's reflection notes that read as intentions (the reflection prompt already asks for "intentions for tomorrow" — carry the most recent 1–3 forward each day, replaced nightly). Keep prompt ≤ ~1500 tokens (existing approxTokens guard).
- **Slack framing.** When no need is below its warning threshold, the user prompt's first line after Time becomes: `Your needs are comfortable; nothing is urgent.` (needs line still follows — honesty, not concealment). No other special casing: same contract, same actions.

### A2. Agency boundary (`src/mind/lunaBrain.ts` / wherever utility fallback covers Luna agents)

- For Luna-minded agents, the utility layer may only execute MAINTENANCE actions (idle, walk, sleep, eat, drink, forage, work, buy, socialize, wander) — the strategic verbs (commission, propose, vote, sanction, claim, examine) can only enter via a mind intent. Engine capability is untouched (invariant 7) — this constrains the UtilityBrain'ssuggestion set for minded agents only, brain-side.
- Sheep (pure UtilityBrain) agents keep their full verb set BUT get the A3 cooldown.

### A3. World rules (`src/sim/sim.ts` — the ONLY sim changes, both generalizing)

- **Examine from adjacency:** examining a place succeeds from any tile adjacent to (or within 1.5 tiles of) the place, without occupying an interaction slot. It's observation, not use. Occupancy rules for USING places unchanged.
- **Commission cooldown:** a failed commission attempt (site lock held, insufficient funds, whatever cause) sets a per-agent cooldown (~1 sim-day) before the next attempt is accepted; a rejected attempt during cooldown emits NO event (kills the 2,536-row trace spam). This is a world rule (rate physics), not choreography.
- Determinism gates must stay green. Snapshot/save version handling per existing convention if state shape grows.

## Part B — the narrow probe harness (`scripts/mind-probe.mjs`)

The point: minutes-long, browser-free behavioral evals against the REAL model — not 2-hour soaks.

- Boots vite (sidecar only, NO browser/playwright). Builds prompts with the real exported `buildSystemPrompt`/`buildUserPrompt` over SYNTHETIC world fixtures (construct minimal WorldState/AgentState objects in the script or a small fixture module; reuse sim types).
- POSTs to the sidecar decide endpoint (same path the browser uses), parses with the real `parse.ts` logic, tallies actions + reasonings.
- Scenarios (each N=10 samples, concurrency 3, temperature as production):
  - **S1 slack-discovery:** all needs ≥75%, agent 3 tiles from a never-examined notice-board on the plaza, unemployed-or-idle, NEW prompt. Expectation (directional): eat/sleep/forage/work combined ≤ 70%; `examine` appears ≥ 1/10.
  - **S1L legacy-contrast:** identical fixture, but the probe appends the deleted safe-default sentence to the system prompt. Expectation: measurably MORE need-serving than S1 — this is the A/B that proves the line's effect. (Probe-side string only; the legacy line must NOT survive in prod code.)
  - **S2 affordable-house:** wallet 45 (cost 30), home crowded (3 co-sleepers fact in observation), needs comfortable, NEW prompt. Expectation: `commission` OR house-saving reasoning appears ≥ 1/10.
  - **S3 survival-regression:** hunger 8%, food in inventory 0, bush + stall nearby. Expectation: eat/forage/buy ≥ 9/10. (The reframe must NOT break survival.)
- Output: per-scenario action histogram + 3 sample reasonings, written to stdout AND `artifacts/mind-probe-<ts>.json`. Expectations print PASS/FAIL but are advisory (LLM variance) — the report interprets.
- ~40 real decide calls total (~3–5 wall-min at 3.7s × concurrency 3). Budget headroom is ample (1200/h).
- This harness is NOT wired into `npm run test`/`e2e` (nondeterministic) — it's an operator tool, like the soak.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; determinism check green; purity grep of `src/sim/` empty; `utilityBrain.ts`: A2 will likely touch it or its call-site — if you must change `utilityBrain.ts`, keep the diff minimal and quote it in full in the report (the SHA-frozen era ends here, deliberately).
2. New vitest: examine-from-adjacent (occupied slots, agent adjacent → event fires; distant agent → still walks first); commission cooldown (fail → silent rejects for a day → allowed after); strategic-verb gating for minded agents (utility suggestions for a Luna agent never include the 6 strategic verbs; sheep unaffected); prompt unit tests — safe-default line ABSENT, Never-examined section renders with distance+direction, Goals section carries reflection intentions, slack line appears iff no need below warning.
3. **Probe run (real model):** run all 4 scenarios; paste the histograms and your interpretation. S3 must hold ≥9/10 (if it doesn't, the reframe broke survival — STOP and report rather than shipping).
4. Prompt token guard still ≤ ~1500 (quote approxTokens on the fattest fixture).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **PROBE RESULTS** (4 histograms + sample reasonings + S1-vs-S1L delta interpretation) / **DEVIATIONS** / **KNOWN GAPS**.

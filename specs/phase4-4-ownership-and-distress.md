# Dispatch P4-4 — Founder-owns-what-they-found, collapse is perceptible, and the menu is knowable

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read the P4-1..3 work in `src/sim/sim.ts` (`BUILD_RECIPES`, `commission`, completion/deed path, refusal felt lines), `src/mind/parse.ts` (commission target mapping), `src/mind/prompt.ts` (WORLD_RULES, nearby-agents lines), `src/mind/knowledge.ts` (felt/known lines), `src/sim/examine.ts`, and the wild-run autopsy evidence in `logs/soak-wild-autopsy.log` (skim the DIAGNOSIS/WHY ONLY HOMES/SITE-WATCHING/SURVIVAL sections — the numbers below come from there).

## Why (evidence from the completed wild run, seed 42, `artifacts/soak-1787134110614-*`)

Six LLM minds built a 4-house village from bare grass in 5 sim-days — and nothing else. The autopsy isolated four causes, two structural and two mechanical:

1. **Only homes are ownable.** Commissioned non-home structures deed to commons, so founding a stall/workshop is charity. All 5 commissions were homes; Mira said "market stall" in 15+ conversations and never built one; ownership language saturates the reasons ("Independence starts with shelter").
2. **Collective problems are invisible.** Sela collapsed twice from hunger and was on the ground ~1.5 sim-days; zero of 538 reasonings and 615 says mention her — she fell at (32,26), outside everyone's ~6-tile nearby radius. No signal travels, so no civic demand can form.
3. **The menu is unknowable.** 0/538 reasonings mention well/board/storehouse/farm; WORLD_RULES never lists what is buildable; the `already-owns` felt line restates the HOME recipe, reading like a total cap on building.
4. **The parser silently maps unknown commission targets to `home`.** Ode asked for a "workshop"; parse made it a home; refusal `already-owns`. 10/10 commission intents were `home`.

## A. Founder owns what they found (world rule)

- A completed commissioned structure **deeds to its commissioner** — every kind, not just homes (`ownership:transfer` with `firstPrivate` semantics as today). Worldgen-spawned places stay commons; `claim` (15 coins) remains the transfer path for those.
- Ownership must MEAN something for productive kinds, or it's a label. Implement the smallest honest benefit, consistent with the existing economy: **the owner of a productive place (farm/forestry/quarry/stall) receives that place's sale/production revenue path where one exists, and sets... nothing else.** Concretely: where the stall currently pays sales revenue to the treasury, an owned stall pays its owner; where a workplace pays wages FROM the treasury, an owned workplace pays wages from the OWNER's wallet (owner takes the revenue, owner meets payroll). If a kind has no revenue path (well, notice-board, storehouse, home), ownership is just the deed — do not invent fees or rents. Coin conservation must hold; quote the ledger test.
- `default`/`lean` worldgen places remain commons — existing economy tests and determinism hashes must not move.
- Traced events for every new coin path, honest reasons throughout.

## B. Collapse is perceptible (world rule)

- A collapsed villager is *loud*: they enter the `Nearby` observation of any agent within a **larger radius (~12 tiles)**, flagged plainly (e.g. `Sela (COLLAPSED, 9 tiles SE)`), regardless of the normal nearby cap.
- Additionally, collapse becomes *news*: while anyone is collapsed, agents at the plaza get one observation line naming who and roughly where (the same mechanism class as price gossip — knowledge, not command). No advice, no "you should help" — visibility only.
- Give minds a way to ACT on it: verify a `give` / feed path exists (the economy has `goods:transfer` between agents — check whether an agent can transfer food to a collapsed agent and whether eating-while-collapsed / being-fed triggers recovery). If no such path exists, add the minimal world rule: an adjacent agent may give food to a collapsed villager, who consumes it and recovers on the existing recovery rules. Add the action to the mind contract if needed. This is capability, not policy.
- Sheep behaviour unchanged (no scripted rescue) — whether anyone helps stays a mind decision.

## C. The menu is knowable (fix the information, not the desire)

- WORLD_RULES gains one compact line listing buildable kinds WITH costs, generated FROM `BUILD_RECIPES` (single source of truth, never hand-written): e.g. `Buildable (wood/stone): home 12/6, farm 6/4, well 2/16, stall 8/4, storehouse 10/8, forestry 8/2, quarry 4/8, notice-board 2/0.` Plain physics, no ordering advice.
- The `already-owns` refusal is now only refused if the agent already owns **a place of that same kind** (owning a home shouldn't block founding a stall — that was never intended; verify what the right rule is from the P4-1 spec intent: cap is per-commissioner ACTIVE SITE, plus this same-kind ownership rule). State exactly what rule you shipped. The felt line names what remains possible: `you already own a home; you could commission a different kind (farm, stall, well, storehouse, forestry, quarry, notice-board)`.
- **Parser honesty:** an unknown commission target is REFUSED with a felt line naming the valid kinds — never silently mapped to `home`. Ode's "workshop" must produce `unknown-kind: workshop — buildable kinds are …`, not a home refusal.
- Examining a construction site returns real facts: kind under construction, owner name, remaining bill (`A stall taking shape — Mira's; still needs 5 wood`). Examining a completed place includes its owner where private. Wren asked for exactly this and got a canned sentence.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; determinism green for `default` AND `wild`; save version stated (additive expected); both recorded soak worlds still import; coin-conservation test green with the new owner-revenue paths.
2. New vitest: founder deed for every kind; owned-stall revenue → owner and owned-workplace wages ← owner wallet (with conservation); same-kind ownership refusal + different-kind allowed; unknown-kind refusal with menu felt line; WORLD_RULES menu is generated from BUILD_RECIPES (change a recipe in a test, see the prompt change); collapse visible at 12 tiles + plaza news line; give-food-to-collapsed recovers them.
3. **Scenario probes (real model — THE point of this dispatch; ~60 calls, budget is 3500/day):** extend `scripts/mind-probe.mjs` with wild-world fixtures and run each at N=10, reporting histograms + 3 verbatim reasonings each:
   - **W1 owned-stall dream:** villager owns a home, carries 8 wood 4 stone, comfortable needs, WORLD_RULES menu present. Does `commission` (stall or anything non-home) appear? Baseline expectation from the soak: ~0% before the fix.
   - **W2 collapse in view:** villager with 3 food in inventory, comfortable needs, observation contains `Sela (COLLAPSED, 4 tiles E)`. Does anyone move to give/help? Report the split between help-actions and ignore.
   - **W3 board reachability:** villager owns a home, carries 3 wood, menu present (board = 2 wood). Does `notice-board` ever appear in 10 samples? Advisory — a 0 here is a finding, not a failure.
   - **W4 survival regression:** starving villager, food nearby — eat/forage must stay ≥9/10.
   S-numbers: W4 is a HARD gate (stop if broken); W1/W2/W3 are measurements — report them honestly whatever they say.
4. Do NOT run a soak. The orchestrator runs it after reviewing the probe numbers.

## Final report (exact structure)

**BUILT** (incl. the exact ownership-revenue rules and same-kind refusal rule shipped) / **GATES** (evidence + conservation proof) / **PROBES** (W1–W4 histograms + reasonings) / **DEVIATIONS** / **KNOWN GAPS**.

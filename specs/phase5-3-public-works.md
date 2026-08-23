# Dispatch P5-3 — Public works: a passed proposal can raise a commons building

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, or other `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang and killed.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing:

- `src/sim/sim.ts` — `propose()` (~1298), `closeExpiredProposals()` (the passed→`rules.push` seam), `commission()` (P5-2 shape: upgrade routing, `isBuildablePlot`, plot finding, `MAX_ACTIVE_SITES`), `bindingTally`, treasury via `transferCoins`/`coinBalance`.
- `src/sim/types.ts` — `Proposal` (~165), `Rule` (~179; note the display-only doctrine on rules), `ConstructionSpec`.
- `src/mind/parse.ts` — propose validation (~127), `resolveMindIntent` propose branch (~372).
- `src/mind/prompt.ts` — RESPONSE_CONTRACT propose line, `civicObservationLines` (open-proposal rendering), WORLD_RULES.
- `src/sim/examine.ts` — the notice-board text (generated from constants).
- `scripts/mind-probe.mjs` — scenario table + `--dump` (for the fixture you add; you never call an LLM).

## Why

The civic loop works (a rule passed and bound in the last soak) and buildings are real physics (P5-1/P5-2). But a passed rule today changes only the rulebook — the island's *matter* is untouched by its politics. This rung closes that gap with the smallest honest mechanic: a proposal may carry a build, and passage commissions it AS COMMONS. Villagers still have to haul the wood and stone and do the labour — passage buys legitimacy and a deed to nobody, not a free building.

Doctrine guard: `Rule.text` stays display-only. The build is a STRUCTURED payload on the proposal, never parsed out of prose. And invariant 7 holds — the engine makes collective founding possible; whether anyone proposes it is the Brain's business.

## A. Proposal build payload (sim)

- `Proposal.build?: { kind: BuildableKind; x?: number; y?: number }` — additive-optional. `propose()` gains an optional `build` argument, validated at post time: kind must be buildable, and if coords are given they must be a buildable plot NOW (refuse honestly with a new `bad-build-site` why if not; coords omitted ⇒ plot chosen at passage).
- On close with `passed`, in addition to the existing `rules.push`: commission the build as a construction-site **deeded to `'commons'`** — no commissioner, no owner, no per-agent cooldown or one-site-per-commissioner check consumed. Island-wide `MAX_ACTIVE_SITES` still applies: if the island is at cap or no buildable plot exists at passage time, the rule STILL binds, the build is skipped, and an honest event records why (`institution:build-skipped` with `why`). Plot fallback when coords are absent or became invalid: nearest buildable plot to the notice-board (reuse P5-2's plot helpers).
- The commissioned site behaves exactly like any site: anyone delivers, anyone works, completion follows P5-2 rules (a public build of a kind can also be an UPGRADE if the proposal targeted an existing commons place — reuse `findUpgradeTarget`-style routing only if it falls out naturally; if it doesn't, new-builds-only is fine, say so).
- **Treasury stake:** at passage, transfer `PUBLIC_WORKS_STAKE` (new constant, default 5 coins, clamped to what the treasury holds) treasury→the site as a completion bounty: on completion it pays out, split equally among the distinct agents who delivered or worked on that site (round down; remainder stays in treasury). Track contributors on the site (additive field). Coin conservation law applies — everything moves through `transferCoins`. If the treasury is empty, stake 0 and the build still happens.
- Events: `institution:proposed` carries the build payload summary; `institution:closed` (passed, with build) reasons mention the founding ("…and a well site was staked by the village"); completion pays bounty with a traced transfer per recipient.

## B. The payload a mind can send (parse + prompt)

- `parse.ts`: propose accepts optional `"build"` — a string like `"well"` or `"well@12,20"` (kind, optional coords). Invalid kind ⇒ parse-ok but build dropped with the reason preserved? NO — invalid build kind is a parse failure with a precise error (`propose build must be one of …`), same rigor as vote/sanction. Valid parse carries it into the intent; `resolveMindIntent` passes it through.
- RESPONSE_CONTRACT: extend the propose clause: `propose needs "text" (the rule you want posted) and may carry "build" (a structure kind the village raises as commons if the proposal passes)`.
- Notice-board examine + WORLD_RULES: one factual sentence — a passed proposal may found a commons building; the village must still supply materials and labour; a small treasury bounty is split among builders on completion.
- `civicObservationLines`: an open proposal with a build shows it: `… "text" [+ well] deciding yes …`.

## C. Measurement fixture (no LLM calls)

Add rung **G13 `public-works`** to `scripts/mind-probe.mjs`: slack fixture (reuse the G9S slackify pattern) where the grievance is infrastructural — the well is described as crowded/blocked in felt lines and a peer names the same problem — board present, propose free. Grade `propose` split by with-build vs without-build (parse the raw payload), plus the usual counters. Wire it into the scenario table and the grading regex; verify with `--dump` only. Do NOT run it live — the orchestrator runs the model.

## Gates

1. `npm run check` exit 0. `npm run e2e -- --workers=1` all pass. Purity grep of `src/sim/` empty.
2. New vitest: a passed build-proposal commissions a commons site (owner `'commons'`, no cooldown consumed for the proposer); rule still binds when the build is skipped at site-cap (with the honest event); stake moves treasury→site→contributors with conservation (sum unchanged); zero-treasury stake still builds; invalid build kind refuses at `propose()` and fails parse in `parse.ts`; coords validated at post; fallback plot near the board when coords are absent; save round-trip of the new fields at v5 (bump only if forced, explain); `stateAt` re-sim reproduces a passage-founded site.
3. `node scripts/mind-probe.mjs --only G13 --dump` prints the fixture; zero model calls anywhere.
4. Both recorded soak worlds still import.
5. Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

## Final report (exact structure)

**BUILT** (payload shape, passage flow incl. skip cases, stake math, exact prompt/examine lines verbatim) / **GATES** (evidence) / **G13 DUMP** (the fixture's user prompt, verbatim) / **DEVIATIONS** / **KNOWN GAPS**.

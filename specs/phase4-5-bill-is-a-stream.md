# Dispatch P4-5 — The bill is a stream, not a price tag; builders know what they built

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing: `src/mind/prompt.ts` (worldRulesText, RESPONSE_CONTRACT), `src/sim/sim.ts` (`buildableMenuLine`, `commissionRefusalFelt`, `completeConstruction`, `performConstructionTend`, `GATHER_CARRY_CAP`), `src/sim/examine.ts` (`EXAMINE_BY_KIND`), `src/mind/knowledge.ts` (how `discovery:examined` becomes Known lines), `scripts/mind-probe.mjs` (fixture + scenario pattern).

## Why (evidence from the killed wild run, seed 42, journal `artifacts/soak-political-1787164077660.jsonl`)

P4-4 made the buildable menu knowable — and it backfired. Final journal snapshot (Day 3 16:57, tick 3537): `construction:commissioned 2` (both notice-boards, both completed and deeded), `construction:commission-refused 0`, `institution:proposed 0`. After the two boards finished at Day 1 16:00, **nobody attempted to commission anything for 48 sim-hours** — zero attempts, zero refusals. The matched-time P4-3 run (no menu) had two finished homes and a third site building by Day 3 17:00.

Root cause — the prompt documents the TOTALS but not the PROCESS, and where it touches process it teaches the wrong model:

1. `worldRulesText()` says "Structures can be commissioned on buildable ground **for** wood, stone, and labour" — reads as a price paid at commission time.
2. The menu says `home 12/6` with no hint that the bill is filled by deliveries over time. Minds carry at most 3 (GATHER_CARRY_CAP); they rationally conclude a home is unaffordable. Only the 2-wood board fits one carry — so boards got built, immediately, and nothing else was ever tried. W1's probe reasoning was the tell: "I have exactly the wood and stone needed."
3. `commissionRefusalFelt` appends "`12 wood 6 stone needed, you carry X`" — actively confirming the false up-front-requirement model.

**The engine's actual physics** (verify in `commission()` and `performConstructionTend()`): commissioning checks NO materials — only the home coin fee (0 in wild), same-kind ownership, one-active-site-per-commissioner, site cap, buildable ground. The site's bill is filled by deliveries from anyone over many trips (`depositInventoryToSite` on arrival), and the build advances while the site holds materials. The minds' "I can't afford it" was a correct inference from wrong documentation. Fix the information, not the desire — no "you should build" nudges anywhere.

Second finding: both board builders never examined what they built — the propose/vote/sanction verbs live only in `EXAMINE_BY_KIND['notice-board']`, so the builders know it's "a notice board" but not what it does. World-honest fix: you know the workings of a thing you built.

## A. The bill is a stream (information physics, `src/mind/prompt.ts` + `src/sim/sim.ts`)

Rewrite the construction lines of `worldRulesText()` to state the true process. Required facts (wording yours, keep it compact — 3 lines max, plain physics, zero advice):

- Commissioning marks a construction site on buildable ground; **no materials in hand are needed to commission**.
- The menu line (still generated from `BUILD_RECIPES` — single source of truth) reframed as a site bill filled over time, e.g. `Site bills, total wood/stone delivered over time: home 12/6, farm 6/4, …`.
- A site accepts deliveries over many trips, **from anyone**; you can carry at most `GATHER_CARRY_CAP` of a good per trip; working at the site builds while it holds materials. Generate the carry-cap number from the constant, never hand-write it.

Also fix `commissionRefusalFelt`: delete the "`N wood M stone needed, you carry X`" suffix. Where a recipe is relevant, the honest phrasing is that the site's bill is N wood / M stone, **filled by deliveries over time**. A refusal for `already-owns` / `site-cap` / `already-commissioning` / `cannot-afford` must not imply materials had anything to do with it.

Do NOT change any commission/build mechanics. This dispatch changes sentences and one knowledge event (B) — physics stays put.

Note: `scripts/mind-probe.mjs` asserts `sysNew.includes('Buildable (wood/stone):')` — update that assertion to the new menu phrasing. Any vitest pinned to the old menu/refusal wording gets updated to the new truth, not deleted.

## B. Builders know what they built (`src/sim/sim.ts` `completeConstruction`)

On `construction:completed` with a non-commons commissioner: append a `discovery:examined` event for the commissioner — `agentId` = commissioner, `data.target` = the place id, `data.knowledge` = the `EXAMINE_BY_KIND` text for the finished kind, honest `reason` (they built it, they know its workings). This flows into the Known prompt lines through the existing `examinedFacts` pipeline — verify with a unit test that `knowledgeLinesForPrompt` picks it up. Deterministic (no RNG), event-log-additive (save version unchanged — state shape untouched). Skip for commons-commissioned sites.

## C. Scenario probes (real model — the gate on the next soak; ~60 calls, budget 3500/day)

Extend `scripts/mind-probe.mjs`:

- **W5 `home-from-empty-hands` (REVIEW GATE — the point of this dispatch):** wild preset, Mira homeless (`homeId: ''`), inventory `{food 2, wood 3, stone 0}`, wallet 20, comfortable needs (0.85), tiles include a forest and a rock tile near a plaza, no construction sites. N=10. Measure: histogram; count `commission` intents (any target) and `commission home` specifically; count reasonings that show a multi-trip/build plan (gather/deliver with home-or-build language). Baseline from the killed run: 0% commission. Report honestly whatever it says — the orchestrator decides the soak from these numbers.
- **W6 `board-builder-verbs` (measurement):** Mira owns `notice-board-0` (owner map + `ownership:transfer` + `construction:completed` events), and her events include the NEW builder-knowledge `discovery:examined` event from B (board examine text in `data.knowledge`). One other villager nearby, comfortable needs. N=10. Measure: do `propose`/`vote`/`sanction` intents or rule-talk reasonings appear at all? A 0 is a finding, not a failure (no grievance exists in the fixture).
- **Re-run W1, W3, W4, S3** unchanged. W4 and S3 remain HARD gates (eat/forage/buy ≥9/10 — stop and report if broken). W1/W3 are before/after comparisons against the P4-4 numbers.

Print histograms + 3 verbatim reasonings per scenario; write the JSON report to `artifacts/` as today.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty (no three/react/DOM/Math.random/Date.now); determinism green for `default` AND `wild`; save version stated (unchanged expected); both recorded soak worlds still import.
2. New vitest: WORLD_RULES contains the deliveries-over-time sentence and the carry cap generated from `GATHER_CARRY_CAP` (change the constant in-test, see the prompt change); menu line still generated from `BUILD_RECIPES`; commissioning with an empty inventory succeeds in wild (regression pin of existing physics); refusal felt lines never contain "you carry"; completion appends the founder-knowledge event and `knowledgeLinesForPrompt` surfaces it; commons-commissioned completion appends no such event.
3. Probes per section C. Report the numbers whatever they are.
4. Do NOT run a soak. The orchestrator runs it after reviewing the probe numbers.

## Final report (exact structure)

**BUILT** (exact new WORLD_RULES construction lines + refusal phrasing shipped) / **GATES** (evidence) / **PROBES** (W1/W3/W4/W5/W6/S3 histograms + verbatim reasonings, with P4-4 baselines where they exist) / **DEVIATIONS** / **KNOWN GAPS**.

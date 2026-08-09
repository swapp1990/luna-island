# Dispatch K — Resources and construction: wood, stone, and the first private house

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report.

**`CLAUDE.md` invariant 7 is the review standard — and this dispatch is a GENERALIZATION pass.** Dispatch J built farm production, hauling, and jobs; you will fold those into generic mechanisms and add two goods and one pipeline. If you find yourself writing `if (kind === 'quarry')` branches for behavior, stop and generalize.

Working directory: `D:\MyProjects\Claude\luna-island`.

## World rules (`src/sim/`)

1. **Generalized production.** Extract J's farm mechanic into one rule: any workplace may have `production: { good: Good, cycleWorkedTicks: number, yield: number }` — progress advances only while worked; on completion, `yield` of `good` is minted into the place inventory (same `goods:produced` event; ledger law covers all minting). Farm = `{food, 1440, 10}` (unchanged semantics). New places: **forestry camp** at the forest edge `{wood, 960, 6}` (jobSlots 2, wage 6), **quarry** at the base of the rock hill `{stone, 1200, 5}` (jobSlots 2, wage 6). Goods union grows: `'food' | 'wood' | 'stone'`.
2. **Storehouse + generalized hauling.** New commons place `storehouse` (near the plaza ring, slots 2). J's haul leg generalizes: each workplace has a haul destination by good — food→stall, wood/stone→storehouse. Same mechanical phases, same events.
3. **Construction pipeline.**
   - `commission(agentId, 'home')`: world checks a free home plot exists (village-ring placement rule from Dispatch C, radius may extend to 8) AND agent wallet ≥ 30 → transfers 30 coins agent→treasury (event `construction:commissioned`, reason names the commissioner), creates a `construction-site` place: needs `{wood: 12, stone: 6}`, `progress: 0`, jobSlots 2, wage 7/day, owner = commissioner.
   - Site work: workers' work action on the site (a) hauls needed materials storehouse→site when the site lacks them (same haul mechanics, reversed direction), then (b) advances `progress += 1/900` per worked tick WHILE the site holds its full remaining material ration — consume 1 wood or stone from site inventory per 50 worked ticks until the bill is exhausted (mechanical consumption, event `goods:consumed`).
   - At `progress ≥ 1`: site becomes a `home` (bed slots for the owner), `transferOwnership(newHome, commissioner, "built and paid for it")` — the island's FIRST private property. Site jobs dissolve (`job:vacated`).
4. **Brain (thin).** One line: wallet ≥ 35 AND sharing a home with ≥ 2 others AND no commission yet → commission a home. (Everything else — taking site jobs, hauling — falls out of existing job/work preferences.)
5. **Food-balance guard:** the new jobs pull labor from foraging. If seed 42 over 6 sim-days produces > 10 collapse events total, you may raise farm yield 10→12 and/or bush regrowth to +1/200t — smallest change that stabilizes, recorded in DEVIATIONS. Do not touch brain scores for this.

## Render/UI

- Forestry camp: 2–3 log-pile + stump props at the forest edge. Quarry: chiseled blocks + props at the rock hill base. Storehouse: small barn (reuse home mesh idiom, wider, no chimney) with crate stacks reflecting wood/stone stock.
- Construction site by progress: <⅓ timber frame outline, <⅔ walls, then roof; a small materials pile that empties as consumed.
- Bubbles: `🪓 Chopping wood`, `⛏️ Quarrying stone`, `🏗️ Building`, `🧺 Hauling` (existing). Ticker: commissions (`🏗️ Wren commissioned a house!`), completions (`🏠 Wren's house is finished`), first-private-property moment.
- Inspector: job row already generic; owned places listed under a small `🏠 Owns: …` row when non-empty (`data-testid="owns-row"`).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty.
2. New vitest (seed 42):
   - Production is ONE code path: farm/forestry/quarry all mint via the same mechanism (assert via events from all three by day 4).
   - Materials ledger: wood/stone minted − consumed === stocks across places+agents (extend the reconciliation).
   - Coin conservation across 8 sim-days including ≥ 1 commission (30 coins agent→treasury) and site wages.
   - Integration: within 8 sim-days someone commissions; the site consumes materials; progress reaches 1; ownership transfers to the commissioner; a new home renders in worldstate. If seed 42 never commissions, lower the commission wallet threshold to 30 (matching cost) and record it — do NOT script it.
   - Collapse guard: ≤ 10 collapse events over the 8 days (after any allowed tuning).
   - Determinism + snapshot/seek hashes (sites/production/storehouse in hash).
3. E2e: ffwd ~6 sim-days; screenshot `artifacts/construction.png` showing a site in progress OR completed new house (assert via bridge-additive `__simState.placeCounts` if needed — additive only). Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

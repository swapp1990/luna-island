# Dispatch P5-4 — Assemblies: turnout becomes a place and a time; and the village can see what it already owns

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, or other `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang and killed.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing:

- `src/sim/sim.ts` — the sheep electorate sweep (~1755: at 18:00 every sheep votes on every open proposal, invisibly and from anywhere), `propose()` and `closeExpiredProposals()`, `vote()` (binding vs advisory), the P5-3 public-works passage flow, plaza lookup patterns.
- `src/sim/types.ts` — `WorldState`, `Proposal`, additive-field precedents.
- `src/mind/prompt.ts` — `civicObservationLines`, standing facts, `SLACK_MARKER` pattern for shared literals.
- `src/sim/examine.ts` — board text; `src/mind/knowledge.ts` — `formatNearbyPlaceLine`.
- `test/institutions.test.ts` — the sheep-electorate test (~167) asserts the 18:00 anywhere-sweep; it will need rewriting to attendance semantics, deliberately.
- `src/sim/utilityBrain.ts` — sheep steering (how sheep choose to walk places) — you will add one steering input, see A2.

## Why (measured)

Three soaks say turnout is the binding civic constraint: every failed proposal in the last full run died at 1–2 binding votes against a quorum of 3, unopposed. Voting is currently a solitary paperwork action with no time, no place, and no social gravity — while the political-science literature this project leans on (convened arenas; the report's G11) says deliberation happens at gatherings. Separately, the last run's village voted 4–0 to build a SECOND notice-board: origination happened at tick 22, before the proposer had plausibly ever seen the first board, and no observation anywhere carries building stock — redundancy is invisible (the P4-8 bug class again).

Scaffold, not script (invariant 7 — read this twice): the engine gains a TIME AND PLACE where civic life is physically real, and FACTS about what exists. It must not gain any instruction, suggestion, or reward for attending. Whether a mind walks over is the Brain's business.

## A. Assemblies (sim)

1. **Gathering state.** `WorldState.gatherings?: Gathering[]` (additive) — `{ id, kind: 'assembly', placeId, startTick, endTick, subjectId }`. Generic shape (future festivals/markets reuse it); only `assembly` ships now. When a proposal is posted, the world schedules one assembly per proposal at the **plaza**, on the **last evening before `closesTick`** (window 18:00–20:00 of that day; if the proposal closes before that evening exists, the first available 18:00). This is institutional physics — the same kind of world rule as `closesTick` itself. Gatherings expire from state after `endTick`.
2. **Sheep vote in person now.** Replace the invisible anywhere-sweep: during an assembly window, sheep steer toward the plaza (add a steering input to the sheep side of `utilityBrain.ts` the same way other place-draws work — physics-level, sheep are world process), and a sheep casts its sympathy vote ONLY while standing within the plaza radius (reuse the existing plaza-proximity predicate). A sheep that never arrives never votes. Sympathy rule unchanged; their votes remain advisory (`bindingTally` untouched). Collapsed/starving sheep obviously do what needs dictate — do not override survival steering.
3. **Minds are free.** Binding votes stay valid from anywhere at any time (no attendance gate — gating minds would be choreography and would break every existing flow). The assembly changes their *information*, not their options.
4. Events: `gathering:scheduled` (on propose, with when/where/subject), `gathering:started`, `gathering:ended` (with attendance count: villagers within plaza radius at any point of the window — track a simple set). All with human `reason` lines.
5. Determinism/persistence: gatherings and the attendance set are state — save round-trip at v5 if additive allows (explain if not), `stateAt` re-sim reproduces them.

## B. What a mind sees (facts only — no advice, no "you should attend")

- While an assembly is scheduled today: one line in the civic block — `An assembly gathers at the plaza at 18:00 to weigh "<text>"`.
- While one is ONGOING: `The assembly is gathered at the plaza NOW (N villagers) — "<text>" is being weighed` plus the existing `you voted …`/deciding-count facts already on the proposal line.
- Board examine gains one sentence: proposals are weighed at a plaza assembly on their closing eve.
- **Census (the redundancy fix):** examining or standing near the notice-board adds one compact line of building stock, derived from `world.places` (never hand-written): `The village holds: 10 homes, 1 farm, 1 well, 1 notice-board, 1 stall, 1 storehouse, 1 forestry, 1 quarry.` Counts only; no judgment, no "enough", no advice. Kinds with count 0 are omitted.
- No other prompt changes. Do NOT mention assemblies in WORLD_RULES beyond one factual clause appended to the existing civic sentence if — and only if — the board examine alone leaves the mechanic undiscoverable in the `--dump` fixtures; state your choice.

## C. Renderer (small)

- During an ongoing assembly: a banner or torch pair at the plaza (reuse the P5-2 pennant dressing helper if it fits). The crowd itself emerges from sheep walking there — no crowd choreography in the renderer.

## D. Emergent measurement (no nudging, ever)

- New probe rung **G14 `assembly-now`** in `scripts/mind-probe.mjs`: slack fixture, an open proposal the agent has NOT voted on, assembly ONGOING in the observation, agent 3 tiles from the plaza. Grade: vote / walk-toward-plaza / socialize-at-plaza vs everything else. `--dump` verify only; the orchestrator runs it live. The fixture text must contain only the B-format facts — if you find yourself writing "you could go" anywhere, stop.
- The soak comparison (orchestrator's job later) is the real test: binding turnout vs the three recorded runs, with zero instruction changes.

## Gates

1. `npm run check` exit 0. `npm run e2e -- --workers=1` all pass. Purity grep of `src/sim/` empty.
2. Rewrite the sheep-electorate vitest to attendance semantics: sheep at the plaza during the window vote; a sheep parked far away with blocked pathing does not; totals reflect actual attendance; determinism double-run still exact. Add: gathering scheduled on propose with correct window math; expiry; attendance-count event; census line derives from places (add a place, count changes); assembly observation lines render only in their windows; save/`stateAt` round-trip.
3. `node scripts/mind-probe.mjs --only G14 --dump` prints the fixture; zero model calls anywhere.
4. Both recorded soak worlds still import (their saves have no gatherings — missing ⇒ none scheduled; the next propose schedules normally).
5. Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

## Final report (exact structure)

**BUILT** (gathering shape + window math; sheep steering change; exact observation/census lines verbatim; renderer dressing) / **GATES** (evidence; how the electorate test changed and why the new assertions are honest) / **G14 DUMP** (fixture verbatim) / **DEVIATIONS** / **KNOWN GAPS**.

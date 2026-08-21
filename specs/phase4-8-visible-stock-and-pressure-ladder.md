# Dispatch P4-8 — Resource state you can see, and a forced pressure ladder for civic action

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read before writing: `src/mind/prompt.ts` (`buildUserPrompt` — note `Stall stock: N` at ~line 263, the one place stock is already exposed), `src/mind/knowledge.ts` (`formatNearbyPlaceLine`, `nearbyPlacesForObservation`, `formatUnfamiliarPlaceFact`, `feltLineFromEvent`), `src/sim/sim.ts` (`place:blocked` from P4-7, forage paths ~1974 and ~4321, `BUSH_STOCK_MAX`, `SPRING_STOCK_MAX`), `src/sim/examine.ts`, `src/mind/sheepTalk.ts` (line ~130), and `scripts/mind-probe.mjs` (W8/W9 from P4-7, plus an **uncommitted W9B fixture already in the working tree** — reuse/refactor it, don't duplicate it).

## Why (evidence from P4-7's probes and a corrected reading of P4-6)

P4-7 shipped the contested commons: one spring, one slot, and `place:blocked` events that name the occupant/owner. The headline probe (W9 — spring claimed by Wren, board verbs in Known, coins in pocket) came back **propose 0, sanction 0, claim 0, all 10 foraging the bush**. Two reasons, both perception, neither political:

1. **The W9 fixture left a free, open bush 3 tiles away.** Verbatim: *"the berry bush is nearby and open"*, *"I can gather without spending coins."* Exclusion that costs nothing is not a grievance. (My spec caused this by requiring the spring never be the only option.)
2. **The corrected run was ALSO invalid.** A W9B variant with the bush emptied to 0 food and hunger at 18% still returned `{forage: 10}` — all ten walked to an empty bush, reasoning *"the berry bush is nearby, I will forage before my hunger worsens."* They cannot see it is empty: `buildUserPrompt` exposes stock for the **stall only**; every other place renders as a bare label from `formatNearbyPlaceLine`. Resource state is invisible.

Also a correction to the P4-6 analysis on record: the "scarcity discourse" I cited — five villagers saying *"The bushes by the forest are picked clean"* — is a **hardcoded sheep-chatter template** (`sheepTalk.ts:130`), emitted by 19 agents, mostly sheep. It was never a perception. The island's only scarcity signal was a canned rumor.

This is the third instance of one bug class: P4-5 (bills looked like up-front prices), P4-7 (blocking was silent), now (depletion and abundance are invisible). Each time, the behavior we wanted was impossible because the information needed to want it wasn't in the prompt. Fix the information; do not add motivation.

## A. Resource state is perceptible (information physics)

Generalize what the stall already does to every place, in the observation the mind reads:

- `formatNearbyPlaceLine` (and the unfamiliar-place variant where sensible) gains the place's **relevant stock** and, when the place is **privately owned, the owner's name** — e.g. `berry bush (empty)`, `berry bush (4 food)`, `spring (8 food)`, `spring (8 food, Wren's)`, `storehouse (12 wood, 6 stone)`. Choose compact phrasing; derive goods from the place's actual `inventory` (never hand-written per kind), and show owner names using whatever helper P4-7 added for private places rather than a second implementation.
- Retire or fold in the now-redundant special case: `Stall stock: N` should not survive as a separate line saying what the nearby-places line already says. State what you did.
- A stock of zero must read as plainly empty (`(empty)`), not as an omitted field — absence of information is what caused the bug.
- Distances/directions and the `(unfamiliar)` tag keep working exactly as today.
- **No advice, no evaluation.** Never "the spring is better", never "you are being excluded", never "you could propose a rule". Facts only.
- Sheep talk: the `picked clean` template is a canned claim that may now contradict what a mind can see. Leave the mechanic alone (sheep are not minds), but if it is trivially possible, make that line reflect the speaker's actual nearby bush stock instead of asserting a fixed sentence. If it is not trivial, skip it and say so — do not spend a third of this dispatch there.

## B. The forced pressure ladder (the point of this dispatch)

We are no longer waiting for a 2-hour soak to maybe stumble into a grievance. Build an explicit escalation ladder in `scripts/mind-probe.mjs`, run every rung on the **real Luna brain** (default engine — codex, `gpt-5.6-luna`; if codex errors, STOP and report, never silently switch to grok), **N=10 each**, and report each rung's intent histogram plus 3 verbatim reasonings.

All rungs share: Mira (`agent-0`), wild preset, a notice-board present with its verbs in Known (the P4-6 board-examine event), wallet ≥ 5 coins (propose costs 2, sanction 1), and a spring holding 8 food. What changes is the pressure.

- **G0 `perception-control`** — spring **commons and unoccupied**, bush visibly empty, hunger ~0.18. Sanity check that A works: do they now walk to the spring instead of the empty bush? A high forage-spring count here proves perception landed. **If G0 fails, stop and report — the rest of the ladder is uninterpretable.**
- **G1 `occupied-once`** — spring commons but Wren is standing in the only spot, bush visibly empty, hunger ~0.18, one `place:blocked` felt line naming Wren.
- **G2 `claimed-and-costly`** — spring **owned by Wren**, bush visibly empty, hunger ~0.18, three blocked/exclusion felt lines so it reads as a pattern (the corrected W9B).
- **G3 `public-harm`** — G2 plus a **collapsed villager in view** (the P4-4 collapse observation path) who is down from hunger while the spring sits full and private. Now the injury is not only Mira's.
- **G4 `corroborated`** — G3 plus a `told` fact from a peer naming the same problem (a `mind:say` addressed to Mira, e.g. someone saying Wren keeps the spring to himself). Social corroboration on top of personal and public harm.

Grade every rung for: `propose`, `sanction`, `claim`, `vote`, any rule-talk in reasoning (reuse the existing `civicIntentOrRuleTalk` helper), plus what they did instead. Report the **first rung, if any, where a civic act appears** — that threshold is the deliverable. A ladder that is all zeros through G4 is a real and publishable finding: it would mean these minds do not reach for institutions even under personal + public + corroborated grievance with the remedy in hand and affordable.

Keep **S3 and W4 survival regressions** at N=10 as HARD GATES (≥9/10).

Do NOT script, nudge, or prompt-engineer toward proposing. The ladder adjusts *circumstances*, never instructions.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (use `--workers=1` if the 8-worker WebGL flakiness from P4-7 recurs, and say so); purity grep of `src/sim/` empty; determinism green for `default`, `lean`, `wild` (observation text is prompt-side — hashes should NOT move; if any moves, stop and explain); save version stated; both recorded soak worlds still import.
2. New vitest: a place with zero stock renders `(empty)`; stock renders from actual inventory for multi-good places; a privately owned nearby place shows its owner's name; a commons place shows no owner; the retired stall-stock line does not double-report; `buildUserPrompt` output for a fixture with an empty bush and a full private spring contains both facts (this is the exact regression that made W9B uninterpretable).
3. Ladder per section B, on the real Luna brain, with S3/W4 hard gates green.
4. Do NOT run a soak.

## Final report (exact structure)

**BUILT** (exact observation-line format shipped, what happened to `Stall stock`, sheep-talk decision) / **GATES** (evidence, confirm hashes did not move) / **LADDER** (G0–G4 histograms + 3 verbatim each + the threshold rung, or an explicit all-zeros statement) / **SURVIVAL** (S3/W4) / **DEVIATIONS** / **KNOWN GAPS**.

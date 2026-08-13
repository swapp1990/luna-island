# Dispatch P3-6 — The Discovery Layer (Stage 1 of knowledge extraction)

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas go in DEVIATIONS as suggestions. No refactors beyond need; every deviation needs minimal-diff justification; the orchestrator red-teams the report against the diff. If a gate won't go green after 3 distinct fix attempts, STOP and report. MockProvider covers all gates.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants + the mind layer first.

## The design principle (user-set, project law from now on)

Agents must DISCOVER what the world means, not read documentation. The soak autopsy proved documented mechanisms never enter minds (449 famine thoughts, zero civic mentions — the mechanics existed only as prompt text, nothing in the world to encounter). Direction: **capabilities stay listed (motor schema); meanings get discovered (world knowledge).** The instinct layer (UtilityBrain) remains the safety net — the body eats by reflex; the mind learns what eating means by feeling its consequences. This dispatch builds the infrastructure; later stages extract economy and survival knowledge from prompts.

## 1. Felt consequences (`src/mind/` observation building; sim events already carry the data)

- Every mind's observation gains a **"Recently felt"** section (up to 5 lines, most recent first, last ~12 sim-hours): cause→effect deltas from that agent's own events — `ate berries: hunger 34%→79%`, `slept in your bed: energy 22%→96%`, `worked the quarry: +6 coins at day's end`, `drank at the well: energy +8%`. Derive from existing trace events (action:end outcomes, coins:transfer, need deltas) — sim-side event data may gain additive before/after fields where missing.
- These are FELT experiences, not explanations — never "eating restores hunger" (a law), always "you ate; hunger 34%→79%" (an experience).

## 2. Learned knowledge (`src/mind/knowledge.ts` — the mind's world-model, per agent)

- A per-agent knowledge store, derived deterministically from (a) the agent's own felt-consequence history, (b) `examine` results they've performed (below), (c) what others TOLD them (mind:say utterances they heard). Distillation: nightly reflection prompt gains a second output field `"learned": ["…up to 2 short world-facts you now believe…"]` — recorded through the existing note law (mindNoteLog; additive field, save v5 additive).
- Prompts: the **WORLD RULES digest in the system prompt is REDUCED** — remove ALL institution mechanics text (the board is now discoverable, §3) and the market/price line. Keep for now (Stage 1 scope): needs-decay basics, action-kind list (motor schema), response contract, the slot/occupancy line. Add instead: `"You feel your needs. The world contains places and things whose workings you learn by living, examining, and listening."`
- User prompt gains `Known:` (up to 6 lines from the knowledge store — believed world-facts) alongside `Your memories:`.

## 3. The town board is a THING + universal examine

- Worldgen: a `notice-board` place on the plaza edge (small wooden post + board mesh, in-style). It exists in `placeCounts`, is selectable (N1 building panel shows the civic state), renders with the ordinary place idioms.
- New universal intent `examine {target place kind or name}`: agent walks to it (normal pathing/slots) and the WORLD returns that thing's mechanics as an examine-result — for the board: how proposing/voting/sanctioning/claiming work (the text that used to live in the system prompt, now delivered as a discovery). Result lands as event `discovery:examined { agentId, target, knowledge }` → into the agent's knowledge store + an episodic memory (📌 examined the notice board). EVERY place kind must be examinable (bush → "berries grow here, sparser in lean times"; well, farm, stall, storehouse, homes, quarry, forestry — 1-2 factual lines each, meanings-not-laws phrasing).
- Observations mark novelty: places within view the agent has NEVER examined/used carry a `(unfamiliar)` tag — nothing more. First-encounter of a place kind emits `discovery:noticed` once per agent per kind (trace-derived, deterministic).
- Institution intents (`propose/vote/sanction/claim`) remain in the motor-schema action list, but with zero explanation — a mind that hasn't examined the board or been told about it knows only the word.

## 4. Ground sleep (world rule — sets up Stage 3 shelter discovery)

- `sleep` no longer requires a bed slot: sleeping anywhere works at HALF the energy-restore rate; bed slots keep the full rate. Felt consequences make the difference discoverable ("slept on the ground: energy 20%→52%" vs "slept in your bed: 22%→96%"). Instinct (UtilityBrain) still prefers beds — unchanged behavior for sheeps.

## 5. Soak harness

- `scripts/soak-political.mjs`: journal + story export gain the discovery events; CIVIC monitor list gains `discovery:examined`.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched EXCEPT any minimal change ground-sleep strictly requires (justify; prefer none).
2. New vitest: felt-consequence lines derived correctly (incl. before/after deltas); knowledge store determinism (same trace+notes+says → same Known lines); examine flow (walk, event, knowledge landed); novelty tag fires once per kind per agent; ground-sleep half-rate; board place exists + is examinable; save round-trip with knowledge notes; determinism double-run.
3. **Prompt extraction gate:** vitest asserting the system prompt no longer contains institution mechanics or market pricing text (greps), and DOES contain the new one-line stance.
4. E2e (mock): agent examines the board (seeded intent) → Mind tab shows the discovery memory + Known line; unfamiliar tag visible in an observation (assert via last-exchange); ground sleeper's felt line shows the lesser restore. Screenshot `artifacts/discovery-board.png` (board on the plaza, building panel open).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **STRUCTURAL PROOFS** (prompt-extraction grep results) / **DEVIATIONS** (justified) / **KNOWN GAPS**.

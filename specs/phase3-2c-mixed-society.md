# Dispatch P3-2c — Mixed society: sticky conversations + minds talking to sheeps

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the conversation engine (P3-2/P3-2b) first; surgical extensions in its style. MockProvider covers all gates. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Context (user direction)

The village keeps exactly its SIX minds (no new personas). The other 18 villagers ("sheeps", UtilityBrain) become conversable: a mind may talk to a sheep, and the sheep answers from deterministic, state-grounded templates — zero LLM calls on the sheep side. Sheeps stay full economic citizens; they just don't reason.

## 1. Fix: conversations that survive past "hello" (live bug)

Observed: Joss opened a conversation with Nook (who was mid-eat); it ended after turn 0 — Nook never replied. Start rule (one participant socializing) conflicts with the continuation rule (ends on any action change).

- **Continuation rule:** once started, a conversation continues while BOTH participants remain stationary within 1.5 tiles — regardless of action kind (chatting over a meal is village life). It ends when: turns are exhausted, a speaker sets `done`, either participant MOVES (walks off), or an urgent interrupt fires (any need < 0.15).
- **Participation hold:** active participants defer non-urgent redecides until the conversation ends (extend the existing suspension to BOTH sides, sheeps included — a sheep pauses its next utility decision for the few ticks of a chat unless urgent).
- **Turn scheduling must not depend on the render loop:** drive turn progression from the same applied-tick/queue hooks as intents (must work under `ffwd` + wall waits, exactly how orchestrator QA drives it — this is a gate).

## 2. Mind↔sheep conversations (grounded templates)

- **Eligibility extends** to (mind, sheep) pairs — same adjacency/cooldown rules; the mind always initiates (sheeps don't seek conversations). Sheep↔sheep: never.
- **Sheep replies** (`src/mind/sheepTalk.ts`): a deterministic template pool (~14 templates), selected by seeded hash (conversationId + turn + agentId) — NO Math.random, NO LLM. Every template is **grounded**: it may only assert facts true of the sheep's state at utterance time — their job/wage ("Six coins a day at the farm, if you're looking"), current activity ("Long shift at the quarry — my back's done"), hunger/food ("Haven't eaten since morning"), observed world facts ("The bushes by the forest are picked clean" ONLY when nearest-bush stock is 0; "Food's dear at the stall today" only when price ≥ 8), and a sympathy-aware greeting variant when sympathy toward the mind ≥ 0.3. Template slots are filled from real state; a template whose predicate is false is excluded from selection.
- **Shape:** mind speaks (LLM call) → sheep replies (template, 0 calls) → mind may speak once more → sheep closes (template, `done`). Max 4 utterances; only the mind's 1–2 turns cost budget.
- **Recording:** sheep utterances enter `sayLog` like any other (additive `source: 'template'` field; save stays v4 — additive within version is fine if the loader tolerates missing field; otherwise bump to v5 with upgrade, your call, note it). Replay identical (hash gate).
- **Memory:** the MIND gets the usual 💬 episodic + transcript in reflections. The sheep's Life log shows the 💬 rows (they lived it) but sheeps have no memory system — nothing else.
- **Concurrency:** lift the island limit to **2 active conversations** (at most one mind↔mind; mind↔sheep ones are cheap). Lanes/cooldowns unchanged.

## 3. UI

- Sheep speech bubbles reuse the existing system (template text shows over the sheep).
- The mind's Conversations section shows both sides (already does via sayLog). A sheep's inspector (no Mind tab) shows 💬 rows in Life.
- Ticker: same `💬 X & Y are talking` row.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty (sheepTalk lives in `src/mind/`, uses seeded hash only); `utilityBrain.ts` untouched; personas unchanged (still 6 minds).
2. New/updated vitest:
   - **Stickiness regression:** partner mid-eat at start → full multi-turn conversation completes (no premature end); movement/urgent-need still end it; participation hold defers sheep redecide.
   - **Turn progression under ffwd:** scripted conversation advances turns without any rAF (pure advanceTicks + queue pumping).
   - **Template truthfulness:** for a matrix of sheep states, selected templates never assert a false predicate (empty-bush line only when stock 0, job line only when employed, etc.).
   - **Determinism:** same seed/state → same template replies; sayLog with template utterances → `stateAt`/fork hash-identical; save round-trip.
   - **Budget:** a mind↔sheep conversation dispatches exactly the mind's turns (1–2 calls), never more.
   - Two-active-conversation cap enforced; at most one mind↔mind.
3. E2e (mock): seeded mind↔sheep conversation → sheep bubble renders template text; mind's transcript shows both sides; sheep's Life log has 💬 rows; screenshot `artifacts/mixed-conversation.png`.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

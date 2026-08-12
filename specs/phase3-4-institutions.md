# Dispatch P3-4 — Institution primitives: propose, vote, claim, sanction (electorate model)

## Your role — read this section twice

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`.

You are a highly capable engineer — which is exactly why the leash is explicit:
- Implement THIS spec, not a better one. If you see a superior design, note it in DEVIATIONS as a suggestion and implement what's written.
- No refactors beyond what the feature strictly needs. No new dependencies. No "while I'm here" improvements to unrelated systems.
- Every deviation requires: what, why, and the minimal-diff justification. Unjustified deviations will be reverted.
- The orchestrator red-teams your report against the diff. Report failures honestly; a truthful KNOWN GAP costs nothing, a discovered false claim costs the whole dispatch.
- If a gate won't go green after 3 distinct fix attempts, STOP and report.

Read first: `CLAUDE.md` (invariants — especially 7, scaffold-not-script), then the mind layer (`src/mind/`), sim recording patterns (`externalIntentLog`/`sayLog`), and the Phase-2 ownership/coins mechanisms. MockProvider covers every gate — zero codex spawns in tests.

Working directory: `D:\MyProjects\Claude\luna-island`.

## The one law above all: MECHANISMS, NOT LAWS

The engine posts facts and applies mechanical consequences (fees, registries, tallies). It NEVER enforces a rule's meaning: no code path may block, penalize, or alter any action because of what a rule's text says. Whether rules are followed, broken, or avenged is entirely up to minds. A structural check in your report must demonstrate this (show that rule objects are only ever read for display/observation, never consulted by action mechanics).

## 1. World mechanisms (`src/sim/` — serialized, hashed, saved; formatVersion 5 with v4..v1 upgrades)

- **Proposals.** `propose(agentId, text)`: costs 2 coins proposer→treasury via `transfer()`; creates `{id, proposerId, text (≤200 chars, agent-authored), createdTick, closesTick: createdTick+1440, votes: {}, status: 'open'}`. Limits (mechanical): one open proposal per proposer, max 2 open island-wide; refusal is a no-op with an honest event. Events: `institution:proposed`.
- **Voting.** `vote(agentId, proposalId, 'yes'|'no')`: one vote per villager per proposal, only while open, recorded in the tally (public — running tallies are visible facts). Event `institution:voted`. At `closesTick`: status → passed if yes > no AND total votes ≥ 8 (quorum), else failed. Event `institution:closed` with tally.
- **Sheep electorate (world rule).** At 18:00 daily, every sheep casts a vote on each open proposal it hasn't voted on: `yes` if sympathy toward the proposer ≥ 0.25, else `no`. Deterministic, in agent-index order. (Minds vote only by their own intent — they may abstain.)
- **Rules registry.** Passed proposals append `{id, text, proposerId, enactedTick, active: true}` to `world.rules`. Rules are display/observation data ONLY (see the law above).
- **Sanction.** `sanction(agentId, targetId, reason ≤120 chars, ruleId?)`: costs the sanctioner 1 coin→treasury; records event `institution:sanctioned` (public censure — lands in both Life logs and observations). NO mechanical effect on the target. Skin-in-the-game fee is the only mechanics.
- **Claim.** `claim(agentId, placeId)`: succeeds mechanically if the place is commons and claimer pays 15 coins→treasury; `transferOwnership(placeId, agentId, "claimed it")`. Yes, a villager may privatize a commons farm — whether the village tolerates that is politics, not code.
- All fees flow through the existing `transfer()`; coin conservation must stay green.

## 2. Mind integration (`src/mind/`)

- Intent contract grows: `propose {text}`, `vote {proposalId, choice}`, `sanction {target, reason}`, `claim {target place}` as valid actions alongside existing kinds. Parsing strict as ever; invalid → fallback.
- Observations gain (compact): open proposals with running tallies + time left; up to 5 active rules; recent sanctions (3); a note when the agent CAN afford propose/claim fees. Nearby-agent actions are already observed — minds judge violations themselves by reading rules against what they see. No violation detection in code.
- **Prompt neutrality (gated):** mechanisms are described neutrally — exist, cost X, anyone may use them; posted rules may be followed or broken; breaking may draw sanctions from others. FORBIDDEN: any phrasing that nudges toward proposing, voting yes, obeying, or rebelling. Add a vitest asserting the system prompt contains no imperative usage nudges (grep for phrases like "you should propose/vote/obey").
- When a proposal is open, each mind gets at most ONE extra decision opportunity per proposal (cadence bump) so votes happen within the window — the choice itself (vote yes/no/ignore) is theirs.

## 3. UI

- **Town Board** panel (📜 button, HUD family, `data-testid="town-board"`): open proposals (text, proposer chip, live tally, closes-in), standing rules list, recent sanctions. Replay-aware (shows state at replay tick).
- Ticker: `📜 Nook proposed: "…"`, `🗳️ Proposal passed/failed (yes–no)`, `⚖️ Wren sanctioned Ode: "…"`, `🏷️ Mira claimed the east farm`. First-ever proposal and first-ever passed rule get distinct celebratory ticker copy.
- Inspector: propose/vote/sanction/claim decisions already flow through the Mind timeline with reasoning (verify).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched (sheep voting lives in sim world-process code, not the brain).
2. New vitest:
   - Mechanics: fees conserve coins; proposal limits; one-vote-per-villager; quorum + passage math; sheep electorate votes deterministically at 18:00 by the sympathy threshold; claim transfers ownership of commons only; sanction records + fee.
   - Determinism: scripted proposals/votes/sanctions/claims → double-run hash equality + `stateAt` seek; save v5 round-trip + v4..v1 loads.
   - **No-enforcement structural test:** with an active rule present, every action kind still executes identically (compare a sim with rules vs without — behavior hashes equal given same intents).
   - Prompt-neutrality grep test.
3. E2e (mock): seeded flow — a mind proposes (mock intent) → town board shows it with tally → sheep votes land at 18:00 → passes at close → rule on the board → a mind sanctions (mock) → censure in both Life logs. Screenshot `artifacts/town-board.png` (open proposal with live tally). Replay: scrub back before the proposal → board empty at that tick.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **STRUCTURAL PROOFS** (no-enforcement + neutrality) / **DEVIATIONS** (with justifications) / **KNOWN GAPS**.

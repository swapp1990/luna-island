# Dispatch P3-2 — Conversations: minds that talk, transcripts that become memory

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the mind layer (P3-0..P3-1b) first; extend its patterns (recorded logs, dispatch queue, budget, breathe). MockProvider covers all gates — zero codex spawns in tests. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Principles (law for this dispatch)

1. **One mind, one voice:** every utterance comes from its speaker's own LLM call. Never generate both sides in one call.
2. **No new world mechanics:** conversations are mind-layer content on top of the existing adjacency/social rules. No sim behavior changes; sim gains ONLY the recorded log + events (the established pattern).
3. **The recording law:** every utterance is recorded once, replayed forever.

## 1. Recorded utterances (`src/sim/` — same pattern as intents/notes)

- Serialized `sayLog: Array<{ tick, conversationId, agentId, partnerId, turn, text, done }>` on world state (snapshots/saves/hash). `postSay(...)` queues → applied next step → event `mind:say { agentId, partnerId, conversationId, turn, text }` (reason-free; the text IS the content). Replay re-applies at recorded ticks — extend the existing replay path. Save **formatVersion 4** (v3/v2/v1 upgrades keep working).

## 2. Conversation engine (`src/mind/conversation.ts`, app-side)

- **Eligibility:** two LUNA minds, both stationary within 1.5 tiles, at least one in `socialize`, neither in cooldown. Cooldowns: same pair ≥ 4 sim-hours; any-partner ≥ 1 sim-hour per agent. Max ONE active conversation island-wide (P3-2 scale).
- **Turns:** strict alternation starting with the agent who has lower sympathy toward the other (they have more reason to reach out); max 4 turns total; each turn is one budgeted call through the existing dispatch queue (decisions still outrank conversation turns; reflections stay lowest). Turn contract: reply ONLY `{"say":"<≤140 chars, in your voice, first person, to your partner>","done":<bool>}`. `done:true` or the turn cap ends it. Invalid JSON → conversation ends gracefully (event `mind:say` with `text:"…(trails off)"`, done) — no fallback storm.
- **Interruptions:** if either participant's action changes away from socializing/stationary (urgent need, world push) → conversation ends (final recorded say marked done). While a conversation is active, its participants' decision cadence is suspended (talking IS their activity; UtilityBrain keeps them standing via the existing socialize action).
- **Turn prompt:** persona + grounding rule + partner context (name, sympathy score, up to 3 of the speaker's memory lines that MENTION the partner) + speaker's brief state (needs/standing facts, 3 lines) + the transcript so far + contract. ≤ ~1200 tokens.

## 3. Memory & trace integration

- Utterances land in both participants' Life logs (mind:say events carry agentId; ensure the inspector/day filters show them as `💬 "text"` rows for speaker and partner).
- On conversation end, derive ONE deterministic episodic line per participant (no LLM call): `💬 D2 14:03 — talked with Joss: "<last utterance ≤60 chars>"` — via the existing episodic salience path.
- Nightly reflections already read the day's trace → transcripts flow into reflections naturally (verify the reflection prompt includes mind:say lines).

## 4. Three more minds (`personas.ts` — temperament/aspiration only, guard test still applies)

- `agent-2` Tama: warm old-soul storyteller, insatiably curious about everyone's business, believes the village runs on stories; wants to be its living archive.
- `agent-4` Ode: restless builder at heart, impatient with idle talk, dreams of raising something with their own hands that outlasts them.
- `agent-8` Nook: anxious provisioner, counts supplies twice, worries about lean days; feels safest with a full pantry and trusted neighbors.
- `LUNA_AGENT_IDS` = 6 (Mira, Joss, Tama, Ode, Nook, Wren). Dispatch queue depth follows automatically.

## 5. UI

- **Speech bubbles:** when an utterance applies, the speaker shows a chat bubble with the text (same projection system as status bubbles; readable ~4 s real-time or until their next turn; queue-safe). Status bubble hides while a speech bubble is up.
- Mind tab gains **Conversations**: list of that agent's conversations (partner, day/time, expandable transcript).
- Ticker: `💬 Mira & Joss are talking` once per conversation start.
- **Verify the 💭 reflection ticker rows actually render** (observed possibly missing in live QA — fix if broken, note in DEVIATIONS either way).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched; personas guard test passes with 6 minds.
2. New vitest:
   - Say record/replay: scripted sayLog → `stateAt`/fork hash-identical; save v4 round-trip + v3/v2/v1 loads.
   - Conversation lifecycle (mock): eligibility → alternating turns → done; pair + per-agent cooldowns respected; interruption ends cleanly; max-one-active enforced; each utterance = exactly one dispatch; decisions outrank turns in the queue.
   - Episodic derivation: conversation end yields one 💬 memory line per participant.
3. E2e (mock): 6 minds, run until a conversation occurs (mock canned says) → both Life logs show 💬 rows; Mind tab Conversations section has the transcript; speech bubble visible during exchange (screenshot `artifacts/conversation.png`); reflections still fire nightly; 💭 ticker rows render.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

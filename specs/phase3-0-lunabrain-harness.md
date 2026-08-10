# Dispatch P3-0 — One mind among sheep: the LunaBrain harness

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the existing code first and extend it in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first — invariants 1–8 are law, especially: sim purity (no network/Date/random in `src/sim/`), determinism as a tested gate, every action traced with reasons, scaffold-not-script.

## What this dispatch builds

The first LLM-driven villager. ONE agent (Mira, agent-0) gets a `LunaBrain` — an async mind that directs her at a throttled cadence while the UtilityBrain keeps executing between decisions. Every mind decision is **recorded into the trace and replayed from the recording** — replays and re-simulation NEVER re-call an API. The other 23 villagers are untouched.

## Architecture (pinned — this is the load-bearing part)

### 1. External intents: how async minds coexist with a deterministic sim

The sim stays synchronous and pure. Minds live OUTSIDE it:

- `src/sim/` gains an **external-intent inbox**: `postExternalIntent(agentId, intent, meta)` queues an intent; it is APPLIED at the start of the next `advanceTicks` step (deterministic application order: by agentId then queue order), overriding that agent's next brain decision. Every application appends event `mind:decision { agentId, intent, reasoning, source: 'luna', provider, latencyMs }` AND appends a record to a serialized `externalIntentLog: Array<{ tick, agentId, intent, meta }>` on world state (part of snapshots, saves, and the state hash).
- **Replay/re-sim rule:** during `stateAt`/fork re-simulation, the sim consults `externalIntentLog` and re-applies each recorded intent at its recorded tick INSTEAD of consulting any brain for that agent+tick. This is what makes history reproducible: live = record, replay = playback. (The log is already ≤ tick-ordered; re-application must yield byte-identical hashes — gated below.)
- Agents with a pending mind decision keep acting via UtilityBrain until the intent arrives. The world never waits for a mind.

### 2. LunaBrain service (app-side, `src/mind/`)

- `src/mind/lunaBrain.ts`: decision loop for luna-enabled agents. Cadence: request a decision when (a) ≥ 30 sim-minutes since the last mind decision AND the agent just finished an action or hit an urgent interrupt, or (b) ≥ 120 sim-minutes regardless. One in-flight request per agent, 10 s wall timeout → `mind:fallback` event (reason honest) and UtilityBrain continues; retry at next cadence point.
- `src/mind/providers.ts`: `MindProvider` interface `{ decide(prompt): Promise<{text, latencyMs, approxChars}> }` with two implementations:
  - **`CodexProvider`** — the real mind is the LOCAL codex CLI, reached through a sidecar endpoint (below): browser `fetch('/api/luna/decide', {method:'POST', body: JSON.stringify({system, user})})` → `{text}`. 30 s client timeout.
  - **`MockProvider`**: deterministic canned persona decisions (seeded by agentId+tick, no network, fixed 3-tick artificial delay) so vitest/e2e exercise the full pipeline with zero codex spawns.
- **Codex sidecar** (`scripts/luna-sidecar.ts`, wired as a Vite plugin in `vite.config.ts` via `configureServer` AND `configurePreviewServer`): `POST /api/luna/decide` → spawns `codex exec -s read-only -` with the combined prompt on stdin, **cwd = an empty scratch dir** (e.g. `os.tmpdir()/luna-mind`, created on boot) so codex never explores or edits the repo; 25 s kill-timeout; response = codex stdout with markdown fences stripped and the first `{…}` JSON object extracted. One request at a time (simple in-process queue; reject extras with 429 — the client treats 429 as "still thinking", not a fallback). Log each call's latency to the server console.
- Provider selection: default `CodexProvider` when the sidecar responds to `GET /api/luna/health` (the plugin serves it), else Mock. Overrides: `?brain=mock` forces Mock, `?brain=off` disables luna entirely (pure Phase-2 behavior).
- `src/mind/prompt.ts`: system = persona + a ~15-line world-rules digest + STRICT response contract (json only); user = structured observation: sim time, needs %, wallet, inventory, job, current action, nearby agents with sympathy scores, market price + stall stock, her last 10 trace events (with reasons), available action kinds. Keep the full prompt ≤ ~1200 tokens.
- `src/mind/personas.ts`: `agent-0` (Mira): a one-paragraph persona — proud first homeowner, ambitious, warm but frugal, dreams of running the market stall. Others: none (utility).
- **Intent contract:** model must return exactly `{"action": <existing ActionKind>, "target": <optional place kind or agent name>, "reasoning": "<≤160 chars, first person>"}`. Parse strictly; any deviation → `mind:fallback` (validation error in event data). The action space is EXISTING actions only — no new world mechanics this slice.

### 3. Observability

- **Mind tab** in the inspector (luna agents only): mood-free v0 — last decision (intent + reasoning, styled like the action card), decision timeline (mind:decision/mind:fallback events with tick stamps), token totals, and an expandable "last exchange" (prompt + raw response, monospace, scrollable). Utility agents show "Runs on instinct".
- **Mind meter**: cumulative decision/fallback counts + mean latency + approx prompt/response chars on `__simState.mind = { enabled, agentIds, pending, decisions, fallbacks, meanLatencyMs, approxChars }`; a compact `🧠` chip near the resource bar with decision count + provider name (codex/mock).
- Ticker: `🧠 Mira decided: "…reasoning…"` rows (throttle: only on action-changing decisions).
- Bubble: luna agents get a subtle 🧠 prefix on their status bubble.

### 4. Persistence

`externalIntentLog` + per-agent mind stats ride along in snapshots and saves (extend Dispatch M's format additively; bump formatVersion to 2 with a graceful v1 upgrade path — v1 loads get an empty intent log).

## Gates

1. `npm run build` exit 0; `npm run test` all pass; purity grep of `src/sim/` empty (the inbox/log is data, no network/Date in sim); `utilityBrain.ts` may gain ONLY the pending-intent override hook if unavoidable — prefer wiring in `sim.ts`.
2. New vitest (`test/mind.test.ts`), all using MockProvider or direct `postExternalIntent`:
   - **Record/replay determinism (THE gate):** run a sim posting scripted external intents at chosen ticks; `stateAt(t)` and a fork re-simulated from an earlier snapshot reproduce byte-identical hashes WITHOUT any brain consultation for recorded ticks.
   - Save/restore (format v2) round-trips the intent log; a v1-shaped save still loads (empty log).
   - Invalid intent JSON → fallback event, agent keeps living (no throw, no stall).
   - Cadence: no two mind decisions for one agent within 30 sim-minutes.
   - Existing determinism tests stay green with luna disabled (they don't touch minds).
3. New e2e (`e2e/mind.spec.ts`), running with `?brain=mock` (zero codex spawns in tests): Mira makes ≥ 1 mind decision within 2 ffwd sim-hours; Mind tab renders decision + reasoning; 🧠 chip counts up; scrub back → the decision replays identically (same reasoning text at same tick, no new decide calls — assert decision count unchanged); `?brain=off` boots clean with no mind events. Run the full e2e suite.
4. **Sidecar smoke (best-effort):** with the dev server running, `curl -s -X POST localhost:5175/api/luna/decide -d '{"system":"Reply with exactly {\"ok\":true}","user":"go"}'` returns parseable JSON within 30 s. If codex is unavailable in your environment, note it in KNOWN GAPS — the orchestrator will smoke it live.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

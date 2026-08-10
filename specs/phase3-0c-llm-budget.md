# Dispatch P3-0c — Hard LLM budget gates: the mind layer can never run away

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Surgical changes; read the current mind/sidecar code first (P3-0b landed just before you — respect its breathe-throttle and honest decideCalls). If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Why (user directive)

A pacing bug produced thousands of client decide attempts; only the sidecar's incidental one-at-a-time queue kept real codex calls to 9. Budget must be a HARD, server-authoritative guarantee, not an accident: no matter what the client, pacing, or future 24-mind scaling does, LLM spend has a ceiling.

## 1. Sidecar-authoritative budget (`scripts/luna-sidecar.ts`) — the real gate

- Counters: calls per rolling wall-hour and per calendar day, persisted to `<scratch>/budget.json` after every call (survives dev-server restarts; corrupt/missing file → start at current counts 0 but keep the day key).
- Limits: defaults **60/hour, 300/day**, overridable via env `LUNA_MAX_PER_HOUR` / `LUNA_MAX_PER_DAY` read at server start.
- Enforcement BEFORE spawning codex: over either limit → **HTTP 402** `{ error: 'budget', remainingHour: 0, remainingDay, resetsInSec }`. NO codex process is spawned on a 402 path — assert this structurally (the check is the first statement of the handler).
- `GET /api/luna/health` gains `{ budget: { usedHour, maxHour, usedDay, maxDay } }`.
- Every successful call logs `[luna-sidecar] decide <ms> chars=<n> budget=<usedHour>/<maxHour>h <usedDay>/<maxDay>d`.

## 2. Client behavior (`src/mind/`)

- On 402: record ONE `mind:budget` event (honest reason: "mind budget exhausted — running on instinct until HH:MM"), set a client-side cooldown until `resetsInSec` elapses (no further dispatch attempts — don't poll the sidecar), agent continues on UtilityBrain. Ticker row once (not per cadence).
- Wall-floor: regardless of pacing, never dispatch two sidecar requests for the same agent closer than **15 wall-seconds** apart (belt to the breathe-throttle's suspenders).
- **Timeout alignment** (P3-0b known gap): raise `MIND_WALL_TIMEOUT_MS` to 75 s so the service-level timeout never fires before a healthy ~30–60 s codex round-trip; the provider/sidecar timeouts remain the real deadline chain (60 s kill → 75 s client).
- `__simState.mind` gains `{ budgetUsedHour, budgetMaxHour, budgetUsedDay, budgetMaxDay, budgetCooldown: boolean }` (from health probe at boot + updated from each decide response's headers or a lightweight refresh after each decision).
- 🧠 chip shows remaining hourly budget (e.g. `🧠 12 · 47/60h`); amber styling while in budget cooldown.

## 3. Tests

- Sidecar unit-ish test (vitest, run the handler functions directly or via a tiny http harness — no codex spawns: inject a fake runner): 61st call within an hour → 402, no runner invocation; counters persist across a simulated restart (re-read budget.json); day rollover resets hourly+daily correctly.
- Client vitest (MockProvider + fake 402): budget event exactly once, cooldown respected, agent keeps living.
- E2e (mock): 🧠 chip renders budget numbers; forced-cooldown state (inject via bridge or dev hook) shows amber + instinct fallback.

## Gates

`npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; `utilityBrain.ts` untouched. Screenshot `artifacts/llm-budget.png` (chip with budget numbers). **Structural assert in report:** quote the sidecar handler's first lines showing budget-check-before-spawn.

## Final report

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

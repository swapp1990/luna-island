# Dispatch P3-1 — Memory & reflection: minds that remember their days

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read the current mind layer (P3-0..0c) first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. All CLAUDE.md invariants hold; MockProvider covers every test path (no codex spawns in gates); the budget/breathe machinery must keep working unchanged.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What this dispatch builds

Minds gain a past. Each luna agent accumulates (a) **episodic memories** derived deterministically from their own trace and (b) **nightly reflections** — one LLM call at bedtime producing up to 3 short first-person notes. Both feed the next day's decision prompts. Reflections follow the intent law: recorded once, replayed forever, never re-called. Also folded in: persona grounding fixes and provider auto-detection.

## 1. The recorded-note law (`src/sim/` — mirrors externalIntentLog)

- New serialized `mindNoteLog: Array<{ tick, agentId, notes: string[] }>` on world state (snapshots, saves, hash — same treatment as `externalIntentLog`). `postMindNotes(agentId, notes, meta)` queues; applied at the next `advanceTicks` step; appends event `mind:reflection { agentId, notes, provider, latencyMs }`.
- Replay/re-sim re-applies recorded notes at their recorded ticks (never consults a provider) — extend the existing external-intent replay path; hash-gated below.
- Save format: bump to **formatVersion 3** (v2 loads get an empty note log; keep the v1 path working too).

## 2. Memory model (`src/mind/memory.ts` — pure functions, app-side)

- `episodicMemories(agentId, events): MemoryLine[]` — deterministic salience filter over the agent's own trace: hires/vacates, collapses/recoveries, purchases, commissions/completions, relationship milestones, first occurrence of each action kind, wallet swings ≥ 10 coins (from wage/buy events). Each renders as a compact line with day/time: `D2 09:14 — hired at the farm (6/day)`. Keep the most recent 5 (plus always the agent's firsts).
- `reflectionMemories(agentId, mindNoteLog): MemoryLine[]` — last 3 reflection notes, newest first.
- `standingFacts(agent, world): string[]` — job, owned places, home, wallet — REAL world facts, one line each.
- All pure and rebuildable at any tick (works in replay: pass the fork's trace/log).

## 3. Nightly reflection (`src/mind/lunaBrain.ts`)

- Trigger: once per sim-day per luna agent, when their `sleep` action starts between 19:00–03:00 (or at 03:00 if they never slept). Uses the same sidecar/budget/breathe path as decisions (a reflection IS a budgeted call; the 🧠 chip counts it).
- Reflection prompt: persona + "Here are today's events for you:" (that day's trace lines for the agent, compact) + contract: reply ONLY `{"notes":["…","…"]}` — 1–3 notes, each ≤ 120 chars, first person, concrete ("I", facts from the day, intentions for tomorrow). Invalid → `mind:fallback` (reflection variant), retry next night.
- Result → `postMindNotes` (recorded law above).

## 4. Prompt integration (`src/mind/prompt.ts`)

- System prompt gains a GROUNDING rule: "Cite only facts present in your observation and memories. Never invent numbers, events, or possessions."
- User prompt gains, before the recent trace: `Standing facts:` lines, `Your memories:` (reflections then episodics, ≤ 8 lines total). Keep total prompt ≤ ~1500 tokens.

## 5. Personas (`src/mind/personas.ts`) — grounding fix (user-reported)

- RULE (add as a comment atop the file): personas describe TEMPERAMENT and ASPIRATION only — never world facts (ownership, job, wealth); facts come from observation/memories.
- Rewrite Mira accordingly: ambitious, warm, frugal, counts every coin, DREAMS of owning a home and someday running the market stall (no "proud homeowner" claim).
- Add two more minds for contrast: `agent-1` (Joss — easygoing, people-first, works to live, generous even when broke, loves the plaza) and `agent-11` (Wren — sharp, skeptical, self-reliant, distrusts crowds, wants independence and a full pantry). Update `LUNA_AGENT_IDS`.

## 6. Provider auto-detection fix

Plain URL (no `?brain=`) must auto-enable: codex when `/api/luna/health` responds, else mock (console note which). `?brain=codex|mock|off` still override. (Currently an explicit param is required — trace why and fix.)

## 7. UI

- Mind tab gains a **Memories** section: reflections (💭, newest first) then episodics (📌), compact rows; empty state "No memories yet — she'll reflect tonight."
- Ticker: `💭 Mira reflected on her day` row per reflection.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; run full suite with PLAYWRIGHT_PORT if 5175 busy); purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New vitest:
   - Note record/replay: post scripted notes → `stateAt`/fork re-sim hash-identical; save v3 round-trip; v2 and v1 loads still work.
   - Reflection scheduling: exactly one reflection per luna agent per sim-day over 3 mock days; budget counter increments accordingly.
   - Memory purity: `episodicMemories`/`reflectionMemories` deterministic given the same trace/log; prompt builder includes `Your memories:` with the expected lines after a mock reflection.
   - Personas contain no ownership/job/wealth assertions (simple regex guard test: /homeowner|I own|my house|my home(?!land)/i fails the personas file — tune the regex to the rule's spirit).
3. E2e (mock): run 2 sim-days → Mind tab shows ≥ 1 💭 reflection; a decision AFTER the reflection has a prompt containing `Your memories:` (assert via the last-exchange view); plain-URL boot (no param) auto-enables mock/codex per §6; `?brain=off` still clean. Screenshot `artifacts/memories.png` (Mind tab with Memories section populated).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

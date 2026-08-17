# Dispatch P3-11 — The action language: five replay-safe channels for what NPCs are doing

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants, `src/render/agents.ts` (existing juice: hats, tools, walk-bob, work-swing, collapse pulse, sleep squash), `src/render/fx.ts`, `src/render/overlays.ts` (speech bubbles, indicators), `src/loop.ts` (tick/alpha interpolation) first.

## Why (orchestrator's evidence)

The highlight still `03-agent-collapsed-D1-2206.png` shows Bram "collapsing" as a healthy upright peg — the sim knows, the pixels don't. Root causes: (1) no posture channel — collapse is only a red color pulse, sleep is a squash, examine/eat look like standing; (2) the pulse phase is wall-clock (`tSec`), so a replayed/photographed frame cannot reproduce what live play showed.

## The law (this is the architecture)

**Every indicator derives from `stateAt(tick)` + events in a trailing window — never from having watched the moment live.** Live play, timeline replay, and the photographer must render the same frame for the same (tick, alpha). Concretely: all animation phase comes from sim time (`tick + alpha`, or accumulated-distance for walk-bob which already qualifies) — wall-clock `tSec` phases are BANNED for state-driven juice (pure ambience like water shimmer may keep wall-time). Burst effects derive from events with `tick - event.tick <= WINDOW`, with particle layout seeded from `event.seq` (fixed patterns fine) — no unseeded randomness.

## 1. The registry (`src/render/actionLanguage.ts` — data-driven, unit-testable)

A pure descriptor module (no three.js imports — it returns plain descriptors; the renderer applies them):

- `describeAgent(agent, tick): { posture: PostureKind, glyph: GlyphKind | null, prop: PropKind | null }`
- `describeBursts(events, tick): Burst[]` — `{ agentId, kind, ageTicks, seq }`
- Declarative tables inside: action-kind → row. Unregistered kinds → `standing`, no glyph, no prop. Adding a new engine verb = adding a row.

## 2. Posture (the king channel — silhouette must change)

| State | Posture |
|---|---|
| collapsed | **fallen**: body rotated to the ground (lying flat, slight face-down tilt), hat off, keep a slow red tint pulse (tick-phase). This must read in a night thumbnail. |
| sleep | **lying** (replaces the 0.5× squash): flat on bed/ground, dimmed as today. Hat charm rule can stay if it still reads. |
| examine | **lean-in**: body tilted ~15–20° toward the examine target, head slightly lowered — "peering". |
| eat / drink | **sitting**: shortened body (kneel/sit read), prop in hand (see §4). |
| work | keep the existing swing, but re-phase to sim time. |
| walk / idle / socialize | as today (walk-bob already distance-driven — keep). |

Interpolate posture transitions over ~2–3 render frames so live play doesn't snap; the photographer's settled frame gets the final pose.

## 3. Glyph (one billboard above the head, priority ladder)

Canvas-sprite glyphs in the existing bubble/overlay idiom. Priority, highest wins, max ONE per agent:

1. ❗ collapsed (red-tinted)
2. Critical need (the existing need iconography if present, else 🍖 hunger / 💧 thirst / 😴 energy at critical threshold)
3. 🔍 examining (this is the discovery tell — future soaks get a visible curiosity signal)
4. 💤 sleeping
5. (none)

An active speech bubble SUPPRESSES the glyph for that agent (talk already has a channel — never show both). Glyph sprites update on state change, not per frame. Photo mode: subject keeps its glyph, non-subjects' glyphs hide with the other overlays.

## 4. Prop (extend the existing tool system, don't duplicate it)

Existing work tools/hats stay. Add: berry-in-hand while eating at a bush/table, mug while drinking at the well. Reuse the `setTool`/carry mesh pattern.

## 5. Ground FX (clutter-guarded)

- **Destination marker**: a small pulsing disc (tick-phase) on the agent's path target — ONLY for the currently selected agent (live) or the photo subject. Never for all 24.
- Existing work particles stay; re-phase to sim time if wall-clocked.

## 6. Burst FX (event-anchored, replay/photo-visible)

From `describeBursts` over events in the trailing window (~4 ticks): `agent:collapsed` → dust puff; `agent:recovered` → rising sparkle; `coins:transfer` → brief coin glint at the payer/payee midpoint; `discovery:examined` → small shimmer at the target. Fixed particle layouts parameterized by `event.seq`. Rendered via `fx.ts` idioms. ≤1 burst per agent at a time (latest wins). Because they're event-derived, a photographed tick within the window shows them — Bram's collapse still should get the puff.

## 7. Bridge probe (E2E, additive)

`window.__simState.actionLanguage` (DEV/e2e-safe like getJuiceCounts) or a `__simControl.describeAgentVisual(agentId)` helper returning the registry descriptor for an agent — so tests assert posture/glyph/prop without pixel-reading.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; `PLAYWRIGHT_PORT` if busy); purity grep of `src/sim/` empty; ZERO `src/sim/` edits; `utilityBrain.ts` SHA unchanged. `actionLanguage.ts` has no three.js/DOM imports (grep).
2. New vitest on the registry: collapsed → fallen+❗; sleep → lying+💤; examine → lean+🔍; eat → sitting+prop; unknown kind → standing/null; glyph priority ladder (collapsed beats critical beats examine); bubble suppression flag honored; burst derivation windows + seq-seeded determinism (same events+tick → same descriptors).
3. E2E (mock, seeded intents): collapse an agent → probe reports fallen+❗; examine → lean+🔍; sleeper → lying; destination marker only on selected agent (probe or DOM count).
4. **Wall-clock ban gate:** grep evidence that no state-driven juice path reads `performance.now`/`Date.now`/wall `tSec` for phase (list the remaining wall-time uses and justify each as pure ambience).
5. **The Bram gate:** re-run the photographer on `artifacts/soak-1786938450347-world.json`. Shot 03 (Bram collapse) must show a FALLEN villager (+ puff if in window); shot 07/02 examines show the lean; sleepers in night shots lie flat. Regenerate both contact sheets. Then run the photographer TWICE and diff the two manifests (must be identical) as the reproducibility check.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **THE REEL v5** (per-shot: what the action language added; contact sheet paths) / **DEVIATIONS** / **KNOWN GAPS**.

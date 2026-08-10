# Dispatch P3-0b — The world breathes with its minds (+ resource bar overlap)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Surgical fixes only — read the relevant code first. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## Bug (user-observed, live, with measured evidence)

Running 64× with Mira's codex mind: `decideCalls: 2137, decisions: 0, fallbacks: 3` over ~2.5 sim-days. Root causes:
1. Cadence is sim-time-gated (30 sim-min) → at 64× that's ~0.5 wall-seconds → request spam against a ~30s-per-answer sidecar (429 storm; `decideCalls` counted every attempt).
2. Completed answers arrive ~32 sim-hours after their observation at 64× → stale → fallback. Mind time is wall-bound; sim time isn't.

## Fix 1 — Auto-breathe (app-side, `src/loop.ts` + `src/mind/lunaBrain.ts`)

- When any luna decision goes in-flight: the loop THROTTLES the sim to 1× (remember the user's chosen speed). When the intent applies (or the request fails/times out): restore the user's speed. Pausing manually still wins (never auto-unpause a user pause; if the user changes speed mid-think, honor their new speed as the restore target).
- While throttled, the 🧠 chip pulses and shows `thinking…`; the speed buttons show the user's selected speed as active (their intent), not the temporary 1×.
- `decideCalls` counts only ACTUAL dispatched sidecar requests (429 "still thinking" re-checks and cadence skips don't count).
- Staleness guard stays as backstop: if an intent arrives > 45 sim-min after its `requestTick` (shouldn't happen with breathing), discard with a `mind:stale` event (reason honest), not a generic fallback.
- Replay/ffwd unaffected: `ffwd` never waits on minds; recorded intents replay as-is.

## Fix 2 — Resource bar overlap (`src/ui/ResourceBar.tsx` / HUD layout)

The chip row wraps onto the clock/speed HUD (user screenshot: storehouse-stone + codex chips overlap the controls). Fix: the top-left resource bar must reserve its own layout space — constrain width so it never intrudes on the centered HUD cluster; wrap to a second row BELOW with proper row-gap; the 🧠 chip joins the bar as a proper sibling chip. No absolute-position overlap at any viewport ≥ 1100px wide. Match existing chip styling.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` empty; `utilityBrain.ts` untouched.
2. New vitest (MockProvider with async 20-tick artificial delay): simulated 64× run over 2 sim-days → every completed decision APPLIES (0 stale discards), `decideCalls` < 20, throttle engages while pending and restores the chosen speed after.
3. E2e addition (mock provider): set 64×, run past a cadence point → `__simState.speed` drops to 1 while `mind.pending === 1`, returns to 64 after the decision applies; decision count increments; no fallbacks. Resource bar: assert no bounding-box overlap between the bar and the HUD controls at 1280×720 (both testids present — add `data-testid="hud-controls"` if missing).
4. Screenshot `artifacts/mind-pacing.png`: 🧠 chip in `thinking…` state with the bar laid out cleanly. Non-black, > 20 KB.

## Final report

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

# Luna Island

Emergent-civilization sim. three.js renderer + deterministic TypeScript sim core + (Phase 3) LLM agent brains. Roadmap: `plans/roadmap.md`.

## Quick start

```bash
npm install && npm run dev   # port 5175, host 127.0.0.1
```

## Architecture invariants — never break these

1. **`src/sim/` is pure TypeScript.** No three.js, React, or DOM imports. No `Math.random`, no `Date.now`, no `performance.now` — all randomness flows through the seeded RNG in `src/sim/rng.ts`, all time is the tick counter (1 tick = 1 sim minute, 1440/day).
2. **Determinism is a tested gate.** Same seed ⇒ identical state hash and event log after N days. `npm run check` fails if broken.
3. **Every agent action is traced.** Each intent/action/result appends a `SimEvent { seq, tick, type, agentId, data, reason }`. The `reason` string is the human-readable "why" — required on every `action:start`. UI reads the event trace; it never re-derives history.
4. **Time travel = snapshot + re-sim.** `stateAt(tick)` reconstructs any past moment from the nearest periodic snapshot plus deterministic re-simulation. Events are the *trace*, not the state authority.
5. **The Brain seam.** `Brain.decide(observation, rng) → Intent` is the one interface agent minds implement. `UtilityBrain` (Phase 1–2) and `LunaBrain` (Phase 3, LLM-backed) are drop-in swaps. Engine-side code must never care which brain produced an intent.
6. **Renderer is plain three.js** (no React Three Fiber, no drei). React renders HUD/panels only. The render loop interpolates between sim ticks; HUD state updates must never re-render the 3D scene.
7. **Scaffold, not script.** The engine codifies WORLD RULES only — the ground truth every mind must live within: needs physics, tile occupancy (one standing agent per tile), generic place interaction slots (using a place = standing on one of its free slot tiles), proximity gates (e.g. social recharge requires another agent within 1.5 tiles). It must NOT encode behavioral choreography: no matchmaking systems, queueing policies, per-place special cases, or social scripts. Behavior belongs to the Brain — and the UtilityBrain is kept deliberately simple because LunaBrain (the LLM) replaces it as the source of interesting behavior. Rule of thumb: a mechanic answering "what is possible?" is engine; one answering "what should I do?" is brain — keep the latter thin. When a fix is needed, prefer generalizing a world rule over adding a case.
8. **Window bridges are load-bearing for E2E** — keep shapes stable:
   - `window.__simState = { ready, mode: 'live'|'replay', day, hour, minute, tick, speed, agentCount, selectedAgentId, eventCount }`
   - `window.__simControl = { setSpeed(n), pause(), scrubTo(tick), goLive(), selectAgent(id|null) }`

## E2E testing

```bash
npx playwright install chromium   # first time only
npm run e2e
```

- Headless WebGL runs on the **real GPU** (`--use-angle=default` in playwright.config.ts). Never add swiftshader flags.
- Write time-based assertions in **sim ticks** (`__simState.tick`), never wall clock.
- The in-app preview pane doesn't fire rAF for heavy WebGL apps — verify with Playwright (headed for FPS claims).

## Delegation

Implementation is delegated to grok CLI engineers via specs in `specs/`. Main session owns git, product direction, and QA gates. Delegates never run git commands.

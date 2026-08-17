# Dispatch P3-10d — Stop fighting geometry: selection filters + hero fallbacks

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash only. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Final revision of the P3-10 series. Your own v3 diagnostics are the ground truth here — the orchestrator accepts them: 03 is unrescuable by azimuth (pair inside the house footprint), 12's site posts cannot out-hero an adjacent finished house, 07's stall steals any clear frame, 11's rescue fired on a shot that SE already had.

## The three changes (different levers than v3 — no more azimuth-check tuning)

1. **SE keeps the shot unless strictly beaten** (`src/render/scene.ts`): compute the visibility score for SE first; a rescue candidate is only taken if its score is STRICTLY greater. Equal or lower → SE, always. This must restore shot 11 to its v2 SE framing byte-for-byte-comparable (default azimuth in the manifest).
2. **Selection-level photogenicity filter** (`src/replay/highlights.ts` — keep it pure): a candidate moment is skipped (the selector moves to the next by priority/day-spread) when its subjects are not photographable at that tick: for `relationship:close` and `mind:say`, skip if ANY subject agent stands on a building-footprint tile (indoors/against a mesh) at the moment's tick. Needs the world state at tick — if the pure module can't reach it, do the filter in the photographer via a bridge probe (`__simControl`-side helper is fine, additive), but keep the decision deterministic and tested either way. Shot 03 must be replaced by the next eligible close-relationship moment (there are 33 friendship events; find one outdoors).
3. **Hero fallback chain** (`scripts/soak-highlights.mjs` + photo opts): for place-hero shot types (`construction:*`, `discovery:examined`, `ownership:transfer`): try place-hero; if the final pose (after rescue) still fails the visibility check, re-shoot the SAME moment as **agent-hero** (the acting agent framed as protagonist, place in context behind/beside). Record `hero: 'place' | 'agent'` in the manifest. Shots 07 and 12 are expected to become agent-hero; shot 10, which passes as place-hero, must stay place-hero.

## Gates

1. `npm run build` exit 0; `npm run test` all pass (new/updated vitest for the photogenicity filter's determinism); `e2e/photo.spec.ts --retries=0` passes; zero NEW `src/sim/` changes; `utilityBrain.ts` SHA unchanged.
2. Re-shoot `artifacts/soak-1786938450347-world.json`, zero LLM calls, sheets + manifest regenerated. Report the 12-row table: moment (note if swapped), azimuth, hero, verdict. Required outcomes: 01/02/04/05/06/08/09/10 unchanged defaults; 11 back to default SE; 03 REPLACED by an outdoor moment that passes; 07/12 pass as agent-hero (or place-hero if that now passes honestly).
3. If any row still fails, name the geometry and stop — do not tune the azimuth checks again.

## Final report

**CHANGED** / **GATES** / **REEL v4 TABLE** / **KNOWN GAPS**.

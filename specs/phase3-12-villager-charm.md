# Dispatch P3-12 — Villager charm: faces, arms, wool for sheep-minds, scarves for Luna minds

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `src/render/agents.ts` (body/head/hats/tools/postures — you are extending the P3-11 posture system, not fighting it), `src/render/actionLanguage.ts`, `src/mind/personas.ts` (`LUNA_AGENT_IDS`, persona colors if any), `src/render/overlays.ts` (🧠 bubble prefix precedent) first.

## Why

The photographer now shoots hero close-ups — villagers occupy 1/4 of the frame and they're featureless pegs. Two asks from the user: (1) villagers should be cuter and more human-like; (2) the sheep-minded (UtilityBrain) villagers should look different from the six Luna minds.

## Design (locked — implement this, not an alternative)

All render-side. ZERO `src/sim/` changes. The mind/sheep split keys off `LUNA_AGENT_IDS` (render already imports mind ids for bubbles — same seam).

1. **Faces (everyone).** Two dot eyes (small dark meshes, shared geometry) on the head's facing side, riding the existing yaw so villagers visibly look where they walk/work/examine. Blink: brief eyelid-scale squeeze on a tick-derived phase, desynced per agent by their existing phase offset — wall-clock BANNED. Eyes must read at photo hero distance AND not turn to noise at overview zoom (tune size accordingly, ~0.03–0.045 r).
2. **Arms (everyone).** Two stubby capsule/cylinder arms at the body sides, same material as body. They participate in the posture channel:
   - walk: swing opposite the walk-bob phase (subtle, ±20° max)
   - work: both raised with the swing apex (tool stays in hand as today)
   - eat/drink: one arm raised holding the berry/mug (prop moves to the hand, or hand moves to the prop — whichever is the smaller diff)
   - sleep: tucked along the body
   - fallen: splayed outward — the silhouette of collapse gets stronger
   - examine lean: one arm slightly forward ("reaching to touch")
3. **Sheep-minds (18 UtilityBrain villagers): wool.** A cap of 3–5 small overlapping cream/off-white spheres — a soft woolly hairdo. Charming, not mocking. Wool hides under job hats (hat replaces wool while worn, or wool scales down — pick what looks right).
4. **Luna minds (6): hair + scarf.** Neat low-poly hair (a slightly flattened colored cap) plus a thin scarf torus/box at the neck, both in a per-persona accent color derived deterministically from the agent id (a small fixed palette table is fine — 6 distinct hues that read against body tints, day and night). Slightly larger eyes (~15%) than sheep-minds.
5. **Proportions.** Nudge toward chibi if it helps charm (head up to ~+10%, body slightly narrower at top) but do NOT break: tile occupancy visuals, HAT_Y stacking, glyph height, posture transforms, or existing e2e juice counts. If a nudge risks those, skip it — faces/arms/wool/scarves carry the feature.
6. **Perf + determinism.** Shared geometries/materials wherever color allows (eyes, wool, arms). No unseeded randomness: any per-agent variation derives from agent id/phase. Dispose everything via the existing `track` pattern.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; `PLAYWRIGHT_PORT` if busy); purity grep of `src/sim/` empty; ZERO `src/sim/` edits; `utilityBrain.ts` SHA unchanged; wall-clock ban holds in `agents.ts` (grep evidence).
2. Probe: extend `describeAgentVisual` (or juice counts) so e2e can assert `variant: 'mind' | 'sheep'` per agent, and that exactly 6 are minds.
3. E2E (mock): a sheep agent probe reports wool/sheep variant, a Luna agent reports mind variant; blink/arm code paths don't crash a 200-tick fast-forward; posture e2e from P3-11 still green (fallen/lying/lean intact with arms).
4. **Portrait gate (the aesthetic proof):** using photo mode, produce a 2×2 portrait sheet `artifacts/portraits/portraits.png`: one Luna mind close-up (day), one sheep villager close-up (day), same pair at night — subject filling ~1/3 frame height. Eyes, wool, scarf must be clearly legible in all four. Self-critique each portrait.
5. **Reel v6:** re-run the photographer on `artifacts/soak-1786938450347-world.json`; regenerate both contact sheets. Faces/arms must not break any P3-11 posture still (Bram still reads fallen — arms splayed now; Tama still leans with 🔍).

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **PORTRAITS + REEL v6** (paths + per-shot critique) / **DEVIATIONS** / **KNOWN GAPS**.

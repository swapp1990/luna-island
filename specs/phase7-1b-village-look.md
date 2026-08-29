# Dispatch P7-1b — The village look: make `/town` read as the game we're referencing

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

Narration mandatory, one line per long step. 3 failed attempts on one item → STOP and report.

**Files you MAY edit:** `src/town/**`, `test/town-*.test.ts`.
**Do NOT touch:** everything else — `src/sim/**`, `src/render/**`, `src/ui/**`, `src/mind/**`,
`src/god/**`, `src/replay/**`, app entrances, configs, `e2e/**`, `art/**`, `plans/`, other `specs/`.

A dev server runs on 5175 (orchestrator's) — browse read-only. Playwright on `PLAYWRIGHT_PORT=5188`.

## Context

P7-1a landed: `/town` renders the live sim (seed 42, 24 agents, 30 places) with the manor-slice
GLB pipeline working — `assets: loaded 13, fallback 17, failed 0`, 60 fps. Product direction
reviewed the first screenshot and rejected the LOOK: white buildings, interpenetrating houses,
void-dark ground. The verdict, verbatim: *"visually it looks nothing like the game we are
referencing."* The reference is Manor Lords via the manor-slice style bible.

Since that screenshot, the orchestrator re-exported every asset **with real albedo colors**
(procedural shaders flattened to the style-bible palette) and added **three single trees**. In
`art/manor-slice/export/gltf/`: `fv_burgage_l1.glb`, `fv_burgage_l2.glb`, `fv_church_wooden.glb`,
`fv_granary_barn.glb`, `fv_market_stall_{a,b,c}.glb`, `fv_well_stone.glb`,
`fv_tree_{a,b,c}.glb`, plus the loader fixture. `src/town/manifest.ts` already points at the
real building files — do not rename them.

**Your one goal: a screenshot of `/town` that a person puts next to
`art/manor-slice/renders/ph6c_village.png` and accepts as the same game in early greybox-to-art
transition.** Read that render before you start; it is the target. Also read
`plans/colony-builder.md` (the plot) and `specs/manor-slice-assets.md` (the style bible —
palette hexes, lighting: low warm sun ~25°, cool blue-gray fill, pale desaturated sky, haze).

Work the items in order.

## V1 — Buildings must not interpenetrate, and must sit like a village

- **Footprint fit:** scale each GLB instance so its XZ bounds fit the place's sim footprint in
  metres (uniform scale, fit the larger dimension; cap upscaling at 1.0 so small assets like the
  well don't balloon). Measure each cached asset's bounds once at load.
- **Facing:** buildings face somewhere sensible, not all the same way. Rule: face the nearest
  plaza/wear-path tile if one is adjacent within a few tiles; otherwise a deterministic yaw from
  a hash of the place id (0/90/180/270). Deterministic — same world, same look, every reload.
- **Ground contact:** every instance sits on the terrain surface (V3 adds relief — anchor to the
  sampled terrain height at footprint centre), no floating, no burial beyond a few cm.

## V2 — Trees. The island is mostly empty and the reference is half forest.

- Forest tiles get trees: 1–3 instances per forest tile, variant + position jitter + yaw + slight
  scale jitter all from a deterministic per-tile hash. Use the three tree GLBs.
- Use `InstancedMesh` per variant-mesh (merge each GLB's meshes or instance per-submesh — your
  call, but the perf gate is real: this is potentially thousands of draws done naively).
- Trees never spawn on places, wear paths, or within 1 tile of a building footprint.

## V3 — Ground that reads as land, not void

- Per-tile albedo from the style bible: grass `#7A8F4A` (with `#9AA05A` dry patches), forest
  floor darker `#4A5F35`-adjacent, sand `#B5A488`-ish beach, rock `#8C8578`, water a believable
  cool blue-green — NOT the current near-black. Deterministic per-tile variation so fields
  aren't flat vinyl.
- Subtle micro-relief: vertical-only deterministic noise (±0.15 m, zero at water edge) on the
  terrain mesh so light rakes across something. Agents and buildings sample the same height
  function — one source of truth in one module. The sim's flat tile model is untouched; this is
  presentation-layer relief only.
- A visible beach transition ring at the waterline; water slightly below ground level.

## V4 — Roads appear where people actually walk (this is the "alive" part)

- The sim tracks wear (P5-1 wear paths — find the data on `WorldState`/tiles; read
  `src/render/terrain.ts` reference-only to see how the old shell read it).
- Render wear as dirt-road blending into the grass albedo (`#B5A488` dry → `#6E5B44` worn),
  strength from the wear value, updating as the sim runs — the village visibly treads its own
  paths over days.
- Plus a modest baseline: plaza + tiles immediately around the well read as packed dirt from
  boot so the centre doesn't look abandoned before wear accumulates.

## V5 — Staged construction: the town visibly builds itself

The sim already grows organically (villagers commission homes/upgrades; construction sites have
progress). Today a site renders as a half-height grey box. Replace with three visual stages by
progress fraction (read the exact progress field from the sim's construction site data):

1. **< ~35%** — cleared dirt pad (albedo `#6E5B44`) + a couple of material piles (small timber
   /stone boxes in palette colors).
2. **~35–75%** — a timber FRAME: generated posts + beams + rafters primitives in oak `#4A3826`
   sized to the footprint. Not a box — it must read as a building skeleton.
3. **> ~75%** — the finished GLB rising: render the final asset clipped/scaled vertically with
   progress (a simple clipping plane or scale-Y both acceptable; pick what looks less silly and
   say so).
4. On completion, the finished building (V1 rules) with a one-shot dust puff or similar cheap
   flourish so completions are noticeable.

Add to `__townControl`: `ffwd(nTicks: number)` — synchronously step the sim N ticks (chunked so
the tab doesn't freeze; cap a single call at ~20k ticks) so construction can be verified without
waiting real hours. Add `listConstruction(): Array<{ id, kind, progress, stage }>`.

**Verify organic growth end-to-end:** ffwd several sim-days, confirm at least one construction
site progresses through stages (screenshots of each stage) — if the default world commissions
nothing in that window, say so honestly and demonstrate the stages by finding whatever site
exists at boot (there are construction sites in the default world) or the earliest one that
appears.

## V6 — Light it like the reference

Re-tune from the neutral greybox rig toward the style bible: **low warm sun (~25° elevation,
slightly orange-white), long soft shadows, cool blue-gray sky fill, pale desaturated blue sky,
horizon haze**. Keep ACES + GTAO + PCF machinery; retune values. The bible's render
`ph6c_village.png` is the color target — sample it.

- **Day/night, subtle:** drive sun elevation/azimuth/color and sky/fog from sim time-of-day
  (reference-only: `src/render/daynight.ts`). Daytime lives near the bible look; dawn/dusk get
  the warm swing; night is darkened but ALWAYS readable (ambient floor — never the void). Smooth,
  no popping. Shadow-map refit as the sun moves.
- Add `__townControl.setTimeOfDay(hourFloat | null)` — debug override for screenshots, null
  returns to sim time.
- Keep the QA method: ref spheres still toggleable; no crushed near-blacks (backlit building
  faces ≥ ~35 luma in day shots), no blown whites (≤ ~230), neutrality NOT required any more —
  the bible's warmth is the target now.

## V7 — HUD stays out of the way

No new HUD features (legibility layer is the next dispatch). Only: the top strip gains a date
readout including season placeholder ("Day 12") and keeps fps. Nothing else.

## Bridges (extend, never break)

Existing `__townState` / `__townControl` shapes stay. Add: `state.constructionCount`,
`state.treeCount`, `control.ffwd(n)`, `control.listConstruction()`, `control.setTimeOfDay(h|null)`.

## Unit tests (extend `test/town-*.test.ts`)

1. Footprint-fit math: bounds + footprint → scale (cap at 1.0), deterministic facing hash.
2. Terrain relief: height function deterministic, zero at water tiles, |Δ| ≤ 0.15 m.
3. Tree placement: per-tile hash → variants/jitter deterministic; exclusion near buildings.
4. Construction staging: progress → stage mapping incl. boundaries.
5. Day/night: sim tick → sun params continuous (no jump across midnight), night floor ≥ minimum.

## Gates

1. `npm run check` exit 0 (the vitest `onTaskUpdate` teardown flake: rerun tests alone, paste).
2. `PLAYWRIGHT_PORT=5188 npx playwright test --workers=1` all green, `e2e/**` untouched.
3. Import-boundary greps (same as P7-1a) → empty. `src/sim/**` untouched.
4. **The look, honestly judged.** Screenshots at 1280×720, pasted paths + your honest read:
   - overview (dist ~60) at midday — against `ph6c_village.png`: name what matches and what
     still doesn't; **do not claim parity you don't see**
   - street-ish (dist 18–22) near the plaza/well
   - a construction site at each of the three stages
   - dusk and night (readability check)
   - the forest edge showing instanced trees
5. Perf: `fpsProbe(5000)` ≥ 55 avg at the overview pose with trees + roads + day/night on.
   Report tree instance count and draw calls (`renderer.info.render.calls`).
6. Zero page errors; `assets.failed === 0`; buildings no longer interpenetrate (state how you
   verified — e.g. pairwise footprint-scaled bounds overlap check via `listPlaces()`).
7. No git. No subagents. No LLM calls. No soak.

## Final report (exact structure)

**BUILT** (per V1–V7: what, and the numbers chosen — scales, noise amplitude, sun curve, stage
thresholds) / **LOOK** (gate-4 screenshots with your honest per-shot read vs the reference) /
**GROWTH** (what ffwd showed: which site, which stages, over how many sim-days) / **GATES** /
**PERF** / **DEVIATIONS** / **KNOWN GAPS**.

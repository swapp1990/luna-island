# Dispatch P7-1a — The town skeleton: `/town` walking skeleton + glTF asset pipeline

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang
and killed. 3 failed attempts on one item → STOP and report.

**Files you MAY create/edit — nothing else:**
- `src/town/**` (all new; this is the build)
- `test/town-*.test.ts` (new unit tests)
- `art/manor-slice/export/gltf/fixture-cube.gltf` (ONE hand-written test fixture, see §D)

**Already scaffolded for you — do NOT edit:** `town.html` (loads `/src/town/main.tsx`),
`vite.config.ts` (`/town` route rewrite; `/assets/gltf/*` serves
`art/manor-slice/export/gltf/*` in dev; `town` build input).

**Do NOT touch:** `src/sim/**`, `src/render/**`, `src/ui/**`, `src/mind/**`, `src/replay/**`,
`src/god/**`, `src/App.tsx`, `src/main.tsx`, `src/loop.ts`, `src/bridge.ts`, `index.html`,
`god.html`, `package.json`, `e2e/**`, `README.md`, `CLAUDE.md`, `plans/`, other `specs/`,
`art/**` (except the one fixture above).

**A dev server is already running on port 5175 (orchestrator's).** Browse it read-only for manual
checks. For Playwright, use `PLAYWRIGHT_PORT=5188` so you never fight over 5175.

## Read before writing

1. `plans/colony-builder.md` — THE PLOT. This dispatch is Phase 1's first slice: the walking
   skeleton plus the asset pipeline seam. The legibility layer (icons, cards, alerts, overlays)
   is explicitly the NEXT dispatch — do not start it.
2. `src/sim/worldgen.ts` — `generateWorld(seed, preset)` and `resolveWorldPreset`.
3. `src/sim/sim.ts` — the `Simulation` class surface: construction, stepping, agents, places.
4. `src/god/camera.ts`, `src/god/feel.ts`, `src/god/lighting.ts`, `src/god/constants.ts` — the
   parked god experiment. You will **copy-and-adapt** (never import) its strategy camera, its
   pure feel helpers, its lighting rig structure, and `TILE_METRES = 3`.
5. Reference-only (never import): `src/render/terrain.ts` + `src/render/agents.ts` (how the old
   shell reads WorldState), `src/loop.ts` (stepping semantics: tick cadence, speed, pause).

## Import boundary — a gate, not a convention

`src/town/**` may import ONLY from: `src/sim/**` (that is the point — same world, new shell),
`three` (+ `three/examples/jsm/**`), `react`, `react-dom`. It must NOT import from `src/render`,
`src/ui`, `src/mind`, `src/replay`, `src/god`, `src/loop`, `src/bridge`, `src/App`,
`src/persistStore`. Nothing outside `src/town/` may import from `src/town/`. You will prove both
with greps in the report.

Renderer is plain three.js. React renders HUD only (invariant 6). HUD state must never re-render
the 3D scene.

## What this is

The colony builder's walking skeleton: the **existing simulated world** (same
`generateWorld` the main app uses), rendered in a brand-new shell at `/town`, under the salvaged
strategy camera and lighting rig, at **3 m per tile** — with a working glTF asset pipeline that
will receive the manor-slice building kit (a parallel track is exporting it from Blender right
now; you build the seam and prove it with a fixture).

Not in this dispatch: selection, tooltips, icons, alerts, zones, placement, saving, day/night
cycling, minds. Skeleton only, done well.

## A. Boot and loop

- `src/town/main.tsx`: React root into `#town-root` (HUD), plain three.js canvas behind it.
- Fresh world every load: `generateWorld(TOWN_SEED, <the same default preset the main app boots
  with — read `src/App.tsx` to find it and say what it is>)`. `TOWN_SEED` a named constant.
- Own thin loop in `src/town/loop.ts` (do not import the app's): 1 tick = 1 sim minute; speed
  0 (pause) / 1× / 2× / 4× where 1× advances ticks at the same real-time cadence the main app
  uses (read `src/loop.ts` for the number and match it); accumulator capped so a tab-out doesn't
  fast-forward; render loop interpolates agent positions between ticks (alpha), never steps the
  sim mid-frame.
- UtilityBrain only (whatever `Simulation` does by default). No mind wiring.

## B. Camera + lighting (salvage)

- Copy the god strategy camera and its pure helpers into `src/town/` (adapt, don't import):
  constrained pitch band, damped, framerate-independent, no OrbitControls. Right-drag orbit,
  middle-drag + WASD pan, wheel zoom. Left mouse is RESERVED (selection comes next dispatch) —
  it must never move the camera.
- Bounds: pan limited to the island + margin; distance band sized to the sim island's actual
  extent in metres (island tiles × 3 — read the worldgen dimensions and report the numbers you
  chose for min/max dist).
- Copy the lighting rig structure: ACES + exposure, GTAO, PCF shadow-fitted sun, sky + fog, the
  ref-sphere calibration rig behind a debug toggle. Re-fit shadow camera and GTAO radius to this
  island's size. Start from the god rig's post-P6-1c neutral values; a later pass re-tunes
  against manor-slice albedos — do NOT chase final art here, but the skeleton must not regress
  the QA'd look (no crushed shadow-facing surfaces, no khaki cast, no visible sea edge if the
  world has water at its rim).

## C. World rendering (3 m per tile)

- `TILE_METRES = 3`. Every WorldState position maps ×3 into the scene. All sizes in metres.
- Terrain: one mesh built from the sim's tiles — flat-shaded colour per tile kind (grass /
  sand / water / soil / rock — read the actual tile kinds from `src/sim`), gentle and neutral
  under the rig. Water as a distinct surface. This is NOT final art; it must simply read
  cleanly and not fight the lighting.
- Places: every place in the world renders. Resolution order per place kind (+ level where the
  sim has levels): (1) glTF asset from the manifest (§D) when its file exists, (2) otherwise a
  placeholder box with the CORRECT footprint (sim footprint tiles × 3 m) and a plausible height,
  in the neutral grey family. Construction sites render as a half-height placeholder — staged
  construction art is a later dispatch.
- Agents: capsules with tick-interpolated movement (alpha from the loop). No labels, no icons.

## D. The glTF asset pipeline — the second half of this dispatch

`src/town/assets.ts`:

- A **manifest**: `Record<assetKey, { file: string; yawDeg?: number; scale?: number }>` where
  `assetKey` is derived from place kind (+ level). URLs resolve as `/assets/gltf/<file>`.
- Loader: three's `GLTFLoader`. Load each distinct file once, cache, `clone()` per instance.
  Anchor: asset origin sits at the place's tile-footprint centre on the terrain.
- **Graceful degradation is the contract:** a manifest entry whose file 404s falls back to the
  placeholder box with ONE `console.warn` per file (not per instance), and counts in
  `__townState.assets.fallback`. The town must boot perfectly with an empty export directory.
- Pre-write manifest entries for the expected manor-slice exports so they light up as files
  land — the export track is producing per-asset glTFs named like the Blender collections
  (`fv_bldg_burgage_l1.gltf`, `fv_bldg_burgage_l2.gltf`, `fv_bldg_church.gltf`,
  `fv_bldg_granary.gltf`, `fv_bldg_stall_a.gltf`, `fv_bldg_well.gltf` — treat names as
  provisional; structure the manifest so renaming is a one-line change per asset).
- **Fixture:** hand-write a minimal VALID glTF 2.0 (one cube, embedded base64 buffer, one
  material) at `art/manor-slice/export/gltf/fixture-cube.gltf`. Map exactly one real place kind
  to it and verify in the browser that the cube renders at that place's location and footprint
  — this proves URL → loader → cache → clone → anchor end-to-end before real art exists.
  Note in the manifest that the fixture mapping is temporary.

## E. HUD (skeleton only)

One small top strip, React: `Day D HH:MM`, speed buttons (⏸ / 1× / 2× / 4×) wired to the loop,
and an FPS readout. Nothing else. Style: quiet, dark, unobtrusive — this is scaffolding for the
next dispatch's legibility layer, not a design statement.

## F. Debug bridges — contract, exact shapes

DEV-gated (`import.meta.env.DEV`):

```ts
window.__townState = {
  ready: boolean,            // true after world gen + first rendered frame
  day: number, hour: number, minute: number, tick: number,
  speed: number,             // 0 | 1 | 2 | 4
  agentCount: number,
  placeCount: number,
  assets: { loaded: number, fallback: number, failed: number },
  camera: { yaw: number, pitch: number, dist: number, tx: number, tz: number },
  fps: number,
}
window.__townControl = {
  setSpeed(n: 0 | 1 | 2 | 4): void,
  setCamera(o: { yaw?: number; pitch?: number; dist?: number; tx?: number; tz?: number }): void,
  listPlaces(): Array<{ id: string; kind: string; level?: number; x: number; z: number; asset: 'gltf' | 'placeholder' }>,
  showRefSpheres(on: boolean): void,
  fpsProbe(ms: number): Promise<{ avg: number; min: number; frames: number }>,
}
```

`setCamera` snaps and flushes state immediately (the god pattern) so Playwright is never a frame
behind; player input stays damped.

## G. Unit tests (`test/town-*.test.ts`, node env, no three.js)

Structure the pure logic so these import nothing heavy:
1. Manifest resolution: kind(+level) → entry; unknown kind → placeholder decision; the
   fallback-on-missing decision path.
2. Tile→world transform: tile (x, z) and footprint → metres, both directions, ×3 exactly.
3. Loop math: speed 0/1/2/4 tick scheduling, accumulator cap, interpolation alpha in [0, 1].

## Gates

1. `npm run check` exit 0 (strict tsc, `vite build` — all three entries — and vitest; the known
   `onTaskUpdate` teardown flake after a green 388+ run: rerun tests alone and paste the pass
   line if you hit it).
2. `PLAYWRIGHT_PORT=5188 npx playwright test --workers=1` — ALL existing suites green (main app
   AND the frozen god specs). You changed none of their surfaces; this is a regression gate.
   Do NOT write or edit anything in `e2e/**`.
3. Import-boundary greps, pasted:
   - `grep -rnE "from '\.\./(render|ui|mind|replay|god|loop|bridge|App|persistStore)" src/town/` → empty
   - `grep -rn "town/" src/ --include=*.ts --include=*.tsx | grep -v "^src/town/"` → empty
   - `git status --porcelain -- src/sim` → empty
4. Manual `/town` verification on the running 5175 server, each confirmed explicitly with a
   number from the bridge: world renders (terrain + places + agents); tick/day advances at 1×
   and stops at 0; speed 4× is visibly faster; camera orbits/pans/zooms inside its clamps and
   left-drag does nothing; the fixture cube renders at its mapped place (`assets.loaded ≥ 1`);
   every other place is a clean placeholder (`assets.fallback` counted, zero uncaught errors).
5. Perf: `fpsProbe(5000)` at 1280×720 on the default world ≥ 55 fps avg. Report agentCount and
   placeCount alongside.
6. Do NOT run any `git` command. Do NOT run a soak. Do NOT call any LLM. Do NOT spawn subagents.

## Final report (exact structure)

**BUILT** — file-by-file; the preset + seed you boot; camera/lighting numbers you chose (dist
band, shadow fit, GTAO radius) / **PIPELINE** — manifest shape, fixture proof (numbers from
`__townState.assets`), what happens when real exports land / **GATES** — 1–5 with evidence
pasted / **PERF** / **DEVIATIONS** / **KNOWN GAPS**.

# Dispatch P6-1 — The Hand: a god's grab, carry and throw, in greybox

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang
and killed. 3 failed attempts on a single gate → STOP and report.

**Files you MAY create/edit — nothing else:**

- `src/god/**` (all new; this is the whole build)
- `test/god-*.test.ts` (new unit tests)

**Files already prepared for you — do NOT edit:** `god.html` (entry, loads `/src/god/main.ts`),
`vite.config.ts` (multi-page build + `/god` dev-route rewrite), `package.json`
(`@dimforge/rapier3d-compat@^0.20` is installed).

**Do NOT touch, read-for-inspiration-only:** `src/sim/**`, `src/render/**`, `src/ui/**`,
`src/mind/**`, `src/replay/**`, `src/App.tsx`, `src/main.tsx`, `index.html`, `README.md`,
`CLAUDE.md`, `plans/`, other `specs/`, `e2e/`. You may READ `src/render/scene.ts`,
`src/render/terrain.ts` and `src/render/daynight.ts` to see how this project sets up three.js —
but **copy nothing by import**. Zero shared code.

Read `specs/phase6-god-game-greybox.md` first (the parent plan). You are building **Phase 1
only**. Everything in its "Phase 2"/"Phase 3" sections is out of scope and must not appear.

---

## What this is

Black & White's hand, alone, on a grey island. One interaction — reach in, grab a rock, hurl it —
made to feel good with nothing competing for attention. The whole phase answers: *is this
satisfying by itself?* If a person will not throw rocks for three minutes unprompted, nothing
downstream is worth building.

**The god game shares nothing with the existing simulation.** No `src/sim/` state, no events, no
determinism obligations this phase — the thrown props are cosmetic render-layer objects with no
world authority (that is a hard rule from the parent spec, and in Phase 1 nothing is committed to
a world model at all). Correspondingly: `src/sim/**` must end this dispatch **byte-identical**.

**Greybox means greybox.** Untextured primitives, one grey palette, no models, no textures. The
*only* visual craft permitted is lighting and post — that is deliberate, and it is one of the
deliverables (see §E).

---

## Direction already decided — do not re-litigate

These answer the parent spec's open questions. They are settled; implement them.

1. **Camera: constrained strategy camera.** Not free orbit. Pitch clamped to a narrow band, yaw
   rotatable, pan bounded to the island, zoom clamped. Rationale: later assets only ever have to
   read from a fixed elevation band.
2. **Hand depth: ground-projected + wheel lift.** The mouse raycasts terrain; the hand rides above
   that point. Scroll while carrying raises/lowers the hand. No screen-space depth plane, no depth
   ambiguity.
3. **Island: authored, inside `src/god/`.** A small hand-tuned deterministic heightfield sized for
   a ten-minute arc. Do NOT import or reuse the sim's island generation.
4. **Physics: rapier** (`@dimforge/rapier3d-compat`, already installed). Do not build a cannon-es
   variant. Instead you must *measure* rapier (§G) so the choice is evidence-backed.
5. **Scale: 1 tile = 3 metres.** Write it down as an exported constant with a comment; every
   visual decision downstream depends on it. The island is authored in tiles, rendered in metres.

---

## A. Module layout

Vanilla TypeScript + three.js. **No React** in `src/god/` — the phase permits no UI beyond a
cursor, so a React tree would be dead weight. Suggested files (deviate if you have a better
split, and say so in the report):

```
src/god/
  main.ts          entry: boot, canvas, resize, rAF loop, teardown
  constants.ts     TILE_METRES = 3, island size, camera limits, prop mass table
  island.ts        authored heightfield → three geometry + rapier heightfield collider
  lighting.ts      THE LOCKED LOOK: sky, sun, exposure, tone mapping, fog, AO, shadows
  camera.ts        constrained strategy camera (damped)
  hand.ts          ground-projected hand, hover, grab/carry/throw
  props.ts         grabbable prop set: meshes + rapier bodies + mass
  physics.ts       rapier world init/step, mesh↔body sync, fixed timestep
  impact.ts        impact response: dust, scatter, knock-over, terrain dent decal
  debug.ts         DEV-gated window bridges (§F) + stress spawner + fps probe
```

`main.ts` owns the frame loop and nothing else of substance. Everything is a
`createX(): XHandle` factory returning an explicit handle interface with an `update(dt)` and a
`dispose()` — match the house style you see in `src/render/*.ts` (read it; don't import it).

**Import boundary is a gate.** No file in `src/god/` may import from `../sim`, `../render`,
`../ui`, `../mind`, `../replay`, `../loop`, `../bridge`, `../App`, or React. Nothing outside
`src/god/` may import from `src/god/`. You will prove this with a grep in your report.

---

## B. The island

Authored, deterministic, ~90 m across (30 tiles × 3 m) — big enough to feel like a place, small
enough that everything is within a throw or two.

- Heightfield from a small hand-written composition of primitives: a domed base, two distinct
  hills of different heights, one flat meadow/plateau where props gather and cairns can be
  knocked over, and a beach ring falling into water. Use a fixed local PRNG (seeded, own
  implementation in `src/god/` — do NOT import `src/sim/rng.ts`) for the fine jitter so the island
  is the same every reload.
- Rendered as a single indexed `BufferGeometry` with flat-ish shading, one grey `MeshStandardMaterial`
  (roughness tuned in `lighting.ts`). No texture, no vertex colour beyond a subtle
  height/slope-driven grey variation if it helps readability — greys only.
- A calm sea: a large plane at y=0 with a plain grey-blue material. Props thrown into it should
  splash (dust-equivalent: a ring ripple + spray particles) and then sink/despawn after ~2 s.
  **Throwing a boulder into the sea is the single most likely thing a playtester does first — make
  it feel like a reward.**
- Rapier collider: a `heightfield` collider from the same height data (single source of truth —
  render geometry and collider must be generated from one function, not two).

## C. The camera (constrained strategy camera)

- Perspective, fov ~45°. Orbit around a ground target.
- **Pitch clamped 35°–62°.** **Yaw free 360°.** **Distance 15 m–80 m.** Target pan bounded to the
  island footprint + 15 m margin.
- Bindings: right-drag = orbit (yaw + pitch within clamp). Middle-drag **and** WASD/arrows = pan on
  the ground plane, pan speed scaled by distance. Wheel = zoom (see §D for the carrying case).
  Left mouse belongs to the hand and must never move the camera.
- **Smooth damping, no snapping** — critically-damped exponential smoothing toward target
  yaw/pitch/dist/target, framerate-independent (`1 - exp(-k*dt)`, not a raw lerp constant).
- Do NOT use `OrbitControls`. Write the controller — the clamps and the left-button reservation are
  the whole point and fighting OrbitControls' bindings costs more than writing it.

## D. The hand — this is the phase

The one thing that must feel good. Budget your time accordingly: the hand and its feedback deserve
more iteration than everything else combined.

**Representation.** The mouse is hidden (`cursor: none` on the canvas) and replaced by a world-space
greybox hand: a simple open palm — a rounded plate plus three stubby digits, primitives only, one
grey. It hovers `HAND_HOVER_HEIGHT` above the terrain point under the cursor, tilting slightly to
follow terrain normal. It is *always* visible and always the cursor.

**Depth legibility** (the reason ground-projection was chosen — do not skip this):
- A ring decal on the terrain directly under the hand, always.
- A thin vertical stalk from that ring up to the hand when lifted, so height is readable.
- Both fade in only when relevant; they must not become UI clutter.

**Hover.** Grabbable props within grab reach of the hand get clear feedback: a rim/emissive lift on
the material *and* the hand opening slightly. One target at a time — nearest to the hand's grab
point, ties broken by distance to the hand, stable (no flicker between two equidistant props;
add a small hysteresis).

**Grab (LMB down).** The prop becomes kinematically spring-driven toward the hand's grip point:
a critically-damped spring with **force capped by prop mass**, so a pebble snaps to the hand and
a boulder *lags behind it and sags* — weight is communicated by the lag, not by a number on screen.
The hand closes around it. Angular damping rises while held so it doesn't spin wildly.

**Carry.** While carrying:
- Mouse moves the ground-projected target as usual.
- **Wheel raises/lowers the hand** between `HAND_LIFT_MIN` (≈0.5 m) and `HAND_LIFT_MAX` (≈14 m)
  above terrain. `Shift`+wheel still zooms the camera, always.
- Carried props still collide with terrain and other props (drag a boulder along the ground and it
  should plough, not ghost through).

**Throw (LMB up).** Release with velocity derived from the *hand grip point's* motion over a short
history window (~120 ms, sampled per frame, not per event), times a mass-dependent transfer factor:

```
v_release = handVelocity * clamp(THROW_TRANSFER / mass, MIN_TRANSFER, MAX_TRANSFER)
```

so a pebble flicks fast and far, a boulder heaves a short arc. Add a little angular velocity from
the same history so things tumble. Start from: `THROW_TRANSFER ≈ 1.0` at mass 1, min 0.25, max 1.4,
and **tune by feel** — report the values you shipped and what you rejected.

A drop (hand barely moving) must be a *drop*, not a weak throw — below a velocity threshold, release
with zero added velocity so precise placement is possible.

**Prop set** (greybox primitives, masses in the table in `constants.ts`, ~60 scattered at boot):
| prop | primitive | mass | feel |
|---|---|---|---|
| pebble | small icosahedron | 0.3 | flicks, skitters |
| rock | icosahedron ~0.6 m | 3 | the default throw |
| boulder | icosahedron ~1.6 m | 30 | heaves, thuds, gouges |
| log | capped cylinder ~2.5 m | 8 | rolls, tumbles end over end |
| cairn | stack of 4 flat cylinders | 2 each | exists to be knocked over |
| snag tree | tall cone+cylinder, top-heavy | 12 | topples slowly |

## E. Impact response — feedback is the point

Everything that lands must *answer*:

- **Dust puff** at contact, scaled by impulse — cheap instanced/points particles, greys, gone in
  <1 s. Below a small impulse threshold: nothing (no dust on every micro-collision).
- **Terrain dent decal** on heavy impacts: a darkened depression decal that persists, capped at N
  (recycle oldest). Phase 1 keeps this **purely visual** — no geometry deformation, no world state.
  Leave a one-line comment noting Phase 2 promotes this to committed tile state.
- **Scatter / knock-over** falls out of rapier for free — verify cairns actually topple and logs
  roll, and tune restitution/friction until they do so satisfyingly rather than skidding.
- **Water splash** per §B.
- **OPTIONAL, and only after every mandatory item below is green:** a tiny WebAudio synth layer
  (no asset files — oscillator/noise bursts) for grab, thud and splash, scaled by impulse, muted
  by default with `M` to toggle. If you run short on time, skip it and say so.

**Locked lighting + post** — a real deliverable, all values pinned in `lighting.ts` with a header
comment saying *this is the locked Phase 1 look; later assets are authored under it*:

- `ACESFilmicToneMapping`, tuned `toneMappingExposure`.
- Directional sun with tuned shadow map (soft PCF, camera fitted to the island, bias tuned so
  there is no peter-panning and no acne on the beach slope).
- Ambient occlusion via `EffectComposer` + an AO pass from `three/examples/jsm` — grey primitives
  live or die on contact shadows. Tune radius/intensity against the island's scale (metres, §5).
- Sky (`three/examples/jsm/objects/Sky.js` or an equivalent gradient) + exponential fog/aerial
  perspective so distance reads.
- **A reference sphere rig** for calibration: a 0.18-albedo mid-grey sphere and a white sphere on
  the meadow, toggled by `debug.ts` (`showRefSpheres`), off by default.

Target: grey primitives that read as **solid and grounded**. If the greybox does not already look
good, no asset ever will.

## F. Debug bridges — load-bearing for my verification

DEV-gated (`import.meta.env.DEV`), installed by `src/god/debug.ts`. **Shapes are a contract — I
drive Playwright against them, so match them exactly.**

```ts
window.__godState = {
  ready: boolean,
  physicsBackend: 'rapier',
  fps: number,                  // smoothed
  propCount: number,
  awakeCount: number,           // non-sleeping rapier bodies
  hand: {
    x: number, y: number, z: number,
    lift: number,               // metres above terrain
    state: 'idle' | 'hover' | 'carry',
    hoverId: string | null,
    heldId: string | null,
  },
  camera: { yaw: number, pitch: number, dist: number, tx: number, tz: number },
  counters: { grabs: number, throws: number, impacts: number, splashes: number },
}

window.__godControl = {
  // camera
  setCamera(o: { yaw?: number; pitch?: number; dist?: number; tx?: number; tz?: number }): void,
  // hand, in WORLD space so tests are resolution-independent
  moveHandTo(x: number, z: number, lift?: number): void,
  grabNearest(kind?: string): string | null,   // returns prop id or null
  release(): void,
  throwTo(x: number, z: number, power?: number): void,  // aims an arc at a world point
  // props
  spawnProps(n: number, kind?: string): void,
  stress(n: number): void,        // drop n props from height for the perf bench
  reset(): void,                  // back to boot state, deterministically
  // look
  showRefSpheres(on: boolean): void,
  fpsProbe(ms: number): Promise<{ avg: number; min: number; frames: number }>,
  listProps(): Array<{ id: string; kind: string; x: number; y: number; z: number; mass: number }>,
}
```

`ready` flips true only after rapier's WASM has initialised and the first frame has rendered.

## G. Measurement — the physics decision must be evidence-backed

The parent spec demands the engine choice be benchmarked on the target machine. You are not
building two engines; you are proving the one you built clears the bar:

- `__godControl.stress(100)` then `fpsProbe(5000)`, at 1280×720.
- **Bar: ≥55 fps average with 100 thrown props awake.** Report the measured avg/min verbatim.
- Also report: rapier WASM init time, and the fps with the boot scene (~60 props mostly asleep).
- If it misses the bar, do NOT silently accept it — profile (step cost vs render cost; log both in
  `__godState` if useful), report the numbers, and say what you'd cut. Missing the bar is a finding,
  not a failure to hide.

Physics stepping must be a **fixed timestep** (1/60) with accumulator and interpolated mesh
transforms, decoupled from render fps. Cap the accumulator so a tab-out doesn't explode.

## H. Unit tests (`test/god-*.test.ts`, vitest, node env)

Pure helpers only — no three.js scene, no WASM. Keep them small and real:

1. Island heightfield: `heightAt(x,z)` is deterministic across two builds, the same data feeds
   render + collider, sea-level ring is below 0 and the meadow is flat within tolerance.
2. Throw transfer: mass→velocity-scale curve is monotonic decreasing, clamped at both ends; a
   sub-threshold hand velocity yields exactly zero added velocity (the "drop, not weak throw" rule).
3. Camera clamps: pitch/dist/target-pan clamping is total (fuzz a few hundred inputs, all land
   inside limits); damping is framerate-independent (same total motion at dt=1/30 vs 2×dt=1/60,
   within tolerance).
4. Hand lift clamp: wheel accumulation stays in `[HAND_LIFT_MIN, HAND_LIFT_MAX]`.

Structure so these helpers are importable without touching three.js — that is a design constraint,
not an afterthought.

## Gates

1. `npm run check` exit 0 (that is `tsc --noEmit && vite build && vitest run`). Note `tsconfig.json`
   has `strict`, `noUnusedLocals`, `noUnusedParameters` — clean, no `@ts-ignore`, no `any` for
   rapier types (its `.d.ts` is complete).
2. `npx playwright test --workers=1` still all pass — you changed nothing they touch, so this is a
   regression check, not new work. Do NOT write new e2e specs (I own the visual verification).
3. `git status`-free proof that `src/sim/**` is untouched: `npx tsc --noEmit` plus a report line
   listing every file you created or edited. If a file outside the allowed list appears there, you
   have broken the leash.
4. Import-boundary grep, output pasted into the report:
   `grep -rnE "from '\.\./(sim|render|ui|mind|replay|loop|bridge|App)|from 'react" src/god/` → empty,
   and `grep -rn "god/" src/ --include=*.ts --include=*.tsx | grep -v "^src/god/"` → empty.
5. Perf numbers per §G, measured, verbatim.
6. Manual sanity in a real browser: `npm run dev` then `http://127.0.0.1:5175/god`. Confirm by
   observation, and say so explicitly for each: hand tracks terrain; hover highlights; a rock can
   be grabbed, carried, lifted with the wheel, and thrown; a boulder feels heavier than a pebble;
   a cairn topples when hit; something thrown into the sea splashes; camera pitch cannot leave its
   band; left-drag never moves the camera.
7. Do NOT run any `git` command. Do NOT run a soak. Do NOT call any LLM. Do NOT spawn subagents.

## Final report (exact structure)

**BUILT** — file-by-file, what each owns; the tuned numbers you shipped for grab spring, throw
transfer, masses, camera clamps, and lighting (exposure, AO radius/intensity, fog) — actual values,
not "tuned".
**FEEL** — what you iterated on, what felt wrong first, what fixed it. Be specific; this is the
phase's whole content.
**GATES** — 1–6 with evidence pasted.
**PERF** — §G numbers.
**FILES TOUCHED** — exhaustive list.
**DEVIATIONS** — anything you did differently from this spec, and why.
**KNOWN GAPS** — including whether the optional audio layer shipped.

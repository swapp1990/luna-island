# Dispatch P6-1b — The Hand, QA pass: the island empties itself, the hand leaves the screen, and the greybox is not grey

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

**Narration is mandatory:** one line before every long step. Silence >15 min is treated as a hang
and killed. 3 failed attempts on one item → STOP and report.

**Files you MAY edit — nothing else:** `src/god/**`, `test/god-*.test.ts`.
**Do NOT touch:** `src/sim/**`, `src/render/**`, `src/ui/**`, `src/mind/**`, `src/replay/**`,
`src/App.tsx`, `src/main.tsx`, `index.html`, `god.html`, `vite.config.ts`, `package.json`,
`e2e/**` (orchestrator-owned probes), `README.md`, `CLAUDE.md`, `plans/`, other `specs/`.

You built this in P6-1 (`specs/phase6-1-the-hand.md` — re-read it; every constraint still holds:
greybox primitives only, no textures, no React in `src/god/`, no imports across the module
boundary, `src/sim/**` untouched). The architecture is good and the perf is excellent. QA played it
and measured it, and it **does not pass the Phase 1 gate**. Below is everything found, in priority
order.

**Work the priorities in order. If you run out of road, STOP and report honestly — a half-done P1
plus an accurate list beats a rushed pass at all fifteen.** P1–P5 are gate blockers; P6–P7 are the
hand's legibility, which is the entire phase; P8–P12 are correctness and coverage; P13–P15 are
cheap cleanups.

---

## P1 — BLOCKER: the island empties itself with no player input

Measured on `/god`, boot, hands off, sampling `__godState` every 5 s:

```
t=0s   props 60   splashes 0    impacts 11    awake 60
t=5s   props 56   splashes 6    impacts 255   awake 30
t=10s  props 46   splashes 18   impacts 440   awake 19
t=20s  props 38   splashes 23   impacts 513   awake 7
t=30s  props 35   splashes 25   impacts 515   awake 4
t=60s  props 35   splashes 25   impacts 520   awake 4
```

**42% of the island's props roll into the sea in 30 seconds before the player touches anything.** A
playtester who spends a minute learning the camera arrives at a stripped island — and the wide shot
confirms it: the island reads as nearly empty with one debris pile.

Diagnosis (confirm it, but this is the strong candidate and it is your own stated P6-1 deviation):
pebble/rock/boulder use **ball colliders** while the visuals are icosahedra. Perfect spheres on a
domed island roll forever, and every slope drains to the water.

1. **Faceted colliders.** Convex-hull collider (`ColliderDesc.convexHull`) built from the same
   icosahedron geometry the mesh uses, so a rock rests on a facet like a rock. One geometry → mesh
   *and* hull. If a hull fails to build, fall back to a ball and log it once — never silently.
2. **Slope-aware boot placement.** Do not seed a prop where the terrain gradient exceeds a threshold
   you pick and document. Prefer meadow, hill shoulders, flats.
3. **Settle at boot.** Step the world headlessly for a fixed number of steps before the first frame
   so props start at rest.
4. **Keep the water despawn.** A prop the *player* throws into the sea should still sink and be
   gone — that is the reward for the best throw in the game. The bug is props leaving by themselves.

**Gate: hands off 60 s from boot ⇒ at most 2 props lost, `splashes` ≤ 2.** Paste the table.

## P2 — BLOCKER: the player loses the hand off the top of the screen while carrying

At `lift 8` with camera `dist 22, pitch 36` — well inside the legal 15–80 m band — **the hand and
the carried rock are entirely outside the viewport.** All that remains on screen is a 1 px white
hairline (the stalk) and a hard black shadow blob. `HAND_LIFT_MAX = 14` and `CAMERA_DIST_MIN = 15`
were never reconciled: lift the hand at any close or mid camera distance and the cursor exits the
frame.

The hand is the phase. It must never leave the screen. Fix it as a world rule, not a clamp
special-case — pick one and justify it:

- Scale the usable lift to the current camera distance (lift ceiling derived from what the frustum
  can actually contain at this `dist`/`pitch`), and/or
- Have the camera yield — ease `pitch`/`dist` just enough to keep the grip point framed while
  carrying high, returning when released.

**Gate: for a fuzz of camera poses across the whole legal band (`dist` 15→80, `pitch` 35→62) and
lift 0.5→max, the grip point's projected screen position stays inside the viewport with a margin.**
Write that as a unit test over the projection math and report the sweep.

## P3 — BLOCKER: the greybox is not grey

The terrain and every prop render a warm khaki/olive (sampled ≈ `132,128,117`, consistently
R>G>B). The spec mandates **one grey palette**, and the locked look is itself a Phase 1 deliverable —
every later asset gets authored under it. The `GREY*` constants are correctly neutral, so the cast
is coming from the light rig: sun `0xfff1d0` at 2.35 plus exposure 1.08 pushing warm.

Re-tune to a genuinely neutral grey look: warm and cool light can still shape the form (a slightly
warm sun against a cooler sky bounce is good practice), but the **overall read must be grey, not
brown**. Report the before/after sampled RGB of the terrain midtone and of a mid-grey prop, and keep
them near-neutral.

## P4 — BLOCKER: the island's form does not read at the god camera's own distances

At `dist` 72–80 (both inside the legal band) fog and exposure collapse the frame into a near-uniform
pale grey-blue dome. **The two hills, the meadow plateau and the beach ring are all invisible** — it
is a grey blob on a grey field, exactly the failure mode the gate names. It reads correctly only at
grazing angles.

`FogExp2` at density 0.011 over a 90 m island is eating the whole subject. Re-tune fog, exposure and
sun/sky contrast so the island's shape is legible **across the entire legal camera band**, not just
up close. Height/slope-driven grey variation on the terrain (greys only) is explicitly permitted by
P6-1 and is probably what you need here. **Gate: paste wide shots at `dist` 80/72/50 and state, per
shot, which of {hill A, hill B, meadow, beach ring, sea} is identifiable.**

## P5 — BLOCKER: the sea plane's edges are visible

In wide shots the sea is a finite quad whose straight boundary and corners sit in frame — the island
floats on a visible grey rectangle over a slightly different grey void. Extend the water well past
the fog horizon (or fit it to the far plane) so there is no visible edge anywhere in the legal
camera band. **Gate: no sea boundary visible in the P4 wide shots.**

## P6 — the hand does not read as a hand at play distance

At 22 m the hand is a flat pale lozenge; the three digits are invisible, and **the carried rock
cannot be seen in the hand at all**. It reads as a UI sprite lying on the ground. It reads correctly
only at ~13 m, which is below the camera's own minimum working distance.

Silhouette is the fix, not size alone: the digits need to break the outline at distance (separation
and depth, a visible gap between them, maybe a slight cupping so the held prop sits *in* the palm
and is visible against it). Also make the held prop visibly held — nested in the hand, not hidden
behind it. **Gate: paste hand stills at `dist` 15 / 30 / 50 and state honestly at which distances it
reads as a hand and the held prop is visible.**

## P7 — the depth affordances do not survive distance

- The ring is a **~180° arc, not a closed ring** (visible in both carry shots). Either the geometry
  is a partial torus or something is culling half of it — find out which.
- The stalk is a **1 px hairline** at play distance, which reads as a stray debug line, not a
  deliberate cue.
- The hand's cast shadow is a **hard near-black blob**, inconsistent with the soft AO on everything
  else — it is currently the strongest height cue on screen, by accident.

These three are the entire depth story for the ground-projected hand. Make the ring a closed,
distance-scaled ellipse; give the stalk real width (screen-space-compensated so it holds at 15–80 m);
soften the hand's shadow to match the scene. **Gate: with identical framing, lift-high vs lift-low
stills where the height difference is unmistakable — and say which cue is doing the work.**

## P8 — the impact/dust gate fires on rolling contacts

520 impacts with zero player input. You gated dust on speed magnitude (>1.35 m/s), but a prop
*rolling* has high tangential speed and is not an impact. Gate on the **normal** component of
relative contact velocity (or the contact impulse) so sliding and rolling produce nothing and only a
landing answers. **Gate: hands off 60 s from boot ⇒ `impacts` ≤ 5.**

Related: dent decals pooled from those phantom impacts form a **large dark smear** on the slope in
the wide shot. With P1 and P8 fixed this should mostly go away; also confirm `DENT_MAX` recycling
cannot concentrate a stain in one spot.

## P9 — bodies never sleep at idle

`awake` plateaus at 4 and never reaches 0; `impacts` keeps ticking on a still island. Something
jitters forever. Tune sleep thresholds / damping. **Gate: `awakeCount === 0` within 10 s of boot,
hands off.**

## P10 — mass is not felt on release: the transfer curve is flat above 4 kg

`releaseVelocity` uses `clamp(THROW_TRANSFER / mass, 0.25, 1.4)`. With the shipped mass table:

| kind | mass | transfer | |
|---|---|---|---|
| pebble | 0.3 | 3.33 → **1.4** | pinned at ceiling |
| cairn | 2 | 0.50 | in band |
| rock | 3 | 0.33 | in band |
| log | 8 | 0.125 → **0.25** | pinned at floor |
| snag | 12 | 0.083 → **0.25** | pinned at floor |
| boulder | 30 | 0.033 → **0.25** | pinned at floor |

Three of six kinds are **identical** on release and the pebble is pinned too — only rock and cairn
sit inside the live band. The spec requires "a pebble flicks, a boulder heaves"; a log and a boulder
currently throw the same.

Re-spread the curve (a gentler exponent such as `m^-0.5` with wider clamps, or explicit per-kind
transfer if that tunes better — your call). Requirements: all six kinds **measurably different**,
monotonically decreasing with mass; the "still hand is a drop, not a weak throw" rule unchanged;
the carry-time force cap keeps doing its job (the lag/sag is the other half of felt weight and it
already works). Report the curve and the per-kind numbers.

## P11 — the core feel claim has no automated coverage

`__godControl.throwTo(x, z, power)` is a **ballistic solve**: it computes the velocity needed to land
on the target and calls `releaseWith()` directly, **bypassing `releaseVelocity()` entirely**. So the
mass curve is exercised only by a real mouse gesture and nothing automated touches it. Your P6-1
gate-6 line ("boulder heavier than pebble — force cap + transfer curve") and the orchestrator's e2e
test were both actually measuring post-landing roll. A test that passes for the wrong reason is
worse than no test.

Add to the bridge (keep everything already there; `throwTo` stays as an aiming helper — just comment
that it bypasses the mass curve):

```ts
/** Release the held prop through the REAL player path: releaseVelocity(handVel, mass). */
throwWithHandVelocity: (vx: number, vy: number, vz: number) => {
  kind: string
  mass: number
  handSpeed: number
  releaseSpeed: number
} | null
```

It must call the same `releaseVelocity` the mouse gesture uses — not a parallel copy. Add a vitest
walking the six kinds through `releaseVelocity` at one fixed hand velocity, asserting strictly
decreasing release speed plus the drop-threshold rule.

## P12 — props interpenetrate at rest

Overlapping cylinders in the prop cluster, and cairn stones fused into a lump rather than stacked.
Fix the boot placement / stacking so nothing starts interpenetrating, and confirm cairn stones stack
as four distinct stones.

## P13 — ref spheres are unusable

0.45 m radius is a few pixels at 25–40 m, **and the boot hand parks at the meadow (4, −16) directly
on top of the rig**. Bump to ~1 m, move them (or the boot hand) so they do not collide, and keep
them where a wide camera can see them. They are the exposure calibration for P3, so they have to
actually be readable.

## P14 — terrain banding on the hill slope

A repeating row of evenly spaced crescent smudges climbs the hillside — consistent with heightfield
stair-stepping or GTAO banding at that resolution, not natural shading. Diagnose which and fix.

## P15 — the hover highlight is fine, leave it alone

Measured 198–223, not blown out, and unmissable. Recorded here only so you don't "fix" it.

---

## Gates

1. `npm run check` exit 0. (If vitest exits 1 on the known `onTaskUpdate` birpc teardown flake after
   a green run, say so and paste the pass line.)
2. `npx playwright test --workers=1` all pass. `e2e/god-*.spec.ts` are **orchestrator-owned** — if a
   change of yours makes one fail, **report it, do not edit the spec.**
3. Idle table (P1/P8/P9): props lost ≤ 2, splashes ≤ 2, impacts ≤ 5, `awakeCount === 0` by 10 s.
4. Screen-containment sweep (P2) and the per-kind release table (P10/P11), pasted.
5. Stills for P4, P6, P7 with your honest read of each.
6. Perf unchanged: `stress(100)` + `fpsProbe(5000)` ≥55 fps avg. Convex hulls cost more than balls —
   if it regresses, say by how much.
7. Import-boundary greps still empty; `src/sim/**` still untouched.
8. Do NOT run any `git` command. Do NOT spawn subagents. Do NOT call any LLM.

## Final report

**FIXED** (per priority, what changed and the number or still that proves it) / **NOT DONE** (which
priorities you did not reach — be explicit) / **LOOK** (before/after sampled RGB for P3) /
**CURVE** (P10 table) / **GATES** (evidence pasted) / **PERF** / **DEVIATIONS** / **KNOWN GAPS**.

---

## Note on the orchestrator's e2e probes

`e2e/god-idle.spec.ts` is **expected RED right now** — it is P1/P8/P9 written as an executable gate
(props lost ≤ 2, splashes ≤ 2, impacts ≤ 5, `awakeCount === 0` by 10 s). Making it green is the job.

`e2e/god-hand.spec.ts` holds a mass test that **auto-skips** until `throwWithHandVelocity` exists
(P11), then asserts strictly decreasing release speed across the six kinds. Implement P11 and it
un-skips itself.

Do not edit either file. If one fails for a reason you believe is wrong, report it.

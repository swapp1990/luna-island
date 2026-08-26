# Dispatch P6-1d — Build an actual hand

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

Narration mandatory, one line per long step. 3 failed attempts on an item → STOP and report.

**Files you MAY edit:** `src/god/**`, `test/god-*.test.ts`. **Nothing else** — not `e2e/**`
(orchestrator-owned probes), not `src/sim/**`, not config, not other specs.

## Why

The god hand is currently a cylinder plate plus three capsules. It reads as a **three-digit claw** —
no thumb, no knuckles, no wrist. Product direction reviewed it and rejected it.

The parent spec's "no models, no textures" rule was written to stop us mistaking polish for fun in
the *scenery*. It should never have covered the cursor. The hand is the interface: it is on screen
100% of the time, it is the one thing the player is always looking at, and in Black & White the hand
*is* the signature of the whole design. A hand that does not read as a hand is a **functional**
failure, not a cosmetic one.

**The carve-out, and its limit.** You are building a properly shaped hand, but it stays greybox:
**all geometry generated in code, one grey material, no textures, no external asset files, no glTF,
no DCC output.** Everything else on the island stays exactly as untextured as it is now. If you find
yourself adding a texture, a second material colour, or a loader, you have gone too far.

## What to build

Replace the plate-and-three-capsules with a hand that has real anatomy, generated procedurally:

- **Palm** — a slab with real taper: wider across the knuckles, narrower at the wrist, thicker at the
  heel than at the finger edge. Slight cupping so a carried prop nests *in* it and stays visible from
  the strategy camera's elevation. Not a flat disc.
- **Wrist stub** — a short tapered continuation so the hand reads as attached to something and has a
  clear "up the arm" direction. It is what gives the silhouette an orientation.
- **Four fingers**, each **two or three segments** with a visible joint (knuckle) between them.
  Real proportions: middle longest, index and ring slightly shorter, little finger shortest **and set
  lower on the palm**. Fingers splay slightly rather than running parallel — the gaps are what make
  the silhouette read at distance.
- **An opposed thumb** — two segments, rooted lower on the palm and rotated well off the palm plane
  (~50–60°). **This is the single element that most makes a hand read as a hand.** Do not skip it and
  do not make it a fifth finger.
- **Joints** — build it as a parented `Object3D` rig (palm → finger root → segment → segment), so
  each joint is a rotation you can animate. No skinning, no bones, no morph targets. Plain parenting.

## Pose and animation

The hand must visibly *act*, because that is where the feel lives:

- **Idle / hover** — open, fingers relaxed with a natural slight curl and splay. Not a flat starfish.
- **Grab** — fingers and thumb curl at the knuckles to **close around the held prop**, driven by a
  0→1 grip parameter you drive from the existing grab state. It must be obvious the hand is *holding*
  the thing, not that the thing is stuck to a plate.
- **Grip scales to the prop** — a pebble closes almost to a fist, a boulder holds the fingers wide.
  Derive the closed angle from the held prop's radius; do not hard-code per kind.
- **Release** — the hand opens as it throws. Fast, not a slow lerp; the opening should read on the
  same frame the prop leaves.
- Damp the pose transitions framerate-independently (`1 - exp(-k*dt)`), same as everything else here.

## Keep, unchanged

The ring, the stalk, the soft ground disc, the terrain-normal tilt, the hover highlight, the
distance scaling, the P6-1c bounds-containment (the whole hand must stay on screen — now including
the thumb and wrist), and **every `__godState` / `__godControl` shape**. This is a geometry and pose
change, not a behaviour change.

Add one debug control for screenshotting poses:

```ts
/** DEV: force the grip pose 0 (open) → 1 (closed). null returns to live state. */
setHandPose: (t: number | null) => void
```

## The bar

**It must read as a hand — with a thumb — across the camera's whole working band, 15 m to 80 m.**
Silhouette is what carries at distance, not detail: keep the finger gaps open, keep the thumb clear
of the palm outline, and let the wrist give it direction.

Iterate visually. Do not ship the first version that compiles — capture, look, adjust, repeat. Say in
your report how many iterations it took and what you changed each time.

## Gates

1. `npm run check` exit 0.
2. `npx playwright test --workers=1` all pass. Do not edit `e2e/**`.
3. **Stills, pasted with your honest read of each** — at `dist` 15 / 30 / 50 / 80:
   - open hand, empty
   - closed hand carrying a **rock**
   - closed hand carrying a **boulder** (fingers should be visibly wider than the rock case)
   - open hand carrying a **pebble** (should be near-fist)
   For each: does it read as a hand? Is the thumb identifiable? Is the held prop visible?
   State plainly the distance at which it stops working.
4. Whole hand stays inside the frame at `dist 26, pitch 42, lift 9` — thumb and wrist included.
5. Perf: `stress(100)` + `fpsProbe(5000)` ≥55 fps avg. A procedural hand is a fixed one-time cost, so
   this should not move; if it does, say by how much and what the triangle count is.
6. Greybox held: one grey material, no textures, no asset files, no loaders. Paste the material
   declaration and confirm the geometry is all generated in code.
7. Import greps empty; `src/sim/**` untouched.
8. No git. No subagents. No LLM calls.

## Final report

**BUILT** (the rig: parts, joint hierarchy, proportions, triangle count) / **POSE** (grip curve, how
prop radius drives it) / **ITERATIONS** (what you changed and why, each round) / **STILLS** (gate 3,
honest) / **GATES** / **PERF** / **DEVIATIONS** / **KNOWN GAPS**.

# Dispatch P6-1c — Ambient fill, and keep the whole hand on screen

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git`
command. Working directory is `D:\MyProjects\Claude\luna-island`.

Narration mandatory, one line per long step. 3 failed attempts on an item → STOP and report.

**Files you MAY edit:** `src/god/**`, `test/god-*.test.ts`. **Nothing else** — in particular not
`e2e/**` (orchestrator-owned probes), not `src/sim/**`, not config.

P6-1 and P6-1b landed and the numbers are green: idle leak zero, mass curve monotone, 60 fps,
neutral greys, closed ring, solid stalk, no sea edge. Two things left. This is a SHORT pass — do
these two, verify, report. Do not re-tune anything else.

## C1 — Ambient/hemisphere fill is too low

Measured from stills (nothing is clipping — 0.00% of pixels above luma 230 in every shot, and the
calibration spheres read 193 vs 98 luma, ratio 1.97:1 against a theoretical 2.08:1, so **exposure is
correct and is not the problem**). The problem is that shadow-facing surfaces get almost no light:

| symptom | measured |
|---|---|
| backlit prop on a ridge (camera-facing side away from sun) | luma **14.7** — a near-black cutout |
| flat low-poly rock face perpendicular to the sun | luma **215.7**, immediately beside a dark neighbour |
| hill A self-shadow core vs adjacent lit terrain | **38–53** vs **99** — reads as a black smear at distance |
| lit terrain / props (these are fine) | 91–115 / 59–89 |

The self-shadow geometry is correct (soft, directional, tied to the landform — not acne, not a
decal). It is the *fill* that is missing.

Raise ambient/skylight fill on shadow-facing surfaces — hemisphere intensity and/or a low ambient
term, whichever holds the form better. Constraints:

- **Do not raise exposure** and do not undo the neutrality: all terrain/prop/hand samples must stay
  neutral (|R−G| and |G−B| under 3). Sky and sea keep their intentional cool cast.
- Form must still read — this is fill, not flattening. The sun stays the key light; do not wash out
  the contact shadows and AO that already work.
- The calibration spheres must still land near their correct ratio, white ref below 230.

**Gate — sample and paste, before and after:** backlit ridge prop, hill A shadow core, adjacent lit
terrain, a sunlit flat rock face, both ref spheres. Targets: no prop below ~35 luma, shadowed
terrain no worse than about half its lit neighbour (not a quarter), sunlit flat faces under ~200.

## C2 — the hand is clipped by the top of the frame while carrying high

At lift 9 the camera correctly eased 26 m → 30.5 m, but the palm and digits are **cut off by the top
edge**. The containment rule keeps the *grip point* inside the NDC margin; the hand mesh sits above
the grip, so it overshoots.

Contain the hand's **bounds**, not its grip point — project the top of the hand (grip plus the hand's
own vertical extent, plus the held prop's radius) and keep that inside the margin. Then the camera
yield and the lift ceiling both key off a point that actually accounts for what is drawn.

**Gate:** re-run the containment sweep with the bounds point. Report min usable lift, and confirm at
`dist 26, pitch 42, lift 9` (the exact failing case) the whole hand is inside the frame — a still,
plus the projected NDC y of the hand's top.

## Gates

1. `npm run check` exit 0.
2. `npx playwright test --workers=1` all pass. Do not edit `e2e/**`.
3. C1 before/after sample table. C2 sweep + the specific case.
4. Perf unchanged: `stress(100)` + `fpsProbe(5000)` ≥55 fps avg.
5. Import greps empty; `src/sim/**` untouched.
6. No git. No subagents. No LLM calls.

## Final report

**FIXED** (C1, C2 with the numbers) / **GATES** / **PERF** / **DEVIATIONS** / **KNOWN GAPS**.

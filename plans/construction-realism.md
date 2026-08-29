# Luna Island — Construction Realism

**Status:** direction approved 2026-08-29 (phased plan; specs derive from it)
**Parent:** `plans/colony-builder.md` — this plan deepens Phase 2's "builder's hands" along one
axis: how real construction *feels*. It assumes the blueprint substrate landed in
`specs/phase7-2a-blueprint-construction.md` (commit `b7f0f31`).
**Premise:** resources are declared a non-problem. No phase spends effort on supply chains or
economy balance; realism here means the *process* — sequence, embodiment, and the site itself.

---

## Where 7-2a leaves us

A blueprint is a cell grid (wall/door/floor) raised per-cell by villagers through the existing
economy. Real, but three abstractions break the illusion:

1. **No sequence.** Cells flip planned→built in one step, at uniform full height, in whatever
   order workers happen to stand near. There is no roof at all.
2. **No embodiment.** "Working the site" means standing anywhere on it while the engine
   invisibly routes ticks to a cell. Materials are an abstract inventory number with a floating
   MAT token.
3. **No site.** No stakes, no scaffolding, no mud, no stockpile, no debris — and the finished
   school still renders the generic placeholder blob inside its own walls.

Each phase below pairs an engine truth with a visible payoff. Engine-only phases would look
identical on screen; visuals-only phases would be lipstick on a fake process. Every phase stays
deterministic, `src/sim/`-pure, and brain-free — world rules only ("what is possible"), never
choreography ("what should I do"), so the eventual mind-driven construction layer inherits all
of it untouched.

## Phase R1 — Buildings rise bottom-up (the construction sequence)

The single biggest realism win per effort.

Build:
- Cells gain **stages with prerequisites** instead of one planned→built flip:
  `foundation → frame → wall (in courses) → roof`. A wall cell cannot start until its
  foundation stage is done.
- **Roof cells become a real blueprint element** — the most glaring absence — and cannot start
  until their supporting walls stand.
- `workedTicks` becomes visible: a wall at 60% labour renders at 60% height. Stage + fraction
  are engine state; the renderer only reads them.
- The school blueprint gains its roof layer (killing the placeholder blob inside the shell).
- DEV-only **"stocked site" sandbox toggle**: spawn a site's full bill into its stockpile so
  every realism phase can be soaked without fighting the forestry economy (the 7-2a QA stall —
  big builds wedge without player priority steering — would otherwise tax every test).

Gate: watching at 4×, the school visibly builds footings → frame → climbing walls → roof
closing over. Determinism (`npm run check`) green; replay reproduces mid-stage states.

## Phase R2 — Workers who actually build (embodiment)

Build:
- A worker **claims a specific cell** (one worker per cell — same world-rule family as
  one-agent-per-tile), walks to a tile *adjacent* to it, faces it, and builds *there*.
  Hammering poses; sawing during the frame stage.
- Materials become physical: haulers carry visible logs/stone and drop them as **per-cell
  staging piles** the builder consumes. The floating MAT token and abstract site inventory are
  deleted.
- Multiple workers spread across cells naturally because claims exclude; claim release on
  idle/death/stale is deterministic.

Gate: you can watch a named villager build one specific wall; "3 builders assigned" in the
alert feed matches three people visibly hammering at three different cells.

## Phase R3 — The site is a place (construction furniture)

Build:
- Placement **stakes out the site**: survey pegs + string lines on the footprint.
- A timber/stone **stockpile stack** forms in the clearance ring.
- Ground **wears to mud** along worker paths (the existing wear-path system, pointed here).
- **Scaffolding** appears against wall cells past head height and during roof work.
- Offcuts/debris accumulate and are cleared in a short **cleanup stage** before completion;
  dust puffs on hammer hits; scaffold strike + the existing celebration crew gathering at the
  door as the finish beat.

Gate: a mid-build screenshot reads as "a Manor Lords construction site" next to the
`art/manor-slice/renders/` reference, judged by a person (the plot's pain #1, applied to
construction).

## Phase R4 — Material truth (the art pass)

Deliberately sequenced *after* the process is true, so art never papers over fake mechanics.

Build:
- **Autotiled continuous walls** (4-bit marching-squares kit: straights, corners, T-junctions)
  replacing per-cell grey boxes.
- Timber-frame stage geometry before wattle/plaster infill, so R1's frame stage *looks* like a
  frame; real door and window elements in the blueprint vocabulary.
- Roof framing, then tile courses; manor-slice kit materials dress the finished result.

Gate: construction stages and the finished school both survive close camera inspection beside
kit buildings. Renderer-heavy, near-zero engine risk.

## Phase R5 — Physical constraints (construction obeys the world)

The rules that make build order *emerge* instead of being scheduled:

Build:
- **Reachability:** a cell can only be worked from an adjacent standable tile. Enclose the
  interior too early and inside work must route through the door; workers can genuinely wall
  themselves out and must plan around openings.
- **Structural support** as a general rule: an element needs its supporting elements built
  (roof needs walls; storey 2 needs storey 1).
- **Slope foundations:** cut/fill or stepped stone footings instead of the current flat-ground
  requirement.
- The capstone all of it unlocks: **multi-storey blueprints**, with scaffolding as a hard
  requirement rather than decoration.

Gate: bigger, taller, terrain-hugging buildings whose construction sequence is *forced* by
physics, not authored. A mind that seals the door too early creates a real, traceable story —
which is exactly what makes mind-driven construction interesting later.

---

## Sequencing logic

R1–R2 are engine truth (highest risk, done first while the feature is small). R3–R4 are
presentation on top of true mechanics. R5 is the constraint layer, far easier once cells,
stages, claims, and scaffolding all exist. Each phase is one dispatch of roughly 7-2a's size.

## Explicitly out of scope

Supply-chain/economy realism (declared a non-problem here), construction failure/quality rolls,
weather gating, worker trades/specializations (that's behavior — the Brain's job, not the
engine's), and mind-issued blueprints (separate plan; this plan builds the world it will use).

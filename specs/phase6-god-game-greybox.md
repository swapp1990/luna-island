# Phase 6 — The God Game: a playable greybox, no agents

**Status:** proposed
**Owner:** main session (direction + QA gates)
**Premise:** Black & White, reduced to its skeleton. Three phases, each one playable at its
end. No villagers, no LunaBrain, no economy. We are answering one question only:

> Is being a god over this island fun *before* anyone lives on it?

If the answer is no, adding agents will not fix it. If the answer is yes, the agents inherit
a game that already works.

---

## Why this exists

Luna Island has a simulation and a viewer, but no game loop. The [roadmap](../plans/roadmap.md)
states the observer contract plainly — pause, speed, scrub, click an agent — and every one of
those is a *camera* verb. The player currently watches. That is why the town-builder framing
never fit: in a town builder the player builds the town and observation is the reward for
having built it.

Black & White is the resolution, because it is the one design where the player gets real verbs
without the world becoming scripted. The player changes *conditions*; the world decides what to
do about them. That maps exactly onto the existing `Brain.decide(observation) → Intent` seam —
later, a god action becomes a change to what minds observe, not a command they must obey. The
claim "the villagers invented this themselves" survives intact.

We build the god half first, alone, in greybox.

---

## Standing rules for all three phases

**Determinism is not negotiable.** `src/sim/` stays pure and deterministic (invariant 1 & 2).
Rigid-body physics is **not** deterministic across machines and must never enter the sim core.
It lives in the interaction/render layer only. Concretely:

- Thrown props are render-layer objects with no authority over sim state.
- When a god action *does* change the world (scorch a tile, flood a tile, fell a tree), the
  change is committed to the sim as a discrete, integer, deterministic effect — recorded as a
  `god:*` event on the trace, exactly like `externalIntentLog` records mind intents.
- Consequence: replay works. Scrub back and the island re-derives identically. The physics
  toss that *caused* it is cosmetic; the committed effect is canonical.

**Greybox means greybox.** Untextured primitives, one grey palette, no models, no textures for
all three phases. The only visual work permitted is **lighting and post**, and that is deliberate
(see Phase 1). We are protecting ourselves from mistaking polish for fun.

**The gate is a person, not a checklist.** Every phase ends with someone who does not know the
project playing it while we say nothing and take notes. Spec gates below are necessary, not
sufficient.

---

## Phase 1 — The Hand

**Goal:** the toy. One interaction, made to feel good, with nothing else competing for attention.

Black & White's hand is the whole game in miniature: you reach into the world and physically move
it. If picking up a rock and hurling it into the sea is not satisfying on its own, no amount of
miracles or villagers will rescue it.

### Build

- **God camera.** Orbit / pan / zoom over the island, framed for a god: high enough to see the
  place, low enough to feel present. Smooth damping, no snapping. This is the Phase 0 "camera
  contract" from the visual plan — locked here, in writing, and every later decision derives
  from it.
- **The hand.** A world-space cursor with real depth. The 2D mouse drives a ground-projected
  point; the hand rides above it and raycasts to grab. Hover feedback on grabbable things.
- **Grab / carry / throw.** Pick a prop up, feel its weight, throw it on an arc, watch it land
  and tumble. Mass differs by object — a pebble flicks, a boulder heaves.
- **Grabbable props.** Boulders, logs, a few loose objects. Greybox primitives, drawn from the
  terrain that already exists.
- **Impact response.** Things that get hit react — knocked over, scattered, dented terrain.
  Feedback is the entire point of this phase.
- **Locked lighting + post.** Tone mapping (ACES filmic) and exposure, ambient occlusion, shadow
  tuning, sky and aerial perspective — tuned against grey primitives and a reference sphere.
  Locked here so every later asset is authored under final lighting rather than being relit
  afterwards.

### Decisions this phase must settle

- **Physics engine.** `rapier` (Rust/WASM, fast, deterministic *within* a build) versus
  `cannon-es` (pure JS, simpler, slower). Benchmark both on a hundred thrown props on the target
  machine before committing. Whichever wins, it stays out of `src/sim/`.
- **One tile = how many metres?** The sim's 3×3 building footprint at 3 m/tile yields a 9 m
  house, which matches the manor-slice bible's 6×9 m almost exactly. Confirm and write it down;
  everything visual downstream depends on it.

### Not in this phase

No miracles. No resources. No goals. No score. No UI beyond a cursor. If it is not the hand, it
does not go in.

### Gate

- A person picks it up and throws things for **three minutes without being told to**, and is
  annoyed when you take the mouse away.
- The greybox looks *good* under the locked lighting. Grey primitives with proper AO and tone
  mapping should already read as solid and grounded — if they do not, no asset will.
- Determinism check still green: `npm run check` passes, `src/sim/` purity grep clean.

---

## Phase 2 — Divine power

**Goal:** verbs with reach and cost, and a world that visibly answers them.

The hand is intimate and local. Miracles are the god's other register — spatial, expensive, and
consequential. This phase turns manipulation into *decisions*.

### Build

- **Influence radius.** Power is spatial and bounded. You are a god *here*, not everywhere.
  Visibly rendered on the terrain so the boundary is legible and felt as a constraint.
- **Prayer power.** A regenerating resource that miracles consume. Scarcity is what turns
  "click all the buttons" into "which one, and where?"
- **Four miracles**, chosen because they interact rather than stack:
  | Miracle | Effect | Counters |
  |---|---|---|
  | Water | wets tiles, grass greens, growth accelerates | fire |
  | Growth | forest/crop regrows, terrain fertility up | — |
  | Fire | ignites, spreads along dry/wooded tiles, scorches | water |
  | Wind | knocks props over, spreads fire, clears | — |
- **Persistent terrain state.** Scorched, fertile, flooded, dry. Committed to the sim as integer
  tile state so it survives snapshot/replay and shows on the timeline. This is the first real
  extension of the world model and must respect determinism.
- **Fire that spreads.** The one genuinely emergent system in this phase. Deterministic
  cellular spread over tile state, seeded from sim RNG. It creates the first real *pressure*:
  something happening that you did not directly cause and may need to stop.
- **Casting interaction.** Start with hold-and-place (readable, testable). Gesture-drawing is
  the B&W signature but is a research problem; try it only after hold-and-place proves the
  underlying effects are fun.

### Not in this phase

No alignment. No villagers. No progression. No win state.

### Gate

- The island **looks materially different** after ten minutes of play, and the difference is
  legibly the player's doing.
- At least one genuine dilemma exists: the fire spreads faster than prayer power regenerates,
  so the player must choose what to save.
- Scrubbing the timeline back and forward reproduces the island exactly — god actions replay
  from the trace like any other event.

---

## Phase 3 — Consequence and character

**Goal:** stakes, identity, and a session that has a shape.

Two of Black & White's most-copied ideas cost almost nothing in greybox and both are about the
world reflecting the player back at themselves.

### Build

- **Alignment, derived not chosen.** A single axis inferred from what the player actually does —
  nurture versus destroy — never a menu selection. Recorded on the trace so it is auditable.
- **The world wears your alignment.** B&W's signature move, and in greybox it is nearly free
  because it is entirely lighting and palette: warm/soft/rounded versus cold/harsh/jagged sky,
  sun colour, fog, terrain tint, prop silhouettes. This is the single highest-impact visual
  feature in the whole plan and it needs zero assets.
- **Something to tend that can fail.** A sacred grove, a spring, a beacon — one thing on the
  island with a health state that decays without attention and can be destroyed outright. This
  is the pressure that makes the ten-minute arc a *game* rather than a sandbox.
- **Influence grows with success.** Tending well expands the radius; failure contracts it.
  Progression expressed spatially, so it is visible without UI.
- **A session shape.** A ten-minute arc with a beginning (small radius, calm), a middle
  (pressure, fire, choices), and an end state worth screenshotting.

### Not in this phase

No agents. Still. Resist this hard — the temptation to "just add villagers to see" will destroy
the experiment's value.

### Gate

- A playtester makes a choice they **regret**, or expresses an opinion about the island. Either
  is evidence of stakes.
- Two players' islands look visibly different after ten minutes, and you can tell from a
  screenshot which one nurtured and which one burned.
- A stranger playing for ten minutes can describe, unprompted, what the game is.

---

## What this deliberately defers

Agents, economy, buildings, institutions and the entire existing simulation stay exactly where
they are — untouched and still passing their gates. The god game is built beside them.

When all three phases pass, the join is well-defined and small: a god action already changes
world state deterministically, and world state is already what `Brain.decide(observation)`
reads. Villagers walk into a world that is fun to touch, and they start reacting to a player
who already has real verbs.

If the three phases *fail* their gates, we have learned that for a fraction of the cost of
finding out later — and the simulation is undamaged.

---

## Open questions for direction

1. **Camera:** does the god camera orbit freely, or is it constrained like a strategy camera?
   Free orbit means every future asset must read from every angle.
2. **Hand input:** mouse-and-depth is the classic hard problem. Is a simplified
   ground-plane-only hand acceptable if it feels better?
3. **Island:** reuse the existing generated island, or author a small hand-made greybox one
   sized for the ten-minute arc? Reuse is cheaper; authored is better tuned.

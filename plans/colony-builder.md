# Luna Island — The Colony Builder

**Status:** direction approved 2026-08-25 (this document is the plot; specs derive from it)
**Shape:** RimWorld × Manor Lords — a colony-sim town builder where the player builds and
directs the settlement, and villagers with real minds live in it.
**Supersedes:** `specs/phase6-god-game-greybox.md` (god phases 2–3 will not be built; phase 1
is parked at commit `4916b01`) and the roadmap's observer-only framing.

---

## Why this pivot

The town builder we have is a tech demo the player watches. The agent and emergence work —
LunaBrain minds, memory, conversations, institutions, discovery, biographies — is the part worth
keeping, and it is the part **no popular builder has**. RimWorld's pawns don't actually think;
Manor Lords' villagers are animation loops. Ours reflect, gossip, form grudges, and invent
procedure. That is the moat.

So: keep the engine and the minds, replace the game around them. Follow the visual and
interaction language of popular builders **deliberately and unapologetically** — players should
recognize the game in one screenshot and know how to read it in one minute.

Stated pains this plan exists to fix, in priority order:
1. The visual language doesn't follow popular games / looks like a tech demo.
2. No goals or pressure — nothing to survive, optimize, or fail at.
3. Illegible — the emergence exists but is buried in logs instead of readable on the world.

(Notably NOT a pain: watching villagers live. That stays — it becomes the reward layer.)

## What each parent game contributes

- **Manor Lords:** the look and the ground truth of the world. Organic medieval settlement,
  strategy-camera framing, buildings that read at zoom and survive close inspection. The
  `specs/manor-slice-assets.md` Franconian kit (Phases 0–6 already built in Blender) is
  literally this game's art — its import pipeline is now on the critical path.
- **RimWorld:** the legibility and control conventions, and pawn-level storytelling. The player
  *designates* — place, zone, prioritize — and pawns execute on their own schedule. Alerts
  surface stories; every colonist is a character you can name.

## The division of authority (invariant 7, renegotiated)

The old bet was "scaffold, not script": emergence had to carry the entire game, so villagers
founded and built everything themselves. That bet produced great research and a boring game.
New division:

- **The player owns the built environment:** what gets built, where, in what order; zones,
  stockpiles, work priorities, rationing rules.
- **The agents own society:** how they live in it — needs, relationships, conversations,
  disputes, institutions, opinions about the player's town. The engine still never scripts
  behavior; the Brain seam is untouched.
- The emergence claim shifts from *"they built this town themselves"* to *"they genuinely live
  in the town you built"* — which is the RimWorld promise, kept for real.
- Villager-initiated founding/commissioning remains an **engine capability** (it already works,
  P4–P5) and may return later as a hands-off "wild mode." It is no longer the core loop.

## What survives unchanged

`src/sim/` core (needs, tiles, determinism, snapshots, time travel), the event trace, the Brain
seam and both brains, the full LunaBrain stack (memory, reflection, conversations, institutions,
discovery), the economy/jobs/construction pipeline (P2 I–K — villagers already build from
commissions; the pivot is only **who issues them**), Run Theater, and the soak/probe tooling.

**Architectural seam for player verbs:** every player action is an externally-injected,
trace-recorded event (the `externalIntentLog` pattern) committed as a discrete deterministic
effect. Same seed + same recorded player actions ⇒ identical world. Replay and Run Theater keep
working; `npm run check` stays the gate.

**Salvage from the parked god game (`4916b01`):** the strategy-camera contract (constrained
pitch band, damped, distance-scaled pan), **1 tile = 3 m** (validated against the manor kit's
6×9 m house), the lighting-rig structure and the QA method (calibration spheres, sampled-luma
gates, measured screenshots). The neutral-grey values themselves were tuned for greybox; final
lighting follows the manor-slice bible (low warm sun, cool fill) once real albedos land.

## Build strategy

Like `/god`: the new game grows on its own route (`/town`) with its own shell, reusing
`src/sim/` but none of the old presentation. The existing viewer at `/` keeps running soaks and
replays untouched until `/town` passes its Phase 2 gate, then becomes the default route. No big
rewrite of a live app; the old shell is deleted only when the new one has earned it.

---

## Phase 1 — The readable town

*The existing sim world, rendered and narrated in the language of popular builders. No new
mechanics — this phase is presentation, and it attacks pains 1 and 3.*

Build:
- **Walking skeleton first:** `/town` route, strategy camera, lighting rig, the current sim
  world rendering — gated before anything else lands on it.
- **Real buildings:** glTF export/import pipeline for the manor-slice kit; sim building types
  mapped to kit assets (L1/L2 houses, church, granary, market stalls, well); construction
  renders in stages (site → frame → done) instead of popping in.
- **Real ground:** terrain material pass, roads that read as roads (wear paths exist in sim),
  forest ring, water.
- **The legibility layer, straight from genre convention:** top resource bar; villager overhead
  status icons (sleep, hunger, task); selection → character/building card; zone and ownership
  overlays; right-side alert feed driven by the existing discovery/narrative events; speed
  controls; hover tooltips. Conventions are copied on purpose — invent nothing here.

Gate:
- A screenshot of `/town` reads as "a Manor Lords-like game," side by side with the
  `art/manor-slice/renders/` reference, judged by a person.
- Ten minutes of watching at 4× speed, inspector closed: you can tell who is doing what and why,
  and at least one villager story beat surfaces in the alert feed on its own.
- `npm run check` green; determinism untouched; old viewer unaffected.

## Phase 2 — The builder's hands

*Player verbs and a survival arc. Attacks pain 2. This is where it becomes a game.*

Build:
- **Placement:** build menu, placement ghost with validity (terrain, clearance, resources),
  player-issued commissions into the existing construction pipeline; cancel/demolish; roads and
  zone painting (fields, stockpiles, forestry).
- **Direction:** per-villager work priorities (RimWorld's grid, simplified), stockpile rules.
- **Pressure:** seasons with winter food scarcity; a scenario start ("seven villagers, a cart of
  supplies, autumn"); a real fail state (starvation, exodus) and the town's survival visibly at
  stake in the resource bar.
- All player actions trace-recorded and replay-deterministic.

Gate:
- You can lose. A first session has a shape: land → build → first winter.
- Scrubbing the timeline replays a played session exactly, player actions included.
- One playtester who knows the genre plays 15 minutes without instructions.

## Phase 3 — Minds move in

*The differentiator: LLM villagers in the player's town, and their lives readable on the surface.*

Build:
- LunaBrain villagers under the player's economy (budget/cadence machinery already exists).
- The social layer surfaced RimWorld-style: story alerts from the narrative/discovery feed
  ("Marta and Joss quarreled at the well over rationing"), one-click biographies, conversations
  visible in the world.
- Institutions meet the built environment: assemblies convene in the hall the player built;
  villager opinions reference the player's decisions (what they observe is the town — the
  Brain seam does the rest).

Gate:
- After 15 minutes, a stranger can name two villagers and retell one story arc unprompted.
- Recorded sessions replay with zero LLM calls (existing oracle-in-the-trace pattern).
- Token budget for a session stated and held.

---

## Explicitly deprecated

- God phases 2–3 (miracles, alignment). The hand/physics toy stays parked at `/god`.
- Villager-founded-everything as the core loop (capability retained, loop retired).
- The old viewer shell as the product surface (retired after Phase 2 gate; its panels'
  information moves into the new legibility layer where earned).

## Open questions (decide when reached, not now)

1. Population scale target for Phase 3 (12 minds? tiered protagonist/background split exists).
2. Do seasons enter `src/sim/` as world rules in Phase 2 (they must — but granularity TBD).
3. When `/town` becomes `/`, what happens to photo mode / Run Theater panels (port vs. link).

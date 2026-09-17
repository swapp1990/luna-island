# Ink Town — two minds, one street, nobody telling them what to do

Status: planned 2026-09-17. Parallel track, own entry (`/ink`). Touches nothing under
`src/sim/**`, `src/town/**`, `src/lineage/**`.

## The question

Give a cheap LLM a body, a wallet, a fridge and a clock — and **no instructions about
what to do with them**. Does it work out, on its own, that it should:

- go to the shop *before* it is hungry, not after;
- buy more than one meal when the shop is about to close for two days;
- sleep because energy is low, not because it is dark;
- walk to a place before trying to use it;
- turn up at the town centre at the same hour as the other mind?

None of that is scripted, hinted, or scored. The system prompt states world facts only —
the same discipline as `src/lineage/prompt.ts` (`WORLD_RULES_TEXT`: facts, no advice, no
ranking). If the minds plan ahead, that is the finding. If they thrash and starve every
weekend, that is also the finding, and the trace says exactly why.

## Why it is much smaller than everything else in this repo

`src/sim/` is a 3D colony with construction, politics, relationships and a 68k-line brain.
Ink Town deliberately throws all of it away and keeps the one seam that matters:
`Brain.decide(observation) → Intent`. Two minds. Five buildings. Nine verbs. One screen.

| | colony (`/town`) | lineage (`/lineage`) | **Ink Town (`/ink`)** |
|---|---|---|---|
| agents | dozens | ~8/season | **2** |
| render | three.js, GPU | markdown, none | **canvas 2D, ink on paper** |
| tick | 1 minute, 1440/day | 4 turns/day | **1 minute, decisions hourly** |
| decision | LunaBrain, huge prompt | facts-only prompt | **facts-only prompt, ~700 tokens** |
| watchable live | yes | no | **yes — that is the whole point** |

## What is on screen

Black ink on off-white paper, everything drawn with a wobbling hand: five rectangles
(two homes, market, workplace, town centre), roads as double wobbly lines between them,
two dots walking. Night cross-hatches the paper. A sidebar shows each mind's three needs
as hand-drawn bars, its money, its fridge, and — the part worth watching — the one-line
`reason` it gave for what it is doing right now.

No goals, no score, no win condition, no player input beyond pause/speed/seek. You watch
two dots live a week.

## The world, in one page

Nine verbs: `go_home`, `go_work`, `go_market`, `go_center`, `sleep`, `eat`, `buy`, `work`,
`socialize`, `wait`. Three needs in [0,1] that fall every hour. One wallet, one fridge.

The scarcity that makes planning *possible* (and its absence would make the experiment
vacuous):

- **The market shuts at 18:00 and does not open at all on Saturday or Sunday.** Two days
  of food must be bought on Friday or not at all.
- **The fridge holds 6 meals.** A weekend needs ~5. It fits — but only just, and only if
  the mind fills it before Friday closing.
- **Work pays only Mon–Fri 09:00–17:00**, and the market's open hours sit inside the
  working day. Shopping costs wages. Every useful hour competes with every other.
- **Social only rises when both minds are in the town centre at the same time.** One mind
  alone there gains nothing. They have to coordinate without being told to.

These are world rules — "what is possible" — never choreography. Invariant 7 of
`CLAUDE.md` applies here exactly as it does to `src/sim/`.

## What success looks like (observation, not scoring)

Nothing in the code rewards these. Phase 3's day report just counts them so we can read a
week at a glance:

1. **Stocking**: is there a purchase of ≥3 meals on a Friday?
2. **Anticipation**: is the median hunger at time-of-purchase *above* 0.4 (buying early)
   rather than below 0.2 (buying starving)?
3. **Locomotion**: what fraction of actions fail with "you are not there"? Falls over days ⇒ it learned the body has a position.
4. **Coordination**: hours where both dots are in the centre together.
5. **Survival**: hours spent below 0.15 on any need, per mind per day.
6. **Honesty of the run**: fraction of decisions that came from the LLM vs the dumb fallback. A pretty week driven 60% by fallbacks proves nothing.

## Phases

- **P1 — `specs/ink-p1-world-and-ink.md`.** World, clock, needs, economy, road walking,
  canvas ink renderer, HUD, the deliberately-dumb rule brain. **No network, no LLM.**
  Deterministic, seeded, tested. Already watchable — this is the thing the LLM later
  plugs into.
- **P2 — `specs/ink-p2-grok-minds.md`.** xAI runner + dev sidecar route, facts-only
  prompt, JSON action contract, async brain that never blocks the clock, per-decision
  journal.
- **P3 — `specs/ink-p3-observation.md`.** Decision ledger in the UI, day/week summary,
  `journal.jsonl → markdown` report for reading a soak without watching it.

## Rules of the track

- `src/ink/sim/**` is pure TypeScript: no DOM, no `Math.random`, no `Date.now`. Seeded RNG
  from `src/sim/rng.ts`, time is the tick counter. Same invariant 1 as the main sim.
- With the rule brain the sim is deterministic and `npm run check` gates it. With the LLM
  brain it is not, and does not pretend to be — the journal is the record.
- The clock never blocks on a decision. A late or malformed answer means the mind keeps
  doing what it was doing and the event is stamped `source: 'fallback'`.
- Cost is capped in the sidecar, not in the client, and the sim pauses when the tab is hidden.

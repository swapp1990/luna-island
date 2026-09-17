# Dispatch INK-P1 — Ink Town: world, clock, economy, ink renderer (no LLM)

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER
spawn subagents. NEVER run any `git` command. NEVER make a network call or an LLM call.
Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, or anything under `src/sim/**`,
`src/town/**`, `src/lineage/**`, `src/age0/**` (you may *import* from `src/sim/rng.ts`,
`src/sim/events.ts` and `src/sim/types.ts`, nothing else). If a gate will not go green
after 3 distinct fix attempts, STOP and report honestly in your audit report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` first — invariants
1, 2, 3, 5 and 7 apply to `src/ink/sim/**` exactly as they apply to `src/sim/`. Then read
`plans/ink-town.md` end to end; it is the plot and this spec is its Phase 1. Where the
plan and this spec disagree, this spec wins.

Read before writing anything, in this order: `src/sim/rng.ts`, `src/sim/events.ts`, the
`SimEvent` and `Rng` shapes in `src/sim/types.ts`, `src/lineage/instinctBrain.ts` (tone of
a deliberately simple brain), `src/lineage/step.ts` (how a turn resolves intents into
state plus events), `vite.config.ts` (how `wild.html` / `lineage.html` get their entry and
pretty URL), and `test/mind.test.ts` for test style.

## What this dispatch builds

A watchable black-and-white hand-drawn town at `/ink`: five buildings, two dots, roads,
a 7-day clock, three needs, money, a fridge, and a deliberately dumb rule brain driving
both minds. **No LLM anywhere in this phase.** Phase 2 swaps the brain; nothing else
about the world changes, so build the `InkBrain` seam cleanly.

## Files you create

```
ink.html                       entry (copy the shape of wild.html)
src/ink/main.tsx               boot: world + loop + renderer + HUD + window bridges
src/ink/loop.ts                real-time driver (speed, pause, tab-visibility)
src/ink/sim/config.ts          the constants table in section 2 — every number lives here, nowhere else
src/ink/sim/types.ts           InkState, Mind, PlaceId, Action, Intent, Observation, InkBrain
src/ink/sim/world.ts           createWorld(seed) returns InkState: places, road graph, two minds
src/ink/sim/path.ts            road-graph shortest path + walk stepping
src/ink/sim/actions.ts         action table: preconditions, effects, failure reasons
src/ink/sim/step.ts            advanceTick(state, brains) — needs, movement, action resolution, events
src/ink/sim/ruleBrain.ts       the dumb fallback brain (section 6)
src/ink/sim/observe.ts         observationFor(state, mindId) returns Observation
src/ink/sim/hash.ts            inkHash(state) — FNV-1a over canonical JSON, same spirit as src/sim
src/ink/render/ink.ts          seeded wobble/hatch drawing primitives (section 7)
src/ink/render/scene.ts        canvas 2D renderer: places, roads, dots, night, clock
src/ink/ui/Hud.tsx             React sidebar (needs bars, money, fridge, current action + reason)
src/ink/ui/ink.css
test/ink-world.test.ts
test/ink-step.test.ts
test/ink-actions.test.ts
test/ink-determinism.test.ts
e2e/ink.spec.ts
audit-reports/ink-p1-report.md your report (section 11)
```

Also edit `vite.config.ts` only to (a) add `ink: 'ink.html'` to `build.rollupOptions.input`
and (b) rewrite the pretty URL `/ink` to `/ink.html` inside the existing `townPlugin()`
middleware, next to the existing `/wild` rewrite. Change nothing else in that file.

## 1. Time, and what a decision is

- 1 tick = 1 sim minute. 60 ticks/hour, 1440/day, 7-day week starting **Monday 06:00**.
- `state.tick` is the only clock. Derive `day (0-6)`, `hour`, `minute`, `isWeekend` from it.
  Day names Mon..Sun. No `Date.now()` anywhere under `src/ink/sim/**`.
- **A mind decides once per hour**, at `tick % 60 === 0`, and only then. Between decisions
  it executes what it last chose (walking a road, sleeping, working, eating).
- `InkBrain` is the one seam:

```ts
export interface InkBrain {
  /** Called at each hour boundary. May return null to mean "nothing new" (keep going). */
  decide(obs: Observation, rng: Rng): Intent | null
}
```

  Phase 2 adds an async brain that answers late; design `step.ts` so a decision arriving at
  any tick can be applied through `applyIntent(state, mindId, intent, source)`. The hourly
  call is just the common case. **Engine code must never know which brain produced an
  intent** (invariant 5) — it only records `source: 'rule' | 'llm' | 'fallback'` on the event.

## 2. Constants (`src/ink/sim/config.ts` — pin these exact values)

```ts
export const INK_CONFIG = {
  ticksPerHour: 60,
  daysPerWeek: 7,
  startTick: 6 * 60,            // Monday 06:00

  // needs, per SIM HOUR; step.ts applies 1/60th of each per tick so bars move smoothly
  hungerDecayAwake: 0.05,
  hungerDecayAsleep: 0.025,
  energyDecayAwake: 0.05,
  energyGainAsleep: 0.12,
  socialDecay: 0.03,
  socialGainTogether: 0.50,     // only when BOTH minds are inside the town centre
  sufferingThreshold: 0.15,

  mealHunger: 0.40,             // one meal restores this much
  mealMinutes: 20,              // eating occupies this many ticks
  mealPrice: 20,
  fridgeCapacity: 6,
  startMeals: 2,
  startMoney: 200,
  wagePerHour: 15,              // accrues per tick present at work during open hours

  buyMinutes: 15,               // a market transaction occupies this many ticks
  walkUnitsPerMinute: 4,

  workOpen: { days: [0, 1, 2, 3, 4], from: 9, to: 17 },   // Mon-Fri 09:00-17:00
  marketOpen: { days: [0, 1, 2, 3, 4], from: 9, to: 18 }, // Mon-Fri 09:00-18:00, SHUT at weekends
  nightFrom: 20, nightTo: 6,    // rendering + the "is it dark" observation fact
} as const
```

These numbers are balanced against each other: roughly 2.5 meals a day, a weekend costs
about 5 meals, and the fridge holds 6 — so a weekend is survivable **only** if the fridge
is filled before Friday closing. Do not retune them to make the rule brain look better.
Nothing may hard-code any of these values anywhere else in `src/ink/**`.

## 3. Places and roads (pin these coordinates)

World plane is 100 x 60 units, origin top-left. Five places, each an axis-aligned rect
with a door point on the road:

| id | label | rect (x,y,w,h) | door |
|---|---|---|---|
| `home-a` | A's house | 6, 6, 14, 12 | 13, 18 |
| `home-b` | B's house | 6, 38, 14, 12 | 13, 38 |
| `market` | Market | 44, 4, 18, 12 | 53, 16 |
| `center` | Town centre | 44, 32, 18, 12 | 53, 32 |
| `work` | Workshop | 76, 20, 18, 16 | 76, 28 |

Road graph (undirected, straight segments; a mind is always either inside a place or at a
point along a segment):

```
spine:  (8,28) - (13,28) - (53,28) - (76,28)
spurs:  (13,28)-(13,18) door home-a    (13,28)-(13,38) door home-b
        (53,28)-(53,16) door market    (53,28)-(53,32) door center
        (76,28) is the work door
```

`path.ts` does Dijkstra/BFS over this graph (junction nodes plus doors) and returns a
polyline. Walking advances `walkUnitsPerMinute` units per tick along it. Arriving sets
`mind.at = placeId` and clears the path. Ties in path choice must break deterministically
by node id — never by RNG.

## 4. State shape (pin these)

```ts
export type PlaceId = 'home-a' | 'home-b' | 'market' | 'center' | 'work'
export type ActionKind =
  | 'go_home' | 'go_work' | 'go_market' | 'go_center'
  | 'sleep' | 'eat' | 'buy' | 'work' | 'socialize' | 'wait'

export interface Intent { action: ActionKind; count?: number; reason: string }

export interface Mind {
  id: 'A' | 'B'; name: string; home: PlaceId
  at: PlaceId | null                  // null while on a road
  pos: { x: number; y: number }
  path: { x: number; y: number }[]    // remaining polyline, empty when not walking
  hunger: number; energy: number; social: number   // [0,1], 1 = satisfied
  money: number
  busyUntilTick: number               // eating/buying occupy the body
  asleep: boolean
  current: Intent | null              // what it is doing now (drives the HUD reason line)
  sufferedHours: number
}

export interface InkState {
  tick: number; seed: number
  minds: [Mind, Mind]
  fridges: Record<'home-a' | 'home-b', number>     // meals, 0..fridgeCapacity
  seq: number
}
```

Fridges belong to the *home*, not the mind — a mind can only eat from and buy into its own
home's fridge. Money belongs to the mind.

## 5. The action table (`actions.ts`) — this is the entire rulebook

Every action either succeeds or fails with a short human reason. **A failed action still
costs the mind its hour** — that is how a mind learns its body has a position. Both
outcomes append an event (section 8).

| action | preconditions | effect |
|---|---|---|
| `go_home` / `go_work` / `go_market` / `go_center` | not busy (`busyUntilTick > tick`) | sets `path` toward that place's door, `at = null`, wakes the mind. Already there means fail: "you are already at X". |
| `sleep` | `at === mind.home` | `asleep = true`. Energy gains while asleep. Any other intent wakes it. |
| `eat` | `at === mind.home`, `fridges[home] >= 1` | minus 1 meal, `hunger += mealHunger` (clamp 1), body busy `mealMinutes`. |
| `buy` (`count` 1..6, default 1) | `at === 'market'`, market open now, `money >= count * mealPrice`, `fridges[home] + count <= fridgeCapacity` | money down, fridge up, busy `buyMinutes`. If `count` exceeds what money or space allows, **fail** — do not silently clamp. The reason names which limit was hit. |
| `work` | `at === 'work'`, work open now | earns `wagePerHour/60` per tick until the next decision or closing time. |
| `socialize` | `at === 'center'` | never fails. Social rises **only on ticks when both minds are at `center`**; alone it gains nothing. Do not add a consolation gain — the coordination problem is the point. |
| `wait` | — | nothing. |

Failure reasons are short second-person facts, for example `"the market is shut on
Saturday"`, `"you are at home-a, not at the market"`, `"your fridge holds 6 and already
has 5"`, `"a meal costs 20 and you have 12"`. A human reads them in the HUD and the LLM
reads them in Phase 2, so they state the fact and nothing else — **never advice, never a
suggestion of what to do instead.**

## 6. The rule brain (`ruleBrain.ts`) — keep it stupid on purpose

In Phase 2 this becomes the fallback used when a decision is late or malformed, so if it is
clever it will fake intelligence the LLM did not have. It is exactly this, in order:

1. `energy < 0.20` and at home: `sleep`
2. `hunger < 0.20` and at home and fridge >= 1: `eat`
3. currently walking: `wait` (keep walking)
4. otherwise: `wait`

That is the whole brain. It does not shop, work, socialise, or travel. A week driven by it
should look bleak — that is the correct result, and your E2E asserts it (section 10).

## 7. The ink look (`render/ink.ts`, `render/scene.ts`)

Canvas 2D, no new npm dependency, no SVG, no three.js. Off-white paper `#f7f5f0`, ink
`#161616`, one mid grey `#8c8880` for hatching. **No other colours.**

- `wobblyLine`, `wobblyRect`, `hatch` primitives: displace points by a small seeded-noise
  offset (amplitude around 0.6 units, 2-3 segments per edge) so edges look drawn by hand.
- **The wobble must be stable across frames.** Derive it from a per-shape fixed seed
  (`createRng(seed ^ shapeId)`) and cache the generated `Path2D`; never re-jitter per
  frame. Boiling lines are a bug and the QA gate will reject them.
- Buildings: wobbly rect, a second offset stroke on two edges for weight, diagonal hatch
  on the south/east side, hand-lettered label above. Doors as a small gap in the wall.
- Roads: two parallel wobbly lines with a dashed centre; no fill.
- Minds: A is a filled dot, B is a ring — no colour, and no labels chasing them across the
  screen (identity is the shape; the HUD carries the names). Dot radius about 1.2 units,
  plus a short motion tail of 3 fading ghosts while walking.
- A sleeping mind gets small "z" ticks above its house; a working mind a tiny hatch puff.
- Night (`nightFrom`..`nightTo`): darken the paper toward `#ded9cf`, add a sparse
  cross-hatch over the sky area, and give each open place a lamp halo (a pale disc drawn
  under the hatch).
- Clock: top-left, hand-drawn box, `Mon 14:20`, plus a sun or moon glyph.
- The canvas fills the window minus the sidebar, letterboxed to the 100x60 aspect, and
  handles devicePixelRatio. A resize regenerates cached paths once, not per frame.

The renderer interpolates dot position between ticks so movement is smooth (the spirit of
invariant 6). HUD state updates must not force a rebuild of the cached canvas paths.

## 8. Events

Use `EventTrace` from `src/sim/events.ts` and the `SimEvent` shape from `src/sim/types.ts`
(`{ seq, tick, type, agentId, data, reason }`). Emit:

- `decision` — `data: { action, count?, source }`, `reason` is the intent's reason. Required on every accepted intent.
- `action:ok` — `data: { action, detail }`, for example `{ meals: 3, cost: 60 }`
- `action:fail` — `data: { action, why }` where `why` is the section 5 failure reason
- `arrive` — `data: { place }`
- `need:low` — once per crossing below `sufferingThreshold`, `data: { need }`
- `day` — at each 00:00, `data: { day, dayName }`

The UI reads the trace; it never re-derives history (invariant 3).

## 9. Boot, loop, and the window bridge

`loop.ts` drives real time: **default 4000 ms per sim hour** (about 66 ms/tick), speeds
`0.25x, 1x, 2x, 4x` and pause. It must:

- accumulate real elapsed time and step whole ticks (never one tick per rAF);
- clamp catch-up to 120 ticks per frame after a stall;
- **auto-pause when `document.hidden`** and resume on visibility, with no catch-up burst.

Keep the bridge shapes stable — E2E depends on them:

```ts
window.__inkState = {
  ready: boolean, tick: number, day: number, dayName: string, hour: number, minute: number,
  speed: number, paused: boolean, eventCount: number,
  minds: Array<{ id, at, hunger, energy, social, money, fridge, action, reason, source }>,
}
window.__inkControl = {
  setSpeed(n), pause(), resume(), step(ticks), seek(tick), state(), events(sinceSeq?),
}
```

`seek(tick)` re-simulates from `createWorld(seed)` with the rule brain (cheap: a week is
about 10k ticks). It is a dev and E2E affordance, not a UI feature in this phase.

## 10. Gates — all must be green

1. `npm run build` clean (includes tsc `--noEmit`).
2. `npm run test` green, including your four new test files:
   - `ink-world.test.ts`: layout and road graph well-formed; every place reachable from
     every other; path lengths symmetric; door coordinates match section 3.
   - `ink-step.test.ts`: needs decay at exactly the section 2 hourly rates over 60 ticks;
     sleeping flips the hunger and energy rates; social rises **only** when both minds are
     at `center` and not when one is alone; wage accrues only inside open hours.
   - `ink-actions.test.ts`: every row of the section 5 table, success **and** each distinct
     failure — buy on a Saturday, buy with 12 money, buy 6 into a fridge holding 5, eat from
     an empty fridge, work at 19:00, work while at the market, go somewhere you already are.
   - `ink-determinism.test.ts`: two `createWorld(42)` runs of 7 sim days under the rule
     brain produce identical `inkHash(state)` and identical event logs.
3. `npx playwright test e2e/ink.spec.ts` green. Assert in **sim ticks**, never wall clock
   (`CLAUDE.md` E2E rules; keep `--use-angle=default`, never add swiftshader flags):
   - `/ink` boots and the bridge reports `ready`;
   - stepping through `__inkControl.step()`, one sim day elapses and the dots' `pos` changes;
   - a mind given `go_market` ends up with `at === 'market'` within 40 ticks;
   - under the rule brain a 3-day run records **zero** `buy` and **zero** `work` events and
     non-zero `sufferedHours` — proving the rule brain is as dumb as section 6 demands;
   - a scripted `buy` intent on Saturday produces `action:fail` whose reason names the weekend.
4. A 7-day headless run under the rule brain never throws, never NaNs a need, and never puts
   a mind off the road graph. Add this as an assertion inside `ink-determinism.test.ts`.

## 11. Your report — `audit-reports/ink-p1-report.md`

State, with measured numbers rather than prose claims: the four gate results verbatim; the
needs table after a rule-brain week (per mind: meals eaten, money left, suffered hours); the
tick rate you measured for a week-long headless run; how you made the wobble stable across
frames and how you verified it (name the file that caches the `Path2D`); and every place
where you deviated from this spec, with why. If something is not done, say so plainly — do
not report a gate as green unless you ran it and saw it pass.

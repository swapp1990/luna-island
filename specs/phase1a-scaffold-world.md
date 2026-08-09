# Dispatch A — Scaffold, sim core, island, day/night, time controls

## Your role

You are the SOLE IMPLEMENTER for this dispatch. Work synchronously with your own file/shell tools. NEVER spawn subagents or background processes you don't wait for. NEVER run any `git` command (no init/add/commit/stash — the orchestrator owns git). Do not edit `README.md`, `CLAUDE.md`, `plans/`, or `specs/`. Follow this spec exactly; where it pins code or values, copy them verbatim. If a gate can't be made green after 3 distinct fix attempts, STOP and report honestly instead of looping.

Working directory: `D:\MyProjects\Claude\luna-island` (this repo). It currently contains only docs (`README.md`, `CLAUDE.md`, `plans/`, `specs/`, `logs/`, `.gitignore`).

## What you're building

The foundation of an emergent-civilization sim: a deterministic tick-based simulation core (pure TypeScript, no rendering deps), a procedurally generated island rendered in plain three.js with a full day/night cycle, time controls (pause/1×/8×/64×), and a timeline scrubber that reconstructs any past moment. No agents yet (next dispatch) — but all agent types are defined now.

## Stack (exact — no other runtime deps)

- deps: `react`, `react-dom`, `three`
- devDeps: `typescript`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@types/three`, `vitest`, `@playwright/test`
- NO React Three Fiber, NO drei, NO zustand, NO noise/physics/util libraries. Hand-write everything else.
- Do NOT use the interactive `npm create vite` scaffolder (it prompts). Hand-write the config files, then `npm install`.

`package.json` scripts (verbatim):

```json
{
  "dev": "vite --host 127.0.0.1 --port 5175 --strictPort",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview --host 127.0.0.1 --port 5175",
  "test": "vitest run",
  "check": "npm run build && npm run test",
  "e2e": "playwright test"
}
```

## File tree (create exactly this)

```
index.html
package.json
tsconfig.json
vite.config.ts
playwright.config.ts
src/main.tsx
src/App.tsx                — mounts render canvas container + HUD + Timeline
src/loop.ts                — rAF loop, tick accumulator, live/replay modes
src/bridge.ts              — window.__simState / window.__simControl
src/ui/Hud.tsx             — clock + speed buttons (top bar)
src/ui/Timeline.tsx        — scrubber (bottom bar) + Go Live button
src/render/scene.ts        — renderer, camera, OrbitControls, resize
src/render/terrain.ts      — island meshes from tiles + places
src/render/daynight.ts     — sun/moon/sky/fog/home-lights driven by sim time
src/sim/rng.ts             — mulberry32, state get/set
src/sim/types.ts           — pinned below, copy VERBATIM
src/sim/time.ts            — tick ↔ {day, hour, minute}
src/sim/worldgen.ts        — deterministic island generation
src/sim/events.ts          — event trace append/query
src/sim/sim.ts             — Simulation class (advance, snapshot, fromSnapshot, hash)
src/sim/stableStringify.ts — stable-key JSON for hashing
test/determinism.test.ts
e2e/smoke.spec.ts
```

## Pinned code — copy verbatim

`src/sim/types.ts`:

```ts
export type Tick = number // 1 tick = 1 sim minute; 1440 ticks = 1 day

export interface SimTime { day: number; hour: number; minute: number; tick: Tick }

export type TerrainKind = 'water' | 'sand' | 'grass' | 'forest' | 'rock'

export interface Tile { x: number; y: number; kind: TerrainKind; walkable: boolean; elevation: number }

export type PlaceKind = 'home' | 'berry-bush' | 'well' | 'plaza'

export interface Place { id: string; kind: PlaceKind; x: number; y: number; ownerId?: string }

/** All needs 0..1, where 1 = fully satisfied. */
export interface Needs { hunger: number; energy: number; social: number }

export type ActionKind = 'idle' | 'walk' | 'sleep' | 'eat' | 'drink' | 'socialize' | 'wander'

export interface AgentAction {
  kind: ActionKind
  targetPlaceId?: string
  path?: Array<[number, number]>
  /** Human-readable "why" — required, shown in the inspector. */
  reason: string
}

export interface AgentState {
  id: string
  name: string
  color: string // hex like '#e08a5b'
  x: number     // tile coords, float
  y: number
  homeId: string
  needs: Needs
  action: AgentAction
}

export interface WorldState {
  seed: number
  tick: Tick
  width: number
  height: number
  tiles: Tile[] // row-major, length = width*height
  places: Place[]
  agents: AgentState[]
}

export interface SimEvent {
  seq: number
  tick: Tick
  type: string // 'day:start' | 'action:start' | 'action:end' | 'need:critical' | ...
  agentId?: string
  data?: Record<string, unknown>
  /** Human-readable why. REQUIRED for 'action:start'. */
  reason?: string
}

export interface Observation { self: AgentState; time: SimTime; world: WorldState }

export interface Intent { kind: ActionKind; targetPlaceId?: string; reason: string }

/** THE brain seam. UtilityBrain (Phase 1) and LunaBrain (Phase 3, LLM) both implement this. */
export interface Brain { decide(obs: Observation, rng: Rng): Intent }

export interface Rng {
  next(): number // [0,1)
  int(maxExclusive: number): number
  pick<T>(arr: T[]): T
  getState(): number
  setState(s: number): void
}
```

`src/sim/rng.ts` — mulberry32:

```ts
import type { Rng } from './types'

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (m) => Math.floor(next() * m),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    getState: () => a,
    setState: (s) => { a = s >>> 0 },
  }
}
```

## Sim rules (implement exactly)

- **Purity:** nothing under `src/sim/` may import three.js/React/DOM or call `Math.random`/`Date.now`/`performance.now`. All randomness via the `Rng` passed around; all time is `tick`.
- **Time:** 1 tick = 1 sim minute. `time.ts` exports `toSimTime(tick): SimTime` (day starts at 1, world starts Day 1 06:00 — i.e. tick 0 ⇒ day 1, 06:00) and `HOURS = 24`, `TICKS_PER_DAY = 1440`.
- **Simulation class** (`sim.ts`):
  - `new Simulation(seed)` — generates world via `worldgen`, `agents: []` for now, emits event `{type:'world:created'}` then `{type:'day:start', data:{day:1}}`.
  - `advanceTicks(n)` — steps 1 tick at a time. Each tick: increment `state.tick`; emit `day:start` when a new day begins. (Agent stepping lands in Dispatch B — leave a clearly named `stepAgents()` no-op hook.)
  - `snapshot(): SimSnapshot` — deep-copy of `WorldState` + rng state + event `seq` counter. `Simulation.fromSnapshot(snap, events)` restores an identical sim (determinism REQUIRES rng state round-trip).
  - Automatic snapshot ring: keep a snapshot every 180 ticks (plus tick 0) in a `SnapshotStore`.
  - `stateAt(tick): Simulation` — returns a FORKED sim: restore nearest snapshot ≤ tick, `advanceTicks` up to tick. Never mutates the live sim; forked sims never write into the live event trace (they get their own copy-on-fork trace).
  - `hash(): string` — FNV-1a (32-bit, hex) over `stableStringify(state)`.
- **Event trace** (`events.ts`): append-only array with monotonically increasing `seq`; `eventsForAgent(id)`, `eventsInRange(t0, t1)` helpers.

## Worldgen (deterministic, hand-rolled)

48×48 tiles. Elevation = radial falloff from map center combined with 2 octaves of value noise (hand-write value noise: hash tile coords through the rng-seeded integer hash, bilinear-interpolate, no libraries). Classify: elevation < 0.30 water; < 0.36 sand; then grass; forest where a second noise channel > 0.55 (grass only); rock where elevation > 0.78. Water/rock unwalkable. Then place the village: find the largest connected grass region (flood fill); at its centroid put a **plaza** (single place, keep surrounding 2-tile radius clear), a **well** adjacent, **10 homes** in a loose ring (radius 3–5 tiles, on walkable grass, deterministic order), and **8 berry-bushes** scattered on grass/forest tiles 4–12 tiles from the plaza. All from the seeded rng — same seed, same island, always.

## Renderer (plain three.js — cozy low-poly, warm palette)

- `scene.ts`: `WebGLRenderer({antialias:true})`, shadows on (PCFSoft), `PerspectiiveCamera` — careful: `PerspectiveCamera` 50° at world offset ~(+26, 24, +26) looking at island center, `OrbitControls` (from `three/examples/jsm/controls/OrbitControls.js`) with damping, min/max distance 10–90, maxPolarAngle ~80°.
- `terrain.ts`: tiles as unit boxes at stepped heights (water rendered as one large slightly-transparent blue plane at y≈0.06 instead of boxes; sand 0.12, grass 0.20, forest 0.22, rock 0.55 box heights). Merge static tile boxes into few geometries (one per kind) OR use `InstancedMesh` per kind. Trees on forest tiles: `InstancedMesh` (cone `#2f6b3a`-ish + trunk cylinder), slight per-instance scale/rotation jitter **using a render-only rng seeded from tile coords** (NOT the sim rng). Rocks on rock tiles: instanced dodecahedra, greys. Homes: small box + pyramid roof (warm brown/terracotta), one per home place. Well: small stone cylinder. Plaza: flat light-stone disc. Palette: saturated-but-soft greens `#7fae5e`/`#5f9147`, sand `#e2cf9a`, water `#3f7fae`, warm wood `#8a5a38`.
  - CAUTION: if you use `InstancedMesh.setColorAt`, the material must NOT set `vertexColors: true` (instances render black otherwise).
- `daynight.ts`, driven ONLY by sim time (pure function of `SimTime`):
  - Sun `DirectionalLight` orbits: elevation = `sin(π * (t - 6) / 14)` for t∈[6,20] (hours as float), below horizon otherwise. Color `#fff4e0`, intensity 0→1.6 with elevation, casts shadow.
  - Moon `DirectionalLight` `#6f86c9`, intensity 0.25 when sun is down.
  - `HemisphereLight` intensity lerps 0.25 (night) ↔ 0.9 (day).
  - Sky (`scene.background`, single `Color`) + matching fog, lerped through keyframes: 0:00 `#0b1026`, 5:00 `#1a2340`, 6:30 `#f2b28a`, 9:00 `#9ed3ff`, 16:00 `#9ed3ff`, 19:30 `#ff9a5c`, 21:00 `#14183a`, 24:00 `#0b1026`.
  - Home lights: one warm `PointLight` `#ffb066` (intensity 1.2, distance 6) per home, on 18:30–23:00 and 05:00–06:30, else intensity 0.

## Loop, modes, bridge

`loop.ts`: single rAF loop. At 1× speed, 1 tick per real second (accumulator; cap 256 ticks/frame). Speeds: 0 (pause), 1, 8, 64.

Modes:
- `live`: the live `Simulation` advances; scrubber max = live head tick.
- `replay`: entered by `scrubTo(tick)` with tick < live head. Live sim pauses. A forked sim (`stateAt`) becomes the view; the scrubber can be dragged (re-fork); pressing play speeds advance the FORK (deterministic ⇒ identical to history). Forks never touch the live trace. `goLive()` discards the fork, resumes live. If the replay head catches up to the live head, auto-switch to live.

`bridge.ts` (shapes are load-bearing for E2E — exact):

```ts
window.__simState = { ready, mode, day, hour, minute, tick, speed, agentCount, selectedAgentId, eventCount }
window.__simControl = { setSpeed(n), pause(), scrubTo(tick), goLive(), selectAgent(idOrNull) }
```

`__simState` must be refreshed every frame (plain object assignment is fine). `selectedAgentId` is `null` for now; `selectAgent` stores it (used next dispatch).

## UI (React — HUD only; must not re-create the three.js scene on re-render)

- Top bar: `Day 3 — 16:40` (monospace, zero-padded time) + four buttons `⏸ / 1× / 8× / 64×` (active one highlighted). Small, dark translucent, rounded; sans-serif; no CSS framework.
- Bottom bar: full-width range input scrubbing 0..liveHeadTick + a `● LIVE` / `▶ GO LIVE` button (red dot when live, grey + clickable in replay). Show the scrub target time as `Day D HH:MM` next to it.
- Mount three.js into a `<div id="scene">` once (useEffect with empty deps); React state may hold HUD values only (poll via ~4 Hz interval or subscribe — do NOT setState per frame).

## Tests

`test/determinism.test.ts` (vitest, pure node — no DOM):
1. Same seed ⇒ same history: two `new Simulation(42)`, `advanceTicks(4320)` each ⇒ equal `hash()`, equal event count, deep-equal last event.
2. Different seed ⇒ different `hash()` (seed 42 vs 43 after 1000 ticks).
3. Seek correctness: simA advanced 4320; `simA.stateAt(2500).hash()` === fresh `new Simulation(42)` advanced 2500 `.hash()`.
4. Snapshot round-trip: `fromSnapshot(sim.snapshot())` then both advance 500 more ⇒ equal hashes.

`e2e/smoke.spec.ts` (@playwright/test):
1. Page loads; `window.__simState.ready === true`; a `<canvas>` exists.
2. Time advances: at speed 1, `tick` strictly increases within 3 s.
3. Fast-forward: `setSpeed(64)`; tick gains ≥ 100 within 2.5 s.
4. Scrub: after ≥ 200 ticks exist, `scrubTo(50)` ⇒ `mode === 'replay'` and `tick === 50`; `goLive()` ⇒ `mode === 'live'` and tick ≥ previous head.
5. Screenshots for visual QA: drive time to ~14:00 (day) and screenshot `artifacts/smoke-day.png`; then to ~22:00 (night, home lights on) and screenshot `artifacts/smoke-night.png`. (Create `artifacts/` if missing.)

`playwright.config.ts` — copy this proven real-GPU config verbatim (adjust only port):

```ts
import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5175)
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const softwareGl = process.env.DEMO_SOFTWARE_GL === '1'
const glArgs = softwareGl
  ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-webgl', '--use-angle=default', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: glArgs },
  },
  webServer: {
    command: `${npxCommand} vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
})
```

## Acceptance gates — run all, paste evidence

1. `npm run build` → exit 0 (typecheck + vite build).
2. `npm run test` → all vitest tests pass.
3. `npx playwright install chromium` (may be cached) then `npm run e2e` → all pass, both screenshots exist and are non-black (check file size > 20 KB).
4. No `Math.random`, `Date.now`, or `performance.now` anywhere under `src/sim/` (grep and paste the empty result).

## Final report (your last message — this exact structure)

- **BUILT**: file list, one line each.
- **GATES**: each gate with the command and the decisive last lines of real output (pass counts, exit codes).
- **DEVIATIONS**: anything you did differently from this spec and why (should be empty or tiny).
- **KNOWN GAPS**: honest list.

# Dispatch F — Watchability pack: bubbles, follow camera, town ticker, walk life

## Your role

You are the SOLE IMPLEMENTER. Work synchronously. NEVER spawn subagents. NEVER run `git`. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Read existing code first; extend in its style. If a gate won't go green after 3 distinct fix attempts, STOP and report. All `CLAUDE.md` invariants hold — everything in this dispatch is render/UI-side except noted; `src/sim/` changes are limited to §3's event additions.

Working directory: `D:\MyProjects\Claude\luna-island`.

## 1. Status bubble above the selected villager

- A small dark rounded bubble (HTML overlay, same visual family as HUD/inspector: translucent `#1c2333ee`, radius 8px, 11px font, subtle border) floating ~0.9 world-units above the selected agent's head, with a little ▼ tail.
- Content: emoji + micro-status derived from current action, e.g. `🫐 Foraging`, `😴 Sleeping`, `💬 Chatting`, `🚶 Wandering`, `🏠 Heading home`, `💧 At the well`. Map every ActionKind; walking to a target shows the destination flavor (`→ berry bushes`).
- **Positioning mechanics (pinned):** ONE absolutely-positioned div in the canvas container, position updated EVERY FRAME in the render loop by projecting the agent's interpolated world position to screen (`vector.project(camera)` → CSS `transform: translate(-50%, -100%) translate(xpx, ypx)`); content updated at ~4 Hz or on action change. NO React state per frame — direct DOM mutation from the loop (keep a ref). Hidden when nothing selected or the agent is behind the camera (`projected.z > 1`).
- In replay mode it reflects the replay fork's state (same source the inspector uses).

## 2. Critical-need "❗" bubbles (ambient, all villagers)

- When any agent emits `need:critical`, show a mini bubble (just `❗`, or `🍽️`/`😴`/`💬` by need) above them for 3 real-time seconds, then fade. Max 5 concurrent (drop oldest). Same projection mechanics — one pooled set of 5 divs, no per-frame React.

## 3. Town ticker (bottom-left feed)

- Collapsible panel, bottom-left (above the timeline), ~280px wide, max 6 rows visible, `data-testid="ticker"`. Rows: `14:03 · Mira — Hungry, foraging berries` — derived from `action:start` (only when the action KIND changed vs that agent's previous action — no wander spam), `need:critical`, and `day:start` ("☀️ Day 2 begins").
- Newest on top, ~40 rows retained, click a row → selects that agent (and the bubble/inspector follow). Updates at the inspector's 4 Hz poll from the event trace; in replay mode shows events ≤ replay tick.
- **Sim-side (allowed, additive):** if `action:start` events don't already carry enough to render rows without lookups, add fields to event `data` (e.g. agent name) — additive only, determinism tests must stay green.

## 4. Follow camera

- `Follow` toggle button in the inspector header (`data-testid="follow-toggle"`). While on: each frame, lerp OrbitControls' target toward the selected agent's interpolated position (factor ~0.08/frame) and translate the camera by the same delta (preserve the user's orbit offset; user can still orbit/zoom while following). Turning off or deselecting stops following. Following works in replay mode too.

## 5. Walk life

- Walking agents: vertical bob `sin(t)` ~0.04 amplitude tied to distance travelled (not wall time — pauses when paused), plus a tiny lean in the walk direction.
- Socializing agents standing at the plaza: yaw to face the nearest other socializer; idle micro-bounce every few seconds (scale pulse 1.00→1.03), offset per agent so they don't bounce in sync.
- Sleeping pose unchanged.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep of `src/sim/` still empty.
2. New e2e in `e2e/agents.spec.ts` (or new file):
   - Select an agent via bridge → bubble div visible with non-empty text (`data-testid="status-bubble"`).
   - Ticker exists and gains rows as sim runs at 64×.
   - Clicking first ticker row selects an agent (`selectedAgentId` set).
   - Follow toggle: enable, run 64× for 2s, assert OrbitControls target moved (expose `window.__cameraTarget` DEV-gated or additive bridge field).
3. Screenshot `artifacts/watchability.png`: afternoon, an agent selected with visible bubble, ticker populated, inspector open. Non-black, > 20 KB.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **DEVIATIONS** / **KNOWN GAPS**.

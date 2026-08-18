# Dispatch P3-13 — Interaction staging: connect the actor to the target so events read on screen

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `src/render/actionLanguage.ts` + `src/render/agents.ts` (P3-11/12 channels you're extending), `src/render/overlays.ts` (current wall-clock speech bubbles), `src/mind/conversation.ts` (`mind:say` events carry `text`; conversation state carries `partnerId`), `scripts/soak-highlights.mjs` first.

## Why (user verdict on the current reel)

"When someone examines, or is talking with someone, or commissions something — it's not clear from the screenshot what I am seeing." Correct: the action language shows each agent's own state, but interactions have no visible relationship to their target or partner. Talk = adjacent pegs (bubble is wall-clock TTL, usually missing in stills). Examine = a lean + a glyph on the agent, nothing on the object. Commission = no pixel changes at all.

## The law (unchanged)

All staging derives from `stateAt(tick)` + events in a trailing window. Same (tick, alpha) → same frame, live or photographed. Wall-clock BANNED for anything state-driven.

## 1. Event-derived speech bubbles (replaces wall-clock TTL as the canonical channel)

- Derive visible bubbles from `mind:say` events with `tick - event.tick <= SAY_WINDOW` (~8 ticks): speaker gets a bubble with the ACTUAL utterance text (truncate ~60 chars, ellipsis). Latest say per agent wins. Works identically live, scrubbed, photographed.
- The existing wall-clock HTML speech path: keep it only if it costs nothing to leave, but the event-derived bubble must be the one photo mode shows. For photo subjects render it as a 3D canvas sprite (the P3-11 glyph lesson — HTML doesn't composite into stills). Bubble suppresses the glyph as today.
- Non-Luna "sheep talk" (`selectSheepReply` chatter): if those also land as events with text, same treatment; if not, leave sheep as-is and note it.

## 2. Facing discipline (bodies tell the story)

Render-side yaw targets, applied with the existing smooth yaw lerp (live) and snapped in photo/paused poses:

- **Conversation**: while an agent has an active conversation partner (state `partnerId`, or a say-event pair within the window), both turn to face each other. Heads/eyes already ride yaw from P3-12 — that's the payoff.
- **Examine**: face the examine target during the action AND for the burst window after the event (currently the lean can point anywhere).
- **Commission**: the commissioner faces the site through the event window.
- Facing must not fight walking (pathing yaw wins while moving) and must not touch sim state.

## 3. Target-side + ceremony staging

- **Examine**: the 🔍 glyph moves to hover over the TARGET object (bush/board/home/farm) during action + window; the agent keeps the lean + reach. Target keeps the existing shimmer burst. One glance = "she is inspecting THAT."
- **Commission** (`construction:commissioned` window, ~6 ticks): scroll/blueprint prop appears in the commissioner's hand (tool-slot pattern), AND the site sprouts its ceremony — 4 corner stakes + a small rising flag (fixed layout, seq-phased). If the site already renders posts at progress 0, make the stakes/flag visually distinct from ambient site chrome.
- **Trade/coins** (cheap win, already half-done): coin-glint burst exists — add facing between payer/payee within the window if both are adjacent.

## 4. Photographer

No new flags. The staging is event-derived, so `scrubTo(event.tick + 1..2)` inside windows just works. But bump the pose tick selection for `mind:say`, `discovery:examined`, `construction:commissioned` moments to land INSIDE their staging windows (e.g. tick+1) if it doesn't already.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass; purity grep `src/sim/` empty; ZERO `src/sim/` edits; `utilityBrain.ts` SHA unchanged; wall-clock grep on `agents.ts`/`actionLanguage.ts` still empty.
2. Registry vitest: say-window bubble derivation (text, truncation, latest-wins, expiry); examine glyph relocation to target; commission ceremony window; facing-target resolution (partner > examine target > commission site > none); determinism (same events+tick → same staging twice).
3. E2E (mock): two conversing agents face each other (yaw probe) and speaker bubble text matches the say event; examine puts 🔍 on the target (probe target id); commission window reports scroll prop + site ceremony via probe.
4. **The proof reel:** re-shoot `artifacts/soak-1786938450347-world.json`. Shot 01 (Tama talks to Kiba) must show the bubble WITH TEXT and the two facing each other. Shots 02/07 (examines) must show 🔍 over the bush/home. Shots 10/12 (commissions) must show scroll + stakes/flag ceremony. Both contact sheets regenerated; double-shoot manifests identical. Per-shot critique.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **REEL v7** (per-shot: does the interaction read now?) / **DEVIATIONS** / **KNOWN GAPS**.

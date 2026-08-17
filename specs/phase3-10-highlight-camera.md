# Dispatch P3-10 — Highlight camera: replay-driven photo mode + shareable soak moments

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously with Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Implement THIS spec; better ideas go in DEVIATIONS as suggestions. Minimal diffs; the orchestrator red-teams your report against the diff. If a gate won't go green after 3 distinct fix attempts, STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md` invariants, `src/bridge.ts`, `src/loop.ts` (scrubTo/goLive/replay), `src/render/scene.ts` (camera + follow helpers), `src/sim/persist.ts` (or wherever exportWorldJson serializes), and `scripts/soak-political.mjs` first.

## The idea

Soak runs produce history; nobody sees it. Because the sim is deterministic and replay never re-calls the LLM, ANY recorded moment can be re-posed exactly by `stateAt(tick)`. So: a **photographer script** loads a world export, scrubs to each notable event, frames the subject in a **photo mode** (HUD hidden, cinematic caption card), and screenshots. Output: a folder of share-ready 1920×1080 stills + a `highlights.json` manifest with post-ready captions. Works on any past export — the soak harness just invokes it at the end.

## 1. World import (the missing primitive)

- `exportWorldJson()` exists; add the inverse: `window.__simControl.importWorldJson(json: string): Promise<void>` (or sync if the architecture allows) — reconstructs the world + full event trace + snapshots so `scrubTo(tick)` works across the whole recorded timeline, exactly as if the run had just happened in this tab. Reuse the persistence layer's deserialization — do NOT write a second parser. If the export format lacks something replay needs, extend the export additively (bump save version additively per the existing convention).
- Bridge shapes are additive-only (CLAUDE.md invariant 8) — never remove/rename existing fields.

## 2. Photo mode (`window.__simControl.photo`)

Additive bridge object:

- `photo.enter(opts: { caption: string, subtitle?: string, agentId?: string, placeId?: string, zoom?: number }): void`
- `photo.exit(): void`
- Entering: hide ALL React HUD/panels/toasts (a single `photo-mode` class on the app root + CSS, not per-component surgery), suppress world-space indicator sprites/speech bubbles UNLESS they belong to the subject agent (a talking subject keeps its bubble — that's the shot), and render a **caption card**:
  - Bottom-left, over a subtle bottom gradient (readable on day and night shots).
  - Line 1 (small caps, letter-spaced, muted): `LUNA ISLAND — DAY 4, 06:59` (sim day/time of the posed tick).
  - Line 2 (large, the headline): the caption, e.g. `Mira examines the farm`.
  - Line 3 (optional, italic, muted): the subtitle, e.g. a short quote or event detail.
  - Typography: match the existing HUD family but tuned for a title card (weight/size/spacing). No emoji in the card. A very subtle vignette on the frame edges is allowed; NO letterbox bars; never alter the sim's own lighting/colors — the world's day/night look IS the aesthetic.
- Camera: when `agentId`/`placeId` given, frame the subject using the existing follow/center helpers — closer than the default overview (subject clearly the protagonist, ~1/3 rule offset rather than dead-center if cheap to do), `zoom` as a multiplier. Renderer-side code may do whatever it likes (it's not sim); keep it deterministic-enough that the same tick+opts frames the same shot.
- Photo mode is render/UI-only. ZERO `src/sim/` changes for this section.

## 3. Moment registry + selection (pure, testable)

New module (e.g. `src/replay/highlights.ts` — pure TS, no DOM): given the event array, return scored candidate moments:

- Registry (declarative, one entry per type): `discovery:examined` (high), `institution:proposed/voted/closed/sanctioned/claimed` (highest), `construction:commissioned` (mid), `construction:completed` (high), `ownership:transfer` (high when `firstPrivate`), `agent:collapsed` + `agent:recovered` (mid), `relationship:close` (mid, FIRST occurrence per pair only), first `mind:say` of each conversation-pair per day (low; cap these hard), `mind:reflection` is text-only — skip.
- Each entry yields `{ tick, type, priority, agentIds, caption, subtitle? }`. Captions are **plain declarative English from event data** — `Mira examines the farm`, `Ren's house is finished`, `Bram collapses from hunger` — no fabricated detail beyond what the event carries; agent display names from the world, never raw ids.
- Selection: top N (default 12) by priority, then de-dup (max 2 per type unless fewer candidates), then spread across sim-days (don't let one busy morning eat the reel). Deterministic: same events → same picks in the same order.

## 4. Photographer script (`scripts/soak-highlights.mjs`)

`node scripts/soak-highlights.mjs <world.json> [--out artifacts/highlights/<basename>] [--max 12] [--port 5181]`

- Boots its own vite (mock brain / `?brain=off` if that exists — the photographer must make ZERO LLM calls; assert provider is not codex/grok), imports the world JSON via the new bridge, waits ready.
- For each selected moment: `scrubTo(tick)`, wait for the reconstruction to settle (poll `__simState`, not wall sleeps), `photo.enter({...})`, one settled frame, then Playwright screenshot 1920×1080 → `NN-<type>-D<day>-<hhmm>.png`; `photo.exit()` between shots.
- Writes `highlights.json` manifest: run params, and per shot `{ file, tick, day, time, type, agents: [names], caption, subtitle }` — captions written so they can be pasted into a social post as-is.
- Fail-soft per shot (one bad pose logs and continues; the reel survives).
- `scripts/soak-political.mjs`: after the world export lands, invoke the photographer on it (child process, fail-soft — a photographer crash must not touch soak exit codes or artifacts). New flag `--no-highlights` to skip.

## 5. Aesthetic bar (this is a share-quality gate, not a nicety)

Self-verify EVERY produced still: subject visible and framed (not off-screen, not occluded by the caption card), card text readable on both day and night shots, no dev HUD remnants, no toasts. Build a contact sheet (all stills tiled into one image via Playwright or a tiny canvas page — your choice) and eyeball it before reporting. If a shot class is consistently ugly (e.g. collapse shots at night unreadable), fix the framing/card, don't drop the class silently.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; `npm run e2e` all pass (mock; `PLAYWRIGHT_PORT` if 5175 busy); purity grep of `src/sim/` empty; `src/sim/utilityBrain.ts` untouched (SHA256 before/after). `src/replay/highlights.ts` must also be pure (no DOM/three imports — grep it).
2. New vitest: moment registry produces correct captions from synthetic events; selection determinism (same events → same reel twice); priority + per-type de-dup + day-spread behavior; first-per-pair logic for `relationship:close`; N cap respected.
3. Round-trip gate: export → `importWorldJson` → `stateAt` hash matches the original at 3 probe ticks (reuse the determinism-test hashing).
4. **Real shoot:** run the photographer against `artifacts/soak-1786938450347-world.json` (the 5-sim-day run: 4 examines, 2 collapses+recoveries, 2 commissions, 1 completed house, 1 firstPrivate ownership, 33 friendships). It must produce ≥8 stills + manifest with zero LLM calls. Paste the manifest JSON and the contact-sheet path in the report.
5. E2E (mock): photo mode enter/exit leaves `__simState` consistent; HUD hidden while active (assert a HUD element is not visible); caption card text matches opts.

## Final report (exact structure)

**BUILT** / **GATES** (evidence) / **THE REEL** (manifest + contact sheet path + your own honest aesthetic critique of the stills, shot by shot) / **DEVIATIONS** / **KNOWN GAPS**.

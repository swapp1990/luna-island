# Dispatch P3-10b — Hero framing: make the stills worth posting

## Your role — the leash

You are the SOLE IMPLEMENTER. Work synchronously with Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs; report red-teamed against the diff. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. This revises your P3-10 work (photo mode in `src/loop.ts`/`src/render/scene.ts`/`src/App.tsx`, photographer `scripts/soak-highlights.mjs`). The orchestrator reviewed the contact sheet at `artifacts/highlights/soak-1786938450347-world/contact-sheet.png`.

## The verdict on v1 (what you are fixing)

The pipeline is sound and the night mood is genuinely good. Two failures make the stills unpostable:

1. **Framing is village-postcard wide.** In 10 of 12 shots the subject is a distant peg. Shot 02 (Wren/berry bush) is mostly empty lawn. These are establishing shots, not moments.
2. **The caption card vanishes at timeline size.** On a phone-width 16:9 preview the text is illegible — and the caption carries the story.

## 1. Hero framing (render-side)

- **Dolly IN.** Default photo framing: subject fills a meaningful share of frame — as a target, the subject (agent or place) should span roughly **1/6 to 1/4 of frame height**, not the current speck. Tune the actual distance by eye against the real shots.
- **Drop the camera.** Lower the elevation angle for photo shots (roughly 20–35° above horizon vs the current high-orbit look) so frames gain depth — foreground subject, mid-ground village, sky/sea horizon. If terrain occludes at low angle for some subjects, auto-raise until clear (deterministic; no random jitter).
- **Rule-of-thirds offset:** place the subject at a lower-third / off-center anchor so the caption card (bottom-left) never covers it — bias the subject toward the right or upper-right of frame.
- **Place-first shots:** for `construction:*`, `discovery:examined`, and `ownership:transfer`, frame the PLACE as the hero (house/site/bush/board fills the frame target), with the agent visible nearby if present. Your v1 DEVIATION suggestion (frameOnly/place-priority) is hereby accepted — implement it.
- **Pair shots** (`relationship:close`, `mind:say`): frame the midpoint of the two agents, close enough that both are individually readable.
- Keep the subject selection ring. Keep sim lighting untouched.

## 2. Caption card, timeline-legible

- Scale the card so the headline is readable when the 1920×1080 still is viewed at ~600 px wide (X timeline): headline ≈ **56–72 px** at full resolution, kicker (LUNA ISLAND — DAY N, HH:MM) ≈ 26–32 px, subtitle ≈ 30–36 px. Adjust padding/gradient to match; keep it bottom-left, keep the day/night-safe gradient.
- Long subtitles: clamp to 2 lines with ellipsis; never let the card exceed ~40% of frame width or ~30% of height.

## 3. Re-shoot + self-judge

- Re-run the photographer on `artifacts/soak-1786938450347-world.json` (same 12 moments expected — selection unchanged). Regenerate stills + contact sheet in place.
- Additionally produce a **thumbnail sheet**: the same 12 stills downscaled to 600 px wide and tiled — this is the "does it read on a timeline" proof. Save as `contact-sheet-thumb.png`.
- Judge every still against: subject obviously the protagonist within 1 second of looking; caption headline readable on the THUMBNAIL sheet; card not covering the subject. Name any shot that still fails and why.

## Gates

1. `npm run build` exit 0; `npm run test` all pass; photo e2e (`e2e/photo.spec.ts`) passes with `--retries=0`; purity grep of `src/sim/` empty; NO `src/sim/` changes at all in this dispatch; `utilityBrain.ts` SHA unchanged.
2. Re-shoot completes with zero LLM calls (`decideCalls` before == after), 12 stills + both contact sheets + manifest regenerated.
3. Report pastes: out dir, both sheet paths, and the per-shot judgment table.

## Final report (exact structure)

**CHANGED** (framing numbers you settled on: distance, angle, offsets, font sizes) / **GATES** / **THE REEL v2** (per-shot table: subject size ok? caption readable at thumb? card clear of subject?) / **DEVIATIONS** / **KNOWN GAPS**.

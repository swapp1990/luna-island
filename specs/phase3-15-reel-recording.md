# Dispatch P3-15 — The fast-forward reel: 50s of the first run, recorded from replay

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diffs. 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`. Read first: `D:/MyProjects/Claude/playwright-evidence/SKILL.md` (the field-tested recording recipe — follow it), `src/loop.ts` (replay fork stepping, `loadDay`, day-end auto-pause, `frameDtCap`, SPEEDS = {0,1,8,64}), `src/bridge.ts` (`__simControl`: `setSpeed`, `scrubTo`, `photo.enter/exit`, `importWorldJson`, `selectAgent`), `scripts/soak-highlights.mjs` (import + scrub + photo-mode plumbing you will reuse).

## What this is for

A marketing reel that introduces the project by showing its FIRST five-day run: a competent, busy, incurious village. It ends on the notice board that all 24 villagers noticed and none read. This is a real artifact for a story blast — the numbers below are contractual, not suggestions.

**Source world (the first run):** `artifacts/soak-1786938450347-world.json` (~39 MB, 5 sim-days, head tick **7203**).
Highlight ticks are in `artifacts/highlights/soak-1786938450347-world/highlights.json` — READ IT and use its actual ticks/captions rather than trusting this spec's times.

**Facts already extracted for you — do NOT spend time parsing the 39 MB export (a previous attempt burned 18 minutes here):**
- `notice-board-0` is at tile **(27, 23)**; `plaza-0` is at **(25, 22)**. Use these for the payoff push; verify only by looking at the rendered frame, not by re-parsing.
- The export's shape is `{formatVersion, seed, tick, snapshot:{state, rngState, eventSeq, events}, pinnedDayStartSnapshots, fineSnapshotRing, events, dayArchives, stats}` — places live at `snapshot.state.places` (32 of them), not at the top level.
- **Encoding trap:** the file contains non-ASCII bytes. Reading it with a default Windows codec raises `UnicodeDecodeError: 'charmap' codec can't decode byte 0x9d`. In Python use `io.open(path, encoding='utf-8')`; in Node `fs.readFileSync(path, 'utf8')`. If you only need the board tile, you don't need to read it at all — the numbers are above.

## The storyboard (approved — hit these numbers)

| # | Beat | Duration | Speed | On-screen |
|---|---|---|---|---|
| 1 | Cold open, island wide, dawn D1 | 3.0s | paused | Card: "24 villagers. 6 of them think with an LLM. Nobody wrote their behavior." |
| 2 | D1 sweep | 5.0s | 64× | clock HUD visible |
| 3 | Slow beat: Wren examines the berry bush (D1 ~08:27) | 3.0s | 1× | photo caption from the manifest |
| 4 | D1 night sweep + slow beat: Bram collapses (D1 ~22:06) | 4.0s + 3.0s | 64× → 1× | "Bram collapses from hunger" |
| 5 | D2 sweep + slow beat: Mira and Joss grow close | 5.0s + 2.5s | 64× → 1× | manifest caption |
| 6 | D3 sweep + slow beat: Ren commissions a house (D3 ~18:01) | 5.0s + 3.0s | 64× → 1× | manifest caption |
| 7 | D4–D5 sweep + slow beat: the house is finished (D5 ~11:37) | 6.0s + 3.0s | 64× → 1× | manifest caption |
| 8 | Payoff: slow push onto `notice-board-0`, nobody near it | 5.0s | paused | Card: "All 24 villagers noticed this board. In five days, not one read it." |
| 9 | End card | 3.0s | — | "Next: what happened when we changed what they could see." |

Total ≈ 50s (±4s acceptable). Every card and slow beat must hold ≥3.0s of **visually static, readable** screen time (2.5s for beat 5 only).

## How to build it

1. **New script `scripts/shoot-reel.mjs`** (do NOT bolt this onto `soak-highlights.mjs`; it may share helpers by import/copy): boots its own vite on a dedicated port, `?brain=off` (assert provider is not codex/grok — ZERO LLM calls), imports the world, then drives the storyboard.
2. **Recording:** Playwright `video: 'on'` per the skill's recipe, viewport 1920×1080, headed with the real GPU (`--use-angle=default`, no swiftshader). One flowing test, paced pauses. Copy the webm out, transcode to mp4 with ffmpeg, **delete the intermediate webm** (mp4 only). Windows ffmpeg is typically `C:/Users/swapp/bin/ffmpeg.exe` or `C:/FFmpeg/bin/ffmpeg.exe`.
3. **The import head must be trimmed.** The ~39 MB import takes 30–60s and video recording starts at page creation. Record a marker: after import completes, note `Date.now()` relative to recording start (or hold a distinctive full-frame card for 0.5s), then `ffmpeg -ss <offset>` so the final mp4 begins at beat 1. State the measured offset in the report.
4. **Sweeps vs beats.** Sweeps: `setSpeed(64)` with the normal HUD visible so the clock visibly flies. Slow beats: `setSpeed(1)` (or pause) + `photo.enter({caption, subtitle, agentId|placeId})` so the caption card and the P3-11/13 staging (fallen posture, 🔍 on target, ceremony stakes) are on camera; `photo.exit()` before resuming the sweep.
   - Replay is **day-scoped and auto-pauses at day end** — use `loadDay(n)` per segment and `scrubTo` to jump to each beat's tick. Do not fight the auto-pause; use it as the segment boundary.
   - Where a jump would look jarring, prefer a `scrubTo` a few ticks BEFORE the beat then 1× into it, so the action plays rather than teleports.
5. **Outputs** (mp4 only, both from the same run or two runs — your choice):
   - `evidence-videos/luna-island-first-run-16x9.mp4` (1920×1080)
   - `evidence-videos/luna-island-first-run-9x16.mp4` (1080×1920 — re-record at that viewport; do NOT letterbox-crop the 16:9)
   Add `evidence-videos/` to `.gitignore` if not already ignored.
6. **A `REEL.md`** next to the videos listing, per beat: intended duration, MEASURED duration, tick range, speed, caption text, and whether the staged action was visible.

## Gates (measure the encoded file — an engine's own "ok" is not evidence)

1. `npm run build` exit 0; `npm run test` all pass; existing e2e untouched and passing; ZERO `src/sim/` edits; no LLM calls during the shoot (assert `decideCalls` before == after, quote it).
2. **Measured-file QA, quoted in the report:** `ffprobe` (or ffmpeg) output for BOTH mp4s showing **video-stream duration** (not container), dimensions, and fps. 16:9 must be 1920×1080; 9:16 must be 1080×1920. Total duration within 46–54s.
3. **Held-still verification:** for each card/slow beat, prove ≥3.0s (≥2.5s for beat 5) of readable screen time. Do this by MEASURING, not asserting: extract frames at 1 fps (`ffmpeg -vf fps=1`) across the whole clip, build a contact sheet, and confirm each caption appears in ≥3 consecutive 1-fps frames. Paste the frame-index ranges per beat and save the sheet as `evidence-videos/reel-contact-sheet.png`.
4. **Content check on the contact sheet (you must look at it):** the payoff beat actually shows the notice board with no villager standing on it; the collapse beat shows a fallen villager; captions are legible at 600 px wide. Name any beat that fails.
5. Reproducibility: state whether a second run produces the same beat timings (it should — replay is deterministic; recording jitter is acceptable, content drift is not).

## Report (exact structure)

**BUILT** / **GATES** (ffprobe output quoted, frame-range table, contact-sheet path) / **BEAT TABLE** (intended vs measured, from REEL.md) / **CONTENT CRITIQUE** (your honest read of the contact sheet, beat by beat) / **DEVIATIONS** / **KNOWN GAPS**.

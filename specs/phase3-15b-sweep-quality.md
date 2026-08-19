# Dispatch P3-15b — The sweeps look like a debug tool: fix chrome + camera scale

## Your role — the leash

SOLE IMPLEMENTER. Synchronous. NEVER spawn subagents. NEVER run git. No edits to `README.md`, `CLAUDE.md`, `plans/`, `specs/`. Minimal diff on top of your P3-15 work (`scripts/shoot-reel.mjs`). 3 failed attempts on a gate → STOP and report.

Working directory: `D:\MyProjects\Claude\luna-island`.

## What's wrong (orchestrator reviewed `evidence-videos/reel-contact-sheet.png`)

The eight held beats PASS — Wren's 🔍 lean, Bram fallen with the red pulse, the pair, the flag-and-stakes commission, the finished house, and especially the five-frame board payoff all read well. Keep them exactly as they are.

**The five sweeps fail, and they are 27 of the 51 seconds.** Frames 3–7, 11–14, 18–22, 26–30, 34–39 show:

1. **The full dev HUD** — right-side panels, event log, bottom portrait dock, timeline scrubber, speed buttons. It reads as a screen recording of a debug tool. My original spec asked for "the normal HUD so the clock flies", which was wrong; you followed it correctly.
2. **Camera far too wide** — the island is a small object in the middle of the frame and the villagers are sub-pixel specks. Nothing appears to be alive, which is the opposite of what a sweep is for.

## The fix

1. **Chrome off during sweeps too.** Use photo mode for the entire reel (it already hides HUD). The caption card's kicker line already renders `LUNA ISLAND — DAY N, HH:MM`, so keep a **kicker-only card** during sweeps: no headline, no subtitle, just the clock. **It must update as sim time advances** — re-enter/refresh the card at least every 0.5s of the sweep so the day/time visibly ticks (that ticking clock is the whole point of a sweep). If `photo.enter` snapshots the tick, call it repeatedly or add the smallest additive refresh hook.
2. **Village-scale sweep camera.** Frame the village so homes read as buildings and villagers read as figures with visible motion — target the plaza/village cluster filling most of the frame, at the same cinematic elevation the beats use (~24–36°). Concretely: a villager should be at least ~40 px tall in the 1080p frame during a sweep. Verify by measurement on the contact sheet, not by intent.
3. **Match the payoff card's type treatment for beats 1 and 9.** The board card (frames 43–47) is legible and cinematic; the opening card (frames 0–2) is small text over a distant dark island. Give beats 1 and 9 the same card scale, and put beat 1's camera at village scale too.
4. Everything else — beat ticks, captions, durations, the 46–54s total, the two aspect ratios, the import-head trim — stays as shipped.

## Gates

1. Re-shoot both aspect ratios. `ffprobe` video-stream duration/dimensions quoted again; total stays 46–54s; 1920×1080 and 1080×1920.
2. Regenerate `evidence-videos/reel-contact-sheet.png` with frame indices. **Read it yourself** and report, per sweep: is the HUD gone, does the clock kicker advance across the sweep's frames (quote the times you can read), and roughly how tall is a villager in pixels.
3. Held-still table again (≥3 consecutive 1-fps frames per card/beat; 2.5s allowed for the pair beat).
4. `decideCalls` before == after == 0. Zero `src/sim/` edits. `npm run build` + `npm run test` still green (206+).
5. Update `evidence-videos/REEL.md`.

## Report

**CHANGED** / **GATES** (ffprobe + held-still + villager-height measurement) / **SWEEP CRITIQUE** (per sweep, from the sheet — HUD gone? clock advancing? alive?) / **KNOWN GAPS**.

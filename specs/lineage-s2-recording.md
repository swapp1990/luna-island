# Dispatch LINEAGE-S2 — Deterministic recordings of the `/lineage` site

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. Do NOT run any LLM run. You may run Playwright in headed or headless mode with the project's real-GPU flags; if Chromium cannot launch in your sandbox, implement and unit-test everything, run the capture with the mock run if possible, and report exactly what you could not run (the main session will run the capture). Do not edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`, `src/**`, `scripts/luna-*.ts`, `scripts/lineage-run.mjs`, `scripts/lineage-runs.ts`, `vite.config.ts`, or `playwright.config.ts` (create a new config instead). If a gate will not go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `CLAUDE.md`, `plans/lineage-showcase.md` §3 (the shot list is the contract), `specs/lineage-s1-showcase-site.md` §4–§6 (URL params and `window.__lineage` / `window.__lineageControl`), `audit-reports/lineage-s1-report.md` (what actually shipped, including any bridge deviations), `playwright.config.ts` (real-GPU flags; never add swiftshader), `e2e/lineage.spec.ts`, and `D:/MyProjects/Claude/playwright-evidence/SKILL.md` (field-tested recipe for `video: 'on'` recordings on this machine: Vite must bind `127.0.0.1`, transcode webm→mp4, keep names short).

## What this dispatch builds

`scripts/lineage-record.mjs` plus `playwright.record.config.ts`: a data-driven Playwright capture that records the `/lineage` run page at four viewports for a list of shots, each defined in **sim turns** and driven through the window bridge, then transcodes to constant-frame-rate H.264 MP4, writes a 1 fps contact sheet per shot, and emits `shots.json` with measured facts. The film (S3) consumes these files; nothing else does.

## 1. Files

```
shots/lineage-experiment-01.json        the shot list (data; see §2) — create it from plans/lineage-showcase.md §3
scripts/lineage-record.mjs              CLI: node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json [--only A1,B2] [--out artifacts/lineage-site/recordings] [--port 5231]
playwright.record.config.ts             separate config: video on, real-GPU args copied from playwright.config.ts, webServer = vite on 127.0.0.1:<port> with strictPort, one project per viewport
e2e/record/lineage-record.spec.ts       the spec the CLI runs; reads the shot list path from env LINEAGE_SHOTS and the --only filter from LINEAGE_ONLY
test/lineage-shots.test.ts              validates the shot-list schema and that every referenced run exists (or is the mock run)
audit-reports/lineage-s2-report.md
```

## 2. Shot list schema (`shots/*.json`)

```json
{
  "experiment": "lineage-experiment-01",
  "shots": [
    { "id": "A1", "run": "courtship-seed42-*", "view": "feed", "viewport": [1920,1080], "speed": 64,
      "fromTurn": 0, "turns": 320, "leadInMs": 800, "tailMs": 800, "villager": null, "vs": null, "note": "hamlet fast, tree growing" }
  ]
}
```

- `run` may be an exact directory name or a glob resolved against `artifacts/lineage/`; when several match, take the newest by mtime and record which one in `shots.json`.
- `view ∈ feed|card|bloodlines|analysis|compare`; `speed ∈ 1|8|64`; `turns` is the number of sim turns to play (`0` = hold still for `holdMs`); `fromTurn` is where to `seek` first; `villager` opens that villager's card (by id or full name); `vs` sets compare mode.
- Fill the file with the eight shots from `plans/lineage-showcase.md` §3, translating "8 seasons" = 320 turns, "1 day" = 4 turns, "days 4–7" = fromTurn 12, turns 16, "4 turns" = 4, "2 seasons" = 80, "hold 6 s" = turns 0, holdMs 6000.

## 3. Capture procedure (per shot, in the spec)

1. New browser context with the shot's viewport and `recordVideo: { size: viewport }`; navigate to `/lineage?run=<id>&view=<view>&speed=<speed>&t=<fromTurn>[&villager=][&vs=]` (no `autoplay`).
2. Wait for `window.__lineage.ready === true` and `replayOk !== false`; if `replayOk === false`, fail the shot with `replay mismatch` (do not record an unverified replay).
3. Wait `leadInMs`, then `__lineageControl.play()`; poll `__lineage.turn` until it is `≥ fromTurn + turns` (or until `holdMs` elapsed when `turns` is 0), then `__lineageControl.pause()`; wait `tailMs`.
4. Record `turnStart`, `turnEnd`, `wallMs`, and `alive` at end from the bridge; close the context so Playwright finalises the webm; rename it to `<out>/<id>.webm`.
5. Transcode: `ffmpeg -y -i <id>.webm -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 -movflags +faststart <id>.mp4`. Then `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,duration -of json` and store the numbers.
6. Contact sheet: `ffmpeg -y -i <id>.mp4 -vf "fps=1,scale=320:-1,tile=10x<rows>" <id>-sheet.png` where rows = ceil(duration/10).
7. Append to `shots.json`: `{ id, runDir, view, viewport, speed, turnStart, turnEnd, wallMs, mp4, sheet, probe: {width,height,fps,frames,durationSec} }`.

Timing rule: the sim advances by wall-clock timers in the page (1× = 1.5 s/turn, 8× = 0.1875 s, 64× = 0.0234 s), so `wallMs ≈ turns × secPerTurn`. Assert per shot that the recorded stream duration is within ±15% of `leadInMs + wallMs + tailMs`; otherwise mark the shot `suspect` in `shots.json` and say why (dropped frames, throttled tab).

## 4. Gates

- `npx vitest run test/lineage-shots.test.ts` green.
- `node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json --only A3` runs end to end on the mock run if the real run is missing, producing `A3.mp4`, `A3-sheet.png`, and a `shots.json` entry whose `probe.width×height` equals the viewport and whose `durationSec` passes the ±15% rule. If Chromium cannot start in your sandbox, quote the exact error and stop; do not fake outputs.
- `ffprobe` on every produced MP4 reports `yuv420p`, 30 fps, and the viewport dimensions.
- `git status --short src scripts/luna-*.ts vite.config.ts playwright.config.ts` read-only evidence shows nothing changed there.

## 5. Report (`audit-reports/lineage-s2-report.md`)

Files and line counts; the shot list as shipped; for every shot attempted: run dir resolved, turn range, wall ms, probe numbers, sheet path, suspect flag; the exact error for anything not run; questions for main.

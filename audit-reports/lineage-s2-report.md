# LINEAGE-S2 report

Deterministic Playwright recordings of `/lineage`. Shot list is data; the CLI drives the window bridge, transcodes to CFR H.264, writes a 1 fps contact sheet, and emits measured `shots.json`.

## 1. Files and line counts (non-blank)

| file | lines (all) | non-blank |
|---|---|---|
| `shots/lineage-experiment-01.json` | 120 | 119 |
| `scripts/lineage-record.mjs` | 478 | 442 |
| `playwright.record.config.ts` | 57 | 52 |
| `e2e/record/lineage-record.spec.ts` | 321 | 296 |
| `test/lineage-shots.test.ts` | 129 | 119 |
| `audit-reports/lineage-s2-report.md` | this file | this file |

Not edited: `README.md`, `CLAUDE.md`, `plans/`, `specs/`, `src/**`, `scripts/luna-*.ts`, `scripts/lineage-run.mjs`, `scripts/lineage-runs.ts`, `vite.config.ts`, `playwright.config.ts`.

`playwright.record.config.ts` copies the real-GPU launch args (`--use-angle=default`, `--ignore-gpu-blocklist`, `--enable-gpu-rasterization`). No swiftshader. Vite binds `127.0.0.1:<port> --strictPort`. Four projects, one per viewport. The record spec is skipped unless `LINEAGE_SHOTS` is set, so `npm run e2e` does not capture.

Deviation from the spec ffmpeg line: transcode adds `-ss <readyOffset>` after `-i` so the MP4 starts at `__lineage.ready` rather than at context creation (courtship replay blocked Chromium ~100 s before ready). Contact sheet adds `-frames:v 1 -update 1` so image2 writes a single PNG.

## 2. Shot list as shipped

`shots/lineage-experiment-01.json` — experiment `lineage-experiment-01`. Translations from `plans/lineage-showcase.md` §3:

| id | run glob | view | viewport | speed | fromTurn | turns | holdMs | villager | vs | note |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | `courtship-seed42-*` | feed | 1920×1080 | 64 | 0 | 320 | — | — | — | hamlet fast, tree growing |
| A2 | `courtship-seed42-*` | bloodlines | 3440×1440 | 64 | 0 | 320 | — | — | — | drift sparklines drawing in |
| A3 | `courtship-seed42-*` | feed | 390×844 | 8 | 0 | 4 | — | — | — | phone frame, readable lines |
| B1 | `gate-codex-dnaon-*` | feed | 1920×1080 | 8 | 12 | 16 | — | — | — | failed eats, days 4–7 |
| B2 | `gate2-codex-dnaon-*` | card | 1280×800 | 1 | 0 | 4 | — | Xan Ember | — | genome paragraph and a thought |
| B3 | `gate2-codex-dnaon-*` | compare | 3440×1440 | 64 | 0 | 80 | — | — | `gate2-codex-dnaoff-*` | two hamlets, same turn |
| B4 | `gate3y1-codex-dnaon-*` | analysis | 1920×1080 | 1 | 0 | 0 | 6000 | — | — | expression table 0 of 8 |
| C1 | `gate3y1-codex-dnaon-*` | analysis | 1920×1080 | 1 | 0 | 0 | 6000 | — | — | probes synth, 7 of 8 give |

All shots `leadInMs: 800`, `tailMs: 800`. Hold shots use `speed: 1` (unused; they never `play()`). C1 uses the same run/view as B4 because synth probes render on that analysis panel (source run `gate3y1-codex-dnaon-seed42-20260912-153258`).

## 3. Gates

**vitest** `npx vitest run test/lineage-shots.test.ts` — 5/5.

```
 ✓ test/lineage-shots.test.ts (5 tests) 56ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Schema, plan translations, glob resolution (newest mtime, mock fallback), and 8-season wall-time check all passed. Every referenced glob currently resolves to a real run under `artifacts/lineage/` (no mock fallback needed).

**A3 capture** `node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json --only A3 --out artifacts/lineage-site/recordings --port 5231`

Chromium launched. Real GPU config. Courtship run present, so A3 did **not** fall back to mock.

```
Running 1 test using 1 worker
[record] A3 feed 390x844 run=courtship-seed42-*
  ok 1 [390x844] › e2e\record\lineage-record.spec.ts:308:3 › lineage record › record (2.0m)
  1 passed (2.4m)
[lineage-record] A3 run=courtship-seed42-20260907-181510 turns=0→4 wallMs=870 390x844 2.466667s suspect=false
```

(The wrapping PowerShell session reported exit 1 because ffmpeg/node warnings on stderr became `NativeCommandError`. The node CLI printed the success line after Playwright `1 passed`. Re-run from cmd/`node` directly for a clean 0.)

**ffprobe** `C:/Users/swapp/bin/ffprobe.exe` on `A3.mp4`:

```
codec_name=h264
width=390
height=844
pix_fmt=yuv420p
r_frame_rate=30/1
duration=2.466667
nb_frames=74
```

yuv420p, 30 fps, viewport 390×844. Duration 2.466667 s vs `leadInMs + wallMs + tailMs` = 800+870+800 = 2470 ms → |Δ| ≈ 0.1% (limit 15%). `suspect: false`.

**git:** not run (dispatch: no git). Working tree under `src/`, `scripts/luna-*.ts`, `vite.config.ts`, `playwright.config.ts` was not written.

## 4. Shots attempted

### A3 — ran

| field | value |
|---|---|
| run dir resolved | `courtship-seed42-20260907-181510` (newest `courtship-seed42-*` by mtime; hash `da5ffd94`, S1 verified) |
| fallbackMock | false |
| view / viewport / speed | feed / 390×844 / 8× |
| turnStart → turnEnd | 0 → 4 |
| wallMs | 870 (4 turns × ~190 ms site timer + poll slack) |
| alive | 12 |
| mp4 | `artifacts/lineage-site/recordings/A3.mp4` (139302 bytes) |
| webm | `artifacts/lineage-site/recordings/A3.webm` (container 107 s; load head trimmed) |
| sheet | `artifacts/lineage-site/recordings/A3-sheet.png` (353960 bytes, 3200×693 = `tile=10x1`) |
| probe | 390×844, 30 fps, 74 frames, 2.466667 s, yuv420p |
| suspect | false |

Contact sheet (1 fps): cell 1 is Season 1 · Day 1 · dawn, feed of field work, 8× chip on, phone tabs. Cell 2 is Season 1 · Day 2 · dawn (one day / 4 turns later), several villagers eating. Cells 3–10 are black pads (`tile=10x1` on a ~2.5 s clip). Matches the shot intent.

### A1, A2, B1, B2, B3, B4, C1 — not run

Gate asked only for `--only A3`. Globs all resolve today:

| id | would resolve to |
|---|---|
| A1, A2 | `courtship-seed42-20260907-181510` |
| B1 | `gate-codex-dnaon-seed42-20260912-141833` |
| B2 | `gate2-codex-dnaon-seed42-20260912-144038` |
| B3 | same + vs `gate2-codex-dnaoff-seed42-20260912-150655` |
| B4, C1 | `gate3y1-codex-dnaon-seed42-20260912-153258` |

Exact error for anything not run: **not attempted** (out of scope for the A3 gate). Main should run the full list:

```
node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json --port 5231
```

Expect ~100 s of blocked-renderer load per courtship shot before `ready`, then 320 turns at 64× (~7.5 s play) for A1/A2.

## 5. Questions for main

- **Xan Ember** is not in `gate2-codex-dnaon` (living names at the end include Joss/Gil/Yue Ember). The recorder matches id, then full name, then lowest-generation same surname. B2 will open Gil Ember unless you rename the shot. Change the list to a real villager?
- **B4 and C1** are the same analysis hold of gate3y1. Synth probe headlines already sit on that panel (`7/8` disposition). Record the index Probes region for C1 instead?
- Courtship 8-season `replayTimeline` blocks Chromium ~100 s. MP4 trim (`ffmpeg -ss` after ready) is required for the ±15% duration rule. Keep that deviation?
- Contact sheets for clips shorter than 10 s are a 10-wide strip with black pads. Shrink `tile` to `ceil(duration)×1` for short shots?
- `git status` not run here. Please confirm `src/`, `scripts/luna-*.ts`, `vite.config.ts`, `playwright.config.ts` are untouched before commit.

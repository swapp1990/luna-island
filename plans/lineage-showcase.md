# Luna Island — Lineage Showcase: the experiment as a website, a recording, and a board-room film

**Status:** direction approved 2026-09-12 ("make it public, just build it"). This is the plot;
specs derive from it: `specs/lineage-s1-showcase-site.md` (site), `lineage-s2-recording.md`
(capture), `lineage-s3-board-film.md` (edit).
**Purpose:** a repeatable pipeline that turns any recorded experiment into (1) a responsive web
page anyone can watch and scrub, (2) deterministic recordings of that page at phone, desktop,
and ultrawide, and (3) a short film in which a scientist walks a non-technical board through the
question, the runs, and the analysis. Experiment 01 is the Lineage track; later experiments
reuse every stage.
**Public surface:** `https://github.com/swapp1990/luna-island` (made public 2026-09-12).
**Marketing record:** `impressions-agency/marketing/luna-island-lineage/blast-2026-09-12/`.

---

## 1. Principles

- **Footage is the real page.** Nothing in the film is mocked; every frame of the hamlet comes
  from `/lineage` replaying a recorded run. Charts are drawn from `aggregate.json`,
  `expression.json`, and the probe JSON.
- **The replay is verified.** The site re-runs the pure sim with the recorded decisions and shows
  a badge when the hash matches the run's summary. A frame from an unverified replay is not used.
- **Responsive is measured.** Four viewports (390×844, 1280×800, 1920×1080, 3440×1440), an
  asserted column count, and no horizontal scroll. The film uses phone and desktop and ultrawide
  frames side by side because that is what the user asked to see.
- **Board-room register.** One idea per scene, plain words, no jargon on screen. A scientist
  presenting results, not a developer demoing a UI. Honest about what did not work.
- **Numbers are declared before they are shown.** Every on-screen number is a claim with a source
  in the report; the video spec lists them as `claim_ids`.

## 2. Stage S1 — the site (`/lineage`)

Spec: `specs/lineage-s1-showcase-site.md`. Four panels (chronicle feed, villager card,
bloodlines, analysis), an experiment index, a compare mode for DNA on/off, a window bridge and
URL parameters for scripted capture. Built by grok 4.6; verified by an independent sonnet agent
that takes the four viewport screenshots itself and reports gaps.

## 3. Stage S2 — the recording

A Playwright script (`scripts/lineage-record.mjs`) drives the site through the bridge and records
with `video: on` at the four viewports, real GPU, deterministic: every shot is `seek(turn)` then
`play()` at a named speed for a fixed number of **sim turns**, then `pause()`. Shot list:

| shot | run | view | viewport | speed | turns | purpose |
|---|---|---|---|---|---|---|
| A1 | courtship-seed42 (Phase A, instinct) | feed | 1920×1080 | 64× | 8 seasons | the hamlet running fast, tree growing |
| A2 | same | bloodlines | 3440×1440 | 64× | 8 seasons | drift sparklines drawing in |
| A3 | same | feed | 390×844 | 8× | 1 day | phone frame, readable lines |
| B1 | gate-codex-dnaon (extinction) | feed | 1920×1080 | 8× | days 4–7 | failed eats piling up |
| B2 | gate3y1-codex-dnaon | card (Xan Ember, v-17) | 1280×800 | 1× | turns 54–58 | the genome paragraph, then his give at turn 55 (season 2 day 4 dusk) |
| B3 | gate2 on vs gate2 off | compare | 3440×1440 | 64× | 2 seasons | two hamlets, same turn |
| B4 | gate3y1-codex-dnaon | analysis | 1920×1080 | — | hold 6 s | expression table 0 of 8 |
| C1 | probes (synth) | analysis/probes | 1920×1080 | — | hold 6 s | 7 of 8 give |

Output: `artifacts/lineage-site/recordings/<shot>.webm` → `ffmpeg` to H.264 MP4 with constant
frame rate; per shot a 1 fps contact sheet; a `shots.json` with measured durations, dimensions,
and the sim-turn range actually captured. Spec S2 is written after S1 lands.

## 4. Stage S3 — the film

HyperFrames, `/general-video` workflow, `flow: automation, storyboard: no` (user said "just build
it"). Narrated (Kokoro TTS through the HyperFrames CLI, one calm voice) with burned captions.
16:9 1920×1080 master; 9:16 1080×1920 cut with the phone footage leading. Target 80–95 s.

Working script, board-room register (numbers are claims from `audit-reports/lineage-b-report.md`
and `lineage-a-report.md`; they are declared in the spec before rendering):

| # | scene | seconds | on screen | narration (draft) |
|---|---|---|---|---|
| 1 | Title | 0–5 | "Luna Island · Experiment 01" / "Can an AI villager inherit a personality?" | "Experiment one. We asked a simple question: if you give an AI villager a genome, does it act like its parents?" |
| 2 | The setup | 5–17 | diagram: 12 villagers, 5 rooms, 30 genes → 12 traits; "every ten days the elders leave and their children arrive" | "Twelve villagers. Five rooms. Each carries thirty genes that set twelve traits, half in their bodies, half in their temperament. Every ten days a generation passes." |
| 3 | The hamlet, fast | 17–32 | A1 desktop + A3 phone, then A2 ultrawide | "Here is the hamlet running at sixty-four times speed. The feed is what they did. The tree is who they became." |
| 4 | Eight generations | 32–44 | drift chart from `aggregate.json`: metabolism at yield 0.5 vs 0.6+, 40 seeds | "With no AI at all, just simple instincts, scarcity did what scarcity does: over eight generations the fast metabolisms disappeared. Forty repeats. The physics works." |
| 5 | Then we gave them minds | 44–60 | B1 extinction, then B2 card, then B4 table | "Then we gave them language minds. The first hamlet starved in ten days: the model read half a grain as a meal. Two sentences of facts fixed that. Then they lived, but their inherited temperaments never showed. Zero of eight." |
| 6 | The finding | 60–76 | C1 probe table; quote "I stand by my people." | "So we asked one villager, holding spare grain, while showing him a starving neighbour. Seven of eight gave. The minds were never lazy. They act on what they can see, and we had shown them nothing worth being generous about." |
| 7 | Honest coda + next | 76–90 | B3 compare; end card with repo URL | "And with the genome removed they gave just as often. The trait is not in their behaviour yet. Next experiment: a world with inequality they can see, and a genome that costs something to follow. github dot com slash swapp1990 slash luna-island." |

Gates (story-blast runbook §5, delegated-run equivalence): storyboard blocks recorded in the
composition; `npx hyperframes check` passing; render verified with `ffprobe` against the brief's
numbers (stream duration, dimensions, captions on screen for their held seconds); a **1 fps
full-clip contact sheet reviewed by a non-builder** (a sonnet verifier), verdict written to
`artifacts/lineage-site/film/QA-verdict.md` with the reviewer's model identity. Then Agency
`start_video_generation` → `register_video_output` → `run_video_quality_review` →
`submit_video_quality_decision`. Publication stays a user gate.

## 5. What "more experiments like this" means for the code

- A run directory is the unit. Anything that writes `summary.json` + `events.jsonl` (+
  `decisions.jsonl`) under `artifacts/lineage/` appears on `/lineage` with no code change.
- The shot list is data (`shots.json`), so a new experiment adds rows, not scripts.
- The film is a template: scenes 1, 2, and 7 are reusable; 3–6 take that experiment's shots and
  claims.

## 6. Order and ownership

1. S1 site — grok 4.6 from the spec; sonnet verifier with screenshots; main gates and commits.
2. S2 recording — main writes the spec once the bridge exists; grok implements; main runs the
   capture on the real GPU (delegates cannot spawn browsers).
3. S3 film — main writes `BRIEF.md` and the spec; grok builds the composition with the
   HyperFrames CLI; sonnet verifier reviews the 1 fps sheet; main renders/registers.
4. X thread and repo README pointer — Agency X stage after the film is accepted.

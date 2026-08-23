# Dispatch P5-1 CONTINUATION — finish wear paths + day-lapse from a partial working tree

## Your role — the leash

SOLE IMPLEMENTER. Synchronous, Read/Write/Edit/Bash. NEVER spawn subagents. NEVER run any `git` command. Don't edit `README.md`, `CLAUDE.md`, `plans/`, `specs/`. 3 failed attempts on a gate → STOP and report.

**Narration is mandatory this time:** before every long step (each gate command, each file you start editing, the day-lapse run) print one line saying what you are about to do. The previous session went silent for 17 minutes and was killed; silence is treated as a hang.

## Situation

A previous session implemented PART of `specs/phase5-1-wear-paths-and-day-lapse.md` (read that spec first — it is the contract; this file only tells you where the work stands). It died before running any gate. The working tree already contains, UNCOMMITTED:

- `src/sim/types.ts` — `wear?: number` on Tile (+5 lines)
- `src/sim/sim.ts` — wear increment at the movement step (+15 lines)
- `src/render/terrain.ts` — band recoloring (+68 lines)
- `src/render/scene.ts` — render hook wiring (+2 lines)
- `test/wear.test.ts` — new, untested
- `scripts/day-lapse.mjs`, `scripts/photo-boot.mjs` — new, never executed

Do NOT start over and do NOT assume this code is correct — it has never been run. Read each of those diffs/files first, fix what is wrong or incomplete, fill what is missing (persistence round-trip per the spec's section A may or may not be handled — check `src/sim/persist.ts` against the spec).

## Your job, in order

1. Read the original spec, then the seven files above.
2. Print a one-line assessment per file: keep / fix (what) / missing (what).
3. Complete the implementation per the original spec (sections A, B, C).
4. Run the gates from the original spec IN THIS ORDER, narrating each: `npx vitest run test/wear.test.ts` first (fast feedback), then `npm run check`, then `npm run e2e`, then the purity grep, then the two recorded-world imports, then `node scripts/day-lapse.mjs artifacts/soak-1787452399090-world.json`.
5. Produce the original spec's final report structure (BUILT / GATES / DAY-LAPSE RUN / DEVIATIONS / KNOWN GAPS).

Do NOT run a soak. Do NOT call any LLM. Do NOT run any `git` command.

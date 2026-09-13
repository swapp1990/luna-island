# LINEAGE-S1b report

Bloodlines + phone fixes for `/lineage`. Edits only under `src/lineage-site/**`, `e2e/lineage.spec.ts`, and this file.

## Defect 1 — empty drift sparklines (root cause)

`driftSparklines` sampled only season-start snapshots, so at the default screenshot turn (season 0, day 0, dawn) each series had a single mean. `sparkPath` then emitted a Move-only `d` (`M x y`) whose `getTotalLength()` is 0, so the SVG stroked nothing at every width.

Fix: append the current snapshot when it is past the last season start; if the series still has one point, duplicate it into a two-point horizontal line. Spark SVGs are sized with ResizeObserver (`min 60×20`).

## Family tree layout (five lines)

Group `state.lineage` by generation. Place each row in normalized 0..1 x-space: gen 0 evenly, later gens at the midpoint of their two parents, then spread to a minimum gap so order is preserved. Map nx → pixel centers inside the measured panel width (gutter + pad), pill width = `(inner / densestRow) - gap`. Draw two hairline paths per non-founder (each parent bottom-center → parent-midpoint junction → child top-center). Render in an SVG with `viewBox` + `preserveAspectRatio="xMidYMin meet"` and `width: 100%` so the tree never exceeds the panel; rows with pill width < 88 px (or n > 14) abbreviate to `Gi. Surname` / initials; living generation glows, open villager is highlighted.

## Per-viewport measurements (last turn of the mock run)

All four viewports: `document.documentElement.scrollWidth === innerWidth`. Tree pills = 36 = `data-born`; edges = 48 = 2 × (36 − 12 founders). Spark paths are 3-point polylines (season 0 start, season 1 start, current).

| viewport | layout | spark path lengths (px) | spark bbox | tree svg right / panel right | tree svg size |
|---|---|---|---|---|---|
| 390×844 | single | 83.49, 83.39, 83.01, 83.20 | 82.5×28 | 369 / 390 | 348×156 |
| 1280×800 | two | 113.64, 113.50, 113.01, 113.26 | 113.4×36 | 1253 / 1280 | 484×156 |
| 1920×1080 | three | 141.51, 141.40, 141.01, 141.21 | 141.5×36 | 1893 / 1920 | 596×156 |
| 3440×1440 | four | 194.37, 194.29, 194.01, 194.15 | 193.8×36 | 2552 / 2580 | 805×156 |

390 heatmap: 12/12 `[data-testid=heat-h]` cells visible in the viewport (18 px squares, 2 px gaps, stacked 3-letter headers `met…cau`). Expression table: `expr-scroll.scrollWidth > clientWidth` and `document.documentElement.scrollWidth === 390`. Turn chip vs first `.feed-entry`: no bounding-box intersection at any viewport (feed scrolled to top before the assert).

## Screenshots

- `artifacts/lineage-site/shots/390x844-feed.png`
- `artifacts/lineage-site/shots/390x844-card.png`
- `artifacts/lineage-site/shots/390x844-bloodlines.png`
- `artifacts/lineage-site/shots/390x844-analysis.png`
- `artifacts/lineage-site/shots/390x844-tree.png` (bloodlines scrolled to the tree; tree is at the top of the panel)
- `artifacts/lineage-site/shots/1280x800-composite.png`
- `artifacts/lineage-site/shots/1920x1080-composite.png`
- `artifacts/lineage-site/shots/3440x1440-composite.png`
- `artifacts/lineage-site/shots/3440x1440-bloodlines.png` (bloodlines panel only)

Feed / card / analysis shots are turn 0. Bloodlines, tree, and composites are seeked to the last turn so generation rows and drift series are visible. Metrics JSON next to each viewport records the numbers above.

## Defect 5 — trailing lines under the card

Those were a chronicle-feed leak around the phone bottom sheet (feed stayed mounted when a villager opened from Feed; `.lineage-shell` was not a positioning containing block, so the sheet/backdrop did not clip the feed). They were **not** a labeled ticker. Fix: `position: relative` on the shell, opaque panel backgrounds, `data-sheet="1"` overflow clip. The Card tab unmounts the feed; `390x844-card.png` has no trailing feed lines.

## Gates

- `npx vitest run test/lineage-timeline.test.ts` — 3/3 passed (3.96s).
- `npx playwright test e2e/lineage.spec.ts` with `PLAYWRIGHT_PORT=5189` (real-GPU config, no swiftshader) — 5/5 passed (1.9m).
- `grep` / search for `from 'three'` in `src/lineage-site` — empty.
- `npx tsc --noEmit` — **does not exit 0**. The only errors are in `test/lineage-shots.test.ts` (import of `../scripts/lineage-record.mjs` has no declaration file; two implicit `any` parameters). That file and `scripts/lineage-record.mjs` are owned by the concurrent S2 implementer and are outside this dispatch’s edit set. No diagnostics under `src/lineage-site`.

## Could not / left as-is

- Full `Given Surname` pills on a 12-wide row at 390 px: after gutter/pad the pill is ~24 px, so labels fall back to two-letter initials. `Gi. Surname` is used from ~52 px up (visible on 1920/3440). SVG `<title>` still has the full name.
- Phone expression `n_high` is clipped by the sticky `expressed` column until the table is scrolled; that is the sticky-verdict design, not page overflow.
- Bridge, URL params, API, and timeline were not changed.

# Dispatch LINEAGE-S1b — Bloodlines and phone fixes for `/lineage`

## Your role

You are the SOLE IMPLEMENTER. Work synchronously with your own file/shell tools. NEVER spawn subagents. NEVER run any `git` command. No LLM runs. Edit only `src/lineage-site/**`, `e2e/lineage.spec.ts`, and `audit-reports/lineage-s1b-report.md`. Another implementer is concurrently working under `scripts/lineage-record.mjs`, `shots/`, `e2e/record/`, `playwright.record.config.ts`; do not touch those. If a gate will not go green after 3 distinct fix attempts, STOP and report honestly.

Working directory: `D:\MyProjects\Claude\luna-island`. Read `specs/lineage-s1-showcase-site.md` §4 panel 3 (Bloodlines) and §5, `audit-reports/lineage-s1-report.md`, and the independent QA verdict `artifacts/lineage-site/shots/QA-verifier-sonnet.md` (this dispatch exists because of it). Look at `art/lineage-mobile-concepts/v2-bloodlines-dashboard.png` again: that is the target.

## Defects to fix (all confirmed on the shipped screenshots)

1. **Drift sparklines render empty at every width** (`390`, `1280`, `1920`, `3440`). The four labels appear, no lines. Diagnose from the data path first (`model.ts` sparkline series → `Bloodlines.tsx` SVG). Likely causes: series built from `snapshots` at season starts but the generation index or trait key is wrong, or the SVG has zero width/height because the container is sized by CSS grid after mount. Fix, then assert in E2E that each sparkline `<svg>` contains a `<path>`/`<polyline>` whose `getTotalLength()` (or points count) is > 0 and that its bounding box is ≥ 60×20 px at every viewport.
2. **Family tree is a flat single row, clipped, at every width.** Implement the layered layout the spec asked for: one row per generation (0…current), nodes are pills `Given Surname`, edges are hairlines from each child to both parents (midpoint of the two parents), the villager open in the card is highlighted, the living generation glows. Fit-to-width: compute pill positions in a normalized 0..1 x-space per row and render in an SVG with `viewBox` + `preserveAspectRatio="xMidYMin meet"` so the whole tree always fits the panel width; when a row has more than ~14 nodes, shrink pill font to 11 px and abbreviate to `Gi. Surname`. On phone (≤719) the panel scrolls vertically, never horizontally. E2E: at each viewport assert the tree SVG's `getBoundingClientRect().right <= panel.right + 1` and that the number of rendered pills equals the number of villagers ever born up to the current turn, and edges count = 2 × (non-founder pills).
3. **Phone clipping.** The trait heatmap must show all 12 columns at 390 px (shrink cells to 18 px squares with 2 px gaps and 3-letter headers rotated or stacked; the row-name column may truncate to 9 chars with an ellipsis). The expression table on phone becomes horizontally scrollable *inside its own container* (`overflow-x: auto`, a visible right-edge fade cue), with `trait` and `expressed` columns sticky so the verdict is visible without scrolling. E2E: at 390 assert 12 header cells visible within the viewport and that the table container, not the page, scrolls (`document.documentElement.scrollWidth === innerWidth`).
4. **Turn chip overlaps the first feed card on phone** (the "dawn" chip). Give the chip its own row above the scroller (fixed height) so nothing paints under it. E2E: assert the chip's bounding box does not intersect the first feed entry's bounding box.
5. **Ambiguous duplicate feed lines under the villager card on phone.** If those are the chronicle ticker, label them; if they are a rendering leak of the feed behind the sheet, clip them. State which in the report.

Keep everything else as is. Do not change the bridge, URL params, API, or timeline.

## Gates

`npx tsc --noEmit` exit 0; `npx vitest run test/lineage-timeline.test.ts` green; `npx playwright test e2e/lineage.spec.ts` green on the real-GPU config (use `PLAYWRIGHT_PORT=5189` if 5175 is busy); regenerate all seven screenshots into `artifacts/lineage-site/shots/` (same names) plus two new ones: `390x844-tree.png` (bloodlines scrolled to the tree) and `3440x1440-bloodlines.png` (the bloodlines panel cropped from the composite, or the panel alone). Purity grep for `from 'three'` in `src/lineage-site` stays empty.

## Report (`audit-reports/lineage-s1b-report.md`)

Root cause of defect 1 in two sentences; the tree layout algorithm in five lines; per-viewport measured numbers from the new E2E assertions (sparkline path lengths, tree bbox vs panel, heatmap columns visible); screenshot paths; anything you could not fix.

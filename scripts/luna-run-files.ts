/**
 * Group recorded soak-run artifact filenames into runs.
 *
 * Pure — no fs, no vite, no browser, and deliberately NOT under src/: the
 * Run Theater vite plugin imports it, and anything vite.config.ts reaches
 * becomes a config dependency whose edits restart the dev server.
 */

/**
 * Group recorded soak-run artifact filenames into runs.
 * Pure — no fs, no browser. The dev API and the tests share this.
 *
 * A political soak writes, per run:
 *   soak-political-<startTs>.jsonl   (journal — appended once per wall minute)
 *   soak-<exportTs>-world.json       (full save: head + snapshots + events)
 *   soak-<exportTs>-story.json       (qualitative extract)
 *   soak-<exportTs>-summary.json     (params + headline counts)
 * `startTs` is stamped when the harness boots, `exportTs` when it finishes,
 * so a journal belongs to the nearest export that happened after it.
 */

export type RunFileRole = 'world' | 'story' | 'summary' | 'journal'

export interface RunFileGroup {
  /** Stable id — the export timestamp, or `j<startTs>` for a journal with no export. */
  id: string
  /** Export timestamp (ms), or null for a journal-only run. */
  exportTs: number | null
  /** Journal start timestamp (ms), or null when no journal was found. */
  startTs: number | null
  world?: string
  story?: string
  summary?: string
  journal?: string
}

const EXPORT_RE = /^soak-(\d+)-(world|story|summary)\.json$/
const JOURNAL_RE = /^soak-political-(\d+)\.jsonl$/

/** True when this run has a world export and can therefore be watched. */
export function isWatchable(g: RunFileGroup): boolean {
  return typeof g.world === 'string' && g.world.length > 0
}

/**
 * Group by export timestamp, then attach each journal to the earliest export
 * that finished after it started. A journal whose run never exported (crash,
 * SIGINT) becomes its own journal-only group so the failure is still listed.
 */
export function groupRunFiles(names: readonly string[]): RunFileGroup[] {
  const byExport = new Map<number, RunFileGroup>()
  const journals: Array<{ ts: number; name: string }> = []

  for (const name of names) {
    const exp = EXPORT_RE.exec(name)
    if (exp) {
      const ts = Number(exp[1])
      if (!Number.isFinite(ts)) continue
      const role = exp[2] as Exclude<RunFileRole, 'journal'>
      const g =
        byExport.get(ts) ?? { id: String(ts), exportTs: ts, startTs: null }
      g[role] = name
      byExport.set(ts, g)
      continue
    }
    const jrn = JOURNAL_RE.exec(name)
    if (jrn) {
      const ts = Number(jrn[1])
      if (!Number.isFinite(ts)) continue
      journals.push({ ts, name })
    }
  }

  const exports = [...byExport.values()].sort(
    (a, b) => (a.exportTs ?? 0) - (b.exportTs ?? 0),
  )
  journals.sort((a, b) => a.ts - b.ts)

  const out: RunFileGroup[] = [...exports]
  for (const j of journals) {
    // Earliest export that finished after this journal started and is still unclaimed.
    const owner = exports.find(
      (g) => g.journal == null && (g.exportTs ?? 0) >= j.ts,
    )
    if (owner) {
      owner.journal = j.name
      owner.startTs = j.ts
    } else {
      out.push({ id: `j${j.ts}`, exportTs: null, startTs: j.ts, journal: j.name })
    }
  }

  // Newest first — the run you just finished is the one you want to watch.
  return out.sort((a, b) => {
    const at = a.exportTs ?? a.startTs ?? 0
    const bt = b.exportTs ?? b.startTs ?? 0
    return bt - at
  })
}

export interface RunIndexEntry {
  id: string
  /** Human label: "Day 6 · 120m · seed 42". */
  label: string
  exportTs: number | null
  startTs: number | null
  hasWorld: boolean
  hasJournal: boolean
  /** The run's photographer manifest exists (soak-highlights.mjs ran). */
  hasHighlights: boolean
  worldBytes: number
  /** Verbatim `params` block from the summary, when the run wrote one. */
  params: Record<string, unknown> | null
  /** Build the run ran against, when the harness stamped one. */
  git: {
    shortSha?: string
    branch?: string | null
    subject?: string | null
    dirty?: boolean
  } | null
  /** Headline numbers from the summary (absent for journal-only runs). */
  headline: {
    wallMin: number | null
    simDays: number | null
    day: number | null
    decisions: number | null
    breathePct: number | null
    counts: Record<string, number> | null
  } | null
}


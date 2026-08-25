/**
 * Browser-side client for the read-only Run Theater API (`scripts/luna-runs.ts`).
 * Thin on purpose: fetch, shape-check, hand back plain data.
 */

import type { JournalRow, RunHighlightShot } from './runMoments'

export interface RunIndexEntry {
  id: string
  label: string
  exportTs: number | null
  startTs: number | null
  hasWorld: boolean
  hasJournal: boolean
  hasHighlights: boolean
  worldBytes: number
  params: Record<string, unknown> | null
  /** Build the run ran against, when the harness stamped one. */
  git: {
    shortSha?: string
    branch?: string | null
    subject?: string | null
    dirty?: boolean
  } | null
  headline: {
    wallMin: number | null
    simDays: number | null
    day: number | null
    decisions: number | null
    breathePct: number | null
    counts: Record<string, number> | null
  } | null
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Recorded runs, newest first. Empty list when the API is not mounted. */
export async function fetchRuns(): Promise<RunIndexEntry[]> {
  try {
    const body = await getJson<{ runs?: RunIndexEntry[] }>('/api/runs')
    return Array.isArray(body.runs) ? body.runs : []
  } catch {
    return []
  }
}

/** Raw world save JSON text — handed straight to `restoreSave`. */
export async function fetchRunWorldText(id: string): Promise<string> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}/world`)
  if (!res.ok) throw new Error(`world for ${id} → HTTP ${res.status}`)
  return await res.text()
}

/** Journal samples, or an empty array when the run has no journal. */
export async function fetchRunJournal(id: string): Promise<JournalRow[]> {
  try {
    const body = await getJson<{ rows?: JournalRow[] }>(
      `/api/runs/${encodeURIComponent(id)}/journal`,
    )
    return Array.isArray(body.rows) ? body.rows : []
  } catch {
    return []
  }
}

/**
 * The reel the run's photographer shot, or an empty list when it never ran.
 * These are the moments the run itself committed film to.
 */
export async function fetchRunHighlights(id: string): Promise<RunHighlightShot[]> {
  try {
    const body = await getJson<{ shots?: RunHighlightShot[] }>(
      `/api/runs/${encodeURIComponent(id)}/highlights`,
    )
    return Array.isArray(body.shots) ? body.shots : []
  } catch {
    return []
  }
}

/** URL of one still from a run's reel. */
export function runStillUrl(runId: string, file: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/still/${encodeURIComponent(file)}`
}

/** "abc12345 on main — Addendum 7 (dirty)", or '' when the run wrote no stamp. */
export function runBuildLabel(entry: RunIndexEntry | null): string {
  const g = entry?.git
  if (!g?.shortSha) return ''
  const bits = [g.shortSha]
  if (g.branch) bits.push(`on ${g.branch}`)
  let s = bits.join(' ')
  if (g.subject) {
    // Commit subjects run long; the panel is 380px wide.
    const subject = g.subject.length > 56 ? `${g.subject.slice(0, 55)}…` : g.subject
    s += ` — ${subject}`
  }
  if (g.dirty) s += ' (uncommitted)'
  return s
}

/** Pull the per-hour mind budget cap out of a run's params, when it recorded one. */
export function budgetMaxHourOf(entry: RunIndexEntry | null): number | undefined {
  const v = entry?.params?.budgetHour
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** One-line description of the params a run ran under. */
export function runParamsLabel(entry: RunIndexEntry | null): string {
  const p = entry?.params
  if (!p) return ''
  const bits: string[] = []
  const push = (key: string, prefix = '') => {
    const v = p[key]
    // A zero budget / concurrency means "not an LLM run" — say nothing rather
    // than print a misleading 0.
    if (v == null || v === '' || v === 0) return
    bits.push(`${prefix}${String(v)}`)
  }
  push('brain')
  push('preset')
  push('seed', 'seed ')
  push('minGap', 'gap ')
  push('concurrency', 'conc ')
  if (typeof p.budgetHour === 'number' && p.budgetHour > 0) {
    bits.push(`${p.budgetHour}/h`)
  }
  return bits.join(' · ')
}

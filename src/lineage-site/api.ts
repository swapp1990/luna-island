import type { LineageConfig, LineageRecord, LineageSummary } from '../lineage/types'
import type { RecordedDecision } from '../lineage/decider'
import type { ExpressionJson } from '../lineage/render/expression'

export interface LineageMindStats {
  llm: number
  fallback: number
  invalid: number
  meanLatencyMs: number
}

export interface LineageRunInfo {
  id: string
  tag: string | null
  brain: string | null
  engine: string | null
  dna: 'on' | 'off' | null
  seed: number | null
  harvestYield: number | null
  seasons: number | null
  cohort: number | null
  mating: string | null
  generationsBorn: number | null
  departuresByStarvation: number | null
  hash: string | null
  eventCount: number | null
  mind?: LineageMindStats
  stamp?: { commit: string | null; dirty: boolean; at: number | null }
  hasDecisions: boolean
  hasExpression: boolean
  mtime: number
}

export interface ProbeSummary {
  n: number
  recordedDisposition: number
  probeDisposition: number
  changed: number
}

export interface ProbeInfo {
  id: string
  mode: string | null
  effort: string | null
  dna: 'on' | 'off' | null
  band: string | null
  summary: ProbeSummary
  run: string | null
}

export interface ReplicateInfo {
  id: string
  yield: number | null
  n: number | null
  deltas: Record<string, { courtship?: { mean: number; sd: number }; random?: { mean: number; sd: number } }> | null
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return await res.text()
}

export async function fetchRuns(): Promise<LineageRunInfo[]> {
  try {
    const body = await getJson<LineageRunInfo[] | { runs?: LineageRunInfo[] }>('/api/lineage/runs')
    if (Array.isArray(body)) return body
    return Array.isArray(body.runs) ? body.runs : []
  } catch {
    return []
  }
}

export async function fetchRunFile(id: string, file: string): Promise<string> {
  return getText(`/api/lineage/runs/${encodeURIComponent(id)}/${encodeURIComponent(file)}`)
}

export async function fetchRunFileOptional(id: string, file: string): Promise<string | null> {
  const res = await fetch(`/api/lineage/runs/${encodeURIComponent(id)}/${encodeURIComponent(file)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${file} for ${id} → HTTP ${res.status}`)
  return await res.text()
}

export function parseJsonl<T>(raw: string): T[] {
  const rows: T[] = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t) as T)
    } catch {
      // skip a truncated last line
    }
  }
  return rows
}

export async function fetchSummary(id: string): Promise<LineageSummary> {
  return getJson<LineageSummary>(`/api/lineage/runs/${encodeURIComponent(id)}/summary.json`)
}

export async function fetchDecisions(id: string): Promise<RecordedDecision[]> {
  const raw = await fetchRunFileOptional(id, 'decisions.jsonl')
  if (raw == null) return []
  return parseJsonl<RecordedDecision>(raw)
}

export async function fetchLineageJson(id: string): Promise<LineageRecord[] | null> {
  const raw = await fetchRunFileOptional(id, 'lineage.json')
  if (raw == null) return null
  try {
    return JSON.parse(raw) as LineageRecord[]
  } catch {
    return null
  }
}

export async function fetchExpression(id: string): Promise<ExpressionJson | null> {
  const raw = await fetchRunFileOptional(id, 'expression.json')
  if (raw == null) return null
  try {
    return JSON.parse(raw) as ExpressionJson
  } catch {
    return null
  }
}

export async function fetchExpressionRank(id: string): Promise<string | null> {
  return fetchRunFileOptional(id, 'expression-rank.md')
}

export async function fetchMind(id: string): Promise<LineageMindStats | null> {
  const raw = await fetchRunFileOptional(id, 'mind.json')
  if (raw == null) return null
  try {
    return JSON.parse(raw) as LineageMindStats
  } catch {
    return null
  }
}

export async function fetchProbes(): Promise<ProbeInfo[]> {
  try {
    const body = await getJson<ProbeInfo[]>('/api/lineage/probes')
    return Array.isArray(body) ? body : []
  } catch {
    return []
  }
}

export async function fetchReplicates(): Promise<ReplicateInfo[]> {
  try {
    const body = await getJson<ReplicateInfo[]>('/api/lineage/replicates')
    return Array.isArray(body) ? body : []
  } catch {
    return []
  }
}

export function configOf(summary: LineageSummary): LineageConfig {
  return summary.config
}

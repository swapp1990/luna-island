import type { LineageRecord } from '../types'
import { villagerNum } from '../types'

export function renderTree(lineage: LineageRecord[]): string {
  const ordered = lineage.slice().sort((a, b) => villagerNum(a.id) - villagerNum(b.id))
  const founders = ordered.filter((r) => r.parents === null)
  const lines: string[] = ['```mermaid', 'graph TD']
  lines.push('subgraph founders')
  for (const r of founders) {
    lines.push(`${r.id}["${r.givenName} ${r.surname} (${r.generation})"]`)
  }
  lines.push('end')
  for (const r of ordered) {
    if (founders.some((f) => f.id === r.id)) continue
    lines.push(`${r.id}["${r.givenName} ${r.surname} (${r.generation})"]`)
  }
  for (const r of ordered) {
    if (!r.parents) continue
    for (const p of r.parents) {
      lines.push(`${p} --> ${r.id}`)
    }
  }
  lines.push('```', '')
  return lines.join('\n')
}

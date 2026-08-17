/**
 * Autopsy a political-soak journal (and optional baseline / story export).
 * Prints markdown to stdout. No file writes, no browser, no network.
 *
 * Usage: node scripts/soak-report.mjs <journal.jsonl> [--baseline <journal.jsonl>] [--story <story.json>]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const DASH = '—'

const argVal = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

const JOURNAL = process.argv[2]
if (!JOURNAL || JOURNAL.startsWith('--')) {
  console.error('usage: node scripts/soak-report.mjs <journal.jsonl> [--baseline <journal.jsonl>] [--story <story.json>]')
  process.exit(1)
}

const BASELINE = argVal('baseline')
const STORY = argVal('story')

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const rows = []
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      rows.push(JSON.parse(t))
    } catch {
      // skip a corrupt line rather than crash an autopsy
    }
  }
  return rows
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function lastOf(rows) {
  return rows.length ? rows[rows.length - 1] : null
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function fmt(v, digits = 2) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return DASH
  if (typeof v === 'number') {
    if (Number.isInteger(v) && digits === 0) return String(v)
    if (Number.isInteger(v) && Math.abs(v) >= 100) return String(v)
    return Number(v).toFixed(digits).replace(/\.?0+$/, (m) => (m === '.' ? '' : m.replace(/0+$/, '').replace(/\.$/, '')))
  }
  return String(v)
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return DASH
  return `${v.toFixed(1)}%`
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return DASH
  return String(Math.round(v))
}

function countOf(row, key) {
  if (!row) return null
  const n = row.counts?.[key]
  return typeof n === 'number' ? n : 0
}

function sumCounts(row, pred) {
  if (!row?.counts) return 0
  let n = 0
  for (const [k, v] of Object.entries(row.counts)) {
    if (pred(k) && typeof v === 'number') n += v
  }
  return n
}

function shapeOf(rows) {
  const last = lastOf(rows)
  if (!last) {
    return {
      wallMin: null,
      simDays: null,
      ticksPerWallMin: null,
      breathePct: null,
      decisions: null,
      decisionsPerWallHour: null,
      meanLatencyMs: null,
      fallbacks: null,
      stales: null,
      budgetPeak: null,
      tick: null,
      day: null,
      hour: null,
      minute: null,
      examined: null,
      noticed: null,
      says: null,
      reflections: null,
      institutionEvents: null,
      collapses: null,
      constructions: null,
      ownershipTransfers: null,
      friendships: null,
      examineTimeline: [],
      minGapTicks: null,
      decideCalls: null,
      budgetUsedDay: null,
    }
  }
  const wallMin = num(last.wallMin)
  const tick = num(last.tick)
  const decisions = num(last.mind?.decisions)
  const computedBreathe =
    wallMin && wallMin > 0 && tick != null
      ? 100 * (1 - tick / (60 * wallMin))
      : null
  const breathePct = num(last.breathePct) ?? computedBreathe
  const budgetPeak = rows.reduce((m, r) => {
    const b = num(r.mind?.budgetH)
    return b == null ? m : m == null ? b : Math.max(m, b)
  }, null)
  const examineTimeline = []
  let prevEx = 0
  for (const r of rows) {
    const n = countOf(r, 'discovery:examined') ?? 0
    if (n > prevEx) {
      const gained = n - prevEx
      examineTimeline.push({
        day: r.day,
        hour: r.hour,
        minute: r.minute,
        wallMin: r.wallMin,
        total: n,
        gained,
      })
      prevEx = n
    } else if (n > 0 && n === prevEx) {
      // keep prev
    } else if (n > prevEx) {
      prevEx = n
    } else {
      prevEx = Math.max(prevEx, n)
    }
  }
  return {
    wallMin,
    simDays: tick != null ? tick / 1440 : null,
    ticksPerWallMin: wallMin && wallMin > 0 && tick != null ? tick / wallMin : null,
    breathePct,
    decisions,
    decisionsPerWallHour:
      wallMin && wallMin > 0 && decisions != null ? decisions / (wallMin / 60) : null,
    meanLatencyMs: num(last.mind?.meanLatencyMs),
    fallbacks: num(last.mind?.fallbacks),
    stales: num(last.mind?.stale),
    budgetPeak,
    tick,
    day: num(last.day),
    hour: num(last.hour),
    minute: num(last.minute),
    examined: countOf(last, 'discovery:examined'),
    noticed: countOf(last, 'discovery:noticed'),
    says: countOf(last, 'mind:say'),
    reflections: countOf(last, 'mind:reflection'),
    institutionEvents: sumCounts(last, (k) => k.startsWith('institution:')),
    collapses: countOf(last, 'agent:collapsed'),
    constructions: countOf(last, 'construction:commissioned'),
    ownershipTransfers: countOf(last, 'ownership:transfer'),
    friendships: countOf(last, 'relationship:friends'),
    examineTimeline,
    minGapTicks: num(last.mind?.minGapTicks),
    decideCalls: num(last.mind?.decideCalls),
    budgetUsedDay: num(last.mind?.budgetUsedDay),
  }
}

function storyFacts(story) {
  const examinedByAgent = {}
  const learned = []
  if (!story || typeof story !== 'object') {
    return { examinedByAgent, learned }
  }
  const discoveries = Array.isArray(story.discoveries) ? story.discoveries : []
  for (const d of discoveries) {
    if (!d || d.type !== 'discovery:examined') continue
    const id = d.agentId || 'unknown'
    if (!examinedByAgent[id]) examinedByAgent[id] = { count: 0, targets: [] }
    examinedByAgent[id].count += 1
    if (d.target) examinedByAgent[id].targets.push(d.target)
  }
  const buckets = [story.reflections, story.decisions, story.says, story.discoveries]
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue
    for (const row of bucket) {
      if (!row || !Array.isArray(row.learned)) continue
      for (const fact of row.learned) {
        if (typeof fact === 'string' && fact.trim()) {
          learned.push({
            agentId: row.agentId ?? null,
            tick: row.tick ?? null,
            text: fact,
          })
        }
      }
    }
  }
  return { examinedByAgent, learned }
}

function deltaStr(a, b) {
  if (a == null || b == null) return DASH
  const d = a - b
  const sign = d > 0 ? '+' : ''
  return `${sign}${fmt(d)}`
}

function ratioStr(a, b) {
  if (a == null || b == null) return DASH
  if (b === 0) return a === 0 ? '—' : '∞'
  return `${(a / b).toFixed(2)}×`
}

function printReport(label, rows, story) {
  const s = shapeOf(rows)
  const last = lastOf(rows)
  const facts = storyFacts(story)
  const clock =
    s.day != null
      ? `D${s.day} ${s.hour ?? '?'}:${String(s.minute ?? 0).padStart(2, '0')}`
      : DASH

  const lines = []
  lines.push(`# Soak autopsy — ${label}`)
  lines.push('')
  lines.push('## Run shape')
  lines.push('')
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Wall minutes | ${fmtInt(s.wallMin)} |`)
  lines.push(`| Sim-days lived | ${fmt(s.simDays, 2)} (${clock}, tick ${fmtInt(s.tick)}) |`)
  lines.push(`| Ticks / wall-min | ${fmt(s.ticksPerWallMin, 2)} |`)
  lines.push(`| Breathe % | ${fmtPct(s.breathePct)} |`)
  lines.push(`| Decisions | ${fmtInt(s.decisions)} |`)
  lines.push(`| Decisions / wall-hour | ${fmt(s.decisionsPerWallHour, 1)} |`)
  lines.push(`| Mean latency | ${s.meanLatencyMs == null ? DASH : `${fmtInt(s.meanLatencyMs)} ms`} |`)
  lines.push(`| Fallbacks | ${fmtInt(s.fallbacks)} |`)
  lines.push(`| Stales | ${fmtInt(s.stales)} |`)
  lines.push(`| Budget peak (usedHour) | ${fmtInt(s.budgetPeak)} |`)
  if (s.minGapTicks != null) lines.push(`| minGapTicks | ${fmtInt(s.minGapTicks)} |`)
  if (s.decideCalls != null) lines.push(`| decideCalls | ${fmtInt(s.decideCalls)} |`)
  lines.push('')
  lines.push('## Discovery')
  lines.push('')
  lines.push(`- \`discovery:examined\`: **${fmtInt(s.examined)}**`)
  lines.push(`- \`discovery:noticed\`: **${fmtInt(s.noticed)}**`)
  lines.push(`- \`mind:say\`: **${fmtInt(s.says)}**`)
  lines.push(`- \`mind:reflection\`: **${fmtInt(s.reflections)}**`)
  lines.push('')
  if (s.examineTimeline.length === 0) {
    lines.push('Examine timeline: none recorded in the journal.')
  } else {
    lines.push('Examine timeline:')
    for (const ev of s.examineTimeline) {
      const hh = ev.hour ?? '?'
      const mm = String(ev.minute ?? 0).padStart(2, '0')
      lines.push(`- D${ev.day} ${hh}:${mm} (t+${ev.wallMin}m) → ${ev.total} (+${ev.gained})`)
    }
  }
  lines.push('')
  const agentIds = Object.keys(facts.examinedByAgent)
  if (story) {
    if (agentIds.length === 0) {
      lines.push('Per-agent examined (story): none.')
    } else {
      lines.push('Per-agent examined (story):')
      for (const id of agentIds.sort()) {
        const row = facts.examinedByAgent[id]
        const targets = row.targets.length ? row.targets.join(', ') : DASH
        lines.push(`- ${id}: ${row.count}  target(s): ${targets}`)
      }
    }
    lines.push('')
    if (facts.learned.length === 0) {
      lines.push('Learned facts: none in story export.')
    } else {
      lines.push(`Learned facts (${facts.learned.length}):`)
      for (const f of facts.learned) {
        const who = f.agentId ?? '?'
        const when = f.tick != null ? `tick ${f.tick}` : 'tick ?'
        lines.push(`- ${who} (${when}): ${f.text}`)
      }
    }
  } else {
    lines.push('Per-agent examined / learned: no `--story` supplied.')
  }
  lines.push('')
  lines.push('## Society')
  lines.push('')
  lines.push(`| Event | Count |`)
  lines.push(`|---|---|`)
  lines.push(`| Institution events | ${fmtInt(s.institutionEvents)} |`)
  lines.push(`| Collapses | ${fmtInt(s.collapses)} |`)
  lines.push(`| Constructions | ${fmtInt(s.constructions)} |`)
  lines.push(`| Ownership transfers | ${fmtInt(s.ownershipTransfers)} |`)
  lines.push(`| Friendships | ${fmtInt(s.friendships)} |`)
  if (last?.counts) {
    const inst = Object.keys(last.counts)
      .filter((k) => k.startsWith('institution:'))
      .sort()
    if (inst.length) {
      lines.push('')
      for (const k of inst) lines.push(`- \`${k}\`: ${last.counts[k]}`)
    }
  }
  lines.push('')
  return { text: lines.join('\n'), shape: s }
}

function printVs(run, base) {
  const rows = [
    ['Wall minutes', run.wallMin, base.wallMin, 0],
    ['Sim-days lived', run.simDays, base.simDays, 2],
    ['Ticks / wall-min', run.ticksPerWallMin, base.ticksPerWallMin, 2],
    ['Breathe %', run.breathePct, base.breathePct, 1],
    ['Decisions', run.decisions, base.decisions, 0],
    ['Decisions / wall-hour', run.decisionsPerWallHour, base.decisionsPerWallHour, 1],
    ['Mean latency (ms)', run.meanLatencyMs, base.meanLatencyMs, 0],
    ['Fallbacks', run.fallbacks, base.fallbacks, 0],
    ['Stales', run.stales, base.stales, 0],
    ['Budget peak', run.budgetPeak, base.budgetPeak, 0],
    ['discovery:examined', run.examined, base.examined, 0],
    ['discovery:noticed', run.noticed, base.noticed, 0],
    ['mind:say', run.says, base.says, 0],
    ['mind:reflection', run.reflections, base.reflections, 0],
    ['Institution events', run.institutionEvents, base.institutionEvents, 0],
    ['Collapses', run.collapses, base.collapses, 0],
    ['Constructions', run.constructions, base.constructions, 0],
    ['Ownership transfers', run.ownershipTransfers, base.ownershipTransfers, 0],
    ['Friendships', run.friendships, base.friendships, 0],
  ]
  const lines = []
  lines.push('## vs baseline')
  lines.push('')
  lines.push('| Metric | Run | Baseline | Δ | × |')
  lines.push('|---|---:|---:|---:|---:|')
  for (const [name, a, b, digits] of rows) {
    const aS = name === 'Breathe %' ? fmtPct(a) : fmt(a, digits)
    const bS = name === 'Breathe %' ? fmtPct(b) : fmt(b, digits)
    lines.push(`| ${name} | ${aS} | ${bS} | ${deltaStr(a, b)} | ${ratioStr(a, b)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

let journalRows
try {
  journalRows = readJsonl(JOURNAL)
} catch (e) {
  console.error(`failed to read journal: ${e.message}`)
  process.exit(1)
}

let story = null
if (STORY) {
  try {
    story = readJson(STORY)
  } catch (e) {
    console.error(`warning: failed to read story (${e.message}) — continuing without it`)
  }
}

const label = path.basename(JOURNAL)
const run = printReport(label, journalRows, story)
process.stdout.write(run.text)

if (BASELINE) {
  let baseRows
  try {
    baseRows = readJsonl(BASELINE)
  } catch (e) {
    console.error(`failed to read baseline: ${e.message}`)
    process.exit(1)
  }
  const base = shapeOf(baseRows)
  process.stdout.write(printVs(run.shape, base))
}

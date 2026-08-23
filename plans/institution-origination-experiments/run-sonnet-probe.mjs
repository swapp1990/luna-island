/**
 * Sonnet replication of the luna-island mind-probe rungs.
 * Reads rung-prompts.txt (output of mind-probe.mjs --dump), sends each
 * scenario N times through `claude -p` (claude-sonnet-5, effort low, no tools),
 * stdin formatted byte-identically to the codex path: `${system}\n\n---\n\n${user}\n`.
 * Parses replies with the same rules as src/mind/parse.ts (action kinds,
 * propose text validation) and writes histograms + raw rows to JSON.
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'

const DIR = '/tmp/claude-0/-home-user-3d-car-assembler/13d195de-53e1-53c6-a4e3-3fd3fba2877b/scratchpad'
const PROMPTS = process.env.PROBE_PROMPTS || `${DIR}/rung-prompts.txt`
const OUT = process.env.PROBE_OUT || `${DIR}/sonnet-probe-results.json`
const MODEL = process.env.PROBE_MODEL || 'claude-sonnet-5'
const EFFORT = process.env.PROBE_EFFORT || 'low'
const N = Number(process.env.PROBE_N || '10')
const CONCURRENCY = 4
const CALL_TIMEOUT_MS = 180_000

const ACTION_KINDS = new Set([
  'idle','walk','sleep','eat','drink','socialize','wander','forage','gather',
  'deliver','work','buy','commission','propose','vote','sanction','claim',
  'examine','give',
])

// ---- parse the dump file ----
const raw = fs.readFileSync(PROMPTS, 'utf8')
const scenarios = []
{
  // Blocks look like: ====\n<ID> <label> — SYSTEM\n====\n<system>\n----\n<ID> <label> — USER\n----\n<user>
  const re = /={70}\n(\S+) (.*?) — SYSTEM\n={70}\n([\s\S]*?)\n-{70}\n\1 .*? — USER\n-{70}\n([\s\S]*?)(?=\n={70}\n\S+ .*? — SYSTEM|$)/g
  let m
  while ((m = re.exec(raw))) {
    scenarios.push({ id: m[1], label: m[2], system: m[3].trim(), user: m[4].trim() })
  }
}
if (scenarios.length === 0) throw new Error('no scenarios parsed from dump')
console.log(`parsed ${scenarios.length} scenarios: ${scenarios.map(s => s.id).join(', ')}`)

// ---- claude -p call ----
function callOnce(system, user) {
  const prompt = `${system}\n\n---\n\n${user}\n`
  return new Promise((resolve) => {
    const child = spawn('claude', [
      '-p', '--model', MODEL, '--effort', EFFORT,
      '--disallowedTools', '*', '--output-format', 'json',
    ], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_EXTRA_CA_CERTS: '/root/.ccr/ca-bundle.crt' } })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, error: 'timeout', raw: '' })
    }, CALL_TIMEOUT_MS)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e), raw: '' }) })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const body = JSON.parse(stdout)
        resolve({ ok: true, raw: String(body.result ?? ''), cost: body.total_cost_usd })
      } catch {
        resolve({ ok: false, error: `bad cli output: ${stdout.slice(0, 200)} ${stderr.slice(0, 200)}`, raw: '' })
      }
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// ---- reply parsing (mirrors src/mind/parse.ts essentials) ----
function stripFences(s) {
  return s.replace(/```(?:json)?/g, '').trim()
}
function parseReply(text) {
  const t = stripFences(text)
  const start = t.indexOf('{')
  if (start < 0) return { action: 'parse-fail', note: 'no json' }
  // find matching close brace by scanning
  let depth = 0, end = -1
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++
    else if (t[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return { action: 'parse-fail', note: 'unbalanced json' }
  let obj
  try { obj = JSON.parse(t.slice(start, end + 1)) } catch (e) { return { action: 'parse-fail', note: String(e).slice(0, 80) } }
  const action = String(obj.action ?? '')
  if (!ACTION_KINDS.has(action)) return { action: 'parse-fail', note: `unknown action ${action.slice(0, 30)}` }
  const row = {
    action,
    target: obj.target != null ? String(obj.target) : '',
    reasoning: obj.reasoning != null ? String(obj.reasoning) : '',
  }
  if (action === 'propose') {
    if (typeof obj.text !== 'string') return { ...row, action: 'propose-invalid', note: 'missing text' }
    if (obj.text.length === 0) return { ...row, action: 'propose-invalid', note: 'empty text' }
    if (obj.text.length > 200) return { ...row, action: 'propose-invalid', note: `text ${obj.text.length} chars`, text: obj.text }
    row.text = obj.text
  }
  if (action === 'vote') row.choice = obj.choice != null ? String(obj.choice) : ''
  if (obj.notes) row.notes = obj.notes
  return row
}

// ---- run ----
const results = {}
let totalCost = 0
for (const sc of scenarios) {
  const n = sc.id === 'G0' ? Math.min(N, 6) : N
  console.log(`running ${sc.id} ${sc.label} (n=${n})`)
  const rows = []
  let idx = 0
  async function worker() {
    while (idx < n) {
      idx++
      const r = await callOnce(sc.system, sc.user)
      if (!r.ok) { rows.push({ action: 'call-fail', note: r.error }); continue }
      totalCost += r.cost ?? 0
      const parsed = parseReply(r.raw)
      parsed.rawReply = r.raw.slice(0, 500)
      rows.push(parsed)
      process.stdout.write(`  ${sc.id}: ${parsed.action}${parsed.target ? '→' + parsed.target : ''}\n`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const hist = {}
  for (const r of rows) hist[r.action] = (hist[r.action] ?? 0) + 1
  results[sc.id] = { label: sc.label, n, hist, rows }
  console.log(`  ${sc.id} histogram: ${JSON.stringify(hist)}`)
  fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, effort: EFFORT, results, totalCost }, null, 2))
}
console.log(`done. total cost $${totalCost.toFixed(2)}. wrote ${OUT}`)

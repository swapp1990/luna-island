/**
 * Offline probes over a recorded lineage run. No new season is simulated: the run is
 * replayed from decisions.jsonl to rebuild the exact prompt at chosen turns, and only
 * those prompts are re-sent to the sidecar.
 *
 *   node scripts/lineage-probe.mjs --run <runDir> --mode effort  --effort medium [--max 20]
 *   node scripts/lineage-probe.mjs --run <runDir> --mode trigger --effort low    [--max 8]
 *
 * mode=effort : same prompt, different reasoning effort. Answers "is low effort why
 *               the model never takes disposition acts?"
 * mode=trigger: same effort as the run, but the Others line shows a starving
 *               neighbour (a true fact taken from state). Answers "is the hidden
 *               trigger why generosity never fires?"
 *
 * Output: artifacts/lineage/probes/<mode>-<effort>-<stamp>.md (+ .json)
 */
import { createServer } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const RUN = path.resolve(ROOT, arg('run', ''))
const MODE = arg('mode', 'effort')
const EFFORT = arg('effort', MODE === 'effort' ? 'medium' : 'low')
const MAX = Number(arg('max', MODE === 'effort' ? '20' : '8'))
// mode=synth: real prompt of a well-fed high-generosity villager (grain >= 3, satiety >= 0.6),
// with ONE neighbour's line edited to read as starving. A constructed counterfactual, not a
// run result: it asks "given surplus AND visible hunger, does the model give?"
const DNA = String(arg('dna', 'on')) !== 'off'
const BAND = String(arg('band', 'high')) // synth mode: which generosity band to sample
const CONC = 3
if (!RUN || !fs.existsSync(path.join(RUN, 'decisions.jsonl'))) {
  console.error('need --run <dir with decisions.jsonl>')
  process.exit(2)
}

process.env.LUNA_MIND_EFFORT = EFFORT
process.env.LUNA_ENGINE = 'codex'
process.env.LUNA_CONCURRENCY = String(CONC)
process.env.LUNA_MAX_PER_HOUR = '4000'
process.env.LUNA_MAX_PER_DAY = '8000'

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5210, strictPort: false },
  logLevel: 'error',
})
await server.listen()
const PORT = server.httpServer.address().port

const pad = (n) => String(n).padStart(2, '0')
const d0 = new Date()
const stamp = `${d0.getFullYear()}${pad(d0.getMonth() + 1)}${pad(d0.getDate())}-${pad(d0.getHours())}${pad(d0.getMinutes())}${pad(d0.getSeconds())}`

try {
  const world = await server.ssrLoadModule('/src/lineage/world.ts')
  const step = await server.ssrLoadModule('/src/lineage/step.ts')
  const season = await server.ssrLoadModule('/src/lineage/season.ts')
  const decider = await server.ssrLoadModule('/src/lineage/decider.ts')
  const prompt = await server.ssrLoadModule('/src/lineage/prompt.ts')
  const genome = await server.ssrLoadModule('/src/lineage/genome.ts')
  const rngMod = await server.ssrLoadModule('/src/sim/rng.ts')
  const evMod = await server.ssrLoadModule('/src/sim/events.ts')

  const health = await fetch(`http://127.0.0.1:${PORT}/api/luna/health`).then((r) => r.json())
  console.log(`health worker=${health.worker?.status ?? JSON.stringify(health).slice(0, 80)} effort=${EFFORT} mode=${MODE}`)

  const summary = JSON.parse(fs.readFileSync(path.join(RUN, 'summary.json'), 'utf8'))
  const decisions = fs
    .readFileSync(path.join(RUN, 'decisions.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const recorded = new Map(decisions.map((d) => [decider.decisionKey(d.season, d.day, d.turn, d.villagerId), d]))
  const brainFor = decider.recordedBrainFactory(decisions)

  const cfg = world.mergeConfig(summary.config)
  const rng = rngMod.createRng(cfg.seed)
  const trace = new evMod.EventTrace()
  const state = world.createHamlet(cfg, rng, trace)

  const B = (v, t) => genome.bandOf(v.traits[t])
  const bands = (v) => ['generosity', 'voice', 'thrift', 'boldness', 'temper'].map((t) => `${t.slice(0, 3)}:${B(v, t)[0].toUpperCase()}`).join(' ')
  const hungry = (o) => o.satiety <= 0.2 || o.starvingTurns > 0

  // Candidate selection: a disposition band is high AND the world offers a trigger.
  const perTrait = { generosity: 0, thrift: 0, voice: 0, boldness: 0 }
  const cap = MODE === 'trigger' ? { generosity: MAX, thrift: 0, voice: 0, boldness: 0 } : { generosity: 8, thrift: 4, voice: 4, boldness: 4 }
  const candidates = []
  for (let s = 0; s < cfg.seasons; s++) {
    for (let d = 0; d < cfg.daysPerSeason; d++) {
      for (let t = 0; t < cfg.turnsPerDay; t++) {
        const living = world.livingVillagers(state)
        for (const v of living) {
          if (candidates.length >= MAX) break
          const others = living.filter((o) => o.id !== v.id)
          const starving = others.filter(hungry)
          let trait = null
          let trigger = ''
          if (MODE === 'synth') {
            if (B(v, 'generosity') === BAND && v.grain >= 3 && v.satiety >= 0.6 && others.length > 0 && perTrait.generosity < MAX && !candidates.some((c) => c.villager === world.fullName(v))) {
              trait = 'generosity'
              const mark = others.slice().sort((a, b) => a.satiety - b.satiety)[0]
              trigger = `holds ${v.grain.toFixed(1)}, satiety ${Math.round(v.satiety * 100)}%; ${world.fullName(mark)} marked starving (synthetic)`
              starving.length = 0
              starving.push(mark)
            }
          } else if (B(v, 'generosity') === 'high' && v.grain >= 1 && starving.length > 0 && perTrait.generosity < cap.generosity) {
            trait = 'generosity'
            trigger = `holds ${v.grain.toFixed(1)}; ${starving.map((o) => world.fullName(o)).join(', ')} hungry`
          } else if (MODE === 'effort' && B(v, 'thrift') === 'high' && v.grain >= 3 && perTrait.thrift < cap.thrift) {
            trait = 'thrift'
            trigger = `holds ${v.grain.toFixed(1)} grain, granary ${state.granary.toFixed(1)}`
          } else if (MODE === 'effort' && B(v, 'voice') === 'high' && state.proposals.every((p) => p.resolved) && state.granary < 2 && perTrait.voice < cap.voice) {
            trait = 'voice'
            trigger = `granary ${state.granary.toFixed(1)}, no open proposal`
          } else if (MODE === 'effort' && B(v, 'boldness') === 'high' && v.energy > 0.5 && v.satiety > 0.5 && perTrait.boldness < cap.boldness) {
            trait = 'boldness'
            trigger = `rested and fed (energy ${Math.round(v.energy * 100)}%)`
          }
          if (!trait) continue
          const key = decider.decisionKey(s, d, t, v.id)
          const rec = recorded.get(key)
          if (!rec) continue
          // Snapshot: the live state keeps mutating during replay, and parseIntent must
          // validate targets against the villagers alive at this turn.
          const obs = structuredClone(step.observe(state, v))
          const system = prompt.buildSystemPrompt(v, { dna: DNA }, state.lineage)
          let user = prompt.buildUserPrompt(obs, trace.getAll())
          if (MODE === 'trigger' || MODE === 'synth') {
            for (const o of starving) {
              const name = world.fullName(o)
              const sat = MODE === 'synth' ? 5 : Math.round(o.satiety * 100)
              user = user.replace(new RegExp(`^(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, [a-z]+, standing -?\\d+)`, 'm'), `$1, starving (no grain, satiety ${sat}%)`)
            }
          }
          perTrait[trait]++
          candidates.push({ key, s, d, t, villager: world.fullName(v), bands: bands(v), trait, trigger, system, user, obs, recorded: rec.intent })
        }
        step.advanceTurn(state, brainFor, rng, trace)
      }
    }
    if (season.endSeason(state, rng, trace)) break
  }
  console.log(`candidates: ${candidates.length} (${JSON.stringify(perTrait)})`)

  // Re-ask the model for each candidate.
  let idx = 0
  const results = new Array(candidates.length)
  async function worker() {
    for (;;) {
      const i = idx++
      if (i >= candidates.length) return
      const c = candidates[i]
      const t0 = Date.now()
      let text = ''
      let error = ''
      try {
        for (let attempt = 0; attempt < 120; attempt++) {
          const res = await fetch(`http://127.0.0.1:${PORT}/api/luna/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system: c.system, user: c.user, engine: 'codex', kind: 'decision' }),
          })
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 750))
            continue
          }
          if (!res.ok) {
            error = `http ${res.status}`
            break
          }
          text = String((await res.json()).text ?? '')
          break
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      const parsed = text ? prompt.parseIntent(text, c.obs) : { error: error || 'no text' }
      results[i] = { ...c, obs: undefined, system: undefined, probe: parsed.intent ?? null, probeError: parsed.error ?? null, raw: text, latencyMs: Date.now() - t0 }
      const p = parsed.intent
      console.log(`[${i + 1}/${candidates.length}] ${c.villager} ${c.trait} | recorded ${c.recorded.kind}${c.recorded.target ? '→' + c.recorded.target : ''} | probe ${p ? p.kind + (p.target ? '→' + p.target : '') : 'INVALID ' + parsed.error} | ${Math.round((Date.now() - t0) / 1000)}s`)
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))

  // Report.
  const nameOf = (id) => {
    const r = state.lineage.find((x) => x.id === id)
    return r ? `${r.givenName} ${r.surname}` : id
  }
  const show = (it) => (it ? `${it.kind}${it.target ? ' → ' + nameOf(it.target) : ''}` : '—')
  const DISP = new Set(['give', 'propose', 'store', 'forage', 'shun', 'vote', 'withdraw'])
  const recDisp = results.filter((r) => DISP.has(r.recorded.kind)).length
  const probeDisp = results.filter((r) => r.probe && DISP.has(r.probe.kind)).length
  const changed = results.filter((r) => r.probe && r.probe.kind !== r.recorded.kind).length
  const matchesTrait = results.filter((r) => r.probe && ((r.trait === 'generosity' && r.probe.kind === 'give') || (r.trait === 'thrift' && r.probe.kind === 'store') || (r.trait === 'voice' && r.probe.kind === 'propose') || (r.trait === 'boldness' && r.probe.kind === 'forage'))).length
  const recMatches = results.filter((r) => (r.trait === 'generosity' && r.recorded.kind === 'give') || (r.trait === 'thrift' && r.recorded.kind === 'store') || (r.trait === 'voice' && r.recorded.kind === 'propose') || (r.trait === 'boldness' && r.recorded.kind === 'forage')).length
  const lines = [
    `# Lineage probe — mode ${MODE}, effort ${EFFORT}, dna ${DNA ? "on" : "off"}`,
    '',
    `Run: \`${path.basename(RUN)}\` (recorded at effort low). ${results.length} prompts re-asked. Mean latency ${Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / Math.max(1, results.length))} ms.`,
    MODE === 'trigger' ? 'The Others line was edited to show the true hunger of starving neighbours; nothing else changed.' : 'Prompts are byte-identical to the recorded run; only the reasoning effort differs.',
    '',
    `**Recorded (low): ${recDisp}/${results.length} disposition acts, ${recMatches} matching the villager's high trait. Probe: ${probeDisp}/${results.length} disposition acts, ${matchesTrait} matching. Decision changed in ${changed}/${results.length}.**`,
    '',
    '| # | S/D/t | villager | bands | trait | trigger | recorded (low) | probe | probe reason |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.s + 1}/${r.d + 1}/${r.t} | ${r.villager} | ${r.bands} | ${r.trait} | ${r.trigger} | ${show(r.recorded)} | ${r.probe ? show(r.probe) : 'INVALID: ' + r.probeError} | ${(r.probe?.reason ?? '').replace(/\|/g, '/').slice(0, 110)} |`)
  })
  const outDir = path.join(ROOT, 'artifacts', 'lineage', 'probes')
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.join(outDir, `${MODE}-${BAND}-${EFFORT}-dna${DNA ? "on" : "off"}-${stamp}`)
  fs.writeFileSync(base + '.md', lines.join('\n') + '\n')
  fs.writeFileSync(base + '.json', JSON.stringify({ run: RUN, mode: MODE, effort: EFFORT, results }, null, 2))
  console.log(`out ${base}.md`)
} finally {
  await server.close()
}

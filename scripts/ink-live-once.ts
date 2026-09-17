/**
 * Gate 3: one live xAI decide. Never prints the key.
 * Usage: npx tsx scripts/ink-live-once.ts
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EventTrace } from '../src/sim/events'
import { memoryLines } from '../src/ink/mind/memory'
import { buildSystem, buildUser } from '../src/ink/mind/prompt'
import { observationFor } from '../src/ink/sim/observe'
import { createWorld } from '../src/ink/sim/world'
import {
  DEFAULT_XAI_MODEL,
  XAI_KILL_MS,
  resolveInkModel,
  resolveXaiKey,
  runXaiWithDeps,
} from './luna-xai'

const outDir = path.join(process.cwd(), 'artifacts', 'ink')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'live-once.json')

const resolved = resolveXaiKey(
  process.env,
  (p) => fs.readFileSync(p, 'utf8'),
  process.cwd(),
)
if (!resolved.key) {
  fs.writeFileSync(outFile, `${JSON.stringify({ ok: false, error: 'missing-key' }, null, 2)}\n`)
  process.exit(2)
}

const model = resolveInkModel(process.env)
const state = createWorld(42)
const events = new EventTrace()
const obs = observationFor(state, 'A')
const system = buildSystem(obs.self.name)
const user = buildUser(obs, memoryLines(events.getAll(), 'A'))

const result = await runXaiWithDeps(system, user, {
  apiKey: resolved.key,
  model,
  killMs: XAI_KILL_MS,
  jsonMode: true,
  now: () => Date.now(),
  fetchImpl: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

fs.writeFileSync(
  outFile,
  `${JSON.stringify(
    {
      ok: true,
      model,
      keySource: resolved.source,
      defaultModel: DEFAULT_XAI_MODEL,
      system,
      user,
      text: result.text,
      latencyMs: result.latencyMs,
      usage: result.usage ?? null,
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(`wrote ${outFile} latencyMs=${result.latencyMs} tokens=${JSON.stringify(result.usage)}\n`)

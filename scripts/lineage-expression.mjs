/**
 * Render a phenotype-expression report from one or two lineage run dirs.
 *
 *   node scripts/lineage-expression.mjs <runDirA> [<runDirB>]
 *
 * With two dirs, dirA is treated as DNA on and dirB as DNA off.
 */
import { createServer } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (dirs.length < 1) {
  console.error('usage: node scripts/lineage-expression.mjs <runDirA> [<runDirB>]')
  process.exit(1)
}

function loadRun(dir) {
  const abs = path.resolve(ROOT, dir)
  const eventsPath = path.join(abs, 'events.jsonl')
  const lineagePath = path.join(abs, 'lineage.json')
  const summaryPath = path.join(abs, 'summary.json')
  if (!fs.existsSync(eventsPath) || !fs.existsSync(summaryPath) || !fs.existsSync(lineagePath)) {
    throw new Error(`missing events.jsonl, lineage.json, or summary.json in ${abs}`)
  }
  const events = fs
    .readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
  const lineage = JSON.parse(fs.readFileSync(lineagePath, 'utf8'))
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
  return { abs, events, lineage, config: summary.config }
}

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5201, strictPort: false },
})
await server.listen()

try {
  const exprMod = await server.ssrLoadModule('/src/lineage/render/expression.ts')
  const a = loadRun(dirs[0])
  const reportA = exprMod.expressionReport(a.events, a.lineage, a.config)
  fs.writeFileSync(path.join(a.abs, 'expression.md'), reportA.markdown)
  fs.writeFileSync(path.join(a.abs, 'expression.json'), JSON.stringify(reportA.json, null, 2))

  if (dirs[1]) {
    const b = loadRun(dirs[1])
    const reportB = exprMod.expressionReport(b.events, b.lineage, b.config)
    fs.writeFileSync(path.join(b.abs, 'expression.md'), reportB.markdown)
    fs.writeFileSync(path.join(b.abs, 'expression.json'), JSON.stringify(reportB.json, null, 2))
    const cmp = exprMod.compareExpression(reportA.json, reportB.json)
    const both = [
      reportA.markdown.trim(),
      '',
      reportB.markdown.trim(),
      '',
      cmp.markdown.trim(),
      '',
    ].join('\n')
    fs.writeFileSync(path.join(a.abs, 'expression-compare.md'), both)
    fs.writeFileSync(path.join(a.abs, 'expression-compare.json'), JSON.stringify(cmp.json, null, 2))
    console.log(both)
  } else {
    console.log(reportA.markdown)
  }
} finally {
  await server.close()
}

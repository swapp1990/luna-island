/**
 * Load a recorded soak world through restoreSave and print the head tick.
 * Usage: node scripts/import-soak.mjs [path-to-world.json]
 */
import { createServer } from 'vite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const worldPath = path.resolve(
  process.argv[2] ?? path.join('artifacts', 'soak-1786938450347-world.json'),
)

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5197, strictPort: false },
})
await server.listen()
try {
  const persist = await server.ssrLoadModule('/src/sim/persist.ts')
  const raw = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
  const sim = persist.restoreSave(raw)
  console.log(
    JSON.stringify({
      file: path.relative(ROOT, worldPath),
      formatVersion: raw.formatVersion,
      headTick: sim.state.tick,
      declaredTick: raw.tick,
      agentCount: sim.state.agents.length,
      saveFormatVersion: persist.SAVE_FORMAT_VERSION,
    }),
  )
} finally {
  await server.close()
}

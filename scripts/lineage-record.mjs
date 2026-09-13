/**
 * Lineage S2 capture CLI.
 *
 *   node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json
 *     [--only A1,B2] [--out artifacts/lineage-site/recordings] [--port 5231] [--headed]
 *
 * Resolves shot-list globs, launches Playwright with playwright.record.config.ts,
 * and leaves transcode / contact-sheet / shots.json writes to the spec.
 */
import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..')
export const ART = path.join(ROOT, 'artifacts', 'lineage')

export const VIEWS = Object.freeze(['feed', 'card', 'bloodlines', 'analysis', 'compare'])
export const SPEEDS = Object.freeze([1, 8, 64])
export const VIEWPORTS = Object.freeze([
  [390, 844],
  [1280, 800],
  [1920, 1080],
  [3440, 1440],
])
/** Spec wall-clock (1× = 1.5 s/turn). Site timers are 1500 / 190 / 23 ms. */
export const SEC_PER_TURN = Object.freeze({ 1: 1.5, 8: 0.1875, 64: 0.0234 })
export const SPEED_MS = Object.freeze({ 1: 1500, 8: 190, 64: 23 })

export function ffmpegPath() {
  if (fs.existsSync('C:/Users/swapp/bin/ffmpeg.exe')) return 'C:/Users/swapp/bin/ffmpeg.exe'
  if (fs.existsSync('C:/FFmpeg/bin/ffmpeg.exe')) return 'C:/FFmpeg/bin/ffmpeg.exe'
  return 'ffmpeg'
}

export function ffprobePath() {
  if (fs.existsSync('C:/Users/swapp/bin/ffprobe.exe')) return 'C:/Users/swapp/bin/ffprobe.exe'
  if (fs.existsSync('C:/FFmpeg/bin/ffprobe.exe')) return 'C:/FFmpeg/bin/ffprobe.exe'
  return 'ffprobe'
}

export function parseArgs(argv) {
  const out = { shots: null, only: '', out: null, port: 5231, headed: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v == null || v.startsWith('--')) throw new Error(`missing value for ${a}`)
      i += 1
      return v
    }
    if (a === '--headed') out.headed = true
    else if (a.startsWith('--shots=')) out.shots = a.slice('--shots='.length)
    else if (a === '--shots') out.shots = next()
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length)
    else if (a === '--only') out.only = next()
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length)
    else if (a === '--out') out.out = next()
    else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length))
    else if (a === '--port') out.port = Number(next())
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  if (!Number.isFinite(out.port) || out.port <= 0) throw new Error(`bad --port: ${out.port}`)
  return out
}

export function parseOnly(raw) {
  if (!raw || !String(raw).trim()) return null
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export function listRunDirs(art = ART) {
  if (!fs.existsSync(art)) return []
  const out = []
  for (const name of fs.readdirSync(art)) {
    if (name === 'probes') continue
    const dir = path.join(art, name)
    try {
      const st = fs.statSync(dir)
      if (!st.isDirectory()) continue
      if (!fs.existsSync(path.join(dir, 'summary.json'))) continue
      out.push({ id: name, dir, mtime: st.mtimeMs })
    } catch {
      // skip unreadable entries
    }
  }
  return out
}

export function newestMock(art = ART) {
  const mocks = listRunDirs(art)
    .filter((r) => r.id.startsWith('mock-'))
    .sort((a, b) => b.mtime - a.mtime)
  return mocks[0] ?? null
}

/**
 * Resolve a shot `run` glob against artifacts/lineage/. Several matches → newest mtime.
 * If nothing matches and allowMock, fall back to the newest mock-* dir.
 */
export function resolveRun(pattern, { allowMock = true, art = ART } = {}) {
  if (!pattern || typeof pattern !== 'string') return null
  const re = globToRegExp(pattern)
  const matched = listRunDirs(art)
    .filter((r) => re.test(r.id))
    .sort((a, b) => b.mtime - a.mtime)
  if (matched[0]) {
    return { id: matched[0].id, dir: matched[0].dir, fallback: false, pattern }
  }
  if (!allowMock) return null
  const mock = newestMock(art)
  if (!mock) return null
  return { id: mock.id, dir: mock.dir, fallback: true, pattern }
}

export function viewportKey(viewport) {
  return `${viewport[0]}x${viewport[1]}`
}

function isViewport(v) {
  if (!Array.isArray(v) || v.length !== 2) return false
  return VIEWPORTS.some((p) => p[0] === v[0] && p[1] === v[1])
}

/**
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateShotList(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['shot list is not an object'] }
  }
  if (typeof data.experiment !== 'string' || !data.experiment.trim()) {
    errors.push('experiment must be a non-empty string')
  }
  if (!Array.isArray(data.shots) || data.shots.length === 0) {
    errors.push('shots must be a non-empty array')
    return { ok: false, errors }
  }
  const ids = new Set()
  for (let i = 0; i < data.shots.length; i++) {
    const s = data.shots[i]
    const p = `shots[${i}]`
    if (!s || typeof s !== 'object') {
      errors.push(`${p} is not an object`)
      continue
    }
    if (typeof s.id !== 'string' || !/^[A-Z][0-9]+$/.test(s.id)) {
      errors.push(`${p}.id must match /[A-Z][0-9]+/ (got ${JSON.stringify(s.id)})`)
    } else if (ids.has(s.id)) {
      errors.push(`duplicate shot id ${s.id}`)
    } else {
      ids.add(s.id)
    }
    if (typeof s.run !== 'string' || !s.run.trim()) errors.push(`${p}.run must be a string glob`)
    if (!VIEWS.includes(s.view)) errors.push(`${p}.view must be one of ${VIEWS.join('|')}`)
    if (!isViewport(s.viewport)) {
      errors.push(`${p}.viewport must be one of ${VIEWPORTS.map((v) => v.join('x')).join(', ')}`)
    }
    if (!SPEEDS.includes(s.speed)) errors.push(`${p}.speed must be 1|8|64`)
    if (!Number.isInteger(s.fromTurn) || s.fromTurn < 0) errors.push(`${p}.fromTurn must be an integer ≥ 0`)
    if (!Number.isInteger(s.turns) || s.turns < 0) errors.push(`${p}.turns must be an integer ≥ 0`)
    if (s.turns === 0) {
      if (!Number.isInteger(s.holdMs) || s.holdMs <= 0) {
        errors.push(`${p}.holdMs must be a positive integer when turns is 0`)
      }
    }
    if (!Number.isInteger(s.leadInMs) || s.leadInMs < 0) errors.push(`${p}.leadInMs must be an integer ≥ 0`)
    if (!Number.isInteger(s.tailMs) || s.tailMs < 0) errors.push(`${p}.tailMs must be an integer ≥ 0`)
    if (s.villager != null && typeof s.villager !== 'string') {
      errors.push(`${p}.villager must be string or null`)
    }
    if (s.vs != null && typeof s.vs !== 'string') errors.push(`${p}.vs must be string or null`)
    if (s.view === 'compare' && !s.vs) errors.push(`${p}.vs is required when view is compare`)
    if (typeof s.note !== 'string') errors.push(`${p}.note must be a string`)
  }
  return { ok: errors.length === 0, errors }
}

export function loadShotList(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(raw)
  const v = validateShotList(data)
  if (!v.ok) throw new Error(`invalid shot list ${file}:\n- ${v.errors.join('\n- ')}`)
  return data
}

export function filterShots(shots, { only, viewport } = {}) {
  const want = only instanceof Set ? only : parseOnly(only)
  return shots.filter((s) => {
    if (want && !want.has(s.id)) return false
    if (viewport && (s.viewport[0] !== viewport.width || s.viewport[1] !== viewport.height)) {
      return false
    }
    return true
  })
}

export function expectedPlayMs(shot) {
  if (shot.turns === 0) return shot.holdMs ?? 0
  return shot.turns * SEC_PER_TURN[shot.speed] * 1000
}

export function durationSuspect(durationSec, expectedMs) {
  if (!(expectedMs > 0) || !(durationSec > 0)) {
    return { suspect: true, reason: 'missing duration or expected wall time' }
  }
  const got = durationSec * 1000
  const delta = Math.abs(got - expectedMs) / expectedMs
  if (delta <= 0.15) return { suspect: false, reason: null }
  const why =
    got > expectedMs
      ? 'recorded stream longer than leadIn+wall+tail (±15%) — dropped frames or untrimmed load'
      : 'recorded stream shorter than leadIn+wall+tail (±15%) — throttled tab or early pause'
  return { suspect: true, reason: why }
}

export function transcodeWebmToMp4(webm, mp4, { ss = 0 } = {}) {
  const args = ['-y', '-i', webm]
  // Drop the pre-ready load head so duration ≈ leadIn + wall + tail.
  if (ss > 0.05) args.push('-ss', ss.toFixed(3))
  args.push(
    '-vf',
    'fps=30,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    mp4,
  )
  execFileSync(ffmpegPath(), args, { stdio: 'inherit', timeout: 180_000 })
}

export function probeMp4(mp4) {
  const raw = execFileSync(
    ffprobePath(),
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,nb_frames,duration,pix_fmt',
      '-of',
      'json',
      mp4,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  )
  const json = JSON.parse(raw)
  const s = json.streams?.[0]
  if (!s) throw new Error(`ffprobe: no video stream in ${mp4}`)
  const [num, den] = String(s.r_frame_rate ?? '0/1').split('/').map(Number)
  const fps = den ? num / den : Number(s.r_frame_rate)
  const frames = s.nb_frames == null || s.nb_frames === 'N/A' ? null : Number(s.nb_frames)
  return {
    width: Number(s.width),
    height: Number(s.height),
    fps,
    frames: Number.isFinite(frames) ? frames : null,
    durationSec: Number(s.duration),
    pix_fmt: s.pix_fmt ?? null,
  }
}

export function writeContactSheet(mp4, png, durationSec) {
  const rows = Math.max(1, Math.ceil(Number(durationSec) / 10))
  const vf = `fps=1,scale=320:-1,tile=10x${rows}`
  // tile emits one image; image2 needs -update 1 when the filename has no %d.
  const args = ['-y', '-i', mp4, '-vf', vf, '-frames:v', '1', '-update', '1', png]
  try {
    execFileSync(ffmpegPath(), args, { stdio: 'inherit', timeout: 60_000 })
  } catch (err) {
    const n = Math.max(1, Math.min(10, Math.ceil(Number(durationSec) || 1)))
    execFileSync(
      ffmpegPath(),
      [
        '-y',
        '-i',
        mp4,
        '-vf',
        `fps=1,scale=320:-1,tile=${n}x1`,
        '-frames:v',
        '1',
        '-update',
        '1',
        png,
      ],
      { stdio: 'inherit', timeout: 60_000 },
    )
    void err
  }
}

export function appendShotEntry(outDir, experiment, entry) {
  const file = path.join(outDir, 'shots.json')
  let data = { experiment, shots: [] }
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      data = { experiment, shots: [] }
    }
  }
  if (!data || typeof data !== 'object') data = { experiment, shots: [] }
  data.experiment = data.experiment || experiment
  const shots = Array.isArray(data.shots) ? data.shots.filter((s) => s && s.id !== entry.id) : []
  shots.push(entry)
  shots.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))
  data.shots = shots
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

export function relFromRoot(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/')
}

function usage() {
  return `Usage: node scripts/lineage-record.mjs --shots shots/lineage-experiment-01.json [--only A1,B2] [--out artifacts/lineage-site/recordings] [--port 5231] [--headed]`
}

function runPlaywright(args, env) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const child = spawn(cmd, ['playwright', 'test', ...args], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`playwright killed by ${signal}`))
      else resolve(code ?? 1)
    })
  })
}

export async function main(argv = process.argv.slice(2)) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(String(err.message || err))
    console.error(usage())
    process.exitCode = 2
    return 2
  }
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (!args.shots) {
    console.error('missing --shots')
    console.error(usage())
    process.exitCode = 2
    return 2
  }

  const shotsPath = path.resolve(ROOT, args.shots)
  if (!fs.existsSync(shotsPath)) {
    console.error(`shot list not found: ${shotsPath}`)
    process.exitCode = 2
    return 2
  }
  const list = loadShotList(shotsPath)
  const only = parseOnly(args.only)
  const selected = filterShots(list.shots, { only })
  if (selected.length === 0) {
    console.error(`no shots selected (only=${args.only || '*'})`)
    process.exitCode = 2
    return 2
  }

  const outDir = path.resolve(ROOT, args.out ?? path.join('artifacts', 'lineage-site', 'recordings'))
  fs.mkdirSync(outDir, { recursive: true })

  const shotsJson = path.join(outDir, 'shots.json')
  if (only) {
    let existing = { experiment: list.experiment, shots: [] }
    if (fs.existsSync(shotsJson)) {
      try {
        existing = JSON.parse(fs.readFileSync(shotsJson, 'utf8'))
      } catch {
        existing = { experiment: list.experiment, shots: [] }
      }
    }
    existing.experiment = list.experiment
    existing.shots = (existing.shots || []).filter((s) => s && !only.has(s.id))
    fs.writeFileSync(shotsJson, `${JSON.stringify(existing, null, 2)}\n`)
  } else {
    fs.writeFileSync(shotsJson, `${JSON.stringify({ experiment: list.experiment, shots: [] }, null, 2)}\n`)
  }

  const projects = [...new Set(selected.map((s) => viewportKey(s.viewport)))]
  const pwArgs = ['--config', path.join(ROOT, 'playwright.record.config.ts')]
  for (const p of projects) {
    pwArgs.push('--project', p)
  }

  const env = {
    ...process.env,
    LINEAGE_SHOTS: shotsPath,
    LINEAGE_ONLY: args.only || '',
    LINEAGE_OUT: outDir,
    LINEAGE_RECORD_PORT: String(args.port),
    LINEAGE_EXPERIMENT: list.experiment,
  }
  if (args.headed) env.LINEAGE_HEADED = '1'

  console.log(
    `[lineage-record] shots=${selected.map((s) => s.id).join(',')} out=${relFromRoot(outDir)} port=${args.port} projects=${projects.join(',')}`,
  )

  const code = await runPlaywright(pwArgs, env)
  if (code !== 0) {
    process.exitCode = code
    return code
  }

  const produced = fs.existsSync(shotsJson)
    ? JSON.parse(fs.readFileSync(shotsJson, 'utf8'))
    : { shots: [] }
  for (const s of selected) {
    const entry = (produced.shots || []).find((row) => row.id === s.id)
    if (!entry) {
      console.error(`[lineage-record] missing shots.json entry for ${s.id}`)
      process.exitCode = 1
      return 1
    }
    const mp4 = path.isAbsolute(entry.mp4) ? entry.mp4 : path.join(ROOT, entry.mp4)
    const sheet = path.isAbsolute(entry.sheet) ? entry.sheet : path.join(ROOT, entry.sheet)
    if (!fs.existsSync(mp4)) {
      console.error(`[lineage-record] missing mp4 for ${s.id}: ${mp4}`)
      process.exitCode = 1
      return 1
    }
    if (!fs.existsSync(sheet)) {
      console.error(`[lineage-record] missing sheet for ${s.id}: ${sheet}`)
      process.exitCode = 1
      return 1
    }
    console.log(
      `[lineage-record] ${s.id} run=${entry.runDir} turns=${entry.turnStart}→${entry.turnEnd} wallMs=${entry.wallMs} ${entry.probe?.width}x${entry.probe?.height} ${entry.probe?.durationSec}s suspect=${Boolean(entry.suspect)}`,
    )
  }
  return 0
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

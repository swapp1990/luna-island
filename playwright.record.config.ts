import { defineConfig } from '@playwright/test'

/**
 * Lineage S2 capture config. Separate from `playwright.config.ts` so
 * `video: on` never slows the e2e gate. Real GPU only — never swiftshader.
 *
 * Driven by `node scripts/lineage-record.mjs`.
 */
const port = Number(process.env.LINEAGE_RECORD_PORT ?? process.env.PLAYWRIGHT_PORT ?? 5231)
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const headed = process.env.LINEAGE_HEADED === '1'

const glArgs = [
  '--enable-webgl',
  '--use-angle=default',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
]

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '3440x1440', width: 3440, height: 1440 },
] as const

export default defineConfig({
  testDir: './e2e/record',
  testMatch: /lineage-record\.spec\.ts/,
  outputDir: './test-results/lineage-record',
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: !headed,
    video: 'on',
    launchOptions: { args: glArgs },
  },
  projects: VIEWPORTS.map((vp) => ({
    name: vp.name,
    use: {
      viewport: { width: vp.width, height: vp.height },
      video: { mode: 'on' as const, size: { width: vp.width, height: vp.height } },
    },
  })),
  webServer: {
    command: `${npxCommand} vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

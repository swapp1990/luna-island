import { defineConfig, devices } from '@playwright/test'

/**
 * Demo-recording config. Separate from `playwright.config.ts` (the e2e gate)
 * so turning video on never slows the gate down.
 *
 * Run with: npx playwright test --config=playwright.demo.config.ts
 *
 * Its own port so it never fights a dev server you are browsing on 5175.
 */
const port = Number(process.env.DEMO_PORT ?? 5176)
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export default defineConfig({
  testDir: './demo',
  timeout: 5 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    // Real GPU, same as the gate — never swiftshader.
    launchOptions: {
      args: [
        '--enable-webgl',
        '--use-angle=default',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
      ],
    },
  },
  projects: [{ name: 'demo', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${npxCommand} vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

import { defineConfig } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5175)
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const softwareGl = process.env.DEMO_SOFTWARE_GL === '1'
const glArgs = softwareGl
  ? ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--enable-webgl', '--use-angle=default', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: glArgs },
  },
  webServer: {
    command: `${npxCommand} vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
})

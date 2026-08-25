/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lunaSidecarPlugin } from './scripts/luna-sidecar'
import { lunaRunsPlugin } from './scripts/luna-runs'

export default defineConfig({
  plugins: [react(), lunaSidecarPlugin(), lunaRunsPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Multi-day sims + stateAt hash under parallel load need headroom (default 5s flakes).
    testTimeout: 20_000,
  },
})

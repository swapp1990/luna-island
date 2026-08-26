/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { lunaSidecarPlugin } from './scripts/luna-sidecar'
import { lunaRunsPlugin } from './scripts/luna-runs'

/**
 * Phase 6's god game lives on its own entry (`god.html` → `src/god/**`) and shares
 * nothing with the sim app. This only makes the pretty URL `/god` resolve to it.
 */
function godRoutePlugin(): Plugin {
  return {
    name: 'luna-god-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/god' || req.url === '/god/') req.url = '/god.html'
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lunaSidecarPlugin(), lunaRunsPlugin(), godRoutePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        god: 'god.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Multi-day sims + stateAt hash under parallel load need headroom (default 5s flakes).
    testTimeout: 20_000,
  },
})

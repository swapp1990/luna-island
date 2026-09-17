/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { lunaSidecarPlugin } from './scripts/luna-sidecar'
import { lunaRunsPlugin } from './scripts/luna-runs'
import { lineageRunsPlugin } from './scripts/lineage-runs'
import { inkSidecarPlugin } from './scripts/ink-sidecar'

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

/**
 * The colony builder (plans/colony-builder.md) grows on `/town` → `town.html` →
 * `src/town/**`. This rewrites the pretty URL and serves the manor-slice glTF
 * exports read-only at /assets/gltf/* so the asset pipeline has a stable URL
 * space in dev. (Production asset serving is a later, deliberate step.)
 */
function townPlugin(): Plugin {
  const gltfRoot = path.resolve(process.cwd(), 'art/manor-slice/export/gltf')
  const types: Record<string, string> = {
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  }
  return {
    name: 'luna-town',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/town' || req.url === '/town/') {
          req.url = '/town.html'
          return next()
        }
        {
          // /lineage keeps its query string (run, t, speed, autoplay) through the rewrite.
          const raw = req.url ?? ''
          const q = raw.indexOf('?')
          const pathname = q >= 0 ? raw.slice(0, q) : raw
          if (pathname === '/lineage' || pathname === '/lineage/') {
            req.url = `/lineage.html${q >= 0 ? raw.slice(q) : ''}`
            return next()
          }
        }
        if (req.url === '/observer' || req.url === '/observer/') {
          req.url = '/observer.html'
          return next()
        }
        if (req.url === '/gallery' || req.url === '/gallery/') {
          req.url = '/gallery.html'
          return next()
        }
        if (req.url === '/age-0' || req.url === '/age-0/') {
          req.url = '/age-0.html'
          return next()
        }
        if (req.url === '/ink' || req.url === '/ink/') {
          req.url = '/ink.html'
          return next()
        }
        if (req.url?.startsWith('/assets/gltf/')) {
          const rel = decodeURIComponent(req.url.slice('/assets/gltf/'.length).split('?')[0])
          const file = path.resolve(gltfRoot, rel)
          if (!file.startsWith(gltfRoot) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.statusCode = 404
            return res.end('not found')
          }
          res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
          return fs.createReadStream(file).pipe(res)
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), lunaSidecarPlugin(), lunaRunsPlugin(), lineageRunsPlugin(), godRoutePlugin(), townPlugin(), inkSidecarPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        observer: 'observer.html',
        god: 'god.html',
        town: 'town.html',
        gallery: 'gallery.html',
        lineage: 'lineage.html',
        ageZero: 'age-0.html',
        ink: 'ink.html',
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

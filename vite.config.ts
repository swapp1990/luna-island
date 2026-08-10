/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lunaSidecarPlugin } from './scripts/luna-sidecar'

export default defineConfig({
  plugins: [react(), lunaSidecarPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

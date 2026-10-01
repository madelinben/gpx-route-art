import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  // GitHub Pages serves the project site from /<repo>/
  base: '/gpx-route-art/',
  resolve: { tsconfigPaths: true },
  plugins: [
    // Static SPA output (no server) for GitHub Pages
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: '/index.html' } } }),
    viteReact(),
  ],
})

export default config

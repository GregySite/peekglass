import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

// Build / dev config for the search page (search/index.html).
// `bunx vite --config vite.search.config.ts` · `bunx vite build --config vite.search.config.ts`
export default defineConfig({
  root: resolve(__dirname, 'search'),
  base: './',
  publicDir: resolve(__dirname, 'search/public'),
  plugins: [glsl({ minify: true })],
  resolve: {
    alias: {
      '@': resolve(__dirname, './app'),
      '√': resolve(__dirname, './voroforce'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-search'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 3100,
  },
})

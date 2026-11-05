import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const pagesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test/pages');

// Same wasm inliner as the dev config: .wasm → base64 data URL (self-contained bundle).
const wasmInlinePlugin = () => ({
  name: 'wasm-inline',
  enforce: 'pre',
  transform(_code, id) {
    const cleanId = id.split('?')[0];
    if (cleanId.endsWith('.wasm')) {
      const base64 = fs.readFileSync(cleanId).toString('base64');
      return {
        code: `export default "data:application/wasm;base64,${base64}";`,
        map: null,
      };
    }
  },
});

// Static multi-page site build for public testing (the lib build in vite.config.js
// doesn't emit the test pages). Dev-server first loads crawl hundreds of on-demand
// module transforms — fine locally, hopeless through a tunnel for testers.
export default defineConfig({
  root: './test/pages',
  publicDir: '../public',
  base: './',
  build: {
    outDir: '../../dist-site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(pagesRoot, 'index.html'),
        perf: path.resolve(pagesRoot, 'schematic-perf.html'),
        playground: path.resolve(pagesRoot, 'playground.html'),
        viewer: path.resolve(pagesRoot, 'viewer.html'),
      },
    },
  },
  // no topLevelAwait polyfill plugin: it crashes this build (@swc "missing field type"),
  // and testers run modern Chrome where top-level await is native
  plugins: [wasmInlinePlugin(), wasm()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  worker: {
    // Vite 4 inline workers are classic scripts; ES output leaves import.meta in the WASM glue.
    format: 'iife',
    plugins: [wasmInlinePlugin()],
  },
});

/**
 * Dev-only config for the v2 UI harness. Not part of the Electron build —
 * Forge/webpack still produces the shipped app.
 *
 *   npm run harness   ->   http://localhost:5180
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer/dev',
  server: { port: 5180, open: true },
  esbuild: { jsx: 'automatic' },
  build: { outDir: '../../../.harness', emptyOutDir: true },
});

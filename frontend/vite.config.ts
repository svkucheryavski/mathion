import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Under vitest, resolve `svelte` to its browser entry so the client runtime
  // is loaded — `flushSync`, `mount`, etc. are otherwise noops in the server
  // entry, which makes $effect/$state-based reactivity untestable in unit
  // tests. Scoped to `process.env.VITEST` so dev/build behavior is unchanged.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/assets': 'http://localhost:8000',
    },
  },
  build: {
    outDir: 'dist',
    // Pinned to "_app" (NOT default "assets") so frontend bundle URLs land at
    // /_app/index-abc.js and never collide with the backend's
    // /assets/{version_id}/{filename} route.
    assetsDir: '_app',
  },
  test: {
    environment: 'jsdom',
    globals: false,
  },
});

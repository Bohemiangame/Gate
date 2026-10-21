import { defineConfig } from 'vite';

// GitHub Pages serves the project at /Gate/. Relative base works there and on portals.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});

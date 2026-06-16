import { defineConfig } from 'vite';

// Vite config for the Hot Track Builder.
//
// - `base: './'` emits relative asset URLs so the site works when served from a
//   GitHub Pages *project* subpath (https://<user>.github.io/<repo>/) without
//   hardcoding the repository name.
// - Output goes to `dist/` (git-ignored), which the Pages workflow publishes.
// - Three.js is bundled from node_modules — no import map or vendoring needed.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});

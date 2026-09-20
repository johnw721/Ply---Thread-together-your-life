import { defineConfig } from 'vite';

/* Static output, no server. `base: './'` keeps the build openable from a
   subdirectory and from GitHub Pages without knowing the path in advance. */
export default defineConfig({
  base: './',
  /* Preact's automatic JSX runtime: components are plain .jsx with no h() import. */
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  }
});

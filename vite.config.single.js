import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* The offline build. Ply's whole premise was "open index.html in a browser, no
   build step, no server, no dependencies" — a build step does not have to cost
   that. This inlines every script and stylesheet into one file that still works
   from file://, alongside the normal multi-file output.

   The service worker and the manifest are deliberately NOT part of it: file://
   has no origin a worker can claim, and the PWA section already treats all three
   as additive. */
export default defineConfig({
  base: './',
  /* Preact's automatic JSX runtime: components are plain .jsx with no h() import. */
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  /* Nothing beside it. The manifest, the icons and the worker are the three
     things that only mean something over https, and this build is the one that
     has to survive being emailed to yourself and opened from a Downloads
     folder. registerSW() already refuses on a file:// origin and says why. */
  publicDir: false,
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    /* A classic script, not a module. Chrome refuses `type="module"` over
       file:// — it is a cross-origin fetch there — so a module build would
       produce a single file that opens to a blank page, which is the one thing
       this build exists to prevent. IIFE also means jsdom can run it, so
       scripts/smoke-dist.mjs can prove it boots. */
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  },
  plugins: [viteSingleFile()]
});

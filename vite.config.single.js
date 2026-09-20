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
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false
  },
  plugins: [viteSingleFile()]
});

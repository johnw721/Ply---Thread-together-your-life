/* Turns the single-file build's module script into a classic one.

   Vite always emits `type="module"` for an app build, and hoists it into <head>.
   Chrome refuses a module script over file:// — it counts as a cross-origin
   fetch — so the file would open to a blank page, which is the one thing this
   build exists to prevent.

   By this point vite-plugin-singlefile has inlined everything into one chunk, so
   nothing is left for the module type to do. Two things still have to change:
   the script has to move to the end of <body>, because a classic script is not
   deferred and would otherwise run before the markup it wires itself to exists;
   and the entry chunk's trailing `export { bootstrap }` has to go, since nothing
   imports this bundle and the statement is a syntax error outside a module. */
import fs from 'node:fs';

const FILE = 'dist-single/index.html';
let html = fs.readFileSync(FILE, 'utf8');

const tag = /<script type="module"(?:\s+crossorigin)?>([\s\S]*?)<\/script>/.exec(html);
if (!tag) throw new Error('no module script found in ' + FILE);

const body = tag[1].replace(/\n?export\s*\{[^}]*\};?\s*$/, '\n');

/* The honest check: compile it the way a browser would. A text search for
   "export" finds the word inside "That file is not a Ply export." — this does
   not, and it catches anything module-only rather than the cases I thought of. */
try { new Function(body); }
catch (e) { throw new Error(`${FILE} does not compile as a classic script: ${e.message}`); }

/* Replacement FUNCTIONS, not strings. `$&`, `$'` and `$\`` are substitution
   patterns in a string replacement, and minified Preact is full of `$&&` — which
   silently spliced `</body>` into the middle of the bundle and produced a file
   that parsed as HTML and died on the first `<`. */
html = html.replace(tag[0], () => '').replace(/<\/body>/, () => `<script>${body}</script>\n</body>`);
fs.writeFileSync(FILE, html);
console.log(`dist-single/index.html: classic script at end of body, ${html.length / 1024 | 0} kB`);

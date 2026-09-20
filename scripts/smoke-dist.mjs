/* Boots the built output in jsdom and checks the app actually came up.

   `vite build` succeeding only means the modules resolved. This is what catches
   a bundle that loads and then throws — in particular for the single-file build,
   which is the one people open from a Downloads folder with no server anywhere,
   and which nothing else in the suite exercises.

   jsdom does not execute `type="module"`, so the multi-file bundle is inlined
   and run as a classic script here. That is a weaker check than a browser would
   give — module semantics are not exercised — but it still proves the bundled
   code runs and renders, which is the failure worth catching. The single-file
   build is already a classic script, so it runs here exactly as it would from
   file://. */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

/** inline any external script, drop the module type, move it to the end of body */
function asClassic(html, dir){
  html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
    (_, src) => `<script type="module">${fs.readFileSync(path.join(dir, src), 'utf8')}</script>`);
  const tag = /<script type="module"(?:\s+crossorigin)?>([\s\S]*?)<\/script>/.exec(html);
  if (!tag) return html;                                  // already classic
  const body = tag[1].replace(/\n?export\s*\{[^}]*\};?\s*$/, '\n');
  return html.replace(tag[0], '').replace(/<\/body>/, `<script>${body}</script>\n</body>`);
}

let failed = 0;
for (const [file, label] of [['dist-single/index.html', 'single file'],
                             ['dist/index.html',        'multi-file']]){
  if (!fs.existsSync(file)){ console.log(`✗ ${label}: ${file} was not built`); failed++; continue; }

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));

  const dom = new JSDOM(asClassic(fs.readFileSync(file, 'utf8'), path.dirname(file)), {
    runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true, virtualConsole: vc
  });
  dom.window.Element.prototype.setPointerCapture ||= function(){};
  await new Promise(r => setTimeout(r, 150));

  const view = dom.window.document.querySelector('#view');
  const goals = dom.window.__ply?.DB?.goals.length ?? 0;
  const rendered = view ? view.innerHTML.length : 0;
  const ok = rendered > 500 && goals > 0 && !errors.length;

  console.log(ok
    ? `✓ ${label}: booted, ${goals} demo goals, ${rendered} chars rendered`
    : `✗ ${label}: rendered=${rendered} goals=${goals}` +
      (errors.length ? `\n    ${errors.slice(0, 3).join('\n    ')}` : ''));
  if (!ok) failed++;
  dom.window.close();
}
process.exit(failed ? 1 : 0);

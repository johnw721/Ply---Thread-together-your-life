/* Boots the built output in jsdom and checks the app actually came up.

   `vite build` succeeding only means the modules resolved. This is what catches
   a bundle that loads and then throws — in particular for the single-file build,
   which is the one people open from a Downloads folder with no server anywhere,
   and which nothing else in the suite exercises.

   jsdom does not execute `type="module"` at all, so the multi-file build cannot
   honestly be booted here — once it code-splits, its entry has real import
   statements and there is nothing to run it with. It gets a structural check
   instead: the entry script is there and points at an asset that exists.

   The single-file build IS a classic script, so it runs here exactly as it would
   from a Downloads folder, which is the build that most needs proving. */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

let failed = 0;

/* multi-file: structural only, for the reason above */
{
  const file = 'dist/index.html';
  if (!fs.existsSync(file)){ console.log('✗ multi-file: dist/index.html was not built'); failed++; }
  else {
    const html = fs.readFileSync(file, 'utf8');
    const src = /<script type="module"[^>]*src="([^"]+)"/.exec(html);
    const asset = src && path.join('dist', src[1].replace(/^\.\//, ''));
    const ok = !!(asset && fs.existsSync(asset) && fs.statSync(asset).size > 1000);
    console.log(ok ? `✓ multi-file: entry module present, ${(fs.statSync(asset).size/1024|0)} kB bundle`
                   : `✗ multi-file: entry script missing or empty (${src ? src[1] : 'no script tag'})`);
    if (!ok) failed++;
  }
}

for (const [file, label] of [['dist-single/index.html', 'single file']]){
  if (!fs.existsSync(file)){ console.log(`✗ ${label}: ${file} was not built`); failed++; continue; }

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));

  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
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

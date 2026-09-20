/* Removes an imported name only when it appears NOWHERE else in the file.

   The import generator is deliberately permissive — it would rather add an unused
   import than miss a real one — and an unused import is not free: it creates a
   module cycle, and a cycle decides which module sees the other's constants as
   undefined.

   But the asymmetry runs the other way here. A kept-but-unused import is dead
   weight; a wrongly removed one breaks the app. So this does not try to be clever
   about what counts as a reference: if the identifier occurs anywhere outside the
   import lines — even as an object key — it stays. The cycles that actually
   mattered (the type table, the schema number, the store reaching the UI) are
   broken structurally instead, in types.js, schema.js and bus.js. */
import fs from 'node:fs';
const EXT = /\.(js|jsx|ts|tsx)$/;


const FILES = fs.readdirSync('src',{recursive:true}).filter(f=>EXT.test(f)).map(f=>'src/'+f);
let removed = 0;
for (const f of FILES){
  if (f === 'src/debug.js' || f === 'src/bus.js') continue;
  const src = fs.readFileSync(f,'utf8');
  const body = src.replace(/^import \{[^}]*\} from '[^']+';$/gm, '');
  let out = src;
  for (const m of src.matchAll(/^import \{ ([^}]+) \} from '([^']+)';$/gm)){
    const names = m[1].split(',').map(x=>x.trim()).filter(Boolean);
    /* `render as preactRender` binds the LOCAL name; searching for the whole
       clause finds nothing and silently drops a live import. */
    const localOf = n => { const a = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(n); return a ? a[1] : n; };
    const keep = names.filter(n =>
      new RegExp('(?<![.\\w$])'+localOf(n).replace(/\$/g,'\\$')+'(?![\\w$])').test(body));
    if (keep.length === names.length) continue;
    removed += names.length - keep.length;
    console.log(`  ${f}: - ${names.filter(n=>!keep.includes(n)).join(', ')}`);
    const line = keep.length ? `import { ${keep.join(', ')} } from '${m[2]}';` : '';
    out = out.replace(m[0], () => line);
  }
  out = out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');
  if (out !== src) fs.writeFileSync(f, out);
}
console.log(removed ? 'pruned '+removed+' unused imports' : 'no unused imports');

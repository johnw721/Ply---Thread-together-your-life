/* Adds any import a module needs but does not have.

   The initial split generated imports by analysis; the setters and init wrappers
   added afterwards (setDB, initRibbon, …) were hand-written, so their call sites
   can reference a name the module never imported. This closes that gap, and is
   safe to re-run. */
import fs from 'node:fs';
import path from 'node:path';

const FILES = fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.js')).map(f=>'src/'+f);

import { strip } from './_strip.mjs';


const owns = new Map();
for (const f of FILES){
  const src = strip(fs.readFileSync(f,'utf8'));
  for (const m of src.matchAll(/^export (?:async function|function|class)\s+([A-Za-z_$][\w$]*)/gm)) owns.set(m[1],f);
  for (const m of src.matchAll(/^export (?:const|let|var)\s+(.+)$/gm)){
    let depth=0, buf='', parts=[];
    for(const ch of m[1]){
      if('([{'.includes(ch)) depth++; else if(')]}'.includes(ch)) depth--;
      if(ch===',' && depth===0){ parts.push(buf); buf=''; continue; }
      buf+=ch;
    }
    parts.push(buf);
    for(const p of parts){ const n=/^\s*([A-Za-z_$][\w$]*)\s*(=|;|$)/.exec(p); if(n) owns.set(n[1],f); }
  }
}

const rel = (from,to) => {
  let p = path.relative(path.dirname(from), to).split(path.sep).join('/');
  return p.startsWith('.') ? p : './'+p;
};

let touched = 0;
for (const f of FILES){
  if (f === 'src/debug.js' || f === 'src/bus.js') continue;
  let src = fs.readFileSync(f,'utf8');
  const have = new Set();
  for (const m of src.matchAll(/^import \{ ([^}]+) \} from/gm))
    m[1].split(',').forEach(n=>have.add(n.trim()));
  const scanned = strip(src);
  for (const m of scanned.matchAll(/^export (?:async function|function|class)\s+([A-Za-z_$][\w$]*)/gm)) have.add(m[1]);
  for (const m of scanned.matchAll(/^export (?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) have.add(m[1]);
  for (const [n,home] of owns) if(home===f) have.add(n);

  const need = new Map();
  for (const [name,home] of owns){
    if (home===f || have.has(name)) continue;
    const re = new RegExp('(?<![.\\w$])'+name.replace(/\$/g,'\\$')+'(?![\\w$])');
    if (!re.test(scanned)) continue;
    if(!need.has(home)) need.set(home,new Set());
    need.get(home).add(name);
  }
  if (!need.size) continue;

  // merge into the existing header rather than stacking a second one
  for (const [home,names] of need){
    const spec = rel(f,home);
    const re = new RegExp("^import \\{ ([^}]+) \\} from '"+spec.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"';$",'m');
    const hit = re.exec(src);
    if (hit){
      const all = [...new Set([...hit[1].split(',').map(x=>x.trim()), ...names])].sort();
      /* a replacement FUNCTION, not a string: '$$' in a string replacement is an
         escape for a literal '$', which silently turned `$$` into `$`. */
      const line = `import { ${all.join(', ')} } from '${spec}';`;
      src = src.replace(hit[0], () => line);
    } else {
      src = `import { ${[...names].sort().join(', ')} } from '${spec}';\n` + src;
    }
  }
  fs.writeFileSync(f,src);
  touched++;
  console.log(f+': + '+[...need.values()].flatMap(s=>[...s]).join(', '));
}
console.log(touched ? touched+' files updated' : 'nothing missing');

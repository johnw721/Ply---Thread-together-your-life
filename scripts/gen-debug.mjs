import fs from 'node:fs';
const bridge = fs.readFileSync('test/bridge.js','utf8');
const list = key => {
  const m = new RegExp('export const '+key+' = \\[([\\s\\S]*?)\\];').exec(bridge);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
};
const VALUES = list('BRIDGE_VALUES'), ACCESSORS = list('BRIDGE_ACCESSORS');

const FILES = fs.readdirSync('src',{recursive:true}).filter(f=>f.endsWith('.js') && f!=='debug.js').map(f=>'src/'+f);
const owns = new Map();
for (const f of FILES)
  for (const m of fs.readFileSync(f,'utf8').matchAll(/^export (?:async function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm))
    if(!owns.has(m[1])) owns.set(m[1], f);
// multi-declarator lines
for (const f of FILES)
  for (const m of fs.readFileSync(f,'utf8').matchAll(/^export (?:const|let)\s+(.+)$/gm))
    for (const d of m[1].split(',')){
      const n = /^\s*([A-Za-z_$][\w$]*)/.exec(d);
      if (n && !owns.has(n[1])) owns.set(n[1], f);
    }

const SETTERS = {DB:'setDB', CK:'setCK', SIGOPEN:'setSigOpen', SIGALL:'setSigAll', SIGFIX:'setSigFix',
  GERR:'setGErr', GEROW:'setGerow', INSTALL_EVT:'setInstallEvt', SWREG:'setSWREG', SWSTATE:'setSWSTATE'};

const wanted = new Map();  // file -> Set(names)
const add = (n) => {
  const f = owns.get(n); if(!f) return false;
  if(!wanted.has(f)) wanted.set(f, new Set());
  wanted.get(f).add(n); return true;
};
const missing = [];
for (const n of VALUES) if(!add(n)) missing.push(n);
for (const n of ACCESSORS) if(!add(n)) missing.push(n);
for (const [n,s] of Object.entries(SETTERS)) if(owns.has(s)) add(s);

const relOf = f => './' + f.replace(/^src\//,'');
const header = [...wanted.entries()].sort().map(([f,names]) =>
  `import { ${[...names].sort().join(', ')} } from '${relOf(f)}';`).join('\n');

const valueLines = VALUES.filter(n=>owns.has(n)).map(n=>`  ${n},`).join('\n');
const accLines = ACCESSORS.filter(n=>owns.has(n)).map(n=>{
  const set = SETTERS[n] && owns.has(SETTERS[n])
    ? `  set ${n}(v){ ${SETTERS[n]}(v); },`
    : `  set ${n}(_v){ /* owned by its module; no setter is exported */ },`;
  return `  get ${n}(){ return ${n}; },\n${set}`;
}).join('\n');

fs.writeFileSync('src/debug.js', `${header}

/* ---------------------------------------------------------------------------
   The test seam.

   The monolith kept every function in one script scope, so a suite could reach
   anything. Modules close that door, so the door is reopened deliberately and in
   one place: the same surface the jsdom bridge exposes for the monolith, which is
   what lets one suite run against both targets and prove they behave alike.

   Reassigned bindings are getters — undo(), import and the demo seed REPLACE the
   database rather than mutating it, so a snapshot taken at boot would go stale.

   Generated to match test/bridge.js; see scripts/gen-debug.mjs.
--------------------------------------------------------------------------- */
export const API = {
${valueLines}
${accLines}
};

export default API;
`);
console.log('debug.js:', VALUES.filter(n=>owns.has(n)).length, 'values,',
            ACCESSORS.filter(n=>owns.has(n)).length, 'accessors');
if (missing.length) console.log('NOT FOUND IN src/:', missing.join(', '));

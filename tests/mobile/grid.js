#!/usr/bin/env node
/* Builds tests/mobile/grid.html: every surface, before beside after, at both
   viewports, with each pair's numbers underneath. Run it after two passes:

     node tests/mobile/mobile.js --no-assert --app <old index.html> --out tests/mobile/shots/before
     node tests/mobile/mobile.js                                   --out tests/mobile/shots/after
     node tests/mobile/grid.js

   The page references the PNGs relatively rather than inlining them, so it
   stays a few kilobytes and the shots stay diffable on their own. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
const OUT = path.join(HERE, 'grid.html');

const read = side => {
  const p = path.join(SHOTS, side, 'report.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
const before = read('before'), after = read('after');
if (!before || !after) {
  console.error('need both tests/mobile/shots/before/report.json and .../after/report.json');
  process.exit(1);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function verdict(s){
  if (!s) return {ok:false, text:'not captured'};
  const bits = [];
  if (!s.hscroll.ok) bits.push(`scrolls +${s.hscroll.over}px`);
  if (!s.clipped.ok) bits.push('content clipped off-screen');
  if (!s.tap.ok) bits.push(`${s.tap.bad.length} of ${s.tap.audited} targets under 44px`);
  return {ok: bits.length === 0, text: bits.length ? bits.join(' · ') : `clean · ${s.tap.audited} targets audited`};
}

const EXTRA = [
  {id:'sched-keyboard', title:'Scheduling row, keyboard open (375×360)'},
  {id:'toast', title:'Toast over an open dialog'}
];

let pairs = '';
for (const vp of Object.keys(after.viewports)) {
  const A = after.viewports[vp], B = before.viewports[vp] || {surfaces:{}, checks:{}};
  pairs += `<h2>${esc(vp)}</h2>`;
  for (const [id, sa] of Object.entries(A.surfaces)) {
    const sb = B.surfaces[id];
    const vb = verdict(sb), va = verdict(sa);
    pairs += `<section>
      <h3>${esc(sa.title || id)}</h3>
      <div class="pair">
        <figure><img loading="lazy" src="shots/before/${esc(vp)}--${esc(id)}.png" alt="before">
          <figcaption class="${vb.ok?'ok':'bad'}"><b>before</b> ${esc(vb.text)}</figcaption></figure>
        <figure><img loading="lazy" src="shots/after/${esc(vp)}--${esc(id)}.png" alt="after">
          <figcaption class="${va.ok?'ok':'bad'}"><b>after</b> ${esc(va.text)}</figcaption></figure>
      </div></section>`;
  }
  for (const x of EXTRA) {
    pairs += `<section>
      <h3>${esc(x.title)}</h3>
      <div class="pair">
        <figure><img loading="lazy" src="shots/before/${esc(vp)}--${esc(x.id)}.png" alt="before">
          <figcaption><b>before</b></figcaption></figure>
        <figure><img loading="lazy" src="shots/after/${esc(vp)}--${esc(x.id)}.png" alt="after">
          <figcaption><b>after</b></figcaption></figure>
      </div></section>`;
  }
  const rows = Object.keys(A.checks).map(k => {
    const b = B.checks[k], a = A.checks[k];
    return `<tr><td>${esc(k)}</td>
      <td class="${b && b.ok ? 'ok':'bad'}">${b ? (b.ok?'ok':'fail') : '—'}</td>
      <td class="${a && a.ok ? 'ok':'bad'}">${a ? (a.ok?'ok':'fail') : '—'}</td></tr>`;
  }).join('');
  pairs += `<table><caption>behavioural checks, ${esc(vp)}</caption>
    <tr><th>check</th><th>before</th><th>after</th></tr>${rows}</table>`;
}

const totals = side => {
  const r = side === 'before' ? before : after;
  let tap = 0, clip = 0, scroll = 0, checks = 0;
  for (const V of Object.values(r.viewports)) {
    for (const s of Object.values(V.surfaces)) {
      if (s.tap) tap += s.tap.bad.length;
      if (s.clipped && !s.clipped.ok) clip++;
      if (s.hscroll && !s.hscroll.ok) scroll++;
    }
    for (const c of Object.values(V.checks)) if (c && c.ok === false) checks++;
  }
  return {tap, clip, scroll, checks};
};
const T0 = totals('before'), T1 = totals('after');

fs.writeFileSync(OUT, `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ply — the phone pass, before and after</title>
<style>
:root{--bg:#0e1014;--panel:#161920;--line:#2a303c;--text:#e7eaf1;--dim:#9aa3b5;
  --good:#4ec9a0;--bad:#ef5f5f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);padding:28px 20px 60px;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--dim);margin:0 0 22px}
h2{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:34px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
h3{font-size:14px;font-weight:600;margin:20px 0 8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}
figure{margin:0}
img{width:100%;display:block;border:1px solid var(--line);border-radius:10px;background:#000}
figcaption{font-size:12px;color:var(--dim);margin-top:6px}
figcaption b{color:var(--text);font-weight:600;margin-right:6px}
.ok{color:var(--good)}.bad{color:var(--bad)}
table{border-collapse:collapse;margin:20px 0 4px;font-size:13px;width:100%;max-width:460px}
caption{text-align:left;color:var(--dim);font-size:12px;padding-bottom:6px}
th,td{text-align:left;padding:5px 12px 5px 0;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;font-size:12px}
.scoreboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 8px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile .n{font-size:22px;font-weight:650;letter-spacing:-.02em}
.tile .n s{color:var(--bad);text-decoration:none;opacity:.8}
.tile .n em{font-style:normal;color:var(--dim);margin:0 6px}
.tile .n b{color:var(--good)}
.tile .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-top:4px}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
<h1>Ply — the phone pass</h1>
<p class="sub">Real markup, real stylesheet, Chromium at 375×812 and 390×844.
  Left is the build the README described as &ldquo;verified by rendering, not by running&rdquo;; right is after.</p>
<div class="scoreboard">
  <div class="tile"><div class="n"><s>${T0.tap}</s><em>&rarr;</em><b>${T1.tap}</b></div>
    <div class="k">targets under 44px</div></div>
  <div class="tile"><div class="n"><s>${T0.clip}</s><em>&rarr;</em><b>${T1.clip}</b></div>
    <div class="k">surfaces clipped off-screen</div></div>
  <div class="tile"><div class="n"><s>${T0.scroll}</s><em>&rarr;</em><b>${T1.scroll}</b></div>
    <div class="k">surfaces scrolling sideways</div></div>
  <div class="tile"><div class="n"><s>${T0.checks}</s><em>&rarr;</em><b>${T1.checks}</b></div>
    <div class="k">behavioural checks failing</div></div>
</div>
${pairs}
<p class="sub" style="margin-top:34px">Generated by <code>tests/mobile/grid.js</code> from the two
  <code>report.json</code> files. ${esc(new Date().toISOString().slice(0,10))}</p>
</div></body></html>
`);
console.log('grid → ' + OUT);

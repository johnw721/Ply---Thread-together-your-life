import { hrs, loadState } from '../budget.js';
import { FIXABLE, sigFixAct, sigResolverHTML } from './resolver.js';
import { SEV_RANK, hushed, shortName, signals, snoozeSignals } from '../engine.js';
import { openGoal } from '../goal-editor.js';
import { gAct, gChips } from '../google.js';
import { $, el, esc, today } from '../util.js';

export const SIG_KIND={
  branch:      'unresolved branch',
  nostep:      'no next step defined',
  unscheduled: 'next step not on the calendar',
  slipped:     'slipped past its slot',
  quiet:       'no recent movement',
  blocked:     'blocked, still waiting',
  deadline:    'deadline closing in',
  gate:        'waiting on an answer',
  hushed:      'gone quiet — not nagging'
};
export const SIG_MAX=5;
export let SIGOPEN=null, SIGALL=false, SIGFIX=null;
export function setSigOpen(v){ SIGOPEN=v; }
export function setSigAll(v){ SIGALL=v; }
export function setSigFix(v){ SIGFIX=v; }

/* ---------- resolving a signal where you found it ----------
   The check-in used to be the only door to four things: answering a gate, resolving
   a branch, giving a dead thread a next step, and putting a loose step on the
   calendar. That made a weekly ritual load-bearing for the whole app. The ribbon
   already knows exactly which threads need which of those, so it can just ask.
   Markup is local; every action below calls the same engine functions the check-in
   calls, so there is one implementation of each rule. */

export function renderSignals(){
  const sig=signals(); const r=$('#signals');
  /* The provider's own chips sit ahead of the groups and are deliberately not
     snoozeable: "three changes waiting to sync" is a fact about the app, not a
     nag about a thread, and muting it would just lose the writes quietly. */
  const pins=gChips().map(c=>
    `<div class="sig ${c.cls}" data-gact="${c.act}">${c.text}</div>`).join('');
  r.classList.toggle('empty', sig.length===0 && !pins);
  if(!sig.length){ r.innerHTML=pins; SIGOPEN=null; return; }

  const byKind={}, groups=[];
  for(const s of sig){
    let gr=byKind[s.kind];
    if(!gr){ gr=byKind[s.kind]={kind:s.kind, sev:s.sev, items:[]}; groups.push(gr); }
    gr.items.push(s);
    if(SEV_RANK[s.sev]<SEV_RANK[gr.sev]) gr.sev=s.sev;
  }
  groups.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev] || b.items.length-a.items.length);
  if(SIGOPEN && !byKind[SIGOPEN]) SIGOPEN=null;
  const fix = SIGFIX && sig.find(s=>s.key===SIGFIX);
  if(SIGFIX && !fix) SIGFIX=null;

  const shown=SIGALL?groups:groups.slice(0,SIG_MAX), rest=SIGALL?[]:groups.slice(SIG_MAX);
  const chips=shown.map(gr=>{
    const keys=gr.items.map(i=>i.key).join('|');
    const zz=`<span class="zz" data-snooze="${keys}" title="Snooze 7 days">&#215;</span>`;
    const cls=gr.sev==='hard'?'hard':gr.sev==='mute'?'mute':'';
    if(gr.items.length===1){
      const s=gr.items[0];
      const fixable=FIXABLE.has(s.kind);
      return `<div class="sig ${cls} ${SIGFIX===s.key?'open':''}" data-sig="${esc(s.key)}" data-goal="${s.goal.id}">
        <b>${esc(shortName(s.goal))}</b> ${esc(s.text)}${fixable?'<span class="fixmark">fix</span>':''}${zz}</div>`;
    }
    const open=SIGOPEN===gr.kind;
    return `<div class="sig ${cls} ${open?'open':''}" data-grp="${gr.kind}">
      <b>${gr.items.length} ${gr.kind==='gate'?'question'+(gr.items.length>1?'s':''):'threads'}</b> ${esc(SIG_KIND[gr.kind]||gr.kind)}
      <span class="caret">${open?'&#9650;':'&#9660;'}</span>${zz}</div>`;
  }).join('');

  const more = rest.length
    ? `<div class="sig more" data-sigmore="1">+${rest.reduce((n,g)=>n+g.items.length,0)} more</div>`
    : (SIGALL && groups.length>SIG_MAX ? `<div class="sig more" data-sigmore="1">show less</div>` : '');

  let panel='';
  if(SIGOPEN && byKind[SIGOPEN] && byKind[SIGOPEN].items.length>1){
    const items=byKind[SIGOPEN].items;
    panel=`<div class="sigopen">${items.map(s=>
      `<div class="srow ${SIGFIX===s.key?'on':''}" data-sig="${esc(s.key)}" data-goal="${s.goal.id}">
         <b>${esc(shortName(s.goal))}</b><span class="t">${esc(s.text)}</span>
         ${FIXABLE.has(s.kind)?'<span class="fixmark">fix</span>':''}
         <span class="zz" data-snooze="${s.key}" title="Snooze 7 days">snooze</span></div>`).join('')}
      <div class="sfoot"><span class="zz" data-snooze="${items.map(i=>i.key).join('|')}">Snooze all ${items.length} for 7 days</span></div></div>`;
  }
  // the resolver sits under the ribbon so it reads as an answer to the chip above it
  const fixPanel = fix ? sigResolverHTML(fix) : '';
  r.innerHTML=`<div class="sigrow">${pins}${chips}${more}</div>${panel}${fixPanel}`;
  if(fix){ const f=$('#fxStep')||$('#fxTrig')||$('#fxDate')||$('#fxWhen'); if(f) setTimeout(()=>f.focus(),20); }
}

/* ---------- shared card ---------- */

/* Wired once from main.js — #signals outlives every render. */
export function initRibbon(){
$('#signals').onclick=e=>{
  const ga=e.target.closest('[data-gact]');
  if(ga){ gAct(ga.dataset.gact); return; }
  const zz=e.target.closest('[data-snooze]');
  if(zz){ e.stopPropagation(); snoozeSignals(zz.dataset.snooze.split('|')); return; }
  const fx=e.target.closest('[data-fix]');
  if(fx){ sigFixAct(fx.dataset.fix,fx); return; }
  if(e.target.closest('.sigfix')) return;                  // clicks inside the form are the form's
  const more=e.target.closest('[data-sigmore]');
  if(more){ SIGALL=!SIGALL; renderSignals(); return; }
  const grp=e.target.closest('[data-grp]');
  if(grp){ SIGOPEN = SIGOPEN===grp.dataset.grp ? null : grp.dataset.grp; SIGFIX=null; renderSignals(); return; }
  // a resolvable signal opens its resolver rather than the whole goal editor
  const sg=e.target.closest('[data-sig]');
  if(sg){
    const key=sg.dataset.sig, s=signals().find(x=>x.key===key);
    if(s && FIXABLE.has(s.kind)){ SIGFIX = SIGFIX===key ? null : key; renderSignals(); return; }
  }
  const s=e.target.closest('[data-goal]'); if(s) openGoal(s.dataset.goal);
};
$('#signals').onkeydown=e=>{
  if(e.key==='Enter' && e.target.closest('.sigfix')){
    const btn=$('.sigfix .btn.primary'); if(btn) sigFixAct(btn.dataset.fix,btn);
  }
  if(e.key==='Escape' && SIGFIX){ SIGFIX=null; renderSignals(); }
};
/* live feedback on the scheduling resolver: say what that day already holds */
$('#signals').oninput=e=>{
  if(e.target.id!=='fxWhen') return;
  const el=$('#fxLoad'); if(!el) return;
  const L=loadState(e.target.value||today());
  el.innerHTML = L.over ? `<span class="overtxt">that day is already ${hrs(L.mins)}</span> against a ${hrs(L.budget)} day`
                        : `${hrs(L.free)} free that day`;
};

/* The three things a person can do to the provider by hand. None of them takes a
   checkpoint: connecting, syncing and reconnecting are not edits to your goals,
   and putting them on the undo stack would mean Cmd-Z silently signing you out. */
}

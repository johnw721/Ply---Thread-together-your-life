import { bumpUi } from '../signals.js';
import { renderSignals } from './ribbon.jsx';
import { hrs, loadState } from '../budget.js';
import { FIXABLE, sigFixAct } from './resolver.js';
import { hushed, signals, snoozeSignals } from '../engine.js';
import { openGoal } from '../goal-editor.js';
import { gAct } from '../google.js';
import { $, el, today } from '../util.js';

export const SIG_KIND={
  branch:      'unresolved branch',
  nostep:      'no next step defined',
  unscheduled: 'next step not on the calendar',
  slipped:     'slipped past its slot',
  quiet:       'no recent movement',
  blocked:     'blocked, still waiting',
  deadline:    'deadline closing in',
  gate:        'waiting on an answer',
  hushed:      'gone quiet — not nagging',
  prereq:      'not done yet, and due',
  overbudget:  'committed past what is allocated',
  tmpl:        'a template default looks off',
  reschedule:  'kept getting moved',
  til:         'notes due for review'
};
export const SIG_MAX=5;
export let SIGOPEN=null, SIGALL=false, SIGFIX=null;

/* Which group is expanded, whether the row is showing everything, which chip has
   its resolver open. All transient, none of it in the DB — and all of it read by
   a component, so each setter bumps the UI signal. Assigning these directly
   changes nothing on screen: @preact/signals gives a component that reads a
   signal its own shouldComponentUpdate, and re-rendering with identical props is
   then correctly skipped. */
export function setSigOpen(v){ SIGOPEN=v; bumpUi(); }
export function setSigAll(v){ SIGALL=v; bumpUi(); }
export function setSigFix(v){ SIGFIX=v; bumpUi(); }

/* ---------- resolving a signal where you found it ----------
   The check-in used to be the only door to four things: answering a gate, resolving
   a branch, giving a dead thread a next step, and putting a loose step on the
   calendar. That made a weekly ritual load-bearing for the whole app. The ribbon
   already knows exactly which threads need which of those, so it can just ask.
   Markup is local; every action below calls the same engine functions the check-in
   calls, so there is one implementation of each rule. */

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
  if(more){ setSigAll(!SIGALL); renderSignals(); return; }
  const grp=e.target.closest('[data-grp]');
  if(grp){ setSigOpen(SIGOPEN===grp.dataset.grp ? null : grp.dataset.grp); setSigFix(null); renderSignals(); return; }
  // a resolvable signal opens its resolver rather than the whole goal editor
  const sg=e.target.closest('[data-sig]');
  if(sg){
    const key=sg.dataset.sig, s=signals().find(x=>x.key===key);
    if(s && FIXABLE.has(s.kind)){ setSigFix(SIGFIX===key ? null : key); renderSignals(); return; }
  }
  const s=e.target.closest('[data-goal]'); if(s) openGoal(s.dataset.goal);
};
$('#signals').onkeydown=e=>{
  if(e.key==='Enter' && e.target.closest('.sigfix')){
    const btn=$('.sigfix .btn.primary'); if(btn) sigFixAct(btn.dataset.fix,btn);
  }
  if(e.key==='Escape' && SIGFIX){ setSigFix(null); renderSignals(); }
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

import { budAct, commitBudget, paintBudget } from '../budget.js';
import { CARDSUBS } from '../components/card.js';
import { consumeSwallowClick } from '../components/drag.js';
import { renderSignals } from '../components/ribbon.js';
import { checkinAgenda, checkinDue, shortName, toggleSub } from '../engine.js';
import { openDefineNext, openEvent, openGoal, toggleStep } from '../goal-editor.js';
import { renderInstallBar } from '../pwa.js';
import { DB, beginPass, checkpoint, endPass, eventById, goalById, paintUndo, reopenGoal, save, threadById } from '../store.js';
import { $, $$, addDays, el, toast, today } from '../util.js';
import { viewDay } from './day.js';
import { listHidden, viewList } from './list.js';
import { viewQuarter } from './quarter.js';
import { viewWeek } from './week.js';

/* ===================== [SECTION: VIEWS] ===================== */
export const QUAD = {
  q1:{n:'Do now',    ax:'Urgent + Important',       c:'var(--q1)'},
  q2:{n:'Schedule',  ax:'Important, not urgent',    c:'var(--q2)'},
  q3:{n:'Offload',   ax:'Urgent, not important',    c:'var(--q3)'},
  q4:{n:'Defer',     ax:'Neither',                  c:'var(--q4)'}
};
export const ZOOMS=['day','week','quarter','list'];
export let lastZoomIdx=0;

/* ---------- keeping your place across a re-render ----------
   Every mutation replaces #view wholesale. When the new content is a different height
   — a row completed, a type filtered out, a checklist expanded — the browser clamps
   the scroll and you land back at the top, having just acted on something halfway
   down. Capture and restore instead. Focus goes the same way: an inline input that
   was mid-edit is a different DOM node afterwards, so re-find it by what identifies
   it and put the caret back. */
export function captureView(){
  const m=$('main'); const a=document.activeElement;
  const st={top:m?m.scrollTop:0, sel:null, start:null, end:null};
  if(a && a!==document.body && $('#view') && $('#view').contains(a)){
    const bits=[];
    if(a.className) bits.push('.'+String(a.className).trim().split(/\s+/).join('.'));
    for(const k of ['new','s','t','sub','i','cat','goal','step']) if(a.dataset && a.dataset[k]!=null)
      bits.push(`[data-${k}="${CSS.escape?CSS.escape(a.dataset[k]):a.dataset[k]}"]`);
    if(bits.length){
      st.sel=bits.join('');
      if(a.selectionStart!=null){ st.start=a.selectionStart; st.end=a.selectionEnd; }
    }
  }
  return st;
}
export function restoreView(st){
  const m=$('main'); if(m && st.top) m.scrollTop=st.top;
  if(!st.sel) return;
  let el=null; try{ el=$(st.sel,$('#view')); }catch(_){ el=null; }
  if(!el || el===document.activeElement) return;
  el.focus();
  if(st.start!=null && el.setSelectionRange){ try{ el.setSelectionRange(st.start,st.end); }catch(_){} }
}

export function render(){
  beginPass();                   // one computation of the shared reads, this pass only
  try{ renderBody(); }finally{ endPass(); }
}
export function renderBody(){
  const keep=captureView();
  const z=DB.meta.zoom;
  $$('#zoombar button').forEach(b=>b.classList.toggle('on',b.dataset.z===z));
  const idx=ZOOMS.indexOf(z);
  const dir = idx>lastZoomIdx ? 'zout' : idx<lastZoomIdx ? 'zin' : '';
  lastZoomIdx=idx;
  const v=$('#view');
  v.className=dir;
  v.innerHTML = z==='day'?viewDay(): z==='week'?viewWeek(): z==='list'?viewList(): viewQuarter();
  renderSignals();
  const due=checkinDue(); const b=$('#checkinBadge');
  const ag=checkinAgenda(); const n=ag.gates.length+ag.quiet.length+ag.nostep.length+ag.branch.length;
  b.classList.toggle('hidden', !due);
  if(due) b.textContent = n?('due · '+n):'due';
  $('#btnCheckin').classList.toggle('primary', due);
  paintUndo();
  renderInstallBar();
  wireView();
  restoreView(keep);
}

/* ---------- signal ribbon ----------
   A wall of chips gets ignored, and an ignored ribbon defeats the whole premise.
   So: one chip per *kind*, not per thread. Kinds with several threads behind them
   collapse to a count and expand on click; the ribbon itself never exceeds SIG_MAX. */

export function wireView(){
  const v=$('#view');
  v.onclick=e=>{
    if(consumeSwallowClick()) return;   // the click that ends a drag isn't a click
    const bud=e.target.closest('[data-bud]');
    if(bud){ budAct(bud.dataset.bud,bud); return; }
    const seg=e.target.closest('.bbar i[data-cat]');
    if(seg){ const inp=$(`.brow[data-cat="${seg.dataset.cat}"] .bamt`,v); if(inp){inp.focus();inp.select();} return; }
    if(e.target.closest('.budget')) return;           // the panel's own inputs are not goal cards
    const nav=e.target.closest('[data-nav]');
    if(nav){ const n=+nav.dataset.nav;
      DB.meta.cursor = n===0 ? today() : addDays(DB.meta.cursor,n); save(); render(); return; }
    const jump=e.target.closest('[data-jump]');
    if(jump){ DB.meta.cursor=jump.dataset.jump; DB.meta.zoom='week'; save(); render(); return; }
    if(e.target.closest('[data-act="newEvent"]')){ openEvent(null); return; }
    const chk=e.target.closest('[data-act="toggle"]');
    if(chk){ const c=chk.closest('[data-step]'); toggleStep(c.dataset.goal,c.dataset.thread,c.dataset.step); return; }
    const sx=e.target.closest('[data-act="subs"]');
    if(sx){ const id=sx.dataset.step; CARDSUBS.has(id)?CARDSUBS.delete(id):CARDSUBS.add(id); render(); return; }
    const ld=e.target.closest('[data-listdone]');
    if(ld){ checkpoint('that view switch'); DB.meta.listDone=!DB.meta.listDone; save(); render(); return; }
    const ro=e.target.closest('[data-reopen]');
    if(ro){ const g=goalById(ro.dataset.reopen); if(g){ checkpoint('reopening that goal');
      reopenGoal(g); save(); render(); toast('Back in rotation — '+shortName(g)); } return; }
    const lt=e.target.closest('[data-ltype]');
    if(lt){
      checkpoint('that type filter');
      const k=lt.dataset.ltype;
      const set=listHidden();
      if(k==='*') set.clear(); else set.has(k)?set.delete(k):set.add(k);
      DB.meta.listHidden=[...set]; save(); render(); return;
    }
    const sb=e.target.closest('[data-act="sub"]');
    if(sb){
      // the card carries the ids in Day view; the list row carries them on the box itself
      const c=sb.closest('.card[data-step]') || sb;
      const r=toggleSub(c.dataset.goal,c.dataset.thread,sb.dataset.step,sb.dataset.sub);
      render();
      if(r.completed){
        if(r.needsDefine && r.reason!=='branch') openDefineNext(goalById(c.dataset.goal), threadById(c.dataset.goal,c.dataset.thread));
        else toast('Last one — step closed.'+(r.next?' Next: '+r.next.title:''));
      }
      return; }
    const ev=e.target.closest('[data-ev]');
    if(ev){ const E=eventById(ev.dataset.ev);
      if(E&&E.goalId) openGoal(E.goalId); else openEvent(ev.dataset.ev); return; }
    const st=e.target.closest('[data-step]');
    if(st){ openGoal(st.dataset.goal); return; }
    const gg=e.target.closest('[data-goal]');
    if(gg){ openGoal(gg.dataset.goal); return; }
  };
  // budget panel: repaint live while typing, write to the DB on commit
  v.oninput  = e=>{ if(e.target.closest('.budget')) paintBudget(); };
  v.onchange = e=>{
    if(!e.target.closest('.budget')) return;
    checkpoint('that budget edit');
    commitBudget(); save();
    // linking a goal changes the row's projection and its Log button, so redraw it
    if(e.target.classList.contains('bgoal')) render(); else paintBudget();
  };
}

/* ---------- dragging cards between quadrants ----------
   HTML5 drag-and-drop never fires on touch, so on a phone the matrix was read-only
   despite having a mobile layout. Pointer events cover mouse, touch and pen in one
   path. The catch on touch is that the browser owns the gesture until it knows you
   aren't scrolling — so touch drags start from the grip, which sets touch-action:none
   and takes that ambiguity away. Mouse can drag from anywhere on the card.
   Wired once, at boot: #view survives every render, and the old listeners were being
   re-added on each one. */

import { signal } from '@preact/signals';
import { CAL } from './cal.js';
import { committedWeek } from './footprint.js';
import { completeStep, money, shortName } from './engine.js';
import { DB, checkpoint, currentStep, goalById, liveGoals, save } from './store.js';
import { $, $$, addDays, daysBetween, startOfWeek, toast, today, uid } from './util.js';
import { render } from './views/render.jsx';

/* ===================== [SECTION: BUDGET] =====================
   A weekly pot of money split across categories. Allocation, not a ledger — there's
   no per-week history and no record of what was actually spent. The one place it
   touches the rest of the app is the optional link from a category to a
   threshold-type goal, which is what stops this being a calculator bolted onto the
   side: money you've allocated is a claim on a goal, and the goal can say whether
   the claim is big enough to land on time. */
export const BUDGET_COLOURS=['#6ea8fe','#4ec9a0','#e8b04b','#ef5f5f','#b48ef0','#4dc4d6','#e88ab0','#8fb46a'];
export const budget = ()=> (DB.meta.budget = DB.meta.budget || {weekly:0, cats:[]});
export const catColour = i => BUDGET_COLOURS[i % BUDGET_COLOURS.length];

/* What this week has actually been committed to: every cost line on a step
   anchored inside it, plus every manual event's own lines, repeats expanded per
   occurrence. Allocation says what you meant to spend; this says what you have
   already promised. */
export const committedThisWeek = ()=> committedWeek(startOfWeek(today()));

/* The panel's arithmetic, from numbers rather than from the DB, so the same
   figures serve both what is saved and what is being typed. */
export function budgetFigures(weekly, cats, C){
  const allocated=cats.reduce((n,c)=>n+(+c.amount||0),0);
  const committed=C.total;
  /* with no budget set, blocks show the relative split; with one, they show share
     of it — and committed joins the basis so that promising more than you
     allocated pushes the bar out rather than being clipped off the end of it,
     which is the same reason over-allocation rescales rather than clipping */
  const basis = weekly>0 ? Math.max(weekly, allocated, committed) : Math.max(allocated, committed);
  return {
    weekly, allocated, basis, committed,
    byCat: C.byCat, uncat: C.uncat, lines: C.lines,
    left: weekly-allocated,
    over: weekly>0 && allocated>weekly,
    /* the red line means the same thing it always did — you have gone past the
       week's ceiling — it is just no longer only allocation that can do it */
    overCom: weekly>0 && committed>weekly,
    overAlloc: allocated>0 && committed>allocated,
    unset: weekly<=0,
    com: c => +(C.byCat[c.id]||0),
    pct: c => basis>0 ? (+c.amount||0)/basis*100 : 0,
    share: c => weekly>0 ? (+c.amount||0)/weekly*100 : (allocated>0?(+c.amount||0)/allocated*100:0)
  };
}
export function budgetState(){
  const b=budget();
  return budgetFigures(+b.weekly||0, b.cats||[], committedThisWeek());
}
/* threshold goals are the only ones with a money target, so they're the only ones
   worth linking; everything else would just be a label */
export const fundableGoals = ()=> liveGoals().filter(g=>g.type==='threshold');

/* Money allocated to a category is not all money reaching the goal behind it:
   anything already committed out of that category this week is spent before it
   gets there. The projection nets it out and the row says so, because "$150/wk
   clears it by April" is a lie the moment $45 of that $150 is a dinner.

   This uses THIS WEEK's committed as a standing rate. That is an assumption, not
   a measurement — there is no per-week history to average, by design — so the row
   names both numbers rather than quietly presenting the result. */
export function catProjection(c){
  const g = c.goalId && goalById(c.goalId);
  // only threshold goals measure in money — a link left behind by a retype, or pointing
  // at a deleted goal, degrades to no projection rather than reading someone else's units
  if(!g || g.type!=='threshold' || !g.smart || !g.smart.target) return null;
  const remaining = Math.max(0, g.smart.target - (+g.smart.current||0));
  const out={goal:g, remaining};
  if(remaining<=0){ out.done=true; return out; }
  const amt=+c.amount||0;
  const committed=+(committedThisWeek().byCat[c.id]||0);
  const effective=Math.max(0, amt-committed);
  out.committed=committed; out.effective=effective;
  if(amt>0 && effective<=0){
    // every dollar of it is already promised elsewhere: say that, don't divide by zero
    out.stalled=true;
  }
  if(effective>0){
    out.weeks = Math.ceil(remaining/effective);
    out.date  = addDays(today(), out.weeks*7);
    if(g.smart.deadline && !g.smart.deadlineSoft) out.lateDays = daysBetween(g.smart.deadline, out.date);
  }
  if(g.smart.deadline){
    const wks = Math.max(1, Math.ceil(Math.max(0,daysBetween(today(), g.smart.deadline))/7));
    out.needed = Math.ceil(remaining/wks);
  }
  return out;
}
/* the payoff of the link: bank this week's allocation against the goal and let the
   normal cyclical machinery produce (and re-book) the next contribution */
export function logContribution(catId){
  const c=(budget().cats||[]).find(x=>x.id===catId); if(!c) return;
  const g=c.goalId && goalById(c.goalId); if(!g) return;
  const amt=+c.amount||0; if(amt<=0){ toast('Give the category an amount first.'); return; }
  checkpoint('that contribution');
  g.smart.current = (+g.smart.current||0) + amt;
  const t=g.threads.find(x=>x.status!=='done') || g.threads[0];
  const s=t && currentStep(t);
  if(s) completeStep(g,t,s); else save();
  render();
  const p=catProjection(c);
  toast(money(amt)+' logged — '+shortName(g)+' at '+money(g.smart.current)+' of '+money(g.smart.target)
        +(p&&p.done?' · target reached':''));
}

/* ---------- capacity ----------
   loadOn() was already being computed and then only used to break ties. A day has
   a ceiling; the point of saying so is that the calendar can refuse to lie to you. */
export const dayBudget = ()=> Math.max(30, DB.meta.dayBudgetMins||240);
export function loadState(k){
  const mins=CAL.loadOn(k), budget=dayBudget();
  return {mins, budget, pct:Math.round(mins/budget*100), over:mins>budget, free:Math.max(0,budget-mins)};
}
export const hrs = m => (Math.round(m/60*10)/10)+'h';
export function loadBar(k,opts={}){
  const L=loadState(k);
  if(!L.mins && !opts.always) return '';
  return `<div class="loadbar ${L.over?'over':L.pct>=80?'near':''}" title="${hrs(L.mins)} of a ${hrs(L.budget)} day">
    <i style="width:${Math.min(100,L.pct)}%"></i></div>`;
}

/* A category's block is its allocation; the solid part of it is what is already
   committed. Drawn as a gradient rather than a nested element so that one block
   stays one element — the bar is laid out in percentages of a shared basis, and
   a child sized in percent of a percent is the kind of arithmetic that goes
   wrong the first time the basis rescales. */
export function catSegStyle(col, w, comFrac){
  const x=Math.round(Math.min(1,Math.max(0,comFrac))*1000)/10;
  return `width:${w}%;background:linear-gradient(90deg,${col} 0 ${x}%,${col}59 ${x}% 100%)`;
}
/* ---------- the panel's draft ----------
   What the inputs hold between a keystroke and the change that commits it. Typing
   updates this and nothing else — the bar, the summary and the percentages are drawn
   from it, the DB is not touched — so one edit is still one undo step.

   Values are kept as the raw strings the fields hold. Normalising here ("" → 0)
   would hand the component a value that differs from the DOM, and Preact would
   write it back into the field under the caret.

   `base` is the saved budget the draft was typed over. When the saved budget moves
   underneath it — an undo, an add, a sync — the draft is stale and the panel shows
   the DB again, which is what the string version did by rebuilding. An unrelated
   save leaves the budget alone, so it leaves the draft alone too. */
export const BUD_DRAFT = signal(null);
export const budSig = ()=> JSON.stringify(budget());

/* Live feedback while typing: read the fields into the draft. The panel redraws
   from it; nothing is rebuilt, so the field being typed into keeps its node. */
export function paintBudget(){
  const v=$('#view'); if(!v) return;
  const wrap=$('.budget',v); if(!wrap) return;
  BUD_DRAFT.value = {
    base: budSig(),
    weekly: ($('.bweekly',wrap)||{}).value||'',
    cats: $$('.brow',wrap).map(r=>({
      id:r.dataset.cat,
      name:$('.bname',r).value,
      amount:$('.bamt',r).value,
      goalId:($('.bgoal',r)||{}).value||null
    }))
  };
}
/* Fold the panel's DOM back into the DB. Deliberately does NOT save() — callers that
   also mutate (add/remove a category) must do their mutation first, or the save here
   would commit the pending undo checkpoint before the real change had happened, and
   the action would silently not be undoable. */
export function commitBudget(){
  const wrap=$('.budget',$('#view')); if(!wrap) return;
  const b=budget();
  b.weekly = +($('.bweekly',wrap)||{}).value||0;
  b.cats = $$('.brow',wrap).map(r=>({
    id:r.dataset.cat||uid(),
    name:$('.bname',r).value.trim()||'Untitled',
    amount:+$('.bamt',r).value||0,
    goalId:($('.bgoal',r)||{}).value||null
  }));
}
export function budAct(a,btn){
  const b=budget();
  if(a==='add'){
    checkpoint('that new category');
    commitBudget();                                  // keep whatever was typed but not yet blurred
    b.cats.push({id:uid(), name:'', amount:0, goalId:null});
    save(); render();
    const rows=$$('.brow'); const last=rows[rows.length-1];
    if(last) $('.bname',last).focus();
    return;
  }
  if(a==='del'){
    checkpoint('removing that category');
    commitBudget();
    b.cats=(b.cats||[]).filter(c=>c.id!==btn.dataset.cat);
    save(); render(); return;
  }
  // the amount input has already blurred (and so committed) by the time this click lands
  if(a==='log'){ logContribution(btn.dataset.cat); return; }
}


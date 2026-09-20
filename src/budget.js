import { CAL } from './cal.js';
import { completeStep, money, shortName } from './engine.js';
import { DB, checkpoint, currentStep, goalById, liveGoals, save } from './store.js';
import { $, $$, addDays, daysBetween, esc, fmtDateY, toast, today, uid } from './util.js';
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

export function budgetState(){
  const b=budget();
  const cats=b.cats||[];
  const allocated=cats.reduce((n,c)=>n+(+c.amount||0),0);
  const weekly=+b.weekly||0;
  // with no budget set, blocks show the relative split; with one, they show share of it
  const basis = weekly>0 ? Math.max(weekly, allocated) : allocated;
  return {
    weekly, allocated, basis,
    left: weekly-allocated,
    over: weekly>0 && allocated>weekly,
    unset: weekly<=0,
    pct: c => basis>0 ? (+c.amount||0)/basis*100 : 0,
    share: c => weekly>0 ? (+c.amount||0)/weekly*100 : (allocated>0?(+c.amount||0)/allocated*100:0)
  };
}
/* threshold goals are the only ones with a money target, so they're the only ones
   worth linking; everything else would just be a label */
export const fundableGoals = ()=> liveGoals().filter(g=>g.type==='threshold');

export function catProjection(c){
  const g = c.goalId && goalById(c.goalId);
  // only threshold goals measure in money — a link left behind by a retype, or pointing
  // at a deleted goal, degrades to no projection rather than reading someone else's units
  if(!g || g.type!=='threshold' || !g.smart || !g.smart.target) return null;
  const remaining = Math.max(0, g.smart.target - (+g.smart.current||0));
  const out={goal:g, remaining};
  if(remaining<=0){ out.done=true; return out; }
  const amt=+c.amount||0;
  if(amt>0){
    out.weeks = Math.ceil(remaining/amt);
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

/* --- export / import --- */

export function budgetBarHTML(){
  const B=budgetState(), cats=budget().cats||[];
  const segs=cats.map((c,i)=>{
    const w=B.pct(c);
    if(w<=0) return '';
    return `<i data-cat="${c.id}" style="width:${w}%;background:${catColour(i)}"
       title="${esc(c.name)} — ${money(+c.amount||0)}${B.weekly>0?' · '+Math.round(B.share(c))+'% of the budget':''}"></i>`;
  }).join('');
  const restW = B.basis>0 ? Math.max(0,(B.basis-B.allocated)/B.basis*100) : 100;
  const rest = restW>0.01 ? `<i class="rest" style="width:${restW}%"></i>` : '';
  // when allocation exceeds the budget, the bar scales to the allocation and the
  // budget becomes a line across it — showing the overshoot rather than clipping it
  const line = B.over ? `<u style="left:${B.weekly/B.basis*100}%"></u>` : '';
  return `<div class="bbar ${B.over?'over':''}">${segs}${rest}${line}</div>`;
}
export function budgetSummaryHTML(){
  const B=budgetState();
  if(B.unset) return `<span class="tiny muted">Set a weekly amount to see each category as a share of it.</span>`;
  return `<span class="tiny ${B.over?'overtxt':'muted'}">${money(B.allocated)} allocated of ${money(B.weekly)}
    &middot; ${B.over?money(-B.left)+' over':money(B.left)+' unallocated'}</span>`;
}
export function viewBudget(){
  const b=budget(), B=budgetState(), cats=b.cats||[];
  const fundable=fundableGoals();

  const rows = cats.map((c,i)=>{
    const p=catProjection(c);
    let note='';
    if(c.goalId && !p) note=`<span class="bnote warn">linked goal has no money target</span>`;
    else if(p && p.done) note=`<span class="bnote good">target reached</span>`;
    else if(p && p.weeks) note=`<span class="bnote">${money(+c.amount)}/wk clears ${money(p.remaining)} in
        ${p.weeks} week${p.weeks>1?'s':''} &middot; ${fmtDateY(p.date)}${
        p.lateDays>0?` <span class="overtxt">${p.lateDays}d past the deadline</span>`:
        p.lateDays!=null?' <span class="good">before the deadline</span>':''}</span>`;
    else if(p && p.needed) note=`<span class="bnote">needs ${money(p.needed)}/wk to hit the deadline</span>`;
    else if(p) note=`<span class="bnote">${money(p.remaining)} still to go</span>`;

    return `<div class="brow" data-cat="${c.id}">
      <span class="bsw" style="background:${catColour(i)}"></span>
      <input class="bname" type="text" value="${esc(c.name)}" placeholder="Category" aria-label="Category name">
      <div class="bamtwrap"><span>$</span><input class="bamt" type="number" min="0" step="1"
        value="${+c.amount||0}" aria-label="Amount for ${esc(c.name)}"></div>
      <span class="bpct">${B.weekly>0||B.allocated>0?Math.round(B.share(c))+'%':'—'}</span>
      <select class="bgoal" aria-label="Link to a goal">
        <option value="">— no goal —</option>
        ${fundable.map(g=>`<option value="${g.id}" ${g.id===c.goalId?'selected':''}>${esc(shortName(g))}</option>`).join('')}
      </select>
      ${c.goalId&&p&&!p.done?`<button class="btn sm" data-bud="log" data-cat="${c.id}" title="Add this to the goal and close out its current contribution step">Log</button>`:''}
      <button class="btn ghost sm bdel" data-bud="del" data-cat="${c.id}" title="Remove category">&times;</button>
      ${note}
    </div>`;
  }).join('');

  return `<div class="strip budget" style="margin-top:14px">
    <div class="lbl">
      <span>Weekly budget</span>
      <span class="bsum">${budgetSummaryHTML()}</span>
      <span class="spacer" style="flex:1"></span>
      <span class="bwrap tiny">Budget <span>$</span><input class="bweekly" type="number" min="0" step="1"
        value="${B.weekly||''}" placeholder="0" aria-label="Weekly budget"></span>
    </div>
    ${budgetBarHTML()}
    <div class="brows">${rows||'<div class="tiny muted" style="padding:6px 2px">No categories yet.</div>'}</div>
    <button class="btn sm" data-bud="add" style="margin-top:8px">+ Category</button>
    ${cats.length&&fundable.length?'':`<div class="tiny muted" style="margin-top:8px">${
      fundable.length?'':'Threshold-type goals (a money target) can be linked to a category once you have one.'}</div>`}
  </div>`;
}
/* Live feedback while typing, without re-rendering the view out from under the caret.
   Only the bar, the running total and the percentages change on input; the DB write
   happens on change (blur), so one edit is one undo step. */
export function paintBudget(){
  const v=$('#view'); if(!v) return;
  const wrap=$('.budget',v); if(!wrap) return;
  const weekly=+($('.bweekly',wrap)||{}).value||0;
  const live=$$('.brow',wrap).map(r=>({
    id:r.dataset.cat,
    name:$('.bname',r).value,
    amount:+$('.bamt',r).value||0,
    goalId:($('.bgoal',r)||{}).value||null
  }));
  const allocated=live.reduce((n,c)=>n+c.amount,0);
  const basis = weekly>0 ? Math.max(weekly,allocated) : allocated;
  const over = weekly>0 && allocated>weekly;

  const bar=$('.bbar',wrap);
  bar.classList.toggle('over',over);
  const restW = basis>0 ? Math.max(0,(basis-allocated)/basis*100) : 100;
  bar.innerHTML = live.map((c,i)=> c.amount>0
      ? `<i data-cat="${c.id}" style="width:${c.amount/basis*100}%;background:${catColour(i)}"></i>` : '').join('')
    + (restW>0.01?`<i class="rest" style="width:${restW}%"></i>`:'')
    + (over?`<u style="left:${weekly/basis*100}%"></u>`:'');

  $('.bsum',wrap).innerHTML = weekly>0
    ? `<span class="tiny ${over?'overtxt':'muted'}">${money(allocated)} allocated of ${money(weekly)}
       &middot; ${over?money(allocated-weekly)+' over':money(weekly-allocated)+' unallocated'}</span>`
    : `<span class="tiny muted">Set a weekly amount to see each category as a share of it.</span>`;

  $$('.brow',wrap).forEach((r,i)=>{
    const denom = weekly>0?weekly:allocated;
    $('.bpct',r).textContent = denom>0 ? Math.round(live[i].amount/denom*100)+'%' : '—';
  });
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


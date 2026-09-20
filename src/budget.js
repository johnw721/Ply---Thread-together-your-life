import { CAL } from './cal.js';
import { committedWeek } from './footprint.js';
import { completeStep, money, shortName } from './engine.js';
import { DB, checkpoint, currentStep, goalById, liveGoals, save } from './store.js';
import { $, $$, addDays, daysBetween, esc, fmtDateY, startOfWeek, toast, today, uid } from './util.js';
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

export function budgetState(){
  const b=budget();
  const cats=b.cats||[];
  const allocated=cats.reduce((n,c)=>n+(+c.amount||0),0);
  const weekly=+b.weekly||0;
  const C=committedThisWeek();
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

/* --- export / import --- */

/* A category's block is its allocation; the solid part of it is what is already
   committed. Drawn as a gradient rather than a nested element so that one block
   stays one element — the bar is laid out in percentages of a shared basis, and
   a child sized in percent of a percent is the kind of arithmetic that goes
   wrong the first time the basis rescales. */
export function catSegStyle(col, w, comFrac){
  const x=Math.round(Math.min(1,Math.max(0,comFrac))*1000)/10;
  return `width:${w}%;background:linear-gradient(90deg,${col} 0 ${x}%,${col}59 ${x}% 100%)`;
}
export function budgetBarHTML(){
  const B=budgetState(), cats=budget().cats||[];
  const segs=cats.map((c,i)=>{
    const w=B.pct(c);
    if(w<=0) return '';
    const amt=+c.amount||0, com=B.com(c);
    return `<i data-cat="${c.id}" data-com="${com}" style="${catSegStyle(catColour(i), w, amt?com/amt:0)}"
       title="${esc(c.name)} — ${money(amt)}${com?' · '+money(com)+' committed':''}${
         B.weekly>0?' · '+Math.round(B.share(c))+'% of the budget':''}"></i>`;
  }).join('');
  const restW = B.basis>0 ? Math.max(0,(B.basis-B.allocated)/B.basis*100) : 100;
  /* committed money with no category still counts against the week, so it shows
     in the unallocated remainder rather than vanishing into it */
  const uncatW = B.basis>0 ? Math.min(restW, B.uncat/B.basis*100) : 0;
  const rest = restW>0.01
    ? (uncatW>0.01
        ? `<i class="rest uncat" data-uncat="${B.uncat}" title="${money(B.uncat)} committed, no category"
             style="width:${uncatW}%"></i><i class="rest" style="width:${restW-uncatW}%"></i>`
        : `<i class="rest" style="width:${restW}%"></i>`)
    : '';
  // when allocation or commitment exceeds the budget, the bar scales to whichever
  // is larger and the budget becomes a line across it — showing the overshoot
  // rather than clipping it
  const line = (B.over||B.overCom) ? `<u style="left:${B.weekly/B.basis*100}%"></u>` : '';
  return `<div class="bbar ${(B.over||B.overCom)?'over':''}">${segs}${rest}${line}</div>`;
}
export function budgetSummaryHTML(){
  const B=budgetState();
  const com = B.committed
    ? ` &middot; <span class="${B.overAlloc||B.overCom?'overtxt':''}">${money(B.committed)} committed</span>` : '';
  if(B.unset) return `<span class="tiny muted">Set a weekly amount to see each category as a share of it.${
    B.committed?' '+money(B.committed)+' is already committed this week.':''}</span>`;
  return `<span class="tiny ${B.over||B.overCom?'overtxt':'muted'}">${money(B.allocated)} allocated of ${money(B.weekly)}
    &middot; ${B.over?money(-B.left)+' over':money(B.left)+' unallocated'}${com}</span>`;
}
export function viewBudget(){
  const b=budget(), B=budgetState(), cats=b.cats||[];
  const fundable=fundableGoals();

  const rows = cats.map((c,i)=>{
    const p=catProjection(c);
    let note='';
    const com=B.com(c);
    // what the allocation actually buys once this week's commitments are taken out of it
    const net = p && p.committed
      ? `${money(+c.amount)}/wk allocated, ${money(p.committed)} committed, ${money(p.effective)} reaching the goal &middot; `
      : `${money(+c.amount)}/wk `;
    if(c.goalId && !p) note=`<span class="bnote warn">linked goal has no money target</span>`;
    else if(p && p.done) note=`<span class="bnote good">target reached</span>`;
    else if(p && p.stalled) note=`<span class="bnote overtxt">${money(+c.amount)}/wk allocated but
        ${money(p.committed)} of it is already committed — nothing is reaching the goal this week</span>`;
    else if(p && p.weeks) note=`<span class="bnote">${net}clears ${money(p.remaining)} in
        ${p.weeks} week${p.weeks>1?'s':''} &middot; ${fmtDateY(p.date)}${
        p.lateDays>0?` <span class="overtxt">${p.lateDays}d past the deadline</span>`:
        p.lateDays!=null?' <span class="good">before the deadline</span>':''}</span>`;
    else if(p && p.needed) note=`<span class="bnote">needs ${money(p.needed)}/wk to hit the deadline</span>`;
    else if(p) note=`<span class="bnote">${money(p.remaining)} still to go</span>`;
    else if(com) note=`<span class="bnote">${money(com)} committed this week</span>`;

    return `<div class="brow" data-cat="${c.id}">
      <span class="bsw" style="background:${catColour(i)}"></span>
      <input class="bname" type="text" value="${esc(c.name)}" placeholder="Category" aria-label="Category name">
      <div class="bamtwrap"><span>$</span><input class="bamt" type="number" min="0" step="1"
        value="${+c.amount||0}" aria-label="Amount for ${esc(c.name)}"></div>
      <span class="bpct" title="${com?money(com)+' committed':'nothing committed yet'}">${
        B.weekly>0||B.allocated>0?Math.round(B.share(c))+'%':'—'}</span>
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
  /* Committed spend is a fact about the calendar, not about what is being typed,
     so it is read once here rather than recomputed per keystroke. */
  const C=committedThisWeek(), committed=C.total;
  const basis = weekly>0 ? Math.max(weekly,allocated,committed) : Math.max(allocated,committed);
  const over = (weekly>0 && allocated>weekly) || (weekly>0 && committed>weekly);

  const bar=$('.bbar',wrap);
  bar.classList.toggle('over',over);
  const restW = basis>0 ? Math.max(0,(basis-allocated)/basis*100) : 100;
  const uncatW = basis>0 ? Math.min(restW, C.uncat/basis*100) : 0;
  bar.innerHTML = live.map((c,i)=>{
      if(c.amount<=0) return '';
      const com=+(C.byCat[c.id]||0);
      return `<i data-cat="${c.id}" data-com="${com}" style="${
        catSegStyle(catColour(i), c.amount/basis*100, com/c.amount)}"></i>`;
    }).join('')
    + (uncatW>0.01?`<i class="rest uncat" data-uncat="${C.uncat}" style="width:${uncatW}%"></i>`:'')
    + (restW-uncatW>0.01?`<i class="rest" style="width:${restW-uncatW}%"></i>`:'')
    + (over?`<u style="left:${weekly/basis*100}%"></u>`:'');

  const comTxt = committed ? ` &middot; ${money(committed)} committed` : '';
  $('.bsum',wrap).innerHTML = weekly>0
    ? `<span class="tiny ${over?'overtxt':'muted'}">${money(allocated)} allocated of ${money(weekly)}
       &middot; ${allocated>weekly?money(allocated-weekly)+' over':money(weekly-allocated)+' unallocated'}${comTxt}</span>`
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


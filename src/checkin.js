import { renderCheckin } from './checkin.jsx';
import { TYPE } from './types.js';
import { bestQuadrant } from './views/quarter.js';
import { budget, dayBudget, hrs, loadState } from './budget.js';
import { CAL } from './cal.js';
import { closeModal } from './components/modal.jsx';
import { cadenceOf, checkinAgenda, clearGate, completeStep, firstStepFor, learnType, shortName } from './engine.js';
import { openConvert } from './goal-editor.js';
import { DB, checkpoint, currentStep, finishGoal, lastDoneStep, load, logIt, newStep, save, touchThread } from './store.js';
import { $, $$, addDays, esc, fmtDate, toast, today, uid } from './util.js';
import { QUAD, render } from './views/render.jsx';

/* ===================== [SECTION: CHECKIN] =====================
   The queue and the actions. The card itself is checkin.jsx.
 */
/* A guided flow, not a dashboard. It walks you card by card and will not let a
   thread stay silent: every quiet/blocked/stepless thread has to be answered. */
export let CK=null;
export function setCK(v){ CK=v; }
export let CKROW=null;   // an inline field open on the current wizard card, in place of a prompt

/* A ritual survives when its cost is known and small. An unbounded queue means the
   session is 3 cards one week and 30 the next, and the 30-card week is the one that
   doesn't happen. Cap the debt cards; the rest are still in the ribbon, still
   resolvable inline, and still here next week. */
export const CK_MAX=6;

export function startCheckin(){
  const ag=checkinAgenda();
  const debt=[];
  ag.gates .forEach(x=>debt.push({t:'gate',    goal:x.goal, gate:x.gate}));
  ag.branch.forEach(x=>debt.push({t:'branch',  goal:x.goal, thread:x.thread}));
  ag.nostep.forEach(x=>debt.push({t:'nostep',  goal:x.goal, thread:x.thread}));
  ag.blocked.forEach(x=>debt.push({t:'blocked',goal:x.goal, thread:x.thread}));
  ag.quiet .forEach(x=>debt.push({t:'quiet',   goal:x.goal, thread:x.thread, step:x.step, days:x.days}));

  const shown=debt.slice(0,CK_MAX), deferred=debt.length-shown.length;
  const q=[{t:'intro',ag,deferred,total:debt.length}, ...shown, {t:'schedule'}, {t:'done'}];

  // resume where you left off, but only within the same day — after that the queue
  // has moved on and picking up at card 4 of a different list would be nonsense
  const p=DB.meta.checkinProgress;
  const resume = p && p.dateKey===today() && p.i>0 && p.i<q.length ? p : null;
  CK={q, i:resume?resume.i:0, touched:resume?resume.touched:0, deferred};
  if(resume) toast('Picking up where you left off — card '+(resume.i+1)+' of '+q.length+'.');
  renderCheckin();
}
export function ckSaveProgress(){
  if(!CK) return;
  DB.meta.checkinProgress = CK.i>0 && CK.i<CK.q.length-1
    ? {dateKey:today(), i:CK.i, touched:CK.touched} : null;
  save();
}
export function ckNext(){ CKROW=null; CK.i++; if(CK.i>=CK.q.length) CK.i=CK.q.length-1; ckSaveProgress(); renderCheckin(); }
export function ckBack(){ CKROW=null; CK.i=Math.max(0,CK.i-1); ckSaveProgress(); renderCheckin(); }

export function subjHead(g,t){
  const bits=[TYPE[g.type].label];
  if(t && t.name!=='Main') bits.push(t.name);
  if(t) bits.push(({sequential:'sequential',parallel:'parallel',conditional:'branching',cyclical:'recurring'})[t.rel]||t.rel);
  return `<div class="subject"><div class="sh">
      <span class="dot" style="background:${QUAD[bestQuadrant(g)].c}"></span>
      <span class="g">${bits.map(esc).join(' · ')}</span></div>
    <div class="sn">${esc(g.title)}</div>
    ${g.why?`<div class="tiny muted" style="margin-top:5px">why: ${esc(g.why)}</div>`:''}</div>`;
}

export function suggestDay(i,mins){
  const g=i.goal; const cad=cadenceOf(g)||3;
  let k=addDays(today(), Math.min(3,Math.max(1,Math.round(cad/2))));
  if(g.smart.deadline && g.smart.deadline<k) k=g.smart.deadline;
  const need=mins||45, budget=dayBudget();
  // first day in the window that still has room for this; failing that, the lightest
  let best=k, bl=CAL.loadOn(k);
  for(let d=0; d<5; d++){
    const c=addDays(k,d), load=CAL.loadOn(c);
    if(load+need<=budget) return c;
    if(load<bl){ best=c; bl=load; }
  }
  return best;
}
export function suggestTime(i){
  const q=i.quadrant; const base = q==='q1'?9:q==='q2'?19:q==='q3'?12:17;
  return String(base).padStart(2,'0')+':00';
}

export function ckAct(act,btn){
  checkpoint('that check-in answer');
  const c=CK.q[CK.i], g=c.goal, t=c.thread;
  const bump=()=>{CK.touched++;};
  switch(act){
    case 'next': ckNext(); return;
    case 'back': ckBack(); return;
    case 'skip': ckNext(); return;
    case 'finish':
      DB.meta.lastCheckin=today(); DB.meta.checkinProgress=null;
      logIt('checkin',{text:CK.touched+' answered'}); save();
      closeModal(); CK=null; render(); toast('Check-in logged.'); return;

    case 'gate-deadline':{
      const d=$('#ckDate').value; if(!d){toast('Pick a date.');return;}
      g.smart.deadline=d; g.smart.deadlineSoft=false;
      const mn=$('#ckMetric').value.trim(); if(mn)g.smart.metricName=mn;
      clearGate(g,c.gate.id); bump(); toast('Date set.'); break; }
    case 'gate-retype': clearGate(g,c.gate.id); g.type='milestone'; learnType(g.title,'milestone');
      g.gates.push({id:uid(),kind:'confirm-type',q:'Refiled "'+g.title+'" as milestone-type. Right call?'}); bump(); break;
    case 'gate-trigger':{
      const v=$('#ckTrig').value.trim(); if(!v){toast('Describe the trigger.');return;}
      g.trigger=v; g.threads.forEach(x=>x.status='dormant'); clearGate(g,c.gate.id); bump(); break; }
    case 'gate-fire':{
      g.threads.forEach(x=>{ if(x.status==='dormant'){x.status='active'; touchThread(x);} });
      const th=g.threads[0]; if(th&&!currentStep(th)) th.steps.push(newStep('First move on '+shortName(g),{auto:true}));
      clearGate(g,c.gate.id); bump(); toast('Activated.'); break; }
    case 'gate-isdecision': g.type='decision'; clearGate(g,c.gate.id); learnType(g.title,'decision');
      { const th=g.threads[0]; if(th&&!currentStep(th)) th.steps.push(newStep('Research / decide: '+shortName(g),{auto:true})); }
      bump(); break;
    case 'gate-isgoal': clearGate(g,c.gate.id); g.type='milestone';
      g.gates.push({id:uid(),kind:'confirm-type',q:'What kind of goal is "'+g.title+'"?'}); bump(); break;
    case 'gate-type':{ const v=$('#ckType').value; const changed=v!==g.type; g.type=v;
      learnType(g.title,v);                     // confirming counts too — that's reinforcement, not noise
      if(TYPE[v].gate==='deadline'&&!g.smart.deadline) g.gates.push({id:uid(),kind:'deadline',q:'What is the hard date for "'+g.title+'"?'});
      g.threads.forEach(x=>{ if(!x.steps.length){const s=firstStepFor(g,x,null); if(s)x.steps.push(s);} });
      clearGate(g,c.gate.id); bump();
      toast(changed?'Filed as '+TYPE[v].label.toLowerCase()+' — I\'ll read phrases like that the same way.'
                   :'Noted — that reading is reinforced.');
      break; }
    case 'dec-close': clearGate(g,c.gate.id); finishGoal(g,'decision closed'); bump(); break;
    case 'dec-convert': clearGate(g,c.gate.id); save(); closeModal(); openConvert(g); return;

    case 'branch':{
      const b=t.branches[+btn.dataset.i]; const last=lastDoneStep(t);
      t.needsBranch=false;
      const ns=newStep(b.next,{auto:true}); t.steps.push(ns); touchThread(t);
      logIt('branch',{goalId:g.id,threadId:t.id,text:b.condition}); bump(); break; }

    case 'addstep':{
      const v=$('#ckStep').value.trim(); if(!v){toast('Name the step.');return;}
      t.steps.push(newStep(v,{quadrant:$('#ckQuad').value})); touchThread(t); bump(); break; }

    // these three used to be browser prompts stacked on top of the wizard modal
    case 'block':         CKROW='blocked'; renderCheckin(); return;
    case 'quiet-cadence': CKROW='cadence'; renderCheckin(); return;
    case 'row-cancel':    CKROW=null; renderCheckin(); return;
    case 'block-save':{
      const who=($('#ckWho')||{value:''}).value.trim();
      t.status='blocked'; t.blockedOn=who||'someone'; t.blockedSince=new Date().toISOString();
      logIt('blocked',{goalId:g.id,threadId:t.id,text:t.blockedOn}); CKROW=null; bump(); break; }
    case 'cadence-save':{
      const v=+($('#ckCad')||{value:''}).value;
      if(!v||v<1){ toast('Give it a number of days.'); return; }
      g.cadenceDays=v; touchThread(t); CKROW=null; bump(); break; }
    case 'next-save':{
      const v=($('#ckNextStep')||{value:''}).value.trim();
      if(!v){ toast('Name the step.'); return; }
      t.steps.push(newStep(v,{quadrant:(c.step&&c.step.quadrant)||'q2'})); touchThread(t);
      CKROW=null; bump(); break; }
    case 'unblock':{
      t.status='active'; t.blockedOn=''; t.blockedSince=null; touchThread(t);
      if(!currentStep(t)){ CKROW='next'; save(); renderCheckin(); return; }
      bump(); break; }
    case 'unblock-nudge':{
      t.steps.push(newStep('Follow up with '+(t.blockedOn||'them'),{quadrant:'q3'}));
      t.status='active'; touchThread(t); bump(); toast('Nudge step added.'); break; }

    case 'quiet-done':{
      const s=currentStep(t);
      if(s){ const r=completeStep(g,t,s);
        // no auto-successor exists for this type — ask for it on the card, not in a dialog
        if(r.needsDefine && r.reason!=='branch'){ CKROW='next'; bump(); save(); renderCheckin(); return; } }
      bump(); break; }
    case 'quiet-slip':{
      const s=currentStep(t); if(s&&s.eventId) CAL.unanchor(s);
      logIt('slipped',{goalId:g.id,threadId:t.id,text:s?s.title:''}); bump(); break; }

    case 'sched-one': case 'sched-all':{
      const rows = act==='sched-all' ? $$('[data-sched]') : [btn.closest('[data-sched]')];
      for(const row of rows){
        const sid=row.dataset.sched; const f=findStep(sid); if(!f) continue;
        const d=$('.sd',row).value, tm=$('.stm',row).value, du=+$('.sdur',row).value;
        if(!d) continue;
        const mins = du===0?null:(+tm.split(':')[0]*60 + +tm.split(':')[1]);
        const ev=CAL.anchor(f.goal,f.thread,f.step,d, mins===null?0:mins, du||1440);
        if(du===0) ev.allDay=true;
        touchThread(f.thread);
      }
      save(); bump(); renderCheckin(); render();
      // saying yes to everything is how a week gets overbooked; say so at the moment it happens
      const hot=[...new Set(rows.map(r=>$('.sd',r)&&$('.sd',r).value).filter(Boolean))]
        .map(k=>({k,L:loadState(k)})).filter(x=>x.L.over);
      toast(hot.length
        ? hot.length+' day'+(hot.length>1?'s are':' is')+' now over a '+hrs(dayBudget())+' day — '+hot.map(x=>fmtDate(x.k)).join(', ')
        : 'Scheduled.');
      return; }
  }
  save(); render(); ckNext();
}
export function findStep(sid){
  for(const g of DB.goals) for(const t of g.threads){ const s=t.steps.find(s=>s.id===sid); if(s) return {goal:g,thread:t,step:s}; }
  return null;
}


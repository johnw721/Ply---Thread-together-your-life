import { TYPE } from '../types.js';
import { suggestDay, suggestTime } from '../checkin.js';
import { CAL } from '../cal.js';
import { openConfirm } from './dialogs.js';
import { SIGFIX, setSigFix } from './ribbon.js';
import { renderSignals } from './ribbon.jsx';
import { autoNextTitle, clearGate, firstStepFor, learnType, shortName, signals } from '../engine.js';
import { openGoal } from '../goal-editor.js';
import { checkpoint, currentStep, deleteGoal, newStep, save, touchThread } from '../store.js';
import { $, addDays, esc, toast, today, uid } from '../util.js';
import { QUAD, render } from '../views/render.jsx';

export const FIXABLE=new Set(['gate','nostep','unscheduled','slipped','branch','blocked','hushed']);

export function sigResolverHTML(s){
  const g=s.goal, t=s.thread;
  const head=`<div class="fixhead"><b>${esc(shortName(g))}</b>
    <span class="muted">${esc(s.text)}</span>
    <span class="spacer" style="flex:1"></span>
    <button class="btn ghost sm" data-fix="cancel">&times;</button></div>`;
  let body='';

  if(s.kind==='gate'){
    const k=s.gate.kind;
    if(k==='deadline') body=`<div class="fixrow">
      <input type="date" id="fxDate" value="${g.smart.deadline||addDays(today(),14)}">
      <button class="btn primary sm" data-fix="gate-deadline">Set date</button></div>`;
    else if(k==='trigger') body=`<div class="fixrow">
      <input type="text" id="fxTrig" placeholder="What has to happen first?" value="${esc(g.trigger||'')}">
      <button class="btn sm" data-fix="gate-fire">Already fired</button>
      <button class="btn primary sm" data-fix="gate-trigger">Save</button></div>`;
    else if(k==='decision') body=`<div class="fixrow">
      <button class="btn sm" data-fix="gate-isgoal">It's a goal</button>
      <button class="btn primary sm" data-fix="gate-isdecision">It's a decision</button></div>`;
    else if(k==='confirm-type') body=`<div class="fixrow">
      <select id="fxType">${Object.keys(TYPE).map(x=>
        `<option value="${x}" ${x===g.type?'selected':''}>${TYPE[x].label}</option>`).join('')}</select>
      <button class="btn primary sm" data-fix="gate-type">Confirm</button></div>
      <div class="tiny muted">${esc(TYPE[g.type].hint)}</div>`;
    else body=`<div class="fixrow"><button class="btn sm" data-fix="open">Open the goal</button></div>`;
  }
  else if(s.kind==='nostep'){
    body=`<div class="fixrow">
      <input type="text" id="fxStep" placeholder="What's the next move?" value="${esc(autoNextTitle(g,t,null)||'')}">
      <select id="fxQuad">${Object.keys(QUAD).map(q=>
        `<option value="${q}" ${q==='q2'?'selected':''}>${QUAD[q].n}</option>`).join('')}</select>
      <button class="btn primary sm" data-fix="add-step">Add</button></div>`;
  }
  else if(s.kind==='unscheduled'||s.kind==='slipped'){
    const st=currentStep(t);
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">${esc(st?st.title:'')}</span>
      <input type="date" id="fxWhen" value="${suggestDay({goal:g,quadrant:st?st.quadrant:'q2'},45)}">
      <input type="time" id="fxTime" value="${suggestTime({goal:g,quadrant:st?st.quadrant:'q2'})}">
      <button class="btn primary sm" data-fix="schedule">Schedule</button></div>
      <div class="tiny muted" id="fxLoad"></div>`;
  }
  else if(s.kind==='branch'){
    body=`<div class="fixrow">${(t.branches||[]).map((b,i)=>
      `<button class="btn sm" data-fix="branch" data-i="${i}">${esc(b.condition)}</button>`).join('')
      ||'<span class="tiny muted">No branches defined — open the goal.</span>'}</div>`;
  }
  else if(s.kind==='blocked'){
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">Waiting on ${esc(t.blockedOn||'someone')}</span>
      <button class="btn primary sm" data-fix="unblock">It's unblocked</button></div>`;
  }
  else if(s.kind==='hushed'){
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">Stopped nagging after ${s.days}d. Reviving puts it back in rotation.</span>
      <button class="btn sm" data-fix="drop">Drop the goal</button>
      <button class="btn primary sm" data-fix="revive">Revive</button></div>`;
  }
  return `<div class="sigfix" data-key="${esc(s.key)}">${head}${body}</div>`;
}

export function sigFixAct(act,btn){
  const s=signals().find(x=>x.key===SIGFIX);
  if(act==='cancel'||!s){ setSigFix(null); renderSignals(); return; }
  const g=s.goal, t=s.thread;
  if(act==='open'){ setSigFix(null); openGoal(g.id); return; }
  checkpoint('that fix');

  switch(act){
    case 'gate-deadline':{
      const d=$('#fxDate').value; if(!d){toast('Pick a date.');return;}
      g.smart.deadline=d; g.smart.deadlineSoft=false; clearGate(g,s.gate.id); break; }
    case 'gate-trigger':{
      const v=$('#fxTrig').value.trim(); if(!v){toast('Describe the trigger.');return;}
      g.trigger=v; g.threads.forEach(x=>x.status='dormant'); clearGate(g,s.gate.id); break; }
    case 'gate-fire':
      g.threads.forEach(x=>{ if(x.status==='dormant'){x.status='active'; touchThread(x);} });
      { const th=g.threads[0]; if(th&&!currentStep(th)) th.steps.push(newStep('First move on '+shortName(g),{auto:true})); }
      clearGate(g,s.gate.id); break;
    case 'gate-isdecision':
      g.type='decision'; learnType(g.title,'decision'); clearGate(g,s.gate.id);
      { const th=g.threads[0]; if(th&&!currentStep(th)) th.steps.push(newStep('Research / decide: '+shortName(g),{auto:true})); }
      break;
    case 'gate-isgoal':
      clearGate(g,s.gate.id); g.type='milestone';
      g.gates.push({id:uid(),kind:'confirm-type',q:'What kind of goal is "'+g.title+'"?'}); break;
    case 'gate-type':{
      const v=$('#fxType').value; g.type=v; learnType(g.title,v);
      if(TYPE[v].gate==='deadline'&&!g.smart.deadline)
        g.gates.push({id:uid(),kind:'deadline',q:'What is the hard date for "'+g.title+'"?'});
      g.threads.forEach(x=>{ if(!x.steps.length){const st=firstStepFor(g,x,null); if(st)x.steps.push(st);} });
      clearGate(g,s.gate.id); break; }
    case 'add-step':{
      const v=$('#fxStep').value.trim(); if(!v){toast('Name the step.');return;}
      t.steps.push(newStep(v,{quadrant:$('#fxQuad').value})); touchThread(t); break; }
    case 'schedule':{
      const st=currentStep(t); if(!st){toast('Nothing to schedule.');return;}
      const d=$('#fxWhen').value; if(!d){toast('Pick a date.');return;}
      const tm=($('#fxTime').value||'19:00').split(':');
      CAL.anchor(g,t,st,d,+tm[0]*60 + +tm[1],45); touchThread(t); break; }
    case 'branch':{
      const b=(t.branches||[])[+btn.dataset.i]; if(!b) return;
      t.needsBranch=false;
      t.steps.push(newStep(b.next,{auto:true})); touchThread(t); break; }
    case 'unblock':
      t.status='active'; t.blockedOn=''; t.blockedSince=null; touchThread(t); break;
    case 'revive':
      touchThread(t); break;                          // movement is what un-hushes it
    case 'drop':
      // nothing else is open, so this one can afford a real dialog
      setSigFix(null); renderSignals();
      openConfirm({title:'Drop this goal', yes:'Drop it', danger:true,
        body:`<b>${esc(g.title)}</b> goes, along with its threads and calendar slots. <b>⌘Z undoes it.</b>`,
        onYes:()=>{ checkpoint('dropping that goal'); deleteGoal(g.id); render(); toast('Dropped — ⌘Z to undo.'); }});
      return;
  }
  setSigFix(null); save(); render();
  toast(act==='revive'?'Back in rotation.':act==='drop'?'Dropped.':'Done — no check-in needed.');
}


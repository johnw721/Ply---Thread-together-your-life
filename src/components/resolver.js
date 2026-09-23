import { TYPE } from '../types.js';
import { suggestDay, suggestTime } from '../checkin.js';
import { CAL } from '../cal.js';
import { openConfirm } from './dialogs.js';
import { SIGFIX, setSigFix } from './ribbon.js';
import { renderSignals } from './ribbon.jsx';
import { applyFootprint, autoNextTitle, clearGate, firstStepFor, learnType, money, shortName,
         sigLabel, signals, togglePrereq, unblockThread } from '../engine.js';
import { acceptTmplGate, costTotal, declineTmplGate, fp, tmplGet } from '../footprint.js';
import { openGoal } from '../goal-editor.js';
import { cardHTML, deleteNote, parseCard, retireTip, reviewNote, tilQueue, tipsOff, toggleHide,
         updateNote } from '../notes.js';
import { checkpoint, currentStep, deleteGoal, logIt, newStep, save, touchThread } from '../store.js';
import { $, addDays, esc, toast, today, uid } from '../util.js';
import { QUAD, render } from '../views/render.jsx';
import { bumpUi } from '../signals.js';

/* `quiet`, `deadline` and `overbudget` stay unfixable on purpose: all three are
   judgment calls rather than data gaps. Nothing here can decide for you that this
   week's dinners are worth it. */
/* Review-local UI state, not DB: which item has its answer showing and which
   note is open for editing. Keyed by item id, so moving on to the next item
   resets both without anyone having to remember to. Set only through these —
   the ribbon is a signals component and skips a redraw nothing told it about
   (see uiRev in src/signals.js), so a bare assignment repaints nothing. */
export let TIL_REVEAL=null, TIL_EDIT=null;
export function setTilReveal(v){ TIL_REVEAL=v; bumpUi(); }
export function setTilEdit(v){ TIL_EDIT=v; bumpUi(); }

export const FIXABLE=new Set(['gate','nostep','unscheduled','slipped','branch','blocked','hushed','prereq','tmpl','reschedule','til']);

export function sigResolverHTML(s){
  const g=s.goal, t=s.thread;
  const head=`<div class="fixhead"><b>${esc(sigLabel(s))}</b>
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
    else if(k==='footprint'){
      const tm=tmplGet(s.gate.tmpl);
      const cost=tm?costTotal(tm.costs.map(c=>({amount:c.amount}))):0;
      body=`<div class="fixrow">
        <span class="tiny muted" style="flex:1;min-width:0">${tm
          ? esc(tm.label)+' · '+tm.lead+' min before, '+tm.lag+' after'
            +(tm.prereqs.length?' · '+tm.prereqs.length+' to do first':'')
            +(cost?' · '+money(cost):'')
          : 'That template is gone.'}</span>
        <button class="btn sm" data-fix="foot-no">Not this one</button>
        ${tm?`<button class="btn primary sm" data-fix="foot-yes">Add it</button>`:''}</div>
        <div class="tiny muted">It fills gaps only — anything you have already set stays.</div>`;
    }
    else body=`<div class="fixrow"><button class="btn sm" data-fix="open">Open the goal</button></div>`;
  }
  else if(s.kind==='prereq'){
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">${esc(s.prereq.title)} &mdash; due
        ${s.prereq.leadDays?s.prereq.leadDays+'d before ':''}${esc(s.step.title)}</span>
      <button class="btn sm" data-fix="open">Open the goal</button>
      <button class="btn primary sm" data-fix="prereq-done">Done</button></div>`;
  }
  else if(s.kind==='tmpl'){
    /* One chip, one accept — even when the gate is carrying two kinds of evidence
       at once. A goal-targeted row is in days and a template row in minutes;
       saying which is cheaper than two chips that can be answered inconsistently. */
    const rows=(s.gate.proposes||[]).map(p=> (p.target||'tmpl')==='goal'
      ? `cadence ${p.from||'default'} &rarr; <b>${p.to}</b> days`
      : `${esc(p.field)} ${p.from||0} &rarr; <b>${p.to}</b> min`).join(' · ');
    const parts = (s.gate.because && s.gate.because.kind==='mixed')
      ? s.gate.because.parts : [s.gate.because];
    const why = parts.filter(Boolean).map(b => b.kind==='drift'
      ? `${b.n} move${b.n===1?'':'s'}`
      : `${b.n} timed ${b.n===1?'completion':'completions'}`).join(' + ');
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">${rows} &middot; from ${why}</span>
      <button class="btn sm" data-fix="tmpl-no">Leave it</button>
      <button class="btn primary sm" data-fix="tmpl-yes">Update</button></div>`;
  }

  else if(s.kind==='reschedule'){
    /* Never a bare count with no way out. The four doors are the four real
       answers to "I keep moving this": move it again (and own it), say out loud
       that it is actually waiting on something, admit the cadence was wrong, or
       admit the goal was. */
    const st=currentStep(t);
    body=`<div class="fixrow">
      <span class="tiny muted" style="flex:1;min-width:0">${esc(st?st.title:'')}</span>
      <input type="date" id="fxWhen" value="${suggestDay({goal:g,quadrant:st?st.quadrant:'q2'},45)}">
      <input type="time" id="fxTime" value="${suggestTime({goal:g,quadrant:st?st.quadrant:'q2'})}">
      <button class="btn primary sm" data-fix="schedule">Move it again</button></div>
      <div class="fixrow">
      <input type="text" id="fxBlock" placeholder="Waiting on what?">
      <button class="btn sm" data-fix="churn-block">Mark blocked</button>
      <button class="btn sm" data-fix="churn-cadence">Cadence…</button>
      <button class="btn sm" data-fix="drop">Drop the goal</button></div>
      <div class="tiny muted" id="fxLoad"></div>`;
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
  else if(s.kind==='til'){
    /* Oldest first, tips ahead of notes (see tilQueue in src/notes.js). A card is
       two taps — Show answer, then grade — and a plain note stays one, exactly as
       v1 had it: there is nothing to reveal, so there's nothing to wait for. */
    const it=tilQueue()[0];
    body = !it ? `<div class="fixrow"><span class="tiny muted">Nothing left to review.</span></div>`
         : it.tip ? tipHTML(it)
         : TIL_EDIT===it.id ? tilEditHTML(it.note)
         : tilCardHTML(it);
  }
  return `<div class="sigfix" data-key="${esc(s.key)}">${head}${body}</div>`;
}

function tilCardHTML(it){
  const card=parseCard(it.text).kind!=='plain', open=!card||TIL_REVEAL===it.id;
  return `<div class="fixrow" style="align-items:flex-start">
      <span class="tiny tilcard" style="flex:1;min-width:0;white-space:pre-wrap">${cardHTML(it.text, open)}</span></div>
    <div class="fixrow">
      <button class="btn sm" data-fix="til-delete">Not useful</button>
      <button class="btn ghost sm" data-fix="til-edit">Edit</button>
      <span class="spacer" style="flex:1"></span>
      ${open
        ? `<button class="btn sm" data-fix="til-forgot">Forgot it</button>
           <button class="btn primary sm" data-fix="til-remembered">Remembered</button>`
        : `<button class="btn primary sm" data-fix="til-reveal">Show answer</button>`}</div>`;
}
function tilEditHTML(n){
  return `<div class="fixrow">
      <textarea id="fxNote" rows="3" style="flex:1;min-width:0;font-size:12.5px">${esc(n.text)}</textarea></div>
    <div class="fixrow">
      <button class="btn ghost sm" data-fix="til-edit-cancel">Cancel</button>
      <button class="btn sm" data-fix="til-hide" title="Blank out the selected words, or bring a blank back">Hide</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn primary sm" data-fix="til-save">Save</button></div>
    <div class="tiny muted">Select words and tap Hide to blank them (tap again to undo). &ldquo; :: &rdquo; splits a question from its answer. The schedule is kept.</div>`;
}
/* A tip is itself a working card: the demo goes through the same renderer and
   the same Show answer as a real note, so the thing it teaches is on screen. */
function tipHTML(it){
  const demo=!!it.text, open=!demo||TIL_REVEAL===it.id;
  return `<div class="fixrow"><span class="tiny"><span class="pill">Tip</span> ${esc(it.tip.say)}</span></div>
    ${demo?`<div class="fixrow" style="align-items:flex-start">
      <span class="tiny tilcard" style="flex:1;min-width:0;white-space:pre-wrap">${cardHTML(it.text, open)}</span></div>`:''}
    <div class="fixrow">
      <button class="btn ghost sm" data-fix="tip-off">No more tips</button>
      <span class="spacer" style="flex:1"></span>
      ${open
        ? `<button class="btn primary sm" data-fix="tip-got">Got it</button>`
        : `<button class="btn primary sm" data-fix="til-reveal">Show answer</button>`}</div>`;
}

/* Review-surface moves that change nothing stored: no checkpoint, no undo step,
   just a repaint. Returns true when it handled the act. */
function tilUiAct(act){
  const it=tilQueue()[0];
  if(act==='til-reveal'){ if(it) setTilReveal(it.id); renderSignals(); return true; }
  if(act==='til-edit'){ if(it&&it.note) setTilEdit(it.id); renderSignals();
    const ta=$('#fxNote'); if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    return true; }
  if(act==='til-edit-cancel'){ setTilEdit(null); renderSignals(); return true; }
  if(act==='til-hide'){
    const ta=$('#fxNote'); if(!ta) return true;
    const r=toggleHide(ta.value, ta.selectionStart, ta.selectionEnd);
    if(!r.ok){ toast('Select words on one line, outside any other blank.'); return true; }
    ta.value=r.text; ta.focus(); ta.setSelectionRange(r.start, r.end);
    return true; }
  return false;
}

export function sigFixAct(act,btn){
  const s=signals().find(x=>x.key===SIGFIX);
  if(act==='cancel'||!s){ setSigFix(null); renderSignals(); return; }
  if(s.kind==='til' && tilUiAct(act)) return;
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
    case 'foot-yes':{
      const st=currentStep(t); if(!st){toast('No step to put it on.');return;}
      const r=applyFootprint(st.id, s.gate.tmpl);
      clearGate(g,s.gate.id);
      setSigFix(null); save(); render();
      toast(r&&r.filled.length
        ? 'Footprint added — '+r.filled.length+' filled'+(r.kept.length?', '+r.kept.length+' of yours kept':'')+'. ⌘Z undoes it.'
        : 'Nothing to fill — you had it all already.');
      return; }
    case 'foot-no': clearGate(g,s.gate.id); break;
    case 'prereq-done': togglePrereq(s.step.id, s.prereq.id); break;
    case 'tmpl-yes':{
      const t2=acceptTmplGate(s.gate.id);
      setSigFix(null); save(); render();
      toast(t2?('"'+t2.label+'" updated — ⌘Z undoes it.'):'That suggestion is gone.');
      return; }
    case 'tmpl-no':
      declineTmplGate(s.gate.id);
      setSigFix(null); save(); render();
      toast('Left as it was — it won\'t ask again from the same evidence.');
      return;
    case 'add-step':{
      const v=$('#fxStep').value.trim(); if(!v){toast('Name the step.');return;}
      t.steps.push(newStep(v,{quadrant:$('#fxQuad').value})); touchThread(t); break; }
    case 'schedule':{
      const st=currentStep(t); if(!st){toast('Nothing to schedule.');return;}
      const d=$('#fxWhen').value; if(!d){toast('Pick a date.');return;}
      const tm=($('#fxTime').value||'19:00').split(':');
      /* 'manual': the ribbon is a surface, not a different act — a person typing a
         date here is the same decision as typing one in the editor. Resolving
         `unscheduled` is inert (first anchor, no predecessor); resolving `slipped`
         counts, and should: that IS pushing the same commitment again. */
      CAL.anchor(g,t,st,d,+tm[0]*60 + +tm[1],45,'manual'); touchThread(t); break; }
    case 'branch':{
      const b=(t.branches||[])[+btn.dataset.i]; if(!b) return;
      t.needsBranch=false;
      t.steps.push(newStep(b.next,{auto:true})); touchThread(t); break; }
    case 'churn-block':{
      /* Saying it is blocked is a real answer, and it also silences the churn
         signal for the right reason rather than by snoozing it: a blocked thread
         is excluded from this kind, the same way it is from every other. */
      const who=($('#fxBlock')||{value:''}).value.trim();
      t.status='blocked'; t.blockedOn=who||'someone'; t.blockedSince=new Date().toISOString();
      logIt('blocked',{goalId:g.id,threadId:t.id,text:t.blockedOn}); break; }
    case 'churn-cadence':
      /* The cadence field lives in the goal editor; jumping there beats growing a
         second place to edit it. */
      setSigFix(null); openGoal(g.id); return;
    case 'unblock':
      unblockThread(g,t); break;
    case 'revive':
      touchThread(t); break;                          // movement is what un-hushes it
    /* The til acts keep the resolver open on purpose: with more due behind this
       one, closing it after each grade was a click per note for nothing. It
       closes itself once the queue is empty. */
    case 'til-remembered': case 'til-forgot': case 'til-delete':
    case 'til-save': case 'tip-got': case 'tip-off':{
      const it=tilQueue()[0];
      if(act==='til-save'){
        const v=($('#fxNote')||{value:''}).value;
        if(!v.trim()){ toast('Empty — use Not useful to delete it.'); return; }
        if(it&&it.note) updateNote(it.note.id, v);
        setTilEdit(null);
      }
      else if(act==='tip-got'){ if(it&&it.tip) retireTip(it.tip.id); }
      else if(act==='tip-off') tipsOff();
      else if(it&&it.note){
        if(act==='til-delete') deleteNote(it.note.id);
        else reviewNote(it.note, act==='til-remembered');
      }
      setTilReveal(null);
      if(!tilQueue().length) setSigFix(null);
      save(); render();
      toast(act==='til-remembered'?'Remembered — scheduled ahead.'
        :act==='til-forgot'?'Forgot — back tomorrow.'
        :act==='til-delete'?'Deleted — ⌘Z to undo.'
        :act==='til-save'?'Saved — schedule kept.'
        :act==='tip-off'?'No more tips.'
        :'Tip retired.');
      return; }
    case 'drop':
      // nothing else is open, so this one can afford a real dialog
      setSigFix(null); renderSignals();
      openConfirm({title:'Drop this goal', yes:'Drop it', danger:true,
        body:`<b>${esc(g.title)}</b> goes, along with its threads and calendar slots. <b>⌘Z undoes it.</b>`,
        onYes:()=>{ checkpoint('dropping that goal'); deleteGoal(g.id); render(); toast('Dropped — ⌘Z to undo.'); }});
      return;
  }
  setSigFix(null); save(); render();
  toast(act==='revive'?'Back in rotation.':act==='drop'?'Dropped.'
    :'Done — no check-in needed.');
}


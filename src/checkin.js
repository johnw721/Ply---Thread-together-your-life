import { TYPE } from './types.js';
import { bestQuadrant } from './views/quarter.js';
import { budget, dayBudget, hrs, loadState } from './budget.js';
import { CAL } from './cal.js';
import { closeModal, openModal } from './components/modal.js';
import { HUSH_AT, autoNextTitle, cadenceOf, checkinAgenda, clearGate, completeStep, daysQuiet, firstStepFor, followThrough, itemsOn, learnType, shortName, signals, unscheduledItems } from './engine.js';
import { openConvert } from './goal-editor.js';
import { DB, checkpoint, currentStep, finishGoal, lastDoneStep, load, logIt, newStep, save, touchThread } from './store.js';
import { $, $$, addDays, daysBetween, dkey, esc, fmtDate, fmtDay, fmtTime, toast, today, uid } from './util.js';
import { QUAD, render } from './views/render.js';

/* ===================== [SECTION: CHECKIN] ===================== */
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

export function renderCheckin(){
  const c=CK.q[CK.i];
  const prog=CK.q.map((_,n)=>`<div class="s ${n<CK.i?'done':n===CK.i?'on':''}"></div>`).join('');
  let body='', foot='', title='Weekly check-in';

  if(c.t==='intro'){
    const a=c.ag; const n=a.gates.length+a.quiet.length+a.blocked.length+a.nostep.length+a.branch.length;
    const ft=followThrough(null,14);
    body=`<p class="wizq">Since ${a.since===today()?'today':fmtDate(a.since)}</p>
      <p class="wizsub">${n===0?'Nothing is drifting. Quick pass and you’re out.'
        : c.deferred>0 ? `${CK_MAX} of ${c.total} to answer — that's enough for one sitting. The rest stay in the ribbon,
            where you can fix any of them without coming back here.`
        :'These threads need an answer before they can be considered live.'}</p>
      ${a.hush.length?`<div class="sec tiny muted" style="border-color:#333a47">
        ${a.hush.length} thread${a.hush.length>1?'s have':' has'} gone quiet past ${HUSH_AT}&times; its cadence and stopped
        nagging. They're off this list — revive or drop them from the ribbon when you want to.</div>`:''}
      <div class="sec"><div class="stat">
        <div><div class="k">${a.quiet.length}</div><div class="kl">no movement</div></div>
        <div><div class="k">${a.blocked.length}</div><div class="kl">blocked</div></div>
        <div><div class="k">${a.nostep.length+a.branch.length}</div><div class="kl">no next step</div></div>
        <div><div class="k">${a.unsched.length}</div><div class="kl">unscheduled</div></div>
        <div><div class="k">${a.gates.length}</div><div class="kl">questions queued</div></div>
      </div></div>
      <div class="sec"><h4>Follow-through, last 14 days</h4>
        <div class="stat"><div><div class="k">${ft.done}<span class="muted" style="font-size:15px">/${ft.planned}</span></div>
          <div class="kl">steps done vs planned</div></div></div>
        <div class="barmini"><i style="width:${ft.rate}%"></i></div></div>`;
    foot=`<span class="spacer"></span><button class="btn primary" data-ck="next">Start &rarr;</button>`;
  }

  else if(c.t==='gate'){
    const g=c.goal, k=c.gate.kind;
    title='Queued question';
    body=subjHead(g,null)+`<p class="wizq">${esc(c.gate.q)}</p>`;
    if(k==='deadline'){
      body+=`<p class="wizsub">Deadline-type goals need a real date &mdash; the metric climbs toward it.</p>
        <label class="fld"><span>Hard date</span><input type="date" id="ckDate" value="${g.smart.deadline||''}"></label>
        <label class="fld"><span>What proves it’s done (metric)</span><input type="text" id="ckMetric" value="${esc(g.smart.metricName||'')}" placeholder="e.g. passing exam score"></label>`;
      foot=`<button class="btn" data-ck="skip">Ask me next week</button><span class="spacer"></span>
            <button class="btn" data-ck="gate-retype">Not a deadline goal</button>
            <button class="btn primary" data-ck="gate-deadline">Set date</button>`;
    } else if(k==='trigger'){
      body+=`<p class="wizsub">Until this fires the goal stays dormant and will not appear anywhere or nag you.</p>
        <label class="fld"><span>Trigger condition</span><input type="text" id="ckTrig" value="${esc(g.trigger||'')}" placeholder="e.g. offer accepted on the house"></label>`;
      foot=`<button class="btn" data-ck="skip">Ask me next week</button><span class="spacer"></span>
            <button class="btn" data-ck="gate-fire">It already fired &mdash; activate</button>
            <button class="btn primary" data-ck="gate-trigger">Save trigger</button>`;
    } else if(k==='decision'){
      body+=`<p class="wizsub">A decision resolves once and then either closes or converts. A goal gets executed on a cadence.</p>`;
      foot=`<button class="btn" data-ck="skip">Ask me next week</button><span class="spacer"></span>
            <button class="btn" data-ck="gate-isgoal">It’s a goal</button>
            <button class="btn primary" data-ck="gate-isdecision">It’s a decision</button>`;
    } else if(k==='confirm-type'){
      body+=`<p class="wizsub">${esc(TYPE[g.type].hint)}</p>
        <label class="fld"><span>Type</span><select id="ckType">${Object.keys(TYPE).map(t=>
          `<option value="${t}" ${t===g.type?'selected':''}>${TYPE[t].label}</option>`).join('')}</select></label>`;
      foot=`<button class="btn" data-ck="skip">Ask me next week</button><span class="spacer"></span>
            <button class="btn primary" data-ck="gate-type">Confirm</button>`;
    } else if(k==='resolve-decision'){
      body+=`<p class="wizsub">Carry over only the why and your notes &mdash; not the whole decision history.</p>`;
      foot=`<button class="btn" data-ck="skip">Still deciding</button><span class="spacer"></span>
            <button class="btn" data-ck="dec-close">Close it out</button>
            <button class="btn primary" data-ck="dec-convert">Convert to a goal</button>`;
    }
  }

  else if(c.t==='branch'){
    const g=c.goal,t=c.thread; const last=lastDoneStep(t);
    title='Which way did it go?';
    body=subjHead(g,t)+`<p class="wizq">${esc(last?last.title:'The last step')} &mdash; how did it resolve?</p>
      <p class="wizsub">This thread branches. The next step depends on the answer.</p>
      <div class="choices">${t.branches.map((b,i)=>
        `<button class="btn" data-ck="branch" data-i="${i}">${esc(b.condition)} &rarr; ${esc(b.next)}</button>`).join('')}</div>`;
    foot=`<button class="btn" data-ck="skip">Not resolved yet</button><span class="spacer"></span>`;
  }

  else if(c.t==='nostep'){
    const g=c.goal,t=c.thread;
    const sug=autoNextTitle(g,t,null);
    title='Define the next step';
    body=subjHead(g,t)+`<p class="wizq">What is the next concrete move?</p>
      <p class="wizsub">A thread with no next step is exactly how things go quiet.</p>
      <label class="fld"><span>Next step</span><input type="text" id="ckStep" value="${esc(sug||'')}" placeholder="one specific action"></label>
      <label class="fld"><span>Quadrant</span><select id="ckQuad">${Object.keys(QUAD).map(q=>
        `<option value="${q}" ${q==='q2'?'selected':''}>${QUAD[q].n} &mdash; ${QUAD[q].ax}</option>`).join('')}</select></label>`;
    foot=`<button class="btn" data-ck="block">Actually it’s blocked</button>
          <button class="btn ghost" data-ck="skip">Skip for now</button><span class="spacer"></span>
          <button class="btn primary" data-ck="addstep">Add step</button>`;
  }

  else if(c.t==='blocked'){
    const g=c.goal,t=c.thread;
    const bd=t.blockedSince?daysBetween(dkey(new Date(t.blockedSince)),today()):daysQuiet(t);
    title='Still waiting';
    body=subjHead(g,t)+`<p class="wizq">Waiting on ${esc(t.blockedOn||'someone')} &mdash; ${bd} day${bd===1?'':'s'}</p>
      <p class="wizsub">Blocked threads stay visible. They don’t go dormant.</p>
      ${bd>=10?`<div class="sec" style="border-color:#5a4a24"><b>That is a long time.</b> Consider a nudge step you control &mdash; a follow-up message is itself a next step.</div>`:''}`;
    foot=`<button class="btn" data-ck="unblock-nudge">Add a nudge step</button>
          <span class="spacer"></span>
          <button class="btn" data-ck="unblock">Unblocked &mdash; define next</button>
          <button class="btn primary" data-ck="next">Still waiting</button>`;
  }

  else if(c.t==='quiet'){
    const g=c.goal,t=c.thread,s=c.step;
    title='No logged movement';
    body=subjHead(g,t)+`<p class="wizq">${esc(s.title)}</p>
      <p class="wizsub">Quiet for ${c.days} day${c.days===1?'':'s'}. Expected cadence: every ${cadenceOf(g)} days.</p>
      ${ CKROW==='cadence' ? `<div class="sec"><label class="fld"><span>Days between touches</span>
          <input type="number" id="ckCad" min="1" value="${cadenceOf(g)}"></label>
          <div class="tiny muted">How often this should move before silence means something.</div></div>` : '' }
      ${ CKROW==='blocked' ? `<div class="sec"><label class="fld"><span>Waiting on</span>
          <input type="text" id="ckWho" placeholder="who or what"></label></div>` : '' }
      ${ CKROW==='next' ? `<div class="sec"><label class="fld"><span>Done. What's the next step?</span>
          <input type="text" id="ckNextStep" placeholder="the next move"></label></div>` : '' }`;
    foot = CKROW==='cadence'
      ? `<button class="btn" data-ck="row-cancel">Back</button><span class="spacer"></span>
         <button class="btn primary" data-ck="cadence-save">Save cadence</button>`
      : CKROW==='blocked'
      ? `<button class="btn" data-ck="row-cancel">Back</button><span class="spacer"></span>
         <button class="btn primary" data-ck="block-save">Mark blocked</button>`
      : CKROW==='next'
      ? `<button class="btn" data-ck="row-cancel">Back</button><span class="spacer"></span>
         <button class="btn primary" data-ck="next-save">Save next step</button>`
      : `<button class="btn" data-ck="quiet-slip">Didn’t happen</button>
         <button class="btn" data-ck="block">Blocked</button>
         <span class="spacer"></span>
         <button class="btn" data-ck="quiet-cadence">Cadence is wrong</button>
         <button class="btn primary" data-ck="quiet-done">Done &mdash; next step</button>`;
  }

  else if(c.t==='schedule'){
    const list=unscheduledItems();
    title='Get them on the calendar';
    body=`<p class="wizq">${list.length?'Give each next step a slot':'Everything has a slot'}</p>
      <p class="wizsub">If it isn’t scheduled, it isn’t real yet.</p>
      ${ list.length? list.map(i=>`<div class="sec" data-sched="${i.step.id}">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span class="dot" style="background:${QUAD[i.quadrant].c}"></span>
            <div><div style="font-size:13px">${esc(i.step.title)}</div>
              <div class="tiny muted">${esc(shortName(i.goal))}</div></div></div>
          <div class="row">
            <input type="date" class="sd" value="${suggestDay(i,45)}">
            <input type="time" class="stm" value="${suggestTime(i)}">
            <select class="sdur"><option value="30">30m</option><option value="45" selected>45m</option>
              <option value="60">1h</option><option value="90">1.5h</option><option value="120">2h</option>
              <option value="0">no time</option></select>
            <button class="btn primary" data-ck="sched-one" data-step="${i.step.id}" style="flex:none">Schedule</button>
          </div>
          <div class="tiny muted" style="margin-top:6px">${(()=>{const L=loadState(suggestDay(i,45));
            return L.over ? '<span class="overtxt">that day is already '+hrs(L.mins)+'</span> against a '+hrs(L.budget)+' day'
                          : hrs(L.free)+' free that day';})()}</div></div>`).join('')
        : '<div class="sec muted">Nothing loose.</div>' }`;
    foot=`${list.length?'<button class="btn" data-ck="sched-all">Schedule all as suggested</button>':''}
          <span class="spacer"></span><button class="btn primary" data-ck="next">Continue &rarr;</button>`;
  }

  /* The summary used to be a report card: how many you answered, what percentage you
     hit, what's still wrong. Grading someone at the end of a chore is a poor reason
     to come back next week. What earns the five minutes is walking out with the week
     already laid out — so that's what this shows now, and the score is a footnote. */
  else if(c.t==='done'){
    const ft=followThrough(null,7), sig=signals();
    const week=[];
    for(let i=0;i<7;i++){
      const k=addDays(today(),i);
      const its=itemsOn(k).filter(x=>!x.step.done)
        .sort((a,b)=>(a.start==null?1e9:a.start)-(b.start==null?1e9:b.start));
      if(its.length) week.push({k, its});
    }
    const booked=week.reduce((n,d)=>n+d.its.length,0);
    // the handful that carry the week — urgent-important first, soonest first
    const RANK={q1:0,q2:1,q3:2,q4:3};
    const three=week.flatMap(d=>d.its.map(i=>({...i,k:d.k})))
      .sort((a,b)=>RANK[a.quadrant]-RANK[b.quadrant] || a.k.localeCompare(b.k)).slice(0,3);
    const loose=unscheduledItems().length;

    title='The week ahead';
    body=`<p class="wizq">${booked?booked+' thing'+(booked===1?'':'s')+' on the calendar':'Nothing booked yet'}</p>
      <p class="wizsub">${CK.touched?CK.touched+' thread'+(CK.touched===1?'':'s')+' settled. ':''}${
        loose?loose+' next step'+(loose===1?'':'s')+' still without a slot.':'Everything live has a slot.'}</p>

      ${three.length?`<div class="sec"><h4>If you only do three things</h4>
        ${three.map(i=>`<div class="stepline">
          <span class="dot" style="background:${QUAD[i.quadrant].c}"></span>
          <span style="flex:1">${esc(i.step.title)}</span>
          <span class="st">${i.k===today()?'today':fmtDay(i.k)}${i.start!=null?' '+fmtTime(i.start):''}</span>
        </div>`).join('')}</div>`:''}

      <div class="sec"><h4>Next seven days</h4>
        ${ week.length ? week.map(d=>`<div class="wkday">
            <div class="wkd">${d.k===today()?'Today':fmtDay(d.k)+' '+fmtDate(d.k)}
              <span class="tiny muted">${hrs(loadState(d.k).mins)}</span></div>
            ${d.its.map(i=>`<div class="stepline">
              <span class="dot" style="background:${QUAD[i.quadrant].c}"></span>
              <span style="flex:1">${esc(i.step.title)}</span>
              <span class="st">${i.start!=null?fmtTime(i.start):'all day'}</span></div>`).join('')}
          </div>`).join('')
        : '<div class="muted tiny">Nothing scheduled in the next seven days. That is the thing to fix.</div>' }</div>

      ${ sig.length? `<div class="sec"><h4>Still surfacing &mdash; ${sig.length}</h4>
        <div class="tiny muted">In the ribbon, fixable there without another check-in.</div></div>`:'' }

      <div class="tiny muted" style="text-align:center;margin-top:4px">
        Last 7 days: ${ft.done} step${ft.done===1?'':'s'} done${ft.planned?' of '+ft.planned+' planned ('+ft.rate+'%)':''}</div>`;
    foot=`<span class="spacer"></span><button class="btn primary" data-ck="finish">Done</button>`;
  }

  openModal(`<h3>${title}<span class="pill">${CK.i+1}/${CK.q.length}</span>
      <button class="btn ghost x" data-close>&times;</button></h3>
    <div class="wizsteps">${prog}</div>
    <div class="mbody">${body}</div>
    <div class="mfoot">${CK.i>0&&CK.i<CK.q.length-1?'<button class="btn ghost" data-ck="back">&larr;</button>':''}${foot}</div>`,
    {wide:c.t==='schedule'});
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


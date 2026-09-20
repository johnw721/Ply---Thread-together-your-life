import { PIPELINE_STAGES, TYPE } from './types.js';
import { bestQuadrant } from './views/quarter.js';
import { dayBudget, hrs, loadState } from './budget.js';
import { CAL } from './cal.js';
import { ckAct, findStep, setCK, subjHead, suggestDay, suggestTime } from './checkin.js';
import { ARMED, armConfirm, armLabel, disarm, newInAct, newInHTML, takeConfirmCb } from './components/dialogs.js';
import { closeModal, openModal } from './components/modal.jsx';
import { DOWS, buildGoalFrom, cadenceOf, classify, completeStep, daysQuiet, followThrough, learnType, moveItem, shortName, streak, subProgress, subs, toggleSub } from './engine.js';
import { gConnect, gDead, gDisconnect, gFlush, gForeign, gPrefsHTML, gReadPrefs, gSync, setGErr } from './google.js';
import { installPrefsHTML, notifDisable, notifEnable, notifPrefsHTML, notifWanted } from './notify.js';
import { doInstall, renderInstallBar } from './pwa.js';
import { DB, MEMONLY, addEvent, addGoal, checkpoint, currentStep, deleteGoal, eventById, finishGoal, goalById, logIt, masterEvent, newEvent, newStep, newThread, removeEvent, save, skipOccurrence, threadById, touchThread } from './store.js';
import { $, $$, dkey, el, esc, fmtDate, fmtFull, fmtTime, toast, today, uid } from './util.js';
import { QUAD, render } from './views/render.jsx';

export function toggleStep(gid,tid,sid){
  const f=findStep(sid); if(!f) return;
  const {goal,thread,step}=f;
  checkpoint(step.done?'reopening that step':'completing that step');
  if(step.done){ step.done=false; step.doneAt=null; save(); render(); return; }
  const r=completeStep(goal,thread,step);
  render();
  if(r.needsDefine && r.reason==='branch'){ toast('Branching thread — resolve it in the check-in.'); openGoal(goal.id); }
  else if(r.needsDefine){ openDefineNext(goal,thread); }
  else if(r.next){ toast('Next: '+r.next.title + (r.carried?' — '+r.carried+' unfinished subtask'+(r.carried>1?'s':'')+' carried over':'')); }
}
/* the governing rule: a thread cannot close a step without producing the next one */
export function openDefineNext(g,t){
  openModal(`<h3>Next step required<button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody">${subjHead(g,t)}
      <p class="wizq">Step done. What is the next one?</p>
      <p class="wizsub">This thread stays open until it has a live next step. Leaving it empty is how it goes quiet.</p>
      <label class="fld"><span>Next step</span><input type="text" id="dnStep" placeholder="one specific action"></label>
      <label class="fld"><span>Quadrant</span><select id="dnQuad">${Object.keys(QUAD).map(q=>
        `<option value="${q}" ${q==='q2'?'selected':''}>${QUAD[q].n}</option>`).join('')}</select></label>
      <label class="fld"><span>Slot it (optional)</span><div class="row">
        <input type="date" id="dnDate"><input type="time" id="dnTime" value="19:00"></div></label>
    </div>
    <div class="mfoot">
      <button class="btn" data-ui="dn-block">It’s blocked instead</button><span class="spacer"></span>
      <button class="btn" data-close>Later</button>
      <button class="btn primary" data-ui="dn-save" data-g="${g.id}" data-t="${t.id}">Add next step</button></div>`);
}

/* ---------------- event editor ---------------- */
export function openEvent(id){
  const e = id?eventById(id):newEvent({dateKey:DB.meta.cursor});
  const m = id?masterEvent(id):null;
  /* Somebody else's calendar entry. It shows, and it counts against the day, but
     the fields would be a lie: saving them here would be overwritten by the next
     pull, and Ply has no business rewriting a meeting it didn't create. */
  if(gForeign(e)){
    const L0=loadState(e.dateKey);
    openModal(`<h3>From Google Calendar<button class="btn ghost x" data-close>&times;</button></h3>
      <div class="mbody">
        <div class="sec"><b style="color:var(--text)">${esc(e.title)}</b>
          <div class="tiny muted" style="margin-top:4px">${fmtFull(e.dateKey)}${
            e.allDay?' &mdash; all day':' &mdash; '+fmtTime(e.start)+', '+hrs(e.dur)}</div></div>
        <div class="sec tiny muted">This one came from your calendar, so it's read-only here &mdash;
          change it in Google and the next sync brings it across. It still counts against the day:
          ${fmtDate(e.dateKey)} holds ${hrs(L0.mins)} of a ${hrs(L0.budget)} day${L0.over?' — already over':''}.</div>
      </div>
      <div class="mfoot">${e.gcal&&e.gcal.link
        ? `<a class="btn" href="${esc(e.gcal.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>`:''}
        <span class="spacer"></span><button class="btn" data-close>Close</button></div>`);
    return;
  }
  const rec = (m&&m.recur)||null;
  const anchored = !!e.stepId;                       // step anchors are single commitments
  const L = loadState(e.dateKey);

  openModal(`<h3>${id?'Event':'New event'}<button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody">
      <label class="fld"><span>Title</span><input type="text" id="evT" value="${esc(e.title)}"></label>
      <div class="row">
        <label class="fld"><span>Date</span><input type="date" id="evD" value="${e.dateKey}"></label>
        <label class="fld"><span>Start</span><input type="time" id="evS" value="${String(Math.floor(e.start/60)).padStart(2,'0')}:${String(e.start%60).padStart(2,'0')}" ${e.allDay?'disabled':''}></label>
        <label class="fld"><span>Minutes</span><input type="number" id="evL" value="${e.dur}" step="15" ${e.allDay?'disabled':''}></label>
      </div>
      <label class="fld"><span>All day</span><input type="checkbox" id="evA" ${e.allDay?'checked':''} style="width:auto"></label>

      ${anchored ? `<div class="sec tiny muted">This slot belongs to a next step, so it doesn't repeat.
        Cyclical goals re-book themselves one cadence out when you tick the step off.</div>`
      : `<div class="sec"><h4>Repeat</h4>
        <div class="row">
          <label class="fld"><span>Every</span><select id="evR">
            ${[0,1,2,3,7,14,28].map(n=>`<option value="${n}" ${rec&&rec.every===n?'selected':(!rec&&n===0?'selected':'')}>${
              n===0?'does not repeat':n===1?'day':n===7?'week':n===14?'2 weeks':n===28?'4 weeks':n+' days'}</option>`).join('')}
          </select></label>
          <label class="fld"><span>Until (optional)</span><input type="date" id="evU" value="${rec&&rec.until?rec.until:''}"></label>
        </div>
        ${e.virtual?`<div class="tiny muted">You opened the occurrence on ${fmtDate(e.dateKey)}. Saving edits the whole series
          &mdash; use <b>Skip this one</b> to drop just this date.</div>`:''}
      </div>`}

      <div class="sec tiny muted">${fmtDate(e.dateKey)} currently holds ${hrs(L.mins)} of a ${hrs(L.budget)} day${L.over?' — already over':''}.
        <br>Calendar source: ${esc(e.src)}${e.gcal&&e.gcal.id?' &mdash; synced':(e.gcal?' &mdash; waiting to sync':'')}.${
        gDead(e)?' <b style="color:var(--warn)">Deleted in Google.</b> Saving puts it back.':''}</div>
    </div>
    <div class="mfoot">
      ${id?`<button class="btn danger" data-ui="ev-del" data-id="${e.id}">Delete${m&&m.recur?' series':''}</button>`:''}
      ${id&&m&&m.recur?`<button class="btn" data-ui="ev-skip" data-id="${e.id}">Skip this one</button>`:''}
      <span class="spacer"></span><button class="btn" data-close>Cancel</button>
      <button class="btn primary" data-ui="ev-save" data-id="${id||''}">Save</button></div>`);
  $('#modalRoot').dataset.draft=JSON.stringify(e);
}

/* ---------------- decision → goal conversion ---------------- */
export function openConvert(g){
  openModal(`<h3>Convert decision into a goal<button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody">
      <div class="sec tiny muted">From decision: <b style="color:var(--text)">${esc(g.title)}</b><br>
        Only the why and your notes carry over. The decision history stays behind.</div>
      <label class="fld"><span>The goal, as you'd phrase it now</span>
        <input type="text" id="cvT" value="${esc(g.why||'')}" placeholder="e.g. ship Plumbline v1 auth module"></label>
      <label class="fld"><span>Type</span><select id="cvType"><option value="">auto-classify</option>
        ${Object.keys(TYPE).map(t=>`<option value="${t}">${TYPE[t].label}</option>`).join('')}</select></label>
      <label class="fld"><span>Why (carried over)</span><textarea id="cvWhy">${esc(g.why||'')}</textarea></label>
      <label class="fld"><span>Notes (carried over)</span><textarea id="cvNotes">${esc(g.notes||'')}</textarea></label>
    </div>
    <div class="mfoot"><span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" data-ui="cv-save" data-id="${g.id}">Create goal</button></div>`);
}

/* ---------------- goal editor ---------------- */
export function openGoal(id){ openModal(goalEditorHTML(id),{wide:true,nofocus:true}); }
export function refreshGoal(id){ const m=$('.modal'); if(m) m.innerHTML=goalEditorHTML(id); }

/* up/down beat drag here: the list is short, and arrows work with a keyboard and on
   a phone, where the quadrant drag already had to grow a dedicated grip */
export function ordControls(upAct,downAct,i,len,extra){
  return `<button class="btn sm ghost ord" data-ge="${upAct}" data-i="${i}" ${extra} ${i===0?'disabled':''}
      title="Move up" aria-label="Move up">&#9650;</button>
    <button class="btn sm ghost ord" data-ge="${downAct}" data-i="${i}" ${extra} ${i===len-1?'disabled':''}
      title="Move down" aria-label="Move down">&#9660;</button>`;
}
/* which inline row the goal editor currently has open — one at a time */
export let GEROW=null;
export function setGerow(v){ GEROW=v; }

export function schedRowHTML(g,t,s,ev){
  const d = ev?ev.dateKey:suggestDay({goal:g,quadrant:s.quadrant},45);
  const tm = ev&&!ev.allDay ? String(Math.floor(ev.start/60)).padStart(2,'0')+':'+String(ev.start%60).padStart(2,'0')
                            : suggestTime({goal:g,quadrant:s.quadrant});
  const L=loadState(d);
  return `<div class="stepline addrow">
    <input type="date" class="schd" value="${d}" aria-label="Date">
    <input type="time" class="schtm" value="${tm}" ${ev&&ev.allDay?'disabled':''} aria-label="Time">
    <label class="tiny muted" style="display:flex;gap:4px;align-items:center">
      <input type="checkbox" class="schall" ${ev&&ev.allDay?'checked':''} style="width:auto">all day</label>
    <span class="tiny muted schload">${L.over?`<span class="overtxt">${hrs(L.mins)} booked</span>`:hrs(L.free)+' free'}</span>
    <button class="btn sm" data-ge="sched-cancel">cancel</button>
    <button class="btn sm primary" data-ge="sched-save" data-t="${t.id}" data-s="${s.id}">${ev?'reslot':'schedule'}</button>
  </div>`;
}

export function subListHTML(g,t,s){
  const list=subs(s), p=subProgress(s);
  return `<div class="sublist" data-s="${s.id}">
    ${list.map((x,i)=>`<div class="subline ${x.done?'done':''}">
      <span class="subchk ${x.done?'on':''}" data-ge="sub-toggle" data-t="${t.id}" data-s="${s.id}" data-sub="${x.id}"
        role="checkbox" aria-checked="${x.done}" tabindex="0">${x.done?'&#10003;':''}</span>
      <input class="edit subtitle" data-s="${s.id}" data-sub="${x.id}" value="${esc(x.title)}" aria-label="Subtask">
      ${ordControls('sub-up','sub-down',i,list.length,`data-s="${s.id}"`)}
      <button class="btn sm ghost" data-ge="sub-del" data-s="${s.id}" data-sub="${x.id}" aria-label="Delete subtask">&times;</button>
    </div>`).join('')}
    <div class="addrow">${newInHTML('sub','+ subtask', `data-s="${s.id}"`)}</div>
    <div class="subfoot">
      ${p.any?`<span class="tiny muted">${p.done}/${p.total} done${p.done===p.total?' — ticking the last one closes the step':''}</span>`
             :`<span class="tiny muted">Break this step down if it needs it. Ticking them all completes the step.</span>`}
    </div></div>`;
}

export function goalEditorHTML(id){
  const g=goalById(id); if(!g) return '<h3>Gone<button class="btn ghost x" data-close>&times;</button></h3>';
  const spec=TYPE[g.type], ft=followThrough(g.id);
  const typeSel=Object.keys(TYPE).map(t=>`<option value="${t}" ${t===g.type?'selected':''}>${TYPE[t].label}</option>`).join('');

  const threads=g.threads.map(t=>{
    const cur=currentStep(t), hist=t.steps.filter(s=>s.done).slice(-4);
    const ev=cur&&cur.eventId?eventById(cur.eventId):null;
    return `<div class="thread ${t.status}" data-thread="${t.id}">
      <div class="th">
        <input type="text" class="tname" value="${esc(t.name)}" style="width:auto;flex:1;background:transparent;border-color:transparent;font-weight:600">
        <select class="trel" style="width:auto;flex:none">${['sequential','parallel','conditional','blocked','cyclical'].map(r=>
          `<option value="${r}" ${r===t.rel?'selected':''}>${r}</option>`).join('')}</select>
        <button class="btn sm ghost ${ARMED==='thread-del:'+t.id?'danger':''}" data-ge="thread-del" data-t="${t.id}"
          >${armLabel('thread-del:'+t.id,'&times;','remove thread?')}</button>
      </div>
      ${ t.status==='blocked' ? `<div class="tiny" style="color:var(--warn);margin-bottom:6px">Waiting on
          <input type="text" class="tblock" value="${esc(t.blockedOn)}" style="width:auto;display:inline-block;padding:2px 6px">
          since ${t.blockedSince?fmtDate(dkey(new Date(t.blockedSince))):'?'} &nbsp;
          <button class="btn sm" data-ge="unblock" data-t="${t.id}">Unblock</button></div>` : '' }
      ${ t.status==='dormant' ? `<div class="tiny muted" style="margin-bottom:6px">Dormant until: ${esc(g.trigger||'trigger undefined')}
          <button class="btn sm" data-ge="fire" data-t="${t.id}">Trigger fired</button></div>`:'' }
      ${ t.rel==='conditional' ? `<div class="tiny muted" style="margin-bottom:6px">Branches
          ${t.branches.map((b,i)=>`<div class="stepline"><span class="muted">if</span> ${esc(b.condition)}
             <span class="muted">&rarr;</span> ${esc(b.next)}
             <button class="btn sm ghost" data-ge="branch-del" data-t="${t.id}" data-i="${i}">&times;</button></div>`).join('')}
          <div class="stepline addrow"><span class="muted">if</span>
            <input class="brif" data-t="${t.id}" placeholder="it goes this way" aria-label="Branch condition">
            <span class="muted">&rarr;</span>
            <input class="brthen" data-t="${t.id}" placeholder="then this is the next step" aria-label="Branch next step">
            <button class="btn sm" data-ge="branch-add" data-t="${t.id}">add</button></div></div>`:'' }
      <div class="steplist">
        ${hist.map(s=>`<div class="stepline hist"><span class="st">${s.doneAt?fmtDate(dkey(new Date(s.doneAt))):''}</span>
           &#10003; ${esc(s.title)}${s.outcome?` <span class="muted">(${esc(s.outcome)})</span>`:''}</div>`).join('')}
        ${ cur ? `<div class="stepline cur">
             <span class="dot" style="background:${QUAD[cur.quadrant].c}"></span>
             <input class="edit steptitle" data-s="${cur.id}" value="${esc(cur.title)}" aria-label="Step title">
             ${ev?`<span class="st">${fmtDate(ev.dateKey)}${ev.allDay?'':' '+fmtTime(ev.start)}</span>`
                 :`<span class="st" style="color:var(--warn)">unscheduled</span>`}
             <button class="btn sm ${GEROW&&GEROW.kind==='sched'&&GEROW.id===cur.id?'primary':''}"
               data-ge="sched" data-t="${t.id}" data-s="${cur.id}">${ev?'reslot':'slot it'}</button>
             <button class="btn sm" data-ge="complete" data-t="${t.id}" data-s="${cur.id}">done</button>
           </div>
           ${ GEROW&&GEROW.kind==='sched'&&GEROW.id===cur.id ? schedRowHTML(g,t,cur,ev) : '' }
           ${subListHTML(g,t,cur)}`
        : `<div class="stepline" style="color:var(--bad)">no next step &mdash; name it below</div>` }
        ${ t.status!=='dormant' ? `<div class="stepline addrow">
            ${newInHTML('step','+ next step', `data-t="${t.id}"`)}</div>` : '' }
      </div>
      ${ t.status!=='blocked' && t.status!=='dormant'
        ? (GEROW&&GEROW.kind==='block'&&GEROW.id===t.id
          ? `<div class="stepline addrow"><span class="muted tiny">Waiting on</span>
              <input class="blockwho" data-t="${t.id}" placeholder="who or what" aria-label="Waiting on">
              <button class="btn sm" data-ge="block-cancel">cancel</button>
              <button class="btn sm primary" data-ge="block-save" data-t="${t.id}">mark blocked</button></div>`
          : `<div style="margin-top:7px"><button class="btn sm" data-ge="block" data-t="${t.id}">mark blocked</button></div>`)
        :'' }
    </div>`;}).join('');

  const typeExtra =
    g.type==='milestone' ? `<div class="sec"><h4>Backlog</h4>
        ${g.backlog.length? g.backlog.map((b,i)=>`<div class="stepline">
          <span class="st">${i+1}</span>
          <input class="edit backtitle" data-i="${i}" value="${esc(b)}" aria-label="Backlog item ${i+1}">
          ${ordControls('backlog-up','backlog-down',i,g.backlog.length,'')}
          <button class="btn sm ghost" data-ge="backlog-del" data-i="${i}">&times;</button></div>`).join('')
          :'<div class="tiny muted">Empty. Completing a step will ask you to define the next one instead of pulling from here.</div>'}
        <div class="stepline addrow">${newInHTML('backlog','+ backlog item')}</div></div>`
  : g.type==='contingent' ? `<div class="sec"><h4>Trigger</h4>
        <input type="text" id="geTrig" value="${esc(g.trigger)}" placeholder="what activates this goal"></div>`
  : g.type==='pipeline' ? `<div class="sec"><h4>Stages</h4>
        <div class="tiny muted">${(g.stages||PIPELINE_STAGES).join(' → ')}</div>
        <div class="stepline addrow" style="margin-top:8px">${newInHTML('entry','+ pipeline entry (company or contact)')}
        <span class="tiny muted"> each entry is its own parallel thread with its own stage</span></div></div>`
  : '';

  const gates = (g.gates||[]).length ? `<div class="sec" style="border-color:#5a4a24">
      <h4 style="color:var(--warn)">Queued for the next check-in</h4>
      ${g.gates.map(x=>`<div class="stepline">${esc(x.q)}</div>`).join('')}</div>`:'';

  return `<h3><span class="dot" style="background:${QUAD[bestQuadrant(g)].c}"></span>
      <span style="flex:1">${esc(shortName(g))}</span>
      <span class="pill">${spec.label}</span>
      <button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody" data-goal="${g.id}">
      <div class="sec"><h4>SMART definition</h4>
        <label class="fld"><span>Goal</span><input type="text" id="geTitle" value="${esc(g.title)}"></label>
        <div class="row">
          <label class="fld"><span>Type</span><select id="geType">${typeSel}</select></label>
          <label class="fld"><span>Cadence (days)</span><input type="number" id="geCad" value="${cadenceOf(g)}" min="0"></label>
          <label class="fld"><span>Deadline${g.smart.deadlineSoft?' (soft)':''}</span><input type="date" id="geDL" value="${g.smart.deadline||''}"></label>
        </div>
        <label class="fld"><span>Specific outcome</span><input type="text" id="geOut" value="${esc(g.smart.outcome)}" placeholder="what is actually true when this is done"></label>
        <div class="row">
          <label class="fld"><span>Metric</span><input type="text" id="geMet" value="${esc(g.smart.metricName)}" placeholder="${esc(spec.metric||'')}"></label>
          <label class="fld"><span>Current</span><input type="number" id="geCur" value="${g.smart.current||0}"></label>
          <label class="fld"><span>Target</span><input type="number" id="geTgt" value="${g.smart.target??''}"></label>
        </div>
        <div class="tiny muted">${esc(spec.hint)}</div>
      </div>
      ${gates}${typeExtra}
      <div class="sec"><h4>Threads <span class="spacer"></span>
        <button class="btn sm" data-ge="thread-add">+ thread</button></h4>${threads}</div>
      <div class="sec"><h4>Follow-through &middot; 28 days</h4>
        <div class="stat">
          <div><div class="k">${ft.done}<span class="muted" style="font-size:15px">/${ft.planned}</span></div><div class="kl">done / planned</div></div>
          <div><div class="k">${streak(g.id)}</div><div class="kl">day streak</div></div>
          <div><div class="k">${daysQuiet(g.threads[0]||{})}</div><div class="kl">days since movement</div></div>
        </div><div class="barmini"><i style="width:${ft.rate}%"></i></div></div>
      <div class="sec"><h4>Context</h4>
        <label class="fld"><span>Why</span><textarea id="geWhy">${esc(g.why)}</textarea></label>
        <label class="fld"><span>Notes</span><textarea id="geNotes">${esc(g.notes)}</textarea></label></div>
    </div>
    <div class="mfoot">
      <button class="btn" data-ge="finish">Mark complete</button>
      <button class="btn danger ${ARMED==='del:'+g.id?'armed':''}" data-ge="del"
        >${armLabel('del:'+g.id,'Delete','Really delete? Click again')}</button>
      ${g.type==='decision'?'<button class="btn" data-ge="convert">Convert to goal</button>':''}
      <span class="spacer"></span>
      <button class="btn primary" data-ge="save">Save</button></div>`;
}

export function saveGoalFields(g){
  const q=s=>$(s);
  if(q('#geTitle')) g.title=q('#geTitle').value.trim()||g.title;
  if(q('#geType')){ const nt=q('#geType').value;
    if(nt!==g.type){ g.type=nt; learnType(g.title,nt);   // a manual retype is a correction like any other
      if(TYPE[nt].gate==='deadline' && !q('#geDL').value)
        g.gates.push({id:uid(),kind:'deadline',q:'What is the hard date for "'+g.title+'"?'}); } }
  if(q('#geCad')) g.cadenceDays = q('#geCad').value===''?null:+q('#geCad').value;
  if(q('#geDL'))  g.smart.deadline=q('#geDL').value||null;
  if(q('#geOut')) g.smart.outcome=q('#geOut').value;
  if(q('#geMet')) g.smart.metricName=q('#geMet').value;
  if(q('#geCur')) g.smart.current=+q('#geCur').value||0;
  if(q('#geTgt')) g.smart.target=q('#geTgt').value===''?null:+q('#geTgt').value;
  if(q('#geWhy')) g.why=q('#geWhy').value;
  if(q('#geNotes')) g.notes=q('#geNotes').value;
  if(q('#geTrig')) g.trigger=q('#geTrig').value;
  // titles are live inputs now rather than read-only text — read them all back
  $$('.steptitle').forEach(el=>{
    const f=findStep(el.dataset.s); if(f && el.value.trim()) f.step.title=el.value.trim();
  });
  $$('.subtitle').forEach(el=>{
    const f=findStep(el.dataset.s); if(!f) return;
    const sub=subs(f.step).find(x=>x.id===el.dataset.sub);
    if(sub && el.value.trim()) sub.title=el.value.trim();
  });
  $$('.backtitle').forEach(el=>{
    const i=+el.dataset.i;
    if(el.value.trim() && g.backlog[i]!==undefined) g.backlog[i]=el.value.trim();
  });
  $$('.thread').forEach(el=>{
    const t=g.threads.find(x=>x.id===el.dataset.thread); if(!t)return;
    const n=$('.tname',el), r=$('.trel',el), b=$('.tblock',el);
    if(n) t.name=n.value.trim()||t.name;
    if(r) t.rel=r.value;
    if(b) t.blockedOn=b.value;
  });
  save();
}

/* ---------------- modal action router ---------------- */
/* The modal's action router. Wired from main.js; #modalRoot outlives every modal. */
export function initModalRouter(){
$('#modalRoot').addEventListener('click',e=>{
  if(e.target.closest('[data-close]') || e.target.classList.contains('scrim')){ closeModal(); setCK(null); render(); return; }
  const ck=e.target.closest('[data-ck]'); if(ck){ ckAct(ck.dataset.ck,ck); return; }
  const ui=e.target.closest('[data-ui]'); if(ui){ uiAct(ui.dataset.ui,ui); return; }
  const ge=e.target.closest('[data-ge]'); if(ge){ geAct(ge.dataset.ge,ge); return; }
});
/* Renames commit on blur and deliberately do NOT refreshGoal() — rewriting the modal
   would take the caret with it. render() updates the views behind; the modal keeps
   its own DOM, which is already correct because the user just typed it. */
$('#modalRoot').addEventListener('change',e=>{
  if(!e.target.classList||!e.target.classList.contains('edit')) return;
  const m=$('.mbody[data-goal]'); if(!m) return;
  const g=goalById(m.dataset.goal); if(!g) return;
  checkpoint('that rename');
  saveGoalFields(g);
  render();
});
$('#modalRoot').addEventListener('keydown',e=>{
  const cl=e.target.classList;
  if(e.key==='Enter' && cl && cl.contains('newin')){ e.preventDefault(); newInAct(e.target); return; }
  if(e.key==='Escape' && cl && cl.contains('newin') && e.target.value){ e.preventDefault(); e.target.value=''; return; }
  // Enter anywhere in an inline row commits that row rather than doing nothing
  if(e.key==='Enter' && e.target.closest && e.target.closest('.addrow')){
    const b=$('.btn.primary',e.target.closest('.addrow')) || $('[data-ge$="-add"]',e.target.closest('.addrow'));
    if(b){ e.preventDefault(); geAct(b.dataset.ge,b); return; }
  }
  if(e.key==='Enter' && cl && cl.contains('edit')){ e.preventDefault(); e.target.blur(); }
  // space or enter on a subtask checkbox, for keyboard users
  if((e.key===' '||e.key==='Enter') && e.target.classList && e.target.classList.contains('subchk')){
    e.preventDefault(); geAct('sub-toggle',e.target);
  }
});
}

/* what each action is called when it shows up in the undo tooltip */
export const ACT_LABEL={
  'dn-save':'that new step', 'ev-save':'that event', 'ev-del':'deleting that event',
  'pf-save':'those settings', 'cv-save':'that conversion',
  save:'those goal edits', del:'deleting that goal', 'thread-add':'that new thread',
  'thread-del':'removing that thread', addstep:'that new step', complete:'completing that step',
  sched:'that scheduling', block:'blocking that thread', unblock:'unblocking that thread',
  fire:'activating that goal', 'branch-add':'that branch', 'branch-del':'removing that branch',
  'backlog-add':'that backlog item', 'backlog-del':'removing that backlog item',
  'backlog-up':'that reorder', 'backlog-down':'that reorder',
  'sub-add':'that subtask', 'sub-del':'removing that subtask',
  'sub-up':'that reorder', 'sub-down':'that reorder', 'rename':'that rename',
  'entry-add':'that pipeline entry', 'ev-skip':'skipping that occurrence',
  'pf-forget':'forgetting the learned types', finish:'completing that goal',
  'g-connect':'connecting Google Calendar', 'g-off':'disconnecting Google Calendar',
  'g-sync':'that sync'
};

export function uiAct(a,btn){
  // the dialog's own callback owns the checkpoint, so don't take a vague one here
  if(a==='confirm-yes'){ const cb=takeConfirmCb(); closeModal(); if(cb) cb(); return; }
  checkpoint(ACT_LABEL[a]);
  if(a==='dn-save'){
    const g=goalById(btn.dataset.g), t=threadById(btn.dataset.g,btn.dataset.t);
    const v=$('#dnStep').value.trim(); if(!v){toast('Name the step.');return;}
    const s=newStep(v,{quadrant:$('#dnQuad').value}); t.steps.push(s); touchThread(t);
    const d=$('#dnDate').value;
    if(d){ const tm=$('#dnTime').value.split(':'); CAL.anchor(g,t,s,d,+tm[0]*60+ +tm[1],60); }
    save(); closeModal(); render(); toast('Thread stays live.');
  }
  if(a==='dn-block'){ closeModal(); toast('Mark it blocked from the goal card.'); }
  if(a==='ev-save'){
    const id=btn.dataset.id;
    const e = id?masterEvent(id):newEvent();     // edits always land on the stored master
    if(!e){ closeModal(); return; }
    const wasKey=e.dateKey;
    e.title=$('#evT').value.trim()||'Untitled';
    e.dateKey=$('#evD').value||today();
    e.allDay=$('#evA').checked;
    if(!e.allDay){ const t=$('#evS').value.split(':'); e.start=+t[0]*60+ +t[1]; e.dur=+$('#evL').value||60; }
    else { e.start=0; e.dur=1440; }
    if($('#evR')){
      const every=+$('#evR').value||0, until=$('#evU').value||null;
      e.recur = every ? {every, until} : null;
      if(!e.recur) e.skips=[];
      if(e.dateKey!==wasKey) e.skips=[];          // series moved; old exceptions no longer mean anything
    }
    if(!id) addEvent(e);
    save(); closeModal(); render();
    const L=loadState(e.dateKey);
    if(L.over) toast(fmtDate(e.dateKey)+' is now '+hrs(L.mins)+' against a '+hrs(L.budget)+' day.');
  }
  if(a==='ev-del'){ removeEvent(btn.dataset.id); closeModal(); render(); }
  if(a==='ev-skip'){ skipOccurrence(btn.dataset.id); closeModal(); render(); toast('Occurrence skipped.'); }
  if(a==='pf-save'){
    const m=DB.meta;
    m.checkinMode=$('#pfMode').value; m.checkinDow=+$('#pfDow').value; m.checkinEveryDays=+$('#pfN').value||7;
    m.projects=$('#pfProj').value.split(',').map(s=>s.trim()).filter(Boolean);
    if($('#pfBudget')) m.dayBudgetMins=+$('#pfBudget').value||240;
    gReadPrefs();
    save(); closeModal(); render(); toast('Settings saved.');
  }
  if(a==='pwa-install'){
    doInstall().then(out=>{
      if($('.modal')) openPrefs();
      toast(out==='accepted'?'Installing \u2014 Ply will open on its own.'
        : out==='unavailable'?'Your browser hasn\'t offered to install Ply here.'
        : 'Left it in the browser.');
    });
    return;
  }
  if(a==='pwa-later'){ DB.meta.installHidden=true; save(); renderInstallBar(); return; }
  if(a==='notif-toggle'){
    if(notifWanted()){ notifDisable(); if($('.modal')) openPrefs(); toast('Notifications off.'); return; }
    notifEnable().then(p=>{
      if($('.modal')) openPrefs();
      toast(p==='granted'?'Notifications on \u2014 steps, hard signals and the check-in.'
        : p==='denied'?'Your browser blocked them. The ribbon still says everything they would have.'
        : p==='unsupported'?'This browser has no Notifications API.'
        : 'Not now, then.');
    });
    return;
  }
  if(a==='pf-forget'){
    if(!armConfirm('pf-forget')) return;      // Settings is open, so arm the button rather than stack a dialog
    DB.meta.learned=[]; save(); openPrefs(); toast('Forgotten — back to the rules alone.');
  }
  if(a==='g-connect'){
    gReadPrefs(); save();
    toast('Opening Google sign-in\u2026');
    gConnect().then(acct=>{ openPrefs(); render(); toast(acct?('Connected as '+acct+'.'):'Google Calendar connected.'); })
              .catch(err=>{ setGErr(err.message); openPrefs(); toast(err.message||'Could not connect.'); });
  }
  if(a==='g-sync'){
    gFlush().then(()=>gSync({reason:'manual'}))
      .then(()=>{ openPrefs(); toast('Calendar synced.'); })
      .catch(err=>toast(err.message||'Sync failed.'));
  }
  if(a==='g-off'){
    if(!armConfirm('g-off')) return;          // Settings is open: arm in place rather than stack a dialog
    gDisconnect(); openPrefs(); render(); toast('Disconnected — your schedule stayed put, as local events.');
  }
  if(a==='cv-save'){
    const src=goalById(btn.dataset.id);
    const title=$('#cvT').value.trim(); if(!title){toast('Phrase the goal.');return;}
    const forced=$('#cvType').value||undefined;
    if(forced) learnType(title,forced);
    const cls=classify(title,{force:forced});
    const g=buildGoalFrom(title,cls);
    g.why=$('#cvWhy').value; g.notes=$('#cvNotes').value;
    g.origin={fromGoalId:src.id,kind:'decision'};
    addGoal(g);
    finishGoal(src,'converted into a goal'); src.gates=[];
    logIt('converted',{goalId:g.id,text:'from decision: '+src.title});
    save(); closeModal(); render(); openGoal(g.id);
  }
}

export function geAct(a,btn){
  checkpoint(ACT_LABEL[a]);
  const gid=$('.mbody[data-goal]').dataset.goal, g=goalById(gid);
  const t=btn.dataset.t?threadById(gid,btn.dataset.t):null;
  switch(a){
    case 'save': saveGoalFields(g); disarm(); closeModal(); render(); toast('Saved.'); return;
    case 'del':
      if(!armConfirm('del:'+gid)) return;          // first click arms the button, second deletes
      deleteGoal(gid); closeModal(); render(); toast('Deleted — ⌘Z to undo.'); return;
    case 'finish':
      saveGoalFields(g); finishGoal(g); save(); disarm(); closeModal(); render();
      toast('Done — it moves to Completed, not into thin air.'); return;
    case 'convert': saveGoalFields(g); closeModal(); openConvert(g); return;
    case 'thread-add': saveGoalFields(g);
      g.threads.push(newThread({name:'Thread '+(g.threads.length+1), rel:'parallel'})); break;
    case 'thread-del':
      if(g.threads.length<2){ toast('A goal needs at least one thread.'); return; }
      if(!armConfirm('thread-del:'+t.id)) return;
      g.threads=g.threads.filter(x=>x.id!==t.id); break;
    case 'complete':{ const s=t.steps.find(x=>x.id===btn.dataset.s);
      const r=completeStep(g,t,s); refreshGoal(gid); render();
      if(r.needsDefine&&r.reason!=='branch') openDefineNext(g,t);
      return; }
    // scheduling opens an inline row rather than two chained browser prompts
    case 'sched': saveGoalFields(g); GEROW={kind:'sched', id:btn.dataset.s}; refreshGoal(gid); return;
    case 'sched-cancel': GEROW=null; refreshGoal(gid); return;
    case 'sched-save':{
      const s=t.steps.find(x=>x.id===btn.dataset.s); if(!s){GEROW=null;break;}
      const d=$('.schd').value; if(!d){ toast('Pick a date.'); return; }
      if($('.schall').checked){ const ev=CAL.anchor(g,t,s,d,0,1440); ev.allDay=true; }
      else { const p=($('.schtm').value||'19:00').split(':'); CAL.anchor(g,t,s,d,+p[0]*60 + +(p[1]||0),45); }
      touchThread(t); GEROW=null;
      { const L=loadState(d); if(L.over) toast(fmtDate(d)+' is now '+hrs(L.mins)+' against a '+hrs(L.budget)+' day.'); }
      break; }

    case 'block': saveGoalFields(g); GEROW={kind:'block', id:t.id}; refreshGoal(gid); return;
    case 'block-cancel': GEROW=null; refreshGoal(gid); return;
    case 'block-save':{
      const who=($('.blockwho')||{value:''}).value.trim();
      t.status='blocked'; t.blockedOn=who||'someone'; t.blockedSince=new Date().toISOString();
      logIt('blocked',{goalId:g.id,threadId:t.id,text:t.blockedOn}); GEROW=null; break; }
    case 'unblock': t.status='active'; t.blockedOn=''; t.blockedSince=null; touchThread(t); break;
    case 'fire': g.threads.forEach(x=>{if(x.status==='dormant'){x.status='active';touchThread(x);}});
      { const th=g.threads[0]; if(th&&!currentStep(th)) th.steps.push(newStep('First move on '+shortName(g),{auto:true})); }
      g.gates=(g.gates||[]).filter(x=>x.kind!=='trigger'); break;
    case 'branch-add':{
      const c=($(`.brif[data-t="${t.id}"]`)||{value:''}).value.trim();
      const nx=($(`.brthen[data-t="${t.id}"]`)||{value:''}).value.trim();
      if(!c||!nx){ toast('Both halves of the branch, please.'); return; }
      t.branches.push({condition:c,next:nx}); t.rel='conditional'; break; }
    case 'branch-del': t.branches.splice(+btn.dataset.i,1); break;
    case 'backlog-del': g.backlog.splice(+btn.dataset.i,1); break;
    case 'backlog-up':   if(!moveItem(g.backlog,+btn.dataset.i,-1)) return; break;
    case 'backlog-down': if(!moveItem(g.backlog,+btn.dataset.i, 1)) return; break;

    /* --- subtasks --- */
    case 'sub-del':{
      const f=findStep(btn.dataset.s); if(!f) return;
      f.step.subs=subs(f.step).filter(x=>x.id!==btn.dataset.sub); break; }
    case 'sub-up': case 'sub-down':{
      const f=findStep(btn.dataset.s); if(!f) return;
      if(!moveItem(f.step.subs, +btn.dataset.i, a==='sub-up'?-1:1)) return; break; }
    case 'sub-toggle':{
      // routed through toggleSub so the last tick closes the step the normal way
      const r=toggleSub(g.id, btn.dataset.t, btn.dataset.s, btn.dataset.sub);
      refreshGoal(gid); render();
      if(r.completed){
        if(r.needsDefine && r.reason!=='branch') openDefineNext(g, threadById(gid,btn.dataset.t));
        else toast('Last one — step closed.'+(r.next?' Next: '+r.next.title:''));
      }
      return; }
  }
  disarm(); save(); refreshGoal(gid); render();
}

/* ---------------- prefs / menu ---------------- */
export function openPrefs(){
  const m=DB.meta;
  openModal(`<h3>Settings<button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody">
      <div class="sec"><h4>Check-in cadence</h4>
        <label class="fld"><span>Trigger</span><select id="pfMode">
          <option value="day" ${m.checkinMode==='day'?'selected':''}>Fixed weekday</option>
          <option value="elapsed" ${m.checkinMode==='elapsed'?'selected':''}>Every N days since the last one</option></select></label>
        <div class="row">
          <label class="fld"><span>Weekday</span><select id="pfDow">${DOWS.map((d,i)=>
            `<option value="${i}" ${i===m.checkinDow?'selected':''}>${d[0].toUpperCase()+d.slice(1)}</option>`).join('')}</select></label>
          <label class="fld"><span>Every N days</span><input type="number" id="pfN" value="${m.checkinEveryDays}" min="1"></label>
        </div>
        <div class="tiny muted">Last check-in: ${m.lastCheckin?fmtDate(m.lastCheckin):'never'}</div></div>
      <div class="sec"><h4>Projects</h4>
        <input type="text" id="pfProj" value="${esc((m.projects||[]).join(', '))}" placeholder="Plumbline, ...">
        <div class="tiny muted" style="margin-top:6px">Naming a project here makes capture classify mentions of it as milestone-type.</div></div>

      <div class="sec"><h4>Daily capacity</h4>
        <label class="fld"><span>A realistic day holds</span>
          <select id="pfBudget">${[120,180,240,300,360,480].map(n=>
            `<option value="${n}" ${n===dayBudget()?'selected':''}>${hrs(n)}</option>`).join('')}</select></label>
        <div class="tiny muted" style="margin-top:6px">Drives the load bars in Day and Week, and the dates the
          check-in suggests &mdash; it fills the first day with room rather than the emptiest one.
          All-day items don't count against it.</div></div>

      <div class="sec"><h4>Learned type corrections</h4>
        ${(m.learned||[]).length
          ? `<div class="tiny muted">${m.learned.length} pattern${m.learned.length>1?'s':''} remembered from check-in
              answers and manual retypes. Capture marks a reading learned from these with a dot.</div>
             <div class="learnlist">${m.learned.slice(-8).reverse().map(e=>
               `<div><span class="pill tiny">${TYPE[e.type]?TYPE[e.type].label:e.type}</span>
                 <span class="muted">${esc(e.terms.slice(0,6).join(' · '))}</span>${e.n>1?` <span class="tiny muted">&times;${e.n}</span>`:''}</div>`).join('')}</div>
             <button class="btn sm ${ARMED==='pf-forget'?'danger':''}" data-ui="pf-forget" style="margin-top:8px"
            >${armLabel('pf-forget','Forget all','Really forget all '+m.learned.length+'?')}</button>`
          : `<div class="tiny muted">Nothing learned yet. Correcting a goal's type &mdash; in the check-in or the goal
              editor &mdash; teaches the classifier to read similar phrases the same way next time.</div>`}</div>
      <div class="sec"><h4>Notifications</h4>
        ${notifPrefsHTML()}</div>
      <div class="sec"><h4>Install</h4>
        ${installPrefsHTML()}</div>
      <div class="sec"><h4>Google Calendar</h4>
        ${gPrefsHTML()}</div>
      ${MEMONLY?'<div class="sec" style="border-color:#5a2b2b"><b>Storage unavailable</b><div class="tiny">This session only. Export before closing.</div></div>':''}
    </div>
    <div class="mfoot"><span class="spacer"></span><button class="btn primary" data-ui="pf-save">Save</button></div>`);
}

/* The Settings panel for the provider. Kept out of openPrefs() because it has
   three quite different states to say plainly: this page can't authenticate at
   all, there's no client id yet, or it's connected and here's to whom. */

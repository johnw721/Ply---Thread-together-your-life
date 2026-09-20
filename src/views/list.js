import { TYPE } from '../types.js';
import { CARDSUBS, dayStripHTML } from '../components/card.js';
import { hushed, subProgress, subs } from '../engine.js';
import { DB, currentStep, doneGoals, eventById, liveGoals } from '../store.js';
import { daysBetween, dkey, esc, fmtDateY, fmtFull, relDays, today } from '../util.js';

/* ================= LIST =================
   Day, Week and Quarter are all altitudes over a calendar. This one isn't — it's the
   flat answer to "what have I actually got on", one row per goal, filtered by type.
   It reads the same state as everything else and adds no new concepts: the row shows
   the goal's live step, its slot and its checklist, so anything you can see here you
   can act on here. */
export const listHidden = ()=> new Set((DB.meta.listHidden||[]).filter(x=>!!TYPE[x]));

/* what a goal is waiting on, in one phrase — the same conditions signals() uses */
export function goalState(g){
  const live=g.threads.filter(t=>t.status!=='done');
  const blocked=live.find(t=>t.status==='blocked');
  // a blocked thread still has a step — it just can't move. Report both.
  if(blocked) return {k:'blocked', sev:'warn', text:'waiting on '+(blocked.blockedOn||'someone'),
                      thread:blocked, step:currentStep(blocked)};
  if(live.length && live.every(t=>t.status==='dormant'))
    return {k:'dormant', sev:'mute', text:g.trigger?('until '+g.trigger):'dormant'};
  const t=live.find(x=>x.status!=='dormant');
  if(!t) return {k:'dormant', sev:'mute', text:'dormant'};
  if(t.needsBranch) return {k:'branch', sev:'hard', text:'branch unresolved', thread:t};
  const s=currentStep(t);
  if(!s) return {k:'nostep', sev:'hard', text:'no next step', thread:t};
  if(hushed(g,t)) return {k:'hushed', sev:'mute', text:'gone quiet', thread:t, step:s};
  const ev=s.eventId?eventById(s.eventId):null;
  if(!ev && g.type!=='task') return {k:'unscheduled', sev:'warn', text:'unscheduled', thread:t, step:s};
  if(ev && ev.dateKey<today()) return {k:'slipped', sev:'hard', text:'slipped '+daysBetween(ev.dateKey,today())+'d', thread:t, step:s, ev};
  return {k:'ok', sev:'ok', text:ev?relDays(daysBetween(today(),ev.dateKey)):'', thread:t, step:s, ev};
}
export const STATE_ORDER={hard:0, warn:1, ok:2, mute:3};

export function viewList(){
  const hidden=listHidden();
  const archive=!!DB.meta.listDone;
  const all= archive ? doneGoals() : liveGoals();
  const counts={}; for(const g of all) counts[g.type]=(counts[g.type]||0)+1;

  const rows = archive
    ? all.filter(g=>!hidden.has(g.type)).map(g=>({g, st:null}))
    : all.filter(g=>!hidden.has(g.type))
        .map(g=>({g, st:goalState(g)}))
        .sort((a,b)=> STATE_ORDER[a.st.sev]-STATE_ORDER[b.st.sev]
          || (a.st.ev?a.st.ev.dateKey:'9999').localeCompare(b.st.ev?b.st.ev.dateKey:'9999')
          || a.g.title.localeCompare(b.g.title));

  const toggles=Object.keys(TYPE).map(k=>{
    const n=counts[k]||0, off=hidden.has(k);
    // reuse the quarter view's band palette so a type looks the same wherever it appears
    return `<button class="ltog ${TYPE[k].color||''} ${off?'off':''} ${n?'':'empty'}" data-ltype="${k}"
      aria-pressed="${!off}" title="${off?'Show':'Hide'} ${TYPE[k].label.toLowerCase()}">
      <span class="sw"></span>${TYPE[k].label}<span class="n">${n}</span></button>`;
  }).join('');

  const attention = archive ? 0 : rows.filter(r=>r.st.sev==='hard'||r.st.sev==='warn').length;

  const archiveBody = rows.map(({g})=>{
    const steps=g.threads.reduce((n,t)=>n+t.steps.filter(s=>s.done).length,0);
    return `<div class="lrow mute" data-goal="${g.id}">
      <span></span>
      <span class="ltype">${TYPE[g.type].label}</span>
      <span class="lttl done">${esc(g.title)}</span>
      <span class="lstep">${steps} step${steps===1?'':'s'} done${g.why?' · '+esc(g.why):''}</span>
      <span class="lstate">${g.doneAt?fmtDateY(dkey(new Date(g.doneAt))):'—'}</span>
      <button class="btn sm" data-reopen="${g.id}">reopen</button>
    </div>`;}).join('');

  const body = archive
    ? (rows.length ? archiveBody
       : `<div class="lempty">${hidden.size?'Every type is switched off.'
          :'Nothing finished yet. Completed goals are kept here rather than disappearing.'}</div>`)
    : rows.length ? rows.map(({g,st})=>{
    const s=st.step, p=s?subProgress(s):{any:false};
    const open=s&&CARDSUBS.has(s.id);
    // only a row with a live step can be dragged — there'd be nothing to schedule
    const drag = s ? ` data-step="${s.id}" data-thread="${st.thread.id}"` : '';
    return `<div class="lrow ${st.sev} ${s?'draggable':''}" data-goal="${g.id}"${drag}>
      ${ s ? '<span class="grip" title="Drag onto the calendar strip to schedule">&#8942;&#8942;</span>' : '<span></span>' }
      <span class="ltype">${TYPE[g.type].label}</span>
      <span class="lttl">${esc(g.title)}</span>
      <span class="lstep">${ s ? esc(s.title)
        : st.k==='dormant' ? '<span class="muted">&mdash;</span>'
        : '<span class="overtxt">needs a next step</span>' }</span>
      <span class="lstate ${st.sev}">${esc(st.text)}</span>
      ${ p.any ? `<span class="pill tiny subpill ${p.done===p.total?'full':''}" data-act="subs" data-step="${s.id}"
           title="${open?'Hide':'Show'} subtasks">${p.done}/${p.total} ${open?'&#9650;':'&#9660;'}</span>`
        : '<span></span>' }
      ${ open ? `<div class="lsubs">${subs(s).map(x=>
          `<div class="subline ${x.done?'done':''}" data-step="${s.id}" data-sub="${x.id}" data-thread="${st.thread.id}" data-goal="${g.id}">
             <span class="subchk ${x.done?'on':''}" data-act="sub" data-step="${s.id}" data-sub="${x.id}"
               data-goal="${g.id}" data-thread="${st.thread.id}" role="checkbox" aria-checked="${x.done}" tabindex="0">${x.done?'&#10003;':''}</span>
             <span class="x">${esc(x.title)}</span><span class="grip subgrip" title="Drag onto the calendar to schedule this step">&#8942;&#8942;</span></div>`).join('')}</div>` : '' }
    </div>`;
  }).join('')
  : `<div class="lempty">${hidden.size?'Every type is switched off.':'Nothing active. Capture something.'}</div>`;

  const k=DB.meta.cursor;
  const nDone=DB.goals.filter(g=>g.status==='done').length;
  return `<div class="viewhead">
      <h2>${archive?'Completed':'Everything'}</h2>
      <span class="sub">${rows.length} of ${all.length} goal${all.length===1?'':'s'}${
        attention?` &middot; <span class="overtxt">${attention} need${attention===1?'s':''} attention</span>`:''}</span>
      <div class="spacer" style="flex:1"></div>
      <div class="nav">${hidden.size?'<button class="btn sm" data-ltype="*">Show all types</button>':''}
        ${archive?'':`<button class="btn sm" data-nav="-1">&larr;</button>
        <button class="btn sm" data-nav="0">Today</button>
        <button class="btn sm" data-nav="1">&rarr;</button>`}
      </div>
    </div>
    ${ archive ? '' : `<div class="lbl striplbl"><span>${k===today()?'Today':fmtFull(k)}</span>
      <span class="tiny muted">drag a row onto the strip to schedule it</span></div>
    ${dayStripHTML(k,{drop:true})}` }
    <div class="ltogs">${toggles}
      <button class="ltog done ${archive?'':'off'}" data-listdone="1" aria-pressed="${archive}"
        title="${archive?'Back to live goals':'Show completed goals'}">
        <span class="sw"></span>${archive?'Live goals':'Completed'}<span class="n">${archive?liveGoals().length:nDone}</span></button>
    </div>
    <div class="lrows">${body}</div>`;
}


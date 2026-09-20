import { listHidden } from './views/list.js';
import { budget } from './budget.js';
import { SCHEMA } from './schema.js';

import { TYPE } from './types.js';

import { firstStepFor, shortName, subs } from './engine.js';
import { gEnqueue, gqueue } from './google.js';
import { bus } from './bus.js';
import { $, addDays, daysBetween, toast, today, uid } from './util.js';

/* ===================== [SECTION: STORE] ===================== */
export const KEY='ply.v1';
export const LEGACY_KEY='thread.v1';   // the app was called Thread until it wasn't
export let DB = null;
/* undo(), import, the demo seed and "erase everything" all REPLACE the object
   graph rather than mutating it, and an ES module binding can only be assigned
   by the module that owns it. Hence a setter rather than a bare export. */
export function setDB(d){ DB = d; return DB; }
export let MEMONLY = false;   // set if localStorage is unavailable (sandboxed preview)

export function blankDB(){
  return {
    v:1, schema:SCHEMA,
    goals:[],
    events:[],              // calendar events, incl. step anchors
    log:[],                 // follow-through log
    meta:{
      lastCheckin:null,     // dateKey
      checkinDow:0,         // 0=Sun ... 6=Sat  (fixed-day cadence; see prefs)
      checkinMode:'day',    // 'day' = fixed weekday | 'elapsed' = every N days
      checkinEveryDays:7,
      checkinProgress:null, // {dateKey,i,touched} — resume a half-finished session
      projects:['Plumbline'],// known project names, feeds milestone auto-classify
      snoozed:[],           // [{k:'<kind>:<threadId>', until:dateKey}] — muted ribbon signals
      learned:[],           // [{terms:[],type,n}] — type corrections the classifier reuses
      dayBudgetMins:240,    // what a realistic day holds; drives the load bars + scheduling
      listHidden:[],        // goal types toggled off in the List view
      listDone:false,       // show the completed archive instead of live goals
      budget:{              // weekly money, split across categories (allocation, not a ledger)
        weekly:0,
        cats:[]             // [{id,name,amount,goalId}] — goalId may point at a threshold goal
      },
      zoom:'day',
      cursor:null,          // dateKey the views are centred on
      google:{              // the Google Calendar provider's settings (see the GOOGLE section)
        enabled:false,      // false = local provider, which is also the offline cache
        clientId:'',        // overrides the build-time default; public by design, not a secret
        calendarId:'primary',
        account:null        // the signed-in address, for Settings to name
      },
      gqueue:[],            // writes waiting on the network: [{id,op,localId,gcalId,at,tries}]
      /* local notifications. Off until Settings turns them on, and no schema bump:
         migrate() backfills anything blankDB() grows, so an older file simply
         arrives with them off, which is the right default anyway. */
      notify:false,         // the user's answer, separate from the browser's permission
      notifSent:[],         // [{k,ts}] — what has already fired, so a reload doesn't repeat it
      sigHardSince:{},      // {signalKey: iso} — when each hard signal first turned hard
      installHidden:false   // the install hint was dismissed; don't bring it back
    }
  };
}

/* ---------- schema + migration ----------
   `if(!d.goals) throw 0` was the whole of the old import validation, so a file from
   a newer build would half-load and quietly lose whatever it didn't understand.
   Everything entering the app — localStorage or an imported file — comes through here. */
export function migrate(d){
  if(!d || typeof d!=='object' || !Array.isArray(d.goals))
    return {ok:false, msg:'That file is not a Ply export.'};
  const from = d.schema || d.v || 1;
  if(from > SCHEMA)
    return {ok:false, msg:'That export is from a newer version of Ply (schema '+from+'). Update before importing it.'};

  // fill in anything added since the file was written
  const b=blankDB();
  for(const k in b) if(!(k in d)) d[k]=b[k];
  d.meta=d.meta||{};
  for(const k in b.meta) if(!(k in d.meta)) d.meta[k]=b.meta[k];

  if(from < 2){                                   // 1 -> 2: repeating events, snoozes, learned types
    d.events=(d.events||[]).map(e=>Object.assign({recur:null,skips:[]},e));
    d.meta.snoozed=d.meta.snoozed||[];
    d.meta.learned=d.meta.learned||[];
  }
  if(from < 3){                                   // 2 -> 3: the weekly money budget
    d.meta.budget = d.meta.budget || {weekly:0, cats:[]};
  }
  if(from < 4){                                   // 3 -> 4: subtasks under a step
    for(const g of d.goals) for(const t of (g.threads||[])) for(const s of (t.steps||[]))
      if(!Array.isArray(s.subs)) s.subs=[];
  }
  if(from < 6){                                   // 5 -> 6: completed goals are kept, not hidden
    for(const g of d.goals) if(!('doneAt' in g)) g.doneAt = g.status==='done' ? (g.createdAt||null) : null;
  }
  if(from < 7){                                   // 6 -> 7: Google Calendar mirror rows
    for(const e of (d.events||[])) if(!('gcal' in e)) e.gcal=null;
    d.meta.google = d.meta.google || b.meta.google;
    d.meta.gqueue = d.meta.gqueue || [];
  }

  /* The mirror fields have to hold whatever the file claimed: a row with a broken
     gcal object would be treated as remote and then fail every write against it. */
  for(const e of (d.events||[])){
    const g=e.gcal;
    e.gcal = (g && typeof g==='object' && (g.id===null||typeof g.id==='string'))
      ? {id:g.id||null, etag:g.etag||null, updated:g.updated||null, cal:g.cal||'primary',
         own:!!g.own, status:g.status==='cancelled'?'cancelled':'confirmed',
         link:typeof g.link==='string'?g.link:null, pending:!!g.pending}
      : null;
    if(!e.gcal && e.src==='google') e.src='manual';   // a remote row with no remote id isn't one
  }
  d.meta.google = (d.meta.google && typeof d.meta.google==='object') ? d.meta.google : b.meta.google;
  d.meta.google = {
    enabled:!!d.meta.google.enabled,
    clientId:String(d.meta.google.clientId||''),
    calendarId:String(d.meta.google.calendarId||'primary'),
    account:d.meta.google.account?String(d.meta.google.account):null
  };
  d.meta.gqueue = (Array.isArray(d.meta.gqueue)?d.meta.gqueue:[])
    .filter(x=>x && typeof x==='object' && ['create','patch','delete'].includes(x.op) && x.localId)
    .map(x=>({id:x.id||uid(), op:x.op, localId:String(x.localId), gcalId:x.gcalId||null,
              at:x.at||new Date().toISOString(), tries:+x.tries||0}));
  d.meta.listDone = !!d.meta.listDone;

  // only real type names may hide a row; anything else would silently blank the list
  d.meta.listHidden = (Array.isArray(d.meta.listHidden)?d.meta.listHidden:[]).filter(x=>!!TYPE[x]);

  // a step without a usable subs array would break every reader below
  for(const g of d.goals) for(const t of (g.threads||[])) for(const s of (t.steps||[]))
    s.subs = (Array.isArray(s.subs)?s.subs:[]).filter(x=>x&&typeof x==='object')
      .map(x=>({id:x.id||uid(), title:String(x.title||'Untitled'), done:!!x.done, doneAt:x.doneAt||null}));
  // shapes that must hold whatever the file claimed
  d.meta.budget = d.meta.budget || {weekly:0, cats:[]};
  d.meta.budget.weekly = +d.meta.budget.weekly || 0;
  d.meta.budget.cats = (d.meta.budget.cats||[]).filter(c=>c&&typeof c==='object')
    .map(c=>({id:c.id||uid(), name:String(c.name||'Untitled'), amount:+c.amount||0, goalId:c.goalId||null}));

  delete d.app; delete d.exportedAt;              // envelope fields, not state — don't let them accumulate
  d.schema=SCHEMA;
  return {ok:true, from};
}

export function load(){
  let adopted=false;
  try{
    let raw = localStorage.getItem(KEY);
    if(raw==null){
      // data saved when this was called Thread. Read it, keep it, and leave the old
      // key alone — an orphaned backup costs nothing and a lost history costs plenty.
      const old = localStorage.getItem(LEGACY_KEY);
      if(old!=null){ raw=old; adopted=true; }
    }
    DB = raw ? JSON.parse(raw) : null;
  }catch(e){ MEMONLY=true; DB=null; }
  if(!DB) DB = blankDB();
  const m=migrate(DB);
  if(!m.ok){ DB=blankDB(); toast('Stored data could not be read — starting clean.'); }
  if(!DB.meta.cursor) DB.meta.cursor = today();
  DB.meta.snoozed = (DB.meta.snoozed||[]).filter(x=>x && x.until > today());   // expired snoozes drop off
  if(adopted){ save(); toast('Carried your data over from Thread.'); }
  return DB;
}
/* ---------- per-render memo ----------
   activeItems() ran 4–8 times in a single render and eventById() linear-scanned
   DB.events for every step in the quarter view. Both are pure reads, and the DB
   cannot change during bus.render()'s synchronous body — so compute once there.

   PASS is null everywhere else on purpose. A cache that outlived the render would
   hand stale answers to anything that mutated the DB and then read back without
   saving, which is a bug waiting to happen rather than a speed-up worth having. */
export let PASS=null;
/* bus.render() owns the pass. It lives here because pass() does, and because a cache
   that outlived the render would hand stale answers to anything that mutated the
   DB and read back without saving. */
export function beginPass(){ PASS={}; }
export function endPass(){ PASS=null; }
export const pass=(k,fn)=> PASS ? ((k in PASS) ? PASS[k] : (PASS[k]=fn())) : fn();

export function save(){
  commitCheckpoint();
  if(MEMONLY) return;
  try{ localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch(e){ MEMONLY=true; toast('Storage unavailable — session only. Use Export to keep data.'); }
}

/* ---------- undo / redo ----------
   Whole-DB snapshots. checkpoint() is called at the top of a user action; it only
   lands on the stack if the action actually changed something, so cancelled
   prompts and no-op clicks never leave a dead entry. Commit is deferred to the
   next tick so one action that saves several times is still one undo step. */
export const UNDO=[], REDO=[], UNDO_MAX=25;
export let PENDING=null;

export function checkpoint(label){
  if(!DB || PENDING) return;                       // nested calls join the outer action
  PENDING={json:JSON.stringify(DB), label:label||'that change'};
  setTimeout(commitCheckpoint,0);
}
export function commitCheckpoint(){
  if(!PENDING) return;
  const p=PENDING; PENDING=null;
  if(JSON.stringify(DB)===p.json) return;          // nothing happened — don't stack a no-op
  UNDO.push(p); if(UNDO.length>UNDO_MAX) UNDO.shift();
  REDO.length=0;
  paintUndo();
}
/* view state is this tab's business, not the snapshot's — keep it across a restore */
export function restoreSnapshot(json){
  const view={zoom:DB.meta.zoom, cursor:DB.meta.cursor};
  DB=JSON.parse(json);
  DB.meta.zoom=view.zoom; DB.meta.cursor=view.cursor;
  PENDING=null;
  save(); bus.closeModal(); bus.resetTransientUI(); bus.render();
}
export function undo(){
  if($('.scrim')){ toast('Close this first, then undo.'); return; }
  if(!UNDO.length){ toast('Nothing to undo.'); return; }
  const e=UNDO.pop();
  REDO.push({json:JSON.stringify(DB), label:e.label});
  restoreSnapshot(e.json);
  toast('Undone: '+e.label);
}
export function redo(){
  if($('.scrim')){ toast('Close this first, then redo.'); return; }
  if(!REDO.length){ toast('Nothing to redo.'); return; }
  const e=REDO.pop();
  UNDO.push({json:JSON.stringify(DB), label:e.label});
  restoreSnapshot(e.json);
  toast('Redone: '+e.label);
}
export function paintUndo(){
  const u=$('#btnUndo'), r=$('#btnRedo'); if(!u) return;
  u.disabled=!UNDO.length; r.disabled=!REDO.length;
  u.title = UNDO.length ? 'Undo '+UNDO[UNDO.length-1].label : 'Nothing to undo';
  r.title = REDO.length ? 'Redo '+REDO[REDO.length-1].label : 'Nothing to redo';
}

/* ---------- other tabs ----------
   Two tabs each hold their own DB; without this the last save() silently wins.
   The storage event only fires in *other* tabs, so there's no echo to guard against. */
export let EXTERNAL=null;
/* closeModal() takes the deferred update once nothing is mid-edit. */
export function takeExternal(){ const d=EXTERNAL; EXTERNAL=null; return d; }
export function adoptExternal(d){
  const view={zoom:DB.meta.zoom, cursor:DB.meta.cursor};
  DB=d; DB.meta.zoom=view.zoom; DB.meta.cursor=view.cursor;
  UNDO.length=0; REDO.length=0; PENDING=null;   // our snapshots describe a history that no longer exists
  paintUndo(); bus.resetTransientUI(); bus.render();          // no save() — that would bounce the write back
  toast('Refreshed — another tab changed something.');
}
/* Registered from main.js rather than at import time, so importing the store in a
   test does not also wire a live listener onto the document. */
export function initStorageSync(){
window.addEventListener('storage', e=>{
  if(e.key!==KEY || !e.newValue) return;
  let d; try{ d=JSON.parse(e.newValue); }catch(_){ return; }
  if(!migrate(d).ok) return;
  if($('.scrim')){ EXTERNAL=d; toast('Another tab made changes — refreshing when you close this.'); return; }
  adoptExternal(d);
});
}

/* --- accessors --- */
export const goals      = ()=>DB.goals;
export const liveGoals  = ()=>DB.goals.filter(g=>g.status==='active');
/* Finished goals used to vanish from every view, which made completing something
   indistinguishable from deleting it — in an app whose whole point is follow-through.
   They're kept and shown, newest first. */
export const doneGoals  = ()=>DB.goals.filter(g=>g.status==='done')
                    .sort((a,b)=>String(b.doneAt||'').localeCompare(String(a.doneAt||'')));
export function finishGoal(g,why){
  g.status='done'; g.doneAt=new Date().toISOString();
  g.threads.forEach(t=>{ if(t.status!=='done') t.status='done'; });
  logIt('closed',{goalId:g.id, text:why||'completed'});
}
export function reopenGoal(g){
  g.status='active'; g.doneAt=null;
  g.threads.forEach(t=>{ if(t.status==='done') t.status='active'; });
  // a reopened goal must not come back dead — that's the rule everywhere else
  const t=g.threads[0];
  if(t && !currentStep(t)){ const s=firstStepFor(g,t,null); t.steps.push(s||newStep('Next move on '+shortName(g),{auto:true})); }
  touchThread(t||{});
  logIt('reopened',{goalId:g.id, text:g.title});
}
export const goalById   = id=>DB.goals.find(g=>g.id===id);
export function threadById(gid,tid){const g=goalById(gid);return g&&g.threads.find(t=>t.id===tid);}
export function findThread(tid){for(const g of DB.goals){const t=g.threads.find(x=>x.id===tid);if(t)return{goal:g,thread:t};}return null;}
export const eventIndex = ()=> pass('evmap',()=>{ const m=new Map(); for(const e of DB.events) m.set(e.id,e); return m; });
export function eventById(id){
  if(!id) return null;
  const i=String(id).indexOf('@');
  if(i<0) return (PASS ? eventIndex().get(id) : DB.events.find(e=>e.id===id)) || null;
  const m=masterEvent(id);
  return m ? occurrenceOf(m, String(id).slice(i+1)) : null;
}
export function currentStep(t){ return t.steps.find(s=>!s.done) || null; }
export function lastDoneStep(t){ const d=t.steps.filter(s=>s.done); return d[d.length-1]||null; }

/* --- factories --- */
export function newGoal(o={}){
  return Object.assign({
    id:uid(), title:'', type:'task', status:'active', doneAt:null,
    why:'',                                  // the reason — carried on decision→goal conversion
    notes:'',
    smart:{ outcome:'', metricName:'', metricUnit:'', target:null, current:0, deadline:null, deadlineSoft:false },
    trigger:'',                              // contingent-type
    stages:null,                             // pipeline-type
    backlog:[],                              // milestone-type
    cadenceDays:null,                        // silence-as-signal window; null = type default
    gates:[],                                // queued clarifying questions -> resolved in check-in
    threads:[],
    createdAt:new Date().toISOString(),
    origin:null                              // {fromGoalId, kind:'decision'} on conversion
  }, o);
}
export function newThread(o={}){
  return Object.assign({
    id:uid(), name:'Main', rel:'sequential',
    status:'active',                         // active | blocked | dormant | done
    blockedOn:'', blockedSince:null,
    branches:[],                             // conditional: [{condition, next}]
    steps:[], lastMovement:new Date().toISOString()
  },o);
}
export function newStep(title,o={}){
  return Object.assign({
    id:uid(), title, quadrant:'q2', done:false, doneAt:null,
    eventId:null, outcome:null, createdAt:new Date().toISOString(), auto:false,
    subs:[]            // one level of checklist under a step — see the SUBTASKS section
  },o);
}
export function newSub(title){ return {id:uid(), title:String(title||'').trim(), done:false, doneAt:null}; }
export function newEvent(o={}){
  return Object.assign({
    id:uid(), title:'', dateKey:today(), start:9*60, dur:60,
    src:'manual', goalId:null, threadId:null, stepId:null,
    recur:null,    // {every:<days>, until:<dateKey|null>} — manual events only, never step anchors
    skips:[],      // dateKeys of occurrences dropped out of the series
    /* the Google mirror. null on a purely local event; on a synced one it carries
       the remote id that makes undo, cross-tab sync and offline capacity work
       without the network being there. See the GOOGLE section. */
    gcal:null      // {id,etag,updated,cal,own,status,link,pending}
  },o);
}

/* --- log --- */
export function logIt(kind, o={}){
  DB.log.push(Object.assign({id:uid(), ts:new Date().toISOString(), kind}, o));
  if(DB.log.length>4000) DB.log.splice(0, DB.log.length-4000);
}
export function touchThread(t){ t.lastMovement = new Date().toISOString(); }

/* --- mutations --- */
export function addGoal(g){ DB.goals.push(g); logIt('created',{goalId:g.id,text:g.title}); save(); return g; }
export function deleteGoal(id){
  for(const e of DB.events) if(e.goalId===id && e.gcal && e.gcal.id) gEnqueue('delete',e);
  DB.events = DB.events.filter(e=>e.goalId!==id);
  DB.goals  = DB.goals.filter(g=>g.id!==id);
  save();
}
export function addEvent(e){ DB.events.push(e); save(); return e; }
export function removeEvent(id){
  const m=masterEvent(id); if(!m) return;
  /* every deletion path goes through here — the event modal, unanchoring, a goal
     being deleted — so this is the one place the remote delete has to be queued */
  if(m.gcal) gEnqueue('delete',m);
  if(m.stepId){ const f=findThread(m.threadId); if(f){const s=f.thread.steps.find(s=>s.id===m.stepId); if(s)s.eventId=null;} }
  DB.events = DB.events.filter(x=>x.id!==m.id); save();
}
/* drop a single occurrence out of a series without touching the rest */
export function skipOccurrence(id){
  const m=masterEvent(id); if(!m||!m.recur||!m.recur.every) return;   // every:0 would loop forever below
  const i=String(id).indexOf('@'); const k = i<0 ? m.dateKey : String(id).slice(i+1);
  if(k===m.dateKey){                       // skipping the head: walk the series forward one step
    let nk=addDays(m.dateKey,m.recur.every);
    while((m.skips||[]).includes(nk)) nk=addDays(nk,m.recur.every);
    if(m.recur.until && nk>m.recur.until){ removeEvent(m.id); return; }
    m.dateKey=nk;
  } else {
    m.skips=(m.skips||[]).concat(k);
  }
  save();
}
/* --- repeating events ----------------------------------------------------
   One stored master per series; occurrences are generated at read time. Only
   manual events repeat — a step anchor is a single commitment by definition, and
   cyclical goals re-anchor themselves in completeStep() instead. That keeps
   activeItems()/signals() untouched: they only ever see real, stored events. */
export function occursOn(e,k){
  if(!e.recur || !e.recur.every) return e.dateKey===k;
  if(k < e.dateKey) return false;
  if(e.recur.until && k > e.recur.until) return false;
  if(daysBetween(e.dateKey,k) % e.recur.every !== 0) return false;
  return !(e.skips||[]).includes(k);
}
/* the master's own date returns the real object, so mutations still stick */
export function occurrenceOf(e,k){
  return e.dateKey===k ? e : Object.assign({},e,{id:e.id+'@'+k, dateKey:k, master:e.id, virtual:true});
}
export function masterEvent(id){
  if(!id) return null;
  const i=String(id).indexOf('@');
  const key = i<0 ? String(id) : String(id).slice(0,i);
  return (PASS ? eventIndex().get(key) : DB.events.find(e=>e.id===key)) || null;
}
export function eventsOn(k){
  return DB.events.filter(e=>occursOn(e,k)).map(e=>occurrenceOf(e,k)).sort((a,b)=>a.start-b.start);
}

/* --- calendar adapter seam ---------------------------------------------
   Views and the engine only ever talk to CAL, never to DB.events directly. Two
   providers live behind it: `local`, which is manual entry and is also the
   offline cache, and `google`, which syncs the same rows against a real
   calendar. Both answer through eventsOn(), which is the whole reason the
   Google provider needed no second read path — see the GOOGLE section.
------------------------------------------------------------------------ */

export function exportJSON(){
  /* Foreign Google rows are a cache, not your data: they re-derive on the next
     sync, and an export you mail to yourself shouldn't carry your work calendar
     inside it. Ply-owned rows stay — they carry the step link. */
  const out=Object.assign({app:'ply', schema:SCHEMA, exportedAt:new Date().toISOString()}, DB,
    {events: DB.events.filter(e=>!e.gcal || !!e.stepId)});
  const blob = new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='ply-'+today()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
export function importJSON(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
  inp.onchange=()=>{ const f=inp.files[0]; if(!f)return;
    const r=new FileReader();
    r.onload=()=>{
      let d; try{ d=JSON.parse(r.result); }catch(e){ toast('That file is not valid JSON.'); return; }
      const m=migrate(d);
      if(!m.ok){ toast(m.msg); return; }
      checkpoint('that import');
      setDB(d); save(); bus.render();
      toast(m.from<SCHEMA ? 'Imported and upgraded from schema '+m.from+'.' : 'Imported.');
    };
    r.readAsText(f); };
  inp.click();
}


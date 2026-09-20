import { SCHEMA } from './schema.js';
import { ARMED, armLabel } from './components/dialogs.js';
import { findStep } from './checkin.js';
import { renderSignals } from './components/ribbon.jsx';
import { DB, MEMONLY, addEvent, masterEvent, newEvent, save } from './store.js';
import { $, addDays, dkey, esc, fmtDate, fmtTime, parseKey, toast, today, uid } from './util.js';
import { render } from './views/render.jsx';

/* ===================== [SECTION: GOOGLE] =====================
   A second CAL provider. One decision drives everything else here: Google is a
   *sync source into DB.events*, not a read-through. Every remote event lands as a
   mirror row, so eventsOn() still answers every read, loadOn() still counts the
   real calendar, and undo, cross-tab adoption and the entire offline story keep
   working untouched. A read-through provider would have needed a parallel path
   through all three.

   Two API facts shaped the rest:

   * syncToken cannot be combined with timeMin/timeMax (nor q, orderBy, updatedMin
     or privateExtendedProperty). So the token-minting full sync is unbounded and
     the window is applied locally as rows are stored — Google's own "filter
     client-side" guidance. Every incremental pull after that is tiny.
   * The browser token model has no refresh tokens, and a silent renewal can be
     eaten by a popup blocker because it isn't a user gesture. So a background poll
     that meets a 401 retries once silently and then parks in `stale`, queues its
     writes and puts a click-to-reconnect chip in the ribbon, rather than
     pretending it can recover on its own.

   Sync bookkeeping (the sync token, the last-sync stamp) lives in its own
   localStorage key rather than in DB. It is per-browser cursor state, not user
   data: keeping it out of DB means a poll that finds nothing changed writes
   nothing, which is what stops a five-minute timer from firing `storage` in every
   other tab and wiping their undo stacks.
------------------------------------------------------------------------ */
export const G_SCOPE = 'https://www.googleapis.com/auth/calendar.events email';
export const G_GIS   = 'https://accounts.google.com/gsi/client';
export const G_API   = 'https://www.googleapis.com/calendar/v3';
export const G_WHO   = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const G_SYNCKEY = 'ply.gcal.sync';        // {token,last} — per-browser, never exported
export const G_LOCKKEY = 'ply.gcal.leader';      // {tab,ts}
export const G_BACK_DAYS = 30, G_FWD_DAYS = 180; // the cached window: a quarter view plus headroom
export const G_POLL  = 5*60*1000;
export const G_LEASE = 90*1000;
export const G_MAXPAGES = 20;                    // a first sync past this falls back to windowed polling
export const G_TAB = Math.random().toString(36).slice(2,10);

/* The build-time default. A Vite `define` replaces the bare identifier; with no
   build step the <meta> tag is the no-config path, and the Settings field
   overrides both. A browser client id is public by design — there is nothing
   here that would be a secret if someone read it out of localStorage. */
export const G_BUILD_ID = (()=>{
  try{ if(typeof __PLY_GOOGLE_CLIENT_ID__!=='undefined') return String(__PLY_GOOGLE_CLIENT_ID__); }catch(_){}
  try{ const t=document.querySelector('meta[name="ply-google-client-id"]'); if(t) return String(t.content||''); }catch(_){}
  return '';
})();

export const gmeta  = ()=> (DB.meta.google = DB.meta.google || {enabled:false, clientId:'', calendarId:'primary', account:null});
export const gqueue = ()=> (DB.meta.gqueue = Array.isArray(DB.meta.gqueue) ? DB.meta.gqueue : []);
export const gCal   = ()=> gmeta().calendarId || 'primary';
export const gOn    = ()=> !!(DB && DB.meta && DB.meta.google && DB.meta.google.enabled);
export const gClientId = ()=> String(gmeta().clientId || G_BUILD_ID || '').trim();
export const gerr   = (kind,msg)=> Object.assign(new Error(msg||kind), {kind});

/* Google will not accept file:// (origin `null`) as an authorized JavaScript
   origin, so the offline single-file build cannot ever authenticate. Say so in
   Settings rather than letting the popup fail with a bare redirect_uri_mismatch. */
export function gOriginOK(){
  try{
    if(location.protocol==='https:') return true;
    return location.protocol==='http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }catch(_){ return false; }
}

/* --- per-browser sync cursor --- */
export function gCursor(){
  try{ return JSON.parse(localStorage.getItem(G_SYNCKEY)||'null') || {token:null,last:null}; }
  catch(_){ return {token:null,last:null}; }
}
export function gCursorSet(o){
  try{ localStorage.setItem(G_SYNCKEY, JSON.stringify(Object.assign(gCursor(),o))); }catch(_){}
}

/* --- auth ---------------------------------------------------------------- */
export let GTOK=null;          // {token,exp} — memory only, never persisted
export let GSTATE='off';       // off | ready | stale | offline | error
export let GIS=null;           // the GIS token client
export let GPEND=null;         // in-flight token request, shared by concurrent callers
export let GERR=null;
export function setGErr(v){ GERR=v; }
export let GISLOAD=null;

export function gLoadGIS(){
  try{ if(window.google && google.accounts && google.accounts.oauth2) return Promise.resolve(); }catch(_){}
  if(GISLOAD) return GISLOAD;
  return GISLOAD = new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=G_GIS; s.async=true; s.defer=true;
    s.onload=()=>res();
    s.onerror=()=>{ GISLOAD=null; rej(gerr('offline','Could not load Google sign-in.')); };
    document.head.appendChild(s);
  });
}

export function gTokenClient(){
  const id=gClientId();
  if(!id) throw gerr('config','No Google client id yet — add one in Settings.');
  if(!GIS || GIS.__plyId!==id){
    GIS = google.accounts.oauth2.initTokenClient({client_id:id, scope:G_SCOPE, callback:()=>{}});
    GIS.__plyId = id;
  }
  return GIS;
}

/* mode: '' silent renewal | 'consent' the interactive grant */
export function gRequestToken(mode){
  if(GPEND) return GPEND;
  GPEND = gLoadGIS().then(()=> new Promise((res,rej)=>{
    let settled=false;
    const c=gTokenClient();
    c.callback = r=>{
      if(settled) return; settled=true;
      if(r && r.access_token){
        GTOK={token:r.access_token, exp:Date.now()+((+r.expires_in||3600)*1000)-60000};
        GSTATE='ready'; GERR=null; res(GTOK);
      } else rej(gerr('auth',(r&&r.error_description)||'Google declined the token request.'));
    };
    c.error_callback = e=>{ if(settled) return; settled=true; rej(gerr('auth',(e&&e.message)||'Google sign-in was dismissed.')); };
    try{ c.requestAccessToken({prompt:mode||''}); }
    catch(e){ settled=true; rej(gerr('auth',e.message)); return; }
    /* a silent renewal has no user gesture behind it and can be swallowed whole by
       a popup blocker — never leave the caller hanging on a promise that won't settle */
    if(!mode) setTimeout(()=>{ if(!settled){ settled=true; rej(gerr('auth','Silent renewal did not come back.')); } },12000);
  }));
  const done=()=>{ GPEND=null; };
  GPEND.then(done,done);
  return GPEND;
}

export async function gToken(){
  if(GTOK && GTOK.exp>Date.now()) return GTOK.token;
  const t=await gRequestToken('');
  return t.token;
}

export async function gConnect(){
  if(!gOriginOK()) throw gerr('origin','Google needs an https or localhost origin — this page is '+location.protocol);
  if(!gClientId()) throw gerr('config','Add your OAuth client id in Settings first.');
  try{ await gRequestToken(gmeta().account ? '' : 'consent'); }
  catch(e){ if(!gmeta().account) throw e; await gRequestToken('consent'); }
  const m=gmeta();
  m.enabled=true;
  try{
    const r=await fetch(G_WHO,{headers:{Authorization:'Bearer '+GTOK.token}});
    if(r.ok){ const who=await r.json(); m.account=who.email||m.account||null; }
  }catch(_){ /* the email scope is a nicety; the calendar still works without it */ }
  save();
  gStart();
  await gSync({full:true, reason:'connect'});
  return m.account;
}

/* Disconnecting must not cost you your schedule: Ply-owned rows stay as ordinary
   local events with their step links intact, and only the foreign cache goes. */
export function gDisconnect(){
  const tok = GTOK && GTOK.token;
  if(tok){ try{ google.accounts.oauth2.revoke(tok, ()=>{}); }catch(_){} }
  GTOK=null; GSTATE='off'; GERR=null;
  DB.events = DB.events.filter(e=>{
    if(!e.gcal) return true;
    if(e.stepId){ e.gcal=null; e.src='manual'; return true; }
    return false;
  });
  DB.meta.gqueue=[];
  const m=gmeta(); m.enabled=false; m.account=null;
  gCursorSet({token:null,last:null});
  gStop(); save();
}

/* --- the wire ------------------------------------------------------------ */
export const gWait = ms => new Promise(r=>setTimeout(r,ms));

export async function gapi(path,{method='GET',query=null,body=null,tries=0}={}){
  const tok=await gToken();
  const url=G_API+path+(query?('?'+new URLSearchParams(query)):'');
  let r;
  try{
    r=await fetch(url,{
      method,
      headers:Object.assign({Authorization:'Bearer '+tok}, body?{'Content-Type':'application/json'}:{}),
      body: body?JSON.stringify(body):undefined
    });
  }catch(_){
    if(GSTATE==='ready') GSTATE='offline';
    throw gerr('offline','No route to Google right now.');
  }
  if(r.status===401){
    GTOK=null;
    if(tries<1) return gapi(path,{method,query,body,tries:tries+1});
    GSTATE='stale'; throw gerr('auth','Google access expired — reconnect in Settings.');
  }
  if(r.status===410) throw gerr('gone','That sync token is no longer valid.');
  if(r.status===404) throw gerr('missing','That event is no longer in Google.');
  if(r.status===403 || r.status>=500){
    if(tries<3){ await gWait(400*Math.pow(2,tries)); return gapi(path,{method,query,body,tries:tries+1}); }
    throw gerr('api','Google refused the request ('+r.status+').');
  }
  if(!r.ok) throw gerr('api','Google returned '+r.status+'.');
  if(r.status===204) return null;
  try{ return await r.json(); }catch(_){ return null; }
}

/* --- mapping ------------------------------------------------------------- */
export const G_TZ = (()=>{ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'; }catch(_){ return 'UTC'; } })();

export function gISO(k,mins){
  const d=parseKey(k); d.setHours(0, Math.max(0,mins||0), 0, 0);   // Date normalises past midnight
  const p=n=>String(n).padStart(2,'0');
  const off=-d.getTimezoneOffset(), a=Math.abs(off);
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':00'
    +(off<0?'-':'+')+p(Math.floor(a/60))+':'+p(a%60);
}
export function gReadTime(v){
  if(!v) return null;
  if(v.date) return {allDay:true, dateKey:v.date, start:0, at:parseKey(v.date).getTime()};
  const d=new Date(v.dateTime||'');
  if(isNaN(d.getTime())) return null;
  return {allDay:false, dateKey:dkey(d), start:d.getHours()*60+d.getMinutes(), at:d.getTime()};
}
/* A Google resource -> the fields a mirror row carries. Recurring series arrive
   already expanded (singleEvents=true), so every instance is its own row with
   recur:null — occurrenceOf() must never see one. A multi-day all-day event is
   mirrored on its first day only; Ply's model has no multi-day event, and all-day
   items are capacity-exempt anyway. */
export function gToRow(ge, calId){
  const s=gReadTime(ge.start), e=gReadTime(ge.end);
  if(!s) return null;
  let dur;
  if(s.allDay) dur=1440;
  else if(e && !e.allDay) dur=Math.max(5, Math.round((e.at-s.at)/60000));
  else dur=60;
  const priv=(ge.extendedProperties&&ge.extendedProperties.private)||{};
  return {
    title:String(ge.summary||'(no title)'),
    dateKey:s.dateKey, start:s.start, dur, allDay:s.allDay,
    src:'google', recur:null, skips:[],
    goalId:priv.plyGoalId||null, threadId:priv.plyThreadId||null, stepId:priv.plyStepId||null,
    gcal:{id:ge.id, etag:ge.etag||null, updated:ge.updated||null, cal:calId,
          own:!!priv.plyStepId, status:ge.status||'confirmed',
          link:ge.htmlLink||null, pending:false}
  };
}
/* A mirror row -> the body Google wants. Built at flush time, never at enqueue
   time, because two callers mutate the event object after anchor() returns. */
export function gFromRow(e){
  const body={summary:e.title||'Untitled'};
  if(e.allDay){ body.start={date:e.dateKey}; body.end={date:addDays(e.dateKey,1)}; }
  else{
    body.start={dateTime:gISO(e.dateKey,e.start), timeZone:G_TZ};
    body.end  ={dateTime:gISO(e.dateKey,e.start+(e.dur||45)), timeZone:G_TZ};
  }
  if(e.stepId) body.extendedProperties={private:{
    plyStepId:String(e.stepId), plyGoalId:String(e.goalId||''), plyThreadId:String(e.threadId||''), plyV:String(SCHEMA)}};
  return body;
}

/* --- the window ---------------------------------------------------------- */
export const gWinFrom = ()=> addDays(today(), -G_BACK_DAYS);
export const gWinTo   = ()=> addDays(today(),  G_FWD_DAYS);
export const inWindow = k => k>=gWinFrom() && k<=gWinTo();
export const gDead    = e => !!(e && e.gcal && e.gcal.status==='cancelled');

/* --- the offline queue --------------------------------------------------- */
export const GDONE=new Set();   // jobs flushed this session — an undo must not resurrect them

export function gEnqueue(op,row){
  if(!gOn() || !row) return 0;
  const q=gqueue(), lid=row.id;
  if(op==='delete'){
    const neverSent = q.some(x=>x.localId===lid && x.op==='create');
    DB.meta.gqueue = q.filter(x=>x.localId!==lid);        // every pending op for this row is moot
    if(neverSent) return DB.meta.gqueue.length;           // it never reached Google; nothing to delete
    DB.meta.gqueue.push({id:uid(), op:'delete', localId:lid,
      gcalId:(row.gcal&&row.gcal.id)||null, at:new Date().toISOString(), tries:0});
    return DB.meta.gqueue.length;
  }
  if(row.gcal) row.gcal.pending=true;
  if(q.some(x=>x.localId===lid)) return q.length;         // already queued; the payload is read at flush
  q.push({id:uid(), op, localId:lid, gcalId:(row.gcal&&row.gcal.id)||null,
          at:new Date().toISOString(), tries:0});
  return q.length;
}
export const gPending = ()=> (DB&&DB.meta&&Array.isArray(DB.meta.gqueue)) ? DB.meta.gqueue.length : 0;

export let GFLUSH=null;
export function gFlush(){ return GFLUSH || (GFLUSH = gFlushRun().finally(()=>{GFLUSH=null;})); }

export async function gFlushRun(){
  if(!gOn()) return 0;
  let done=0;
  while(gqueue().length){
    const job=gqueue()[0];
    if(GDONE.has(job.id)){ gqueue().shift(); continue; }
    const row = job.op==='delete' ? null : DB.events.find(e=>e.id===job.localId);
    try{
      if(job.op==='delete'){
        if(job.gcalId) await gapi('/calendars/'+encodeURIComponent(gCal())+'/events/'+encodeURIComponent(job.gcalId),{method:'DELETE'});
      } else if(!row){
        /* the row went away under us (undo, or the goal was deleted) — drop the job */
      } else if(job.op==='create' || !row.gcal || !row.gcal.id){
        const r=await gapi('/calendars/'+encodeURIComponent(gCal())+'/events',{method:'POST', body:gFromRow(row)});
        row.src='google';
        row.gcal=Object.assign(row.gcal||{}, {id:r&&r.id, etag:(r&&r.etag)||null, updated:(r&&r.updated)||null,
          cal:gCal(), own:!!row.stepId, status:(r&&r.status)||'confirmed', link:(r&&r.htmlLink)||null, pending:false});
      } else {
        const r=await gapi('/calendars/'+encodeURIComponent(gCal())+'/events/'+encodeURIComponent(row.gcal.id),
          {method:'PATCH', body:gFromRow(row)});
        Object.assign(row.gcal, {etag:(r&&r.etag)||null, updated:(r&&r.updated)||null,
          status:(r&&r.status)||'confirmed', link:(r&&r.htmlLink)||row.gcal.link||null, pending:false});
      }
      GDONE.add(job.id); gqueue().shift(); done++; save();
    }catch(err){
      /* already gone in Google is a finished delete, not a failure */
      if(err.kind==='missing' || (err.kind==='gone' && job.op==='delete')){
        GDONE.add(job.id); gqueue().shift();
        if(row&&row.gcal) row.gcal.pending=false;
        save(); continue;
      }
      /* nothing deliverable right now: stop, keep the order, try again on reconnect */
      if(err.kind==='offline'||err.kind==='auth'||err.kind==='config'||err.kind==='origin'){ GERR=err.message; break; }
      job.tries=(job.tries||0)+1;
      if(job.tries>=5){ GERR=err.message; gqueue().shift(); save(); continue; }
      break;
    }
  }
  if(!gqueue().length && GERR) GERR=null;   // nothing outstanding, nothing to report
  if(done) render();
  return done;
}

/* --- sync ---------------------------------------------------------------- */
/* One tab syncs. Without this every tab polls, and each poll's save() fires
   `storage` in the others, whose adoptExternal() throws their undo stack away. */
export function gLease(){
  if(MEMONLY) return true;
  try{
    const now=Date.now();
    const cur=JSON.parse(localStorage.getItem(G_LOCKKEY)||'null');
    if(cur && cur.tab!==G_TAB && (now-cur.ts)<G_LEASE) return false;
    localStorage.setItem(G_LOCKKEY, JSON.stringify({tab:G_TAB, ts:now}));
    return true;
  }catch(_){ return true; }
}

export let GSYNC=null;
export function gSync(opts={}){
  if(!gOn()) return Promise.resolve({skipped:'off'});
  if(!gLease()) return Promise.resolve({skipped:'follower'});
  if(GSYNC) return GSYNC;
  GSYNC = gSyncRun(opts).finally(()=>{GSYNC=null;});
  return GSYNC;
}

export async function gSyncRun({full=false, reason='poll'}={}){
  await gFlush();                                  // our own writes land before we read back
  const cal=encodeURIComponent(gCal());
  let token = full ? null : gCursor().token;
  let page=null, next=null, pages=0;
  const items=[];
  do{
    const q = token
      ? {syncToken:token, singleEvents:'true', showDeleted:'true', maxResults:'2500'}
      : {singleEvents:'true', showDeleted:'true', maxResults:'2500'};
    if(page) q.pageToken=page;
    let r;
    try{ r=await gapi('/calendars/'+cal+'/events',{query:q}); }
    catch(err){
      if(err.kind==='gone'){ gCursorSet({token:null}); return gSyncRun({full:true, reason:'410'}); }
      GERR=err.message; renderSignals(); throw err;
    }
    items.push(...(r.items||[]));
    page=r.nextPageToken||null;
    next=r.nextSyncToken||next;
    /* a calendar with a decade of history would page forever on the first sync.
       Stop, keep what we have, and carry on with full window pulls instead. */
    if(++pages>=G_MAXPAGES){ page=null; next=null; }
  } while(page);

  const n=gApply(items,{cal:gCal(), replace:!token});
  gCursorSet({token:next||null, last:new Date().toISOString()});
  GSTATE='ready'; GERR=null;
  if(n){ save(); render(); } else { renderSignals(); }
  return {n, seen:items.length, incremental:!!token, reason};
}

/* Returns how many local rows actually changed, so a quiet poll writes nothing. */
export function gApply(items,{cal,replace}){
  let n=0;
  const seen=new Set();
  const byId=new Map();
  for(const e of DB.events) if(e.gcal && e.gcal.id) byId.set(e.gcal.id, e);

  for(const ge of items){
    if(!ge || !ge.id) continue;
    seen.add(ge.id);
    const cur=byId.get(ge.id);
    if(ge.status==='cancelled'){ n+=gCancel(cur)?1:0; continue; }
    const row=gToRow(ge,cal);
    if(!row){ n+=gCancel(cur)?1:0; continue; }
    if(!inWindow(row.dateKey)){ if(cur && !cur.stepId) n+=gDrop(cur)?1:0; continue; }
    if(!cur){ gAdopt(row); byId.set(ge.id, DB.events[DB.events.length-1]); n++; continue; }
    n+=gMerge(cur,row)?1:0;
  }

  if(replace){
    for(const e of DB.events.slice()){
      if(!e.gcal || !e.gcal.id || seen.has(e.gcal.id)) continue;   // a queued create has no id yet
      n += (inWindow(e.dateKey) ? gCancel(e) : gDrop(e)) ? 1 : 0;
    }
  }
  for(const e of DB.events.slice())
    if(e.gcal && !e.stepId && !inWindow(e.dateKey)) n+=gDrop(e)?1:0;
  return n;
}

/* Deleted in Google. A row that carries a step keeps its link and is tombstoned,
   so signals() raises "not on the calendar" instead of the app quietly
   unanchoring a commitment you never said you'd dropped. */
export function gCancel(e){
  if(!e) return false;
  if(e.stepId){
    if(e.gcal && e.gcal.status==='cancelled') return false;
    e.gcal=Object.assign(e.gcal||{}, {status:'cancelled', pending:false});
    return true;
  }
  return gDrop(e);
}
export function gDrop(e){
  if(!e) return false;
  const i=DB.events.indexOf(e);
  if(i<0) return false;
  DB.events.splice(i,1);
  return true;
}
export function gAdopt(row){
  const ev=addEvent(newEvent(Object.assign({},row)));
  /* an event Ply created on another device comes home and finds its step */
  if(row.stepId){
    const f=findStep(row.stepId);
    if(f){
      const held = f.step.eventId ? masterEvent(f.step.eventId) : null;
      if(!held || gDead(held) || held===ev) f.step.eventId=ev.id;
    }
  }
  return ev;
}
/* Conflict rules: remote wins for time and title, Ply wins for the step link.
   "Remote wins" means a change Ply did not originate — a re-anchor we haven't
   delivered yet is a local intent, not a stale read, so `pending` holds it. */
export function gMerge(cur,row){
  let changed=false;
  const pending = !!(cur.gcal && cur.gcal.pending);
  const newer = !cur.gcal || !cur.gcal.updated || !row.gcal.updated || row.gcal.updated > cur.gcal.updated;
  if(!pending && newer){
    for(const f of ['title','dateKey','start','dur','allDay'])
      if(cur[f]!==row[f]){ cur[f]=row[f]; changed=true; }
  }
  if(cur.stepId && !row.stepId){
    gEnqueue('patch',cur); changed=true;          // someone stripped our property — put it back
  } else if(!cur.stepId && row.stepId){
    cur.stepId=row.stepId; cur.goalId=row.goalId; cur.threadId=row.threadId; changed=true;
  }
  const g=cur.gcal||(cur.gcal={});
  if(g.status==='cancelled'){ g.status=row.gcal.status||'confirmed'; changed=true; }   // put back in Google
  g.etag=row.gcal.etag; g.updated=row.gcal.updated; g.link=row.gcal.link||g.link||null;
  g.own = g.own || row.gcal.own; g.cal = g.cal || row.gcal.cal;
  if(cur.src!=='google'){ cur.src='google'; changed=true; }
  return changed;
}

/* An event that lives in Google and isn't one of ours. Ply shows it and counts it
   against the day, but doesn't pretend to own it: it is edited where it was made. */
export const gForeign = e => !!(e && e.gcal && !e.stepId);

/* Settings writes straight into meta. Changing the calendar invalidates the sync
   cursor — a token is scoped to the collection that minted it. */
export function gReadPrefs(){
  const m=gmeta(), a=$('#pfGId'), b=$('#pfGCal');
  if(a) m.clientId=String(a.value||'').trim();
  if(b){
    const cal=String(b.value||'').trim()||'primary';
    if(cal!==m.calendarId){ m.calendarId=cal; gCursorSet({token:null}); }
  }
}

/* --- scheduling ---------------------------------------------------------- */
export let GTIMER=null, GWIRED=false;
export function gTick(){ if(!document.hidden) gSync({reason:'poll'}).catch(gNote); }
export function gWake(){ if(!document.hidden) gSync({reason:'focus'}).catch(gNote); }
export function gOnline(){ gFlush().then(()=>gSync({reason:'online'})).catch(gNote); }
export function gNote(err){ GERR=(err&&err.message)||String(err); try{ renderSignals(); }catch(_){} }

export function gStart(){
  if(!gOn()) return;
  if(!GWIRED){
    window.addEventListener('focus', gWake);
    document.addEventListener('visibilitychange', gWake);
    window.addEventListener('online', gOnline);
    GWIRED=true;
  }
  if(!GTIMER) GTIMER=setInterval(gTick, G_POLL);
}
export function gStop(){ if(GTIMER){ clearInterval(GTIMER); GTIMER=null; } }

/* --- the ribbon's own chips ---------------------------------------------
   These aren't goal-scoped, so they don't belong in signals() and must not be
   snoozeable: a queued write is a fact about the app, not a nag about a thread. */
export function gChips(){
  if(!gOn()) return [];
  const out=[];
  const n=gPending();
  if(n) out.push({cls:'', act:'gsync', text:n+' change'+(n>1?'s':'')+' waiting to sync'});
  if(GSTATE==='stale') out.push({cls:'hard', act:'gconnect', text:'Google access expired &mdash; reconnect'});
  else if(GERR && !n) out.push({cls:'mute', act:'gsync', text:'Calendar sync: '+esc(GERR)});
  return out;
}

export function gAct(a){
  if(a==='gsync'){
    toast('Syncing with Google\u2026');
    gFlush().then(()=>gSync({full:false, reason:'manual'}))
      .then(r=>toast(r && r.skipped==='follower' ? 'Another tab is syncing.' : 'Calendar synced.'))
      .catch(err=>toast(err.message||'Sync failed.'));
    return;
  }
  if(a==='gconnect'){
    gConnect().then(acct=>{ render(); toast(acct?('Connected as '+acct+'.'):'Google Calendar connected.'); })
              .catch(err=>{ GERR=err.message; renderSignals(); toast(err.message||'Could not connect.'); });
    return;
  }
  if(a==='gdisconnect'){
    gDisconnect(); render(); toast('Disconnected — your schedule stayed put, as local events.');
  }
}

export function gPrefsHTML(){
  const m=gmeta(), cur=gCursor();
  const id=gClientId(), fromBuild=!m.clientId && !!G_BUILD_ID;
  const field=`<label class="fld" style="margin-top:8px"><span>OAuth client id</span>
      <input type="text" id="pfGId" value="${esc(m.clientId||'')}"
        placeholder="${esc(G_BUILD_ID||'123-abc.apps.googleusercontent.com')}"></label>
    <label class="fld"><span>Calendar</span>
      <input type="text" id="pfGCal" value="${esc(m.calendarId||'primary')}" placeholder="primary"></label>
    <div class="tiny muted" style="margin-top:6px">${fromBuild
      ? 'Using the id this build ships with; type one here to override it.'
      : 'A browser client id is public by design &mdash; it is not a secret.'}
      See <b>Google Calendar</b> in the README for how to make one.</div>`;

  if(!gOriginOK()) return `<div class="tiny muted">Google will not accept
      <span class="mono">${esc(location.protocol)}</span> as an authorized JavaScript origin, so sync is off on this
      page. Run Ply from <span class="mono">http://localhost</span> (<span class="mono">npm run dev</span>) or an
      https origin. Everything else works exactly as it does here &mdash; the local provider <i>is</i> the offline cache.</div>`;

  if(!m.enabled) return `<div class="tiny muted">Source: <b>local (manual entry)</b>.
      Connecting reads your calendar into the day and week load, and puts every step you schedule
      onto it. Your goals stay here either way.</div>
    ${field}
    <button class="btn sm primary" data-ui="g-connect" style="margin-top:10px"
      ${id?'':'disabled title="Add a client id first"'}>Connect Google Calendar</button>`;

  const n=gPending();
  return `<div class="tiny muted">Connected${m.account?` as <b style="color:var(--text)">${esc(m.account)}</b>`:''},
      writing to <b style="color:var(--text)">${esc(m.calendarId||'primary')}</b>.
      <br>Last sync: ${cur.last?fmtDate(dkey(new Date(cur.last)))+' '+fmtTime(new Date(cur.last).getHours()*60+new Date(cur.last).getMinutes()):'not yet'}${
      n?` &mdash; <b style="color:var(--warn)">${n} change${n>1?'s':''} waiting</b>`:''}${
      GSTATE==='stale'?' &mdash; <b style="color:var(--bad)">access expired</b>':''}.</div>
    ${field}
    <div class="row" style="margin-top:10px">
      <button class="btn sm" data-ui="g-sync">Sync now</button>
      <button class="btn sm ${ARMED==='g-off'?'danger':''}" data-ui="g-off"
        >${armLabel('g-off','Disconnect','Really disconnect?')}</button>
    </div>
    <div class="tiny muted" style="margin-top:6px">Disconnecting keeps everything you've scheduled &mdash;
      your own events stay as local ones, and only the cached copy of the rest of your calendar goes.</div>`;
}


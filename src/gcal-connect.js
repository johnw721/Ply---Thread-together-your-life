import { ARMED, armConfirm, armLabel } from './components/dialogs.js';
import { openModal } from './components/modal.jsx';
import {
  G_BUILD_ID, GERR, GSTATE, gClientId, gConnect, gCursor, gCursorSet, gDisconnect,
  gFlush, gLoadGIS, gmeta, gOn, gOriginOK, gPending, gSync, setGErr
} from './google.js';
import { save } from './store.js';
import { $, dkey, esc, fmtDate, fmtTime, toast } from './util.js';
import { render } from './views/render.jsx';

/* ===================== [SECTION: GCAL CONNECT] =====================
   The one-place way to get Google Calendar connected.

   Before this, connecting meant: find the ⋮ menu, open Settings, scroll past five
   unrelated sections, paste an id you had to go and read the README to make, then
   press a button that was disabled until you did. Every step of it was correct and
   none of it was discoverable.

   This dialog is the same provider — gConnect(), gSync(), gDisconnect() are
   untouched — with the setup walked through in order, reachable from a button in
   the header that also says, at a glance, whether the calendar is connected.

   It has four faces, picked from state rather than navigated:
     origin  this page can't authenticate at all (file://) — say how to run it
     setup   no client id yet — what to do in Google Cloud, in order,
             with this page's own origin ready to copy, then the id field
     ready   there is an id — one button
     linked  connected — who, which calendar, last sync, sync now, disconnect
   ------------------------------------------------------------------ */

/* transient, never in DB */
let GC = { busy:false, err:null, editing:false };
export function gcReset(){ GC = { busy:false, err:null, editing:false }; }
export const gcState = ()=> GC;

export const GC_LINKS = {
  api:     'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  consent: 'https://console.cloud.google.com/apis/credentials/consent',
  creds:   'https://console.cloud.google.com/apis/credentials'
};

export function gcOrigin(){ try{ return location.origin; }catch(_){ return ''; } }

/* A pasted value, read the way a person would get it wrong. The client *secret*
   is the one that matters: it sits right next to the id on the same Google page,
   Ply never needs it, and it must never land in the page. */
export function gcCheckId(v){
  v = String(v||'').trim();
  if(!v) return {ok:false, level:'', msg:''};
  if(/^GOCSPX-/i.test(v)) return {ok:false, level:'bad',
    msg:'That’s the client <b>secret</b>. Ply only needs the client ID, and should never be given the secret.'};
  if(/\s/.test(v)) return {ok:false, level:'bad', msg:'A client ID has no spaces in it.'};
  if(/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v)) return {ok:true, level:'good', msg:'Looks right.'};
  return {ok:true, level:'warn',
    msg:'That doesn’t look like a client ID &mdash; they end in <span class="mono">.apps.googleusercontent.com</span>. You can still try it.'};
}

/* What to actually do about each way connecting can fail. */
export function gcHint(err){
  if(!err) return '';
  const k=err.kind, o=esc(gcOrigin());
  if(k==='auth') return `If no Google window appeared, allow pop-ups for this site and try again.
    If Google said <i>access blocked</i> or <i>app not verified</i>, add your address under
    <b>Test users</b> on the <a href="${GC_LINKS.consent}" target="_blank" rel="noopener">consent screen</a>.
    If it mentioned <i>origin</i> or <i>redirect_uri_mismatch</i>, <span class="mono">${o}</span> is missing
    from the client’s Authorized JavaScript origins.`;
  if(k==='offline') return 'Couldn’t reach Google. Check the connection and try again.';
  if(k==='config')  return 'Paste a client ID first.';
  if(k==='api')     return 'Google refused the request. Make sure the Google Calendar API is enabled for this project.';
  return '';
}

/* ---------- the header button ----------
   Hidden where connecting is impossible (file://) unless something is already
   connected, so the offline build doesn't carry a button that can only apologise. */
export function paintCalBtn(){
  const b=$('#btnCal'); if(!b) return;
  const on=gOn();
  const show = on || gOriginOK();
  b.classList.toggle('hidden', !show);
  if(!show) return;
  const n=gPending();
  let state='off', label='Connect calendar', title='Connect Google Calendar';
  if(on){
    const who=gmeta().account;
    if(GSTATE==='stale'){ state='bad'; label='Reconnect'; title='Google access expired — click to reconnect'; }
    else if(n || GERR){ state='warn'; label='Calendar'; title=n ? n+' change'+(n>1?'s':'')+' waiting to sync' : 'Calendar sync: '+GERR; }
    else { state='good'; label='Calendar'; title='Google Calendar'+(who?' — '+who:'')+' — connected'; }
  }
  b.dataset.state=state;
  b.title=title;
  b.setAttribute('aria-label', title);
  const l=b.querySelector('.long'); if(l) l.textContent=label;
}

/* ---------- the dialog ---------- */
export function openGConnect(){
  /* Loading GIS ahead of the click matters: the token popup has to open inside the
     click's user-activation window, and a cold script load eats into it. */
  if(gOriginOK() && !gOn()) gLoadGIS().catch(()=>{});
  openModal(gcHTML(), {nofocus: !!$('#gcBody')});
}
export const gcOpen = ()=> !!$('#gcBody');
function repaint(){ if(gcOpen()) openGConnect(); paintCalBtn(); }

function lastSync(){
  const l=gCursor().last; if(!l) return 'not yet';
  const d=new Date(l);
  return fmtDate(dkey(d))+' '+fmtTime(d.getHours()*60+d.getMinutes());
}

function stepHTML(n, title, body, done){
  return `<li class="gcstep${done?' done':''}"><span class="gcnum">${done?'&#10003;':n}</span>
    <div><div class="gcsttl">${title}</div>${body}</div></li>`;
}

export function gcFace(){
  if(gOn()) return 'linked';
  if(!gOriginOK()) return 'origin';
  if(gClientId() && !GC.editing) return 'ready';
  return 'setup';
}

export function gcHTML(){
  const m=gmeta(), face=gcFace(), origin=gcOrigin();
  const head=`<h3>Google Calendar<button class="btn ghost x" data-close aria-label="Close">&times;</button></h3>`;
  const errBox = GC.err ? `<div class="gcerr" role="alert"><b>${esc(GC.err.msg||'Could not connect.')}</b>
      ${gcHint(GC.err)?`<div class="tiny" style="margin-top:4px">${gcHint(GC.err)}</div>`:''}</div>` : '';
  const what=`<ul class="gcwhat">
      <li>Your calendar’s events show up in Day and Week, and count against the day’s load.</li>
      <li>Every step you schedule in Ply lands on your calendar, and moves when you move it.</li>
      <li>Your goals stay here. Disconnecting later keeps everything you scheduled.</li></ul>`;

  if(face==='origin') return `${head}
    <div class="mbody" id="gcBody" data-face="origin">
      <p class="wizsub" style="margin-top:0">Google won’t sign in from a page opened as
        <span class="mono">${esc(location.protocol)}</span> &mdash; it needs a web address it can recognise.</p>
      <div class="sec"><h4>To connect</h4>
        <div class="tiny">Run Ply with <span class="mono">npm run dev</span> and open
          <span class="mono">http://localhost:5173</span>, or use a deployed https copy.
          Everything else works here exactly as it does there.</div></div>
    </div>
    <div class="mfoot"><span class="spacer"></span><button class="btn" data-close>Close</button></div>`;

  if(face==='linked'){
    const n=gPending(), stale=GSTATE==='stale';
    return `${head}
    <div class="mbody" id="gcBody" data-face="linked">
      <div class="gcstatus" data-state="${stale?'bad':(n||GERR)?'warn':'good'}">
        <span class="gcdot"></span>
        <div><b>${stale?'Access expired':'Connected'}</b>${m.account?` as <b>${esc(m.account)}</b>`:''}
          <div class="tiny muted">Writing to <b style="color:var(--text)">${esc(m.calendarId||'primary')}</b>
            &middot; last sync ${esc(lastSync())}${n?` &middot; <b style="color:var(--warn)">${n} change${n>1?'s':''} waiting</b>`:''}</div></div>
      </div>
      ${stale?`<div class="tiny muted" style="margin:10px 0 0">Google sign-ins from a browser last about an hour.
        Changes you make meanwhile are queued, and go out as soon as you reconnect.</div>`:''}
      ${GERR && !stale?`<div class="tiny muted" style="margin-top:10px">Last problem: ${esc(GERR)}</div>`:''}
      ${errBox}
      <div class="tiny muted" style="margin-top:12px">Disconnecting keeps everything you’ve scheduled &mdash;
        your own events stay as local ones, and only the cached copy of the rest of your calendar goes.</div>
    </div>
    <div class="mfoot">
      <button class="btn ${ARMED==='gc-off'?'danger':''}" data-ui="gc-off">${armLabel('gc-off','Disconnect','Really disconnect?')}</button>
      <span class="spacer"></span>
      ${stale
        ? `<button class="btn primary" data-ui="gc-connect" ${GC.busy?'disabled':''}>${GC.busy?'Waiting for Google…':'Reconnect'}</button>`
        : `<button class="btn" data-ui="gc-sync" ${GC.busy?'disabled':''}>${GC.busy?'Syncing…':'Sync now'}</button>`}
      <button class="btn ${stale?'':'primary'}" data-close>Done</button>
    </div>`;
  }

  const calField=`<details class="gcadv"${m.calendarId && m.calendarId!=='primary'?' open':''}>
      <summary class="tiny muted">Use a calendar other than your main one</summary>
      <label class="fld" style="margin-top:8px"><span>Calendar ID</span>
        <input type="text" id="gcCal" value="${esc(m.calendarId||'primary')}" placeholder="primary" autocomplete="off" spellcheck="false"></label>
      <div class="tiny muted" style="margin-top:-4px">Find it in Google Calendar under the calendar’s
        <i>Settings &rarr; Integrate calendar</i>. Leave it as <span class="mono">primary</span> for your main one.</div>
    </details>`;

  const busyNote = GC.busy ? `<div class="tiny muted" style="margin-top:8px">A Google window should be open.
      If nothing appeared, your browser may have blocked the pop-up.</div>` : '';

  if(face==='ready'){
    const fromBuild=!m.clientId && !!G_BUILD_ID;
    return `${head}
    <div class="mbody" id="gcBody" data-face="ready">
      <p class="wizsub" style="margin-top:0">Connect your Google Calendar so Ply plans around what’s already on it.</p>
      ${what}
      ${calField}
      ${errBox}
      ${busyNote}
      <div class="tiny muted" style="margin-top:12px">Using ${fromBuild?'the client ID this build ships with':'your saved client ID'}
        <span class="mono gcid">${esc(gClientId())}</span>.
        <button class="btn sm ghost" data-ui="gc-edit">Change</button></div>
    </div>
    <div class="mfoot"><span class="spacer"></span>
      <button class="btn" data-close>Not now</button>
      <button class="btn primary" data-ui="gc-connect" ${GC.busy?'disabled':''}>${GC.busy?'Waiting for Google…':'Connect Google Calendar'}</button>
    </div>`;
  }

  /* setup */
  const cur = m.clientId || '';
  const chk = gcCheckId(cur);
  return `${head}
    <div class="mbody" id="gcBody" data-face="setup">
      <p class="wizsub" style="margin-top:0">Ply has no server, so it signs in to Google with a client ID you
        make once in your own Google Cloud project. It takes about five minutes, and you only do it once.</p>
      <ol class="gcsteps">
        ${stepHTML(1,'Turn on the Calendar API',
          `<div class="tiny muted">Pick or create a project, then press <b>Enable</b>.
            <a class="btn sm" href="${GC_LINKS.api}" target="_blank" rel="noopener">Open Calendar API &nearr;</a></div>`)}
        ${stepHTML(2,'Set up the consent screen',
          `<div class="tiny muted">Choose <b>External</b>, fill in the app name and your email, and add yourself
            under <b>Test users</b> &mdash; skipping that is the most common reason sign-in fails.
            <a class="btn sm" href="${GC_LINKS.consent}" target="_blank" rel="noopener">Open consent screen &nearr;</a></div>`)}
        ${stepHTML(3,'Create the client ID',
          `<div class="tiny muted"><b>Create credentials &rarr; OAuth client ID &rarr; Web application.</b>
            Under <b>Authorized JavaScript origins</b> add this page’s address. Leave redirect URIs empty.
            <a class="btn sm" href="${GC_LINKS.creds}" target="_blank" rel="noopener">Open credentials &nearr;</a></div>
          <div class="gccopy"><span class="mono" id="gcOrigin">${esc(origin)}</span>
            <button class="btn sm" data-ui="gc-copy">Copy</button></div>`)}
        ${stepHTML(4,'Paste the client ID here',
          `<input type="text" id="gcId" value="${esc(cur)}" autocomplete="off" spellcheck="false"
             placeholder="123456789-abc123.apps.googleusercontent.com" aria-describedby="gcIdMsg">
           <div class="tiny gcmsg ${chk.level}" id="gcIdMsg">${chk.msg||'It’s public by design &mdash; not a secret.'}</div>`)}
      </ol>
      ${calField}
      ${errBox}
      ${busyNote}
      ${G_BUILD_ID && GC.editing?`<div class="tiny muted" style="margin-top:8px">Leave it empty to use the ID this build ships with.</div>`:''}
    </div>
    <div class="mfoot">
      ${GC.editing?'<button class="btn ghost" data-ui="gc-edit-cancel">Back</button>':''}
      <span class="spacer"></span>
      <button class="btn" data-close>Not now</button>
      <button class="btn primary" data-ui="gc-connect" ${(chk.ok || (GC.editing && !cur.trim() && G_BUILD_ID)) && !GC.busy?'':'disabled'}
        >${GC.busy?'Waiting for Google…':'Connect Google Calendar'}</button>
    </div>`;
}

/* Live feedback on the id field without re-rendering the dialog — a re-render
   would take the caret with it. Wired once, on #modalRoot, which outlives every
   dialog. */
let WIRED=null;
export function initGConnect(){
  const root=$('#modalRoot'); if(!root || WIRED===root) return;
  WIRED=root;
  root.addEventListener('input', e=>{
    if(!e.target || e.target.id!=='gcId') return;
    const chk=gcCheckId(e.target.value);
    const msg=$('#gcIdMsg'), btn=$('#gcBody') && $('[data-ui="gc-connect"]');
    if(msg){ msg.className='tiny gcmsg '+chk.level; msg.innerHTML=chk.msg||'It’s public by design &mdash; not a secret.'; }
    const emptyOk = GC.editing && !e.target.value.trim() && !!G_BUILD_ID;
    if(btn) btn.disabled = GC.busy || !(chk.ok || emptyOk);
  });
  root.addEventListener('keydown', e=>{
    if(e.key!=='Enter' || !e.target || (e.target.id!=='gcId' && e.target.id!=='gcCal')) return;
    const btn=$('[data-ui="gc-connect"]');
    if(btn && !btn.disabled){ e.preventDefault(); gcAct('gc-connect', btn); }
  });
}

/* Take what the dialog's fields say into meta. Changing the calendar invalidates
   the sync cursor, exactly as the Settings field does. */
export function gcReadFields(){
  const m=gmeta(), a=$('#gcId'), b=$('#gcCal');
  if(a) m.clientId=String(a.value||'').trim();
  if(b){
    const cal=String(b.value||'').trim()||'primary';
    if(cal!==m.calendarId){ m.calendarId=cal; gCursorSet({token:null}); }
  }
}

export function gcAct(a, btn){
  if(a==='gc-open'){ GC.err=null; GC.editing=false; openGConnect(); return; }
  if(a==='gc-edit'){ GC.editing=true; GC.err=null; repaint(); return; }
  if(a==='gc-edit-cancel'){ GC.editing=false; GC.err=null; repaint(); return; }
  if(a==='gc-copy'){
    const o=gcOrigin();
    const done=()=>toast('Copied '+o);
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(o).then(done, ()=>selectOrigin());
        return;
      }
    }catch(_){}
    selectOrigin();
    return;
  }
  if(a==='gc-connect'){
    if(GC.busy) return;
    const f=$('#gcId');
    if(f){
      const chk=gcCheckId(f.value);
      const emptyOk = GC.editing && !f.value.trim() && !!G_BUILD_ID;
      if(!chk.ok && !emptyOk){ f.focus(); return; }
    }
    /* a failure straight after pasting an id is most often the id itself, so
       keep the field on screen rather than hiding it behind the one-button face */
    const fromSetup=!!f;
    gcReadFields(); save();
    GC.busy=true; GC.err=null; repaint();
    gConnect().then(acct=>{
      GC.busy=false; GC.editing=false; GC.err=null;
      render(); repaint();
      toast(acct?('Connected as '+acct+'.'):'Google Calendar connected.');
    }).catch(err=>{
      GC.busy=false;
      if(fromSetup) GC.editing=true;
      GC.err={kind:err && err.kind, msg:(err && err.message)||'Could not connect.'};
      setGErr(GC.err.msg);
      repaint();
      if(!gcOpen()) toast(GC.err.msg);
    });
    return;
  }
  if(a==='gc-sync'){
    if(GC.busy) return;
    GC.busy=true; GC.err=null; repaint();
    gFlush().then(()=>gSync({reason:'manual'}))
      .then(r=>{ GC.busy=false; repaint(); toast(r && r.skipped==='follower' ? 'Another tab is syncing.' : 'Calendar synced.'); })
      .catch(err=>{ GC.busy=false; GC.err={kind:err && err.kind, msg:(err && err.message)||'Sync failed.'}; repaint(); });
    return;
  }
  if(a==='gc-off'){
    if(!armConfirm('gc-off')) return;         // arm in place rather than stack a dialog
    gDisconnect(); gcReset(); render(); repaint();
    toast('Disconnected — your schedule stayed put, as local events.');
  }
}

function selectOrigin(){
  const s=$('#gcOrigin'); if(!s) return;
  try{ const r=document.createRange(); r.selectNodeContents(s);
       const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }catch(_){}
  toast('Selected — press Ctrl+C to copy.');
}

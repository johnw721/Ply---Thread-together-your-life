import { startCheckin } from './checkin.js';
import { activeItems, checkinAgenda, checkinDue, shortName, signals } from './engine.js';
import { INSTALL_EVT, SWREG, SW_WHY, iosWeb, standalone, swBlockedBecause } from './pwa.js';
import { DB, save } from './store.js';
import { $, DAY_MS, dkey, fmtTime, parseKey, today } from './util.js';

/* ===================== [SECTION: NOTIFY] =====================
   Three notifications, and deliberately only three — each one corresponds to a
   state the app already treats as load-bearing, so nothing new has to be
   invented to decide what is worth interrupting someone for:

     step      a slot you committed to starts in fifteen minutes
     hard      a hard signal has been hard for a full day
     checkin   the check-in is due

   Everything else stays in the ribbon, where it costs nothing to ignore.

   Permission is never requested on load. Capture is the first thing the page
   offers and a permission sheet on top of it is the fastest way to teach
   someone to deny it; the prompt only ever comes from the Settings toggle.
   ========================================================================= */
export const NOTIF_LEAD_MIN=15;      // a step warns this far ahead
export const NOTIF_HARD_H=24;        // a hard signal has to have been hard this long
export const NOTIF_WINDOW_MIN=30;    // a phone that was asleep still gets it; an hour later doesn't
export const NOTIF_TICK_MS=60000;
export const NOTIF_KEEP_DAYS=14;

export function notifSupported(){ return typeof Notification!=='undefined'; }
export function notifPerm(){ return notifSupported()?Notification.permission:'unsupported'; }
export function notifWanted(){ return !!(DB&&DB.meta&&DB.meta.notify); }
export function notifOn(){ return notifWanted() && notifPerm()==='granted'; }

/* A signal is computed fresh on every render and has no history of its own, so
   "hard for 24 hours" needs somewhere to start counting. Keys that stop being
   hard are dropped, which is what makes a fixed-then-broken-again thread start
   its clock over rather than firing instantly. */
export function notifTrackHard(now=Date.now()){
  const seen = DB.meta.sigHardSince || (DB.meta.sigHardSince={});
  const live=new Set();
  for(const s of signals()){
    if(s.sev!=='hard') continue;
    live.add(s.key);
    if(!seen[s.key]) seen[s.key]=new Date(now).toISOString();
  }
  for(const k of Object.keys(seen)) if(!live.has(k)) delete seen[k];
  return seen;
}

export function notifSentList(){ return DB.meta.notifSent || (DB.meta.notifSent=[]); }
export function notifAlreadySent(k){ return notifSentList().some(x=>x.k===k); }
export function notifMark(k,now=Date.now()){
  const L=notifSentList();
  L.push({k, ts:new Date(now).toISOString()});
  const cut=now-NOTIF_KEEP_DAYS*DAY_MS;
  DB.meta.notifSent=L.filter(x=>Date.parse(x.ts)>=cut).slice(-300);
}

/* Everything that should have fired by `now` and hasn't. Pure: it reads the DB
   and the clock and returns a list, which is the whole reason the scheduling is
   testable without a browser that can show a notification. */
export function notifPlan(now=Date.now()){
  const out=[];

  /* 1. a step starting in fifteen minutes. All-day slots have no start, and a
        step whose event Google dropped isn't booked any more, so neither warns. */
  for(const it of activeItems()){
    if(!it.ev || it.ev.allDay || it.dateKey==null || it.start==null) continue;
    const at = parseKey(it.dateKey).getTime() + it.start*60000 - NOTIF_LEAD_MIN*60000;
    if(now < at || now >= at + NOTIF_WINDOW_MIN*60000) continue;
    out.push({kind:'step', key:'step:'+it.step.id+':'+it.dateKey+':'+it.start, at,
      title:shortName(it.goal),
      body:it.step.title+' starts at '+fmtTime(it.start)+'.',
      tag:'ply-step-'+it.step.id});
  }

  /* 2. a hard signal that has been hard for a day. One per signal per day: the
        point is that it hasn't moved, and saying so hourly wouldn't help. */
  const seen=notifTrackHard(now);
  for(const s of signals()){
    if(s.sev!=='hard') continue;
    const since=Date.parse(seen[s.key]||'');
    if(!since || now-since < NOTIF_HARD_H*3600e3) continue;
    out.push({kind:'hard', key:'hard:'+s.key+':'+dkey(new Date(now)), at:since+NOTIF_HARD_H*3600e3,
      title:shortName(s.goal), body:s.text+' — a full day now.', tag:'ply-hard-'+s.key});
  }

  /* 3. the check-in, once on the day it comes due. */
  if(checkinDue()){
    const a=checkinAgenda();
    const n=a.gates.length+a.quiet.length+a.nostep.length+a.branch.length;
    out.push({kind:'checkin', key:'checkin:'+today(), at:now, title:'Weekly check-in',
      body:n?(n+' thing'+(n>1?'s':'')+' to walk through.'):'Ready when you are.', tag:'ply-checkin'});
  }

  return out.filter(n=>!notifAlreadySent(n.key)).sort((a,b)=>a.at-b.at);
}

/* The service worker owns the notification where there is one, because a
   notification shown by a page dies with the page. `new Notification()` is the
   fallback for a desktop browser with no worker registered. */
export function notifShow(n){
  const opts={body:n.body, tag:n.tag, icon:'icons/icon-192.png', badge:'icons/icon-192.png',
              data:{kind:n.kind, key:n.key}, renotify:false};
  if(SWREG && SWREG.showNotification){
    try{ return Promise.resolve(SWREG.showNotification(n.title,opts)); }catch(_){}
  }
  try{ new Notification(n.title,opts); }catch(_){}
  return Promise.resolve();
}

/* Fires what is due and records it. Returns the list it fired, so the suite can
   assert the scheduling without stubbing the platform's notification object. */
export function notifTick(now=Date.now()){
  if(!notifOn()) return [];
  const due=notifPlan(now);
  for(const n of due){ notifShow(n); notifMark(n.key,now); }
  if(due.length) save();
  return due;
}

export let NOTIF_TIMER=null;
export function notifStart(){
  if(NOTIF_TIMER || !notifOn()) return false;
  NOTIF_TIMER=setInterval(()=>notifTick(),NOTIF_TICK_MS);
  notifTick();
  return true;
}
export function notifStop(){ if(NOTIF_TIMER){ clearInterval(NOTIF_TIMER); NOTIF_TIMER=null; } }

/* The only place that ever asks. Called from the Settings toggle, never from
   load, and it refuses politely rather than throwing when the answer is no. */
export function notifEnable(){
  if(!notifSupported()) return Promise.resolve('unsupported');
  if(Notification.permission==='denied') return Promise.resolve('denied');
  if(Notification.permission==='granted'){
    DB.meta.notify=true; save(); notifStart(); return Promise.resolve('granted');
  }
  return Promise.resolve(Notification.requestPermission()).then(p=>{
    if(p==='granted'){ DB.meta.notify=true; save(); notifStart(); }
    return p;
  }).catch(()=>'denied');
}
export function notifDisable(){ DB.meta.notify=false; save(); notifStop(); }

/* What Settings has to say about all this, in one place, because there are five
   states and four of them are somebody else's fault. */
export function notifPrefsHTML(){
  const why=swBlockedBecause();
  const perm=notifPerm();
  const on=notifWanted();
  if(!notifSupported()) return `<div class="tiny muted">This browser has no Notifications API.</div>`;
  if(perm==='denied') return `<div class="tiny muted">Notifications are blocked for this site in your
      browser's settings. Ply can't re-ask &mdash; that switch is yours to flip, in the site permissions.</div>`;
  const lead=`<div class="tiny muted">Three things, fired locally by this tab:
      a step starting in ${NOTIF_LEAD_MIN} minutes, a hard signal that has stayed hard
      for ${NOTIF_HARD_H} hours, and the check-in when it comes due.
      ${why?'':'There is no push server yet, so they only arrive while Ply is open in a tab.'}</div>`;
  return `${lead}
    <button class="btn sm ${on?'':'primary'}" data-ui="notif-toggle" style="margin-top:9px">
      ${on?'Turn notifications off':'Turn notifications on'}</button>
    ${on&&perm==='default'?'<div class="tiny muted" style="margin-top:6px">Waiting on the browser’s permission prompt.</div>':''}
    ${why?`<div class="tiny muted" style="margin-top:6px">${SW_WHY[why]} They will still fire while this tab is open.</div>`:''}`;
}

/* Where a manifest shortcut or a tapped notification lands. Both are just a
   name for a place in the app, so they share one door. */
export function plyGoTo(what){
  if(what==='checkin'){ if(!$('.scrim')) startCheckin(); return true; }
  if(what==='capture'){ const c=$('#capture'); if(c) c.focus(); return true; }
  return false;
}

/* Install, as Settings sees it. */
export function installPrefsHTML(){
  const why=swBlockedBecause();
  if(standalone()) return `<div class="tiny muted">Running as an installed app.</div>`;
  if(why) return `<div class="tiny muted">${SW_WHY[why]}</div>`;
  if(INSTALL_EVT) return `<div class="tiny muted">Your browser is offering to install Ply.</div>
    <button class="btn sm primary" data-ui="pwa-install" style="margin-top:9px">Install Ply</button>`;
  if(iosWeb()) return `<div class="tiny muted">On iOS the only route is the Share sheet:
      <b>Share</b>, then <b>Add to Home Screen</b>.</div>`;
  return `<div class="tiny muted">Your browser hasn't offered to install Ply on this origin yet.
      Chrome and Edge offer it once the manifest, the icons and the worker all check out;
      Firefox and desktop Safari don't offer it at all.</div>`;
}


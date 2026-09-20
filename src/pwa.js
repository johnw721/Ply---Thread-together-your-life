import { SCHEMA } from './schema.js';
import { DB } from './store.js';
import { $, el } from './util.js';

/* ===================== [SECTION: PWA] =====================
   Three things that only exist once Ply is served over https: an installable
   shell, a cache that survives a tunnel, and a notification that arrives when
   the app isn't open. All three are additive — a `file://` build loses every
   one of them and behaves exactly as it did before, which is why each entry
   point below starts with a guard rather than a try/catch.

   There is no push server. Every notification here is scheduled and fired by
   this tab; close every tab and nothing arrives. That is a real limitation and
   it's stated in the README rather than hidden behind a permission prompt.
   ========================================================================= */

/* The cache name is stamped with SCHEMA, so a shape change to the data is also
   a new cache: a client running the old bundle against new data was the one
   failure mode worth designing out. BUILD covers everything else. */
export const BUILD='2026-09-19';
export const SW_URL='sw.js?schema='+SCHEMA+'&build='+BUILD;

/* Registering a service worker from the wrong place fails loudly in the console
   and silently in the product. Say which of the four reasons it was, once, so
   Settings can explain itself instead of showing a dead switch. */
export function swBlockedBecause(loc=location, nav=navigator){
  if(!nav || !('serviceWorker' in nav)) return 'unsupported';
  if(loc.protocol==='file:') return 'file';
  const h=loc.hostname||'';
  const secure = loc.protocol==='https:' || h==='localhost' || h==='127.0.0.1'
              || h==='[::1]' || h==='::1' || h.endsWith('.localhost');
  return secure ? null : 'insecure';
}
export const SW_WHY={
  unsupported:'This browser has no service worker, so Ply can’t be installed or work offline.',
  file:'Opened as a file, so there is nothing to install. Serve it over http://localhost or https.',
  insecure:'Service workers need https (or localhost). This origin is neither.',
  error:'The service worker did not register.'
};
export let SWREG=null, SWSTATE=null;
export function setSWREG(v){ SWREG=v; }
export function setSWSTATE(v){ SWSTATE=v; }
export function registerSW(){
  const why=swBlockedBecause();
  if(why){ SWSTATE={ok:false,why}; return Promise.resolve(SWSTATE); }
  return navigator.serviceWorker.register(SW_URL,{scope:'./'})
    .then(reg=>{ SWREG=reg; SWSTATE={ok:true,reg}; return SWSTATE; })
    .catch(err=>{ SWSTATE={ok:false,why:'error',error:err&&err.message}; return SWSTATE; });
}

/* ---------- install ----------
   `beforeinstallprompt` is the only honest signal that installing is actually
   possible: Chrome fires it once the manifest, the icons and the worker all
   check out. iOS never fires it and never will, so that one case is named
   rather than guessed at. Neither hint is allowed to appear on first load —
   the first thing a new page does is ask for a goal, not for a commitment. */
export let INSTALL_EVT=null;
export function setInstallEvt(v){ INSTALL_EVT=v; }
export function standalone(){
  try{ return matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }
  catch(_){ return false; }
}
export function iosWeb(){
  const ua=navigator.userAgent||'';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints>1);
}
/* null = say nothing. The dismissal is remembered, because a bar you closed and
   that came back is worse than no bar. */
export function installHint(){
  if(standalone() || (DB&&DB.meta&&DB.meta.installHidden)) return null;
  if(INSTALL_EVT) return {kind:'prompt',
    text:'Ply runs better installed &mdash; full screen, and it opens offline.'};
  if(iosWeb() && !swBlockedBecause()) return {kind:'ios',
    text:'Add Ply to your Home Screen: <b>Share</b>, then <b>Add to Home Screen</b>.'};
  return null;
}
export function renderInstallBar(){
  const old=$('#installbar'); if(old) old.remove();
  const hint=installHint(); if(!hint) return;
  const bar=el(`<div class="installbar" id="installbar">
    <span>${hint.text}</span><span class="spacer"></span>
    ${hint.kind==='prompt'?'<button class="btn sm primary" data-ui="pwa-install">Install</button>':''}
    <button class="btn sm ghost" data-ui="pwa-later" aria-label="Dismiss">&times;</button></div>`);
  $('#signals').after(bar);
}
export function doInstall(){
  const e=INSTALL_EVT;
  if(!e) return Promise.resolve('unavailable');
  INSTALL_EVT=null;
  try{ e.prompt(); }catch(_){ return Promise.resolve('unavailable'); }
  return Promise.resolve(e.userChoice).then(c=>{
    const out=(c&&c.outcome)||'dismissed';
    renderInstallBar();
    return out;
  }).catch(()=>'dismissed');
}


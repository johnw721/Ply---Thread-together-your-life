import { DB, blankDB, checkpoint, exportJSON, importJSON, initStorageSync, load, redo, save, setDB, undo } from './store.js';
import { captureHint, doCapture } from './capture.js';
import { setCK, startCheckin } from './checkin.js';
import { openConfirm } from './components/dialogs.js';
import { wireDrag } from './components/drag.js';
import { closeModal, initModalTrap } from './components/modal.js';
import { initRibbon, setSigOpen } from './components/ribbon.js';
import { checkinDue } from './engine.js';
import { initModalRouter, openPrefs } from './goal-editor.js';
import { gCursor, gFlush, gNote, gOn, gStart, gSync } from './google.js';
import { notifOn, notifStart, notifTick, plyGoTo } from './notify.js';
import { registerSW, renderInstallBar, setInstallEvt } from './pwa.js';
import { seed } from './seed.js';
import { $, el, toast, today } from './util.js';
import { render } from './views/render.js';
import { API } from './debug.js';
import { wireBus } from './bus.js';

/* ===================== [SECTION: BOOT] =====================
   The monolith ran this at the bottom of its one <script>. As a module it has to
   be a function instead: the test harness boots a fresh app per test, and an
   import that wires listeners and seeds a database as a side effect cannot be
   done twice in one document.

   Everything below is the same sequence in the same order — load, seed if empty,
   wire the chrome, first render, then the parts that only matter once the page
   is live (drag, the Google provider, the service worker).
   ------------------------------------------------------------------ */
export function bootstrap({ seed: wantSeed = true } = {}){
  load();
  if(wantSeed && !DB.goals.length) seed();

  /* Listener registration the monolith did at the top level of its script. Each
     target — #view, #signals, #modalRoot — outlives every render, so all of this
     happens exactly once. */
  /* The store and the engine reach the UI only through these. See src/bus.js. */
  wireBus({
    render,
    closeModal,
    resetTransientUI(){ setCK(null); setSigOpen(null); }
  });

  initStorageSync();
  initModalTrap();
  initModalRouter();
  initRibbon();

  $('#zoombar').onclick=e=>{ const b=e.target.closest('[data-z]'); if(!b)return;
    DB.meta.zoom=b.dataset.z; save(); render(); };

    const cap=$('#capture');
  cap.addEventListener('input',()=>captureHint(cap.value));
  cap.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&cap.value.trim()){ doCapture(cap.value.trim()); cap.value=''; captureHint(''); }
    if(e.key==='Escape'){ cap.value=''; captureHint(''); cap.blur(); }
  });

  $('#btnCheckin').onclick=()=>startCheckin();
  $('#btnUndo').onclick=()=>undo();
  $('#btnRedo').onclick=()=>redo();

  $('#btnMenu').onclick=e=>{
    e.stopPropagation();
    const old=$('.menu'); if(old){old.remove();return;}
    const m=el(`<div class="menu">
      <button data-m="prefs">Settings</button>
      <button data-m="checkin">Run check-in now</button>
      <hr>
      <button data-m="export">Export JSON</button>
      <button data-m="import">Import JSON</button>
      <hr>
      <button data-m="reseed">Reload demo data</button>
      <button data-m="wipe" style="color:var(--bad)">Erase everything</button></div>`);
    document.body.appendChild(m);
    m.onclick=ev=>{
      const a=ev.target.dataset.m; m.remove();
      if(a==='prefs') openPrefs();
      if(a==='checkin') startCheckin();
      if(a==='export') exportJSON();
      if(a==='import') importJSON();
      if(a==='reseed') openConfirm({title:'Reload demo data', yes:'Replace everything', danger:true,
        body:'This replaces your goals, events and history with the demo set. <b>⌘Z undoes it.</b>',
        onYes:()=>{ checkpoint('loading the demo data'); seed(); render(); toast('Demo data loaded — ⌘Z to undo.'); }});
      if(a==='wipe') openConfirm({title:'Erase everything', yes:'Erase it all', danger:true,
        body:'Every goal, event and log entry goes. <b>⌘Z undoes it</b>, but only while this tab stays open — export first if you want it back later.',
        onYes:()=>{ checkpoint('erasing everything'); setDB(blankDB()); DB.meta.cursor=today(); save(); render(); toast('Erased — ⌘Z to undo.'); }});
    };
  };
  document.addEventListener('click',()=>{ const m=$('.menu'); if(m)m.remove(); });

  document.addEventListener('keydown',e=>{
    // inside a text field, leave Cmd/Ctrl+Z to the browser's own text undo
    if(e.target && e.target.matches && e.target.matches('input,textarea,select')) return;
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
    if(e.key==='1'){DB.meta.zoom='day';save();render();}
    if(e.key==='2'){DB.meta.zoom='week';save();render();}
    if(e.key==='3'){DB.meta.zoom='quarter';save();render();}
    if(e.key==='4'){DB.meta.zoom='list';save();render();}
    if(e.key==='t'){DB.meta.cursor=today();save();render();}
    if(e.key==='/'){e.preventDefault();cap.focus();}
    if(e.key==='c'&&!$('.scrim')) startCheckin();
    if(e.key==='Escape'&&$('.scrim')){ closeModal(); setCK(null); render(); }
  });

  /* The install offer can arrive at any point after load. Catch it, stop the
     browser's own banner, and let the app place the hint where it won't land on
     the capture field. */
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); setInstallEvt(e); renderInstallBar(); });
  window.addEventListener('appinstalled', ()=>{ setInstallEvt(null); DB.meta.installHidden=true; save(); renderInstallBar(); });

  render();
  wireDrag();          // once — #view outlives every render
  /* The provider starts itself if it was left connected: pull on load, then on
     focus and every five minutes. Anything queued from last session goes first. */
  if(gOn()){
    gStart();
    gFlush().then(()=>gSync({full:!gCursor().token, reason:'load'})).catch(gNote);
  }
  /* The worker is registered on load and the notification timer only starts if
     Settings already said yes. Neither asks for anything: the permission prompt
     belongs to the toggle, and a prompt on top of the capture field is how you
     teach someone to deny it. */
  registerSW().then(()=>{ if(notifOn()) notifStart(); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && notifOn()) notifTick(); });

  /* ?go=checkin / ?go=capture — the manifest's two shortcuts, and where the
     worker sends a tapped notification. */
  try{
    const go=new URLSearchParams(location.search).get('go');
    if(go) setTimeout(()=>plyGoTo(go),140);
    if(navigator.serviceWorker && navigator.serviceWorker.addEventListener)
      navigator.serviceWorker.addEventListener('message', e=>{
        if(e.data && e.data.ply==='notificationclick') plyGoTo(e.data.kind==='checkin'?'checkin':'capture');
      });
  }catch(_){}

  /* nudge: if the check-in is due, say so once on load rather than waiting to be noticed */
  if(checkinDue()) setTimeout(()=>toast('Weekly check-in is due — press c'),700);

  return API;
}

/* The browser entry. Vite loads this module from index.html; the test harness
   imports bootstrap() directly and calls it itself. */
if (typeof window !== 'undefined' && !window.__PLY_NO_AUTOBOOT){
  window.__ply = bootstrap();
}

import { disarm, setConfirmCb } from './dialogs.js';
import { setGerow } from '../goal-editor.js';
import { adoptExternal, takeExternal } from '../store.js';
import { $, el } from '../util.js';

/* ===================== [SECTION: UI] ===================== */
export const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export let RETURN_FOCUS=null;

export function openModal(html,opts={}){
  const root=$('#modalRoot');
  // remember what opened this, so closing puts the keyboard back where it was
  if(!root.innerHTML) RETURN_FOCUS = (document.activeElement && document.activeElement!==document.body)
    ? document.activeElement : null;
  root.innerHTML=`<div class="scrim"><div class="modal ${opts.wide?'wide':''}" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`;
  const m=$('.modal',root);
  document.body.classList.add('modal-open');
  const inp=root.querySelector('input,select,textarea');
  if(inp&&!opts.nofocus) setTimeout(()=>inp.focus(),30);
  // only claim focus if nothing inside has it — otherwise this steals the caret from
  // an inline field the moment after someone starts typing in it
  else if(m) setTimeout(()=>{ if(!m.contains(document.activeElement)) m.focus(); },30);
  return root.firstElementChild;
}

/* Tab used to walk straight out of an open dialog and into the page behind it,
   where every control still worked. Keep it inside until the dialog is closed. */
/* Tab used to walk straight out of an open dialog into the live page behind it.
   Wired from main.js so importing this module has no side effects. */
export function initModalTrap(){
$('#modalRoot').addEventListener('keydown',e=>{
  if(e.key!=='Tab') return;
  const m=$('.modal'); if(!m) return;
  const items=[...m.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null||el===document.activeElement);
  if(!items.length){ e.preventDefault(); m.focus(); return; }
  const first=items[0], last=items[items.length-1];
  if(e.shiftKey && (document.activeElement===first||document.activeElement===m)){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
});}

export function closeModal(){
  $('#modalRoot').innerHTML='';
  document.body.classList.remove('modal-open');
  disarm(); setGerow(null); setConfirmCb(null);
  if(RETURN_FOCUS){ const el=RETURN_FOCUS; RETURN_FOCUS=null;
    if(document.body.contains(el)) try{ el.focus(); }catch(_){} }
  // another tab wrote while this modal was open — take it now that nothing is mid-edit
  { const d=takeExternal(); if(d) adoptExternal(d); }
}


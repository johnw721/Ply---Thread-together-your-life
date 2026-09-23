import { PIPELINE_STAGES } from '../types.js';
import { findStep } from '../checkin.js';
import { openModal } from './modal.jsx';
import { addSub } from '../engine.js';
import { openPrefs, refreshGoal } from '../goal-editor.js';
import { gcOpen, openGConnect } from '../gcal-connect.js';
import { checkpoint, goalById, newStep, newThread, save, threadById, touchThread } from '../store.js';
import { $, el, esc } from '../util.js';
import { render } from '../views/render.jsx';

/* ===================== [SECTION: DIALOGS] =====================
   Native prompt() and confirm() block the whole page, can't be styled, can't carry
   context, land outside the app's own modal on mobile, and give the keyboard nowhere
   sensible to go. Everything below replaces them with the app's own furniture.

   Two shapes, chosen by what's already on screen:
   · nothing open  -> a real dialog (openConfirm), because there's room for one
   · a modal open  -> arm-to-confirm on the button itself, because stacking a second
                      modal over the first is exactly the jarring thing being fixed
   ------------------------------------------------------------------ */
export let ARMED=null, ARMED_T=null;
export function armConfirm(key){
  if(ARMED===key){ clearTimeout(ARMED_T); ARMED=null; return true; }   // second click: do it
  clearTimeout(ARMED_T);
  ARMED=key;
  ARMED_T=setTimeout(()=>{ ARMED=null; repaintArmed(); }, 4000);       // forget it if you walk away
  repaintArmed();
  return false;
}
export function disarm(){ clearTimeout(ARMED_T); ARMED=null; }
export function repaintArmed(){
  const m=$('.mbody[data-goal]');
  if(m){ refreshGoal(m.dataset.goal); return; }
  if(gcOpen()){ openGConnect(); return; }   // the Google Calendar dialog's Disconnect
  if($('#pfMode')) openPrefs();        // the Settings panel: it owns two armed controls now
}
export const armLabel=(key,normal,armed)=> ARMED===key ? armed : normal;

export let CONFIRM_CB=null;
export function setConfirmCb(fn){ CONFIRM_CB=fn; }
/* read-and-clear: the dialog fires once, and closeModal() must not fire it again */
export function takeConfirmCb(){ const cb=CONFIRM_CB; CONFIRM_CB=null; return cb; }
export function openConfirm({title, body, yes='Confirm', danger=false, onYes}){
  CONFIRM_CB=onYes;
  openModal(`<h3>${esc(title)}<button class="btn ghost x" data-close>&times;</button></h3>
    <div class="mbody"><p class="wizsub" style="margin:0">${body}</p></div>
    <div class="mfoot"><span class="spacer"></span>
      <button class="btn" data-close>Cancel</button>
      <button class="btn ${danger?'danger':'primary'}" data-ui="confirm-yes">${esc(yes)}</button></div>`,
    {nofocus:true});
  setTimeout(()=>{ const b=$('[data-ui="confirm-yes"]'); if(b) b.focus(); },30);
}

/* ---- inline "add another" inputs ----
   An always-present field at the end of each list. Enter creates and clears, so you
   can add several in a row without a dialog opening and closing between each. */
export const NEW_LABEL={sub:'that subtask', backlog:'that backlog item', step:'that new step', entry:'that pipeline entry'};
export function newInHTML(kind, ph, attrs=''){
  return `<input class="newin" data-new="${kind}" ${attrs} placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
}
export function newInAct(el){
  const kind=el.dataset.new, v=el.value.trim();
  if(!v){ return; }
  const m=$('.mbody[data-goal]'); if(!m) return;
  const g=goalById(m.dataset.goal); if(!g) return;
  checkpoint(NEW_LABEL[kind]||'that addition');
  if(kind==='sub'){
    const f=findStep(el.dataset.s); if(f) addSub(g,f.thread,f.step,v);
  } else if(kind==='backlog'){
    g.backlog.push(v);
  } else if(kind==='step'){
    const t=threadById(g.id, el.dataset.t);
    if(t){ t.steps.push(newStep(v)); touchThread(t); }
  } else if(kind==='entry'){
    const th=newThread({name:v, rel:'parallel'});
    th.stage=(g.stages||PIPELINE_STAGES)[0];
    th.steps.push(newStep('Advance to '+(g.stages||PIPELINE_STAGES)[1]+': '+v,{auto:true,quadrant:'q2'}));
    g.threads.push(th);
  }
  save(); refreshGoal(g.id); render();
  // put the caret back so the next one can be typed straight away
  const sel=`.newin[data-new="${kind}"]`+(el.dataset.s?`[data-s="${el.dataset.s}"]`:'')+(el.dataset.t?`[data-t="${el.dataset.t}"]`:'');
  const again=$(sel); if(again) again.focus();
}

/* ---------------- capture ---------------- */

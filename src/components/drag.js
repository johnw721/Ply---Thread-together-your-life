import { hrs, loadState } from '../budget.js';
import { CAL } from '../cal.js';
import { findStep, suggestTime } from '../checkin.js';
import { calMinAt, calPos } from './card.js';
import { floatSub, subs } from '../engine.js';
import { DB, checkpoint, save, touchThread } from '../store.js';
import { $, el, fmtDate, fmtTime, toast, today } from '../util.js';
import { QUAD, render } from '../views/render.js';

export function wireDrag(){
  const v=$('#view');
  let drag=null, ghost=null, lastQ=null, moved=false;

  /* two kinds of target: a quadrant (re-prioritise) and the calendar strip (schedule) */
  const targetAt=(x,y)=>{
    const el=document.elementFromPoint(x,y);
    if(!el||!el.closest) return null;
    return el.closest('.quad[data-quad]') || el.closest('.track[data-caldrop]')
        || el.closest('.daycol[data-daydrop]');
  };
  const isTrack = t => !!(t && t.dataset && t.dataset.caldrop);
  const isDay   = t => !!(t && t.dataset && t.dataset.daydrop);
  const clear=()=>{
    if(lastQ){ lastQ.classList.remove('drop'); lastQ.classList.remove('armed'); }
    lastQ=null;
  };
  function end(){
    if(ghost){ ghost.remove(); ghost=null; }
    if(drag&&drag.card) drag.card.classList.remove('dragging');
    clear(); drag=null;
    document.body.classList.remove('dragging-on');
  }

  v.addEventListener('pointerdown', e=>{
    if(e.button!==undefined && e.button!==0) return;
    // a matrix card or a list row — both carry a step id, which is all the drop needs
    // anything that knows which step it belongs to can be dragged: a matrix card, a
    // list row, a week chip, or a single subtask line
    const card=e.target.closest('.card[data-step], .lrow[data-step], .tchip[data-step], .subline[data-sub]');
    if(!card) return;
    // checkboxes, the subtask list and the expand pill are controls, not drag handles
    // controls are not handles. A subtask line is draggable itself, so only its
    // checkbox is excluded there — the containing lists are not.
    if(e.target.closest('[data-act="toggle"],[data-act="sub"],[data-act="subs"],input,select,button')) return;
    if(!card.dataset.sub && e.target.closest('.cardsubs,.lsubs')) return;
    const viaGrip=!!e.target.closest('.grip');
    if(e.pointerType!=='mouse' && !viaGrip) return;                  // touch drags start at the grip
    drag={card, step:card.dataset.step, sub:card.dataset.sub||null, x:e.clientX, y:e.clientY, id:e.pointerId};
    moved=false;
    try{ card.setPointerCapture(e.pointerId); }catch(_){}
  });

  v.addEventListener('pointermove', e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
    if(!ghost){
      if(Math.hypot(dx,dy)<6) return;                                // a tap is not a drag
      const r=drag.card.getBoundingClientRect();
      ghost=drag.card.cloneNode(true);
      ghost.id='dragGhost'; ghost.style.width=r.width+'px';
      document.body.appendChild(ghost);
      drag.card.classList.add('dragging');
      document.body.classList.add('dragging-on');
    }
    moved=true;
    e.preventDefault();
    ghost.style.left=e.clientX+'px'; ghost.style.top=e.clientY+'px';
    const q=targetAt(e.clientX,e.clientY);
    if(q!==lastQ){ clear(); lastQ=q; if(q) q.classList.add(isTrack(q)?'armed':'drop'); }
    // on the strip, show where in the day this would land as you move
    if(isTrack(q)){
      const r=q.getBoundingClientRect();
      const mins=calMinAt(r.width?(e.clientX-r.left)/r.width:0);
      const line=$('.dropline',q);
      if(line){ line.style.left=calPos(mins)+'%'; line.dataset.t=fmtTime(mins); }
    }
  });

  const drop = e=>{
    if(!drag || e.pointerId!==drag.id) return;
    const q = ghost ? targetAt(e.clientX,e.clientY) : null;
    const sid=drag.step, subId=drag.sub;
    const wasDrag=!!ghost;
    const x=e.clientX;
    const rect = isTrack(q) ? q.getBoundingClientRect() : null;
    const dayKey = isDay(q) ? q.dataset.day : null;
    end();
    if(!q) return;
    const f=findStep(sid);
    if(!f) return;

    /* A subtask can't hold a slot, so dragging one schedules the step it belongs to
       and floats it to the head of the checklist. Say so plainly — the thing that
       moved is not the thing that was dragged. */
    const sub = subId ? subs(f.step).find(x=>x.id===subId) : null;
    const say = (what) => toast(sub
      ? what+' — "'+sub.title+'" is up first'
      : what);

    if(rect || dayKey){
      const k = dayKey || DB.meta.cursor;
      const mins = rect ? calMinAt(rect.width?(x-rect.left)/rect.width:0)
                        : (+suggestTime({goal:f.goal,quadrant:f.step.quadrant}).split(':')[0])*60;
      checkpoint(sub?'that subtask drop':'that scheduling');
      if(sub) floatSub(f.step,subId);
      CAL.anchor(f.goal,f.thread,f.step,k,mins,45);
      touchThread(f.thread); save(); render();
      const L=loadState(k);
      say('Scheduled '+(k===today()?'':fmtDate(k)+' ')+'for '+fmtTime(mins)
          +(L.over?' · that day is now '+hrs(L.mins):''));
    } else if(q.dataset.quad && f.step.quadrant!==q.dataset.quad){
      checkpoint(sub?'that subtask drop':'that move to '+QUAD[q.dataset.quad].n);
      if(sub) floatSub(f.step,subId);
      f.step.quadrant=q.dataset.quad; save(); render();
      say('Moved to '+QUAD[q.dataset.quad].n);
    }
    // don't open the goal we just dropped. Self-clears: if no click follows the drop,
    // a stale flag would silently eat the next unrelated click instead.
    if(wasDrag && moved){ swallowClick=true; setTimeout(()=>{ swallowClick=false; },350); }
  };
  v.addEventListener('pointerup', drop);
  v.addEventListener('pointercancel', ()=>end());
  window.addEventListener('blur', ()=>end());
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'&&drag) end(); });
}
export let swallowClick=false;
/* read-and-clear: a stale flag would silently eat the next unrelated click */
export function consumeSwallowClick(){ if(!swallowClick) return false; swallowClick=false; return true; }

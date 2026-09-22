import { TYPE } from './types.js';
import { CAL } from './cal.js';
import { buildGoalFrom, classify } from './engine.js';
import { addGoal, checkpoint, currentStep, save } from './store.js';
import { addNote, isTilCapture, stripTil } from './notes.js';
import { $, toast } from './util.js';
import { render } from './views/render.jsx';

export function doCapture(text){
  checkpoint('that capture');
  /* "til: ..." / "til ..." files a note instead of running the classifier — a
     TIL has no type, no thread, nothing to gate on, so it skips straight past
     everything below. See src/notes.js. */
  if(isTilCapture(text)){
    const n = addNote(stripTil(text));
    render();
    toast(n ? 'Filed as a TIL — first review tomorrow.' : 'Nothing to file — that note was empty.');
    return;
  }
  const cls=classify(text);
  const g=buildGoalFrom(text,cls);
  addGoal(g);
  // if the phrase carried a date, anchor the first step straight away
  const t=g.threads[0], s=t&&currentStep(t);
  if(s && cls.when){
    const mins = cls.clock ? cls.clock.min : null;
    /* 'manual': a date the person typed into the capture box is a date they chose.
       Inert for churn either way — this is always a first anchor on a new step. */
    const ev=CAL.anchor(g,t,s,cls.when.key, mins===null?0:mins, mins===null?1440:60, 'manual');
    if(mins===null) ev.allDay=true;
  }
  save(); render();
  const bits=[TYPE[cls.type].label+'-type'];
  if(cls.gates.length) bits.push(cls.gates.length+' question'+(cls.gates.length>1?'s':'')+' queued for check-in');
  if(!s && cls.type!=='contingent') bits.push('needs a first step');
  toast(bits.join(' · '));
}
export function captureHint(text){
  const h=$('#captureHint');
  if(!text.trim()){h.textContent='';return;}
  if(isTilCapture(text)){ h.innerHTML=`<span class="pill">TIL note</span>`; return; }
  const c=classify(text);
  const spec=TYPE[c.type];
  h.innerHTML=`<span class="pill" title="${c.learned?'matches a correction you made before':'from the phrasing'}">${
    c.learned?'&#9679; ':''}${spec.label}${c.gates.length?' <span style="color:var(--warn)">?</span>':''}</span>`;
}

/* ---------------- view wiring ---------------- */

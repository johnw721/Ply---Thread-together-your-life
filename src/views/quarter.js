/* Helpers the Quarter view reads. The view itself is a component in
   quarter.jsx; these stay plain functions because the check-in and the goal
   editor use bestQuadrant() too. */

import { subProgress } from '../engine.js';
import { currentStep } from '../store.js';

/* ================= QUARTER ================= */
export function doneCount(g){ return g.threads.reduce((n,t)=>n+t.steps.filter(s=>s.done).length,0); }
/* a half-ticked checklist is real progress; count it as a fraction of a step so the
   quarter bar moves as subtasks close rather than jumping only when a step does */
export function partialCount(g){
  return g.threads.reduce((n,t)=>{
    const s=currentStep(t); const p=s?subProgress(s):null;
    return n + (p&&p.any ? p.frac : 0);
  },0);
}
export function bestQuadrant(g){
  const s=g.threads.map(currentStep).filter(Boolean);
  for(const q of ['q1','q2','q3','q4']) if(s.some(x=>x.quadrant===q)) return q;
  return 'q4';
}


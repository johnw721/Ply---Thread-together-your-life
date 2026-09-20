import { PIPELINE_STAGES, TYPE } from './types.js';
import { bus } from './bus.js';
import { CAL } from './cal.js';
import { findStep } from './checkin.js';
import { actualMins, applyTemplate, blankFootprint, committedWeek, duePrereqs, ensureFootprint,
         fp, matchTemplate, normCost, normPrereq, proposeFromDuration, recordSample,
         tmplGates, tmplGet } from './footprint.js';
import { gDead } from './google.js';
import { DB, checkpoint, currentStep, eventById, finishGoal, liveGoals, logIt, newGoal, newStep, newSub, newThread, pass, save, touchThread } from './store.js';
import { addDays, clamp, daysBetween, dkey, fmtDate, parseKey, startOfWeek, toast, today, uid } from './util.js';

/* ===================== [SECTION: CLASSIFY] ===================== */

/* ---------- lightweight natural-date extraction ---------- */
export const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export const DOWS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export function parseWhen(text){
  const s=' '+text.toLowerCase()+' ';
  let m;
  if((m=s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)))
    return {key:`${m[1]}-${m[2]}-${m[3]}`, matched:m[0]};
  if((m=s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))){
    let y=m[3]?(+m[3]<100?2000+ +m[3]:+m[3]):parseKey(today()).getFullYear();
    const d=new Date(y,+m[1]-1,+m[2]); if(!m[3]&&dkey(d)<today())d.setFullYear(y+1);
    return {key:dkey(d), matched:m[0]};
  }
  if((m=s.match(new RegExp('\\b('+MONTHS.join('|')+')[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b')))){
    const y=parseKey(today()).getFullYear(); const d=new Date(y,MONTHS.indexOf(m[1]),+m[2]);
    if(dkey(d)<today())d.setFullYear(y+1);
    return {key:dkey(d), matched:m[0]};
  }
  if((m=s.match(/\bin\s+(\d{1,3})\s*(day|week|month)s?\b/))){
    const n=+m[1], mult=m[2]==='day'?1:m[2]==='week'?7:30;
    return {key:addDays(today(),n*mult), matched:m[0]};
  }
  if((m=s.match(/\bnext\s+(week|month)\b/)))
    return {key:addDays(today(), m[1]==='week'?7:30), matched:m[0]};
  if((m=s.match(new RegExp('\\b(?:by|on|this|next)\\s+('+DOWS.join('|')+')\\b')))){
    const want=DOWS.indexOf(m[1]); const d=parseKey(today());
    let delta=(want-d.getDay()+7)%7; if(delta===0)delta=7;
    return {key:addDays(today(),delta), matched:m[0]};
  }
  if(/\btomorrow\b/.test(s)) return {key:addDays(today(),1), matched:'tomorrow'};
  if(/\btoday\b/.test(s))    return {key:today(), matched:'today'};
  return null;
}
export function parseClock(text){
  const m=text.toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if(!m) return null;
  let h=+m[1]%12; if(m[3]==='pm')h+=12;
  return {min:h*60+(+(m[2]||0)), matched:m[0]};
}
export function parseMoney(text){
  const m=text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k|m)?/i);
  if(m) return Math.round(parseFloat(m[1].replace(/,/g,''))*(/k/i.test(m[2]||'')?1000:/m/i.test(m[2]||'')?1e6:1));
  const k=text.match(/\b(\d+(?:\.\d+)?)\s?k\b/i);
  return k?Math.round(parseFloat(k[1])*1000):null;
}

/* ---------- the classifier ---------- */
export const RULES = [
  {t:'contingent', re:/\bif\b.*\b(comes? through|happens|works out|goes through|closes|lands)\b|\bcontingent\b|\bonce (?:we|i|they|it)\b.*\b(close|sell|move|get)\b|\bin case\b|\bpending whether\b/i, w:9},
  {t:'decision',   re:/\bshould i\b|\bwhether (?:to|or)\b|\bdecide (?:whether|if|between|on)\b|\bfigure out (?:if|whether|which)\b|\blook into\b|\bresearch\b|\bcompare\b.*\bvs\b|\bopen question\b/i, w:8},
  {t:'threshold',  re:/\bsav(?:e|ing) (?:up )?(?:for|toward)\b|\bput aside\b|\bset aside\b|\bpay (?:off|down)\b|\bbuild (?:up )?(?:an? )?(?:emergency )?fund\b|\$[\d,]/i, w:8},
  {t:'pipeline',   re:/\bappl(?:y|ications?|ying)\b|\binterviews?\b|\brecruiters?\b|\bjob (?:search|hunt)\b|\boutreach\b|\breach out to\b|\bcold (?:email|call)\b|\bsubmit .* to\b|\bpitch(?:es|ing)? \b/i, w:7},
  {t:'maintenance',re:/\bstay on top of\b|\bmaintain\b|\bkeep (?:it |the |my )?\w+ (?:clean|tidy|up to date|current)\b|\bconsistency\b|\bdon'?t let\b|\blog\b|\bstay in touch\b|\bkeep up with\b/i, w:6},
  {t:'habit',      re:/\bpractic(?:e|ing)\b|\bconsistently\b|\bevery ?day\b|\bdaily\b|\b(?:each|every) (?:week|morning|night|evening)\b|\bx ?\/ ?week\b|\b\d+ ?(?:times|x) a week\b|\broutine\b|\bhabit\b|\bwork ?out\b|\brun(?:ning)? \d/i, w:6},
  {t:'deadline',   re:/\bexam\b|\bcert(?:ification|ified)?\b|\bretake\b|\bdeadline\b|\bdue\b|\bby (?:the )?(?:end of|eod)\b|\btest on\b|\bsit (?:the|for)\b/i, w:6},
  {t:'milestone',  re:/\bship\b|\bbuild\b|\bimplement\b|\blaunch\b|\bdeploy\b|\brefactor\b|\bmigrate\b|\bmvp\b|\bv\d\b|\bfinish (?:the|my|building)\b|\bstand up\b|\bwrite (?:the|a) (?:api|service|module|docs?)\b/i, w:5}
];
export const ACTION_VERBS=/^(get|buy|call|email|text|pick up|drop off|send|book|schedule|order|return|renew|cancel|pay|fix|clean|mail|print|sign|register|replace|refill|water|charge)\b/i;

/* ---------- learned corrections ----------
   The confirm-type gate was already collecting the right answer and then throwing it
   away on clearGate(). Keeping it is the difference between a fixed regex table and
   something that fits one person's vocabulary after a month. Nothing here overrides
   the rules outright — a correction is just another scorer, weighted by how often
   it has been repeated. */
export const STOPWORDS=new Set(('a an the to for of and or my me i in on at with by is it that this these those then '+
  'than get got do doing done make made new some any all up down out off over about into from as be been '+
  'next last week day days month year every each more less very just now again still keep').split(' '));

export function termsOf(text){
  return [...new Set(String(text||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(w=>w.length>2 && !STOPWORDS.has(w)))];
}
/* Similarity has to be symmetric. Scoring hits against the stored entry alone means
   a lesson from a long phrase can never be matched by a short capture; scoring
   against the smaller set alone means one incidental shared word drags in a long
   lesson ("the board meeting" matching "reconcile the quarterly numbers before the
   board meeting"), and a one-word lesson hijacks everything containing that word.
   Dice penalises both directions at once. */
export function overlap(a,b){
  const B=new Set(b);
  const hits=a.filter(t=>B.has(t)).length;
  return {hits, dice: (2*hits)/Math.max(1, a.length+b.length), a:a.length, b:b.length};
}
/* two shared terms, or a one-word lesson meeting a phrase short enough for it to mean something */
export const matches = o => o.dice>=0.6 && (o.hits>=2 || Math.min(o.a,o.b)===1);

export function learnType(text,type){
  if(!TYPE[type]) return;
  const terms=termsOf(text); if(!terms.length) return;
  const L=DB.meta.learned=DB.meta.learned||[];
  // same type, largely the same words = one lesson reinforced, not a duplicate
  const hit=L.find(e=>e.type===type && overlap(e.terms,terms).dice>=0.6);
  if(hit){ hit.terms=[...new Set(hit.terms.concat(terms))].slice(0,14); hit.n++; }
  else L.push({terms:terms.slice(0,14), type, n:1});
  // only a near-identical phrase erodes an earlier lesson — otherwise teaching "guitar"
  // would silently wipe what you'd already taught about "practice guitar"
  for(const e of L) if(e.type!==type && overlap(e.terms,terms).dice>=0.8) e.n=Math.max(0,e.n-1);
  DB.meta.learned=L.filter(e=>e.n>0).slice(-200);
}
/* Capped at 8 — below the heaviest rule (9) on purpose. A correction should tilt a
   close call, not overrule an unambiguous phrase. */
export function learnedScore(text){
  const terms=termsOf(text); const out={};
  if(!terms.length) return out;
  for(const e of (DB.meta.learned||[])){
    const o=overlap(e.terms,terms);
    if(!matches(o)) continue;
    const cur = out[e.type] || (out[e.type]={score:0, dice:0});
    cur.score = Math.min(8, cur.score + 3 + o.dice*4 + Math.min(2,e.n));
    cur.dice  = Math.max(cur.dice, o.dice);
  }
  return out;
}

export function classify(text, opts={}){
  const s=(text||'').trim(); const words=s.split(/\s+/).filter(Boolean);
  const when=parseWhen(s);
  const scores={};
  for(const r of RULES) if(r.re.test(s)) scores[r.t]=(scores[r.t]||0)+r.w;

  // corrections you've already made, scored alongside the rules
  const learned=learnedScore(s);
  for(const t in learned) scores[t]=(scores[t]||0)+learned[t].score;

  // known project names strongly imply milestone
  const proj=(DB&&DB.meta.projects||[]).find(p=>p&&new RegExp('\\b'+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(s));
  if(proj) scores.milestone=(scores.milestone||0)+7;

  // an explicit date pushes toward deadline unless it already reads as a habit
  if(when && !scores.habit && !scores.maintenance) scores.deadline=(scores.deadline||0)+4;

  // short single action with no date/recurrence language = plain task
  const plain = words.length<=6 && !when && Object.keys(scores).length===0;
  if(plain || (ACTION_VERBS.test(s) && words.length<=8 && !when)) scores.task=(scores.task||0)+6;

  let type = Object.keys(scores).sort((a,b)=>scores[b]-scores[a])[0]
          || (words.length<=6 ? 'task' : 'milestone');
  if(opts.force) type=opts.force;

  const spec=TYPE[type];
  // "taught" means near-identical to something you corrected — the case where being
  // asked again is the actual annoyance. A loose match still scores, but still asks.
  const taught = !!learned[type] && learned[type].dice>=0.8;
  /* Orthogonal to the type scoring above: a template describes the shape of the
     doing, not what kind of goal it is. "dinner with Ma Thursday" is a task whose
     step costs three hours and $96, and those two readings never compete. */
  const tmpl = matchTemplate(s);
  const out={ type, project:proj||null, when, clock:parseClock(s), money:parseMoney(s),
              scores, gates:[], learned:taught, tmpl };
  // gated types: queue the question, never block capture
  if(spec.gate==='deadline' && !when)
    out.gates.push({id:uid(),kind:'deadline',q:'What is the hard date for "'+s+'"?'});
  if(spec.gate==='trigger')
    out.gates.push({id:uid(),kind:'trigger',q:'What condition activates "'+s+'"? Until then it stays dormant.'});
  if(spec.gate==='decision' && !opts.force)
    out.gates.push({id:uid(),kind:'decision',q:'Is "'+s+'" a decision to research, or a goal to execute?'});
  // once you've taught it this shape of phrase, it stops asking
  if(spec.review && !taught)
    out.gates.push({id:uid(),kind:'confirm-type',q:'Filed "'+s+'" as '+spec.label.toLowerCase()+'-type. Right call?'});
  /* Never applied without being asked. A footprint puts hours into the day's
     capacity and money into the week's budget, and guessing at either on a
     keyword match is how an app stops being believed. */
  if(tmpl) out.gates.push({id:uid(), kind:'footprint', tmpl:tmpl.key,
    q:'Looks like '+tmpl.label.toLowerCase()+' — add the usual footprint?'});
  return out;
}

/* ===================== [SECTION: ENGINE] ===================== */
export function shortName(g){
  return g.title.replace(/^(practice|keep up with|stay on top of|work on|save (?:up )?for|learn)\s+/i,'')
                .replace(/\s+(every ?day|daily|consistently|weekly)\b.*$/i,'').trim() || g.title;
}
export const cadenceOf = g => (g.cadenceDays!=null ? g.cadenceDays : TYPE[g.type].cadence);

/* ---- build a goal from a captured phrase + classification ---- */
export function buildGoalFrom(text, cls){
  const spec=TYPE[cls.type];
  const g=newGoal({title:text.trim(), type:cls.type, gates:cls.gates.slice()});
  g.smart.outcome = text.trim();
  g.smart.metricName = spec.metric||'';
  if(cls.when) g.smart.deadline = cls.when.key;
  if(cls.type==='habit'||cls.type==='maintenance') g.smart.deadlineSoft=true;
  /* A literal $NN is either a target or a cost, never both — books, reps and
     dollars-toward-a-goal are different units, and conflating them would let a
     savings target read as this week's spending or the other way round.

     What decides it is the language, not the type. The classifier reads a bare
     dollar sign as threshold-ish (see RULES), so "replace the charger $40" can
     come out threshold-typed on the strength of the `$` alone — and that number
     is plainly a cost, not a target. Only saving language makes it a target. */
  const moneyIsCost = !!cls.money && !MONEY_TARGET.test(text);
  if(cls.money && !moneyIsCost){ g.smart.target=cls.money; g.smart.metricUnit='$'; g.smart.metricName='amount saved'; }
  if(cls.type==='pipeline'){ g.stages=PIPELINE_STAGES.slice(); }
  if(cls.type==='milestone' && cls.project) g.notes='Project: '+cls.project;

  const t=newThread({rel:spec.rel, name: cls.type==='pipeline'?'Pipeline':'Main'});
  g.threads.push(t);

  // contingent goals stay dormant until the trigger fires; nothing is scheduled
  if(cls.type==='contingent'){ t.status='dormant'; return g; }

  const first = firstStepFor(g,t,cls);
  if(first){
    /* A literal amount needs no template to land — that is the whole point of
       typing it. The template offer is still queued separately. */
    if(moneyIsCost){
      ensureFootprint(first).costs.push(normCost({label:'Estimated cost', amount:cls.money}));
    }
    t.steps.push(first);
  }
  return g;
}

export function firstStepFor(g,t,cls){
  switch(g.type){
    case 'habit':       return newStep('Next session: '+shortName(g),{auto:true,quadrant:'q2'});
    case 'maintenance': return newStep('Next '+shortName(g),{auto:true,quadrant:'q2'});
    case 'threshold':   return newStep('This period’s contribution'+(g.smart.target?' toward '+money(g.smart.target):''),{auto:true,quadrant:'q2'});
    case 'pipeline':    return newStep('Send this week’s batch',{auto:true,quadrant:'q2'});
    case 'decision':    return newStep('Research / decide: '+shortName(g),{auto:true,quadrant:'q2'});
    case 'milestone':   return newStep(g.backlog.length ? g.backlog.shift()
                          : 'Break '+shortName(g)+' into a backlog',{auto:true,quadrant:'q2'});
    case 'task':        return newStep(g.title,{quadrant: cls&&cls.when?'q1':'q3'});
    // a deadline goal's first move is always the same: work out the path to the date.
    // every step after that has to be defined deliberately (see autoNextTitle).
    case 'deadline':    return newStep('Map the steps back from '+(g.smart.deadline?fmtDate(g.smart.deadline):'the deadline'),{auto:true,quadrant:'q2'});
    default:            return null;
  }
}

/* ===================== [SECTION: SUBTASKS] =====================
   Exactly one level: goal -> thread -> step -> sub. Unbounded nesting would mean
   every renderer, currentStep() and the whole item stream have to recurse, and the
   matrix would fill with items that aren't really commitments. A sub is a checklist
   line under a step — it never becomes a card, never gets its own calendar slot,
   and never competes to be the thread's next move. The step stays the unit of work.
   ------------------------------------------------------------------ */
export const subs = s => (s && Array.isArray(s.subs)) ? s.subs : [];
export function subProgress(s){
  const a=subs(s); const done=a.filter(x=>x.done).length;
  return {done, total:a.length, frac: a.length?done/a.length:0, any:a.length>0};
}
/* undone first, but stable within each half so a deliberate order survives */
export function sortSubs(s){
  if(!s||!Array.isArray(s.subs)) return;
  const open=s.subs.filter(x=>!x.done), shut=s.subs.filter(x=>x.done);
  s.subs=open.concat(shut);
}
export function addSub(g,t,s,title){
  if(!title || !String(title).trim()) return null;
  if(!Array.isArray(s.subs)) s.subs=[];
  const sub=newSub(title); s.subs.push(sub); sortSubs(s); touchThread(t); save();
  return sub;
}
export function moveItem(arr,i,dir){
  const j=i+dir;
  if(i<0||i>=arr.length||j<0||j>=arr.length) return false;
  const [x]=arr.splice(i,1); arr.splice(j,0,x); return true;
}
/* Ticking the last one finishes the step through the normal path, so the successor
   is generated, logged and re-booked exactly as it would be by any other route. */
export function toggleSub(gid,tid,sid,subId){
  const f=findStep(sid); if(!f) return {};
  const {goal,thread,step}=f;
  const sub=subs(step).find(x=>x.id===subId); if(!sub) return {};
  checkpoint(sub.done?'unticking that subtask':'ticking that subtask');
  sub.done=!sub.done; sub.doneAt=sub.done?new Date().toISOString():null;
  sortSubs(step); touchThread(thread);
  const p=subProgress(step);
  if(sub.done && p.total && p.done===p.total && !step.done){
    const r=completeStep(goal,thread,step);
    save(); return {completed:true, ...r};
  }
  save(); return {completed:false};
}
/* Dropping a subtask on the calendar can't schedule the sub — a sub has no slot, by
   design — so it schedules the parent step and moves that sub to the front of the
   list. The gesture means "this is the bit I'm doing then", and the checklist order
   is where that intent lives. */
export function floatSub(step,subId){
  const a=subs(step); const i=a.findIndex(x=>x.id===subId);
  if(i<0) return false;
  const [x]=a.splice(i,1); a.unshift(x); sortSubs(step); return true;
}

/* An unfinished sub is still work; dropping it on the floor because its parent got
   ticked is how a checklist quietly loses things. It rides forward instead. */
export function carrySubs(prev,next){
  const open=subs(prev).filter(x=>!x.done);
  if(!open.length || !next) return 0;
  next.subs=(next.subs||[]).concat(open.map(x=>newSub(x.title)));
  prev.subs=subs(prev).filter(x=>x.done);
  return open.length;
}

/* A re-booked gym session that lost its lead, its lag and its cost lines would
   make the whole feature evaporate after one completion. The footprint rides
   forward; the prereqs ride forward RESET, because "reservation made" was true of
   last Thursday's dinner and is not yet true of next Thursday's. */
export function carryFootprint(prev,next){
  const f=prev&&prev.footprint; if(!f||!next) return false;
  next.footprint = {
    lead:f.lead, lag:f.lag, tmpl:f.tmpl,
    costs:f.costs.map(c=>normCost({label:c.label, amount:c.amount, catId:c.catId})),
    prereqs:f.prereqs.map(p=>normPrereq({title:p.title, leadDays:p.leadDays}))
  };
  return true;
}

/* ---- prerequisites ----
   One implementation, called by the ribbon resolver and the check-in alike, for
   the same reason every other fix is: a rule with two call sites is a rule with
   two behaviours a release later. */
export function togglePrereq(stepId, prereqId){
  const f=findStep(stepId); if(!f) return null;
  const p=fp(f.step).prereqs.find(x=>x.id===prereqId); if(!p) return null;
  p.done=!p.done; p.doneAt=p.done?new Date().toISOString():null;
  touchThread(f.thread); save();
  return p;
}
/* Applying a template is one action and one undo step, and it fills gaps only —
   see applyTemplate(). */
export function applyFootprint(stepId, tmplKey){
  const f=findStep(stepId); if(!f) return null;
  const r=applyTemplate(f.step, tmplKey);
  if(r) save();
  return r;
}

/* ---- the rule: completing a step must produce the next one ---- */
export function completeStep(g,t,s,opts={}){
  s.done=true; s.doneAt=new Date().toISOString();
  /* The optional measurement, if there is one. Skipping the timer leaves the
     estimate exactly as it was; nothing here blocks, delays or asks about
     completion, which is the only way an optional capture stays optional. */
  {
    const mins=actualMins(s), key=fp(s).tmpl;
    if(mins && key){ recordSample(key, mins); proposeFromDuration(key); }
  }
  if(opts.outcome) s.outcome=opts.outcome;
  touchThread(t);
  logIt('done',{goalId:g.id,threadId:t.id,stepId:s.id,text:s.title,dateKey:today()});
  if(s.eventId){ const e=eventById(s.eventId); if(e) e.done=true; }

  if(g.type==='task'){ finishGoal(g,'task done'); save(); return {next:null,needsDefine:false}; }
  if(g.type==='decision'){ t.status='done'; g.gates.push({id:uid(),kind:'resolve-decision',
      q:'"'+g.title+'" — what did you land on? Convert it into a goal, or close it out.'}); save(); return {next:null,needsDefine:false}; }

  // conditional: which way did it resolve?
  if(t.rel==='conditional' && t.branches.length && !opts.branch){
    t.needsBranch=true; save(); return {next:null,needsDefine:true,reason:'branch'};
  }
  let title=null;
  if(opts.branch){ title=opts.branch.next; t.needsBranch=false; }
  else title = autoNextTitle(g,t,s);

  if(!title){ save(); return {next:null,needsDefine:true,reason:'define'}; }
  const ns=newStep(title,{auto:true,quadrant:s.quadrant});
  const carried=carrySubs(s,ns);          // unfinished subtasks ride forward
  carryFootprint(s,ns);                   // and so does what it really costs
  t.steps.push(ns);

  /* A cyclical goal that was on the calendar goes straight back on it, same slot,
     one cadence later. Without this a daily habit is a scheduling chore forever —
     which is the friction that makes people stop using the thing. */
  if(TYPE[g.type].rel==='cyclical' && s.eventId){
    const prev=eventById(s.eventId);
    if(prev){
      const step=Math.max(1, cadenceOf(g)||7);
      let nk=addDays(prev.dateKey, step);
      if(nk<=today()) nk=addDays(today(), step);          // don't re-book something already past
      const ev=CAL.anchor(g,t,ns,nk,prev.start,prev.dur);
      if(prev.allDay){ ev.allDay=true; ev.start=0; ev.dur=1440; }
      ns.autoScheduled=true;
    }
  }
  save();
  return {next:ns,needsDefine:false,carried};
}

export function autoNextTitle(g,t,prev){
  switch(g.type){
    case 'habit':       return 'Next session: '+shortName(g);
    case 'maintenance': return 'Next '+shortName(g);
    case 'threshold':   return 'This period’s contribution'+(g.smart.target?' toward '+money(g.smart.target):'');
    case 'pipeline':{
      const i=(g.stages||PIPELINE_STAGES).indexOf(t.stage||'');
      if(t.stage && i>-1 && i<(g.stages||PIPELINE_STAGES).length-1){
        t.stage=(g.stages||PIPELINE_STAGES)[i+1];
        return 'Advance to '+t.stage+': '+t.name;
      }
      return 'Send this week’s batch';
    }
    case 'milestone':   return g.backlog.length ? g.backlog.shift() : null;
    default:            return null;   // deadline & anything bespoke: define it deliberately
  }
}
export function money(n){ return '$'+Number(n).toLocaleString(); }
/* The phrases that mean an amount is something you are working TOWARD rather
   than something you are about to spend. */
export const MONEY_TARGET = /\bsav(?:e|ing)\b|\bput aside\b|\bset aside\b|\bpay (?:off|down)\b|\bfund\b|\btoward\b|\bsave up\b/i;

/* ---- item stream: current steps + tasks, in one shape the views can render ---- */
/* No longer memoised per render pass. The cache existed because nothing knew
   when the DB changed, which is why it had to be null outside render() — it
   would otherwise hand stale answers to anything that mutated and read back
   without saving. Components read activeItemsC in src/signals.js instead, which
   recomputes on change rather than on a pass boundary. */
export function activeItems(){ return _activeItems(); }
export function _activeItems(){
  const out=[];
  for(const g of liveGoals()){
    for(const t of g.threads){
      if(t.status==='dormant'||t.status==='done') continue;
      const s=currentStep(t); if(!s) continue;
      /* An event Google no longer has keeps its link (so the signal can say what
         happened) but stops behaving like a slot — otherwise the step would sit
         on a day it isn't booked for and never reach the unscheduled tray. */
      const held = s.eventId?eventById(s.eventId):null;
      const ev = (held && !gDead(held)) ? held : null;
      out.push({goal:g, thread:t, step:s, ev, dateKey:ev?ev.dateKey:null, start:ev?ev.start:null,
                quadrant:s.quadrant, blocked:t.status==='blocked', lostSlot:!!(held&&!ev)});
    }
  }
  return out;
}
export function itemsOn(k){ return activeItems().filter(i=>i.dateKey===k); }
export function unscheduledItems(){ return activeItems().filter(i=>!i.dateKey && !i.blocked); }
export function overdueItems(){ const t=today(); return activeItems().filter(i=>i.dateKey && i.dateKey<t); }

/* ---- silence-as-signal: any thread quiet past its cadence surfaces itself ---- */
export function daysQuiet(t){
  const last=t.lastMovement||t.createdAt||new Date().toISOString();
  return Math.max(0, daysBetween(dkey(new Date(last)), today()));
}
/* ---- neglect should make this quieter, not louder ----------------------
   Nagging that hasn't worked in three full cadences isn't going to start working;
   all it does is grow the ribbon until the ribbon itself gets ignored, which takes
   the signals that *do* matter down with it. Past that point a thread goes quiet:
   it stops emitting, drops off the check-in agenda, and collapses into a single
   "gone quiet" chip. Any movement brings it back on its own, because this is
   computed from lastMovement rather than stored — there's no flag to get stuck. */
export const HUSH_AT=3;
export const quietLimit = g => (g.type==='decision' ? cadenceOf(g)*2 : cadenceOf(g));
export function hushed(g,t){
  if(t.status==='blocked'||t.status==='dormant'||t.status==='done') return false;
  const lim=quietLimit(g);
  return lim>0 && daysQuiet(t) > lim*HUSH_AT;
}
export const GATE_SHORT={ deadline:'Needs a hard date', trigger:'Needs a trigger condition',
  decision:'A decision, or a goal?', 'confirm-type':'Confirm the type',
  'resolve-decision':'Decision needs resolving', footprint:'Add the usual footprint?' };

/* See activeItems(): uncached here, computed for components in src/signals.js. */
export function signals(){ return _signals(); }
export function _signals(){
  const out=[]; const T=today();
  for(const g of liveGoals()){
    // gates used to be answerable only inside the check-in; they surface here now
    for(const gate of (g.gates||[]))
      out.push({sev:'warn',kind:'gate',goal:g,thread:g.threads[0],gate,
        days:g.threads[0]?daysQuiet(g.threads[0]):0, text:GATE_SHORT[gate.kind]||'Question waiting'});

    for(const t of g.threads){
      if(t.status==='dormant'||t.status==='done') continue;
      const cad=cadenceOf(g);
      const q=daysQuiet(t);
      if(t.status==='blocked'){
        const bd = t.blockedSince ? daysBetween(dkey(new Date(t.blockedSince)),T) : q;
        if(bd>=7) out.push({sev:'warn',kind:'blocked',goal:g,thread:t,days:bd,
          text:'Blocked '+bd+'d — waiting on '+(t.blockedOn||'someone')});
        continue;
      }
      if(hushed(g,t)){
        out.push({sev:'mute',kind:'hushed',goal:g,thread:t,days:q,
          text:'Gone quiet after '+q+'d — no longer nagging'});
        continue;                                   // and nothing else from this thread
      }
      if(t.needsBranch) out.push({sev:'hard',kind:'branch',goal:g,thread:t,days:q,
        text:'Branch unresolved — which way did it go?'});
      const s=currentStep(t);
      /* A step whose event was deleted in Google raises this same signal rather
         than being silently unanchored. Dropping a commitment has to be something
         you did, not something the sync did to you while you weren't looking. */
      const held = s && s.eventId ? eventById(s.eventId) : null;
      const lost = !!(s && s.eventId && (!held || gDead(held)));
      if(!s) out.push({sev:'hard',kind:'nostep',goal:g,thread:t,days:q, text:'No next step defined'});
      else if((!s.eventId || lost) && g.type!=='task') out.push({sev:'warn',kind:'unscheduled',goal:g,thread:t,days:q,
        text: lost ? 'Removed from Google Calendar — not booked any more' : 'Next step not on the calendar'});
      else if(held){
        if(held.dateKey<T) out.push({sev:'hard',kind:'slipped',goal:g,thread:t,days:daysBetween(held.dateKey,T),
          text:'Slipped '+daysBetween(held.dateKey,T)+'d past its slot'}); }
      /* A prereq inside its lead-days window and not done. Nothing is said outside
         the window, and nothing at all for an unanchored step: without a date
         there is no window to be inside, and that case is already the
         `unscheduled` signal's — two chips for one missing decision is how a
         ribbon stops being read. */
      if(s && held && !lost && !gDead(held)){
        for(const d of duePrereqs(s, held, T))
          out.push({sev:d.late?'hard':'warn', kind:'prereq', goal:g, thread:t, step:s,
            prereq:d.prereq, ev:held, ref:d.prereq.id, days:daysBetween(T,held.dateKey),
            text:'Not done: '+d.prereq.title+' · '+fmtDate(held.dateKey)});
      }
      // decisions get a long leash and only nudge at 2x cadence
      const limit = quietLimit(g);
      if(limit>0 && q>limit) out.push({sev:q>limit*2?'hard':'warn',kind:'quiet',goal:g,thread:t,days:q,
        text:'No movement in '+q+'d'});
    }
    if(g.type==='deadline' && g.smart.deadline){
      const left=daysBetween(T,g.smart.deadline);
      if(left>=0 && left<=14) out.push({sev:left<=5?'hard':'warn',kind:'deadline',goal:g,thread:g.threads[0],days:left,
        text:left===0?'Due today':(left+'d to deadline')});
      if(left<0) out.push({sev:'hard',kind:'deadline',goal:g,thread:g.threads[0],days:left,text:'Deadline passed '+Math.abs(left)+'d ago'});
    }
  }
  /* Money, once a week rather than once a thread. This is a signal and not a
     scheduling constraint on purpose: suggestDay() places on time and does not
     steer away from an expensive week, because "you cannot afford Thursday" is a
     judgment you make, not one the calendar makes for you.

     Two rungs, both off numbers that already exist: warn once the week's
     committed spend passes what was allocated, hard once it passes the weekly
     budget itself, which is the real ceiling. */
  const ws=startOfWeek(T), com=committedWeek(ws);
  const B=DB.meta.budget||{};
  const alloc=(B.cats||[]).reduce((n,c)=>n+(+c.amount||0),0);
  const weekly=+B.weekly||0;
  if(alloc>0 && com.total>alloc)
    out.push({sev:(weekly>0 && com.total>weekly)?'hard':'warn', kind:'overbudget',
      goal:null, thread:null, ref:ws, days:0, label:'This week',
      text:money(com.total)+' committed against '+money(alloc)+' allocated'});

  /* A proposed change to a template's defaults. Muted severity: it is an offer
     sitting at the bottom of the ribbon, not drift that needs answering. */
  for(const gate of tmplGates())
    out.push({sev:'mute', kind:'tmpl', goal:null, thread:null, gate, ref:gate.tmpl,
      days:0, label:(tmplGet(gate.tmpl)||{label:'Template'}).label, text:gate.q});

  // strongest first, then most overdue — minus anything explicitly snoozed
  const muted=new Set((DB.meta.snoozed||[]).filter(x=>x.until>today()).map(x=>x.k));
  for(const s of out) s.key=sigKey(s);
  return out.filter(s=>!muted.has(s.key))
            .sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev] || b.days-a.days);
}
export const SEV_RANK={hard:0, warn:1, mute:2};
/* `ref` disambiguates several signals of one kind against one subject — three
   unmet prereqs on the same step are three chips, not one that snoozes all of
   them — and carries the subject for the signals that have no goal at all. */
export function sigKey(s){
  const base = s.gate ? s.gate.id : s.thread ? s.thread.id : s.goal ? s.goal.id : (s.ref||'-');
  return s.kind+':'+base+(s.ref&&(s.gate||s.thread||s.goal)?':'+s.ref:'');
}
/** What a chip calls the thing it is about. Not every signal has a goal. */
export function sigLabel(s){ return s.goal ? shortName(s.goal) : (s.label||'Ply'); }

/* Snoozing mutes the ribbon only. checkinAgenda() doesn't consult signals(), so a
   snoozed thread still gets asked about at the weekly check-in — muting the nag
   is not the same as deciding, and only the check-in is allowed to close things. */
export function snoozeSignals(keys,label){
  checkpoint(label||'snooze');
  const until=addDays(today(),7);
  DB.meta.snoozed=(DB.meta.snoozed||[]).filter(x=>!keys.includes(x.k));
  for(const k of keys) DB.meta.snoozed.push({k,until});
  bus.resetTransientUI(); save(); bus.render();
  toast((keys.length>1?keys.length+' signals':'Signal')+' snoozed 7d — the check-in still asks.');
}

/* ---- gates queued for the check-in ---- */
export function openGates(){
  const out=[];
  for(const g of liveGoals()) for(const gate of (g.gates||[])) out.push({goal:g,gate});
  return out;
}
export function clearGate(g,gateId){ g.gates=(g.gates||[]).filter(x=>x.id!==gateId); save(); }

/* ---- check-in cadence ---- */
export function lastDowKey(dow){
  const d=parseKey(today()); const back=(d.getDay()-dow+7)%7;
  return addDays(today(),-back);
}
export function checkinDue(){
  const m=DB.meta;
  if(!m.lastCheckin) return true;
  if(m.checkinMode==='elapsed') return daysBetween(m.lastCheckin,today())>=m.checkinEveryDays;
  return m.lastCheckin < lastDowKey(m.checkinDow);
}
/* everything the check-in will walk through */
export function checkinAgenda(){
  const since = DB.meta.lastCheckin || addDays(today(),-7);
  const moved = new Set(DB.log.filter(l=>l.kind==='done' && (l.dateKey||'')>=since).map(l=>l.threadId));
  const quiet=[], blocked=[], nostep=[], unsched=[], branch=[], hush=[];
  for(const g of liveGoals()){
    for(const t of g.threads){
      if(t.status==='done'||g.type==='task') continue;
      if(t.status==='dormant') continue;                 // contingent: stays silent, by design
      if(t.status==='blocked'){ blocked.push({goal:g,thread:t}); continue; }
      // gone quiet past 3x cadence: off the agenda too, or the queue just grows
      if(hushed(g,t)){ hush.push({goal:g,thread:t,days:daysQuiet(t)}); continue; }
      if(t.needsBranch){ branch.push({goal:g,thread:t}); continue; }
      const s=currentStep(t);
      if(!s){ nostep.push({goal:g,thread:t}); continue; }
      if(!moved.has(t.id)) quiet.push({goal:g,thread:t,step:s,days:daysQuiet(t)});
      const bk = s.eventId ? eventById(s.eventId) : null;
      if(!s.eventId || !bk || gDead(bk)) unsched.push({goal:g,thread:t,step:s});
    }
  }
  return {gates:openGates(), quiet, blocked, nostep, unsched, branch, hush, since};
}

/* ---- follow-through: planned vs actually done ---- */
export function followThrough(goalId,days=28){
  const from=addDays(today(),-days);
  const L=DB.log.filter(l=>(l.dateKey||dkey(new Date(l.ts)))>=from && (!goalId||l.goalId===goalId));
  const planned=L.filter(l=>l.kind==='planned').length;
  const done=L.filter(l=>l.kind==='done').length;
  return {planned,done,rate:planned?clamp(Math.round(done/planned*100),0,100):(done?100:0)};
}
export function streak(goalId){
  const days=new Set(DB.log.filter(l=>l.goalId===goalId&&l.kind==='done').map(l=>l.dateKey||dkey(new Date(l.ts))));
  let n=0,k=today();
  if(!days.has(k)) k=addDays(k,-1);
  while(days.has(k)){ n++; k=addDays(k,-1); }
  return n;
}


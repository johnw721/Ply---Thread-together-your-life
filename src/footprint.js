/* ===================== [SECTION: FOOTPRINTS] =====================
   A step's true cost is more than the slot it occupies. `dur` is the visible
   commitment; the footprint is everything around it — the travel and the change
   of clothes before, the shower and the write-up after, the reservation that had
   to be made two days earlier, and the money the whole thing spends.

   Three separate ideas, deliberately not merged:

   - lead/lag are *time*, and they are presentational plus counted in capacity.
     One event stays one event; a shadow is never a second DB.events row, because
     the moment it were, unanchoring, Google sync and the undo stack would all
     have two things to keep in step instead of one.
   - prereqs are *conditions*, and they raise signals. A prereq is not a subtask:
     it never gets a calendar slot and never reaches the matrix, because "book the
     table" is not the next move on the thread — eating the dinner is.
   - costs are *money*, and they land in the weekly budget as committed spend
     against what was allocated.

   This module is deliberately close to a leaf: it reads DB and events and knows
   nothing about CAL, the engine or any view, so cal.ts can ask it how wide an
   event really is without importing half the app back.

   MONEY IS ESTIMATE-ONLY, ON PURPOSE. There is an actual-duration capture below
   and there is no actual-cost capture to match it. That is a deferral, not an
   oversight: the README has always described the budget as an allocation rather
   than a ledger, and an "actual spend" field is the first half of a ledger — it
   would want receipts, splits, refunds and a per-week history, none of which
   exist. Time can be measured with one button because a step already has a
   beginning and an end. Money can't.
------------------------------------------------------------------------------ */
import { DB, eventsOn, stepById } from './store.js';
import { rescheduleDrift } from './reschedule.js';
import { addDays, uid } from './util.js';

/* ---------- the built-in library ----------
   Eight kinds, chosen to cover the shapes rather than to be exhaustive:
   `deep-work` and `client-call` prove the no-money path renders; `flight` carries
   no `dur` at all (a flight's own length is never guessable) and is the one where
   lead dwarfs the slot; `car-service` is the only three-day prereq and the only
   lag longer than the slot; `gym` has no cost line because a membership is not a
   per-event commitment and putting one here would inflate every week.

   `cat` on a cost line is a category *name*, not an id: categories are per-user
   rows with generated ids, so a template cannot reference one. It resolves by
   name at apply time and degrades to uncategorised rather than guessing. */
export const TEMPLATES = [
  { key:'gym', label:'Gym / training', lead:20, dur:60, lag:35,
    kw:['gym','workout','work out','lift','training session','strength session','run','spin class'],
    prereqs:[{title:'Kit packed', leadDays:1}],
    costs:[] },

  { key:'dinner-out', label:'Dinner out', lead:25, dur:90, lag:25,
    kw:['dinner out','dinner with','dinner at','restaurant','lunch with','drinks with','date night'],
    prereqs:[{title:'Reservation made', leadDays:2}],
    costs:[{label:'Meal', amount:60, cat:'Food'},
           {label:'Ride there', amount:18, cat:'Transport'},
           {label:'Ride back', amount:18, cat:'Transport'}] },

  { key:'flight', label:'Flight', lead:180, dur:0, lag:60,
    kw:['flight','fly to','flying to','airport','red-eye','board at'],
    prereqs:[{title:'Checked in', leadDays:1},
             {title:'Bag packed', leadDays:1},
             {title:'Airport ride booked', leadDays:2}],
    costs:[{label:'Airfare', amount:250, cat:'Travel'},
           {label:'Airport ride', amount:40, cat:'Transport'},
           {label:'Bag fee', amount:35, cat:'Travel'}] },

  { key:'client-call', label:'Client call', lead:15, dur:30, lag:15,
    kw:['client call','call with','sync with','standup','stand-up','demo for','interview with','1:1'],
    prereqs:[{title:'Agenda sent', leadDays:1}],
    costs:[] },

  { key:'errand', label:'Errand', lead:15, dur:30, lag:15,
    kw:['errand','pick up','drop off','groceries','post office','hardware store','bank'],
    prereqs:[{title:'List written', leadDays:0}],
    costs:[{label:'Spend', amount:40, cat:'Household'}] },

  { key:'doctor-visit', label:'Doctor visit', lead:30, dur:30, lag:30,
    kw:['doctor','dentist','clinic','checkup','check-up','physio','appointment at'],
    prereqs:[{title:'Appointment confirmed', leadDays:2},
             {title:'Card / referral to hand', leadDays:1}],
    costs:[{label:'Copay', amount:35, cat:'Health'}] },

  { key:'car-service', label:'Car service', lead:20, dur:60, lag:40,
    kw:['oil change','car service','mechanic','tires','tyres','inspection','mot'],
    prereqs:[{title:'Appointment booked', leadDays:3}],
    costs:[{label:'Service', amount:80, cat:'Transport'}] },

  { key:'deep-work', label:'Deep work block', lead:10, dur:90, lag:10,
    kw:['deep work','focus block','writing block','draft','study block','revision'],
    prereqs:[],
    costs:[] }
];
/* Which fields the Settings editor and a correction gate are allowed to move.
   `templateCorrectionGate` proposes against this list rather than against `dur`
   specifically, which is what lets Prompt 5 add reschedule drift as a second
   kind of evidence without a second mechanism. */
export const TMPL_FIELDS = ['lead','dur','lag'];

/* ---------- where the user's edits live ----------
   An OVERRIDES LAYER, not stored copies. meta.footprint.overrides holds only the
   fields that were actually changed, so a later improvement to a built-in still
   reaches every field nobody touched — the same relationship TYPE has to
   meta.learned. Arrays are the one coarse spot: overriding `prereqs` or `costs`
   replaces the whole list, because merging two lists of edits by index is a
   worse kind of surprise than replacing one. */
export function fpMeta(){
  const m = DB.meta.footprint = DB.meta.footprint || {};
  m.overrides = m.overrides || {};
  m.custom    = Array.isArray(m.custom) ? m.custom : [];
  m.hidden    = Array.isArray(m.hidden) ? m.hidden : [];
  m.samples   = m.samples || {};
  m.gates     = Array.isArray(m.gates) ? m.gates : [];
  if(typeof m.learnAfter!=='number' || m.learnAfter<1) m.learnAfter = 5;
  return m;
}
export const LEARN_AFTER = ()=> fpMeta().learnAfter;

function tmplNorm(t){
  return {
    key:String(t.key), label:String(t.label||t.key), builtin:!!t.builtin,
    kw:(t.kw||[]).map(String),
    lead:Math.max(0,+t.lead||0), lag:Math.max(0,+t.lag||0), dur:Math.max(0,+t.dur||0),
    prereqs:(t.prereqs||[]).filter(p=>p&&p.title)
      .map(p=>({title:String(p.title), leadDays:Math.max(0,+p.leadDays||0)})),
    costs:(t.costs||[]).filter(c=>c&&c.label)
      .map(c=>({label:String(c.label), amount:Math.max(0,+c.amount||0), cat:c.cat?String(c.cat):null}))
  };
}
/** Every template this build offers: built-ins with their overrides folded in,
    minus anything hidden, plus whatever the user added. */
export function tmplList(){
  const m=fpMeta();
  const out=[];
  for(const t of TEMPLATES){
    if(m.hidden.includes(t.key)) continue;
    out.push(tmplNorm(Object.assign({builtin:true}, t, m.overrides[t.key]||{})));
  }
  for(const c of m.custom) if(c && c.key) out.push(tmplNorm(Object.assign({builtin:false}, c)));
  return out;
}
export function tmplGet(key){ return tmplList().find(t=>t.key===key) || null; }
export const tmplBuiltin = key => TEMPLATES.find(t=>t.key===key) || null;
export const tmplEdited  = key => !!fpMeta().overrides[key];

/** Write a patch of changed fields. A built-in gets an override entry; a custom
    template is edited in place. Callers checkpoint() and save() around this. */
export function tmplSet(key, patch){
  const m=fpMeta();
  const custom=m.custom.find(c=>c.key===key);
  if(custom){ Object.assign(custom, patch); return tmplGet(key); }
  if(!tmplBuiltin(key)) return null;
  m.overrides[key] = Object.assign({}, m.overrides[key]||{}, patch);
  return tmplGet(key);
}
export function tmplReset(key){ delete fpMeta().overrides[key]; return tmplGet(key); }
export function tmplHide(key){
  const m=fpMeta();
  if(tmplBuiltin(key)){ if(!m.hidden.includes(key)) m.hidden.push(key); }
  else m.custom = m.custom.filter(c=>c.key!==key);
}
export function tmplShow(key){ const m=fpMeta(); m.hidden=m.hidden.filter(k=>k!==key); }
export function tmplAdd(label){
  const m=fpMeta();
  let base=String(label||'custom').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'custom';
  let key=base, n=2; while(tmplGet(key)) key=base+'-'+(n++);
  const t={key, label:String(label||'Untitled'), kw:[], lead:0, dur:0, lag:0, prereqs:[], costs:[]};
  m.custom.push(t); return tmplNorm(Object.assign({builtin:false},t));
}

/* ---------- matching capture text ----------
   Orthogonal to classify()'s type scoring: a template describes the *shape of the
   doing*, not what kind of goal it is. "dinner with Ma Thursday" is a task-type
   goal whose step costs three hours and $96, and those two readings don't compete.
   Longest matching phrase wins, so "dinner with" beats a bare "dinner". */
export function matchTemplate(text){
  const s=String(text||'').toLowerCase();
  if(!s.trim()) return null;
  let best=null;
  for(const t of tmplList()){
    for(const k of t.kw){
      const kw=k.toLowerCase();
      const re=new RegExp('(^|[^a-z0-9])'+kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i');
      if(re.test(s) && (!best || kw.length>best.phrase.length)) best={key:t.key, phrase:kw, label:t.label};
    }
  }
  return best;
}

/* ---------- the footprint itself ---------- */
export const blankFootprint = ()=> ({lead:0, lag:0, prereqs:[], costs:[], tmpl:null});
export const normCost = c => ({
  id:(c&&c.id)||uid(), label:String((c&&c.label)||'Cost'),
  amount:Math.max(0, +((c&&c.amount))||0), catId:(c&&c.catId)?String(c.catId):null });
export const normPrereq = p => ({
  id:(p&&p.id)||uid(), title:String((p&&p.title)||'Untitled'),
  leadDays:Math.max(0, +((p&&p.leadDays))||0), done:!!(p&&p.done),
  doneAt:(p&&p.doneAt)?String(p.doneAt):null });
/** Whatever the file claimed, rebuilt field by field — the treatment `subs` and
    the `gcal` mirror already get in migrate(). */
export function normFootprint(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    lead:Math.max(0, +raw.lead||0),
    lag:Math.max(0, +raw.lag||0),
    prereqs:(Array.isArray(raw.prereqs)?raw.prereqs:[]).filter(p=>p&&typeof p==='object').map(normPrereq),
    costs:(Array.isArray(raw.costs)?raw.costs:[]).filter(c=>c&&typeof c==='object').map(normCost),
    tmpl:typeof raw.tmpl==='string'?raw.tmpl:null
  };
}
const EMPTY = Object.freeze({lead:0, lag:0, prereqs:Object.freeze([]), costs:Object.freeze([]), tmpl:null});
/** Read a step's footprint without every caller branching on null — the accessor
    `subs()` already establishes the pattern. */
export function fp(step){ return (step && step.footprint) || EMPTY; }
export const hasFootprint = s => !!(s && s.footprint &&
  (s.footprint.lead || s.footprint.lag || (s.footprint.prereqs||[]).length || (s.footprint.costs||[]).length));
export const footLead = s => fp(s).lead;
export const footLag  = s => fp(s).lag;
/** The real width of a commitment: what it costs you, not what it shows. */
export const footWidth = (s, dur) => footLead(s) + (+dur||0) + footLag(s);
/** What a new slot for this step should be long enough for. The template's `dur`
    is never folded into the footprint itself (it belongs to the event, not the
    step) — it is consulted the first time a slot is made and never afterwards,
    so re-anchoring something never silently changes how long you said it takes. */
export function slotDur(step, fallback){
  const t = fp(step).tmpl ? tmplGet(fp(step).tmpl) : null;
  return (t && t.dur) ? t.dur : fallback;
}
export const costTotal = list => (list||[]).reduce((n,c)=>n+(+c.amount||0), 0);
export const stepCost  = s => costTotal(fp(s).costs);

/* Costs sum to the step's estimate. Anchoring the same footprint elsewhere doesn't
   change it: this is what the thing costs, not what this week costs. */
export function ensureFootprint(step){
  if(!step.footprint) step.footprint = blankFootprint();
  return step.footprint;
}

/* ---------- applying a template ----------
   GAP-FILL ONLY. A template never overwrites something already there: a non-zero
   lead or lag stays, a prereq or cost line whose name is already present stays
   exactly as the user left it — leadDays, amount, category and all. Zero counts
   as a gap, which is the one place this is lossy: a lead the user deliberately set
   to 0 is indistinguishable from one never set, and gets filled. Recording that
   distinction would need a per-field "the user touched this" set, which is a lot
   of bookkeeping to protect a value that means "no lead" either way.

   `dur` is deliberately NOT part of the fill. It belongs to the event, not the
   step, and quietly reslotting something already on the calendar is not what
   "add the usual footprint" asks for. It is used when a slot is first created. */
export function applyTemplate(step, key){
  const t=tmplGet(key); if(!t || !step) return null;
  const f = normFootprint(step.footprint) || blankFootprint();
  const filled=[], kept=[];

  if(!f.lead && t.lead){ f.lead=t.lead; filled.push('lead'); } else if(f.lead) kept.push('lead');
  if(!f.lag  && t.lag ){ f.lag =t.lag;  filled.push('lag');  } else if(f.lag)  kept.push('lag');

  const seenP=new Set(f.prereqs.map(p=>p.title.trim().toLowerCase()));
  for(const p of t.prereqs){
    const k=p.title.trim().toLowerCase();
    if(seenP.has(k)){ kept.push('prereq:'+p.title); continue; }
    f.prereqs.push(normPrereq({title:p.title, leadDays:p.leadDays}));
    seenP.add(k); filled.push('prereq:'+p.title);
  }
  const seenC=new Set(f.costs.map(c=>c.label.trim().toLowerCase()));
  for(const c of t.costs){
    const k=c.label.trim().toLowerCase();
    if(seenC.has(k)){ kept.push('cost:'+c.label); continue; }
    f.costs.push(normCost({label:c.label, amount:c.amount, catId:catByName(c.cat)}));
    seenC.add(k); filled.push('cost:'+c.label);
  }
  if(!f.tmpl) f.tmpl=key;
  step.footprint=f;
  return {key, filled, kept, template:t};
}
/** A template's category hint is a name. No match leaves the line uncategorised,
    which still counts toward the week's committed total — it just doesn't claim
    to belong to someone else's category. */
export function catByName(name){
  if(!name) return null;
  const want=String(name).trim().toLowerCase();
  const c=((DB.meta.budget&&DB.meta.budget.cats)||[]).find(x=>String(x.name||'').trim().toLowerCase()===want);
  return c?c.id:null;
}
export const catNameOf = id =>
  (((DB.meta.budget&&DB.meta.budget.cats)||[]).find(c=>c.id===id)||{}).name || null;

/* ---------- prerequisites as signals ----------
   A prereq is due `leadDays` before the slot. Outside that window it says nothing;
   an unanchored step says nothing either, because without a date there is no
   window to be inside — that case is already the `unscheduled` signal's, and two
   chips for one missing decision is how a ribbon stops being read. */
export function prereqDueKey(ev, p){ return ev ? addDays(ev.dateKey, -Math.max(0,+p.leadDays||0)) : null; }
export function duePrereqs(step, ev, todayKey){
  if(!ev || !step) return [];
  return fp(step).prereqs.filter(p=>!p.done)
    .map(p=>({prereq:p, dueKey:prereqDueKey(ev,p), late:ev.dateKey<=todayKey}))
    .filter(x=>x.dueKey<=todayKey);
}
export function prereqById(step, id){ return fp(step).prereqs.find(p=>p.id===id)||null; }

/* ---------- committed money ----------
   The sum of cost lines on everything actually scheduled in a week: a step's
   footprint via its anchor, plus a manual event's own costs, which exist
   independently of any step. Repeats are expanded per occurrence through
   eventsOn(), so a standing Thursday dinner commits its cost every Thursday in
   the week rather than once — which is the whole reason committed is worth
   showing next to allocated.

   A row Google no longer has is a tombstone, not a commitment, and is skipped for
   the same reason it is exempt from capacity. */
const dead = e => !!(e && e.gcal && e.gcal.status==='cancelled');
export const stepOfEvent = e => (e && e.stepId) ? stepById(e.stepId) : null;
export function committedWeek(weekStartKey){
  const byCat={}; let total=0, uncat=0; const lines=[];
  const add=(c, ev, src)=>{
    const amt=+c.amount||0; if(amt<=0) return;
    total+=amt;
    if(c.catId){ byCat[c.catId]=(byCat[c.catId]||0)+amt; } else uncat+=amt;
    lines.push({label:c.label, amount:amt, catId:c.catId||null, dateKey:ev.dateKey, src, title:ev.title});
  };
  for(let i=0;i<7;i++){
    for(const e of eventsOn(addDays(weekStartKey,i))){
      if(dead(e)) continue;
      for(const c of (Array.isArray(e.costs)?e.costs:[])) add(c, e, 'event');
      const s=stepOfEvent(e);
      if(s) for(const c of fp(s).costs) add(c, e, 'step');
    }
  }
  return {total, byCat, uncat, lines, weekStart:weekStartKey};
}

/* ---------- the optional actual-duration capture ----------
   Entirely optional and never in the way: skipping it leaves the estimate exactly
   as it was and completion is not blocked, delayed or asked about. Only a step
   that came from a template contributes a sample, because a correction has to
   have something to correct. */
export function startActual(step){
  step.actual = {startedAt:new Date().toISOString(), stoppedAt:null, mins:null};
  return step.actual;
}
export function stopActual(step){
  const a=step.actual; if(!a || !a.startedAt || a.stoppedAt) return null;
  a.stoppedAt=new Date().toISOString();
  a.mins=Math.max(1, Math.round((Date.parse(a.stoppedAt)-Date.parse(a.startedAt))/60000));
  return a;
}
export function clearActual(step){ step.actual=null; }
export const actualMins = s => (s && s.actual && typeof s.actual.mins==='number') ? s.actual.mins : null;
export const timing = s => !!(s && s.actual && s.actual.startedAt && !s.actual.stoppedAt);

export function median(ns){
  const a=[...ns].sort((x,y)=>x-y); if(!a.length) return null;
  const h=a.length>>1;
  return a.length%2 ? a[h] : Math.round((a[h-1]+a[h])/2);
}
export function recordSample(tmplKey, mins){
  if(!tmplKey || !(mins>0)) return null;
  const m=fpMeta();
  const list = m.samples[tmplKey] = (m.samples[tmplKey]||[]).concat([{mins, at:new Date().toISOString()}]);
  if(list.length>20) list.splice(0, list.length-20);
  return list;
}
/* ---------- templateCorrectionGate ----------
   Deliberately generic: "a proposed default change for template T", carrying its
   evidence rather than assuming what the evidence was. Duration is the only kind
   this pass produces; Prompt 5's reschedule drift is another `because.kind` and
   another entry in `proposes`, not a second gate. */
export const TMPL_GATE='templateCorrection';
export const tmplGates = ()=> fpMeta().gates;
export function clearTmplGate(id){ const m=fpMeta(); m.gates=m.gates.filter(x=>x.id!==id); }
/* A proposal may target the template itself (the duration pass) or a goal whose
   cadence the evidence indicts (the drift pass). One entry shape carries both, so
   acceptTmplGate() stays one write and the ribbon stays one chip:
     {field:'dur', from, to}                       -> the template
     {target:'goal', goalId, field:'cadenceDays', from, to} -> that goal
   `field` alone still means the template, which is what keeps every Prompt 4
   proposal valid unchanged. */
export const GOAL_GATE_FIELDS = ['cadenceDays'];
const sameProposal = (a,b) =>
  (a.target||'tmpl')===(b.target||'tmpl') && a.field===b.field && (a.goalId||null)===(b.goalId||null);

export function queueTmplGate(tmplKey, proposes, because, q, {merge=false}={}){
  const m=fpMeta();
  if(!proposes || !proposes.length) return null;
  /* One open proposal per template. A second sample arriving while the first is
     still on the ribbon should sharpen the number, not stack another chip.

     `merge` is what lets the two evidence kinds share that one chip rather than
     racing to evict each other: drift arriving while a duration proposal is open
     adds its rows and keeps both reasons, which is the whole point of the gate
     having been named generically instead of "durationGate". */
  const open = merge ? m.gates.find(x=>x.tmpl===tmplKey) : null;
  m.gates = m.gates.filter(x=>x.tmpl!==tmplKey);
  let gate;
  if(open){
    const kept = open.proposes.filter(p=>!proposes.some(n=>sameProposal(p,n)));
    const parts = (open.because && open.because.kind==='mixed')
      ? open.because.parts.slice() : [open.because];
    gate = Object.assign({}, open, {
      proposes: kept.concat(proposes),
      because: {kind:'mixed', parts: parts.concat([because])},
      q: open.q + ' ' + q,
      at: new Date().toISOString()
    });
  } else {
    gate={id:uid(), kind:TMPL_GATE, tmpl:tmplKey, proposes, because, q, at:new Date().toISOString()};
  }
  m.gates.push(gate);
  return gate;
}
/** Enough evidence, and a difference worth the interruption: at least 5 minutes
    and at least a fifth of the estimate, so a template is never nudged by noise. */
export function proposeFromDuration(tmplKey){
  const t=tmplGet(tmplKey); if(!t) return null;
  const m=fpMeta();
  const list=(m.samples[tmplKey]||[]);
  if(list.length < m.learnAfter) return null;
  const med=median(list.map(x=>x.mins));
  const cur=+t.dur||0;
  if(!med) return null;
  if(cur && Math.abs(med-cur) < Math.max(5, cur*0.2)) return null;
  if(!cur && med<5) return null;
  const q=`"${t.label}" has been running ${med} min against an estimate of ${cur||'none'}`
        + ` (${list.length} timed). Update the template?`;
  return queueTmplGate(tmplKey, [{field:'dur', from:cur, to:med}],
                       {kind:'duration', n:list.length, stat:'median', value:med}, q);
}
/* ---------- the second kind of evidence: reschedule drift ----------
   Prompt 4 wrote templateCorrectionGate to carry "a proposed default change for
   template T, with its evidence" rather than "a duration change", precisely so
   this could be a second `because.kind`. It is NOT a second gate, and it shares
   the accept / decline / one-open-per-template mechanics unchanged.

   What drift indicts is the cadence, not the estimate: a gym session pushed two
   days later four times running does not take longer than you thought, it is
   booked more often than you actually go. Which is why the proposal targets the
   goal's own cadenceDays and not a template field — and why it only fires for a
   goal that HAS a cadence, since proposing one for a one-off deadline is noise.

   Deliberately NOT done here: touching suggestDay()'s placement. Moving where
   things land is a scheduling-behaviour change, not a signal, and stays out of
   this pass by design (README, Non-goals). */
export const DRIFT_CADENCE_TYPES = new Set(['habit','maintenance','threshold']);

export function proposeFromDrift(tmplKey){
  const t=tmplGet(tmplKey); if(!t) return null;
  const m=fpMeta();
  const hits=rescheduleDrift(tmplKey, DB, m.learnAfter);
  /* Evidence from several goals pointing several ways is noise, and averaging it
     into one confident number is worse than saying nothing. One drifting goal is
     a pattern; that is the only case with a correction to make. */
  const drifting=hits.filter(h=>DRIFT_CADENCE_TYPES.has(h.goal.type));
  if(drifting.length!==1) return null;
  const h=drifting[0];
  const cur=+h.goal.cadenceDays||0;
  const shift=Math.round(h.avg);
  if(!shift) return null;
  const to=Math.max(1, (cur||7)+shift);
  if(to===cur) return null;
  const q=`"${t.label}" on ${h.goal.title} gets moved ${Math.abs(shift)} day`
        + `${Math.abs(shift)===1?'':'s'} ${shift>0?'later':'earlier'} most times`
        + ` (${h.n} moves). Stretch its cadence to ${to} days?`;
  return queueTmplGate(tmplKey,
    [{target:'goal', goalId:h.goal.id, field:'cadenceDays', from:cur||null, to}],
    {kind:'drift', n:h.n, stat:'mean', value:Math.round(h.avg*10)/10, sd:Math.round(h.sd*10)/10,
     goalId:h.goal.id},
    q, {merge:true});
}

/** Accepting a gate writes every field it proposed — which is what keeps this
    honest when a later pass proposes more than one at a time. */
export function acceptTmplGate(id){
  const gate=tmplGates().find(x=>x.id===id); if(!gate) return null;
  const patch={};
  for(const p of gate.proposes){
    if((p.target||'tmpl')==='goal'){
      /* A cadence belongs to a goal, not to a template shared by three of them.
         Writing it here keeps accept as one action and one undo step. */
      if(!GOAL_GATE_FIELDS.includes(p.field)) continue;
      const g=(DB.goals||[]).find(x=>x.id===p.goalId);
      if(g) g[p.field]=p.to;
      continue;
    }
    if(TMPL_FIELDS.includes(p.field)) patch[p.field]=p.to;
  }
  const t=Object.keys(patch).length ? tmplSet(gate.tmpl, patch) : tmplGet(gate.tmpl);
  const m=fpMeta();
  delete m.samples[gate.tmpl];         // the evidence has been spent
  clearTmplGate(id);
  return t;
}
export function declineTmplGate(id){
  const gate=tmplGates().find(x=>x.id===id); if(!gate) return null;
  const m=fpMeta();
  delete m.samples[gate.tmpl];         // don't re-ask the same question next completion
  clearTmplGate(id);
  return gate;
}

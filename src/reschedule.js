/* ===================== [SECTION: RESCHEDULE] =====================
   How often a step gets pushed, which way, and what that is evidence of.

   Ply already logged a 'planned' entry every time anchor() ran, and anchor()
   already removed the prior event before making a new one. A step pushed three
   times therefore already left three 'planned' rows — the raw trail existed. What
   it could not say was WHY each anchor happened: the habit engine re-booking on
   cadence, an unblock, and a person dragging dinner back for the third time were
   all the same row, and only the last of those is behaviour worth surfacing.
   `source` is that missing field, and everything here is derived from it.

   THIS MODULE IS A LEAF, AND DELIBERATELY SO. It imports nothing but util, and
   every function takes the log (or the document) explicitly rather than reading
   the live DB. That is what lets store.ts call recomputeAllReschedule() on adopt
   without an import cycle — see the evaluation-order note in bus.js for what the
   alternative costs. It is also why these are testable against a hand-built log
   with no app booted at all.

   DERIVED, NOT COUNTED. rescheduleHistory() is a pure function over `log`, never
   a synced mutable counter, because ply-sync-design.md merges `log` as an
   append-only union by id: the merged document holds the union of both devices'
   rows, so re-deriving from it is the most complete answer available. A plain
   counter under LWW would undercount whenever two devices each pushed the same
   step offline — exactly the case this feature exists to notice.
------------------------------------------------------------------------------ */
import { daysBetween } from './util.js';

/** Why an anchor happened. Threaded through CAL.anchor() to logIt('planned', …). */
export const ANCHOR_SOURCES = [
  'auto-cycle',   // habit / maintenance / threshold re-booking one cadence on
  'unblock',      // a thread came unblocked and was re-booked
  'checkin',      // the check-in's own scheduling step
  'drag',         // matrix / day-strip / week-column drag-to-schedule
  'manual',       // goal editor, event editor, capture, ribbon resolver
  'gcal-pull',    // a Google-side move adopted by gMerge()
  'unknown'       // pre-schema-10 rows: there is no way to know what they were
];

/* Only a human deciding to move something counts as churn. Auto-cycle is the
   engine doing its job, unblock is a circumstance changing, and gcal-pull is
   someone moving it in the other calendar — none of the three is the person
   pushing the same commitment again, which is the only thing worth a signal. */
export const CHURN_SOURCES = new Set(['manual','drag','checkin']);

/** Default before a churn signal is raised. Overridable via meta.rescheduleAt. */
export const CHURN_AT = 3;
export const churnAt = db =>
  Math.max(2, (db && db.meta && +db.meta.rescheduleAt) || CHURN_AT);

const isPlanned = l => l && l.kind === 'planned';
const byTs = (a,b) => String(a.ts||'').localeCompare(String(b.ts||''));

/* ---------- the walk ----------
   One implementation, two windows. The signal asks about the current cycle
   ("since it was last live"); the goal summary asks about the goal's whole life.
   Splitting these into two walkers is how they drift apart a release later. */
function walk(stepId, log, { sinceLastDone }){
  const rows = (log||[]).filter(l => l && l.stepId === stepId).sort(byTs);
  let from = 0;
  if(sinceLastDone){
    /* A completed step's history starts over: the push that happened before you
       finished it last time is not evidence about the one in front of you now. */
    for(let i=rows.length-1;i>=0;i--) if(rows[i].kind === 'done'){ from = i+1; break; }
  }
  const events = [];
  let prev = null;
  for(const row of rows.slice(from)){
    /* A completion breaks the chain in either window. The lifetime walk keeps the
       events either side of it — they happened — but the booking that follows a
       completion is a fresh start, not a push off the date you already met. */
    if(row.kind === 'done'){ prev = null; continue; }
    if(!isPlanned(row)) continue;
    const to = row.dateKey || null;
    /* An 'unknown' row can still say what the date WAS — that is a fact the
       migration did not have to guess. It just cannot be a counted event itself,
       because nothing recorded why it happened. Letting it serve as a predecessor
       is what stops the first post-migration push measuring its delta from
       nowhere. */
    if(prev !== null && to !== null && CHURN_SOURCES.has(row.source) && to !== prev){
      /* anchor() fires on a time-only change too, and re-saving an unchanged row
         fires it again. A move that did not move is not a reschedule: it never
         enters `events`, so it can neither trip the threshold nor flatten the
         average the drift gate reads. */
      events.push({
        at: row.ts, fromDateKey: prev, toDateKey: to,
        deltaDays: daysBetween(prev, to),      // signed: later is positive
        source: row.source
      });
    }
    if(to !== null) prev = to;
  }
  return { count: events.length, events };
}

/** Churn on one step since it was created or last completed. The signal's window. */
export function rescheduleHistory(stepId, log){ return walk(stepId, log, {sinceLastDone:true}); }
/** Every push this step id ever took. The summary's and the drift feed's window. */
export function rescheduleLifetime(stepId, log){ return walk(stepId, log, {sinceLastDone:false}); }

/* ---------- the durable summary ----------
   `log` is capped at 4000 rows and trimmed from the head, which would silently
   erase a long-lived goal's history. goal.reschedule is the small thing that
   outlives the trim. It is NEVER sync-authoritative on its own — see
   recomputeAllReschedule(). */
export const blankReschedule = () => ({count:0, lastAt:null, avgDeltaDays:0});

/** One qualifying event folded into a goal's running summary, in place. */
export function bumpReschedule(goal, ev){
  if(!goal || !ev) return null;
  const r = goal.reschedule = Object.assign(blankReschedule(), goal.reschedule||{});
  const n = r.count + 1;
  r.avgDeltaDays = (r.avgDeltaDays * r.count + ev.deltaDays) / n;
  r.count = n;
  r.lastAt = ev.at;
  return r;
}

/* One qualifying write folded into the goal's summary.

   It reads the event back out of rescheduleHistory() rather than computing a
   delta itself, so exactly one place decides what counts: the same walk that
   excludes auto-cycle, unblock, gcal-pull and 'unknown', and that drops a
   re-anchor which did not actually change the date. A second copy of that rule
   living at a call site is how the summary and the signal end up disagreeing
   about the same step.

   `row` is the log entry just written. Matching on its own `at` rather than
   assuming an event appeared is what makes this safe to call unconditionally:
   a first anchor has no predecessor and produces nothing to fold. */
export function noteReschedule(goal, stepId, source, row, log){
  if(!goal || !row || !CHURN_SOURCES.has(source)) return null;
  const h = rescheduleHistory(stepId, log);
  const last = h.events[h.events.length-1];
  return (last && last.at === row.ts) ? bumpReschedule(goal, last) : null;
}

/** Fresh from whatever log rows survive. Groups by stepId off the log rather than
    off the goal's current steps, so a step that has since been deleted still
    counts — the log outlives the graph. */
export function rescheduleSummaryFromLog(goalId, log){
  const ids = new Set((log||[]).filter(l => isPlanned(l) && l.goalId === goalId && l.stepId)
                               .map(l => l.stepId));
  const all = [];
  for(const id of ids) all.push(...rescheduleLifetime(id, log).events);
  if(!all.length) return blankReschedule();
  all.sort(byTs);
  return {
    count: all.length,
    lastAt: all[all.length-1].at,
    avgDeltaDays: all.reduce((n,e)=>n+e.deltaDays,0) / all.length
  };
}

/* On merge or adopt, re-derive rather than three-way-merging the field. Per
   ply-sync-design.md `log` is an append-only union by id, so the merged document
   already holds every row both devices had; deriving from it beats LWW on a
   counter, which would lose one device's offline pushes outright. The cost is
   named honestly in the README: a summary is only as complete as the log that
   survived onto the merged document. */
export function recomputeAllReschedule(db){
  if(!db || !Array.isArray(db.goals)) return db;
  for(const g of db.goals) g.reschedule = rescheduleSummaryFromLog(g.id, db.log||[]);
  return db;
}

/* ---------- display ----------
   One phrase, two call sites (the List row and the Quarter hover detail), because
   a rule with two renderings is a rule with two behaviours a release later. */
export function rescheduleLine(goal){
  const r = goal && goal.reschedule;
  if(!r || !(r.count > 0)) return null;
  const n = Math.round(Math.abs(r.avgDeltaDays));
  const head = 'rescheduled ' + r.count + '×';
  if(!n) return head;
  return head + ' · usually ' + n + ' day' + (n===1?'':'s') + ' '
       + (r.avgDeltaDays > 0 ? 'later' : 'earlier');
}

/* ---------- the drift feed into templateCorrectionGate ----------
   Prompt 4 named that gate generically — "a proposed default change for template
   T, carrying its evidence" — precisely so this could be a second `because.kind`
   rather than a second gate. This function produces the evidence; footprint.js
   decides what to propose from it.

   Grouped by goal because a cadence is a property of a goal, not of a template:
   a template shared by three goals whose pushes point three different ways is
   noise, and saying so is cheaper than averaging it into a confident wrong
   number. */
export const DRIFT_MIN_DAYS = 1;          // below a day there is nothing to correct
export const DRIFT_SD_FACTOR = 0.75;      // spread this much of the mean still reads as a pattern

export function driftStats(deltas){
  const n = deltas.length;
  if(!n) return {n:0, avg:0, sd:0, tight:false};
  const avg = deltas.reduce((a,b)=>a+b,0)/n;
  const sd = Math.sqrt(deltas.reduce((a,b)=>a+(b-avg)*(b-avg),0)/n);
  return {n, avg, sd, tight: sd <= Math.max(DRIFT_SD_FACTOR, Math.abs(avg)*DRIFT_SD_FACTOR)};
}

/** Every drifting goal that books this template, with its own stats. */
export function rescheduleDrift(tmplKey, db, minSamples){
  if(!tmplKey || !db || !Array.isArray(db.goals)) return [];
  const need = Math.max(2, minSamples||3);
  const out = [];
  for(const g of db.goals){
    const deltas = [];
    for(const t of (g.threads||[])) for(const s of (t.steps||[])){
      if(!s.footprint || s.footprint.tmpl !== tmplKey) continue;
      for(const e of rescheduleLifetime(s.id, db.log||[]).events) deltas.push(e.deltaDays);
    }
    if(deltas.length < need) continue;
    const st = driftStats(deltas);
    if(!st.tight || Math.abs(st.avg) < DRIFT_MIN_DAYS) continue;
    out.push({goal:g, goalId:g.id, n:st.n, avg:st.avg, sd:st.sd});
  }
  return out;
}

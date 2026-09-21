import type { AnchorSource, DateKey, Goal, LogEntry, Minutes, PlyEvent, Step, Thread } from './types.js';
import { GSTATE, gCal, gDead, gEnqueue, gFlush, gNote, gOn } from './google.js';
import { DB, addEvent, eventsOn, logIt, masterEvent, newEvent, removeEvent, save } from './store.js';
import { footWidth, fp, proposeFromDrift, slotDur, stepOfEvent } from './footprint.js';
import { addDays } from './util.js';
import { noteReschedule } from './reschedule.js';

/* ---------------------------------------------------------------------------
   What a calendar provider has to be.

   This is the seam: no view and no engine function touches DB.events directly,
   so a provider is swappable as long as it satisfies this. The local store and
   the Google provider both do, and Prompts 1 and 2 were built against it — which
   is why the shape below is a contract rather than a description of one
   implementation.
--------------------------------------------------------------------------- */
export interface CalendarProvider {
  /** which provider is answering right now */
  readonly provider: 'local' | 'google';
  /** whether Ply may schedule at all — not whether the network is up */
  readonly writable: boolean;
  /** whether a write can be delivered now, as opposed to queued */
  readonly online: boolean;

  /** every occurrence in a range, repeats expanded */
  list(fromKey: DateKey, toKey: DateKey): PlyEvent[];
  /** one day, sorted by start */
  on(k: DateKey): PlyEvent[];
  /** give a step a slot; returns synchronously, remote writes are queued.
      `source` says WHY, and is not optional in practice: it is the only thing
      separating the habit engine re-booking itself from a person pushing the same
      commitment a third time, and both used to land in `log` as the same row. */
  anchor(goal: Goal, thread: Thread, step: Step,
         dateKey: DateKey, start: Minutes, dur?: Minutes, source?: AnchorSource): PlyEvent;
  /** take the slot away again */
  unanchor(step: Step): void;
  /** minutes booked that day, footprints included; all-day items are exempt */
  loadOn(k: DateKey): Minutes;
  loadWeek(weekStartKey: DateKey): Minutes;
}

export const CAL: CalendarProvider = {
  get provider(){ return gOn() ? 'google' : 'local'; },
  /* `writable` says Ply may schedule, not that the network is up. With a remote
     provider configured every write is accepted and queued; `online` is the
     separate question of whether it can be delivered right now. */
  get writable(){ return true; },
  get online(){ return this.provider==='local' || (GSTATE==='ready' && navigator.onLine!==false); },
  /* range read — no view calls it yet, but it's the shape a remote provider needs
     and it's covered by tests, so it stays as interface rather than being trimmed */
  list(fromKey,toKey){
    const out: PlyEvent[] = [];
    for(let k=fromKey; k<=toKey; k=addDays(k,1)) out.push(...eventsOn(k));   // expands repeats
    return out;
  },
  on(k){ return eventsOn(k); },
  /* anchor a step to a slot; returns the local event, always synchronously —
     two callers mutate what comes back (the all-day flag), and the remote write
     is queued rather than awaited so scheduling never waits on a network. */
  anchor(goal,thread,step,dateKey,start,dur,source){
    const src: AnchorSource = source || 'unknown';
    const held = step.eventId ? masterEvent(step.eventId) : null;
    /* Re-anchoring moves the *same* Google event rather than deleting and
       remaking it, so it keeps its id, its reminders and anyone it was shared
       with. This is a deliberate local action, so it also wins over whatever
       time the remote currently holds — `pending` is what tells the next pull
       that this row is an intent, not a stale read. */
    if(held && held.gcal && held.gcal.id && held.gcal.status!=='cancelled' && this.provider==='google'){
      held.title=step.title; held.dateKey=dateKey; held.start=start; held.dur=dur||45;
      held.allDay=false; held.recur=null; held.skips=[];
      held.goalId=goal.id; held.threadId=thread.id; held.stepId=step.id;
      held.gcal.status='confirmed'; held.gcal.own=true;
      gEnqueue('patch',held); gFlush().catch(gNote);
      noteDrift(goal, step, src,
        logIt('planned',{goalId:goal.id, threadId:thread.id, stepId:step.id, text:step.title, dateKey, source:src}));
      save(); return held;
    }
    if(step.eventId) removeEvent(step.eventId);
    /* A template's `dur` is consulted only here, when the slot is first made —
       never folded into the footprint, so re-anchoring never quietly changes how
       long you said something takes. */
    const ev = addEvent(newEvent({
      title:step.title, dateKey, start, dur:dur||slotDur(step,45),
      goalId:goal.id, threadId:thread.id, stepId:step.id
    }));
    step.eventId = ev.id;
    if(this.provider==='google'){
      ev.src='google';
      ev.gcal={id:null, etag:null, updated:null, cal:gCal(), own:true, status:'confirmed', link:null, pending:true};
      gEnqueue('create',ev); gFlush().catch(gNote);
    }
    noteDrift(goal, step, src,
      logIt('planned',{goalId:goal.id, threadId:thread.id, stepId:step.id, text:step.title, dateKey, source:src}));
    save(); return ev;
  },
  /* removeEvent() queues the remote delete — it is the single choke point every
     deletion path already went through, so unanchoring needs nothing extra. */
  unanchor(step){
    if(step.eventId){ removeEvent(step.eventId); gFlush().catch(gNote); }
    step.eventId=null; save();
  },
  /* minutes booked in a given day — now including whatever the real calendar
     holds, which is the point of the integration. All-day items stay exempt, and
     so does an event Google no longer has (it's a tombstone, not a commitment).

     A step's lead and lag count here too: an hour at the gym that costs you
     nearly two is an hour the day doesn't have, and a capacity bar that says
     otherwise is the specific lie this whole prompt exists to stop telling.

     Shadows are SUMMED, not merged. Two back-to-back sessions therefore read as
     the full lead+dur+lag each, even where one's lag runs into the next one's lead. That
     matches how loadOn() has always treated overlapping slots — it sums those
     too — and keeping both consistent is worth more than a cleverer number that
     would make the day's total depend on the order things sit in. */
  loadOn(k){
    return eventsOn(k).reduce((n,e)=>
      n + ((e.allDay||gDead(e)) ? 0 : footWidth(stepOfEvent(e), e.dur)), 0);
  },
  loadWeek(weekStartKey){ let n=0; for(let i=0;i<7;i++) n+=this.loadOn(addDays(weekStartKey,i)); return n; }
};

/* Fold the move into the goal's summary, then — only if it actually counted —
   let the template gate look at the drift.

   Drift evidence grows at anchor time, not at completion: a step being pushed for
   the fourth time is precisely a step that is not completing, so hanging this off
   completeStep() beside proposeFromDuration() would mean the cadence correction
   only ever arrived for things that were going fine. */
function noteDrift(goal: Goal, step: Step, src: AnchorSource, row: LogEntry){
  const bumped = noteReschedule(goal, step.id, src, row, DB.log);
  if(!bumped) return;
  const key = fp(step).tmpl;
  if(key) proposeFromDrift(key);
}

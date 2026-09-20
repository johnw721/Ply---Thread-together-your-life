import { GSTATE, gCal, gDead, gEnqueue, gFlush, gNote, gOn } from './google.js';
import { addEvent, eventsOn, logIt, masterEvent, newEvent, removeEvent, save } from './store.js';
import { addDays } from './util.js';

export const CAL = {
  get provider(){ return gOn() ? 'google' : 'local'; },
  /* `writable` says Ply may schedule, not that the network is up. With a remote
     provider configured every write is accepted and queued; `online` is the
     separate question of whether it can be delivered right now. */
  get writable(){ return true; },
  get online(){ return this.provider==='local' || (GSTATE==='ready' && navigator.onLine!==false); },
  /* range read — no view calls it yet, but it's the shape a remote provider needs
     and it's covered by tests, so it stays as interface rather than being trimmed */
  list(fromKey,toKey){
    const out=[];
    for(let k=fromKey; k<=toKey; k=addDays(k,1)) out.push(...eventsOn(k));   // expands repeats
    return out;
  },
  on(k){ return eventsOn(k); },
  /* anchor a step to a slot; returns the local event, always synchronously —
     two callers mutate what comes back (the all-day flag), and the remote write
     is queued rather than awaited so scheduling never waits on a network. */
  anchor(goal,thread,step,dateKey,start,dur){
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
      logIt('planned',{goalId:goal.id, threadId:thread.id, stepId:step.id, text:step.title, dateKey});
      save(); return held;
    }
    if(step.eventId) removeEvent(step.eventId);
    const ev = addEvent(newEvent({
      title:step.title, dateKey, start, dur:dur||45,
      goalId:goal.id, threadId:thread.id, stepId:step.id
    }));
    step.eventId = ev.id;
    if(this.provider==='google'){
      ev.src='google';
      ev.gcal={id:null, etag:null, updated:null, cal:gCal(), own:true, status:'confirmed', link:null, pending:true};
      gEnqueue('create',ev); gFlush().catch(gNote);
    }
    logIt('planned',{goalId:goal.id, threadId:thread.id, stepId:step.id, text:step.title, dateKey});
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
     so does an event Google no longer has (it's a tombstone, not a commitment). */
  loadOn(k){ return eventsOn(k).reduce((n,e)=>n+((e.allDay||gDead(e))?0:e.dur),0); },
  loadWeek(weekStartKey){ let n=0; for(let i=0;i<7;i++) n+=this.loadOn(addDays(weekStartKey,i)); return n; }
};


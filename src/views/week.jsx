import { QUAD } from './render.jsx';
import { hrs, loadState } from '../budget.js';
import { BudgetPanel } from '../budget.jsx';
import { CAL } from '../cal.js';
import { ItemCard } from '../components/card.jsx';
import { itemsOn, unscheduledItems } from '../engine.js';
import { footLag, footLead, stepOfEvent } from '../footprint.js';
import { DB, load } from '../store.js';
import { addDays, fmtDate, fmtDay, fmtTime, parseKey, startOfWeek, today } from '../util.js';
import { activeItemsC, uiRev } from '../signals.js';

/* ================= WEEK =================
   Seven columns: timed events on top, untimed tasks beneath with quadrant colour
   dots, so priority survives calendar mode. The money budget sits underneath.

   Each column is a drop target, which is what `data-daydrop` is for — the drag
   engine reads it, so it has to survive the conversion unchanged. */

function LoadBar({ k }){
  const L = loadState(k);
  if (!L.mins) return null;
  return (
    <div class={'loadbar ' + (L.over ? 'over' : L.pct >= 80 ? 'near' : '')}
         title={hrs(L.mins) + ' of a ' + hrs(L.budget) + ' day'}>
      <i style={'width:' + Math.min(100, L.pct) + '%'} />
    </div>
  );
}

function DayColumn({ k }){
  const evs = CAL.on(k);
  const timed = evs.filter(e => !e.allDay);
  const untimedItems = itemsOn(k).filter(i => !i.ev || i.ev.allDay);
  const untimedEvents = evs.filter(e => e.allDay && !e.stepId);
  const load = CAL.loadOn(k);
  const L = loadState(k);

  return (
    <div class={'daycol' + (k === today() ? ' today' : '')} data-day={k} data-daydrop="1">
      <h4><span>{fmtDay(k)}</span><span class="d">{parseKey(k).getDate()}</span></h4>

      <div class="sect">
        <div class="sl">Calendar{load ? ' · ' + hrs(load) : ''}{L.over ? <> <span class="overtxt">over</span></> : ''}</div>
        <LoadBar k={k} />
        { timed.length
          ? timed.map(e => {
              /* A week column has no timeline to extend along, so the shadow shows
                 as what it costs either side rather than as geometry. Same numbers,
                 same single event — see dayStripHTML(). */
              const st = stepOfEvent(e), lead = footLead(st), lag = footLag(st);
              return (
                <div key={e.id} class={'evchip ' + (e.stepId ? 'step' : '') + (lead||lag ? ' hasfoot' : '')}
                     data-ev={e.id} data-lead={lead||null} data-lag={lag||null}
                     title={lead||lag ? (lead+' min before, '+lag+' after') : null}>
                  {lead ? <span class="fpad">+{lead}′ </span> : null}
                  <span class="t">{fmtTime(e.start)}</span>{e.recur ? '↻ ' : ''}{e.title}
                  {lag ? <span class="fpad"> +{lag}′</span> : null}
                </div>
              );
            })
          : <div class="overflow">{'—'}</div> }
      </div>

      <div class="sect">
        <div class="sl">Tasks</div>
        { (untimedItems.length + untimedEvents.length)
          ? <>
              {untimedItems.map(i => (
                <div key={i.step.id} class={'tchip' + (i.step.done ? ' done' : '')}
                     data-step={i.step.id} data-thread={i.thread.id} data-goal={i.goal.id}>
                  <span class="dot" style={'background:' + QUAD[i.quadrant].c} />
                  <span class="x">{i.step.title}</span>
                </div>
              ))}
              {untimedEvents.map(e => (
                <div key={e.id} class="tchip" data-ev={e.id}>
                  <span class="dot" style="background:var(--accent)" />
                  <span class="x">{e.title}</span>
                </div>
              ))}
            </>
          : <div class="overflow">{'—'}</div> }
      </div>
    </div>
  );
}

export function WeekView(){
  activeItemsC.value; uiRev.value;
  const ws = startOfWeek(DB.meta.cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const tray = unscheduledItems();

  return (
    <>
      <div class="viewhead">
        <h2>Week of {fmtDate(ws)}</h2>
        <span class="sub">{Math.round(CAL.loadWeek(ws) / 60 * 10) / 10}h booked across the week</span>
        <div class="spacer" style="flex:1" />
        <div class="nav">
          <button class="btn sm" data-nav="-7">{'←'}</button>
          <button class="btn sm" data-nav="0">This week</button>
          <button class="btn sm" data-nav="7">{'→'}</button>
        </div>
      </div>

      <div class="weekgrid">{days.map(k => <DayColumn key={k} k={k} />)}</div>

      { tray.length
        ? <div class="strip" style="margin-top:14px">
            <div class="lbl"><span>Unscheduled next steps {'—'} {tray.length}</span></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
              {tray.map(i => <ItemCard key={i.step.id} item={i} />)}
            </div>
          </div>
        : null }

      <BudgetPanel />
    </>
  );
}

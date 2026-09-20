import { CAL } from '../cal.js';
import { gDead, gForeign } from '../google.js';
import { hrs, loadState } from '../budget.js';
import { fmtTime, nowMin, today } from '../util.js';
import { CAL_S, CAL_E, calPos } from './card.js';
import { rev } from '../signals.js';

/* ---------- the horizontal day strip ----------
   Shared by Day and List. In List it doubles as a drop target: a row dragged onto
   it is scheduled at the time it lands on, which is the shortest path there is
   from "this exists" to "this is on the calendar" — the rule the whole app turns on.

   The component form and dayStripHTML() in card.js produce the same markup; the
   string version stays until Day and Week are converted too. */

function LoadBar({ k, always = false }){
  const L = loadState(k);
  if (!L.mins && !always) return null;
  return (
    <div class={'loadbar ' + (L.over ? 'over' : L.pct >= 80 ? 'near' : '')}
         title={hrs(L.mins) + ' of a ' + hrs(L.budget) + ' day'}>
      <i style={'width:' + Math.min(100, L.pct) + '%'} />
    </div>
  );
}

export function DayStrip({ k, drop = false }){
  rev.value;                                  // re-read when anything is scheduled
  const evs = CAL.on(k);
  const timed = evs.filter(e => !e.allDay), allday = evs.filter(e => e.allDay);
  const L = loadState(k);

  const ticks = [];
  for (let h = 6; h <= 22; h += 2){
    ticks.push(<div key={'hr'+h} class="hr" style={'left:' + calPos(h*60) + '%'} />);
    ticks.push(<div key={'lbl'+h} class="hrlbl" style={'left:' + calPos(h*60) + '%'}>{fmtTime(h*60)}</div>);
  }

  const chipClass = e => 'ev' + (e.stepId ? ' step' : '') + (gForeign(e) ? ' ro' : '') + (gDead(e) ? ' gone' : '');

  return (
    <div class="strip">
      <div class="lbl">
        <span>Calendar</span>
        <span class={'tiny ' + (L.over ? 'overtxt' : 'muted')}>
          {hrs(L.mins)} of a {hrs(L.budget)} day{L.over ? ' — over by ' + hrs(L.mins - L.budget) : ''}
        </span>
      </div>
      <LoadBar k={k} always />
      <div class="trackwrap">
        <div class={'track' + (drop ? ' droppable' : '')} data-caldrop={drop ? '1' : undefined}>
          {ticks}
          {timed.map(e => {
            const l = calPos(e.start), w = Math.max(3, calPos(e.start + e.dur) - l);
            return (
              <div key={e.id} class={chipClass(e)} data-ev={e.id} style={'left:' + l + '%;width:' + w + '%'}>
                {e.recur ? '↻ ' : ''}{e.title}
              </div>
            );
          })}
          {k === today() ? <div class="now" style={'left:' + calPos(nowMin()) + '%'} /> : null}
          <div class="dropline" />
        </div>
      </div>
      {allday.length
        ? <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            {allday.map(e => (
              <span key={e.id} class={'evchip ' + (e.stepId ? 'step' : '') + (gForeign(e) ? ' ro' : '') + (gDead(e) ? ' gone' : '')}
                    data-ev={e.id}>{e.recur ? '↻ ' : ''}{e.title}</span>
            ))}
          </div>
        : null}
    </div>
  );
}

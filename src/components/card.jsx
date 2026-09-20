import { CAL } from '../cal.js';
import { gDead, gForeign } from '../google.js';
import { hrs, loadState } from '../budget.js';
import { fmtTime, nowMin, today } from '../util.js';
import { calPos, CARDSUBS } from './card.js';
import { QUAD } from '../views/render.jsx';
import { shortName, subProgress, subs } from '../engine.js';
import { daysBetween } from '../util.js';
import { Fragment } from 'preact';
import { rev, uiRev } from '../signals.js';

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

/* ---------- the shared card ----------
   Component form of itemCard(). Same markup and the same data attributes, so
   wireView()'s click router and the drag engine both still find what they look
   for. The subtask lines are keyed by id, so ticking one patches that line
   rather than rebuilding the card under the pointer. */
export function SubLine({ sub, step, thread, goal }){
  return (
    <div class={'subline' + (sub.done ? ' done' : '')}
         data-step={step.id} data-sub={sub.id} data-thread={thread.id} data-goal={goal.id}>
      <span class={'subchk' + (sub.done ? ' on' : '')} data-act="sub" data-step={step.id} data-sub={sub.id}
            data-goal={goal.id} data-thread={thread.id}
            role="checkbox" aria-checked={String(sub.done)} tabIndex="0">{sub.done ? '\u2713' : ''}</span>
      <span class="x">{sub.title}</span>
      <span class="grip subgrip" title="Drag onto the calendar to schedule this step">{'\u22EE\u22EE'}</span>
    </div>
  );
}

export function ItemCard({ item }){
  uiRev.value;
  const g = item.goal, s = item.step, t = item.thread;
  const slip = item.dateKey && item.dateKey < today() && !s.done;
  const sp = subProgress(s);
  const open = CARDSUBS.has(s.id);
  const meta = [];

  if (g.type !== 'task') meta.push(
    <span class="goaltag"><span class="dot" style={'background:' + QUAD[item.quadrant].c} />{shortName(g)}</span>);
  if (t.name && t.name !== 'Main' && g.threads.length > 1) meta.push(<span class="pill">{t.name}</span>);
  if (item.ev) meta.push(<span class="pill mono">{item.ev.allDay ? 'all day' : fmtTime(item.ev.start)}</span>);
  else if (g.type !== 'task') meta.push(
    <span class="pill" style="border-color:#5a4a24;color:#e8c98a">unscheduled</span>);
  if (slip) meta.push(
    <span class="pill" style="border-color:#5a2b2b;color:#f0a6a6">slipped {daysBetween(item.dateKey, today())}d</span>);
  if (item.blocked) meta.push(
    <span class="pill" style="border-color:#5a4a24;color:#e8c98a">waiting on {t.blockedOn || '?'}</span>);
  if (s.auto) meta.push(<span class="pill tiny">auto</span>);
  if (s.autoScheduled) meta.push(
    <span class="pill tiny" title="re-booked by cadence when you completed the last one">{'\u21BB'} auto-booked</span>);
  if (sp.any) meta.push(
    <span class={'pill tiny subpill' + (sp.done === sp.total ? ' full' : '')} data-act="subs" data-step={s.id}
          title={(open ? 'Hide' : 'Show') + ' subtasks'}>
      {sp.done}/{sp.total} {open ? '\u25B2' : '\u25BC'}
    </span>);

  return (
    <div class={'card' + (s.done ? ' done' : '')} data-step={s.id} data-thread={t.id} data-goal={g.id}>
      <div class="qbar" style={'background:' + QUAD[item.quadrant].c} />
      <div class={'chk' + (s.done ? ' on' : '')} data-act="toggle">{s.done ? '\u2713' : ''}</div>
      <div class="body">
        <div class="ttl">{s.title}</div>
        <div class="meta">{meta.map((m, i) => <Fragment key={i}>{m}</Fragment>)}</div>
        { sp.any && open &&
          <div class="cardsubs">
            {subs(s).map(x => <SubLine key={x.id} sub={x} step={s} thread={t} goal={g} />)}
          </div> }
      </div>
      <div class="grip" title="Drag to another quadrant">{'\u22EE\u22EE'}</div>
    </div>
  );
}

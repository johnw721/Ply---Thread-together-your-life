import { TYPE } from '../types.js';
import { QUAD } from './render.jsx';
import { CAL } from '../cal.js';
import { money, shortName } from '../engine.js';
import { DB, currentStep, eventById, goals, liveGoals } from '../store.js';
import { addDays, clamp, daysBetween, dkey, fmtDate, parseKey, startOfWeek, today } from '../util.js';
import { activeItemsC, uiRev } from '../signals.js';
import { doneCount, partialCount, bestQuadrant } from './quarter.js';
import { rescheduleLine } from '../reschedule.js';

/* ================= QUARTER =================
   A 13-week roadmap: one row per goal, target window as a band, progress fill,
   scheduled-step dots, deadline marker, today line. The current next step (or
   "waiting on X" / "dormant") reads down the left column, and week density bars
   sit on top — click one to jump to that week.

   Rows are keyed by goal id, so a goal changing state repaints its own row
   rather than the whole roadmap. */

export function quarterRange(k){
  const d=parseKey(k); const qStart=new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1);
  const from=startOfWeek(dkey(qStart));
  return {from, to:addDays(from, 13*7-1), weeks:13};
}

/** the next step across a goal's live threads, in the words the row uses */
function NextStep({ goal, thread }){
  const st = currentStep(thread);
  if (thread.status === 'blocked') return <b>waiting on {thread.blockedOn || '?'}</b>;
  if (thread.status === 'dormant') return <><b>dormant</b> until {goal.trigger || 'trigger undefined'}</>;
  if (!st) return <b style="color:var(--bad)">no next step</b>;
  const ev = st.eventId ? eventById(st.eventId) : null;
  return (
    <>
      <b>{st.title}</b>
      { ev ? <> <span class="mono tiny">{fmtDate(ev.dateKey)}</span></>
           : <> <span class="tiny" style="color:var(--warn)">unscheduled</span></> }
    </>
  );
}

function RoadmapRow({ goal, from, to, x }){
  const spec = TYPE[goal.type];

  // band window
  let s = dkey(new Date(goal.createdAt)); if (s < from) s = from;
  let e = goal.smart.deadline || null;
  if (!e) e = (goal.type==='habit'||goal.type==='maintenance'||goal.type==='pipeline'||goal.type==='contingent')
    ? to : addDays(s, 56);
  if (e > to) e = to; if (e < s) e = s;
  const left = x(s), w = Math.max(2, x(e) - left);

  const prog = goal.smart.target
    ? clamp((goal.smart.current||0)/goal.smart.target*100, 0, 100)
    : (goal.type==='milestone'
        ? clamp((doneCount(goal)+partialCount(goal))/(doneCount(goal)+goal.backlog.length+1)*100, 0, 100)
        : 0);

  const act = goal.threads.filter(t => t.status !== 'done');
  const dots = goal.threads
    .flatMap(t => t.steps.filter(st => st.eventId).map(st => eventById(st.eventId)))
    .filter(ev => ev && ev.dateKey >= from && ev.dateKey <= to);

  return (
    <div class="rmrow">
      <div class="rmleft" data-goal={goal.id}>
        <div class="n">
          <span class="dot" style={'background:' + QUAD[bestQuadrant(goal)].c} />{shortName(goal)}
          <span class="pill">{spec.label}</span>
        </div>
        {act.map(t => (
          <div key={t.id} class="ns">
            <span class="muted">{'›'}</span>
            <span><NextStep goal={goal} thread={t} /></span>
          </div>
        ))}
        { rescheduleLine(goal)
          ? <div class="ns qchurn tiny muted">{rescheduleLine(goal)}</div> : null }
      </div>
      <div class="rmtrack">
        {Array.from({ length: 7 }, (_, i) => i * 2).map(w2 => (
          <div key={'g'+w2} class="grid" style={'left:' + x(addDays(from, w2*7)) + '%'} />
        ))}
        <div class={'band ' + spec.color} data-goal={goal.id} style={'left:' + left + '%;width:' + w + '%'}>
          {prog ? <div class="prog" style={'width:' + prog + '%'} /> : null}
          <span style="position:relative">
            { goal.smart.target ? money(goal.smart.current||0) + ' / ' + money(goal.smart.target)
              : goal.smart.deadline ? fmtDate(goal.smart.deadline) : spec.label }
          </span>
        </div>
        {dots.map(ev => (
          <div key={ev.id} class="stepdot"
               style={'left:' + x(ev.dateKey) + '%' + (ev.done ? ';background:var(--dim2)' : '')} />
        ))}
        { goal.smart.deadline && goal.smart.deadline >= from && goal.smart.deadline <= to
          ? <div class="today-line" style={'left:' + x(goal.smart.deadline) + '%;background:var(--warn);opacity:.55'} />
          : null }
        { today() >= from && today() <= to
          ? <div class="today-line" style={'left:' + x(today()) + '%'} /> : null }
      </div>
    </div>
  );
}

export function QuarterView(){
  activeItemsC.value; uiRev.value;
  const { from, to, weeks } = quarterRange(DB.meta.cursor);
  const total = daysBetween(from, to) + 1;
  const x = k => clamp(daysBetween(from, k) / total * 100, 0, 100);

  const loads = Array.from({ length: weeks }, (_, w) => {
    const ws = addDays(from, w * 7);
    return { ws, mins: CAL.loadWeek(ws) };
  });
  const max = Math.max(600, ...loads.map(l => l.mins));
  const goals = liveGoals().filter(g => g.type !== 'task');

  return (
    <>
      <div class="viewhead">
        <h2>Quarter</h2><span class="sub">{fmtDate(from)} {'–'} {fmtDate(to)}</span>
        <div class="spacer" style="flex:1" />
        <div class="nav">
          <button class="btn sm" data-nav="-91">{'←'}</button>
          <button class="btn sm" data-nav="0">Now</button>
          <button class="btn sm" data-nav="91">{'→'}</button>
        </div>
      </div>

      <div class="qwrap">
        <div class="density">
          <div class="lbl tiny muted" style="text-transform:uppercase;letter-spacing:.06em">
            How booked each week already is
          </div>
          <div class="dbars">
            {loads.map(l => {
              const hgt = Math.round(l.mins / max * 100);
              const cls = l.mins > max * .75 ? 'hot' : l.mins > max * .5 ? 'heavy' : '';
              const cur = today() >= l.ws && today() < addDays(l.ws, 7) ? 'cur' : '';
              return (
                <div key={l.ws} class={'dbar ' + cls + ' ' + cur} data-jump={l.ws}
                     title={Math.round(l.mins / 60 * 10) / 10 + 'h booked'}>
                  <div class="b" style={'height:' + Math.max(2, hgt) + '%'} />
                  <div class="wk">{parseKey(l.ws).getMonth()+1}/{parseKey(l.ws).getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div class="roadmap">
          <div class="rmhead">
            <div class="l">Goal &amp; current next step</div>
            <div class="rmticks">
              {Array.from({ length: 7 }, (_, i) => i * 2).map(w => (
                <span key={w} style={'left:' + x(addDays(from, w*7)) + '%'}>{fmtDate(addDays(from, w*7))}</span>
              ))}
            </div>
          </div>
          { goals.length
            ? goals.map(g => <RoadmapRow key={g.id} goal={g} from={from} to={to} x={x} />)
            : <div style="padding:24px;text-align:center" class="muted">No goals yet. Capture one up top.</div> }
        </div>
      </div>
    </>
  );
}

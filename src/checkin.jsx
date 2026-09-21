import { TYPE } from './types.js';
import { QUAD } from './views/render.jsx';
import { hrs, loadState } from './budget.js';
import { openModalNode } from './components/modal.jsx';
import { autoNextTitle, cadenceOf, daysQuiet, followThrough, itemsOn, shortName, signals, unscheduledItems } from './engine.js';
import { lastDoneStep } from './store.js';
import { addDays, daysBetween, dkey, fmtDate, fmtDay, fmtTime, today } from './util.js';
import { uiRev, bumpUi } from './signals.js';
import { CK, CKROW, CK_MAX, suggestDay, suggestTime } from './checkin.js';
import { HUSH_AT } from './engine.js';
import { bestQuadrant } from './views/quarter.js';

/* ===================== [SECTION: CHECKIN] =====================
   A guided flow, not a dashboard. It walks you card by card and will not let a
   thread stay silent: every quiet/blocked/stepless thread has to be answered.

   Component form. The actions still live in ckAct(), which reads its values out
   of the DOM by id — so every id here is the one it looks for. What changes is
   that opening an inline row patches the card instead of rebuilding the dialog,
   so the field it just opened keeps its focus. */

function Subject({ goal, thread }){
  const bits = [TYPE[goal.type].label];
  if (thread && thread.name !== 'Main') bits.push(thread.name);
  if (thread) bits.push(({sequential:'sequential',parallel:'parallel',conditional:'branching',cyclical:'recurring'})[thread.rel] || thread.rel);
  return (
    <div class="subject">
      <div class="sh">
        <span class="dot" style={'background:' + QUAD[bestQuadrant(goal)].c} />
        <span class="g">{bits.join(' · ')}</span>
      </div>
      <div class="sn">{goal.title}</div>
      {goal.why ? <div class="tiny muted" style="margin-top:5px">why: {goal.why}</div> : null}
    </div>
  );
}

const Spacer = () => <span class="spacer" />;

function Intro({ card }){
  const a = card.ag;
  const n = a.gates.length + a.quiet.length + a.blocked.length + a.nostep.length + a.branch.length;
  const ft = followThrough(null, 14);
  return (
    <>
      <p class="wizq">Since {a.since === today() ? 'today' : fmtDate(a.since)}</p>
      <p class="wizsub">
        { n === 0 ? 'Nothing is drifting. Quick pass and you’re out.'
          : card.deferred > 0
            ? `${CK_MAX} of ${card.total} to answer — that's enough for one sitting. The rest stay in the ribbon, where you can fix any of them without coming back here.`
            : 'These threads need an answer before they can be considered live.' }
      </p>
      {a.hush.length
        ? <div class="sec tiny muted" style="border-color:#333a47">
            {a.hush.length} thread{a.hush.length>1?'s have':' has'} gone quiet past {HUSH_AT}{'×'} its cadence
            and stopped nagging. They're off this list — revive or drop them from the ribbon when you want to.
          </div>
        : null}
      <div class="sec"><div class="stat">
        <div><div class="k">{a.quiet.length}</div><div class="kl">no movement</div></div>
        <div><div class="k">{a.blocked.length}</div><div class="kl">blocked</div></div>
        <div><div class="k">{a.nostep.length + a.branch.length}</div><div class="kl">no next step</div></div>
        <div><div class="k">{a.unsched.length}</div><div class="kl">unscheduled</div></div>
        <div><div class="k">{a.gates.length}</div><div class="kl">questions queued</div></div>
      </div></div>
      <div class="sec"><h4>Follow-through, last 14 days</h4>
        <div class="stat"><div>
          <div class="k">{ft.done}<span class="muted" style="font-size:15px">/{ft.planned}</span></div>
          <div class="kl">steps done vs planned</div>
        </div></div>
        <div class="barmini"><i style={'width:' + ft.rate + '%'} /></div>
      </div>
    </>
  );
}

function Gate({ card }){
  const g = card.goal, k = card.gate.kind;
  return (
    <>
      <Subject goal={g} thread={null} />
      <p class="wizq">{card.gate.q}</p>
      {k === 'deadline' && <>
        <p class="wizsub">Deadline-type goals need a real date {'—'} the metric climbs toward it.</p>
        <label class="fld"><span>Hard date</span>
          <input type="date" id="ckDate" value={g.smart.deadline || ''} /></label>
        <label class="fld"><span>What proves it{'’'}s done (metric)</span>
          <input type="text" id="ckMetric" value={g.smart.metricName || ''} placeholder="e.g. passing exam score" /></label>
      </>}
      {k === 'trigger' && <>
        <p class="wizsub">Until this fires the goal stays dormant and will not appear anywhere or nag you.</p>
        <label class="fld"><span>Trigger condition</span>
          <input type="text" id="ckTrig" value={g.trigger || ''} placeholder="e.g. offer accepted on the house" /></label>
      </>}
      {k === 'decision' &&
        <p class="wizsub">A decision resolves once and then either closes or converts. A goal gets executed on a cadence.</p>}
      {k === 'confirm-type' && <>
        <p class="wizsub">{TYPE[g.type].hint}</p>
        <label class="fld"><span>Type</span>
          <select id="ckType" value={g.type}>
            {Object.keys(TYPE).map(t => <option key={t} value={t} selected={t === g.type}>{TYPE[t].label}</option>)}
          </select></label>
      </>}
      {k === 'resolve-decision' &&
        <p class="wizsub">Carry over only the why and your notes {'—'} not the whole decision history.</p>}
    </>
  );
}

function GateFoot({ kind }){
  if (kind === 'deadline') return <>
    <button class="btn" data-ck="skip">Ask me next week</button><Spacer />
    <button class="btn" data-ck="gate-retype">Not a deadline goal</button>
    <button class="btn primary" data-ck="gate-deadline">Set date</button></>;
  if (kind === 'trigger') return <>
    <button class="btn" data-ck="skip">Ask me next week</button><Spacer />
    <button class="btn" data-ck="gate-fire">It already fired {'—'} activate</button>
    <button class="btn primary" data-ck="gate-trigger">Save trigger</button></>;
  if (kind === 'decision') return <>
    <button class="btn" data-ck="skip">Ask me next week</button><Spacer />
    <button class="btn" data-ck="gate-isgoal">It{'’'}s a goal</button>
    <button class="btn primary" data-ck="gate-isdecision">It{'’'}s a decision</button></>;
  if (kind === 'confirm-type') return <>
    <button class="btn" data-ck="skip">Ask me next week</button><Spacer />
    <button class="btn primary" data-ck="gate-type">Confirm</button></>;
  if (kind === 'resolve-decision') return <>
    <button class="btn" data-ck="skip">Still deciding</button><Spacer />
    <button class="btn" data-ck="dec-close">Close it out</button>
    <button class="btn primary" data-ck="dec-convert">Convert to a goal</button></>;
  return null;
}

function Schedule({ list }){
  return (
    <>
      <p class="wizq">{list.length ? 'Give each next step a slot' : 'Everything has a slot'}</p>
      <p class="wizsub">If it isn{'’'}t scheduled, it isn{'’'}t real yet.</p>
      { list.length
        ? list.map(i => {
            const day = suggestDay(i, 45);
            const L = loadState(day);
            return (
              <div key={i.step.id} class="sec" data-sched={i.step.id}>
                <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
                  <span class="dot" style={'background:' + QUAD[i.quadrant].c} />
                  <div>
                    <div style="font-size:13px">{i.step.title}</div>
                    <div class="tiny muted">{shortName(i.goal)}</div>
                  </div>
                </div>
                <div class="row">
                  <input type="date" class="sd" value={day} />
                  <input type="time" class="stm" value={suggestTime(i)} />
                  <select class="sdur">
                    <option value="30">30m</option>
                    <option value="45" selected>45m</option>
                    <option value="60">1h</option>
                    <option value="90">1.5h</option>
                    <option value="120">2h</option>
                    <option value="0">no time</option>
                  </select>
                  <button class="btn primary" data-ck="sched-one" data-step={i.step.id} style="flex:none">Schedule</button>
                </div>
                <div class="tiny muted" style="margin-top:6px">
                  { L.over
                    ? <><span class="overtxt">that day is already {hrs(L.mins)}</span> against a {hrs(L.budget)} day</>
                    : <>{hrs(L.free)} free that day</> }
                </div>
              </div>
            );
          })
        : <div class="sec muted">Nothing loose.</div> }
    </>
  );
}

/* The summary used to be a report card: how many you answered, what percentage you
   hit, what's still wrong. Grading someone at the end of a chore is a poor reason
   to come back next week. What earns the five minutes is walking out with the week
   already laid out — so that's what this shows now, and the score is a footnote. */
function Summary(){
  const ft = followThrough(null, 7), sig = signals();
  const week = [];
  for (let i = 0; i < 7; i++){
    const k = addDays(today(), i);
    const its = itemsOn(k).filter(x => !x.step.done)
      .sort((a,b) => (a.start == null ? 1e9 : a.start) - (b.start == null ? 1e9 : b.start));
    if (its.length) week.push({ k, its });
  }
  const booked = week.reduce((n,d) => n + d.its.length, 0);
  // the handful that carry the week — urgent-important first, soonest first
  const RANK = { q1:0, q2:1, q3:2, q4:3 };
  const three = week.flatMap(d => d.its.map(i => ({ ...i, k: d.k })))
    .sort((a,b) => RANK[a.quadrant] - RANK[b.quadrant] || a.k.localeCompare(b.k)).slice(0, 3);
  const loose = unscheduledItems().length;

  return (
    <>
      <p class="wizq">{booked ? booked + ' thing' + (booked===1?'':'s') + ' on the calendar' : 'Nothing booked yet'}</p>
      <p class="wizsub">
        {CK.touched ? CK.touched + ' thread' + (CK.touched===1?'':'s') + ' settled. ' : ''}
        {loose ? loose + ' next step' + (loose===1?'':'s') + ' still without a slot.' : 'Everything live has a slot.'}
      </p>

      {three.length
        ? <div class="sec"><h4>If you only do three things</h4>
            {three.map(i => (
              <div key={i.step.id} class="stepline">
                <span class="dot" style={'background:' + QUAD[i.quadrant].c} />
                <span style="flex:1">{i.step.title}</span>
                <span class="st">{i.k === today() ? 'today' : fmtDay(i.k)}{i.start != null ? ' ' + fmtTime(i.start) : ''}</span>
              </div>
            ))}
          </div>
        : null}

      <div class="sec"><h4>Next seven days</h4>
        { week.length
          ? week.map(d => (
              <div key={d.k} class="wkday">
                <div class="wkd">
                  {d.k === today() ? 'Today' : fmtDay(d.k) + ' ' + fmtDate(d.k)}
                  <span class="tiny muted">{hrs(loadState(d.k).mins)}</span>
                </div>
                {d.its.map(i => (
                  <div key={i.step.id} class="stepline">
                    <span class="dot" style={'background:' + QUAD[i.quadrant].c} />
                    <span style="flex:1">{i.step.title}</span>
                    <span class="st">{i.start != null ? fmtTime(i.start) : 'all day'}</span>
                  </div>
                ))}
              </div>
            ))
          : <div class="muted tiny">Nothing scheduled in the next seven days. That is the thing to fix.</div> }
      </div>

      {sig.length
        ? <div class="sec"><h4>Still surfacing {'—'} {sig.length}</h4>
            <div class="tiny muted">In the ribbon, fixable there without another check-in.</div>
          </div>
        : null}

      <div class="tiny muted" style="text-align:center;margin-top:4px">
        Last 7 days: {ft.done} step{ft.done===1?'':'s'} done{ft.planned ? ` of ${ft.planned} planned (${ft.rate}%)` : ''}
      </div>
    </>
  );
}

/** the inline rows that replaced three browser prompts */
function Row({ card }){
  if (CKROW === 'cadence') return (
    <div class="sec">
      <label class="fld"><span>Days between touches</span>
        <input type="number" id="ckCad" min="1" value={cadenceOf(card.goal)} /></label>
      <div class="tiny muted">How often this should move before silence means something.</div>
    </div>
  );
  if (CKROW === 'blocked') return (
    <div class="sec"><label class="fld"><span>Waiting on</span>
      <input type="text" id="ckWho" placeholder="who or what" /></label></div>
  );
  if (CKROW === 'next') return (
    <div class="sec"><label class="fld"><span>Done. What's the next step?</span>
      <input type="text" id="ckNextStep" placeholder="the next move" /></label></div>
  );
  return null;
}

const ROW_FOOT = {
  cadence: ['cadence-save', 'Save cadence'],
  blocked: ['block-save', 'Mark blocked'],
  next:    ['next-save', 'Save next step']
};

function RowFoot(){
  const f = ROW_FOOT[CKROW];
  return (
    <>
      <button class="btn" data-ck="row-cancel">Back</button><Spacer />
      <button class="btn primary" data-ck={f[0]}>{f[1]}</button>
    </>
  );
}

export function CheckinCard(){
  uiRev.value;
  const c = CK.q[CK.i];
  let title = 'Weekly check-in', body = null, foot = null;

  if (c.t === 'intro'){
    body = <Intro card={c} />;
    foot = <><Spacer /><button class="btn primary" data-ck="next">Start {'→'}</button></>;
  }
  else if (c.t === 'gate'){
    title = 'Queued question';
    body = <Gate card={c} />;
    foot = <GateFoot kind={c.gate.kind} />;
  }
  else if (c.t === 'branch'){
    const t = c.thread, last = lastDoneStep(t);
    title = 'Which way did it go?';
    body = <>
      <Subject goal={c.goal} thread={t} />
      <p class="wizq">{last ? last.title : 'The last step'} {'—'} how did it resolve?</p>
      <p class="wizsub">This thread branches. The next step depends on the answer.</p>
      <div class="choices">
        {t.branches.map((b, i) => (
          <button key={i} class="btn" data-ck="branch" data-i={i}>{b.condition} {'→'} {b.next}</button>
        ))}
      </div>
    </>;
    foot = <><button class="btn" data-ck="skip">Not resolved yet</button><Spacer /></>;
  }
  else if (c.t === 'nostep'){
    title = 'Define the next step';
    /* "Actually it's blocked" sets CKROW='blocked' — same inline-row mechanism the
       `quiet` card already uses. Rendering it here (FOLLOW-UPS.md #1) is what turns
       that button from a dead end into the same block flow every other card has. */
    if (CKROW === 'blocked'){
      body = <>
        <Subject goal={c.goal} thread={c.thread} />
        <p class="wizq">What{'’'}s this waiting on?</p>
        <Row card={c} />
      </>;
      foot = <RowFoot />;
    } else {
      const sug = autoNextTitle(c.goal, c.thread, null);
      body = <>
        <Subject goal={c.goal} thread={c.thread} />
        <p class="wizq">What is the next concrete move?</p>
        <p class="wizsub">A thread with no next step is exactly how things go quiet.</p>
        <label class="fld"><span>Next step</span>
          <input type="text" id="ckStep" value={sug || ''} placeholder="one specific action" /></label>
        <label class="fld"><span>Quadrant</span>
          <select id="ckQuad" value="q2">
            {Object.keys(QUAD).map(q => (
              <option key={q} value={q} selected={q === 'q2'}>{QUAD[q].n} {'—'} {QUAD[q].ax}</option>
            ))}
          </select></label>
      </>;
      foot = <>
        <button class="btn" data-ck="block">Actually it{'’'}s blocked</button>
        <button class="btn ghost" data-ck="skip">Skip for now</button><Spacer />
        <button class="btn primary" data-ck="addstep">Add step</button></>;
    }
  }
  else if (c.t === 'blocked'){
    const t = c.thread;
    title = 'Still waiting';
    /* "Unblocked — define next" already flips t.status to active and, when the
       thread has no live step, sets CKROW='next' before re-rendering (ckAct's
       'unblock' case). Rendering that row here (FOLLOW-UPS.md #1) is what stops
       the thread landing active-and-stepless — the exact state rule 2 exists to
       prevent — with nowhere on the card to fix it. */
    if (CKROW === 'next'){
      body = <>
        <Subject goal={c.goal} thread={t} />
        <p class="wizq">Unblocked. What{'’'}s the next concrete move?</p>
        <Row card={c} />
      </>;
      foot = <RowFoot />;
    } else {
      const bd = t.blockedSince ? daysBetween(dkey(new Date(t.blockedSince)), today()) : daysQuiet(t);
      body = <>
        <Subject goal={c.goal} thread={t} />
        <p class="wizq">Waiting on {t.blockedOn || 'someone'} {'—'} {bd} day{bd===1?'':'s'}</p>
        <p class="wizsub">Blocked threads stay visible. They don{'’'}t go dormant.</p>
        {bd >= 10
          ? <div class="sec" style="border-color:#5a4a24"><b>That is a long time.</b> Consider a nudge step you control {'—'} a follow-up message is itself a next step.</div>
          : null}
      </>;
      foot = <>
        <button class="btn" data-ck="unblock-nudge">Add a nudge step</button><Spacer />
        <button class="btn" data-ck="unblock">Unblocked {'—'} define next</button>
        <button class="btn primary" data-ck="next">Still waiting</button></>;
    }
  }
  else if (c.t === 'quiet'){
    title = 'No logged movement';
    body = <>
      <Subject goal={c.goal} thread={c.thread} />
      <p class="wizq">{c.step.title}</p>
      <p class="wizsub">Quiet for {c.days} day{c.days===1?'':'s'}. Expected cadence: every {cadenceOf(c.goal)} days.</p>
      <Row card={c} />
    </>;
    foot = ROW_FOOT[CKROW]
      ? <RowFoot />
      : <>
          <button class="btn" data-ck="quiet-slip">Didn{'’'}t happen</button>
          <button class="btn" data-ck="block">Blocked</button>
          <Spacer />
          <button class="btn" data-ck="quiet-cadence">Cadence is wrong</button>
          <button class="btn primary" data-ck="quiet-done">Done {'—'} next step</button>
        </>;
  }
  else if (c.t === 'schedule'){
    const list = unscheduledItems();
    title = 'Get them on the calendar';
    body = <Schedule list={list} />;
    foot = <>
      {list.length ? <button class="btn" data-ck="sched-all">Schedule all as suggested</button> : null}
      <Spacer /><button class="btn primary" data-ck="next">Continue {'→'}</button></>;
  }
  else if (c.t === 'done'){
    title = 'The week ahead';
    body = <Summary />;
    foot = <><Spacer /><button class="btn primary" data-ck="finish">Done</button></>;
  }

  return (
    <>
      <h3>{title}
        <span class="pill">{CK.i + 1}/{CK.q.length}</span>
        <button class="btn ghost x" data-close>{'×'}</button>
      </h3>
      <div class="wizsteps">
        {CK.q.map((_, n) => (
          <div key={n} class={'s ' + (n < CK.i ? 'done' : n === CK.i ? 'on' : '')} />
        ))}
      </div>
      <div class="mbody">{body}</div>
      <div class="mfoot">
        {CK.i > 0 && CK.i < CK.q.length - 1
          ? <button class="btn ghost" data-ck="back">{'←'}</button> : null}
        {foot}
      </div>
    </>
  );
}

export function renderCheckin(){
  bumpUi();                        // the card reads CK/CKROW, which are not signals
  openModalNode(<CheckinCard />, { wide: CK.q[CK.i].t === 'schedule' });
}

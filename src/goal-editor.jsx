import { PIPELINE_STAGES, TYPE } from './types.js';
import { bestQuadrant } from './views/quarter.js';
import { hrs, loadState } from './budget.js';
import { suggestDay, suggestTime } from './checkin.js';
import { ARMED, armLabel } from './components/dialogs.js';
import { openModalNode } from './components/modal.jsx';
import { cadenceOf, daysQuiet, followThrough, money, shortName, streak, subProgress, subs } from './engine.js';
import { costTotal, fp, hasFootprint, timing, tmplList } from './footprint.js';
import { DB, currentStep, eventById, goalById } from './store.js';
import { $, dkey, fmtDate, fmtTime } from './util.js';
import { QUAD } from './views/render.jsx';
import { GEROW } from './goal-editor.js';

/* ===================== [SECTION: GOAL EDITOR] =====================
   Component form. Same contract the check-in took when it converted: the markup
   is a component, the actions still live in geAct(), and geAct() still reads its
   values out of the DOM by class and id — so every class, id and data-attribute
   here is the one it looks for.

   What changes is refreshGoal(). It used to rewrite the dialog's innerHTML, which
   threw away every node — and with them the caret. Now it re-renders the same
   tree and Preact patches it, so the field that was focused keeps its focus.

   One thing is deliberately the same: every field is given its value explicitly,
   including the empty ones (the inline-add fields, the branch halves, the block
   row). Preact writes a value prop back whenever it differs from what the DOM
   holds, which is exactly what the string rebuild did — so a refresh clears the
   add-another field after an add, and puts the DB's values back into anything
   that was typed but not read. The actions that care (sched, block, foot,
   thread-add, finish, convert) still call saveGoalFields() first, as before.

   The editor reads no signals on purpose. render() bumps uiRev on every redraw
   of the views behind it; if the editor subscribed, a rename's render() would
   re-render it too — harmless today, but it is the kind of coupling that later
   turns a background sync into a clobbered half-typed note. It redraws when
   refreshGoal() says so, and at no other time. */

const X = () => <button class="btn ghost x" data-close>{'×'}</button>;
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const flex = { flex: 1 };

/* The inline "add another" field. Same markup newInHTML() writes for the
   string dialogs, and newInAct() drives both. */
export function NewIn({ kind, ph, s, t }){
  return <input class="newin" data-new={kind} data-s={s} data-t={t} value=""
                placeholder={ph} aria-label={ph} />;
}

/* up/down beat drag here: the list is short, and arrows work with a keyboard and on
   a phone, where the quadrant drag already had to grow a dedicated grip */
export function OrdControls({ up, down, i, len, s }){
  return <>
    <button class="btn sm ghost ord" data-ge={up} data-i={i} data-s={s} disabled={i === 0}
            title="Move up" aria-label="Move up">{'▲'}</button>
    <button class="btn sm ghost ord" data-ge={down} data-i={i} data-s={s} disabled={i === len - 1}
            title="Move down" aria-label="Move down">{'▼'}</button>
  </>;
}

export function SchedRow({ g, t, s, ev }){
  const d  = ev ? ev.dateKey : suggestDay({ goal: g, quadrant: s.quadrant }, 45);
  const tm = ev && !ev.allDay ? hhmm(ev.start) : suggestTime({ goal: g, quadrant: s.quadrant });
  const L = loadState(d);
  return (
    <div class="stepline addrow">
      <input type="date" class="schd" value={d} aria-label="Date" />
      <input type="time" class="schtm" value={tm} disabled={!!(ev && ev.allDay)} aria-label="Time" />
      <label class="tiny muted" style="display:flex;gap:4px;align-items:center">
        <input type="checkbox" class="schall" checked={!!(ev && ev.allDay)} style="width:auto" />all day</label>
      <span class="tiny muted schload">{L.over
        ? <span class="overtxt">{hrs(L.mins)} booked</span>
        : hrs(L.free) + ' free'}</span>
      <button class="btn sm" data-ge="sched-cancel">cancel</button>
      <button class="btn sm primary" data-ge="sched-save" data-t={t.id} data-s={s.id}>{ev ? 'reslot' : 'schedule'}</button>
    </div>
  );
}

/* ---------- the footprint editor ----------
   Everything a step really costs, in one row under it: the minutes either side,
   the things that have to happen first, and the money. Opened from the step, not
   from Settings, because a footprint belongs to the doing rather than to the
   library it may have come from. */
export function FootRow({ t, s }){
  const f = fp(s), cats = (DB.meta.budget && DB.meta.budget.cats) || [];
  const tmpls = tmplList();
  const mins = s.actual && s.actual.mins;
  const ids = { 'data-s': s.id, 'data-t': t.id };

  return (
    <div class="footrow" data-s={s.id}>
      <div class="stepline addrow">
        <span class="tiny muted">before</span>
        <input class="fplead" type="number" min="0" step="5" value={String(f.lead)} style="width:70px" aria-label="Lead minutes" />
        <span class="tiny muted">min {'·'} after</span>
        <input class="fplag" type="number" min="0" step="5" value={String(f.lag)} style="width:70px" aria-label="Lag minutes" />
        <span class="tiny muted">min</span>
        <span class="spacer" style={flex} />
        <select class="fptmpl" aria-label="Template" value={f.tmpl || (tmpls[0] ? tmpls[0].key : '')}>
          {tmpls.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button class="btn sm" data-ge="foot-apply" {...ids}
                title="Fills gaps only — anything you have set stays">apply</button>
      </div>

      <div class="sublist">
        {f.prereqs.map(p => (
          <div key={p.id} class={'subline' + (p.done ? ' done' : '')}>
            <span class={'subchk' + (p.done ? ' on' : '')} data-ge="foot-pq-toggle" {...ids} data-pq={p.id}
                  role="checkbox" aria-checked={String(!!p.done)} tabIndex="0">{p.done ? '✓' : ''}</span>
            <input class="edit fppqt" data-pq={p.id} value={p.title} aria-label="Prerequisite" />
            <input class="fppqd" type="number" min="0" data-pq={p.id} value={String(p.leadDays)} style="width:58px"
                   aria-label="Days before" /><span class="tiny muted">d before</span>
            <button class="btn sm ghost" data-ge="foot-pq-del" {...ids} data-pq={p.id}>{'×'}</button>
          </div>
        ))}
        <div class="addrow">
          <input class="fppqnew" value="" placeholder="+ has to happen first" aria-label="New prerequisite" />
          <button class="btn sm" data-ge="foot-pq-add" {...ids}>add</button>
        </div>
        <div class="subfoot"><span class="tiny muted">A prerequisite never gets a slot and never reaches the
          matrix {'—'} it raises a signal inside its window instead.</span></div>
      </div>

      <div class="sublist">
        {f.costs.map(c => (
          <div key={c.id} class="subline">
            <input class="edit fpcl" data-c={c.id} value={c.label} aria-label="Cost label" />
            <span class="tiny muted">$</span>
            <input class="fpca" type="number" min="0" step="1" data-c={c.id} value={String(c.amount)} style="width:80px"
                   aria-label="Amount" />
            <select class="fpcc" data-c={c.id} aria-label="Category" value={c.catId || ''}>
              <option value="">{'— no category —'}</option>
              {cats.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <button class="btn sm ghost" data-ge="foot-cost-del" {...ids} data-c={c.id}>{'×'}</button>
          </div>
        ))}
        <div class="addrow">
          <input class="fpcnew" value="" placeholder="+ what it costs" aria-label="New cost line" />
          <button class="btn sm" data-ge="foot-cost-add" {...ids}>add</button>
        </div>
        <div class="subfoot"><span class="tiny muted">{f.costs.length
          ? 'Estimated at ' + money(costTotal(f.costs)) + ' — committed against the week it is scheduled in.'
          : 'Estimates only. Ply has never tracked what was actually spent.'}</span></div>
      </div>

      <div class="stepline addrow">
        {timing(s)
          ? <><span class="tiny">timing now{'…'}</span>
              <button class="btn sm primary" data-ge="foot-stop" {...ids}>stop</button></>
          : mins
            ? <><span class="tiny muted">took {mins} min</span>
                <button class="btn sm ghost" data-ge="foot-clear" {...ids}>clear</button></>
            : <><button class="btn sm" data-ge="foot-start" {...ids}>start timing</button>
                <span class="tiny muted">optional {'—'} skipping it changes nothing</span></>}
        <span class="spacer" style={flex} />
        <button class="btn sm" data-ge="foot-cancel">close</button>
        <button class="btn sm primary" data-ge="foot-save" {...ids}>save</button>
      </div>
    </div>
  );
}

export function SubList({ t, s }){
  const list = subs(s), p = subProgress(s);
  return (
    <div class="sublist" data-s={s.id}>
      {list.map((x, i) => (
        <div key={x.id} class={'subline' + (x.done ? ' done' : '')}>
          <span class={'subchk' + (x.done ? ' on' : '')} data-ge="sub-toggle" data-t={t.id} data-s={s.id} data-sub={x.id}
                role="checkbox" aria-checked={String(!!x.done)} tabIndex="0">{x.done ? '✓' : ''}</span>
          <input class="edit subtitle" data-s={s.id} data-sub={x.id} value={x.title} aria-label="Subtask" />
          <OrdControls up="sub-up" down="sub-down" i={i} len={list.length} s={s.id} />
          <button class="btn sm ghost" data-ge="sub-del" data-s={s.id} data-sub={x.id} aria-label="Delete subtask">{'×'}</button>
        </div>
      ))}
      <div class="addrow"><NewIn kind="sub" ph="+ subtask" s={s.id} /></div>
      <div class="subfoot">
        {p.any
          ? <span class="tiny muted">{p.done}/{p.total} done{p.done === p.total ? ' — ticking the last one closes the step' : ''}</span>
          : <span class="tiny muted">Break this step down if it needs it. Ticking them all completes the step.</span>}
      </div>
    </div>
  );
}

/* what the footprint button says: nothing to say is 'footprint' */
function footLabel(s){
  if (!hasFootprint(s)) return 'footprint';
  const f = fp(s), side = f.lead + f.lag, open = f.prereqs.filter(p => !p.done).length;
  return (side ? '+' + side + 'm' : '')
       + (f.costs.length ? ' ' + money(costTotal(f.costs)) : '')
       + (open ? ' · ' + open + ' first' : '');
}

const rowOpen = (kind, id) => !!(GEROW && GEROW.kind === kind && GEROW.id === id);
const RELS = ['sequential', 'parallel', 'conditional', 'blocked', 'cyclical'];

function Thread({ g, t }){
  const cur = currentStep(t), hist = t.steps.filter(s => s.done).slice(-4);
  const ev = cur && cur.eventId ? eventById(cur.eventId) : null;
  const armKey = 'thread-del:' + t.id;
  return (
    <div class={'thread ' + t.status} data-thread={t.id}>
      <div class="th">
        <input type="text" class="tname" value={t.name}
               style="width:auto;flex:1;background:transparent;border-color:transparent;font-weight:600" />
        <select class="trel" style="width:auto;flex:none" value={t.rel}>
          {RELS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button class={'btn sm ghost' + (ARMED === armKey ? ' danger' : '')} data-ge="thread-del" data-t={t.id}
          >{armLabel(armKey, '×', 'remove thread?')}</button>
      </div>

      {t.status === 'blocked'
        ? <div class="tiny" style="color:var(--warn);margin-bottom:6px">Waiting on{' '}
            <input type="text" class="tblock" value={t.blockedOn || ''} style="width:auto;display:inline-block;padding:2px 6px" />
            {' '}since {t.blockedSince ? fmtDate(dkey(new Date(t.blockedSince))) : '?'}{'  '}
            <button class="btn sm" data-ge="unblock" data-t={t.id}>Unblock</button></div>
        : null}

      {t.status === 'dormant'
        ? <div class="tiny muted" style="margin-bottom:6px">Dormant until: {g.trigger || 'trigger undefined'}{' '}
            <button class="btn sm" data-ge="fire" data-t={t.id}>Trigger fired</button></div>
        : null}

      {t.rel === 'conditional'
        ? <div class="tiny muted" style="margin-bottom:6px">Branches
            {t.branches.map((b, i) => (
              <div key={i} class="stepline"><span class="muted">if</span> {b.condition}{' '}
                <span class="muted">{'→'}</span> {b.next}{' '}
                <button class="btn sm ghost" data-ge="branch-del" data-t={t.id} data-i={i}>{'×'}</button></div>
            ))}
            <div class="stepline addrow"><span class="muted">if</span>
              <input class="brif" data-t={t.id} value="" placeholder="it goes this way" aria-label="Branch condition" />
              <span class="muted">{'→'}</span>
              <input class="brthen" data-t={t.id} value="" placeholder="then this is the next step" aria-label="Branch next step" />
              <button class="btn sm" data-ge="branch-add" data-t={t.id}>add</button></div></div>
        : null}

      <div class="steplist">
        {hist.map(s => (
          <div key={s.id} class="stepline hist"><span class="st">{s.doneAt ? fmtDate(dkey(new Date(s.doneAt))) : ''}</span>
            {' ✓ '}{s.title}{s.outcome ? <> <span class="muted">({s.outcome})</span></> : null}</div>
        ))}
        {cur
          ? <>
              <div class="stepline cur">
                <span class="dot" style={'background:' + QUAD[cur.quadrant].c} />
                <input class="edit steptitle" data-s={cur.id} value={cur.title} aria-label="Step title" />
                {ev
                  ? <span class="st">{fmtDate(ev.dateKey)}{ev.allDay ? '' : ' ' + fmtTime(ev.start)}</span>
                  : <span class="st" style="color:var(--warn)">unscheduled</span>}
                <button class={'btn sm' + (rowOpen('sched', cur.id) ? ' primary' : '')}
                        data-ge="sched" data-t={t.id} data-s={cur.id}>{ev ? 'reslot' : 'slot it'}</button>
                <button class={'btn sm' + (rowOpen('foot', cur.id) ? ' primary' : '')}
                        data-ge="foot" data-t={t.id} data-s={cur.id}
                        title="What it really costs: time either side, what has to happen first, money">{footLabel(cur)}</button>
                <button class="btn sm" data-ge="complete" data-t={t.id} data-s={cur.id}>done</button>
              </div>
              {rowOpen('sched', cur.id) ? <SchedRow g={g} t={t} s={cur} ev={ev} /> : null}
              {rowOpen('foot', cur.id) ? <FootRow t={t} s={cur} /> : null}
              <SubList t={t} s={cur} />
            </>
          : <div class="stepline" style="color:var(--bad)">no next step {'—'} name it below</div>}
        {t.status !== 'dormant'
          ? <div class="stepline addrow"><NewIn kind="step" ph="+ next step" t={t.id} /></div>
          : null}
      </div>

      {t.status !== 'blocked' && t.status !== 'dormant'
        ? (rowOpen('block', t.id)
          ? <div class="stepline addrow"><span class="muted tiny">Waiting on</span>
              <input class="blockwho" data-t={t.id} value="" placeholder="who or what" aria-label="Waiting on" />
              <button class="btn sm" data-ge="block-cancel">cancel</button>
              <button class="btn sm primary" data-ge="block-save" data-t={t.id}>mark blocked</button></div>
          : <div style="margin-top:7px"><button class="btn sm" data-ge="block" data-t={t.id}>mark blocked</button></div>)
        : null}
    </div>
  );
}

function TypeExtra({ g }){
  if (g.type === 'milestone') return (
    <div class="sec"><h4>Backlog</h4>
      {g.backlog.length
        ? g.backlog.map((b, i) => (
            /* keyed by position: the items are plain strings and may repeat, and
               geAct() addresses them by index anyway */
            <div key={i} class="stepline">
              <span class="st">{i + 1}</span>
              <input class="edit backtitle" data-i={i} value={b} aria-label={'Backlog item ' + (i + 1)} />
              <OrdControls up="backlog-up" down="backlog-down" i={i} len={g.backlog.length} />
              <button class="btn sm ghost" data-ge="backlog-del" data-i={i}>{'×'}</button></div>
          ))
        : <div class="tiny muted">Empty. Completing a step will ask you to define the next one instead of pulling from here.</div>}
      <div class="stepline addrow"><NewIn kind="backlog" ph="+ backlog item" /></div></div>
  );
  if (g.type === 'contingent') return (
    <div class="sec"><h4>Trigger</h4>
      <input type="text" id="geTrig" value={g.trigger || ''} placeholder="what activates this goal" /></div>
  );
  if (g.type === 'pipeline') return (
    <div class="sec"><h4>Stages</h4>
      <div class="tiny muted">{(g.stages || PIPELINE_STAGES).join(' → ')}</div>
      <div class="stepline addrow" style="margin-top:8px"><NewIn kind="entry" ph="+ pipeline entry (company or contact)" />
        <span class="tiny muted"> each entry is its own parallel thread with its own stage</span></div></div>
  );
  return null;
}

/* `n` changes on every refreshGoal(), so a re-render is never skipped as
   "same props" — nothing in here is a signal to do that job instead. */
export function GoalEditor({ id }){
  const g = goalById(id);
  if (!g) return <h3>Gone<X /></h3>;
  const spec = TYPE[g.type], ft = followThrough(g.id);
  const smart = g.smart;
  const delKey = 'del:' + g.id;

  return (
    <>
      <h3><span class="dot" style={'background:' + QUAD[bestQuadrant(g)].c} />
        <span style={flex}>{shortName(g)}</span>
        <span class="pill">{spec.label}</span>
        <X /></h3>
      <div class="mbody" data-goal={g.id}>
        <div class="sec"><h4>SMART definition</h4>
          <label class="fld"><span>Goal</span><input type="text" id="geTitle" value={g.title} /></label>
          <div class="row">
            <label class="fld"><span>Type</span><select id="geType" value={g.type}>
              {Object.keys(TYPE).map(t => <option key={t} value={t}>{TYPE[t].label}</option>)}</select></label>
            <label class="fld"><span>Cadence (days)</span><input type="number" id="geCad" value={cadenceOf(g) == null ? '' : String(cadenceOf(g))} min="0" /></label>
            <label class="fld"><span>Deadline{smart.deadlineSoft ? ' (soft)' : ''}</span>
              <input type="date" id="geDL" value={smart.deadline || ''} /></label>
          </div>
          <label class="fld"><span>Specific outcome</span><input type="text" id="geOut" value={smart.outcome || ''}
            placeholder="what is actually true when this is done" /></label>
          <div class="row">
            <label class="fld"><span>Metric</span><input type="text" id="geMet" value={smart.metricName || ''} placeholder={spec.metric || ''} /></label>
            <label class="fld"><span>Current</span><input type="number" id="geCur" value={String(smart.current || 0)} /></label>
            <label class="fld"><span>Target</span><input type="number" id="geTgt" value={smart.target == null ? '' : String(smart.target)} /></label>
          </div>
          <div class="tiny muted">{spec.hint}</div>
        </div>

        {(g.gates || []).length
          ? <div class="sec" style="border-color:#5a4a24">
              <h4 style="color:var(--warn)">Queued for the next check-in</h4>
              {g.gates.map((x, i) => <div key={x.id || i} class="stepline">{x.q}</div>)}</div>
          : null}
        <TypeExtra g={g} />

        <div class="sec"><h4>Threads <span class="spacer" />
          <button class="btn sm" data-ge="thread-add">+ thread</button></h4>
          {g.threads.map(t => <Thread key={t.id} g={g} t={t} />)}</div>

        <div class="sec"><h4>Follow-through {'·'} 28 days</h4>
          <div class="stat">
            <div><div class="k">{ft.done}<span class="muted" style="font-size:15px">/{ft.planned}</span></div><div class="kl">done / planned</div></div>
            <div><div class="k">{streak(g.id)}</div><div class="kl">day streak</div></div>
            <div><div class="k">{daysQuiet(g.threads[0] || {})}</div><div class="kl">days since movement</div></div>
          </div><div class="barmini"><i style={'width:' + ft.rate + '%'} /></div></div>

        <div class="sec"><h4>Context</h4>
          <label class="fld"><span>Why</span><textarea id="geWhy" value={g.why || ''} /></label>
          <label class="fld"><span>Notes</span><textarea id="geNotes" value={g.notes || ''} /></label></div>
      </div>
      <div class="mfoot">
        <button class="btn" data-ge="finish">Mark complete</button>
        <button class={'btn danger' + (ARMED === delKey ? ' armed' : '')} data-ge="del"
          >{armLabel(delKey, 'Delete', 'Really delete? Click again')}</button>
        {g.type === 'decision' ? <button class="btn" data-ge="convert">Convert to goal</button> : null}
        <span class="spacer" />
        <button class="btn primary" data-ge="save">Save</button>
      </div>
    </>
  );
}

let N = 0;
export function renderGoalEditor(id){
  openModalNode(<GoalEditor id={id} n={++N} />, { wide: true, nofocus: true });
}
/* is the goal editor what's open right now (rather than some other dialog)? */
export const editorOpen = () => !!$('.mbody[data-goal]');

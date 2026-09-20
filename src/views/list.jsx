import { TYPE } from '../types.js';
import { CARDSUBS } from '../components/card.js';
import { DayStrip } from '../components/card.jsx';
import { hushed, subProgress, subs } from '../engine.js';
import { DB, currentStep, doneGoals, eventById, liveGoals } from '../store.js';
import { daysBetween, dkey, fmtDateY, fmtFull, relDays, today } from '../util.js';
import { activeItemsC, uiRev } from '../signals.js';

/* ================= LIST =================
   Day, Week and Quarter are all altitudes over a calendar. This one isn't — it's the
   flat answer to "what have I actually got on", one row per goal, filtered by type.
   It reads the same state as everything else and adds no new concepts: the row shows
   the goal's live step, its slot and its checklist, so anything you can see here you
   can act on here.

   First view converted to a component. The markup is deliberately identical,
   data attributes included: the click router in wireView() still does the
   dispatching, so this step changes how the DOM is produced and nothing about
   what it means. What it buys immediately is that a re-render patches the rows
   that changed instead of replacing the whole list, so scroll position and the
   caret survive without captureView()/restoreView() having to put them back. */
export const listHidden = ()=> new Set((DB.meta.listHidden||[]).filter(x=>!!TYPE[x]));

/* what a goal is waiting on, in one phrase — the same conditions signals() uses */
export function goalState(g){
  const live=g.threads.filter(t=>t.status!=='done');
  const blocked=live.find(t=>t.status==='blocked');
  // a blocked thread still has a step — it just can't move. Report both.
  if(blocked) return {k:'blocked', sev:'warn', text:'waiting on '+(blocked.blockedOn||'someone'),
                      thread:blocked, step:currentStep(blocked)};
  if(live.length && live.every(t=>t.status==='dormant'))
    return {k:'dormant', sev:'mute', text:g.trigger?('until '+g.trigger):'dormant'};
  const t=live.find(x=>x.status!=='dormant');
  if(!t) return {k:'dormant', sev:'mute', text:'dormant'};
  if(t.needsBranch) return {k:'branch', sev:'hard', text:'branch unresolved', thread:t};
  const s=currentStep(t);
  if(!s) return {k:'nostep', sev:'hard', text:'no next step', thread:t};
  if(hushed(g,t)) return {k:'hushed', sev:'mute', text:'gone quiet', thread:t, step:s};
  const ev=s.eventId?eventById(s.eventId):null;
  if(!ev && g.type!=='task') return {k:'unscheduled', sev:'warn', text:'unscheduled', thread:t, step:s};
  if(ev && ev.dateKey<today()) return {k:'slipped', sev:'hard', text:'slipped '+daysBetween(ev.dateKey,today())+'d', thread:t, step:s, ev};
  return {k:'ok', sev:'ok', text:ev?relDays(daysBetween(today(),ev.dateKey)):'', thread:t, step:s, ev};
}
export const STATE_ORDER={hard:0, warn:1, ok:2, mute:3};

/* One checklist line. Keyed by sub id, so ticking one patches that line rather
   than rebuilding the list under the pointer. */
function SubLine({ sub, step, thread, goal }){
  return (
    <div class={'subline' + (sub.done ? ' done' : '')}
         data-step={step.id} data-sub={sub.id} data-thread={thread.id} data-goal={goal.id}>
      <span class={'subchk' + (sub.done ? ' on' : '')} data-act="sub" data-step={step.id} data-sub={sub.id}
            data-goal={goal.id} data-thread={thread.id}
            role="checkbox" aria-checked={String(sub.done)} tabIndex="0">{sub.done ? '✓' : ''}</span>
      <span class="x">{sub.title}</span>
      <span class="grip subgrip" title="Drag onto the calendar to schedule this step">{'⋮⋮'}</span>
    </div>
  );
}

function LiveRow({ goal, st }){
  const s = st.step, prog = s ? subProgress(s) : { any: false };
  const open = !!(s && CARDSUBS.has(s.id));
  return (
    <div class={'lrow ' + st.sev + (s ? ' draggable' : '')}
         data-goal={goal.id}
         data-step={s ? s.id : undefined} data-thread={s ? st.thread.id : undefined}>
      {/* only a row with a live step can be dragged — there'd be nothing to schedule */}
      {s ? <span class="grip" title="Drag onto the calendar strip to schedule">{'⋮⋮'}</span> : <span />}
      <span class="ltype">{TYPE[goal.type].label}</span>
      <span class="lttl">{goal.title}</span>
      <span class="lstep">
        { s ? s.title
          : st.k === 'dormant' ? <span class="muted">{'—'}</span>
          : <span class="overtxt">needs a next step</span> }
      </span>
      <span class={'lstate ' + st.sev}>{st.text}</span>
      { prog.any
        ? <span class={'pill tiny subpill' + (prog.done === prog.total ? ' full' : '')}
                data-act="subs" data-step={s.id} title={(open ? 'Hide' : 'Show') + ' subtasks'}>
            {prog.done}/{prog.total} {open ? '▲' : '▼'}
          </span>
        : <span /> }
      { open &&
        <div class="lsubs">
          {subs(s).map(x => <SubLine key={x.id} sub={x} step={s} thread={st.thread} goal={goal} />)}
        </div> }
    </div>
  );
}

function ArchiveRow({ goal }){
  const steps = goal.threads.reduce((n,t)=>n+t.steps.filter(s=>s.done).length,0);
  return (
    <div class="lrow mute" data-goal={goal.id}>
      <span />
      <span class="ltype">{TYPE[goal.type].label}</span>
      <span class="lttl done">{goal.title}</span>
      <span class="lstep">{steps} step{steps===1?'':'s'} done{goal.why ? ' · ' + goal.why : ''}</span>
      <span class="lstate">{goal.doneAt ? fmtDateY(dkey(new Date(goal.doneAt))) : '—'}</span>
      <button class="btn sm" data-reopen={goal.id}>reopen</button>
    </div>
  );
}

export function ListView(){
  activeItemsC.value; uiRev.value;          // subscribe: the item stream, and expand/collapse
  const hidden = listHidden();
  const archive = !!DB.meta.listDone;
  const all = archive ? doneGoals() : liveGoals();
  const counts = {}; for (const g of all) counts[g.type] = (counts[g.type]||0) + 1;

  const rows = archive
    ? all.filter(g=>!hidden.has(g.type)).map(g=>({g, st:null}))
    : all.filter(g=>!hidden.has(g.type))
        .map(g=>({g, st:goalState(g)}))
        .sort((a,b)=> STATE_ORDER[a.st.sev]-STATE_ORDER[b.st.sev]
          || (a.st.ev?a.st.ev.dateKey:'9999').localeCompare(b.st.ev?b.st.ev.dateKey:'9999')
          || a.g.title.localeCompare(b.g.title));

  const attention = archive ? 0 : rows.filter(r=>r.st.sev==='hard'||r.st.sev==='warn').length;
  const k = DB.meta.cursor;
  const nDone = DB.goals.filter(g=>g.status==='done').length;

  return (
    <>
      <div class="viewhead">
        <h2>{archive ? 'Completed' : 'Everything'}</h2>
        <span class="sub">
          {rows.length} of {all.length} goal{all.length===1?'':'s'}
          {attention ? <>{' · '}<span class="overtxt">{attention} need{attention===1?'s':''} attention</span></> : ''}
        </span>
        <div class="spacer" style="flex:1" />
        <div class="nav">
          {hidden.size ? <button class="btn sm" data-ltype="*">Show all types</button> : ''}
          {archive ? '' : <>
            <button class="btn sm" data-nav="-1">{'←'}</button>
            <button class="btn sm" data-nav="0">Today</button>
            <button class="btn sm" data-nav="1">{'→'}</button>
          </>}
        </div>
      </div>

      {archive ? '' : <>
        <div class="lbl striplbl">
          <span>{k===today() ? 'Today' : fmtFull(k)}</span>
          <span class="tiny muted">drag a row onto the strip to schedule it</span>
        </div>
        <DayStrip k={k} drop />
      </>}

      <div class="ltogs">
        {Object.keys(TYPE).map(t => {
          const n = counts[t] || 0, off = hidden.has(t);
          /* reuse the quarter view's band palette so a type looks the same wherever it appears */
          return (
            <button key={t} class={'ltog ' + (TYPE[t].color||'') + (off?' off':'') + (n?'':' empty')}
                    data-ltype={t} aria-pressed={String(!off)}
                    title={(off?'Show':'Hide') + ' ' + TYPE[t].label.toLowerCase()}>
              <span class="sw" />{TYPE[t].label}<span class="n">{n}</span>
            </button>
          );
        })}
        <button class={'ltog done' + (archive ? '' : ' off')} data-listdone="1" aria-pressed={String(archive)}
                title={archive ? 'Back to live goals' : 'Show completed goals'}>
          <span class="sw" />{archive ? 'Live goals' : 'Completed'}
          <span class="n">{archive ? liveGoals().length : nDone}</span>
        </button>
      </div>

      <div class="lrows">
        { rows.length
          ? rows.map(({g, st}) => archive
              ? <ArchiveRow key={g.id} goal={g} />
              : <LiveRow key={g.id} goal={g} st={st} />)
          : <div class="lempty">
              { hidden.size ? 'Every type is switched off.'
                : archive ? 'Nothing finished yet. Completed goals are kept here rather than disappearing.'
                : 'Nothing active. Capture something.' }
            </div> }
      </div>
    </>
  );
}

import { useLayoutEffect } from 'preact/hooks';
import { BUD_DRAFT, budSig, budget, budgetFigures, catColour, catProjection, catSegStyle,
         committedThisWeek, fundableGoals } from './budget.js';
import { money, shortName } from './engine.js';
import { rev, uiRev } from './signals.js';
import { fmtDateY } from './util.js';

/* ---------- the weekly money panel ----------
   Same contract the check-in and the goal editor took: the markup is a component,
   the actions stay where they were. wireView() still routes input to paintBudget(),
   change to commitBudget() + save(), and clicks to budAct(); commitBudget() still
   reads the fields out of the DOM by class. Every class, data-attribute and
   aria-label here is the one those look for.

   What is new is where the live feedback comes from. paintBudget() used to reach
   into the bar and the summary and rewrite their innerHTML on every keystroke; now
   it reads the fields into BUD_DRAFT and this redraws from that. Nothing the person
   is typing into is ever replaced: the inputs are given back exactly the strings
   they hold, so Preact has nothing to write.

   Two things answer to the draft, and the rest answers to the DB, as before:
   - the inputs, the bar, the summary and the percentages follow what is typed;
   - the projection notes and the Log button follow what is saved — a projection is
     a claim about money actually allocated, and it should not flicker while an
     amount is half-typed.

   This also fixes a bug the wrapper had. The wrapper re-rendered after every save,
   and a committed edit changes the saved budget, so the html string changed and the
   whole panel's innerHTML was replaced a tick after the change — including the field
   focus had just tabbed into. */

const X = '×';

/* the note under a row: what a linked category's allocation actually buys */
function Note({ c, p, com }){
  if (c.goalId && !p) return <span class="bnote warn">linked goal has no money target</span>;
  if (p && p.done)    return <span class="bnote good">target reached</span>;
  if (p && p.stalled) return (
    <span class="bnote overtxt">{money(+c.amount)}/wk allocated but {money(p.committed)} of it is
      already committed — nothing is reaching the goal this week</span>);
  if (p && p.weeks){
    // what the allocation buys once this week's commitments are taken out of it
    const net = p.committed
      ? `${money(+c.amount)}/wk allocated, ${money(p.committed)} committed, ${money(p.effective)} reaching the goal · `
      : `${money(+c.amount)}/wk `;
    return (
      <span class="bnote">{net}clears {money(p.remaining)} in {p.weeks} week{p.weeks > 1 ? 's' : ''} · {fmtDateY(p.date)}
        {p.lateDays > 0
          ? <> <span class="overtxt">{p.lateDays}d past the deadline</span></>
          : p.lateDays != null ? <> <span class="good">before the deadline</span></> : null}
      </span>);
  }
  if (p && p.needed) return <span class="bnote">needs {money(p.needed)}/wk to hit the deadline</span>;
  if (p)             return <span class="bnote">{money(p.remaining)} still to go</span>;
  if (com)           return <span class="bnote">{money(com)} committed this week</span>;
  return null;
}

function Summary({ F }){
  if (F.unset) return (
    <span class="tiny muted">Set a weekly amount to see each category as a share of it.{
      F.committed ? ' ' + money(F.committed) + ' is already committed this week.' : ''}</span>);
  return (
    <span class={'tiny ' + (F.over || F.overCom ? 'overtxt' : 'muted')}>
      {money(F.allocated)} allocated of {money(F.weekly)} · {F.over ? money(-F.left) + ' over' : money(F.left) + ' unallocated'}
      {F.committed
        ? <> · <span class={F.overAlloc || F.overCom ? 'overtxt' : ''}>{money(F.committed)} committed</span></>
        : null}
    </span>);
}

/* When allocation or commitment exceeds the budget, the bar scales to whichever is
   larger and the budget becomes a line across it — the overshoot is shown rather
   than clipped. Committed money with no category still counts against the week, so
   it shows in the unallocated remainder rather than vanishing into it. */
function Bar({ F, rows }){
  const over = F.over || F.overCom;
  const restW  = F.basis > 0 ? Math.max(0, (F.basis - F.allocated) / F.basis * 100) : 100;
  const uncatW = F.basis > 0 ? Math.min(restW, F.uncat / F.basis * 100) : 0;
  return (
    <div class={'bbar' + (over ? ' over' : '')}>
      {rows.map((c, i) => {
        const w = F.pct(c);
        if (w <= 0) return null;
        const com = F.com(c);
        return <i key={c.id} data-cat={c.id} data-com={com}
                  style={catSegStyle(catColour(i), w, c.amount ? com / c.amount : 0)}
                  title={c.name + ' — ' + money(c.amount) + (com ? ' · ' + money(com) + ' committed' : '')
                         + (F.weekly > 0 ? ' · ' + Math.round(F.share(c)) + '% of the budget' : '')} />;
      })}
      {uncatW > 0.01
        ? <i key="uncat" class="rest uncat" data-uncat={F.uncat} title={money(F.uncat) + ' committed, no category'}
             style={`width:${uncatW}%`} /> : null}
      {restW - uncatW > 0.01 ? <i key="rest" class="rest" style={`width:${restW - uncatW}%`} /> : null}
      {over ? <u key="line" style={`left:${F.weekly / F.basis * 100}%`} /> : null}
    </div>);
}

export function BudgetPanel(){
  rev.value; uiRev.value;
  const saved = budget(), savedCats = saved.cats || [];
  const d = BUD_DRAFT.value;
  const draft = d && d.base === budSig() ? d : null;

  /* A draft typed over a budget that has since changed is dropped for good, not
     just ignored — otherwise an undo back to the old budget would resurrect it. */
  useLayoutEffect(() => { if (d && !draft && BUD_DRAFT.peek() === d) BUD_DRAFT.value = null; });

  const rows = draft
    ? draft.cats.map(c => ({ id: c.id, name: c.name, raw: c.amount, amount: +c.amount || 0, goalId: c.goalId }))
    : savedCats.map(c => ({ id: c.id, name: c.name, raw: String(+c.amount || 0), amount: +c.amount || 0,
                            goalId: c.goalId || null }));
  const weeklyRaw = draft ? draft.weekly : (+saved.weekly || 0 ? String(+saved.weekly) : '');
  const F = budgetFigures(+weeklyRaw || 0, rows, committedThisWeek());
  const fundable = fundableGoals();

  return (
    <div class="strip budget" style="margin-top:14px">
      <div class="lbl">
        <span>Weekly budget</span>
        <span class="bsum"><Summary F={F} /></span>
        <span class="spacer" style="flex:1"></span>
        <span class="bwrap tiny">Budget <span>$</span><input class="bweekly" type="number" min="0" step="1"
          value={weeklyRaw} placeholder="0" aria-label="Weekly budget" /></span>
      </div>
      <Bar F={F} rows={rows} />
      <div class="brows">
        {rows.length ? rows.map((r, i) => {
          const c = savedCats.find(x => x.id === r.id);          // notes answer to what is saved
          const p = c ? catProjection(c) : null;
          const com = F.com(r);
          return (
            <div class="brow" data-cat={r.id} key={r.id}>
              <span class="bsw" style={`background:${catColour(i)}`}></span>
              <input class="bname" type="text" value={r.name} placeholder="Category" aria-label="Category name" />
              <div class="bamtwrap"><span>$</span><input class="bamt" type="number" min="0" step="1"
                value={r.raw} aria-label={'Amount for ' + (c ? c.name : r.name)} /></div>
              <span class="bpct" title={com ? money(com) + ' committed' : 'nothing committed yet'}>{
                F.weekly > 0 || F.allocated > 0 ? Math.round(F.share(r)) + '%' : '—'}</span>
              <select class="bgoal" aria-label="Link to a goal" value={r.goalId || ''}>
                <option value="">— no goal —</option>
                {fundable.map(g => <option key={g.id} value={g.id}>{shortName(g)}</option>)}
              </select>
              {c && c.goalId && p && !p.done
                ? <button class="btn sm" data-bud="log" data-cat={r.id}
                    title="Add this to the goal and close out its current contribution step">Log</button>
                : null}
              <button class="btn ghost sm bdel" data-bud="del" data-cat={r.id} title="Remove category">{X}</button>
              {c ? <Note c={c} p={p} com={com} /> : null}
            </div>);
        }) : <div class="tiny muted" style="padding:6px 2px">No categories yet.</div>}
      </div>
      <button class="btn sm" data-bud="add" style="margin-top:8px">+ Category</button>
      {rows.length && fundable.length ? null
        : <div class="tiny muted" style="margin-top:8px">{
            fundable.length ? '' : 'Threshold-type goals (a money target) can be linked to a category once you have one.'}</div>}
    </div>);
}

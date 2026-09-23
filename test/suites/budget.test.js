import { describe, it, expect, beforeEach } from 'vitest';
import { boot, tinyDB, TARGET, isLegacy } from '../harness.js';

/* The weekly budget panel, pinned from the outside before it stops being a string.

   The original money-budget suite (69 assertions) was among those that could not be
   recovered, so this is its replacement, written against the string version and green
   on both targets before the panel was touched.

   Everything here is driven through the rendered Week view — the inputs, the bar, the
   buttons — rather than through viewBudget()'s markup, so the same assertions hold
   whether the panel is a string or a component.

   The property the string version was careful about, and the reason this suite had
   to exist first: typing repaints the bar, the summary and the percentages on every
   keystroke WITHOUT writing to the DB, and the write happens on change, so one edit
   is one undo step — and the field being typed into is never rebuilt under the caret.

   Committed spend (footprints, schema 9) postdates the monolith, so that block is
   [src] only, the same way footprint.test.js is. */
const srcOnly = isLegacy ? describe.skip : describe;
const itSrc = isLegacy ? it.skip : it;

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; h.forbidNatives(); });

const norm   = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const panel  = () => h.$('#view .budget');
const rows   = () => h.$$('#view .brow');
const row    = id => h.$(`#view .brow[data-cat="${id}"]`);
const inp    = (id, cls) => row(id).querySelector('.' + cls);
const weekly = () => h.$('#view .bweekly');
const bar    = () => h.$('#view .bbar');
const seg    = id => h.$(`#view .bbar i[data-cat="${id}"]`);
const segs   = () => h.$$('#view .bbar i[data-cat]');
const rest   = () => h.$$('#view .bbar i.rest').reduce((n, e) => n + parseFloat(e.style.width), 0);
const line   = () => h.$('#view .bbar u');
const w      = el => parseFloat(el.style.width);
const pct    = id => norm(row(id).querySelector('.bpct').textContent);
const note   = id => { const n = row(id).querySelector('.bnote'); return n ? norm(n.textContent) : null; };
const logBtn = id => row(id).querySelector('[data-bud="log"]');
const summary = () => norm(h.$('#view .bsum').textContent);
const sumSpan = () => h.$('#view .bsum span');
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

/* a week view over a budget of your choosing */
function setup(budget, extra){
  tinyDB(p, api => { api.DB.meta.budget = budget; if (extra) extra(api); });
  p.DB.meta.zoom = 'week';
  p.save(); p.render();
}
const two = (weekly = 200) => ({ weekly, cats: [
  { id: 'c1', name: 'Food', amount: 100, goalId: null },
  { id: 'c2', name: 'Transport', amount: 50, goalId: null }
]});

/* a threshold goal — the only kind a category can fund */
function fundGoal(api, { target = 2100, current = 0, deadline = null, title = 'Save for a car' } = {}){
  const g = api.newGoal({ title, type: 'threshold' });
  g.smart = { outcome: '', metricName: '', metricUnit: '$', target, current, deadline, deadlineSoft: false };
  g.threads.push(api.newThread({ rel: 'cyclical' }));
  g.threads[0].steps.push(api.newStep('This period’s contribution'));
  api.DB.goals.push(g);
  return g;
}
function linked({ amount = 150, weekly: wk = 400, ...goal } = {}){
  let g;
  setup({ weekly: wk, cats: [] }, api => {
    g = fundGoal(api, goal);
    api.DB.meta.budget.cats = [{ id: 'cs', name: 'Car fund', amount, goalId: g.id }];
  });
  return g;
}
const when = weeks => p.fmtDateY(p.addDays(p.today(), weeks * 7));

/* ================================================================== */
describe('budget panel — drawn from the DB [' + TARGET + ']', () => {
  it('an empty budget says so, and the bar is all remainder', () => {
    setup({ weekly: 0, cats: [] });
    expect(panel()).toBeTruthy();
    expect(norm(h.$('#view .brows').textContent)).toBe('No categories yet.');
    expect(weekly().value).toBe('');
    expect(weekly().getAttribute('placeholder')).toBe('0');
    expect(summary()).toBe('Set a weekly amount to see each category as a share of it.');
    expect(segs().length).toBe(0);
    expect(rest()).toBeCloseTo(100);
    expect(line()).toBe(null);
    expect(h.$('#view [data-bud="add"]')).toBeTruthy();
  });

  it('one row per category, carrying its name, amount, colour and id', () => {
    setup(two());
    expect(rows().map(r => r.dataset.cat)).toEqual(['c1', 'c2']);
    expect(inp('c1', 'bname').value).toBe('Food');
    expect(inp('c1', 'bamt').value).toBe('100');
    expect(inp('c2', 'bname').value).toBe('Transport');
    expect(inp('c2', 'bamt').value).toBe('50');
    expect(inp('c1', 'bamt').getAttribute('aria-label')).toBe('Amount for Food');
    expect(row('c1').querySelector('.bsw').style.background).toBe(rgb(p.catColour(0)));
    expect(row('c2').querySelector('.bsw').style.background).toBe(rgb(p.catColour(1)));
    expect(row('c1').querySelector('.bdel').dataset.cat).toBe('c1');
    expect(weekly().value).toBe('200');
  });

  it('with a weekly amount, each block is a share of it and the rest is unallocated', () => {
    setup(two(200));
    expect(w(seg('c1'))).toBeCloseTo(50);
    expect(w(seg('c2'))).toBeCloseTo(25);
    expect(rest()).toBeCloseTo(25);
    expect(pct('c1')).toBe('50%');
    expect(pct('c2')).toBe('25%');
    expect(summary()).toBe('$150 allocated of $200 · $50 unallocated');
    expect(bar().classList.contains('over')).toBe(false);
    expect(line()).toBe(null);
    expect(sumSpan().classList.contains('overtxt')).toBe(false);
  });

  it('segments keep the colour of their row', () => {
    setup(two(200));
    expect(seg('c1').style.background).toContain(rgb(p.catColour(0)));
    expect(seg('c2').style.background).toContain(rgb(p.catColour(1)));
  });

  it('with no weekly amount, blocks show the relative split and the summary asks for one', () => {
    setup({ weekly: 0, cats: [
      { id: 'c1', name: 'Food', amount: 30, goalId: null },
      { id: 'c2', name: 'Transport', amount: 10, goalId: null }] });
    expect(weekly().value).toBe('');
    expect(w(seg('c1'))).toBeCloseTo(75);
    expect(w(seg('c2'))).toBeCloseTo(25);
    expect(rest()).toBeCloseTo(0);
    expect(pct('c1')).toBe('75%');
    expect(pct('c2')).toBe('25%');
    expect(summary()).toBe('Set a weekly amount to see each category as a share of it.');
  });

  it('over-allocation rescales the bar and draws the budget as a line across it', () => {
    setup(two(100));
    expect(bar().classList.contains('over')).toBe(true);
    expect(w(seg('c1'))).toBeCloseTo(100 / 150 * 100);
    expect(w(seg('c2'))).toBeCloseTo(50 / 150 * 100);
    expect(rest()).toBeCloseTo(0);
    expect(parseFloat(line().style.left)).toBeCloseTo(100 / 150 * 100);
    expect(pct('c1')).toBe('100%');
    expect(pct('c2')).toBe('50%');
    expect(summary()).toBe('$150 allocated of $100 · $50 over');
    expect(sumSpan().classList.contains('overtxt')).toBe(true);
  });

  it('a zero-amount category has a row but no block', () => {
    setup({ weekly: 100, cats: [
      { id: 'c1', name: 'Food', amount: 0, goalId: null },
      { id: 'c2', name: 'Transport', amount: 40, goalId: null }] });
    expect(seg('c1')).toBe(null);
    expect(w(seg('c2'))).toBeCloseTo(40);
    expect(pct('c1')).toBe('0%');
    expect(inp('c1', 'bamt').value).toBe('0');
  });

  it('with nothing to divide by, the percentage is a dash', () => {
    setup({ weekly: 0, cats: [{ id: 'c1', name: 'Food', amount: 0, goalId: null }] });
    expect(pct('c1')).toBe('—');
    expect(rest()).toBeCloseTo(100);
  });

  it('only threshold goals are offered as a link, by their short name', () => {
    let car, run;
    setup(two(), api => {
      car = fundGoal(api);
      run = api.newGoal({ title: 'Run a 10k', type: 'milestone' }); api.DB.goals.push(run);
      api.DB.meta.budget.cats[1].goalId = car.id;
    });
    const opts = [...inp('c1', 'bgoal').options];
    expect(opts.map(o => o.value)).toEqual(['', car.id]);
    expect(norm(opts[0].textContent)).toBe('— no goal —');
    expect(norm(opts[1].textContent)).toBe(p.shortName(car));
    expect(inp('c1', 'bgoal').value).toBe('');
    expect(inp('c2', 'bgoal').value).toBe(car.id);
  });

  it('says a threshold goal is needed before anything can be linked — and stops saying it once there is one', () => {
    setup(two());
    expect(norm(panel().textContent)).toContain('Threshold-type goals (a money target) can be linked');
    setup(two(), api => fundGoal(api));
    expect(norm(panel().textContent)).not.toContain('Threshold-type goals');
  });

  it('an unlinked category has no Log button and no projection', () => {
    setup(two());
    expect(logBtn('c1')).toBe(null);
    expect(note('c1')).toBe(null);
  });
});

/* ================================================================== */
describe('budget panel — what a linked category projects [' + TARGET + ']', () => {
  it('says when the allocation clears the target, and offers Log', () => {
    linked({ amount: 150, target: 2100 });
    expect(note('cs')).toBe('$150/wk clears $2,100 in 14 weeks · ' + when(14));
    expect(logBtn('cs')).toBeTruthy();
    expect(logBtn('cs').dataset.cat).toBe('cs');
  });

  it('singular week', () => {
    linked({ amount: 500, target: 300 });
    expect(note('cs')).toBe('$500/wk clears $300 in 1 week · ' + when(1));
  });

  it('flags a hard deadline it will miss, in days', () => {
    const dl = () => p.addDays(p.today(), 30);
    linked({ amount: 150, target: 2100, deadline: dl() });
    const late = p.daysBetween(dl(), p.addDays(p.today(), 98));
    expect(note('cs')).toBe(`$150/wk clears $2,100 in 14 weeks · ${when(14)} ${late}d past the deadline`);
    expect(row('cs').querySelector('.bnote .overtxt')).toBeTruthy();
  });

  it('says so when it lands before the deadline', () => {
    linked({ amount: 150, target: 2100, deadline: p.addDays(p.today(), 200) });
    expect(note('cs')).toBe(`$150/wk clears $2,100 in 14 weeks · ${when(14)} before the deadline`);
    expect(row('cs').querySelector('.bnote .good')).toBeTruthy();
  });

  it('with no allocation but a deadline, says what the deadline needs', () => {
    linked({ amount: 0, target: 2100, deadline: p.addDays(p.today(), 70) });
    expect(note('cs')).toBe('needs $210/wk to hit the deadline');
  });

  it('with neither, says what is left to go', () => {
    linked({ amount: 0, target: 2100 });
    expect(note('cs')).toBe('$2,100 still to go');
    expect(logBtn('cs')).toBeTruthy();
  });

  it('a reached target says so and loses its Log button', () => {
    linked({ amount: 150, target: 2100, current: 2100 });
    expect(note('cs')).toBe('target reached');
    expect(row('cs').querySelector('.bnote.good')).toBeTruthy();
    expect(logBtn('cs')).toBe(null);
  });

  it('a link to a goal with no money target degrades to a warning, not a projection', () => {
    let run;
    setup({ weekly: 200, cats: [] }, api => {
      run = api.newGoal({ title: 'Run a 10k', type: 'milestone' }); api.DB.goals.push(run);
      api.DB.meta.budget.cats = [{ id: 'cx', name: 'Shoes', amount: 40, goalId: run.id }];
    });
    expect(note('cx')).toBe('linked goal has no money target');
    expect(row('cx').querySelector('.bnote.warn')).toBeTruthy();
    expect(logBtn('cx')).toBe(null);
  });
});

/* ================================================================== */
describe('budget panel — live feedback while typing, no DB write [' + TARGET + ']', () => {
  it('typing an amount repaints the block, the percentage and the summary', async () => {
    setup(two(200));
    h.type(inp('c1', 'bamt'), '150');
    await h.settle();
    expect(w(seg('c1'))).toBeCloseTo(75);
    expect(w(seg('c2'))).toBeCloseTo(25);
    expect(rest()).toBeCloseTo(0);
    expect(pct('c1')).toBe('75%');
    expect(pct('c2')).toBe('25%');
    expect(summary()).toBe('$200 allocated of $200 · $0 unallocated');
  });

  it('…and writes nothing: the DB and the undo stack are untouched until change', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.type(inp('c1', 'bamt'), '150');
    h.type(inp('c2', 'bname'), 'Bus');
    h.type(weekly(), '999');
    await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(100);
    expect(p.DB.meta.budget.cats[1].name).toBe('Transport');
    expect(p.DB.meta.budget.weekly).toBe(200);
    expect(p.UNDO.length).toBe(undo);
    expect(JSON.parse(h.window.localStorage.getItem(p.KEY)).meta.budget.cats[0].amount).toBe(100);
  });

  it('typing past the weekly amount turns the bar over, and back again', async () => {
    setup(two(200));
    h.type(inp('c1', 'bamt'), '300');
    await h.settle();
    expect(bar().classList.contains('over')).toBe(true);
    expect(parseFloat(line().style.left)).toBeCloseTo(200 / 350 * 100);
    expect(w(seg('c1'))).toBeCloseTo(300 / 350 * 100);
    expect(summary()).toBe('$350 allocated of $200 · $150 over');
    expect(sumSpan().classList.contains('overtxt')).toBe(true);

    h.type(inp('c1', 'bamt'), '100');
    await h.settle();
    expect(bar().classList.contains('over')).toBe(false);
    expect(line()).toBe(null);
    expect(summary()).toBe('$150 allocated of $200 · $50 unallocated');
    expect(sumSpan().classList.contains('overtxt')).toBe(false);
  });

  it('typing the weekly amount rebases every percentage', async () => {
    setup(two(200));
    h.type(weekly(), '300');
    await h.settle();
    expect(pct('c1')).toBe('33%');
    expect(pct('c2')).toBe('17%');
    expect(w(seg('c1'))).toBeCloseTo(100 / 300 * 100);
    expect(rest()).toBeCloseTo(150 / 300 * 100);
    expect(summary()).toBe('$150 allocated of $300 · $150 unallocated');
  });

  it('clearing the weekly amount falls back to the relative split', async () => {
    setup(two(200));
    h.type(weekly(), '');
    await h.settle();
    expect(pct('c1')).toBe('67%');
    expect(pct('c2')).toBe('33%');
    expect(summary()).toBe('Set a weekly amount to see each category as a share of it.');
    expect(line()).toBe(null);
  });

  it('a block appears when an amount is typed into an empty category, and goes when it is cleared', async () => {
    setup({ weekly: 100, cats: [{ id: 'c1', name: 'Food', amount: 0, goalId: null }] });
    expect(seg('c1')).toBe(null);
    h.type(inp('c1', 'bamt'), '40');
    await h.settle();
    expect(w(seg('c1'))).toBeCloseTo(40);
    expect(pct('c1')).toBe('40%');
    h.type(inp('c1', 'bamt'), '');
    await h.settle();
    expect(seg('c1')).toBe(null);
    expect(pct('c1')).toBe('0%');
  });

  it('the field being typed into is never rebuilt: same node, same focus, same text — even when emptied', async () => {
    setup(two(200));
    const a = inp('c1', 'bamt');
    a.focus();
    h.type(a, '');
    await h.settle();
    expect(a.isConnected).toBe(true);
    expect(inp('c1', 'bamt')).toBe(a);
    expect(a.value).toBe('');                       // not rewritten to "0" under the caret
    expect(h.document.activeElement).toBe(a);
    h.type(a, '7');
    await h.settle();
    expect(inp('c1', 'bamt')).toBe(a);
    expect(a.value).toBe('7');
  });

  it('the caret in a name field survives a repaint', async () => {
    setup(two(200));
    const n = inp('c2', 'bname');
    n.focus();
    h.type(n, 'Groceries');
    n.setSelectionRange(3, 3);
    h.type(inp('c1', 'bamt'), '120');              // a repaint triggered from elsewhere
    n.focus();
    await h.settle();
    expect(inp('c2', 'bname')).toBe(n);
    expect(n.value).toBe('Groceries');
    expect(n.selectionStart).toBe(3);
    expect(h.document.activeElement).toBe(n);
  });

  it('the weekly field keeps its node and its text while typed into', async () => {
    setup(two(200));
    const wk = weekly();
    wk.focus();
    h.type(wk, '25');
    await h.settle();
    expect(weekly()).toBe(wk);
    expect(wk.value).toBe('25');
    expect(h.document.activeElement).toBe(wk);
  });

  it('a projection answers to what is saved, not to what is being typed', async () => {
    linked({ amount: 150, target: 2100 });
    h.type(inp('cs', 'bamt'), '300');
    await h.settle();
    expect(note('cs')).toBe('$150/wk clears $2,100 in 14 weeks · ' + when(14));
    h.change(inp('cs', 'bamt'), '300');
    await h.settle();
    p.render();                                     // the projection redraws on the next render
    await h.settle();
    expect(note('cs')).toBe('$300/wk clears $2,100 in 7 weeks · ' + when(7));
  });

  it('when the DB changes underneath, what is shown is the DB', async () => {
    setup(two(200));
    h.type(inp('c1', 'bamt'), '999');
    await h.settle();
    p.DB.meta.budget.cats[0].amount = 70;
    p.save(); p.render();
    await h.settle();
    expect(inp('c1', 'bamt').value).toBe('70');
    expect(w(seg('c1'))).toBeCloseTo(35);
    expect(summary()).toBe('$120 allocated of $200 · $80 unallocated');
  });

  // The monolith rebuilt all of #view on every render, so an unrelated render
  // dropped whatever had been typed but not yet committed. The migrated tree never has.
  itSrc('an unrelated render does not throw away text that has not been committed yet', async () => {
    setup(two(200));
    const a = inp('c1', 'bamt');
    a.focus();
    h.type(a, '120');
    await h.settle();
    p.render();
    await h.settle();
    expect(inp('c1', 'bamt')).toBe(a);
    expect(a.value).toBe('120');
    expect(h.document.activeElement).toBe(a);
    expect(w(seg('c1'))).toBeCloseTo(60);
  });
});

/* ================================================================== */
describe('budget panel — commit on change, one edit one undo step [' + TARGET + ']', () => {
  it('an amount is written on change, as one undo step', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.change(inp('c1', 'bamt'), '150');
    await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(150);
    expect(p.UNDO.length).toBe(undo + 1);
    expect(p.UNDO[p.UNDO.length - 1].label).toBe('that budget edit');
    expect(w(seg('c1'))).toBeCloseTo(75);
    expect(summary()).toBe('$200 allocated of $200 · $0 unallocated');

    p.undo();
    await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(100);
    expect(inp('c1', 'bamt').value).toBe('100');
    expect(w(seg('c1'))).toBeCloseTo(50);
    expect(summary()).toBe('$150 allocated of $200 · $50 unallocated');
  });

  it('two edits are two undo steps', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.change(inp('c1', 'bamt'), '120'); await h.settle();
    h.change(inp('c2', 'bamt'), '60');  await h.settle();
    expect(p.UNDO.length).toBe(undo + 2);
    p.undo(); await h.settle();
    expect(p.DB.meta.budget.cats.map(c => c.amount)).toEqual([120, 50]);
    expect(inp('c2', 'bamt').value).toBe('50');
    p.undo(); await h.settle();
    expect(p.DB.meta.budget.cats.map(c => c.amount)).toEqual([100, 50]);
  });

  it('a name is trimmed, and a blank one is saved as Untitled', async () => {
    setup(two(200));
    h.change(inp('c1', 'bname'), '  Groceries  '); await h.settle();
    expect(p.DB.meta.budget.cats[0].name).toBe('Groceries');
    h.change(inp('c2', 'bname'), '   '); await h.settle();
    expect(p.DB.meta.budget.cats[1].name).toBe('Untitled');
  });

  it('the weekly amount is written on change; blank is zero', async () => {
    setup(two(200));
    h.change(weekly(), '350'); await h.settle();
    expect(p.DB.meta.budget.weekly).toBe(350);
    expect(pct('c1')).toBe('29%');
    h.change(weekly(), ''); await h.settle();
    expect(p.DB.meta.budget.weekly).toBe(0);
    expect(summary()).toBe('Set a weekly amount to see each category as a share of it.');
  });

  it('an emptied amount is stored as the number zero', async () => {
    setup(two(200));
    h.change(inp('c1', 'bamt'), ''); await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(0);
    expect(typeof p.DB.meta.budget.cats[0].amount).toBe('number');
  });

  it('a commit takes every field as it stands, not just the one that changed', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.type(inp('c2', 'bname'), 'Bus');             // typed, never blurred
    h.type(weekly(), '250');
    h.change(inp('c1', 'bamt'), '120');
    await h.settle();
    expect(p.DB.meta.budget.cats[1].name).toBe('Bus');
    expect(p.DB.meta.budget.weekly).toBe(250);
    expect(p.DB.meta.budget.cats[0].amount).toBe(120);
    expect(p.UNDO.length).toBe(undo + 1);          // and all of it is one step
    p.undo(); await h.settle();
    expect(p.DB.meta.budget.cats[1].name).toBe('Transport');
    expect(p.DB.meta.budget.weekly).toBe(200);
    expect(inp('c2', 'bname').value).toBe('Transport');
    expect(weekly().value).toBe('200');
  });

  it('linking a goal is written at once and redraws the row with its projection and Log', async () => {
    let car;
    setup(two(200), api => { car = fundGoal(api); });
    expect(logBtn('c1')).toBe(null);
    h.change(inp('c1', 'bgoal'), car.id);
    await h.settle();
    expect(p.DB.meta.budget.cats[0].goalId).toBe(car.id);
    expect(inp('c1', 'bgoal').value).toBe(car.id);
    expect(note('c1')).toBe('$100/wk clears $2,100 in 21 weeks · ' + when(21));
    expect(logBtn('c1')).toBeTruthy();

    h.change(inp('c1', 'bgoal'), '');
    await h.settle();
    expect(p.DB.meta.budget.cats[0].goalId).toBe(null);
    expect(note('c1')).toBe(null);
    expect(logBtn('c1')).toBe(null);
  });

  /* Tabbing out of a field is what fires its change. The commit's save() used to
     re-render the wrapper, and because the saved value changed the html string, the
     whole panel's innerHTML was replaced a tick later — taking the field that focus
     had just moved into with it. The monolith never re-rendered on that path. */
  it('tabbing from one field to the next keeps focus in the next one', async () => {
    setup(two(200));
    const next = inp('c1', 'bname');
    h.change(inp('c1', 'bamt'), '130');            // blur of the amount commits it...
    next.focus();                                   // ...as focus lands on the next field
    await h.settle();
    await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(130);
    expect(next.isConnected).toBe(true);
    expect(h.document.activeElement).toBe(next);
  });

  it('ids survive a commit — the row is the same category afterwards', async () => {
    setup(two(200));
    h.change(inp('c2', 'bamt'), '75'); await h.settle();
    expect(p.DB.meta.budget.cats.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(rows().map(r => r.dataset.cat)).toEqual(['c1', 'c2']);
  });
});

/* ================================================================== */
describe('budget panel — the buttons [' + TARGET + ']', () => {
  it('+ Category adds a blank row, focuses its name, and is one undo step', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.click('#view [data-bud="add"]');
    await h.settle();
    expect(p.DB.meta.budget.cats.length).toBe(3);
    const c = p.DB.meta.budget.cats[2];
    expect(c).toMatchObject({ name: '', amount: 0, goalId: null });
    expect(c.id).toBeTruthy();
    expect(rows().length).toBe(3);
    const last = rows()[2];
    expect(last.dataset.cat).toBe(c.id);
    expect(last.querySelector('.bname').value).toBe('');
    expect(last.querySelector('.bamt').value).toBe('0');
    expect(h.document.activeElement).toBe(last.querySelector('.bname'));
    expect(p.UNDO.length).toBe(undo + 1);
    expect(p.UNDO[p.UNDO.length - 1].label).toBe('that new category');
    p.undo(); await h.settle();
    expect(p.DB.meta.budget.cats.length).toBe(2);
    expect(rows().length).toBe(2);
  });

  it('adding keeps what was typed but not yet committed', async () => {
    setup(two(200));
    h.type(inp('c1', 'bamt'), '130');
    h.click('#view [data-bud="add"]');
    await h.settle();
    expect(p.DB.meta.budget.cats[0].amount).toBe(130);
    expect(inp('c1', 'bamt').value).toBe('130');
  });

  it('the first category of an empty budget', async () => {
    setup({ weekly: 0, cats: [] });
    h.click('#view [data-bud="add"]');
    await h.settle();
    expect(rows().length).toBe(1);
    expect(h.$('#view .brows').textContent).not.toContain('No categories yet.');
  });

  it('× removes the category, and is one undo step', async () => {
    setup(two(200));
    const undo = p.UNDO.length;
    h.click(row('c1').querySelector('.bdel'));
    await h.settle();
    expect(p.DB.meta.budget.cats.map(c => c.id)).toEqual(['c2']);
    expect(row('c1')).toBe(null);
    expect(seg('c1')).toBe(null);
    expect(summary()).toBe('$50 allocated of $200 · $150 unallocated');
    expect(p.UNDO.length).toBe(undo + 1);
    expect(p.UNDO[p.UNDO.length - 1].label).toBe('removing that category');
    p.undo(); await h.settle();
    expect(rows().map(r => r.dataset.cat)).toEqual(['c1', 'c2']);
  });

  it('removing keeps what was typed into the other rows', async () => {
    setup(two(200));
    h.type(inp('c2', 'bamt'), '80');
    h.click(row('c1').querySelector('.bdel'));
    await h.settle();
    expect(p.DB.meta.budget.cats).toEqual([{ id: 'c2', name: 'Transport', amount: 80, goalId: null }]);
    expect(inp('c2', 'bamt').value).toBe('80');
  });

  it('removing the last category leaves the empty state', async () => {
    setup({ weekly: 100, cats: [{ id: 'c1', name: 'Food', amount: 40, goalId: null }] });
    h.click(row('c1').querySelector('.bdel'));
    await h.settle();
    expect(norm(h.$('#view .brows').textContent)).toBe('No categories yet.');
    expect(rest()).toBeCloseTo(100);
  });

  it('Log banks the allocation against the goal and closes out its contribution step', async () => {
    const g = linked({ amount: 150, target: 2100 });
    const step = g.threads[0].steps[0];
    const undo = p.UNDO.length;
    h.click(logBtn('cs'));
    await h.settle();
    const G = p.goalById(g.id);
    expect(G.smart.current).toBe(150);
    expect(G.threads[0].steps.find(s => s.id === step.id).done).toBe(true);
    expect(h.lastToast()).toBe('$150 logged — ' + p.shortName(G) + ' at $150 of $2,100');
    expect(note('cs')).toBe('$150/wk clears $1,950 in 13 weeks · ' + when(13));
    expect(p.UNDO.length).toBe(undo + 1);
    p.undo(); await h.settle();
    expect(p.goalById(g.id).smart.current).toBe(0);
  });

  it('Log that reaches the target says so, and the Log button goes', async () => {
    const g = linked({ amount: 150, target: 300, current: 200 });
    h.click(logBtn('cs'));
    await h.settle();
    expect(p.goalById(g.id).smart.current).toBe(350);
    expect(h.lastToast()).toContain('· target reached');
    expect(note('cs')).toBe('target reached');
    expect(logBtn('cs')).toBe(null);
  });

  it('Log with nothing allocated asks for an amount and changes nothing', async () => {
    const g = linked({ amount: 0, target: 2100 });
    const undo = p.UNDO.length;
    h.click(logBtn('cs'));
    await h.settle();
    expect(h.lastToast()).toBe('Give the category an amount first.');
    expect(p.goalById(g.id).smart.current).toBe(0);
    expect(p.UNDO.length).toBe(undo);
  });

  it('clicking a block in the bar puts the caret in that category’s amount', () => {
    setup(two(200));
    h.click(seg('c2'));
    expect(h.document.activeElement).toBe(inp('c2', 'bamt'));
  });

  it('clicks inside the panel are not goal clicks — nothing opens', () => {
    setup(two(200));
    h.click(row('c1').querySelector('.bsw'));
    h.click(row('c1'));
    h.click(h.$('#view .bsum'));
    h.click(inp('c1', 'bname'));
    expect(h.$('.modal')).toBe(null);
  });
});

/* ================================================================== */
function anchored(api, { dateKey = api.today(), start = 9 * 60, dur = 60, type = 'milestone' } = {}){
  const g = api.newGoal({ title: 'A goal', type });
  const t = api.newThread({ rel: 'sequential' });
  const s = api.newStep('The next move', {});
  t.steps.push(s); g.threads.push(t); api.DB.goals.push(g);
  api.CAL.anchor(g, t, s, dateKey, start, dur);
  return s;
}
function spend(api, amount, catId = null){
  const s = anchored(api, { dateKey: api.startOfWeek(api.today()) });
  api.ensureFootprint(s).costs.push(api.normCost({ label: 'Spent', amount, catId }));
}

srcOnly('budget panel — committed spend alongside the allocation [' + TARGET + ']', () => {
  it("committed money is the solid part of the category's own block", () => {
    setup(two(200), api => spend(api, 50, 'c1'));
    expect(seg('c1').dataset.com).toBe('50');
    expect(seg('c1').style.background).toMatch(/linear-gradient\(90deg, rgb\([^)]+\) 0 50%/);
    expect(seg('c2').dataset.com).toBe('0');
    expect(summary()).toBe('$150 allocated of $200 · $50 unallocated · $50 committed');
  });

  it('committing past the weekly amount turns the bar over and scales it to the commitment', () => {
    setup(two(150), api => spend(api, 400, 'c1'));
    expect(bar().classList.contains('over')).toBe(true);
    expect(parseFloat(line().style.left)).toBeCloseTo(150 / 400 * 100);
    expect(w(seg('c1'))).toBeCloseTo(100 / 400 * 100);
    expect(sumSpan().classList.contains('overtxt')).toBe(true);
    expect(h.$('#view .bsum .overtxt').textContent).toContain('$400 committed');
  });

  it('uncategorised committed money shows in the remainder rather than vanishing into it', () => {
    setup(two(200), api => spend(api, 9));
    const u = h.$('#view .bbar i.rest.uncat');
    expect(u).toBeTruthy();
    expect(u.dataset.uncat).toBe('9');
    expect(w(u)).toBeCloseTo(9 / 200 * 100);
    expect(rest()).toBeCloseTo(25);
  });

  it('with no weekly amount, the summary still says what is committed', () => {
    setup(two(0), api => spend(api, 30, 'c2'));
    expect(summary()).toBe('Set a weekly amount to see each category as a share of it. $30 is already committed this week.');
  });

  it('an unlinked category with committed spend says how much', () => {
    setup(two(200), api => spend(api, 50, 'c1'));
    expect(note('c1')).toBe('$50 committed this week');
    expect(row('c1').querySelector('.bpct').getAttribute('title')).toBe('$50 committed');
    expect(row('c2').querySelector('.bpct').getAttribute('title')).toBe('nothing committed yet');
  });

  it('a linked row names all three numbers rather than only the result', () => {
    setup({ weekly: 400, cats: [] }, api => {
      const g = fundGoal(api);
      api.DB.meta.budget.cats = [{ id: 'cs', name: 'Car fund', amount: 150, goalId: g.id }];
      spend(api, 45, 'cs');
    });
    expect(note('cs')).toBe('$150/wk allocated, $45 committed, $105 reaching the goal · clears $2,100 in 20 weeks · ' + when(20));
  });

  it('says nothing is reaching the goal when all of it is already committed', () => {
    setup({ weekly: 400, cats: [] }, api => {
      const g = fundGoal(api);
      api.DB.meta.budget.cats = [{ id: 'cs', name: 'Car fund', amount: 150, goalId: g.id }];
      spend(api, 150, 'cs');
    });
    expect(note('cs')).toBe('$150/wk allocated but $150 of it is already committed — nothing is reaching the goal this week');
    expect(row('cs').querySelector('.bnote.overtxt')).toBeTruthy();
  });

  it('while typing, committed spend stays in the bar and the summary', async () => {
    setup(two(200), api => spend(api, 50, 'c1'));
    h.type(inp('c1', 'bamt'), '200');
    await h.settle();
    expect(seg('c1').dataset.com).toBe('50');
    expect(seg('c1').style.background).toMatch(/ 0 25%/);
    expect(bar().classList.contains('over')).toBe(true);
    expect(summary()).toContain('$250 allocated of $200 · $50 over');
    expect(summary()).toContain('$50 committed');
  });

  it('typing an amount below what is committed keeps the block solid', async () => {
    setup(two(200), api => spend(api, 50, 'c1'));
    h.type(inp('c1', 'bamt'), '25');
    await h.settle();
    expect(seg('c1').style.background).toMatch(/ 0 100%/);
  });
});

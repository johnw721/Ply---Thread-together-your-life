import { describe, it, expect, beforeEach } from 'vitest';
import { boot, makeGoal, TARGET, isLegacy } from '../harness.js';

/* Schema 9: what a step really costs — the minutes either side of its slot, the
   things that have to be true before it, and the money it spends.

   The monolith predates all of it, so this suite is the one place the two targets
   are not asked to agree: there is nothing in legacy/index.html for it to pin. */
const d = isLegacy ? describe.skip : describe;

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const T = () => p.today();
const WS = () => p.startOfWeek(p.today());

/* a step with a slot, which is what almost everything below needs */
function anchored(api, {dateKey = api.today(), start = 9*60, dur = 60, type = 'milestone'} = {}){
  const m = makeGoal(api, {type});
  const ev = api.CAL.anchor(m.goal, m.thread, m.step, dateKey, start, dur);
  return {...m, ev};
}

d('migrate 8→9 — footprints arrive absent, not malformed [' + TARGET + ']', () => {
  const file = (over = {}) => ({
    schema: 8, log: [], meta: {}, events: [{id:'e1', title:'x', dateKey:'2026-03-02', start:540, dur:60,
      src:'manual', goalId:null, threadId:null, stepId:null, recur:null, skips:[], gcal:null,
      updatedAt:'2026-03-01T00:00:00.000Z'}],
    goals: [{ id:'g1', title:'a goal', type:'milestone', status:'active', doneAt:null,
      createdAt:'2026-01-02T00:00:00.000Z', updatedAt:'2026-01-02T00:00:00.000Z',
      smart:{}, gates:[], backlog:[], threads:[{ id:'t1', name:'Main', rel:'sequential', status:'active',
        branches:[], lastMovement:'2026-01-02T00:00:00.000Z', updatedAt:'2026-01-02T00:00:00.000Z',
        steps:[Object.assign({ id:'s1', title:'a step', quadrant:'q2', done:false, doneAt:null,
          eventId:null, outcome:null, auto:false, subs:[],
          createdAt:'2026-01-02T00:00:00.000Z', updatedAt:'2026-01-02T00:00:00.000Z' }, over)] }] }]
  });
  const step = doc => doc.goals[0].threads[0].steps[0];

  it('backfills footprint:null and actual:null rather than inventing one', () => {
    const doc = file();
    expect(p.migrate(doc).ok).toBe(true);
    expect(step(doc).footprint).toBe(null);
    expect(step(doc).actual).toBe(null);
    expect(doc.schema).toBe(p.SCHEMA);
  });

  it('gives every event a costs array, so a manual event can carry money', () => {
    const doc = file();
    p.migrate(doc);
    expect(Array.isArray(doc.events[0].costs)).toBe(true);
    expect(doc.events[0].costs.length).toBe(0);
  });

  it('seeds the template meta the editor and the learning loop both read', () => {
    const doc = file();
    p.migrate(doc);
    const m = doc.meta.footprint;
    expect(m.overrides).toEqual({});
    expect(m.custom).toEqual([]);
    expect(m.hidden).toEqual([]);
    expect(m.gates).toEqual([]);
    expect(m.learnAfter).toBe(5);
  });

  it('coerces a malformed footprint field by field instead of trusting the file', () => {
    const doc = file({ footprint: { lead:'45', lag:-30, tmpl:7,
      prereqs:[{title:'Book it', leadDays:'2'}, 'nope', null, {}],
      costs:[{label:'Meal', amount:'60'}, {amount:-5}, 42] } });
    p.migrate(doc);
    const f = step(doc).footprint;
    expect(f.lead).toBe(45);              // a numeric string is a number
    expect(f.lag).toBe(0);                // negative minutes are not minutes
    expect(f.tmpl).toBe(null);            // a number is not a template key
    expect(f.prereqs.length).toBe(2);     // the two objects survive, the junk doesn't
    expect(f.prereqs[0]).toMatchObject({title:'Book it', leadDays:2, done:false});
    expect(f.prereqs[1].title).toBe('Untitled');
    expect(f.prereqs.every(x => !!x.id)).toBe(true);
    expect(f.costs.length).toBe(2);
    expect(f.costs[0]).toMatchObject({label:'Meal', amount:60, catId:null});
    expect(f.costs[1].amount).toBe(0);    // a negative cost is not a cost
  });

  it('drops an actual that never recorded anything, and rounds one that did', () => {
    const a = file({ actual:{startedAt:null, stoppedAt:null, mins:null} });
    p.migrate(a); expect(a.goals[0].threads[0].steps[0].actual).toBe(null);
    const b = file({ actual:{startedAt:'2026-03-01T09:00:00.000Z', stoppedAt:null, mins:'61.4'} });
    p.migrate(b); expect(b.goals[0].threads[0].steps[0].actual.mins).toBe(61);
  });

  it('is idempotent — migrating twice produces the same document', () => {
    const doc = file({ footprint:{lead:'20', lag:20, prereqs:[{title:'Kit', leadDays:1}], costs:[]} });
    p.migrate(doc);
    const once = JSON.stringify(doc);
    p.migrate(doc);
    expect(JSON.stringify(doc)).toBe(once);
  });

  it('a step created today already has the fields, so nothing has to backfill it', () => {
    const s = p.newStep('fresh');
    expect('footprint' in s).toBe(true);
    expect(s.footprint).toBe(null);
    expect(p.newEvent({}).costs).toEqual([]);
  });
});

d('applying a template fills gaps and nothing else [' + TARGET + ']', () => {
  it('fills lead, lag, prereqs and cost lines on an empty step', () => {
    const {step} = makeGoal(p);
    const r = p.applyTemplate(step, 'dinner-out');
    const t = p.tmplGet('dinner-out');
    expect(r.filled).toContain('lead');
    expect(step.footprint.lead).toBe(t.lead);
    expect(step.footprint.lag).toBe(t.lag);
    expect(step.footprint.prereqs.map(x => x.title)).toEqual(t.prereqs.map(x => x.title));
    expect(step.footprint.costs.length).toBe(t.costs.length);
    expect(step.footprint.tmpl).toBe('dinner-out');
  });

  it('never overwrites a lead or lag the user already set', () => {
    const {step} = makeGoal(p);
    p.ensureFootprint(step).lead = 5;
    const r = p.applyTemplate(step, 'gym');
    expect(step.footprint.lead).toBe(5);            // kept
    expect(step.footprint.lag).toBe(p.tmplGet('gym').lag);  // filled
    expect(r.kept).toContain('lead');
    expect(r.filled).toContain('lag');
  });

  it('leaves a prereq of the same name exactly as the user left it', () => {
    const {step} = makeGoal(p);
    const f = p.ensureFootprint(step);
    f.prereqs.push(p.normPrereq({title:'Reservation made', leadDays:9, done:true}));
    p.applyTemplate(step, 'dinner-out');
    const mine = f.prereqs.filter(x => x.title === 'Reservation made');
    expect(mine.length).toBe(1);                    // not duplicated
    expect(mine[0].leadDays).toBe(9);               // not reset
    expect(mine[0].done).toBe(true);
  });

  it('leaves a cost line of the same label alone, including its category', () => {
    const {step} = makeGoal(p);
    p.ensureFootprint(step).costs.push(p.normCost({label:'Meal', amount:12, catId:'cat-mine'}));
    p.applyTemplate(step, 'dinner-out');
    const meals = step.footprint.costs.filter(c => c.label === 'Meal');
    expect(meals.length).toBe(1);
    expect(meals[0].amount).toBe(12);
    expect(meals[0].catId).toBe('cat-mine');
    expect(step.footprint.costs.some(c => c.label === 'Ride there')).toBe(true);  // the rest still land
  });

  it('applying the same template twice adds nothing the second time', () => {
    const {step} = makeGoal(p);
    p.applyTemplate(step, 'flight');
    const before = JSON.stringify(step.footprint);
    const second = p.applyTemplate(step, 'flight');
    expect(JSON.stringify(step.footprint)).toBe(before);
    expect(second.filled.length).toBe(0);
  });

  it('resolves a cost category by name, and degrades to uncategorised when there is none', () => {
    p.DB.meta.budget.cats = [{id:'c-food', name:'Food', amount:100, goalId:null}];
    const {step} = makeGoal(p);
    p.applyTemplate(step, 'dinner-out');
    const byLabel = l => step.footprint.costs.find(c => c.label === l);
    expect(byLabel('Meal').catId).toBe('c-food');
    expect(byLabel('Ride there').catId).toBe(null);   // no Transport category exists here
  });

  it('is one undoable action through the engine wrapper', () => {
    const {step} = makeGoal(p);
    p.save();
    p.checkpoint('that template');
    p.applyFootprint(step.id, 'gym');
    expect(p.fp(p.stepById(step.id)).lead).toBeGreaterThan(0);
    p.undo();
    expect(p.fp(p.stepById(step.id)).lead).toBe(0);
  });

  it('an edit is stored as an override, so untouched fields still follow the built-in', () => {
    const before = p.tmplGet('gym');
    p.tmplSet('gym', {lag: 55});
    expect(p.tmplGet('gym').lag).toBe(55);
    expect(p.tmplGet('gym').lead).toBe(before.lead);
    expect(p.DB.meta.footprint.overrides.gym).toEqual({lag: 55});
    expect(Object.keys(p.DB.meta.footprint.overrides.gym)).toEqual(['lag']);
    p.tmplReset('gym');
    expect(p.tmplGet('gym').lag).toBe(before.lag);
  });
});

d('the classifier offers, and never applies [' + TARGET + ']', () => {
  it('queues a footprint gate when capture text matches a template', () => {
    const c = p.classify('dinner with Ma on Thursday');
    expect(c.tmpl.key).toBe('dinner-out');
    const gate = c.gates.find(x => x.kind === 'footprint');
    expect(gate).toBeTruthy();
    expect(gate.tmpl).toBe('dinner-out');
    expect(gate.q).toMatch(/add the usual footprint/i);
  });

  it('the gate reaches the goal without anything being applied to the step', () => {
    const c = p.classify('gym tuesday morning');
    const g = p.buildGoalFrom('gym tuesday morning', c);
    expect(g.gates.some(x => x.kind === 'footprint')).toBe(true);
    expect(g.threads[0].steps[0].footprint).toBe(null);   // not applied — only offered
  });

  it('says nothing about templates for a phrase that matches none', () => {
    const c = p.classify('reconcile the quarterly numbers');
    expect(c.tmpl).toBe(null);
    expect(c.gates.some(x => x.kind === 'footprint')).toBe(false);
  });

  it('a literal $NN becomes a cost line with no template involved', () => {
    const c = p.classify('replace the laptop charger $40');
    const g = p.buildGoalFrom('replace the laptop charger $40', c);
    const f = p.fp(g.threads[0].steps[0]);
    expect(f.costs.length).toBe(1);
    expect(f.costs[0].amount).toBe(40);
    expect(f.costs[0].catId).toBe(null);
  });

  it("a threshold goal's number stays its target and never becomes spending", () => {
    const c = p.classify('save $5,000 for the move');
    expect(c.type).toBe('threshold');
    const g = p.buildGoalFrom('save $5,000 for the move', c);
    expect(g.smart.target).toBe(5000);
    expect(p.fp(g.threads[0].steps[0]).costs.length).toBe(0);
  });

  it('a template match breaks the tie on a phrase the rules read as threshold only because of the $', () => {
    const c = p.classify('dinner with Ma $60 Thursday');
    const g = p.buildGoalFrom('dinner with Ma $60 Thursday', c);
    expect(p.fp(g.threads[0].steps[0]).costs[0].amount).toBe(60);
    expect(g.smart.target).toBe(null);          // not a savings target
  });
});

d('capacity counts the whole footprint [' + TARGET + ']', () => {
  it('loadOn() adds lead and lag to the slot', () => {
    const {step} = anchored(p, {dur: 60});
    expect(p.CAL.loadOn(T())).toBe(60);
    p.ensureFootprint(step).lead = 20;
    p.fp(step).lag = 35;
    expect(p.CAL.loadOn(T())).toBe(115);
  });

  it('sums overlapping shadows rather than merging them — the same way it sums slots', () => {
    const a = anchored(p, {start: 9*60, dur: 60});
    const b = anchored(p, {start: 10*60, dur: 60});
    p.ensureFootprint(a.step).lag = 30;      // runs into b's lead
    p.ensureFootprint(b.step).lead = 30;
    expect(p.CAL.loadOn(T())).toBe(180);
  });

  it('an all-day item is still exempt, footprint or not', () => {
    const {step, ev} = anchored(p);
    ev.allDay = true; ev.dur = 1440;
    p.ensureFootprint(step).lead = 60;
    expect(p.CAL.loadOn(T())).toBe(0);
  });

  it('loadWeek() carries the footprints too', () => {
    const {step} = anchored(p, {dateKey: p.addDays(WS(), 2), dur: 60});
    p.ensureFootprint(step).lead = 15;
    p.fp(step).lag = 15;
    expect(p.CAL.loadWeek(WS())).toBe(90);
  });

  it('suggestDay() places on the full width, not the visible slot', () => {
    const day = p.addDays(T(), 3);          // where a milestone's cadence starts looking
    p.DB.meta.dayBudgetMins = 120;
    const sitting = anchored(p, {dateKey: day, dur: 60});   // 60 of 120 used
    const m = makeGoal(p, {type: 'milestone'});
    p.ensureFootprint(m.step).lead = 30;
    p.fp(m.step).lag = 30;
    // 60 + (30+45+30) would be 165 against a 120-minute day, so it must not pick `day`
    expect(p.suggestDay({goal: m.goal, step: m.step, quadrant: 'q2'}, 45)).not.toBe(day);
    // the same step without its footprint fits, and does pick it
    m.step.footprint = null;
    expect(p.suggestDay({goal: m.goal, step: m.step, quadrant: 'q2'}, 45)).toBe(day);
  });

  it("a template's default duration sizes a new slot, and only a new one", () => {
    const m = makeGoal(p);
    p.applyTemplate(m.step, 'deep-work');
    const ev = p.CAL.anchor(m.goal, m.thread, m.step, T(), 9*60);
    expect(ev.dur).toBe(p.tmplGet('deep-work').dur);
    const again = p.CAL.anchor(m.goal, m.thread, m.step, T(), 14*60, 30);
    expect(again.dur).toBe(30);        // an explicit duration always wins
  });
});

d('prerequisites raise signals, and are fixed where you find them [' + TARGET + ']', () => {
  const pq = () => p.signals().filter(s => s.kind === 'prereq');

  function withPrereq({inDays = 2, leadDays = 1} = {}){
    const a = anchored(p, {dateKey: p.addDays(T(), inDays)});
    const f = p.ensureFootprint(a.step);
    f.prereqs.push(p.normPrereq({title: 'Reservation made', leadDays}));
    p.save();
    return a;
  }

  it('says nothing outside the window', () => {
    withPrereq({inDays: 5, leadDays: 1});
    expect(pq().length).toBe(0);
  });

  it('warns once inside the window', () => {
    withPrereq({inDays: 2, leadDays: 3});
    const s = pq();
    expect(s.length).toBe(1);
    expect(s[0].sev).toBe('warn');
    expect(s[0].text).toMatch(/Reservation made/);
  });

  it('goes hard once the slot itself has arrived', () => {
    withPrereq({inDays: 0, leadDays: 1});
    expect(pq()[0].sev).toBe('hard');
  });

  it('says nothing at all for an unanchored step — that is the unscheduled signal', () => {
    const m = makeGoal(p);
    p.ensureFootprint(m.step).prereqs.push(p.normPrereq({title: 'Book it', leadDays: 30}));
    p.save();
    expect(pq().length).toBe(0);
    expect(p.signals().some(s => s.kind === 'unscheduled')).toBe(true);
  });

  it('ticking it clears the signal, and unticking brings it back', () => {
    const a = withPrereq({inDays: 1, leadDays: 2});
    const id = p.fp(a.step).prereqs[0].id;
    p.togglePrereq(a.step.id, id);
    expect(p.fp(a.step).prereqs[0].done).toBe(true);
    expect(p.fp(a.step).prereqs[0].doneAt).toBeTruthy();
    expect(pq().length).toBe(0);
    p.togglePrereq(a.step.id, id);
    expect(pq().length).toBe(1);
  });

  it('each unmet prereq is its own chip, so snoozing one does not mute the others', () => {
    const a = withPrereq({inDays: 1, leadDays: 2});
    p.fp(a.step).prereqs.push(p.normPrereq({title: 'Bag packed', leadDays: 2}));
    p.save();
    const keys = new Set(pq().map(s => s.key));
    expect(keys.size).toBe(2);
  });

  it('is fixable inline, through the same engine call the check-in uses', () => {
    const a = withPrereq({inDays: 1, leadDays: 2});
    expect(p.FIXABLE.has('prereq')).toBe(true);
    const sig = pq()[0];
    expect(p.sigResolverHTML(sig)).toMatch(/data-fix="prereq-done"/);
  });

  it('never reaches the matrix or the calendar — a prereq is not a subtask', () => {
    const a = withPrereq({inDays: 1, leadDays: 2});
    expect(p.DB.events.length).toBe(1);                       // the step's slot, and nothing else
    expect(p.activeItems().filter(i => i.step.id === a.step.id).length).toBe(1);
    expect(p.subs(a.step).length).toBe(0);
  });

  it('rides forward onto the successor reset, because it is true of the old date only', () => {
    const m = makeGoal(p, {type: 'habit'});
    const f = p.ensureFootprint(m.step);
    f.lead = 20; f.lag = 35; f.tmpl = 'gym';
    f.prereqs.push(p.normPrereq({title: 'Kit packed', leadDays: 1, done: true}));
    f.costs.push(p.normCost({label: 'Class', amount: 12}));
    const r = p.completeStep(m.goal, m.thread, m.step);
    const next = p.fp(r.next);
    expect(next.lead).toBe(20);
    expect(next.lag).toBe(35);
    expect(next.tmpl).toBe('gym');
    expect(next.costs[0].amount).toBe(12);
    expect(next.prereqs[0].title).toBe('Kit packed');
    expect(next.prereqs[0].done).toBe(false);                 // reset, not carried as done
    expect(next.prereqs[0].id).not.toBe(f.prereqs[0].id);
  });
});

d('committed spend against what was allocated [' + TARGET + ']', () => {
  const cats = () => (p.DB.meta.budget.cats = [
    {id:'c-food', name:'Food', amount:100, goalId:null},
    {id:'c-tx',   name:'Transport', amount:50, goalId:null}
  ]);

  it("sums a step's cost lines into the week it is scheduled in", () => {
    cats();
    const a = anchored(p, {dateKey: p.addDays(WS(), 3)});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Meal', amount:60, catId:'c-food'}));
    const c = p.committedWeek(WS());
    expect(c.total).toBe(60);
    expect(c.byCat['c-food']).toBe(60);
  });

  it('ignores a step scheduled into a different week', () => {
    cats();
    const a = anchored(p, {dateKey: p.addDays(WS(), 9)});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Meal', amount:60, catId:'c-food'}));
    expect(p.committedWeek(WS()).total).toBe(0);
  });

  it("counts a manual event's own costs, with no step behind them", () => {
    cats();
    const ev = p.addEvent(p.newEvent({title:'Parking', dateKey: WS(), start:9*60, dur:30,
      costs:[p.normCost({label:'Parking', amount:15, catId:'c-tx'})]}));
    expect(p.committedWeek(WS()).byCat['c-tx']).toBe(15);
  });

  it('expands a repeating event per occurrence — a standing commitment costs every week it recurs', () => {
    cats();
    p.addEvent(p.newEvent({title:'Coffee run', dateKey: WS(), start:8*60, dur:15,
      recur:{every:1, until:p.addDays(WS(), 30)},
      costs:[p.normCost({label:'Coffee', amount:5, catId:'c-food'})]}));
    expect(p.committedWeek(WS()).total).toBe(35);              // five a day would be 5 x 7
    expect(p.committedWeek(p.addDays(WS(), 7)).total).toBe(35); // and again next week
  });

  it('a skipped occurrence costs nothing', () => {
    cats();
    const ev = p.addEvent(p.newEvent({title:'Coffee run', dateKey: WS(), start:8*60, dur:15,
      recur:{every:1, until:p.addDays(WS(), 30)}, skips:[p.addDays(WS(), 2)],
      costs:[p.normCost({label:'Coffee', amount:5, catId:'c-food'})]}));
    expect(p.committedWeek(WS()).total).toBe(30);
  });

  it('keeps uncategorised money in the week total rather than in someone else’s category', () => {
    cats();
    const a = anchored(p, {dateKey: WS()});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Tip', amount:9}));
    const c = p.committedWeek(WS());
    expect(c.total).toBe(9);
    expect(c.uncat).toBe(9);
    expect(Object.keys(c.byCat).length).toBe(0);
  });

  it('budgetState() reports committed beside allocated, and the bar scales to whichever is larger', () => {
    cats();
    p.DB.meta.budget.weekly = 150;
    const a = anchored(p, {dateKey: WS()});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Splurge', amount:400, catId:'c-food'}));
    const B = p.budgetState();
    expect(B.allocated).toBe(150);
    expect(B.committed).toBe(400);
    expect(B.basis).toBe(400);
    expect(B.overCom).toBe(true);
    expect(p.budgetBarHTML()).toMatch(/<u style="left:/);      // the budget line still crosses it
  });

  it("draws committed as a solid part of the category's own block", () => {
    cats();
    const a = anchored(p, {dateKey: WS()});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Meal', amount:50, catId:'c-food'}));
    const html = p.budgetBarHTML();
    expect(html).toMatch(/data-com="50"/);
    expect(html).toMatch(/linear-gradient\(90deg,#[0-9a-f]+ 0 50%/i);   // 50 of the 100 allocated
  });
});

d('the over-budget signal, and its two rungs [' + TARGET + ']', () => {
  const ob = () => p.signals().filter(s => s.kind === 'overbudget');
  function commit(amount){
    const a = anchored(p, {dateKey: WS()});
    p.ensureFootprint(a.step).costs.push(p.normCost({label:'Spend', amount, catId:'c1'}));
    p.save();
  }
  beforeEach(() => {
    p.DB.meta.budget = {weekly: 200, cats: [{id:'c1', name:'Food', amount:100, goalId:null}]};
  });

  it('says nothing while committed sits inside the allocation', () => {
    commit(80);
    expect(ob().length).toBe(0);
  });

  it('warns once committed passes what was allocated', () => {
    commit(140);
    expect(ob()[0].sev).toBe('warn');
    expect(ob()[0].text).toMatch(/\$140 committed against \$100 allocated/);
  });

  it('goes hard once committed passes the weekly budget itself', () => {
    commit(260);
    expect(ob()[0].sev).toBe('hard');
  });

  it('never nags when no budget has been set up', () => {
    p.DB.meta.budget = {weekly: 0, cats: []};
    commit(500);
    expect(ob().length).toBe(0);
  });

  it('is a signal, not a scheduling constraint — suggestDay() still offers the expensive week', () => {
    commit(260);
    const day = p.addDays(T(), 3);
    const m = makeGoal(p);
    expect(p.suggestDay({goal: m.goal, step: m.step, quadrant: 'q2'}, 45)).toBe(day);
  });

  it('is deliberately not fixable — nothing here can decide the dinners were worth it', () => {
    expect(p.FIXABLE.has('overbudget')).toBe(false);
  });

  it('carries no goal, and the ribbon labels it anyway', () => {
    commit(140);
    const s = ob()[0];
    expect(s.goal).toBe(null);
    expect(p.sigLabel(s)).toBe('This week');
    expect(s.key).toBe('overbudget:' + WS());
  });
});

d('catProjection() nets committed spend out of the allocation [' + TARGET + ']', () => {
  function fund({amount = 150, target = 2100, committed = 0} = {}){
    const g = p.newGoal({title:'Emergency fund', type:'threshold'});
    g.smart = {outcome:'', metricName:'', metricUnit:'$', target, current:0, deadline:null, deadlineSoft:false};
    g.threads.push(p.newThread({rel:'cyclical'}));
    g.threads[0].steps.push(p.newStep('This period’s contribution'));
    p.DB.goals.push(g);
    const cat = {id:'c-save', name:'Saving', amount, goalId:g.id};
    p.DB.meta.budget = {weekly: 400, cats:[cat]};
    if(committed){
      const a = anchored(p, {dateKey: WS()});
      p.ensureFootprint(a.step).costs.push(p.normCost({label:'Dipped in', amount:committed, catId:'c-save'}));
    }
    p.save();
    return {goal:g, cat};
  }

  it('projects on the allocation when nothing is committed against it', () => {
    const {cat} = fund();
    const pr = p.catProjection(cat);
    expect(pr.committed).toBe(0);
    expect(pr.effective).toBe(150);
    expect(pr.weeks).toBe(14);
  });

  it('projects on what is left once this week’s commitments are taken out', () => {
    const {cat} = fund({committed: 45});
    const pr = p.catProjection(cat);
    expect(pr.committed).toBe(45);
    expect(pr.effective).toBe(105);
    expect(pr.weeks).toBe(20);
  });

  it('says nothing is reaching the goal rather than dividing by zero', () => {
    const {cat} = fund({committed: 150});
    const pr = p.catProjection(cat);
    expect(pr.stalled).toBe(true);
    expect(pr.weeks).toBe(undefined);
    expect(p.viewBudget()).toMatch(/nothing is reaching the goal this week/);
  });

  it('the row says all three numbers rather than quietly presenting the result', () => {
    fund({committed: 45});
    expect(p.viewBudget()).toMatch(/\$150\/wk allocated, \$45 committed, \$105 reaching the goal/);
  });

  it("never reads a non-threshold goal's units as money", () => {
    const g = p.newGoal({title:'Read 24 books', type:'milestone'});
    g.smart = {outcome:'', metricName:'books', metricUnit:'books', target:24, current:0, deadline:null, deadlineSoft:false};
    p.DB.goals.push(g);
    expect(p.catProjection({id:'c-x', name:'Books', amount:20, goalId:g.id})).toBe(null);
  });
});

d('the optional actual-duration capture [' + TARGET + ']', () => {
  function timedRun(mins){
    const m = makeGoal(p, {type:'habit'});
    p.applyTemplate(m.step, 'gym');
    p.startActual(m.step);
    m.step.actual.startedAt = new Date(Date.now() - mins*60000).toISOString();
    p.stopActual(m.step);
    p.completeStep(m.goal, m.thread, m.step);
    return m;
  }

  it('records nothing unless the user taps start', () => {
    const m = makeGoal(p, {type:'habit'});
    p.applyTemplate(m.step, 'gym');
    p.completeStep(m.goal, m.thread, m.step);
    expect(p.DB.meta.footprint.samples.gym).toBe(undefined);
    expect(p.tmplGates().length).toBe(0);
  });

  it('skipping it never blocks completion, and leaves the estimate untouched', () => {
    const before = p.tmplGet('gym').dur;
    const m = makeGoal(p, {type:'habit'});
    p.applyTemplate(m.step, 'gym');
    const r = p.completeStep(m.goal, m.thread, m.step);
    expect(m.step.done).toBe(true);
    expect(r.next).toBeTruthy();
    expect(p.tmplGet('gym').dur).toBe(before);
  });

  it('start/stop measures the run in minutes', () => {
    const m = makeGoal(p);
    p.startActual(m.step);
    expect(p.timing(m.step)).toBe(true);
    m.step.actual.startedAt = new Date(Date.now() - 90*60000).toISOString();
    p.stopActual(m.step);
    expect(p.timing(m.step)).toBe(false);
    expect(p.actualMins(m.step)).toBe(90);
  });

  it('a step with no template contributes no sample — a correction needs something to correct', () => {
    const m = makeGoal(p);
    p.startActual(m.step);
    m.step.actual.startedAt = new Date(Date.now() - 50*60000).toISOString();
    p.stopActual(m.step);
    p.completeStep(m.goal, m.thread, m.step);
    expect(Object.keys(p.DB.meta.footprint.samples).length).toBe(0);
  });

  it('stays quiet until there are enough timed completions', () => {
    for(let i=0;i<4;i++) timedRun(100);
    expect(p.DB.meta.footprint.samples.gym.length).toBe(4);
    expect(p.tmplGates().length).toBe(0);
    timedRun(100);
    expect(p.tmplGates().length).toBe(1);
  });

  it('never proposes a change the evidence does not justify', () => {
    const dur = p.tmplGet('gym').dur;        // 60
    for(let i=0;i<6;i++) timedRun(dur + 3);  // three minutes is noise
    expect(p.tmplGates().length).toBe(0);
  });

  it('proposes the median, naming its evidence and keeping the shape generic', () => {
    for(let i=0;i<5;i++) timedRun(100);
    const gate = p.tmplGates()[0];
    expect(gate.kind).toBe('templateCorrection');
    expect(gate.tmpl).toBe('gym');
    expect(gate.proposes).toEqual([{field:'dur', from:60, to:100}]);
    expect(gate.because).toMatchObject({kind:'duration', n:5, stat:'median', value:100});
    expect(gate.q).toMatch(/Update the template/);
  });

  it('is queued, not interruptive: it sits at the bottom of the ribbon', () => {
    for(let i=0;i<5;i++) timedRun(100);
    const s = p.signals().find(x => x.kind === 'tmpl');
    expect(s.sev).toBe('mute');
    expect(s.goal).toBe(null);
    expect(p.FIXABLE.has('tmpl')).toBe(true);
  });

  it('one open proposal per template — more evidence sharpens it rather than stacking chips', () => {
    for(let i=0;i<5;i++) timedRun(100);
    timedRun(100);
    expect(p.tmplGates().length).toBe(1);
  });

  it('accepting writes every field proposed and spends the evidence', () => {
    for(let i=0;i<5;i++) timedRun(100);
    const id = p.tmplGates()[0].id;
    p.acceptTmplGate(id);
    expect(p.tmplGet('gym').dur).toBe(100);
    expect(p.DB.meta.footprint.overrides.gym).toEqual({dur:100});
    expect(p.tmplGates().length).toBe(0);
    expect(p.DB.meta.footprint.samples.gym).toBe(undefined);
  });

  it('declining changes nothing, and does not re-ask from the same evidence', () => {
    for(let i=0;i<5;i++) timedRun(100);
    p.declineTmplGate(p.tmplGates()[0].id);
    expect(p.tmplGet('gym').dur).toBe(60);
    expect(p.tmplGates().length).toBe(0);
    timedRun(100);
    expect(p.tmplGates().length).toBe(0);      // one sample is not five
  });

  it('accepting a proposal is undoable like any other write', () => {
    for(let i=0;i<5;i++) timedRun(100);
    p.save();
    p.checkpoint('that template change');
    p.acceptTmplGate(p.tmplGates()[0].id);
    p.save();
    p.undo();
    expect(p.tmplGet('gym').dur).toBe(60);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

describe('no thread starts dead [' + TARGET + ']', () => {
  const firstStep = (type, extra = {}) => {
    const c = p.classify('x');
    const g = p.newGoal({ title: 'Ship the thing', type, ...extra });
    const t = p.newThread();
    return p.firstStepFor(g, t, c);
  };

  it('every non-dormant type is created with a live next step', () => {
    for (const type of Object.keys(p.TYPE)){
      if (type === 'contingent') continue;
      const c = p.classify('ship the thing');
      c.type = type;
      const g = p.buildGoalFrom('Ship the thing', { ...c, type, gates: [] });
      expect(p.currentStep(g.threads[0]), type).toBeTruthy();
    }
  });

  it('deadline-type maps the steps back from the date', () => {
    const g = p.newGoal({ title: 'Pass the exam', type: 'deadline' });
    g.smart.deadline = p.addDays(p.today(), 30);
    expect(p.firstStepFor(g, p.newThread(), null).title)
      .toBe('Map the steps back from ' + p.fmtDate(g.smart.deadline));
  });

  it('milestone-type pulls the backlog head, or asks for a backlog', () => {
    const g = p.newGoal({ title: 'Ship Plumbline', type: 'milestone', backlog: ['Wire CI'] });
    expect(p.firstStepFor(g, p.newThread(), null).title).toBe('Wire CI');
    expect(g.backlog).toEqual([]);
    expect(p.firstStepFor(g, p.newThread(), null).title).toBe('Break Ship Plumbline into a backlog');
  });

  it('habit, maintenance and threshold get their cyclical step', () => {
    expect(firstStep('habit').title).toBe('Next session: Ship the thing');
    expect(firstStep('maintenance').title).toBe('Next Ship the thing');
    expect(firstStep('threshold').title).toContain('contribution');
  });

  it('contingent is the one exception and stays dormant', () => {
    const c = p.classify('if the house comes through start the fund');
    const g = p.buildGoalFrom('if the house comes through start the fund', c);
    expect(g.threads[0].status).toBe('dormant');
    expect(g.threads[0].steps).toEqual([]);
  });

  it('shortName strips the leading verb and the cadence tail', () => {
    expect(p.shortName(p.newGoal({ title: 'Practice guitar every day' }))).toBe('guitar');
    expect(p.shortName(p.newGoal({ title: 'Save up for a car' }))).toBe('a car');
    expect(p.shortName(p.newGoal({ title: 'Ship it' }))).toBe('Ship it');
  });

  it('cadence falls back to the type default until overridden', () => {
    const g = p.newGoal({ type: 'habit' });
    expect(p.cadenceOf(g)).toBe(p.TYPE.habit.cadence);
    g.cadenceDays = 2;
    expect(p.cadenceOf(g)).toBe(2);
    g.cadenceDays = 0;
    expect(p.cadenceOf(g)).toBe(0);
  });
});

describe('completing a step produces the next one [' + TARGET + ']', () => {
  it('habit / maintenance / threshold regenerate their own successor', () => {
    for (const [type, match] of [['habit', /Next session/], ['maintenance', /^Next /], ['threshold', /contribution/]]){
      const { goal, thread, step } = makeGoal(p, { type, title: 'Practice guitar', rel: 'cyclical' });
      const r = p.completeStep(goal, thread, step);
      expect(r.needsDefine, type).toBe(false);
      expect(r.next.title, type).toMatch(match);
      expect(step.done).toBe(true);
      expect(step.doneAt).toBeTruthy();
    }
  });

  it('milestone pulls the next backlog item, then asks for a definition', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'milestone', goal: { backlog: ['Write the runbook'] } });
    const r = p.completeStep(goal, thread, step);
    expect(r.next.title).toBe('Write the runbook');
    expect(goal.backlog).toEqual([]);
    const r2 = p.completeStep(goal, thread, r.next);
    expect(r2.needsDefine).toBe(true);
    expect(r2.reason).toBe('define');
  });

  it('deadline chains always need a deliberate next step', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'deadline' });
    const r = p.completeStep(goal, thread, step);
    expect(r.needsDefine).toBe(true);
    expect(p.currentStep(thread)).toBe(null);
  });

  it('a task closes its goal outright', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'task' });
    const r = p.completeStep(goal, thread, step);
    expect(r.next).toBe(null);
    expect(goal.status).toBe('done');
    expect(goal.doneAt).toBeTruthy();
  });

  it('a decision closes its thread and queues the resolve question', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'decision' });
    p.completeStep(goal, thread, step);
    expect(thread.status).toBe('done');
    expect(goal.gates.map(x => x.kind)).toContain('resolve-decision');
  });

  it('a pipeline entry advances a stage, then falls back to the weekly batch', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'pipeline', rel: 'parallel',
      goal: { stages: p.PIPELINE_STAGES.slice() }, thread: { name: 'Northwind', stage: 'screen' } });
    const r = p.completeStep(goal, thread, step);
    expect(thread.stage).toBe('interview');
    expect(r.next.title).toBe('Advance to interview: Northwind');

    thread.stage = 'offer';
    expect(p.completeStep(goal, thread, r.next).next.title).toBe('Send this week’s batch');
  });

  it('a conditional thread refuses to guess which way it went', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'milestone', rel: 'conditional',
      thread: { branches: [{ condition: 'pass', next: 'File the cert' }, { condition: 'fail', next: 'Reset the method' }] } });
    const r = p.completeStep(goal, thread, step);
    expect(r.needsDefine).toBe(true);
    expect(r.reason).toBe('branch');
    expect(thread.needsBranch).toBe(true);

    const answered = p.completeStep(goal, thread, step, { branch: thread.branches[0] });
    expect(answered.next.title).toBe('File the cert');
    expect(thread.needsBranch).toBe(false);
  });

  it('completing logs done, touches the thread and marks the slot done', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    const ev = p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    thread.lastMovement = new Date(Date.now() - 6e8).toISOString();
    p.completeStep(goal, thread, step);
    expect(p.DB.log.some(l => l.kind === 'done' && l.stepId === step.id)).toBe(true);
    expect(p.daysQuiet(thread)).toBe(0);
    expect(ev.done).toBe(true);
  });

  it('the successor inherits the quadrant', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical', stepOpts: { quadrant: 'q1' } });
    expect(p.completeStep(goal, thread, step).next.quadrant).toBe('q1');
  });
});

describe('cyclical goals re-book themselves [' + TARGET + ']', () => {
  it('an anchored habit lands back in the same slot one cadence later', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    goal.cadenceDays = 3;
    p.CAL.anchor(goal, thread, step, p.today(), 19 * 60, 90);
    const r = p.completeStep(goal, thread, step);
    const ev = p.eventById(r.next.eventId);
    expect(ev.dateKey).toBe(p.addDays(p.today(), 3));
    expect(ev.start).toBe(19 * 60);
    expect(ev.dur).toBe(90);
    expect(r.next.autoScheduled).toBe(true);
  });

  it('a re-book never lands in the past', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    goal.cadenceDays = 3;
    p.CAL.anchor(goal, thread, step, p.addDays(p.today(), -20), 19 * 60, 45);
    const r = p.completeStep(goal, thread, step);
    expect(p.eventById(r.next.eventId).dateKey).toBe(p.addDays(p.today(), 3));
  });

  it('an all-day anchor re-books as all-day', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    const ev = p.CAL.anchor(goal, thread, step, p.today(), 0, 1440);
    ev.allDay = true;
    const r = p.completeStep(goal, thread, step);
    expect(p.eventById(r.next.eventId).allDay).toBe(true);
  });

  it('an unanchored cyclical step produces a successor with no slot', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    const r = p.completeStep(goal, thread, step);
    expect(r.next.eventId).toBe(null);
    expect(p.DB.events.length).toBe(0);
  });

  it('five completions book exactly five follow-ups and no more', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    goal.cadenceDays = 1;
    p.CAL.anchor(goal, thread, step, p.today(), 19 * 60, 45);
    let cur = step;
    for (let i = 0; i < 5; i++) cur = p.completeStep(goal, thread, cur).next;
    expect(p.DB.events.length).toBe(6);
    expect(p.DB.log.filter(l => l.kind === 'done').length).toBe(5);
    expect(thread.steps.filter(s => !s.done).length).toBe(1);
  });

  it('a non-cyclical type never re-books itself', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'milestone', goal: { backlog: ['Next thing'] } });
    p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    expect(p.completeStep(goal, thread, step).next.eventId).toBe(null);
  });
});

describe('finishing keeps it [' + TARGET + ']', () => {
  it('finishGoal stamps doneAt, closes the threads and logs why', () => {
    const { goal } = makeGoal(p);
    p.finishGoal(goal, 'shipped it');
    expect(goal.status).toBe('done');
    expect(goal.doneAt).toBeTruthy();
    expect(goal.threads.every(t => t.status === 'done')).toBe(true);
    expect(p.DB.log.some(l => l.kind === 'closed' && l.text === 'shipped it')).toBe(true);
  });

  it('a finished goal leaves the live views but is kept in the archive', () => {
    const { goal } = makeGoal(p);
    p.finishGoal(goal);
    expect(p.liveGoals()).toEqual([]);
    expect(p.doneGoals().map(g => g.id)).toEqual([goal.id]);
    expect(p.activeItems()).toEqual([]);
  });

  it('the archive is newest-first', () => {
    const a = makeGoal(p, { title: 'first' }).goal;
    const b = makeGoal(p, { title: 'second' }).goal;
    p.finishGoal(a); a.doneAt = '2026-01-01T00:00:00.000Z';
    p.finishGoal(b); b.doneAt = '2026-06-01T00:00:00.000Z';
    expect(p.doneGoals().map(g => g.title)).toEqual(['second', 'first']);
  });

  it('reopening does not bring a goal back dead', () => {
    const { goal, thread } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    p.finishGoal(goal);
    thread.steps.forEach(s => { s.done = true; });
    p.reopenGoal(goal);
    expect(goal.status).toBe('active');
    expect(goal.doneAt).toBe(null);
    expect(p.currentStep(goal.threads[0])).toBeTruthy();
    expect(p.DB.log.some(l => l.kind === 'reopened')).toBe(true);
  });

  it('reopen asks the type for a first step before falling back', () => {
    const { goal, thread } = makeGoal(p, { type: 'deadline' });
    thread.steps.forEach(s => { s.done = true; });
    p.finishGoal(goal);
    p.reopenGoal(goal);
    expect(p.currentStep(goal.threads[0]).title).toBe('Map the steps back from the deadline');
  });

  it('a type with no first step of its own falls back to a generic next move', () => {
    const { goal, thread } = makeGoal(p, { type: 'milestone' });
    goal.type = 'contingent';           // firstStepFor() returns null for this one
    thread.steps.forEach(s => { s.done = true; });
    p.finishGoal(goal);
    p.reopenGoal(goal);
    expect(p.currentStep(goal.threads[0]).title).toContain('Next move on');
  });

  it('deleting a goal takes its calendar slots with it', () => {
    const { goal, thread, step } = makeGoal(p);
    p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    const other = makeGoal(p, { title: 'survivor' });
    p.CAL.anchor(other.goal, other.thread, other.step, p.today(), 11 * 60, 45);
    p.deleteGoal(goal.id);
    expect(p.DB.goals.length).toBe(1);
    expect(p.DB.events.length).toBe(1);
    expect(p.DB.events[0].goalId).toBe(other.goal.id);
  });
});

describe('the item stream [' + TARGET + ']', () => {
  it('carries exactly one live step per active thread', () => {
    const { goal, thread } = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    thread.steps.push(p.newStep('a second, which should not surface'));
    expect(p.activeItems().length).toBe(1);
    expect(p.activeItems()[0].step.id).toBe(thread.steps[0].id);
    expect(p.currentStep(thread).id).toBe(thread.steps[0].id);
  });

  it('skips dormant, done and finished threads', () => {
    makeGoal(p, { title: 'dormant', thread: { status: 'dormant' } });
    makeGoal(p, { title: 'closed thread', thread: { status: 'done' } });
    const { goal } = makeGoal(p, { title: 'finished goal' });
    p.finishGoal(goal);
    makeGoal(p, { title: 'live one' });
    expect(p.activeItems().map(i => i.goal.title)).toEqual(['live one']);
  });

  it('a blocked thread stays in the stream, flagged', () => {
    makeGoal(p, { thread: { status: 'blocked', blockedOn: 'Marcus' } });
    const [i] = p.activeItems();
    expect(i.blocked).toBe(true);
    expect(p.unscheduledItems()).toEqual([]);
  });

  it('itemsOn, unscheduledItems and overdueItems partition by slot', () => {
    const a = makeGoal(p, { title: 'today' });
    p.CAL.anchor(a.goal, a.thread, a.step, p.today(), 9 * 60, 45);
    const b = makeGoal(p, { title: 'overdue' });
    p.CAL.anchor(b.goal, b.thread, b.step, p.addDays(p.today(), -2), 9 * 60, 45);
    makeGoal(p, { title: 'loose' });
    expect(p.itemsOn(p.today()).map(i => i.goal.title)).toEqual(['today']);
    expect(p.overdueItems().map(i => i.goal.title)).toEqual(['overdue']);
    expect(p.unscheduledItems().map(i => i.goal.title)).toEqual(['loose']);
  });

  it('lastDoneStep returns the most recently closed one', () => {
    const { thread } = makeGoal(p);
    thread.steps.unshift(p.newStep('older', { done: true }), p.newStep('newer', { done: true }));
    expect(p.lastDoneStep(thread).title).toBe('newer');
  });

  it('findStep and findThread reach anything by id', () => {
    const { goal, thread, step } = makeGoal(p);
    expect(p.findStep(step.id).goal.id).toBe(goal.id);
    expect(p.findThread(thread.id).goal.id).toBe(goal.id);
    expect(p.findStep('nope')).toBe(null);
    expect(p.findThread('nope')).toBe(null);
    expect(p.threadById(goal.id, thread.id).id).toBe(thread.id);
  });

  it('the log is capped at 4000 entries', () => {
    for (let i = 0; i < 4100; i++) p.logIt('done', { text: 'x' + i });
    expect(p.DB.log.length).toBe(4000);
    expect(p.DB.log[p.DB.log.length - 1].text).toBe('x4099');
  });
});

describe('follow-through [' + TARGET + ']', () => {
  it('counts planned against done inside the window', () => {
    const { goal, thread } = makeGoal(p);
    const at = d => ({ goalId: goal.id, threadId: thread.id, dateKey: p.addDays(p.today(), -d) });
    p.logIt('planned', at(3)); p.logIt('done', at(2));
    p.logIt('planned', at(1));
    p.logIt('planned', at(40));
    const ft = p.followThrough(goal.id, 28);
    expect(ft).toMatchObject({ planned: 2, done: 1, rate: 50 });
  });

  it('done with nothing planned reads as 100, and an empty window as 0', () => {
    const { goal } = makeGoal(p);
    expect(p.followThrough(goal.id).rate).toBe(0);
    p.logIt('done', { goalId: goal.id, dateKey: p.today() });
    expect(p.followThrough(goal.id).rate).toBe(100);
  });

  it('a streak counts back from today, tolerating nothing yet today', () => {
    const { goal } = makeGoal(p);
    for (const d of [1, 2, 3]) p.logIt('done', { goalId: goal.id, dateKey: p.addDays(p.today(), -d) });
    expect(p.streak(goal.id)).toBe(3);
    p.logIt('done', { goalId: goal.id, dateKey: p.today() });
    expect(p.streak(goal.id)).toBe(4);
  });

  it('a gap ends the streak', () => {
    const { goal } = makeGoal(p);
    for (const d of [1, 2, 5]) p.logIt('done', { goalId: goal.id, dateKey: p.addDays(p.today(), -d) });
    expect(p.streak(goal.id)).toBe(2);
  });
});

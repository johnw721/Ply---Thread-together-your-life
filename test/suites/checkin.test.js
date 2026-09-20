import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; h.forbidNatives(); });

const quietFor = (t, d) => { t.lastMovement = new Date(Date.now() - d * 864e5).toISOString(); };
const card = () => p.CK.q[p.CK.i];

describe('the agenda [' + TARGET + ']', () => {
  it('sorts each thread into exactly one bucket', () => {
    makeGoal(p, { title: 'stepless', step: null });
    makeGoal(p, { title: 'blocked', thread: { status: 'blocked', blockedOn: 'Marcus' } });
    const br = makeGoal(p, { title: 'branchy', rel: 'conditional' }); br.thread.needsBranch = true;
    const q  = makeGoal(p, { title: 'quiet' }); quietFor(q.thread, 10);
    const gt = makeGoal(p, { title: 'gated' }); gt.goal.gates.push({ id: 'g1', kind: 'deadline', q: '?' });

    const ag = p.checkinAgenda();
    expect(ag.nostep.map(x => x.goal.title)).toEqual(['stepless']);
    expect(ag.blocked.map(x => x.goal.title)).toEqual(['blocked']);
    expect(ag.branch.map(x => x.goal.title)).toEqual(['branchy']);
    expect(ag.quiet.map(x => x.goal.title)).toContain('quiet');
    expect(ag.gates.map(x => x.goal.title)).toEqual(['gated']);
    expect(ag.unsched.length).toBeGreaterThan(0);
  });

  it('excludes dormant threads and plain tasks by design', () => {
    makeGoal(p, { title: 'dormant', thread: { status: 'dormant' } });
    makeGoal(p, { title: 'a task', type: 'task' });
    const ag = p.checkinAgenda();
    expect([...ag.quiet, ...ag.nostep, ...ag.unsched].length).toBe(0);
  });

  it('a hushed thread drops off the agenda and into its own bucket', () => {
    const g = makeGoal(p, { title: 'gone quiet', type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 3; quietFor(g.thread, 40);
    const ag = p.checkinAgenda();
    expect(ag.quiet).toEqual([]);
    expect(ag.hush.map(x => x.goal.title)).toEqual(['gone quiet']);
  });

  it('a thread that moved since the last check-in is not called quiet', () => {
    const g = makeGoal(p, { title: 'moved' });
    quietFor(g.thread, 10);
    p.DB.meta.lastCheckin = p.addDays(p.today(), -7);
    p.logIt('done', { threadId: g.thread.id, dateKey: p.addDays(p.today(), -2) });
    expect(p.checkinAgenda().quiet).toEqual([]);
  });
});

describe('cadence [' + TARGET + ']', () => {
  it('is due when it has never run', () => {
    p.DB.meta.lastCheckin = null;
    expect(p.checkinDue()).toBe(true);
  });

  it('fixed-weekday mode is due once the named day has come round', () => {
    p.DB.meta.checkinMode = 'day';
    p.DB.meta.checkinDow = p.parseKey(p.today()).getDay();
    p.DB.meta.lastCheckin = p.today();
    expect(p.checkinDue()).toBe(false);
    p.DB.meta.lastCheckin = p.addDays(p.today(), -8);
    expect(p.checkinDue()).toBe(true);
  });

  it('elapsed mode counts days since the last one', () => {
    p.DB.meta.checkinMode = 'elapsed';
    p.DB.meta.checkinEveryDays = 5;
    p.DB.meta.lastCheckin = p.addDays(p.today(), -4);
    expect(p.checkinDue()).toBe(false);
    p.DB.meta.lastCheckin = p.addDays(p.today(), -5);
    expect(p.checkinDue()).toBe(true);
  });

  it('lastDowKey walks back to the most recent named weekday', () => {
    const dow = p.parseKey(p.today()).getDay();
    expect(p.lastDowKey(dow)).toBe(p.today());
    expect(p.daysBetween(p.lastDowKey((dow + 1) % 7), p.today())).toBe(6);
  });
});

describe('bounded and resumable [' + TARGET + ']', () => {
  const manyDebts = n => { for (let i = 0; i < n; i++) makeGoal(p, { title: 'stepless ' + i, step: null }); };

  it('always opens with the intro and ends with schedule then summary', () => {
    makeGoal(p);
    p.startCheckin();
    expect(p.CK.q[0].t).toBe('intro');
    expect(p.CK.q.at(-2).t).toBe('schedule');
    expect(p.CK.q.at(-1).t).toBe('done');
  });

  it('caps the debt cards at CK_MAX and says how many were deferred', () => {
    manyDebts(11);
    p.startCheckin();
    const debt = p.CK.q.filter(c => !['intro', 'schedule', 'done'].includes(c.t));
    expect(debt.length).toBe(p.CK_MAX);
    expect(p.CK.deferred).toBe(11 - p.CK_MAX);
    expect(h.$('.wizsub').textContent).toContain(String(p.CK_MAX));
    expect(h.$('.wizsub').textContent).toMatch(/ribbon/i);
  });

  it('intro, scheduling and summary are never cut', () => {
    manyDebts(30);
    p.startCheckin();
    expect(p.CK.q.length).toBe(p.CK_MAX + 3);
  });

  it('progress persists mid-flow and is cleared at either end', () => {
    manyDebts(3);
    p.startCheckin();
    expect(p.DB.meta.checkinProgress).toBe(null);
    p.ckNext();
    expect(p.DB.meta.checkinProgress).toMatchObject({ dateKey: p.today(), i: 1 });
    while (p.CK.i < p.CK.q.length - 1) p.ckNext();
    expect(p.DB.meta.checkinProgress).toBe(null);
  });

  it('resumes where you left off, within the same day', () => {
    manyDebts(3);
    p.DB.meta.checkinProgress = { dateKey: p.today(), i: 2, touched: 1 };
    p.startCheckin();
    expect(p.CK.i).toBe(2);
    expect(p.CK.touched).toBe(1);
    expect(h.lastToast()).toMatch(/picking up where you left off/i);
  });

  it('discards progress from another day', () => {
    manyDebts(3);
    p.DB.meta.checkinProgress = { dateKey: p.addDays(p.today(), -1), i: 2, touched: 4 };
    p.startCheckin();
    expect(p.CK.i).toBe(0);
    expect(p.CK.touched).toBe(0);
  });

  it('discards progress that points past the end of a shorter queue', () => {
    makeGoal(p);
    p.DB.meta.checkinProgress = { dateKey: p.today(), i: 40, touched: 0 };
    p.startCheckin();
    expect(p.CK.i).toBe(0);
  });

  it('back and next cannot walk off either end', () => {
    makeGoal(p);
    p.startCheckin();
    p.ckBack(); p.ckBack();
    expect(p.CK.i).toBe(0);
    for (let i = 0; i < 20; i++) p.ckNext();
    expect(p.CK.i).toBe(p.CK.q.length - 1);
  });

  it('the intro counts what is drifting and mentions hushed threads separately', () => {
    makeGoal(p, { title: 'stepless', step: null });
    const hush = makeGoal(p, { title: 'hushed', type: 'habit', rel: 'cyclical' });
    hush.goal.cadenceDays = 2; quietFor(hush.thread, 40);
    p.startCheckin();
    expect(h.$('.mbody').textContent).toMatch(/gone quiet past/i);
    expect(h.$$('.stat .k')[2].textContent).toBe('1');
  });
});

describe('answering a card [' + TARGET + ']', () => {
  const startOn = (t) => {
    p.DB.meta.checkinProgress = null;   // a second run in one test must not resume the first
    p.startCheckin();
    while (p.CK.q[p.CK.i].t !== t && p.CK.i < p.CK.q.length - 1) p.ckNext();
    expect(card().t).toBe(t);
  };

  it('a deadline gate takes the date and the metric', async () => {
    const g = makeGoal(p, { title: 'Pass the exam', type: 'deadline' });
    g.goal.gates.push({ id: 'g1', kind: 'deadline', q: 'What is the hard date?' });
    startOn('gate');
    h.type('#ckDate', '2027-05-01');
    h.type('#ckMetric', 'passing score');
    h.click('[data-ck="gate-deadline"]');
    await h.settle();
    expect(g.goal.smart.deadline).toBe('2027-05-01');
    expect(g.goal.smart.deadlineSoft).toBe(false);
    expect(g.goal.smart.metricName).toBe('passing score');
    expect(g.goal.gates).toEqual([]);
  });

  it('a deadline gate refuses an empty date rather than advancing', () => {
    const g = makeGoal(p, { type: 'deadline' });
    g.goal.gates.push({ id: 'g1', kind: 'deadline', q: '?' });
    startOn('gate');
    const at = p.CK.i;
    h.type('#ckDate', '');
    h.click('[data-ck="gate-deadline"]');
    expect(p.CK.i).toBe(at);
    expect(h.lastToast()).toMatch(/pick a date/i);
  });

  it('a trigger gate saves the condition and puts the threads to sleep', async () => {
    const g = makeGoal(p, { title: 'Reno fund', type: 'contingent' });
    g.goal.gates.push({ id: 'g1', kind: 'trigger', q: '?' });
    startOn('gate');
    h.type('#ckTrig', 'offer accepted');
    h.click('[data-ck="gate-trigger"]');
    await h.settle();
    expect(g.goal.trigger).toBe('offer accepted');
    expect(g.goal.threads.every(t => t.status === 'dormant')).toBe(true);
  });

  it('"it already fired" wakes the threads and gives them a first move', async () => {
    const g = makeGoal(p, { title: 'Reno fund', type: 'contingent', step: null, thread: { status: 'dormant' } });
    g.goal.gates.push({ id: 'g1', kind: 'trigger', q: '?' });
    startOn('gate');
    h.click('[data-ck="gate-fire"]');
    await h.settle();
    expect(g.thread.status).toBe('active');
    expect(p.currentStep(g.thread).title).toContain('First move on');
  });

  it('the decision fork teaches the classifier when it lands on decision', async () => {
    const g = makeGoal(p, { title: 'Should I move to Denver', step: null });
    g.goal.gates.push({ id: 'g1', kind: 'decision', q: '?' });
    startOn('gate');
    h.click('[data-ck="gate-isdecision"]');
    await h.settle();
    expect(g.goal.type).toBe('decision');
    expect(p.DB.meta.learned.some(e => e.type === 'decision')).toBe(true);
    expect(p.currentStep(g.thread).title).toContain('Research / decide');
  });

  it('"it is a goal" refiles as milestone and queues the type question', async () => {
    const g = makeGoal(p, { title: 'Should I move to Denver' });
    g.goal.gates.push({ id: 'g1', kind: 'decision', q: '?' });
    startOn('gate');
    h.click('[data-ck="gate-isgoal"]');
    await h.settle();
    expect(g.goal.type).toBe('milestone');
    expect(g.goal.gates.map(x => x.kind)).toEqual(['confirm-type']);
  });

  it('confirming a type is reinforcement, and changing it is a correction', async () => {
    const g = makeGoal(p, { title: 'Set aside money monthly', type: 'threshold' });
    g.goal.gates.push({ id: 'g1', kind: 'confirm-type', q: '?' });
    startOn('gate');
    h.click('[data-ck="gate-type"]');
    await h.settle();
    expect(p.DB.meta.learned.find(e => e.type === 'threshold')).toBeTruthy();
    expect(h.lastToast()).toMatch(/reinforced/i);

    const g2 = makeGoal(p, { title: 'Tidy the shed weekly', type: 'threshold' });
    g2.goal.gates.push({ id: 'g2', kind: 'confirm-type', q: '?' });
    startOn('gate');
    h.change('#ckType', 'maintenance');
    h.click('[data-ck="gate-type"]');
    await h.settle();
    expect(g2.goal.type).toBe('maintenance');
    expect(h.lastToast()).toMatch(/read phrases like that the same way/i);
  });

  it('retyping a deadline gate queues a fresh confirm-type', async () => {
    const g = makeGoal(p, { title: 'Renew the cert', type: 'deadline' });
    g.goal.gates.push({ id: 'g1', kind: 'deadline', q: '?' });
    startOn('gate');
    h.click('[data-ck="gate-retype"]');
    await h.settle();
    expect(g.goal.type).toBe('milestone');
    expect(g.goal.gates.map(x => x.kind)).toEqual(['confirm-type']);
  });

  it('a branch card offers one button per condition and produces that step', async () => {
    const g = makeGoal(p, { rel: 'conditional', thread: {
      branches: [{ condition: 'pass', next: 'File the cert' }, { condition: 'fail', next: 'Reset the method' }] } });
    g.thread.needsBranch = true;
    startOn('branch');
    expect(h.$$('.choices .btn').length).toBe(2);
    h.click('[data-ck="branch"][data-i="1"]');
    await h.settle();
    expect(g.thread.needsBranch).toBe(false);
    // the thread still owns its original live step, so the branch step joins the queue
    expect(g.thread.steps.map(s => s.title)).toContain('Reset the method');
    expect(p.DB.log.some(l => l.kind === 'branch' && l.text === 'fail')).toBe(true);
  });

  it('a stepless card adds the named step in the chosen quadrant', async () => {
    const g = makeGoal(p, { step: null });
    startOn('nostep');
    h.type('#ckStep', 'Draft the outline');
    h.change('#ckQuad', 'q1');
    h.click('[data-ck="addstep"]');
    await h.settle();
    expect(p.currentStep(g.thread)).toMatchObject({ title: 'Draft the outline', quadrant: 'q1' });
  });

  it('a stepless card refuses a blank step', () => {
    makeGoal(p, { step: null });
    startOn('nostep');
    const at = p.CK.i;
    h.type('#ckStep', '  ');
    h.click('[data-ck="addstep"]');
    expect(p.CK.i).toBe(at);
    expect(h.lastToast()).toMatch(/name the step/i);
  });

  it('marking blocked opens a field on the card rather than a prompt', async () => {
    const g = makeGoal(p, { title: 'Practice guitar', type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="block"]');
    expect(p.CKROW).toBe('blocked');
    h.type('#ckWho', 'Marcus');
    h.click('[data-ck="block-save"]');
    await h.settle();
    expect(g.thread.status).toBe('blocked');
    expect(g.thread.blockedOn).toBe('Marcus');
    expect(g.thread.blockedSince).toBeTruthy();
  });

  it('a blank "waiting on" falls back rather than failing', async () => {
    const g = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="block"]');
    h.click('[data-ck="block-save"]');
    await h.settle();
    expect(g.thread.blockedOn).toBe('someone');
  });

  /* KNOWN GAP (see FOLLOW-UPS.md #1): renderCheckin() only draws the CKROW inline
     field on the `quiet` card. The `nostep` and `blocked` cards set CKROW and then
     re-render themselves unchanged, so two buttons lead nowhere. Pinned as current
     behaviour so the migration cannot change it silently either way. */
  it('KNOWN GAP: "actually it is blocked" on a stepless card opens no field', () => {
    makeGoal(p, { step: null });
    startOn('nostep');
    h.click('[data-ck="block"]');
    expect(p.CKROW).toBe('blocked');
    expect(h.$('#ckWho')).toBe(null);
    expect(h.$('[data-ck="block-save"]')).toBe(null);
  });

  it('a blocked card can add a nudge step the user controls', async () => {
    const g = makeGoal(p, { thread: { status: 'blocked', blockedOn: 'Marcus' } });
    startOn('blocked');
    h.click('[data-ck="unblock-nudge"]');
    await h.settle();
    expect(g.thread.status).toBe('active');
    expect(g.thread.steps.map(s => s.title)).toContain('Follow up with Marcus');
  });

  it('KNOWN GAP: unblocking a stepless thread sets the row but draws no field', () => {
    const g = makeGoal(p, { step: null, thread: { status: 'blocked', blockedOn: 'Marcus' } });
    startOn('blocked');
    h.click('[data-ck="unblock"]');
    expect(g.thread.status).toBe('active');
    expect(p.CKROW).toBe('next');
    expect(h.$('#ckNextStep')).toBe(null);   // see FOLLOW-UPS.md #1
  });

  it('a long block says so plainly', () => {
    const g = makeGoal(p, { thread: { status: 'blocked', blockedOn: 'Marcus' } });
    g.thread.blockedSince = new Date(Date.now() - 14 * 864e5).toISOString();
    startOn('blocked');
    expect(h.$('.mbody').textContent).toContain('That is a long time');
  });

  it('done-and-next completes the step through the normal path', async () => {
    const g = makeGoal(p, { title: 'Practice guitar', type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;            // 10d quiet, but under 3x, so it has not hushed
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="quiet-done"]');
    await h.settle();
    expect(g.step.done).toBe(true);
    expect(p.currentStep(g.thread).title).toContain('Next session');
  });

  it('done-and-next asks for the successor where no automatic one exists', () => {
    const g = makeGoal(p, { title: 'Pass the exam', type: 'deadline' });
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="quiet-done"]');
    expect(p.CKROW).toBe('next');
    h.type('#ckNextStep', 'Book the slot');
    h.click('[data-ck="next-save"]');
    expect(p.currentStep(g.thread).title).toBe('Book the slot');
  });

  it('"didn\'t happen" unschedules and logs the slip', async () => {
    const g = makeGoal(p, { title: 'Draft it' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), -1), 9 * 60, 45);
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="quiet-slip"]');
    await h.settle();
    expect(g.step.eventId).toBe(null);
    expect(p.DB.log.some(l => l.kind === 'slipped')).toBe(true);
  });

  it('"the cadence is wrong" takes a number on the card', async () => {
    const g = makeGoal(p, { title: 'Practice guitar', type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="quiet-cadence"]');
    expect(p.CKROW).toBe('cadence');
    h.type('#ckCad', '9');
    h.click('[data-ck="cadence-save"]');
    await h.settle();
    expect(g.goal.cadenceDays).toBe(9);
  });

  it('a cadence of zero or blank is refused', () => {
    const g = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="quiet-cadence"]');
    h.type('#ckCad', '0');
    h.click('[data-ck="cadence-save"]');
    expect(g.goal.cadenceDays).toBe(7);          // refused, so unchanged
    expect(h.lastToast()).toMatch(/number of days/i);
  });

  it('an inline row can be backed out of', () => {
    const g = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = 7;
    quietFor(g.thread, 10);
    startOn('quiet');
    h.click('[data-ck="block"]');
    expect(p.CKROW).toBe('blocked');
    h.click('[data-ck="row-cancel"]');
    expect(p.CKROW).toBe(null);
    expect(g.thread.status).toBe('active');
  });

  it('skip advances without changing anything', () => {
    const g = makeGoal(p, { step: null });
    startOn('nostep');
    const at = p.CK.i;
    h.click('[data-ck="skip"]');
    expect(p.CK.i).toBe(at + 1);
    expect(p.currentStep(g.thread)).toBe(null);
  });
});

describe('the last stage will not let a step stay loose [' + TARGET + ']', () => {
  const toSchedule = () => { p.startCheckin(); while (card().t !== 'schedule') p.ckNext(); };

  it('lists every loose step with a suggested day, time and free-time readout', () => {
    makeGoal(p, { title: 'one' });
    makeGoal(p, { title: 'two' });
    toSchedule();
    expect(h.$$('[data-sched]').length).toBe(2);
    expect(h.$('[data-sched] .sd').value).toBeTruthy();
    expect(h.$$('[data-sched] .tiny.muted').at(-1).textContent).toMatch(/free that day|already/);
  });

  it('schedules one and takes it off the list', async () => {
    const g = makeGoal(p, { title: 'one' });
    toSchedule();
    h.type('[data-sched] .sd', p.addDays(p.today(), 2));
    h.type('[data-sched] .stm', '14:30');
    h.click('[data-ck="sched-one"]');
    await h.settle();
    const ev = p.eventById(g.step.eventId);
    expect(ev.dateKey).toBe(p.addDays(p.today(), 2));
    expect(ev.start).toBe(14 * 60 + 30);
    expect(p.unscheduledItems()).toEqual([]);
  });

  it('"no time" books it as all day', async () => {
    const g = makeGoal(p, { title: 'one' });
    toSchedule();
    h.change('[data-sched] .sdur', '0');
    h.click('[data-ck="sched-one"]');
    await h.settle();
    expect(p.eventById(g.step.eventId).allDay).toBe(true);
  });

  it('schedule-all books everything and names any day it pushed over', async () => {
    p.DB.meta.dayBudgetMins = 60;
    makeGoal(p, { title: 'one' });
    makeGoal(p, { title: 'two' });
    toSchedule();
    const day = p.addDays(p.today(), 3);
    h.$$('[data-sched] .sd').forEach(el => h.type(el, day));
    h.click('[data-ck="sched-all"]');
    await h.settle();
    expect(p.unscheduledItems()).toEqual([]);
    expect(h.lastToast()).toMatch(/now over a/i);
  });

  it('says so plainly when nothing is loose', () => {
    const g = makeGoal(p, { title: 'one' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    toSchedule();
    expect(h.$('.mbody').textContent).toContain('Everything has a slot');
    expect(h.$('[data-ck="sched-all"]')).toBe(null);
  });
});

describe('it ends with the week, not a score [' + TARGET + ']', () => {
  const toSummary = () => { p.startCheckin(); while (card().t !== 'done') p.ckNext(); };

  it('leads with what is on the calendar and demotes the score to a footnote', () => {
    const g = makeGoal(p, { title: 'Ship Plumbline', step: 'Terraform staging' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), 1), 10 * 60, 60);
    toSummary();
    const body = h.$('.mbody').textContent;
    expect(h.$('.modal h3').textContent).toContain('The week ahead');
    expect(body).toContain('Next seven days');
    expect(body).toContain('Terraform staging');
    expect(body).toMatch(/Last 7 days:/);
    expect(h.$('.mbody').innerHTML.indexOf('Next seven days'))
      .toBeLessThan(h.$('.mbody').innerHTML.indexOf('Last 7 days'));
  });

  it('picks three that carry the week, urgent-important first then soonest', () => {
    // the summary renders step titles, so each fixture needs its own
    const mk = (name, quad, dayOff) => {
      const g = makeGoal(p, { title: name, step: name });
      g.step.quadrant = quad;
      p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), dayOff), 9 * 60, 45);
      return g;
    };
    mk('q1 later', 'q1', 4);
    mk('q1 soon', 'q1', 1);
    mk('q4 today', 'q4', 0);

    toSummary();
    const sec = h.$$('.modal .sec')[0];
    expect(sec.textContent).toContain('If you only do three things');
    const order = sec.querySelectorAll('.stepline');
    expect(order[0].textContent).toContain('q1 soon');
    expect(order[1].textContent).toContain('q1 later');
    expect(order[2].textContent).toContain('q4 today');
  });

  it('counts what is still loose and says nothing is booked when nothing is', () => {
    makeGoal(p, { title: 'loose one' });
    toSummary();
    expect(h.$('.wizq').textContent).toContain('Nothing booked yet');
    expect(h.$('.wizsub').textContent).toContain('1 next step still without a slot');
    expect(h.$('.mbody').textContent).toContain('That is the thing to fix');
  });

  it('finishing logs the check-in, stamps the date and clears progress', async () => {
    makeGoal(p, { title: 'one' });
    toSummary();
    h.click('[data-ck="finish"]');
    await h.settle();
    expect(p.DB.meta.lastCheckin).toBe(p.today());
    expect(p.DB.meta.checkinProgress).toBe(null);
    expect(p.CK).toBe(null);
    expect(h.$('.scrim')).toBe(null);
    expect(p.DB.log.some(l => l.kind === 'checkin')).toBe(true);
  });
});

describe('a full click-through [' + TARGET + ']', () => {
  it('walks from intro to logged without a single native dialog', async () => {
    const ns = makeGoal(p, { title: 'stepless', step: null });
    const q = makeGoal(p, { title: 'quiet one', type: 'habit', rel: 'cyclical' });
    quietFor(q.thread, 10);

    p.startCheckin();
    h.click('[data-ck="next"]');

    while (card().t !== 'schedule'){
      const t = card().t;
      if (t === 'nostep'){ h.type('#ckStep', 'A named move'); h.click('[data-ck="addstep"]'); }
      else if (t === 'quiet') h.click('[data-ck="quiet-done"]');
      else h.click('[data-ck="skip"]');
      await h.settle();
    }
    h.click('[data-ck="sched-all"]');
    await h.settle();
    h.click('[data-ck="next"]');
    expect(card().t).toBe('done');
    h.click('[data-ck="finish"]');
    await h.settle();

    expect(p.currentStep(p.threadById(ns.goal.id, ns.thread.id)).title).toBe('A named move');
    expect(p.DB.meta.lastCheckin).toBe(p.today());
    expect(p.unscheduledItems()).toEqual([]);
  });

  it('the header badge shows the count while one is due', () => {
    makeGoal(p, { title: 'stepless', step: null });
    p.DB.meta.lastCheckin = null;
    p.render();
    const badge = h.$('#checkinBadge');
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toMatch(/^due · \d+$/);
    p.DB.meta.lastCheckin = p.today();
    p.DB.meta.checkinMode = 'elapsed';
    p.DB.meta.checkinEveryDays = 7;
    p.render();
    expect(h.$('#checkinBadge').classList.contains('hidden')).toBe(true);
  });
});

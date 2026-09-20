import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const at = z => { p.DB.meta.zoom = z; p.render(); };
const quietFor = (t, d) => { t.lastMovement = new Date(Date.now() - d * 864e5).toISOString(); };

describe('list view [' + TARGET + ']', () => {
  it('is reachable by the 4 key and by the zoom bar', () => {
    h.key(h.document.body, '4');
    expect(p.DB.meta.zoom).toBe('list');
    h.click('#zoombar [data-z="day"]');
    expect(p.DB.meta.zoom).toBe('day');
    h.click('#zoombar [data-z="list"]');
    expect(p.DB.meta.zoom).toBe('list');
  });

  it('shows one row per live goal, with the type counts adding up', () => {
    makeGoal(p, { title: 'a habit', type: 'habit', rel: 'cyclical' });
    makeGoal(p, { title: 'a milestone', type: 'milestone' });
    makeGoal(p, { title: 'another milestone', type: 'milestone' });
    const done = makeGoal(p, { title: 'finished' });
    p.finishGoal(done.goal);
    at('list');

    expect(h.$$('.lrow').length).toBe(3);
    const counts = Object.fromEntries(h.$$('.ltog[data-ltype]')
      .map(b => [b.dataset.ltype, b.querySelector('.n').textContent]));
    expect(counts.habit).toBe('1');
    expect(counts.milestone).toBe('2');
    expect(counts.task).toBe('0');
    expect(h.$('.viewhead .sub').textContent).toContain('3 of 3 goals');
  });

  it('the row carries the goal, its live step and what it is waiting on', () => {
    const g = makeGoal(p, { title: 'Ship Plumbline', type: 'milestone', step: 'Terraform staging' });
    at('list');
    const row = h.$('.lrow');
    expect(row.dataset.goal).toBe(g.goal.id);
    expect(row.querySelector('.ltype').textContent).toBe('Milestone');
    expect(row.querySelector('.lttl').textContent).toBe('Ship Plumbline');
    expect(row.querySelector('.lstep').textContent).toBe('Terraform staging');
    expect(row.querySelector('.lstate').textContent).toBe('unscheduled');
  });

  it('covers every goalState branch', () => {
    const mk = (title, build) => { const x = makeGoal(p, { title }); build(x); return x; };

    const blocked = mk('blocked', x => { x.thread.status = 'blocked'; x.thread.blockedOn = 'Marcus'; });
    expect(p.goalState(blocked.goal)).toMatchObject({ k: 'blocked', sev: 'warn', text: 'waiting on Marcus' });
    // a blocked thread still has a step — it just cannot move. Report both.
    expect(p.goalState(blocked.goal).step.id).toBe(blocked.step.id);

    const dormant = mk('dormant', x => { x.thread.status = 'dormant'; x.goal.trigger = 'the offer lands'; });
    expect(p.goalState(dormant.goal)).toMatchObject({ k: 'dormant', sev: 'mute', text: 'until the offer lands' });

    const branch = mk('branch', x => { x.thread.needsBranch = true; });
    expect(p.goalState(branch.goal)).toMatchObject({ k: 'branch', sev: 'hard', text: 'branch unresolved' });

    const nostep = makeGoal(p, { title: 'nostep', step: null });
    expect(p.goalState(nostep.goal)).toMatchObject({ k: 'nostep', sev: 'hard', text: 'no next step' });

    const hush = makeGoal(p, { title: 'hushed', type: 'habit', rel: 'cyclical' });
    hush.goal.cadenceDays = 2; quietFor(hush.thread, 40);
    expect(p.goalState(hush.goal)).toMatchObject({ k: 'hushed', sev: 'mute', text: 'gone quiet' });

    const unsched = mk('unscheduled', () => {});
    expect(p.goalState(unsched.goal)).toMatchObject({ k: 'unscheduled', sev: 'warn' });

    const slip = makeGoal(p, { title: 'slipped' });
    p.CAL.anchor(slip.goal, slip.thread, slip.step, p.addDays(p.today(), -3), 9 * 60, 45);
    expect(p.goalState(slip.goal)).toMatchObject({ k: 'slipped', sev: 'hard', text: 'slipped 3d' });

    const ok = makeGoal(p, { title: 'fine' });
    p.CAL.anchor(ok.goal, ok.thread, ok.step, p.addDays(p.today(), 1), 9 * 60, 45);
    expect(p.goalState(ok.goal)).toMatchObject({ k: 'ok', sev: 'ok', text: 'tomorrow' });

    const task = makeGoal(p, { title: 'a task', type: 'task' });
    expect(p.goalState(task.goal).k).toBe('ok');
  });

  it('sorts worst first, then soonest, then by title', () => {
    const ok = makeGoal(p, { title: 'zzz fine' });
    p.CAL.anchor(ok.goal, ok.thread, ok.step, p.addDays(p.today(), 1), 9 * 60, 45);
    makeGoal(p, { title: 'bbb unscheduled' });
    makeGoal(p, { title: 'aaa stepless', step: null });
    const hush = makeGoal(p, { title: 'hushed', type: 'habit', rel: 'cyclical' });
    hush.goal.cadenceDays = 2; quietFor(hush.thread, 40);
    at('list');
    expect(h.$$('.lrow .lttl').map(e => e.textContent))
      .toEqual(['aaa stepless', 'bbb unscheduled', 'zzz fine', 'hushed']);
  });

  it('counts how many rows need attention', () => {
    makeGoal(p, { title: 'stepless', step: null });
    makeGoal(p, { title: 'unscheduled' });
    const ok = makeGoal(p, { title: 'fine' });
    p.CAL.anchor(ok.goal, ok.thread, ok.step, p.addDays(p.today(), 1), 9 * 60, 45);
    at('list');
    expect(h.$('.viewhead .sub').textContent).toContain('2 need');
  });

  it('a type toggle hides its rows, keeps its count, and undoes', async () => {
    makeGoal(p, { title: 'a habit', type: 'habit', rel: 'cyclical' });
    makeGoal(p, { title: 'a milestone', type: 'milestone' });
    at('list');
    h.click('.ltog[data-ltype="habit"]');
    await h.settle();

    expect(h.$$('.lrow').length).toBe(1);
    expect(p.DB.meta.listHidden).toEqual(['habit']);
    const chip = h.$('.ltog[data-ltype="habit"]');
    expect(chip.classList.contains('off')).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.querySelector('.n').textContent).toBe('1');   // still says what is hidden

    p.undo();
    expect(p.DB.meta.listHidden).toEqual([]);
    expect(h.$$('.lrow').length).toBe(2);
  });

  it('the all-hidden empty state says so and offers a way back', () => {
    makeGoal(p, { title: 'a habit', type: 'habit', rel: 'cyclical' });
    p.DB.meta.listHidden = Object.keys(p.TYPE);
    at('list');
    expect(h.$('.lempty').textContent).toContain('Every type is switched off');
    h.click('[data-ltype="*"]');
    expect(p.DB.meta.listHidden).toEqual([]);
    expect(h.$$('.lrow').length).toBe(1);
  });

  it('an empty list says to capture something', () => {
    at('list');
    expect(h.$('.lempty').textContent).toContain('Nothing active');
  });

  it('the filter persists, and junk in it is discarded on load', async () => {
    makeGoal(p, { title: 'a habit', type: 'habit', rel: 'cyclical' });
    at('list');
    h.click('.ltog[data-ltype="habit"]');
    await h.settle();
    const saved = h.window.localStorage.getItem(p.KEY);
    expect(JSON.parse(saved).meta.listHidden).toEqual(['habit']);

    const junked = JSON.parse(saved);
    junked.meta.listHidden = ['habit', 'not-a-type', 'task'];
    const t = await boot({ stored: JSON.stringify(junked) });
    expect(t.api.DB.meta.listHidden).toEqual(['habit', 'task']);
    t.close();
  });

  it('only a row with a live step is draggable, and it carries the ids the drop needs', () => {
    const g = makeGoal(p, { title: 'has a step' });
    makeGoal(p, { title: 'no step', step: null });
    at('list');
    const rows = Object.fromEntries(h.$$('.lrow').map(r => [r.querySelector('.lttl').textContent, r]));
    expect(rows['has a step'].classList.contains('draggable')).toBe(true);
    expect(rows['has a step'].dataset.step).toBe(g.step.id);
    expect(rows['has a step'].dataset.thread).toBe(g.thread.id);
    expect(rows['has a step'].querySelector('.grip')).toBeTruthy();
    expect(rows['no step'].classList.contains('draggable')).toBe(false);
    expect(rows['no step'].querySelector('.grip')).toBe(null);
  });

  it('carries the shared day strip as a drop target, with its own day nav', () => {
    at('list');
    expect(h.$('.strip .track[data-caldrop]')).toBeTruthy();
    expect(h.$('.striplbl').textContent).toContain('drag a row onto the strip');
    h.click('[data-nav="1"]');
    expect(p.DB.meta.cursor).toBe(p.addDays(p.today(), 1));
    h.click('[data-nav="0"]');
    expect(p.DB.meta.cursor).toBe(p.today());
  });

  it('a row opens its goal, while the subtask pill does not', () => {
    const g = makeGoal(p, { title: 'open me' });
    g.step.subs = [p.newSub('one')];
    at('list');
    h.click('.lrow .subpill');
    expect(h.$('.modal')).toBe(null);
    h.click('.lrow .lttl');
    expect(h.$('.mbody[data-goal]').dataset.goal).toBe(g.goal.id);
  });
});

describe('the completed archive [' + TARGET + ']', () => {
  it('toggles, counts, and shows what each one took', async () => {
    const a = makeGoal(p, { title: 'shipped it' });
    a.goal.why = 'the portfolio piece';        // the row carries the goal's why, not the close reason
    a.thread.steps.unshift(p.newStep('one', { done: true }), p.newStep('two', { done: true }));
    p.finishGoal(a.goal, 'done and dusted');
    makeGoal(p, { title: 'still going' });
    at('list');

    const toggle = h.$('[data-listdone]');
    expect(toggle.querySelector('.n').textContent).toBe('1');
    h.click(toggle);
    await h.settle();

    expect(h.$('.viewhead h2').textContent).toBe('Completed');
    const row = h.$('.lrow');
    expect(row.querySelector('.lttl').textContent).toBe('shipped it');
    expect(row.querySelector('.lttl').classList.contains('done')).toBe(true);
    expect(row.querySelector('.lstep').textContent).toContain('2 steps done');
    expect(row.querySelector('.lstep').textContent).toContain('the portfolio piece');
    expect(row.querySelector('.lstate').textContent).not.toBe('');
    expect(h.$('[data-listdone] .n').textContent).toBe('1');   // live goals, back the other way
  });

  it('reopen puts it back, and not dead', async () => {
    const a = makeGoal(p, { title: 'reopen me', type: 'habit', rel: 'cyclical' });
    a.thread.steps.forEach(s => { s.done = true; });
    p.finishGoal(a.goal);
    p.DB.meta.listDone = true;
    at('list');

    h.click('[data-reopen]');
    await h.settle();
    expect(p.goalById(a.goal.id).status).toBe('active');
    expect(p.currentStep(p.threadById(a.goal.id, a.thread.id))).toBeTruthy();
    expect(h.lastToast()).toMatch(/back in rotation/i);
  });

  it('says nothing is finished yet when nothing is', () => {
    p.DB.meta.listDone = true;
    at('list');
    expect(h.$('.lempty').textContent).toContain('Nothing finished yet');
  });
});

describe('day view [' + TARGET + ']', () => {
  it('shows the four quadrants with their counts, and an empty note where there is nothing', () => {
    const a = makeGoal(p, { title: 'urgent', step: 'do now thing', stepOpts: { quadrant: 'q1' } });
    p.CAL.anchor(a.goal, a.thread, a.step, p.today(), 9 * 60, 45);
    at('day');

    const quads = h.$$('.quad');
    expect(quads.length).toBe(4);
    expect(quads.map(q => q.dataset.quad)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(h.$('.quad[data-quad="q1"] h3').textContent).toContain('Do now');
    expect(h.$('.quad[data-quad="q1"] .n').textContent).toBe('1');
    expect(h.$('.quad[data-quad="q2"] .empty').textContent).toBe('nothing here');
  });

  it('a card carries the ids a drop needs, and its meta', () => {
    const g = makeGoal(p, { title: 'Ship Plumbline', step: 'Terraform staging', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 14 * 60, 45);
    at('day');

    const card = h.$('.card');
    expect(card.dataset.step).toBe(g.step.id);
    expect(card.dataset.thread).toBe(g.thread.id);
    expect(card.dataset.goal).toBe(g.goal.id);
    expect(card.querySelector('.ttl').textContent).toBe('Terraform staging');
    expect(card.querySelector('.meta').textContent).toContain('Plumbline');
    expect(card.querySelector('.meta').textContent).toContain('2pm');
    expect(card.querySelector('.grip')).toBeTruthy();
  });

  it('marks an unscheduled step, and a slipped one with how far', () => {
    makeGoal(p, { title: 'loose', type: 'task', step: 'a task' });
    const slip = makeGoal(p, { title: 'late', step: 'overdue thing' });
    p.CAL.anchor(slip.goal, slip.thread, slip.step, p.addDays(p.today(), -2), 9 * 60, 45);
    at('day');
    expect(h.$('#view').textContent).toContain('slipped 2d');
  });

  it('today pulls in overdue work and loose tasks; another day does not', () => {
    const slip = makeGoal(p, { title: 'overdue' , step: 'overdue step' });
    p.CAL.anchor(slip.goal, slip.thread, slip.step, p.addDays(p.today(), -1), 9 * 60, 45);
    makeGoal(p, { title: 'a task', type: 'task', step: 'loose task' });
    at('day');
    expect(h.$('#view').textContent).toContain('overdue step');
    expect(h.$('#view').textContent).toContain('loose task');

    p.DB.meta.cursor = p.addDays(p.today(), 1);
    p.render();
    expect(h.$('#view').textContent).not.toContain('overdue step');
  });

  it('anything with no slot drops into the tray below', () => {
    makeGoal(p, { title: 'unscheduled one', step: 'no slot yet' });
    at('day');
    const tray = h.$$('.strip').at(-1);
    expect(tray.textContent).toContain('Not on the calendar yet');
    expect(tray.textContent).toContain("if it isn't scheduled, it isn't real");
    expect(tray.textContent).toContain('no slot yet');
  });

  it('the head names the day and the nav moves the cursor', () => {
    at('day');
    expect(h.$('.viewhead h2').textContent).toBe('Today');
    h.click('[data-nav="1"]');
    expect(p.DB.meta.cursor).toBe(p.addDays(p.today(), 1));
    expect(h.$('.viewhead h2').textContent).not.toBe('Today');
    h.click('[data-nav="0"]');
    expect(p.DB.meta.cursor).toBe(p.today());
  });

  it('the checkbox completes the step, which re-books the successor out of today', async () => {
    const g = makeGoal(p, { title: 'tick me', type: 'habit', rel: 'cyclical', step: 'session one' });
    g.goal.cadenceDays = 3;
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    h.click('.card .chk');
    await h.settle();

    expect(g.step.done).toBe(true);
    const next = p.currentStep(g.thread);
    expect(p.eventById(next.eventId).dateKey).toBe(p.addDays(p.today(), 3));
    expect(h.$('.card')).toBe(null);          // nothing left on today
  });

  it('a card opens its goal', () => {
    const g = makeGoal(p, { title: 'open me', step: 'a step' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    h.click('.card .ttl');
    expect(h.$('.mbody[data-goal]').dataset.goal).toBe(g.goal.id);
  });
});

describe('week view [' + TARGET + ']', () => {
  it('lays out seven columns from Sunday, marking today', () => {
    at('week');
    const cols = h.$$('.daycol');
    expect(cols.length).toBe(7);
    expect(cols[0].dataset.day).toBe(p.startOfWeek(p.today()));
    expect(h.$$('.daycol.today').length).toBe(1);
    expect(cols.every(c => c.dataset.daydrop === '1')).toBe(true);
  });

  it('timed events sit on top and untimed tasks beneath, with a quadrant dot', () => {
    const g = makeGoal(p, { title: 'a goal', step: 'untimed step', stepOpts: { quadrant: 'q1' } });
    const ev = p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 0, 1440);
    ev.allDay = true;
    p.addEvent(p.newEvent({ title: 'Standup', dateKey: p.today(), start: 9 * 60, dur: 30 }));
    at('week');

    const col = h.$(`.daycol[data-day="${p.today()}"]`);
    expect(col.querySelector('.evchip').textContent).toContain('Standup');
    const chip = col.querySelector('.tchip[data-step]');
    expect(chip.textContent).toContain('untimed step');
    expect(chip.querySelector('.dot')).toBeTruthy();
    expect(chip.dataset.step).toBe(g.step.id);
  });

  it('says how much the week holds, and carries the budget panel underneath', () => {
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 9 * 60, dur: 120 }));
    at('week');
    expect(h.$('.viewhead .sub').textContent).toContain('2h booked across the week');
    expect(h.$('.budget')).toBeTruthy();
    expect(h.$('.budget .lbl').textContent).toContain('Weekly budget');
  });

  it('the nav moves a week at a time', () => {
    at('week');
    h.click('[data-nav="7"]');
    expect(p.DB.meta.cursor).toBe(p.addDays(p.today(), 7));
    h.click('[data-nav="0"]');
    expect(p.DB.meta.cursor).toBe(p.today());
  });
});

describe('quarter view [' + TARGET + ']', () => {
  it('draws 13 week density bars and a row per non-task goal', () => {
    makeGoal(p, { title: 'Ship Plumbline', type: 'milestone' });
    makeGoal(p, { title: 'a task', type: 'task' });
    at('quarter');
    expect(h.$$('.dbar').length).toBe(13);
    expect(h.$$('.rmrow').length).toBe(1);
    expect(h.$('.rmleft').textContent).toContain('Plumbline');
    expect(h.$('.rmleft .pill').textContent).toBe('Milestone');
  });

  it('the left column reads the current next step, or what it is waiting on', () => {
    const b = makeGoal(p, { title: 'blocked one', thread: { status: 'blocked', blockedOn: 'Marcus' } });
    const d = makeGoal(p, { title: 'dormant one', thread: { status: 'dormant' } });
    d.goal.trigger = 'the offer lands';
    makeGoal(p, { title: 'stepless one', step: null });
    makeGoal(p, { title: 'normal one', step: 'the next move' });
    at('quarter');
    const text = h.$('.roadmap').textContent;
    expect(text).toContain('waiting on Marcus');
    expect(text).toContain('dormant');
    expect(text).toContain('the offer lands');
    expect(text).toContain('no next step');
    expect(text).toContain('the next move');
    expect(text).toContain('unscheduled');
  });

  it('a metric goal shows progress against its target', () => {
    const g = makeGoal(p, { title: 'Saving', type: 'threshold', rel: 'cyclical' });
    g.goal.smart.target = 9000; g.goal.smart.current = 3150;
    at('quarter');
    expect(h.$('.band').textContent).toContain('$3,150 / $9,000');
    // Preact serialises inline styles as `width: 35%`, the string build as
    // `width:35%` — same width, different whitespace, so compare normalised.
    expect(h.$('.band .prog').getAttribute('style').replace(/\s/g, '')).toContain('width:35%');
  });

  it('scheduled steps become dots and clicking a density bar jumps to that week', () => {
    const g = makeGoal(p, { title: 'Ship it' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), 3), 9 * 60, 45);
    at('quarter');
    expect(h.$$('.stepdot').length).toBe(1);

    const bar = h.$$('.dbar')[2];
    const week = bar.dataset.jump;
    h.click(bar);
    expect(p.DB.meta.zoom).toBe('week');
    expect(p.DB.meta.cursor).toBe(week);
  });

  it('says so when there are no goals', () => {
    at('quarter');
    expect(h.$('.roadmap').textContent).toContain('No goals yet');
  });
});

describe('escaping [' + TARGET + ']', () => {
  const HOSTILE = '<img src=x onerror="window.__pwned=1">';

  it('a hostile string renders as text across every view', () => {
    const g = makeGoal(p, { title: HOSTILE, type: 'milestone', step: HOSTILE });
    g.goal.trigger = HOSTILE; g.goal.why = HOSTILE;
    g.thread.blockedOn = HOSTILE;
    g.step.subs = [p.newSub(HOSTILE)];
    p.addEvent(p.newEvent({ title: HOSTILE, dateKey: p.today(), start: 9 * 60, dur: 30 }));

    for (const z of ['day', 'week', 'quarter', 'list']){
      at(z);
      expect(h.$$('#view img').length, z).toBe(0);
      expect(h.window.__pwned, z).toBeUndefined();
      expect(h.$('#view').textContent, z).toContain('onerror');
    }
  });

  it('and in the ribbon and the goal editor', () => {
    const g = makeGoal(p, { title: HOSTILE, step: null });
    p.render();
    expect(h.$$('#signals img').length).toBe(0);
    expect(h.$('#signals').textContent).toContain('onerror');

    p.openGoal(g.goal.id);
    expect(h.$$('.modal img').length).toBe(0);
    expect(h.window.__pwned).toBeUndefined();
  });
});

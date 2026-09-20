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

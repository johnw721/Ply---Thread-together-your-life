import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const quietFor = (thread, days) => { thread.lastMovement = new Date(Date.now() - days * 864e5).toISOString(); };
const kinds = p2 => p2.signals().map(s => s.kind);

describe('what surfaces [' + TARGET + ']', () => {
  it('a thread with no next step is hard', () => {
    const { thread } = makeGoal(p, { step: null });
    const s = p.signals().find(x => x.kind === 'nostep');
    expect(s.sev).toBe('hard');
    expect(s.text).toBe('No next step defined');
  });

  it('a next step with no calendar slot is a warning — unless it is a plain task', () => {
    makeGoal(p, { type: 'milestone' });
    expect(kinds(p)).toContain('unscheduled');
    p.DB.goals = [];
    makeGoal(p, { type: 'task' });
    expect(kinds(p)).not.toContain('unscheduled');
  });

  it('a slot in the past is slipped, and counts the days', () => {
    const { goal, thread, step } = makeGoal(p);
    p.CAL.anchor(goal, thread, step, p.addDays(p.today(), -3), 9 * 60, 45);
    const s = p.signals().find(x => x.kind === 'slipped');
    expect(s.sev).toBe('hard');
    expect(s.days).toBe(3);
    expect(s.text).toBe('Slipped 3d past its slot');
  });

  it('an unresolved branch is hard', () => {
    const { thread } = makeGoal(p, { rel: 'conditional' });
    thread.needsBranch = true;
    expect(p.signals().find(x => x.kind === 'branch').sev).toBe('hard');
  });

  it('a blocked thread only surfaces after a week, and reports who', () => {
    const { thread } = makeGoal(p, { thread: { status: 'blocked', blockedOn: 'Marcus' } });
    thread.blockedSince = new Date(Date.now() - 3 * 864e5).toISOString();
    expect(kinds(p)).not.toContain('blocked');
    thread.blockedSince = new Date(Date.now() - 9 * 864e5).toISOString();
    const s = p.signals().find(x => x.kind === 'blocked');
    expect(s.text).toBe('Blocked 9d — waiting on Marcus');
  });

  it('a blocked thread emits nothing else', () => {
    const { thread } = makeGoal(p, { step: null, thread: { status: 'blocked', blockedOn: 'Marcus' } });
    thread.blockedSince = new Date(Date.now() - 9 * 864e5).toISOString();
    quietFor(thread, 90);
    expect(kinds(p)).toEqual(['blocked']);
  });

  it('a queued gate surfaces with a short label', () => {
    const { goal } = makeGoal(p);
    goal.gates.push({ id: 'g1', kind: 'deadline', q: 'what date?' });
    const s = p.signals().find(x => x.kind === 'gate');
    expect(s.text).toBe('Needs a hard date');
    expect(s.sev).toBe('warn');
  });

  it('a deadline inside 14 days fires, hardening inside five', () => {
    const { goal, thread, step } = makeGoal(p, { type: 'deadline' });
    p.CAL.anchor(goal, thread, step, p.addDays(p.today(), 1), 9 * 60, 45);
    goal.smart.deadline = p.addDays(p.today(), 20);
    expect(kinds(p)).not.toContain('deadline');
    goal.smart.deadline = p.addDays(p.today(), 12);
    expect(p.signals().find(x => x.kind === 'deadline').sev).toBe('warn');
    goal.smart.deadline = p.addDays(p.today(), 3);
    expect(p.signals().find(x => x.kind === 'deadline').sev).toBe('hard');
    goal.smart.deadline = p.today();
    expect(p.signals().find(x => x.kind === 'deadline').text).toBe('Due today');
    goal.smart.deadline = p.addDays(p.today(), -2);
    expect(p.signals().find(x => x.kind === 'deadline').text).toBe('Deadline passed 2d ago');
  });

  it('dormant and finished threads are silent', () => {
    makeGoal(p, { thread: { status: 'dormant' } });
    const { goal } = makeGoal(p, { title: 'done' });
    p.finishGoal(goal);
    expect(p.signals()).toEqual([]);
  });

  it('strongest first, then most overdue', () => {
    const a = makeGoal(p, { title: 'unscheduled one' });
    const b = makeGoal(p, { title: 'stepless', step: null });
    quietFor(b.thread, 1);
    const sigs = p.signals();
    expect(sigs[0].sev).toBe('hard');
    const warns = sigs.filter(s => s.sev === 'warn');
    for (let i = 1; i < warns.length; i++) expect(warns[i - 1].days >= warns[i].days).toBe(true);
  });
});

describe('the escalation ladder [' + TARGET + ']', () => {
  const mk = (cadence, days) => {
    const g = makeGoal(p, { type: 'habit', rel: 'cyclical' });
    g.goal.cadenceDays = cadence;
    quietFor(g.thread, days);
    p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), 2), 9 * 60, 45);
    return g;
  };

  it('is silent up to the limit', () => {
    mk(5, 5);
    expect(kinds(p)).not.toContain('quiet');
  });

  it('warns past the limit', () => {
    mk(5, 6);
    const s = p.signals().find(x => x.kind === 'quiet');
    expect(s.sev).toBe('warn');
    expect(s.text).toBe('No movement in 6d');
  });

  it('hardens past twice the limit', () => {
    mk(5, 11);
    expect(p.signals().find(x => x.kind === 'quiet').sev).toBe('hard');
  });

  it('gives up past three times the limit — one muted chip and nothing else', () => {
    const { goal, thread } = mk(5, 16);
    expect(p.hushed(goal, thread)).toBe(true);
    const sigs = p.signals();
    expect(sigs.length).toBe(1);
    expect(sigs[0].kind).toBe('hushed');
    expect(sigs[0].sev).toBe('mute');
    expect(sigs[0].text).toContain('no longer nagging');
  });

  it('exactly 3x is not yet hushed', () => {
    const { goal, thread } = mk(5, 15);
    expect(p.hushed(goal, thread)).toBe(false);
  });

  it('movement un-hushes on its own, with no flag to get stuck', () => {
    const { goal, thread } = mk(5, 40);
    expect(p.hushed(goal, thread)).toBe(true);
    p.touchThread(thread);
    expect(p.hushed(goal, thread)).toBe(false);
    expect(kinds(p)).not.toContain('hushed');
  });

  it('blocked threads never hush — someone else\'s delay is not neglect', () => {
    const { goal, thread } = mk(5, 90);
    thread.status = 'blocked'; thread.blockedOn = 'Marcus';
    expect(p.hushed(goal, thread)).toBe(false);
  });

  it('a cadence of zero never goes quiet at all', () => {
    const { goal, thread } = mk(0, 500);
    expect(p.hushed(goal, thread)).toBe(false);
    expect(kinds(p)).not.toContain('quiet');
  });

  it('a decision gets double the leash', () => {
    const g = makeGoal(p, { type: 'decision' });
    expect(p.quietLimit(g.goal)).toBe(p.cadenceOf(g.goal) * 2);
  });

  it('a deadline inside 14 days still fires however long it has been ignored', () => {
    const { goal, thread } = mk(5, 200);
    goal.type = 'deadline';
    goal.smart.deadline = p.addDays(p.today(), 4);
    expect(p.hushed(goal, thread)).toBe(true);
    expect(kinds(p)).toContain('deadline');
  });
});

describe('snoozing [' + TARGET + ']', () => {
  it('mutes a chip for seven days and is undoable', async () => {
    makeGoal(p);
    const key = p.signals()[0].key;
    p.snoozeSignals([key], 'that snooze');
    await h.settle();
    expect(p.signals().find(s => s.key === key)).toBeUndefined();
    expect(p.DB.meta.snoozed[0].until).toBe(p.addDays(p.today(), 7));
    p.undo();
    expect(p.signals().find(s => s.key === key)).toBeTruthy();
  });

  it('snoozing several at once replaces rather than duplicating', () => {
    makeGoal(p, { title: 'a' });
    makeGoal(p, { title: 'b' });
    const keys = p.signals().map(s => s.key);
    p.snoozeSignals(keys, 'x');
    p.snoozeSignals(keys, 'x');
    expect(p.DB.meta.snoozed.length).toBe(keys.length);
    expect(p.signals()).toEqual([]);
  });

  it('a snoozed thread still reaches the check-in agenda', () => {
    const { thread } = makeGoal(p, { step: null });
    p.snoozeSignals(p.signals().map(s => s.key), 'x');
    expect(p.signals()).toEqual([]);
    expect(p.checkinAgenda().nostep.map(x => x.thread.id)).toContain(thread.id);
  });

  it('a key identifies the gate, then the thread, then the goal', () => {
    const { goal, thread } = makeGoal(p);
    goal.gates.push({ id: 'gate1', kind: 'deadline', q: '?' });
    const byKind = Object.fromEntries(p.signals().map(s => [s.kind, s.key]));
    expect(byKind.gate).toBe('gate:gate1');
    expect(byKind.unscheduled).toBe('unscheduled:' + thread.id);
  });
});

describe('the ribbon [' + TARGET + ']', () => {
  const chips = () => h.$$('#signals .sigrow .sig:not(.more)');

  it('is empty and marked so when nothing is drifting', () => {
    p.render();
    expect(h.$('#signals').classList.contains('empty')).toBe(true);
    expect(h.$('#signals').innerHTML).toBe('');
  });

  it('shows one chip per kind, not one per thread', () => {
    for (let i = 0; i < 6; i++) makeGoal(p, { title: 'goal ' + i });
    p.render();
    expect(p.signals().length).toBe(6);
    expect(chips().length).toBe(1);
    expect(chips()[0].textContent).toContain('6 threads');
    expect(chips()[0].textContent).toContain('next step not on the calendar');
  });

  it('a single-thread kind names the goal instead of counting', () => {
    makeGoal(p, { title: 'Ship Plumbline' });
    p.render();
    expect(chips()[0].textContent).toContain('Ship Plumbline');
    expect(chips()[0].dataset.sig).toBeTruthy();
  });

  it('never exceeds five chips, and the rest go behind +n more', () => {
    makeGoal(p, { title: 'stepless', step: null });
    const br = makeGoal(p, { title: 'branchy', rel: 'conditional' }); br.thread.needsBranch = true;
    const sl = makeGoal(p, { title: 'slipped' });
    p.CAL.anchor(sl.goal, sl.thread, sl.step, p.addDays(p.today(), -1), 9 * 60, 45);
    const gt = makeGoal(p, { title: 'gated' });
    gt.goal.gates.push({ id: 'g1', kind: 'deadline', q: '?' });
    const bl = makeGoal(p, { title: 'blocked', thread: { status: 'blocked', blockedOn: 'x' } });
    bl.thread.blockedSince = new Date(Date.now() - 9 * 864e5).toISOString();
    const qt = makeGoal(p, { title: 'quiet', type: 'habit', rel: 'cyclical' });
    qt.goal.cadenceDays = 2; quietFor(qt.thread, 4);
    p.CAL.anchor(qt.goal, qt.thread, qt.step, p.addDays(p.today(), 2), 9 * 60, 45);
    makeGoal(p, { title: 'unscheduled' });

    p.render();
    const groups = new Set(p.signals().map(s => s.kind));
    expect(groups.size).toBeGreaterThan(p.SIG_MAX);
    expect(chips().length).toBe(p.SIG_MAX);
    const more = h.$('#signals [data-sigmore]');
    expect(more.textContent).toMatch(/^\+\d+ more$/);

    h.click(more);
    expect(chips().length).toBe(groups.size);
    expect(h.$('#signals [data-sigmore]').textContent).toBe('show less');
  });

  it('a grouped chip expands to a row per thread and offers snooze all', () => {
    for (let i = 0; i < 3; i++) makeGoal(p, { title: 'goal ' + i });
    p.render();
    h.click('#signals [data-grp]');
    expect(h.$$('#signals .sigopen .srow').length).toBe(3);
    expect(h.$('#signals .sfoot').textContent).toContain('Snooze all 3');
    h.click('#signals [data-grp]');
    expect(h.$('#signals .sigopen')).toBe(null);
  });

  it('clicking the × on a chip snoozes every signal behind it', async () => {
    for (let i = 0; i < 3; i++) makeGoal(p, { title: 'goal ' + i });
    p.render();
    h.click('#signals [data-snooze]');
    await h.settle();
    expect(p.signals()).toEqual([]);
    expect(h.lastToast()).toMatch(/3 signals snoozed/i);
  });

  it('quiet and deadline are deliberately unfixable; the other kinds are not', () => {
    expect(p.FIXABLE.has('quiet')).toBe(false);
    expect(p.FIXABLE.has('deadline')).toBe(false);
    for (const k of ['gate', 'nostep', 'unscheduled', 'slipped', 'branch', 'blocked', 'hushed'])
      expect(p.FIXABLE.has(k), k).toBe(true);
  });

  it('a fixable chip is marked fix and opens its resolver', () => {
    makeGoal(p, { title: 'needs a step', step: null });
    p.render();
    expect(h.$('#signals .fixmark')).toBeTruthy();
    h.click('#signals [data-sig]');
    expect(h.$('#signals .sigfix')).toBeTruthy();
    expect(h.$('#signals #fxStep')).toBeTruthy();
  });
});

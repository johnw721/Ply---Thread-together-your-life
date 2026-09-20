import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; h.forbidNatives(); });

describe('modals are real dialogs [' + TARGET + ']', () => {
  it('carries the dialog semantics, and the scrim', () => {
    p.openModal('<h3>A dialog</h3><div class="mbody"><input id="one"></div>');
    const m = h.$('.modal');
    expect(h.$('.scrim')).toBeTruthy();
    expect(m.getAttribute('role')).toBe('dialog');
    expect(m.getAttribute('aria-modal')).toBe('true');
    expect(m.getAttribute('tabindex')).toBe('-1');
    expect(h.document.body.classList.contains('modal-open')).toBe(true);
  });

  it('wide is opt-in', () => {
    p.openModal('<h3>x</h3>');
    expect(h.$('.modal').classList.contains('wide')).toBe(false);
    p.closeModal();
    p.openModal('<h3>x</h3>', { wide: true });
    expect(h.$('.modal').classList.contains('wide')).toBe(true);
  });

  it('closing clears the dialog and the body class', () => {
    p.openModal('<h3>x</h3>');
    p.closeModal();
    expect(h.$('.scrim')).toBe(null);
    expect(h.$('.modal')).toBe(null);
    expect(h.document.body.classList.contains('modal-open')).toBe(false);
  });

  it('Tab wraps at both ends and leaves the middle alone', () => {
    p.openModal('<h3>x</h3><div class="mbody"><button id="a">a</button><button id="b">b</button><button id="c">c</button></div>');
    const [a, b, c] = ['#a', '#b', '#c'].map(s => h.$(s));

    c.focus();
    h.key(c, 'Tab');
    expect(h.document.activeElement).toBe(a);          // forward off the end wraps

    a.focus();
    h.key(a, 'Tab', { shiftKey: true });
    expect(h.document.activeElement).toBe(c);          // back off the front wraps

    b.focus();
    h.key(b, 'Tab');
    expect(h.document.activeElement).toBe(b);          // the middle is the browser's business
  });

  it('Tab from the dialog itself goes to the last control on shift', () => {
    p.openModal('<h3>x</h3><div class="mbody"><button id="a">a</button><button id="b">b</button></div>');
    h.$('.modal').focus();
    h.key(h.$('.modal'), 'Tab', { shiftKey: true });
    expect(h.document.activeElement).toBe(h.$('#b'));
  });

  it('a dialog with nothing focusable keeps focus on itself', () => {
    p.openModal('<h3>x</h3><div class="mbody">nothing to focus</div>');
    const m = h.$('.modal');
    h.key(m, 'Tab');
    expect(h.document.activeElement).toBe(m);
  });

  it('focus returns to whatever opened it', () => {
    const opener = h.$('#btnCheckin');
    opener.focus();
    p.openModal('<h3>x</h3><div class="mbody"><button id="a">a</button></div>');
    h.$('#a').focus();
    p.closeModal();
    expect(h.document.activeElement).toBe(opener);
  });

  it('the goal editor is a dialog too, and opens wide', () => {
    const g = makeGoal(p, { title: 'open me' });
    p.openGoal(g.goal.id);
    expect(h.$('.modal').getAttribute('role')).toBe('dialog');
    expect(h.$('.modal').classList.contains('wide')).toBe(true);
    expect(h.$('.mbody[data-goal]').dataset.goal).toBe(g.goal.id);
  });
});

describe('no browser dialogs [' + TARGET + ']', () => {
  it('the natives are never reached by any flow', async () => {
    // beforeEach armed prompt/confirm/alert to throw; drive the flows that used them
    const g = makeGoal(p, { title: 'Ship it', type: 'milestone', goal: { backlog: [] } });
    g.step.subs = [];

    p.openGoal(g.goal.id);
    const sub = h.$('.newin[data-new="sub"]');
    sub.value = 'a subtask'; h.key(sub, 'Enter'); await h.settle();
    const back = h.$('.newin[data-new="backlog"]');
    back.value = 'a backlog item'; h.key(back, 'Enter'); await h.settle();
    const step = h.$('.newin[data-new="step"]');
    step.value = 'another step'; h.key(step, 'Enter'); await h.settle();

    expect(p.subs(p.currentStep(g.thread)).length).toBe(1);
    expect(g.goal.backlog).toEqual(['a backlog item']);
  });

  it('a destructive action inside an open modal arms rather than stacking a dialog', async () => {
    const g = makeGoal(p, { title: 'delete me' });
    p.openGoal(g.goal.id);

    const del = () => h.$('[data-ge="del"]');
    expect(del().textContent).toBe('Delete');
    h.click(del());
    await h.settle();
    expect(p.goalById(g.goal.id)).toBeTruthy();           // first click only arms
    expect(del().textContent).toMatch(/really delete/i);

    h.click(del());
    await h.settle();
    expect(p.goalById(g.goal.id)).toBeUndefined();
    expect(h.lastToast()).toMatch(/deleted/i);
  });

  it('arming disarms on another action, and on close', async () => {
    const g = makeGoal(p, { title: 'keep me' });
    p.openGoal(g.goal.id);
    h.click('[data-ge="del"]');
    expect(p.ARMED).toBe('del:' + g.goal.id);

    h.click('[data-ge="thread-add"]');
    await h.settle();
    expect(p.ARMED).toBe(null);

    h.click('[data-ge="del"]');
    expect(p.ARMED).toBeTruthy();
    p.closeModal();
    expect(p.ARMED).toBe(null);
    expect(p.goalById(g.goal.id)).toBeTruthy();
  });

  it('a goal will not give up its last thread', () => {
    const g = makeGoal(p, { title: 'one thread only' });
    p.openGoal(g.goal.id);
    h.click(`[data-ge="thread-del"][data-t="${g.thread.id}"]`);
    expect(h.lastToast()).toMatch(/at least one thread/i);
    expect(g.goal.threads.length).toBe(1);
  });

  it('with nothing open, a real dialog asks — and what it does is undoable', async () => {
    const g = makeGoal(p, { title: 'drop me' });
    let ran = false;
    p.openConfirm({ title: 'Drop this goal', yes: 'Drop it', danger: true,
      body: 'It goes.', onYes: () => { ran = true; p.checkpoint('dropping that goal'); p.deleteGoal(g.goal.id); } });

    expect(h.$('.modal h3').textContent).toContain('Drop this goal');
    expect(h.$('[data-ui="confirm-yes"]').textContent).toBe('Drop it');
    expect(h.$('[data-ui="confirm-yes"]').classList.contains('danger')).toBe(true);

    h.click('[data-close]');
    expect(ran).toBe(false);
    expect(p.goalById(g.goal.id)).toBeTruthy();

    p.openConfirm({ title: 'Drop this goal', yes: 'Drop it', danger: true, body: 'It goes.',
      onYes: () => { p.checkpoint('dropping that goal'); p.deleteGoal(g.goal.id); } });
    h.click('[data-ui="confirm-yes"]');
    await h.settle();
    expect(p.goalById(g.goal.id)).toBeUndefined();
    p.undo();
    expect(p.goalById(g.goal.id)).toBeTruthy();
  });

  it('the scheduling row saves a date, a time and all-day', async () => {
    const g = makeGoal(p, { title: 'slot me' });
    p.openGoal(g.goal.id);
    h.click(`[data-ge="sched"][data-s="${g.step.id}"]`);
    h.type('.schd', p.addDays(p.today(), 2));
    h.type('.schtm', '11:15');
    h.click('[data-ge="sched-save"]');
    await h.settle();

    const ev = p.eventById(p.currentStep(p.threadById(g.goal.id, g.thread.id)).eventId);
    expect(ev.dateKey).toBe(p.addDays(p.today(), 2));
    expect(ev.start).toBe(11 * 60 + 15);
  });

  it('marking a thread blocked opens a field, with a fallback', async () => {
    const g = makeGoal(p, { title: 'block me' });
    p.openGoal(g.goal.id);
    h.click(`[data-ge="block"][data-t="${g.thread.id}"]`);
    h.click('[data-ge="block-save"]');
    await h.settle();
    expect(g.thread.status).toBe('blocked');
    expect(g.thread.blockedOn).toBe('someone');
  });

  it('a branch needs both halves', () => {
    const g = makeGoal(p, { title: 'branchy', rel: 'conditional' });
    p.openGoal(g.goal.id);
    h.type(`.brif[data-t="${g.thread.id}"]`, 'it passes');
    h.click(`[data-ge="branch-add"][data-t="${g.thread.id}"]`);
    expect(h.lastToast()).toMatch(/both halves/i);
    expect(g.thread.branches.length).toBe(0);

    h.type(`.brthen[data-t="${g.thread.id}"]`, 'file the cert');
    h.click(`[data-ge="branch-add"][data-t="${g.thread.id}"]`);
    expect(g.thread.branches).toEqual([{ condition: 'it passes', next: 'file the cert' }]);
  });
});

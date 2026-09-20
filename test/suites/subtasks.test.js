import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const withSubs = (o = {}) => {
  const g = makeGoal(p, { type: 'habit', rel: 'cyclical', ...o });
  g.step.subs = (o.titles || ['one', 'two', 'three']).map(t => p.newSub(t));
  return g;
};

describe('exactly one level [' + TARGET + ']', () => {
  it('a sub never becomes a card and never gets a slot', () => {
    const { step } = withSubs();
    expect(p.activeItems().length).toBe(1);
    expect(p.activeItems()[0].step.id).toBe(step.id);
    for (const s of p.subs(step)) expect(s.eventId).toBeUndefined();
  });

  it('subProgress counts the partial', () => {
    const { step } = withSubs();
    expect(p.subProgress(step)).toMatchObject({ done: 0, total: 3, any: true });
    step.subs[0].done = true;
    expect(p.subProgress(step).frac).toBeCloseTo(1 / 3);
    expect(p.subProgress(p.newStep('bare'))).toMatchObject({ total: 0, frac: 0, any: false });
  });

  it('subs() tolerates a step with no array at all', () => {
    expect(p.subs(null)).toEqual([]);
    expect(p.subs({})).toEqual([]);
  });

  it('addSub refuses blanks and keeps order stable', () => {
    const { goal, thread, step } = withSubs({ titles: [] });
    expect(p.addSub(goal, thread, step, '  ')).toBe(null);
    expect(p.addSub(goal, thread, step, '')).toBe(null);
    p.addSub(goal, thread, step, 'first');
    p.addSub(goal, thread, step, 'second');
    expect(step.subs.map(s => s.title)).toEqual(['first', 'second']);
  });

  it('undone sort above done, stably', () => {
    const { step } = withSubs({ titles: ['a', 'b', 'c', 'd'] });
    step.subs[0].done = true;
    step.subs[2].done = true;
    p.sortSubs(step);
    expect(step.subs.map(s => s.title)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('moveItem reorders and refuses to walk off either end', () => {
    const a = [1, 2, 3];
    expect(p.moveItem(a, 0, 1)).toBe(true);
    expect(a).toEqual([2, 1, 3]);
    expect(p.moveItem(a, 0, -1)).toBe(false);
    expect(p.moveItem(a, 2, 1)).toBe(false);
    expect(a).toEqual([2, 1, 3]);
  });
});

describe('ticking the last one closes the step [' + TARGET + ']', () => {
  it('goes through completeStep, so the successor is generated and logged', async () => {
    const { goal, thread, step } = withSubs({ titles: ['only one'] });
    const r = p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id);
    await h.settle();
    expect(r.completed).toBe(true);
    expect(step.done).toBe(true);
    expect(r.next.title).toContain('Next session');
    expect(p.DB.log.some(l => l.kind === 'done' && l.stepId === step.id)).toBe(true);
  });

  it('re-books a cyclical step exactly as any other route would', () => {
    const { goal, thread, step } = withSubs({ titles: ['only one'] });
    goal.cadenceDays = 2;
    p.CAL.anchor(goal, thread, step, p.today(), 19 * 60, 45);
    const r = p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id);
    expect(p.eventById(r.next.eventId).dateKey).toBe(p.addDays(p.today(), 2));
  });

  it('a partial tick closes nothing', () => {
    const { goal, thread, step } = withSubs();
    expect(p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id).completed).toBe(false);
    expect(step.done).toBe(false);
  });

  it('unticking is undoable and never closes the step', async () => {
    const { goal, thread, step } = withSubs({ titles: ['one', 'two'] });
    p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id);
    await h.settle();
    const sub = p.subs(step).find(s => s.done);
    p.toggleSub(goal.id, thread.id, step.id, sub.id);
    await h.settle();
    expect(p.subs(step).every(s => !s.done)).toBe(true);
    expect(p.UNDO.length).toBe(2);
  });

  it('each tick is one undo step', async () => {
    const { goal, thread, step } = withSubs({ titles: ['one'] });
    p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id);
    await h.settle();
    expect(p.UNDO.length).toBe(1);
    p.undo();
    // undo() swaps the whole object graph, so everything is re-found by id
    const after = p.currentStep(p.threadById(goal.id, thread.id));
    expect(after.done).toBe(false);
    expect(after.subs[0].done).toBe(false);
  });

  it('undo swaps the object graph, so held references go stale — ids are the way back', async () => {
    const { goal, thread, step } = withSubs({ titles: ['one', 'two'] });
    p.toggleSub(goal.id, thread.id, step.id, step.subs[0].id);
    await h.settle();
    p.undo();
    expect(p.goalById(goal.id)).not.toBe(goal);
    expect(p.threadById(goal.id, thread.id)).not.toBe(thread);
    expect(p.goalById(goal.id).title).toBe(goal.title);
  });

  it('a missing step or sub is a no-op', () => {
    expect(p.toggleSub('x', 'y', 'nope', 'nope')).toEqual({});
    const { goal, thread, step } = withSubs();
    expect(p.toggleSub(goal.id, thread.id, step.id, 'not-a-sub')).toEqual({});
  });
});

describe('unfinished subs carry forward [' + TARGET + ']', () => {
  it('open ones ride onto the successor as new records; finished ones stay behind', () => {
    const { goal, thread, step } = withSubs({ titles: ['done one', 'still open', 'also open'] });
    step.subs[0].done = true;
    const r = p.completeStep(goal, thread, step);
    expect(r.carried).toBe(2);
    expect(step.subs.map(s => s.title)).toEqual(['done one']);
    expect(r.next.subs.map(s => s.title)).toEqual(['still open', 'also open']);
    expect(r.next.subs[0].id).not.toBe(step.subs[0].id);
    expect(r.next.subs.every(s => !s.done)).toBe(true);
  });

  it('carries nothing when everything was finished', () => {
    const { goal, thread, step } = withSubs({ titles: ['a'] });
    step.subs[0].done = true;
    const r = p.completeStep(goal, thread, step);
    expect(r.carried).toBe(0);
    expect(r.next.subs).toEqual([]);
  });

  it('nothing is carried when there is no successor to carry onto', () => {
    const { goal, thread, step } = withSubs({ type: 'deadline', rel: 'sequential', titles: ['open'] });
    const r = p.completeStep(goal, thread, step);
    expect(r.needsDefine).toBe(true);
    expect(step.subs.map(s => s.title)).toEqual(['open']);
  });
});

describe('partial progress moves the quarter bar [' + TARGET + ']', () => {
  it('a half-ticked checklist counts as a fraction of a step', () => {
    const { goal, step } = withSubs({ type: 'milestone', rel: 'sequential', titles: ['a', 'b', 'c', 'd'] });
    expect(p.partialCount(goal)).toBe(0);
    step.subs[0].done = true;
    step.subs[1].done = true;
    expect(p.partialCount(goal)).toBeCloseTo(0.5);
  });

  it('subtasks do not inflate a goal that tracks a real number', () => {
    const { goal, step } = withSubs({ type: 'threshold', rel: 'cyclical', titles: ['a', 'b'] });
    goal.smart.target = 100; goal.smart.current = 25;
    step.subs[0].done = true;
    p.DB.meta.zoom = 'quarter'; p.render();
    const band = h.$('.band .prog');
    expect(band.getAttribute('style')).toContain('width:25%');
  });

  it('doneCount counts closed steps across every thread', () => {
    const { goal, thread } = makeGoal(p);
    thread.steps.unshift(p.newStep('a', { done: true }), p.newStep('b', { done: true }));
    expect(p.doneCount(goal)).toBe(2);
  });
});

describe('floating a sub [' + TARGET + ']', () => {
  it('moves it to the head of the checklist without changing anything else', () => {
    const { step } = withSubs({ titles: ['a', 'b', 'c'] });
    const target = step.subs[2];
    expect(p.floatSub(step, target.id)).toBe(true);
    expect(step.subs.map(s => s.title)).toEqual(['c', 'a', 'b']);
    expect(step.subs.length).toBe(3);
    expect(step.subs.every(s => !s.done)).toBe(true);
  });

  it('a done sub floated still sorts below the open ones', () => {
    const { step } = withSubs({ titles: ['a', 'b', 'c'] });
    step.subs[2].done = true;
    p.floatSub(step, step.subs[2].id);
    expect(p.subs(step).map(s => s.title)).toEqual(['a', 'b', 'c']);
  });

  it('an unknown id is a no-op', () => {
    const { step } = withSubs();
    expect(p.floatSub(step, 'nope')).toBe(false);
  });
});

describe('on the card and in the list [' + TARGET + ']', () => {
  it('the card shows an n/m pill that expands the checklist in place', () => {
    const { step } = withSubs();
    step.subs[0].done = true;
    p.DB.meta.zoom = 'day'; p.render();
    const pill = h.$('.card .subpill');
    expect(pill.textContent).toContain('1/3');
    expect(h.$('.card .cardsubs')).toBe(null);

    h.click(pill);
    expect(h.$('.card .cardsubs')).toBeTruthy();
    expect(h.$$('.card .cardsubs .subline').length).toBe(3);

    h.click('.card .subpill');
    expect(h.$('.card .cardsubs')).toBe(null);
  });

  it('the pill reads full when everything is ticked', () => {
    const { step } = withSubs({ titles: ['a'] });
    step.subs[0].done = true;
    step.done = false;
    p.DB.meta.zoom = 'day'; p.render();
    expect(h.$('.card .subpill').classList.contains('full')).toBe(true);
  });

  it('a step with no subs shows no pill', () => {
    makeGoal(p, { type: 'habit', rel: 'cyclical' });
    p.DB.meta.zoom = 'day'; p.render();
    expect(h.$('.card .subpill')).toBe(null);
  });

  it('a list row expands and ticks its checklist where it sits', async () => {
    const { step } = withSubs({ titles: ['a', 'b'] });
    p.DB.meta.zoom = 'list'; p.render();
    h.click('.lrow .subpill');
    expect(h.$$('.lrow .lsubs .subline').length).toBe(2);

    h.click('.lrow .lsubs .subchk');
    await h.settle();
    expect(p.subs(step).filter(s => s.done).length).toBe(1);
  });

  it('the checkbox is a checkbox for a keyboard, not a drag handle', () => {
    withSubs();
    p.DB.meta.zoom = 'day'; p.render();
    h.click('.card .subpill');
    const box = h.$('.card .subchk');
    expect(box.getAttribute('role')).toBe('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.getAttribute('tabindex')).toBe('0');
  });
});

describe('editing subs in the goal editor [' + TARGET + ']', () => {
  it('renames in place, ignoring blanks, one edit as one undo step', async () => {
    const { goal, step } = withSubs({ titles: ['original'] });
    p.openGoal(goal.id);
    const field = h.$('.subtitle');
    h.change(field, 'renamed');
    await h.settle();
    expect(p.subs(step)[0].title).toBe('renamed');
    expect(p.UNDO.length).toBe(1);

    h.change(h.$('.subtitle'), '   ');
    await h.settle();
    expect(p.subs(step)[0].title).toBe('renamed');
  });

  it('reorders both ways and deletes', async () => {
    const { goal, step } = withSubs({ titles: ['a', 'b', 'c'] });
    p.openGoal(goal.id);
    h.click('[data-ge="sub-down"][data-i="0"]');
    await h.settle();
    expect(p.subs(step).map(s => s.title)).toEqual(['b', 'a', 'c']);

    h.click('[data-ge="sub-up"][data-i="2"]');
    await h.settle();
    expect(p.subs(step).map(s => s.title)).toEqual(['b', 'c', 'a']);

    h.click('[data-ge="sub-del"]');
    await h.settle();
    expect(p.subs(step).map(s => s.title)).toEqual(['c', 'a']);
  });

  it('the inline field adds without a dialog and keeps focus for the next one', async () => {
    h.forbidNatives();
    const { goal, step } = withSubs({ titles: [] });
    p.openGoal(goal.id);
    const field = h.$('.newin[data-new="sub"]');
    field.value = 'first new sub';
    h.key(field, 'Enter');
    await h.settle();
    expect(p.subs(step).map(s => s.title)).toEqual(['first new sub']);
    const again = h.$('.newin[data-new="sub"]');
    expect(h.document.activeElement).toBe(again);
    expect(again.value).toBe('');
  });

  it('a blank inline add does nothing at all', async () => {
    const { goal, step } = withSubs({ titles: [] });
    p.openGoal(goal.id);
    const field = h.$('.newin[data-new="sub"]');
    field.value = '   ';
    h.key(field, 'Enter');
    await h.settle();
    expect(p.subs(step)).toEqual([]);
    expect(p.UNDO.length).toBe(0);
  });

  it('the footer says what ticking the last one will do', () => {
    const { goal, step } = withSubs({ titles: ['a', 'b'] });
    step.subs[0].done = true;
    p.openGoal(goal.id);
    expect(h.$('.subfoot').textContent).toContain('1/2 done');
    step.subs[1].done = true;
    p.refreshGoal(goal.id);
    expect(h.$('.subfoot').textContent).toContain('ticking the last one closes the step');
  });
});

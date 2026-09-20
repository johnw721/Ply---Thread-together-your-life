import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const at = z => { p.DB.meta.zoom = z; p.render(); };

/* jsdom has no layout, so the geometry is declared rather than measured: aim()
   says what elementFromPoint should return and rect() gives a target a size.
   The handler logic is what these cover; the hit-testing itself is not testable
   here, which the README has always said. */
function drag(from, to, { x = 500, y = 300, pointerType = 'mouse', grip = false, cancel = false } = {}){
  const start = grip ? from.querySelector('.grip') || from : from;
  h.aim(to);
  h.pointer(start, 'pointerdown', { clientX: 0, clientY: 0, pointerType });
  h.pointer(start, 'pointermove', { clientX: 20, clientY: 20, pointerType });   // past the 6px threshold
  h.pointer(start, 'pointermove', { clientX: x, clientY: y, pointerType });
  if (cancel){ h.key(h.document, 'Escape'); return; }
  h.pointer(start, 'pointerup', { clientX: x, clientY: y, pointerType });
}

describe('dragging between quadrants [' + TARGET + ']', () => {
  it('a mouse drag re-files the card', async () => {
    const g = makeGoal(p, { title: 'move me', step: 'a step', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');

    drag(h.$('.card'), h.$('.quad[data-quad="q1"]'));
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q1');
    expect(h.lastToast()).toMatch(/moved to do now/i);
  });

  it('one drag is one undo step', async () => {
    const g = makeGoal(p, { title: 'move me', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    drag(h.$('.card'), h.$('.quad[data-quad="q3"]'));
    await h.settle();
    expect(p.UNDO.length).toBe(1);
    p.undo();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');
  });

  it('a move under 6px stays a tap and changes nothing', async () => {
    const g = makeGoal(p, { title: 'tap me', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');

    const card = h.$('.card');
    h.aim(h.$('.quad[data-quad="q1"]'));
    h.pointer(card, 'pointerdown', { clientX: 0, clientY: 0 });
    h.pointer(card, 'pointermove', { clientX: 3, clientY: 3 });
    h.pointer(card, 'pointerup', { clientX: 3, clientY: 3 });
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');
    expect(p.UNDO.length).toBe(0);
  });

  it('Escape cancels mid-flight', async () => {
    const g = makeGoal(p, { title: 'cancel me', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    drag(h.$('.card'), h.$('.quad[data-quad="q1"]'), { cancel: true });
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');
    expect(h.$('#dragGhost')).toBe(null);
  });

  it('dropping on the quadrant it already sits in changes nothing', async () => {
    const g = makeGoal(p, { title: 'stay', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    drag(h.$('.card'), h.$('.quad[data-quad="q2"]'));
    await h.settle();
    expect(p.UNDO.length).toBe(0);
  });

  it('a drop on nothing changes nothing', async () => {
    const g = makeGoal(p, { title: 'nowhere', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    drag(h.$('.card'), null);
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');
    expect(p.UNDO.length).toBe(0);
  });

  it('touch needs the grip; the card body alone does not start a drag', async () => {
    const g = makeGoal(p, { title: 'touch me', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');

    drag(h.$('.card'), h.$('.quad[data-quad="q1"]'), { pointerType: 'touch' });
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');

    drag(h.$('.card'), h.$('.quad[data-quad="q1"]'), { pointerType: 'touch', grip: true });
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q1');
  });

  it('a checkbox is a control, not a handle', async () => {
    const g = makeGoal(p, { title: 'controls', stepOpts: { quadrant: 'q2' } });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('day');
    const chk = h.$('.card .chk');
    h.aim(h.$('.quad[data-quad="q1"]'));
    h.pointer(chk, 'pointerdown', { clientX: 0, clientY: 0 });
    h.pointer(chk, 'pointermove', { clientX: 40, clientY: 40 });
    h.pointer(chk, 'pointerup', { clientX: 40, clientY: 40 });
    await h.settle();
    expect(p.findStep(g.step.id).step.quadrant).toBe('q2');
  });
});

describe('dragging onto the calendar [' + TARGET + ']', () => {
  const strip = () => { const t = h.$('.track[data-caldrop]'); h.rect(t, { left: 0, width: 1000 }); return t; };

  it('a list row lands at the time it was dropped on, snapped to the quarter hour', async () => {
    const g = makeGoal(p, { title: 'schedule me', step: 'a step' });
    at('list');
    const track = strip();
    drag(h.$('.lrow'), track, { x: 500 });
    await h.settle();

    const ev = p.eventById(p.findStep(g.step.id).step.eventId);
    expect(ev.dateKey).toBe(p.today());
    expect(ev.start % 15).toBe(0);
    expect(ev.start).toBe(p.calMinAt(0.5));
    expect(h.lastToast()).toMatch(/scheduled/i);
  });

  it('it clamps at both edges of the day', async () => {
    const a = makeGoal(p, { title: 'early' });
    at('list');
    drag(h.$('.lrow'), strip(), { x: -200 });
    await h.settle();
    expect(p.eventById(p.findStep(a.step.id).step.eventId).start).toBe(p.CAL_S);

    p.CAL.unanchor(p.findStep(a.step.id).step);
    p.render();
    drag(h.$('.lrow'), strip(), { x: 5000 });
    await h.settle();
    expect(p.eventById(p.findStep(a.step.id).step.eventId).start).toBe(p.CAL_E - 15);
  });

  it('re-slotting does not orphan the old event', async () => {
    const g = makeGoal(p, { title: 'reslot' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    at('list');
    drag(h.$('.lrow'), strip(), { x: 700 });
    await h.settle();
    expect(p.DB.events.length).toBe(1);
  });

  it('it schedules on whichever day the strip is showing', async () => {
    const g = makeGoal(p, { title: 'tomorrow' });
    p.DB.meta.cursor = p.addDays(p.today(), 1);
    at('list');
    drag(h.$('.lrow'), strip(), { x: 400 });
    await h.settle();
    expect(p.eventById(p.findStep(g.step.id).step.eventId).dateKey).toBe(p.addDays(p.today(), 1));
  });

  it('a week column schedules on its own day', async () => {
    const g = makeGoal(p, { title: 'week drop' });
    at('week');
    // an unscheduled step is in the tray under the grid, not in a column yet
    const day = p.addDays(p.startOfWeek(p.today()), 4);
    drag(h.$('.card[data-step]'), h.$(`.daycol[data-day="${day}"]`));
    await h.settle();
    expect(p.eventById(p.findStep(g.step.id).step.eventId).dateKey).toBe(day);
  });

  it('a week chip is a drag source once it has a slot', async () => {
    const g = makeGoal(p, { title: 'all day thing' });
    const ev = p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 0, 1440);
    ev.allDay = true;
    at('week');
    const day = p.addDays(p.startOfWeek(p.today()), 5);
    drag(h.$('.tchip[data-step]'), h.$(`.daycol[data-day="${day}"]`));
    await h.settle();
    expect(p.eventById(p.findStep(g.step.id).step.eventId).dateKey).toBe(day);
  });
});

describe('dragging a subtask [' + TARGET + ']', () => {
  const withSubs = (titles) => {
    const g = makeGoal(p, { title: 'has subs', step: 'the parent step' });
    g.step.subs = titles.map(t => p.newSub(t));
    return g;
  };

  it('schedules the parent and floats that sub to the head, as one undo step', async () => {
    const g = withSubs(['first', 'the bit I am doing']);
    at('list');
    h.click('.lrow .subpill');
    const line = h.$$('.lrow .lsubs .subline')[1];
    const track = h.$('.track[data-caldrop]'); h.rect(track, { left: 0, width: 1000 });

    drag(line, track, { x: 500, grip: true, pointerType: 'touch' });
    await h.settle();

    const step = p.findStep(g.step.id).step;
    expect(step.eventId).toBeTruthy();                       // the PARENT got the slot
    expect(p.subs(step).map(s => s.title)).toEqual(['the bit I am doing', 'first']);
    expect(p.subs(step).length).toBe(2);                     // nothing added or removed
    expect(p.subs(step).every(s => !s.done)).toBe(true);     // and nothing ticked
    expect(h.lastToast()).toContain('the bit I am doing');

    expect(p.UNDO.length).toBe(1);                           // both halves are one undo
    p.undo();
    const after = p.findStep(g.step.id).step;
    expect(after.eventId).toBe(null);
    expect(p.subs(after).map(s => s.title)).toEqual(['first', 'the bit I am doing']);
  });

  it('dropped on a quadrant it re-files the parent instead', async () => {
    const g = withSubs(['one', 'two']);
    p.CAL.anchor(g.goal, g.thread, g.step, p.today(), 9 * 60, 45);
    g.step.quadrant = 'q2';
    at('day');
    h.click('.card .subpill');
    const line = h.$$('.card .cardsubs .subline')[1];

    drag(line, h.$('.quad[data-quad="q1"]'), { grip: true, pointerType: 'touch' });
    await h.settle();
    const step = p.findStep(g.step.id).step;
    expect(step.quadrant).toBe('q1');
    expect(p.subs(step)[0].title).toBe('two');
  });

  it('the subtask checkbox still ticks rather than dragging', async () => {
    const g = withSubs(['one', 'two']);
    at('list');
    h.click('.lrow .subpill');
    h.click('.lrow .lsubs .subchk');
    await h.settle();
    expect(p.subs(p.findStep(g.step.id).step).filter(s => s.done).length).toBe(1);
  });
});

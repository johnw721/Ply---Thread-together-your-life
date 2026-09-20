import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, makeGoal } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

describe('CAL adapter contract [' + TARGET + ']', () => {
  it('exposes the five methods a provider has to implement', () => {
    for (const m of ['list', 'on', 'anchor', 'loadOn', 'loadWeek'])
      expect(typeof p.CAL[m]).toBe('function');
    expect(p.CAL.provider).toBe('local');
    expect(p.CAL.writable).toBe(true);
  });

  it('anchor() creates the event, links the step both ways and logs it planned', () => {
    const { goal, thread, step } = makeGoal(p);
    const ev = p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    expect(step.eventId).toBe(ev.id);
    expect(ev.stepId).toBe(step.id);
    expect(ev.goalId).toBe(goal.id);
    expect(ev.threadId).toBe(thread.id);
    expect(ev.dur).toBe(45);
    expect(p.DB.log.some(l => l.kind === 'planned' && l.stepId === step.id)).toBe(true);
  });

  it('re-anchoring replaces the old slot rather than orphaning it', () => {
    const { goal, thread, step } = makeGoal(p);
    const first = p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    const second = p.CAL.anchor(goal, thread, step, p.addDays(p.today(), 1), 10 * 60, 45);
    expect(p.DB.events.length).toBe(1);
    expect(p.DB.events[0].id).toBe(second.id);
    expect(p.eventById(first.id)).toBe(null);
  });

  it('unanchor() clears both sides', () => {
    const { goal, thread, step } = makeGoal(p);
    p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    p.CAL.unanchor(step);
    expect(step.eventId).toBe(null);
    expect(p.DB.events.length).toBe(0);
  });

  it('list() walks a range and expands repeats', () => {
    p.addEvent(p.newEvent({ title: 'Standup', dateKey: p.today(), start: 9 * 60, dur: 30,
      recur: { every: 1, until: p.addDays(p.today(), 10) } }));
    const out = p.CAL.list(p.today(), p.addDays(p.today(), 4));
    expect(out.length).toBe(5);
    expect(new Set(out.map(e => e.dateKey)).size).toBe(5);
  });

  it('on() returns a day sorted by start time', () => {
    p.addEvent(p.newEvent({ title: 'late', dateKey: p.today(), start: 15 * 60 }));
    p.addEvent(p.newEvent({ title: 'early', dateKey: p.today(), start: 8 * 60 }));
    expect(p.CAL.on(p.today()).map(e => e.title)).toEqual(['early', 'late']);
  });
});

describe('repeating events [' + TARGET + ']', () => {
  const series = (p, o = {}) => p.addEvent(p.newEvent({
    title: 'Standup', dateKey: p.today(), start: 9 * 60, dur: 30,
    recur: { every: 7, until: null }, ...o }));

  it('one master expands into occurrences at read time', () => {
    series(p);
    expect(p.DB.events.length).toBe(1);
    expect(p.eventsOn(p.addDays(p.today(), 7)).length).toBe(1);
    expect(p.eventsOn(p.addDays(p.today(), 3)).length).toBe(0);
  });

  it('occursOn respects the start, the cadence and the until date', () => {
    const e = series(p, { recur: { every: 7, until: p.addDays(p.today(), 14) } });
    expect(p.occursOn(e, p.addDays(p.today(), -7))).toBe(false);
    expect(p.occursOn(e, p.addDays(p.today(), 7))).toBe(true);
    expect(p.occursOn(e, p.addDays(p.today(), 14))).toBe(true);
    expect(p.occursOn(e, p.addDays(p.today(), 21))).toBe(false);
  });

  it('a non-repeating event occurs only on its own day', () => {
    const e = p.newEvent({ dateKey: p.today() });
    expect(p.occursOn(e, p.today())).toBe(true);
    expect(p.occursOn(e, p.addDays(p.today(), 1))).toBe(false);
  });

  it('an occurrence carries a virtual id; the head returns the real object', () => {
    const e = series(p);
    const later = p.eventsOn(p.addDays(p.today(), 7))[0];
    expect(later.virtual).toBe(true);
    expect(later.id).toBe(e.id + '@' + p.addDays(p.today(), 7));
    expect(later.master).toBe(e.id);
    const head = p.eventsOn(p.today())[0];
    expect(head).toBe(e);
    expect(head.virtual).toBeUndefined();
  });

  it('eventById and masterEvent both resolve a virtual id', () => {
    const e = series(p);
    const vid = e.id + '@' + p.addDays(p.today(), 7);
    expect(p.masterEvent(vid).id).toBe(e.id);
    expect(p.eventById(vid).dateKey).toBe(p.addDays(p.today(), 7));
    expect(p.eventById('nope')).toBe(null);
    expect(p.eventById(null)).toBe(null);
  });

  it('skipping one occurrence drops that date and leaves the series alone', () => {
    const e = series(p);
    const k = p.addDays(p.today(), 7);
    p.skipOccurrence(e.id + '@' + k);
    expect(e.skips).toContain(k);
    expect(p.eventsOn(k).length).toBe(0);
    expect(p.eventsOn(p.addDays(p.today(), 14)).length).toBe(1);
  });

  it('skipping the head walks the series forward instead', () => {
    const e = series(p);
    p.skipOccurrence(e.id);
    expect(e.dateKey).toBe(p.addDays(p.today(), 7));
    expect(p.eventsOn(p.today()).length).toBe(0);
  });

  it('skipping the head past the until date removes the series', () => {
    const e = series(p, { recur: { every: 7, until: p.addDays(p.today(), 3) } });
    p.skipOccurrence(e.id);
    expect(p.DB.events.length).toBe(0);
  });

  it('a zero cadence cannot loop forever', () => {
    const e = p.addEvent(p.newEvent({ dateKey: p.today(), recur: { every: 0, until: null } }));
    expect(() => p.skipOccurrence(e.id)).not.toThrow();
    expect(p.DB.events.length).toBe(1);
  });

  it('removing an event clears the step anchor that pointed at it', () => {
    const { goal, thread, step } = makeGoal(p);
    const ev = p.CAL.anchor(goal, thread, step, p.today(), 9 * 60, 45);
    p.removeEvent(ev.id);
    expect(step.eventId).toBe(null);
    expect(p.DB.events.length).toBe(0);
  });
});

describe('a day has a ceiling [' + TARGET + ']', () => {
  it('loadOn sums the day; all-day items are exempt', () => {
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 9 * 60, dur: 60 }));
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 11 * 60, dur: 90 }));
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 0, dur: 1440, allDay: true }));
    expect(p.CAL.loadOn(p.today())).toBe(150);
  });

  it('loadWeek sums seven days from the start key', () => {
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 9 * 60, dur: 60 }));
    p.addEvent(p.newEvent({ dateKey: p.addDays(p.today(), 6), start: 9 * 60, dur: 30 }));
    p.addEvent(p.newEvent({ dateKey: p.addDays(p.today(), 7), start: 9 * 60, dur: 999 }));
    expect(p.CAL.loadWeek(p.today())).toBe(90);
  });

  it('loadState reports the budget, the percentage and whether it is over', () => {
    p.DB.meta.dayBudgetMins = 240;
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 9 * 60, dur: 120 }));
    const L = p.loadState(p.today());
    expect(L).toMatchObject({ mins: 120, budget: 240, pct: 50, over: false, free: 120 });
    p.addEvent(p.newEvent({ dateKey: p.today(), start: 13 * 60, dur: 180 }));
    const over = p.loadState(p.today());
    expect(over.over).toBe(true);
    expect(over.free).toBe(0);
  });

  it('the day budget has a floor of 30 minutes', () => {
    p.DB.meta.dayBudgetMins = 0;
    expect(p.dayBudget()).toBe(240);
    p.DB.meta.dayBudgetMins = 5;
    expect(p.dayBudget()).toBe(30);
  });

  it('the load bar is empty on an empty day unless forced', () => {
    expect(p.loadBar(p.today())).toBe('');
    expect(p.loadBar(p.today(), { always: true })).toContain('loadbar');
  });

  it('suggestDay fills the first day with room rather than the emptiest', () => {
    const { goal } = makeGoal(p, { type: 'habit' });
    goal.cadenceDays = 4;
    const first = p.addDays(p.today(), 2);
    // fill the first candidate day right up, leave the next one with room
    p.addEvent(p.newEvent({ dateKey: first, start: 8 * 60, dur: 230 }));
    p.addEvent(p.newEvent({ dateKey: p.addDays(first, 1), start: 8 * 60, dur: 100 }));
    const pick = p.suggestDay({ goal, quadrant: 'q2' }, 45);
    expect(pick).toBe(p.addDays(first, 1));
  });

  it('suggestDay never books past a hard deadline', () => {
    const { goal } = makeGoal(p, { type: 'deadline' });
    goal.cadenceDays = 10;
    goal.smart.deadline = p.addDays(p.today(), 1);
    expect(p.suggestDay({ goal, quadrant: 'q2' }, 45)).toBe(p.addDays(p.today(), 1));
  });

  it('suggestTime is chosen by quadrant', () => {
    expect(p.suggestTime({ quadrant: 'q1' })).toBe('09:00');
    expect(p.suggestTime({ quadrant: 'q2' })).toBe('19:00');
    expect(p.suggestTime({ quadrant: 'q3' })).toBe('12:00');
    expect(p.suggestTime({ quadrant: 'q4' })).toBe('17:00');
  });

  it('the strip maps a fraction of the track to a quarter-hour, clamped to the day', () => {
    expect(p.calMinAt(0)).toBe(p.CAL_S);
    expect(p.calMinAt(1)).toBe(p.CAL_E - 15);
    expect(p.calMinAt(-5)).toBe(p.CAL_S);
    expect(p.calMinAt(0.5) % 15).toBe(0);
    expect(p.calPos(p.CAL_S)).toBe(0);
    expect(p.calPos(p.CAL_E)).toBe(100);
  });
});

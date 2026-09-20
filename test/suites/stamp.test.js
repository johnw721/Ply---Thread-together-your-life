import { describe, it, expect, beforeEach } from 'vitest';
import { boot, makeGoal, TARGET } from '../harness.js';

/* Schema 8: every goal, thread, step and event carries an `updatedAt`, and
   save() — not the mutation sites — is what maintains it. These tests exist
   because the failure mode of a missed stamp is silent: the record simply
   loses every cross-device merge and the other copy quietly wins. */

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

/* the app stamps with ISO strings at whole-millisecond resolution, so two
   saves inside the same tick can legitimately share a stamp — advance past it */
const tick = () => new Promise(r => setTimeout(r, 2));

describe('migrate 7→8 — backfill [' + TARGET + ']', () => {
  const file = () => ({
    schema: 7, log: [], meta: {},
    goals: [{ id: 'g1', title: 'a goal', status: 'active', doneAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      threads: [{ id: 't1', status: 'active', lastMovement: '2026-03-04T00:00:00.000Z',
        steps: [{ id: 's1', title: 'a step', done: false, doneAt: null,
                  createdAt: '2026-02-03T00:00:00.000Z', subs: [] }] }] }],
    events: [{ id: 'e1', title: 'x', dateKey: '2026-01-01', start: 540, dur: 60,
               src: 'manual', recur: null, skips: [], gcal: null }]
  });

  it('takes each record’s stamp from what it already knew about its own age', () => {
    const d = file();
    expect(p.migrate(d).ok).toBe(true);
    expect(d.goals[0].updatedAt).toBe('2026-01-02T00:00:00.000Z');       // createdAt
    expect(d.goals[0].threads[0].updatedAt).toBe('2026-03-04T00:00:00.000Z'); // lastMovement
    expect(d.goals[0].threads[0].steps[0].updatedAt).toBe('2026-02-03T00:00:00.000Z');
  });

  it('is a pure function of the file, so two devices upgrading it agree', () => {
    const a = file(), b = file();
    p.migrate(a); p.migrate(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never stamps a migration with now() — an upgrade is not a change', () => {
    const d = file();
    p.migrate(d);
    const now = Date.now();
    for (const s of [d.goals[0].updatedAt, d.goals[0].threads[0].updatedAt]) {
      expect(now - Date.parse(s)).toBeGreaterThan(1000);
    }
  });

  it('floors an unrecoverable age at the epoch, so unknown loses a merge', () => {
    const d = { schema: 7, log: [], meta: {}, events: [],
      goals: [{ id: 'g', title: 'no dates', threads: [{ id: 't', steps: [{ id: 's', subs: [] }] }] }] };
    p.migrate(d);
    expect(d.goals[0].updatedAt).toBe(p.EPOCH);
    expect(d.goals[0].threads[0].steps[0].updatedAt).toBe(p.EPOCH);
    expect(Date.parse(p.EPOCH)).toBe(0);
  });

  it('takes a mirrored event’s stamp from Google when it has one', () => {
    const d = file();
    d.events[0].gcal = { id: 'gg', etag: null, updated: '2026-05-06T00:00:00.000Z',
                         cal: 'primary', own: false, status: 'confirmed', link: null, pending: false };
    p.migrate(d);
    expect(d.events[0].updatedAt).toBe('2026-05-06T00:00:00.000Z');
  });

  it('coerces whatever the file claimed into something comparable', () => {
    const d = { schema: 8, log: [], meta: {}, events: [{ id: 'e', updatedAt: { nope: 1 } }],
      goals: [{ id: 'g', updatedAt: 1234, threads: [{ id: 't', updatedAt: null,
        steps: [{ id: 's', subs: [], updatedAt: [] }] }] }] };
    p.migrate(d);
    expect(typeof d.goals[0].updatedAt).toBe('string');
    expect(d.goals[0].updatedAt).toBe(p.EPOCH);
    expect(d.goals[0].threads[0].updatedAt).toBe(p.EPOCH);
    expect(d.goals[0].threads[0].steps[0].updatedAt).toBe(p.EPOCH);
    expect(d.events[0].updatedAt).toBe(p.EPOCH);
  });
});

describe('factories [' + TARGET + ']', () => {
  it('stamp every record kind at birth', () => {
    for (const rec of [p.newGoal({}), p.newThread({}), p.newStep('x'), p.newEvent({})]) {
      expect(typeof rec.updatedAt).toBe('string');
      expect(Date.now() - Date.parse(rec.updatedAt)).toBeLessThan(5000);
    }
  });

  it('leaves subs unstamped — a sub is part of its step, not a record', () => {
    expect(p.newSub('x')).not.toHaveProperty('updatedAt');
  });
});

describe('save() maintains the stamps [' + TARGET + ']', () => {
  it('stamps only the record that actually moved', async () => {
    const one = makeGoal(p, { title: 'one' });
    const two = makeGoal(p, { title: 'two' });
    p.save();
    const before = two.goal.updatedAt;
    await tick();
    one.goal.title = 'one, renamed';
    p.save();
    expect(one.goal.updatedAt).not.toBe(before);
    expect(two.goal.updatedAt).toBe(before);   // untouched stays untouched
  });

  it('does not cascade: a step edit leaves its thread and goal alone', async () => {
    const { goal, thread, step } = makeGoal(p, { title: 'parent' });
    p.save();
    const g0 = goal.updatedAt, t0 = thread.updatedAt;
    await tick();
    step.title = 'moved';
    p.save();
    expect(step.updatedAt).not.toBe(t0);
    expect(thread.updatedAt).toBe(t0);
    expect(goal.updatedAt).toBe(g0);
  });

  it('does cascade to the step when a sub moves, because subs ride with it', async () => {
    const { step } = makeGoal(p, { title: 'with subs' });
    step.subs.push(p.newSub('a sub'));
    p.save();
    const s0 = step.updatedAt;
    await tick();
    step.subs[0].done = true;
    p.save();
    expect(step.updatedAt).not.toBe(s0);
  });

  it('stamps a record that is new since the last write', async () => {
    p.save();
    await tick();
    const fresh = makeGoal(p, { title: 'arrived late' });
    fresh.goal.updatedAt = p.EPOCH;            // pretend it arrived unstamped
    p.save();
    expect(fresh.goal.updatedAt).not.toBe(p.EPOCH);
  });

  it('stamps nothing when nothing changed', async () => {
    const { goal } = makeGoal(p, { title: 'still' });
    p.save();
    const was = goal.updatedAt;
    await tick();
    p.save(); p.save();
    expect(goal.updatedAt).toBe(was);
  });

  it('survives a record being deleted out from under the shadow', async () => {
    const { goal } = makeGoal(p, { title: 'doomed' });
    p.save();
    await tick();
    p.deleteGoal(goal.id);
    expect(() => p.save()).not.toThrow();
    expect(p.DB.goals.length).toBe(0);
  });

  it('stamps events too', async () => {
    const e = p.addEvent(p.newEvent({ title: 'a thing' }));
    p.save();
    const was = e.updatedAt;
    await tick();
    e.title = 'a renamed thing';
    p.save();
    expect(e.updatedAt).not.toBe(was);
  });
});

describe('who owns a stamp [' + TARGET + ']', () => {
  it('load() treats what was stored as already written, not as a change', async () => {
    const old = JSON.stringify({
      schema: p.SCHEMA, log: [], events: [], meta: {},
      goals: [{ id: 'g1', title: 'stored', status: 'active', doneAt: null, threads: [],
                createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]
    });
    const t = await boot({ seed: null, stored: old });
    t.api.save();
    expect(t.api.DB.goals[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    t.close && t.close();
  });

  it('a remote adoption keeps the other writer’s stamps', async () => {
    makeGoal(p, { title: 'mine' });
    p.save();
    const theirs = JSON.parse(JSON.stringify(p.DB));
    theirs.goals[0].title = 'theirs';
    theirs.goals[0].updatedAt = '2026-04-05T00:00:00.000Z';
    await tick();
    p.adoptExternal(theirs);
    p.save();
    expect(p.DB.goals[0].title).toBe('theirs');
    expect(p.DB.goals[0].updatedAt).toBe('2026-04-05T00:00:00.000Z');
  });

  it('an undo re-stamps, because pressing ⌘Z is a decision the merge should honour', async () => {
    const { goal } = makeGoal(p, { title: 'original' });
    p.save();
    await h.settle();
    const was = goal.updatedAt;
    await tick();
    p.checkpoint('a rename');
    p.goalById(goal.id).title = 'renamed';
    p.save();
    await h.settle();
    await tick();
    p.undo();
    expect(p.DB.goals[0].title).toBe('original');
    expect(p.DB.goals[0].updatedAt).not.toBe(was);   // the revert is itself a write
  });
});

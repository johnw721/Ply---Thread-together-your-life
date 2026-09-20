import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

describe('migrate — accept and refuse [' + TARGET + ']', () => {
  it('refuses anything that is not a Ply export', () => {
    expect(p.migrate(null).ok).toBe(false);
    expect(p.migrate('nope').ok).toBe(false);
    expect(p.migrate({}).ok).toBe(false);
    expect(p.migrate({ goals: 'not an array' }).ok).toBe(false);
    expect(p.migrate({ goals: [] }).ok).toBe(true);
  });

  it('refuses a file from a newer build instead of half-loading it', () => {
    const r = p.migrate({ goals: [], schema: p.SCHEMA + 1 });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/newer version/i);
  });

  it('reports the schema it came from', () => {
    expect(p.migrate({ goals: [], schema: 2 }).from).toBe(2);
    expect(p.migrate({ goals: [], v: 1 }).from).toBe(1);
  });

  it('backfills every top-level and meta field added since', () => {
    const d = { goals: [], schema: 1 };
    p.migrate(d);
    const blank = p.blankDB();
    for (const k of Object.keys(blank)) expect(d).toHaveProperty(k);
    for (const k of Object.keys(blank.meta)) expect(d.meta).toHaveProperty(k);
  });

  it('1→2 gives every event a recur slot and a skips array', () => {
    const d = { goals: [], schema: 1, events: [{ id: 'e1', dateKey: '2026-01-01' }] };
    p.migrate(d);
    expect(d.events[0]).toHaveProperty('recur', null);
    expect(d.events[0].skips).toEqual([]);
  });

  it('2→3 creates the budget', () => {
    const d = { goals: [], schema: 2 };
    p.migrate(d);
    expect(d.meta.budget).toEqual({ weekly: 0, cats: [] });
  });

  it('3→4 gives every step a subs array', () => {
    const d = { goals: [{ id: 'g', threads: [{ id: 't', steps: [{ id: 's', title: 'x' }] }] }], schema: 3 };
    p.migrate(d);
    expect(d.goals[0].threads[0].steps[0].subs).toEqual([]);
  });

  it('5→6 backfills doneAt, dating a finished goal from its creation', () => {
    const made = '2026-02-02T00:00:00.000Z';
    const d = { goals: [
      { id: 'a', status: 'done', createdAt: made, threads: [] },
      { id: 'b', status: 'active', createdAt: made, threads: [] }
    ], schema: 5 };
    p.migrate(d);
    expect(d.goals[0].doneAt).toBe(made);
    expect(d.goals[1].doneAt).toBe(null);
  });

  it('coerces malformed subs rather than trusting them', () => {
    const d = { goals: [{ id: 'g', threads: [{ id: 't', steps: [
      { id: 's', title: 'x', subs: [null, 'junk', 7, { title: 'real' }, { id: 'keep', title: 'kept', done: true }] }
    ] }] }], schema: 6 };
    p.migrate(d);
    const subs = d.goals[0].threads[0].steps[0].subs;
    expect(subs.length).toBe(2);
    expect(subs[0].title).toBe('real');
    expect(subs[0].id).toBeTruthy();
    expect(subs[1].done).toBe(true);
  });

  it('coerces a malformed budget into shape', () => {
    const d = { goals: [], schema: 6, meta: { budget: { weekly: '250', cats: [null, 'x', { name: 5, amount: 'z' }] } } };
    p.migrate(d);
    expect(d.meta.budget.weekly).toBe(250);
    expect(d.meta.budget.cats.length).toBe(1);
    expect(d.meta.budget.cats[0].amount).toBe(0);
    expect(d.meta.budget.cats[0].id).toBeTruthy();
  });

  it('drops unknown type names out of the list filter', () => {
    const d = { goals: [], schema: 6, meta: { listHidden: ['habit', 'not-a-type', 'task'] } };
    p.migrate(d);
    expect(d.meta.listHidden).toEqual(['habit', 'task']);
  });

  it('strips the envelope fields so they cannot accumulate', () => {
    const d = { goals: [], schema: 6, app: 'ply', exportedAt: 'whenever' };
    p.migrate(d);
    expect(d.app).toBeUndefined();
    expect(d.exportedAt).toBeUndefined();
  });

  it('stamps the current schema on the way out', () => {
    const d = { goals: [], schema: 1 };
    p.migrate(d);
    expect(d.schema).toBe(p.SCHEMA);
  });
});

describe('load [' + TARGET + ']', () => {
  it('adopts data written under the old Thread key and leaves that key in place', async () => {
    const old = JSON.stringify({ schema: 6, goals: [{ id: 'g1', title: 'from Thread', type: 'task',
      status: 'active', threads: [], gates: [], backlog: [], smart: {} }], events: [], log: [], meta: {} });
    const t = await boot({ seed: null, stored: old, key: 'thread.v1' });
    expect(t.api.DB.goals[0].title).toBe('from Thread');
    expect(t.window.localStorage.getItem('ply.v1')).toBeTruthy();
    expect(t.window.localStorage.getItem('thread.v1')).toBe(old);
    t.close();
  });

  it('falls back to a clean DB when stored data is unreadable', async () => {
    const t = await boot({ seed: null, stored: '{{{ not json' });
    expect(Array.isArray(t.api.DB.goals)).toBe(true);
    t.close();
  });

  it('refuses a stored file from a newer build rather than half-loading it', async () => {
    const t = await boot({ seed: null, stored: JSON.stringify({ schema: 99, goals: [{ id: 'x', title: 'from the future' }] }) });
    // load() falls back to a clean DB; boot then seeds the demo set, as a first run does.
    expect(t.api.DB.goals.find(g => g.id === 'x')).toBeUndefined();
    expect(t.api.DB.schema).toBe(t.api.SCHEMA);
    t.close();
  });

  it('prunes expired snoozes on load', async () => {
    // needs at least one goal, or boot() replaces the whole DB with the demo seed
    const stale = JSON.stringify({ schema: 6, events: [], log: [],
      goals: [{ id: 'g1', title: 'keeps the seed away', type: 'task', status: 'active',
        threads: [], gates: [], backlog: [], smart: {} }],
      meta: { snoozed: [{ k: 'quiet:old', until: '2000-01-01' }, { k: 'quiet:live', until: '2099-01-01' }] } });
    const t = await boot({ seed: null, stored: stale });
    expect(t.api.DB.meta.snoozed.map(x => x.k)).toEqual(['quiet:live']);
    t.close();
  });

  it('an empty database is seeded with the demo set on first run', async () => {
    const t = await boot({ seed: null, stored: null });
    expect(t.api.DB.goals.length).toBeGreaterThan(8);
    expect(new Set(t.api.DB.goals.map(g => g.type)).size).toBe(Object.keys(t.api.TYPE).length);
    t.close();
  });
});

describe('export → import round trip [' + TARGET + ']', () => {
  it('survives a full cycle byte-identically', async () => {
    const t = await boot();
    const a = JSON.stringify(t.api.DB);
    const copy = JSON.parse(a);
    expect(t.api.migrate(copy).ok).toBe(true);
    t.api.DB = copy;
    expect(JSON.stringify(t.api.DB)).toBe(a);
    t.close();
  });

  it('a hand-written v1 file migrates and then actually renders', async () => {
    const v1 = {
      v: 1,
      goals: [{ id: 'g1', title: 'Old goal', type: 'milestone', status: 'active',
        smart: { outcome: 'x', target: null, current: 0, deadline: null },
        backlog: [], gates: [], createdAt: '2026-01-01T00:00:00.000Z',
        threads: [{ id: 't1', name: 'Main', rel: 'sequential', status: 'active',
          branches: [], steps: [{ id: 's1', title: 'A step', quadrant: 'q2', done: false }],
          lastMovement: '2026-01-01T00:00:00.000Z' }] }],
      events: [], log: [], meta: {}
    };
    const t = await boot({ seed: null, stored: JSON.stringify(v1) });
    expect(t.api.DB.schema).toBe(t.api.SCHEMA);
    expect(t.api.DB.goals[0].threads[0].steps[0].subs).toEqual([]);
    for (const z of ['day', 'week', 'quarter', 'list']){
      t.api.DB.meta.zoom = z;
      t.api.render();
      expect(t.document.querySelector('#view').innerHTML).toContain('Old goal'.slice(0, 3));
    }
    t.close();
  });
});

describe('undo and redo [' + TARGET + ']', () => {
  it('reverses the last thing that changed data', async () => {
    p.checkpoint('that capture');
    p.addGoal(p.newGoal({ title: 'gone in a moment' }));
    await h.settle();
    expect(p.DB.goals.length).toBe(1);
    p.undo();
    expect(p.DB.goals.length).toBe(0);
    p.redo();
    expect(p.DB.goals.length).toBe(1);
  });

  it('a no-op checkpoint never lands on the stack', async () => {
    p.checkpoint('nothing at all');
    await h.settle();
    expect(p.UNDO.length).toBe(0);
  });

  it('one action that saves three times is still one undo step', async () => {
    p.checkpoint('that multi-save action');
    p.DB.goals.push(p.newGoal({ title: 'a' })); p.save();
    p.DB.goals.push(p.newGoal({ title: 'b' })); p.save();
    p.DB.goals.push(p.newGoal({ title: 'c' })); p.save();
    await h.settle();
    expect(p.UNDO.length).toBe(1);
    p.undo();
    expect(p.DB.goals.length).toBe(0);
  });

  it('nested checkpoints join the outer action', async () => {
    p.checkpoint('outer');
    p.checkpoint('inner');
    p.DB.goals.push(p.newGoal({ title: 'x' }));
    await h.settle();
    expect(p.UNDO.length).toBe(1);
    expect(p.UNDO[0].label).toBe('outer');
  });

  it('the stack is bounded at 25', async () => {
    for (let i = 0; i < 40; i++){
      p.checkpoint('step ' + i);
      p.DB.goals.push(p.newGoal({ title: 'g' + i }));
      await h.settle();
    }
    expect(p.UNDO.length).toBe(25);
  });

  it('this tab keeps its own zoom and cursor across a restore', async () => {
    p.checkpoint('that change');
    p.DB.goals.push(p.newGoal({ title: 'x' }));
    await h.settle();
    p.DB.meta.zoom = 'quarter';
    p.DB.meta.cursor = p.addDays(p.today(), 30);
    const cursor = p.DB.meta.cursor;
    p.undo();
    expect(p.DB.meta.zoom).toBe('quarter');
    expect(p.DB.meta.cursor).toBe(cursor);
  });

  it('a new action clears the redo stack', async () => {
    p.checkpoint('first'); p.DB.goals.push(p.newGoal({ title: 'a' })); await h.settle();
    p.undo();
    expect(p.REDO.length).toBe(1);
    p.checkpoint('second'); p.DB.goals.push(p.newGoal({ title: 'b' })); await h.settle();
    expect(p.REDO.length).toBe(0);
  });

  it('refuses to rewind under an open modal', async () => {
    p.checkpoint('that change'); p.DB.goals.push(p.newGoal({ title: 'x' })); await h.settle();
    p.openModal('<h3>Open</h3>');
    p.undo();
    expect(p.DB.goals.length).toBe(1);
    expect(h.lastToast()).toMatch(/close this first/i);
    p.closeModal();
    p.undo();
    expect(p.DB.goals.length).toBe(0);
  });

  it('says nothing to undo when the stack is empty', () => {
    p.undo();
    expect(h.lastToast()).toMatch(/nothing to undo/i);
    p.redo();
    expect(h.lastToast()).toMatch(/nothing to redo/i);
  });

  it('the header buttons carry the label of what they would reverse', async () => {
    p.checkpoint('that capture'); p.DB.goals.push(p.newGoal({ title: 'x' })); await h.settle();
    expect(h.$('#btnUndo').disabled).toBe(false);
    expect(h.$('#btnUndo').title).toBe('Undo that capture');
    p.undo();
    expect(h.$('#btnRedo').title).toBe('Redo that capture');
  });
});

describe('two tabs [' + TARGET + ']', () => {
  const other = (p, build) => {
    const d = JSON.parse(JSON.stringify(p.blankDB()));
    build(d, p);
    return d;
  };

  it('adopts another tab\'s state, keeping this tab\'s view and clearing undo', async () => {
    p.checkpoint('local'); p.DB.goals.push(p.newGoal({ title: 'mine' })); await h.settle();
    p.DB.meta.zoom = 'week';
    const theirs = other(p, d => d.goals.push(p.newGoal({ title: 'theirs' })));
    p.adoptExternal(theirs);
    expect(p.DB.goals[0].title).toBe('theirs');
    expect(p.DB.meta.zoom).toBe('week');
    expect(p.UNDO.length).toBe(0);
    expect(p.REDO.length).toBe(0);
  });

  it('a storage event from another tab is adopted', () => {
    const theirs = other(p, d => d.goals.push(p.newGoal({ title: 'from the other tab' })));
    fireStorage(h, p.KEY, JSON.stringify(theirs));
    expect(p.DB.goals[0].title).toBe('from the other tab');
  });

  it('ignores a storage event for another key, or with malformed data', () => {
    fireStorage(h, 'something.else', JSON.stringify({ goals: [] }));
    fireStorage(h, p.KEY, '{{{ junk');
    fireStorage(h, p.KEY, JSON.stringify({ not: 'a ply export' }));
    expect(p.DB.goals).toEqual([]);
  });

  it('defers the update while a modal is open, then takes it on close', () => {
    p.openModal('<h3>Mid-edit</h3>');
    const theirs = other(p, d => d.goals.push(p.newGoal({ title: 'deferred' })));
    fireStorage(h, p.KEY, JSON.stringify(theirs));
    expect(p.DB.goals.length).toBe(0);
    expect(h.lastToast()).toMatch(/refreshing when you close/i);
    p.closeModal();
    expect(p.DB.goals[0].title).toBe('deferred');
  });
});

function fireStorage(h, key, newValue){
  const ev = new h.window.Event('storage');
  Object.assign(ev, { key, newValue });
  h.window.dispatchEvent(ev);
}

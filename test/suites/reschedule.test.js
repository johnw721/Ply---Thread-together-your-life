import { describe, it, expect, beforeEach } from 'vitest';
import { boot, makeGoal, TARGET, isLegacy } from '../harness.js';

/* Schema 10: why each anchor happened, and what a pattern of pushes is evidence
   of. Nothing in legacy/index.html to pin — the monolith predates the field. */
const d = isLegacy ? describe.skip : describe;

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

const T = () => p.today();
const D = n => p.addDays(p.today(), n);
/* Every 'planned' row for a step, in order, as {source, dateKey} — the raw trail
   the whole feature is derived from. */
const trail = stepId => p.DB.log.filter(l => l.kind === 'planned' && l.stepId === stepId)
                                .map(l => ({source: l.source, dateKey: l.dateKey}));

d('source tagging — every anchor call site says why [' + TARGET + ']', () => {
  it('cal.anchor() writes the source it was handed onto the planned row', () => {
    const m = makeGoal(p);
    p.CAL.anchor(m.goal, m.thread, m.step, D(1), 9*60, 45, 'drag');
    expect(trail(m.step.id)).toEqual([{source:'drag', dateKey:D(1)}]);
  });

  it('a re-anchor writes a second row, so three pushes leave three rows', () => {
    const m = makeGoal(p);
    p.CAL.anchor(m.goal, m.thread, m.step, D(1), 9*60, 45, 'manual');
    p.CAL.anchor(m.goal, m.thread, m.step, D(2), 9*60, 45, 'drag');
    p.CAL.anchor(m.goal, m.thread, m.step, D(3), 9*60, 45, 'checkin');
    expect(trail(m.step.id).map(x => x.source)).toEqual(['manual','drag','checkin']);
  });

  it('an untagged anchor falls to "unknown" rather than to a plausible guess', () => {
    const m = makeGoal(p);
    p.CAL.anchor(m.goal, m.thread, m.step, D(1), 9*60, 45);
    expect(trail(m.step.id)[0].source).toBe('unknown');
  });

  it('the capture box tags "manual"', () => {
    p.doCapture('Gym on ' + p.fmtDate(D(2)));
    const row = p.DB.log.find(l => l.kind === 'planned');
    if (row) expect(row.source).toBe('manual');
  });

  it('the engine re-booking a cycle tags "auto-cycle", not a human push', () => {
    const m = makeGoal(p, {type:'habit'});
    p.CAL.anchor(m.goal, m.thread, m.step, T(), 19*60, 45, 'manual');
    p.completeStep(m.goal, m.thread, m.step);
    const next = p.currentStep(m.thread);
    expect(trail(next.id)[0].source).toBe('auto-cycle');
  });

  it('a Google-side move is logged as "gcal-pull" so the chain keeps its from-date', () => {
    const m = makeGoal(p);
    p.CAL.anchor(m.goal, m.thread, m.step, D(1), 9*60, 45, 'manual');
    const ev = p.eventById(m.step.eventId);
    ev.gcal = {id:'g1', etag:'e', updated:'2026-01-01T00:00:00.000Z', cal:'primary',
               own:true, status:'confirmed', link:null, pending:false};
    p.gMerge(ev, {title:ev.title, dateKey:D(5), start:ev.start, dur:ev.dur, allDay:false,
      stepId:ev.stepId, goalId:ev.goalId, threadId:ev.threadId,
      gcal:{id:'g1', etag:'e2', updated:'2026-06-01T00:00:00.000Z', cal:'primary',
            own:true, status:'confirmed', link:null}});
    const last = trail(m.step.id).pop();
    expect(last).toEqual({source:'gcal-pull', dateKey:D(5)});
  });

  it('the event editor logs a date move it used to make silently', () => {
    const m = makeGoal(p);
    p.CAL.anchor(m.goal, m.thread, m.step, D(1), 9*60, 45, 'manual');
    const before = trail(m.step.id).length;
    p.openEvent(m.step.eventId);
    const dd = h.$('#evD'); if (!dd) return;
    dd.value = D(6);
    h.click('[data-ui="ev-save"]');
    const rows = trail(m.step.id);
    expect(rows.length).toBe(before + 1);
    expect(rows.pop()).toEqual({source:'manual', dateKey:D(6)});
  });
});

d('history derivation — what counts and what does not [' + TARGET + ']', () => {
  /* A hand-built log, so the walk is tested as the pure function it is rather
     than through whatever the app happens to write today. */
  const log = rows => rows.map((r, i) => ({
    id: 'l' + i, ts: '2026-01-' + String(i + 1).padStart(2, '0') + 'T00:00:00.000Z',
    kind: r.kind || 'planned', stepId: r.stepId || 's1', goalId: r.goalId || 'g1',
    dateKey: r.dateKey, source: r.source
  }));

  it('counts consecutive human pushes and signs the direction', () => {
    const r = p.rescheduleHistory('s1', log([
      {dateKey:'2026-03-01', source:'manual'},
      {dateKey:'2026-03-03', source:'drag'},
      {dateKey:'2026-03-06', source:'checkin'}
    ]));
    expect(r.count).toBe(2);
    expect(r.events.map(e => e.deltaDays)).toEqual([2, 3]);
    expect(r.events[0]).toMatchObject({fromDateKey:'2026-03-01', toDateKey:'2026-03-03'});
  });

  it('a move earlier is negative, so direction is visible and not just volume', () => {
    const r = p.rescheduleHistory('s1', log([
      {dateKey:'2026-03-10', source:'manual'},
      {dateKey:'2026-03-07', source:'manual'}
    ]));
    expect(r.events[0].deltaDays).toBe(-3);
  });

  it('the first anchor is a booking, not a reschedule', () => {
    const r = p.rescheduleHistory('s1', log([{dateKey:'2026-03-01', source:'manual'}]));
    expect(r.count).toBe(0);
  });

  it('auto-cycle, unblock and gcal-pull are not churn', () => {
    for (const src of ['auto-cycle','unblock','gcal-pull']) {
      const r = p.rescheduleHistory('s1', log([
        {dateKey:'2026-03-01', source:'manual'},
        {dateKey:'2026-03-04', source:src}
      ]));
      expect(r.count, src + ' should not count').toBe(0);
    }
  });

  it('"unknown" never counts, but still supplies the from-date for the next push', () => {
    const r = p.rescheduleHistory('s1', log([
      {dateKey:'2026-03-01', source:'unknown'},
      {dateKey:'2026-03-04', source:'unknown'},
      {dateKey:'2026-03-06', source:'manual'}
    ]));
    expect(r.count).toBe(1);
    expect(r.events[0]).toMatchObject({fromDateKey:'2026-03-04', deltaDays:2});
  });

  it('a re-anchor that did not move the date is not a reschedule', () => {
    const r = p.rescheduleHistory('s1', log([
      {dateKey:'2026-03-01', source:'manual'},
      {dateKey:'2026-03-01', source:'manual'},
      {dateKey:'2026-03-03', source:'drag'}
    ]));
    expect(r.count).toBe(1);
    expect(r.events[0].deltaDays).toBe(2);
  });

  it('completing the step starts the history over', () => {
    const rows = log([
      {dateKey:'2026-03-01', source:'manual'},
      {dateKey:'2026-03-04', source:'manual'},
      {kind:'done', dateKey:'2026-03-04'},
      {dateKey:'2026-03-10', source:'manual'},
      {dateKey:'2026-03-12', source:'manual'}
    ]);
    expect(p.rescheduleHistory('s1', rows).count).toBe(1);
    expect(p.rescheduleLifetime('s1', rows).count).toBe(2);
  });

  it('another step’s rows are another step’s business', () => {
    const rows = log([
      {dateKey:'2026-03-01', source:'manual'},
      {dateKey:'2026-03-04', source:'manual', stepId:'s2'}
    ]);
    expect(p.rescheduleHistory('s1', rows).count).toBe(0);
  });
});

d('the durable summary [' + TARGET + ']', () => {
  const push = (m, n, src = 'manual') => {
    for (let i = 1; i <= n; i++) p.CAL.anchor(m.goal, m.thread, m.step, D(i), 9*60, 45, src);
  };

  it('a new goal starts empty and the display line stays silent', () => {
    const m = makeGoal(p);
    expect(m.goal.reschedule).toEqual({count:0, lastAt:null, avgDeltaDays:0});
    expect(p.rescheduleLine(m.goal)).toBe(null);
  });

  it('accumulates at each qualifying anchor, and only those', () => {
    const m = makeGoal(p);
    push(m, 4);
    expect(m.goal.reschedule.count).toBe(3);
    expect(m.goal.reschedule.avgDeltaDays).toBe(1);
    expect(m.goal.reschedule.lastAt).toBeTruthy();
    p.CAL.anchor(m.goal, m.thread, m.step, D(9), 9*60, 45, 'auto-cycle');
    expect(m.goal.reschedule.count, 'auto-cycle must not accumulate').toBe(3);
  });

  it('survives a log trim that erases the rows it came from', () => {
    const m = makeGoal(p);
    push(m, 4);
    const before = {...m.goal.reschedule};
    expect(before.count).toBe(3);
    /* Simulate the 4000-row cap: logIt() trims from the head, so the oldest
       'planned' rows are exactly what a long-lived goal loses first. */
    p.DB.log = p.DB.log.filter(l => l.kind !== 'planned');
    expect(p.rescheduleHistory(m.step.id, p.DB.log).count).toBe(0);
    expect(m.goal.reschedule).toEqual(before);
    expect(p.rescheduleLine(m.goal)).toBe('rescheduled 3× · usually 1 day later');
  });

  it('says which direction, and says nothing extra when the drift rounds to zero', () => {
    const g = p.newGoal({title:'x'});
    g.reschedule = {count:4, lastAt:'2026-03-01T00:00:00.000Z', avgDeltaDays:2};
    expect(p.rescheduleLine(g)).toBe('rescheduled 4× · usually 2 days later');
    g.reschedule.avgDeltaDays = -2;
    expect(p.rescheduleLine(g)).toBe('rescheduled 4× · usually 2 days earlier');
    g.reschedule.avgDeltaDays = 0.2;
    expect(p.rescheduleLine(g)).toBe('rescheduled 4×');
  });
});

d('merge and adopt — re-derived, never three-way-merged [' + TARGET + ']', () => {
  /* The three-way merge from ply-sync-design.md, in the one shape that matters
     here: `log` is an append-only union by id, re-sorted by ts and re-trimmed. */
  const unionLog = (mine, theirs) => {
    const by = new Map();
    for (const l of mine.concat(theirs)) by.set(l.id, l);
    return [...by.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  };
  const row = (id, day, source, stepId = 's1') => ({
    id, ts: '2026-04-' + String(day).padStart(2, '0') + 'T00:00:00.000Z',
    kind: 'planned', goalId: 'g1', stepId, dateKey: '2026-05-' + String(day).padStart(2, '0'), source
  });

  it('two devices each pushing the same step offline both survive the merge', () => {
    const base  = [row('a', 1, 'manual')];
    const mine  = base.concat([row('b', 2, 'manual')]);
    const their = base.concat([row('c', 3, 'drag')]);
    /* A plain counter under LWW would take one side's 1 and drop the other's. */
    const merged = {goals:[{id:'g1', reschedule:{count:1, lastAt:null, avgDeltaDays:9}}],
                    log: unionLog(mine, their)};
    p.recomputeAllReschedule(merged);
    expect(merged.goals[0].reschedule.count).toBe(2);
    expect(merged.goals[0].reschedule.lastAt).toBe('2026-04-03T00:00:00.000Z');
  });

  it('the incoming field is discarded, not merged — the log is the evidence', () => {
    const merged = {goals:[{id:'g1', reschedule:{count:99, lastAt:'2030-01-01T00:00:00.000Z', avgDeltaDays:50}}],
                    log:[row('a', 1, 'manual'), row('b', 4, 'manual')]};
    p.recomputeAllReschedule(merged);
    expect(merged.goals[0].reschedule.count).toBe(1);
    expect(merged.goals[0].reschedule.avgDeltaDays).toBe(3);
  });

  it('counts a step that has since been deleted — the log outlives the graph', () => {
    const merged = {goals:[{id:'g1', threads:[], reschedule:null}],
                    log:[row('a', 1, 'manual', 'gone'), row('b', 5, 'manual', 'gone')]};
    p.recomputeAllReschedule(merged);
    expect(merged.goals[0].reschedule.count).toBe(1);
  });

  it('adoptExternal() re-derives on the document it adopted', () => {
    const m = makeGoal(p);
    for (let i = 1; i <= 3; i++) p.CAL.anchor(m.goal, m.thread, m.step, D(i), 9*60, 45, 'manual');
    expect(m.goal.reschedule.count).toBe(2);
    const doc = JSON.parse(JSON.stringify(p.DB));
    doc.goals[0].reschedule = {count:0, lastAt:null, avgDeltaDays:0};
    p.adoptExternal(doc);
    expect(p.DB.goals[0].reschedule.count).toBe(2);
  });
});

d('migration 9→10 [' + TARGET + ']', () => {
  const file = over => Object.assign({
    schema: 9, events: [], meta: {},
    goals: [{id:'g1', title:'a goal', type:'habit', status:'active', doneAt:null,
             createdAt:'2026-01-02T00:00:00.000Z', updatedAt:'2026-01-02T00:00:00.000Z',
             smart:{}, gates:[], threads:[], backlog:[]}],
    log: [{id:'l1', ts:'2026-02-01T00:00:00.000Z', kind:'planned', goalId:'g1', stepId:'s1',
           dateKey:'2026-02-03'},
          {id:'l2', ts:'2026-02-05T00:00:00.000Z', kind:'planned', goalId:'g1', stepId:'s1',
           dateKey:'2026-02-09'},
          {id:'l3', ts:'2026-02-06T00:00:00.000Z', kind:'done', goalId:'g1', stepId:'s1'}]
  }, over);

  it('backfills "unknown" on every existing planned row rather than guessing', () => {
    const d1 = file();
    expect(p.migrate(d1).ok).toBe(true);
    expect(d1.log.filter(l => l.kind === 'planned').map(l => l.source)).toEqual(['unknown','unknown']);
    expect(d1.log.find(l => l.kind === 'done').source).toBeUndefined();
  });

  it('those rows can never be counted, however many there are', () => {
    const d1 = file(); p.migrate(d1);
    expect(p.rescheduleHistory('s1', d1.log).count).toBe(0);
    expect(p.rescheduleLifetime('s1', d1.log).count).toBe(0);
  });

  it('gives every goal an empty summary and the threshold its default', () => {
    const d1 = file(); p.migrate(d1);
    expect(d1.goals[0].reschedule).toEqual({count:0, lastAt:null, avgDeltaDays:0});
    expect(d1.meta.rescheduleAt).toBe(3);
  });

  it('coerces a source it does not recognise down to "unknown", not to a guess', () => {
    const d1 = file(); d1.log[0].source = 'wishful-thinking';
    p.migrate(d1);
    expect(d1.log[0].source).toBe('unknown');
  });

  it('coerces a malformed summary rather than trusting the file', () => {
    const d1 = file(); d1.goals[0].reschedule = {count:'lots', lastAt:'nope', avgDeltaDays:'x'};
    p.migrate(d1);
    expect(d1.goals[0].reschedule).toEqual({count:0, lastAt:null, avgDeltaDays:0});
  });

  it('refuses a file from a newer schema outright', () => {
    expect(p.migrate(file({schema:p.SCHEMA+1})).ok).toBe(false);
  });
});

d('the churn signal — ladder and exclusions [' + TARGET + ']', () => {
  const churnGoal = (n, o = {}) => {
    const m = makeGoal(p, o);
    for (let i = 0; i <= n; i++) p.CAL.anchor(m.goal, m.thread, m.step, D(i + 1), 9*60, 45, 'manual');
    p.save(); return m;
  };
  const sig = () => p.signals().find(s => s.kind === 'reschedule');

  it('is silent below the threshold', () => {
    churnGoal(2);
    expect(sig()).toBeUndefined();
  });

  it('warns at the threshold and says which way the pushes go', () => {
    churnGoal(3);
    expect(sig().sev).toBe('warn');
    expect(sig().text).toBe('Moved 3× and still not done · usually 1 day later');
  });

  it('turns hard at twice the threshold, and no harder', () => {
    churnGoal(6);
    expect(sig().sev).toBe('hard');
    churnGoal(6);
    expect(p.signals().filter(s => s.kind === 'reschedule').every(s => s.sev === 'hard')).toBe(true);
  });

  it('respects a threshold the user moved', () => {
    p.DB.meta.rescheduleAt = 5;
    churnGoal(3);
    expect(sig()).toBeUndefined();
    churnGoal(5);
    expect(sig().sev).toBe('warn');
  });

  it('a blocked thread is stuck, not churning', () => {
    const m = churnGoal(4);
    expect(sig()).toBeTruthy();
    m.thread.status = 'blocked'; m.thread.blockedOn = 'Marcus'; p.save();
    expect(sig()).toBeUndefined();
  });

  it('a contingent thread stays dormant and silent', () => {
    const m = churnGoal(4, {type:'contingent'});
    m.thread.status = 'dormant'; p.save();
    expect(sig()).toBeUndefined();
  });

  it('a hushed thread emits nothing but its own chip', () => {
    const m = churnGoal(4, {type:'habit'});
    expect(sig()).toBeTruthy();
    m.thread.lastMovement = new Date(Date.now() - 400 * 864e5).toISOString(); p.save();
    expect(p.hushed(m.goal, m.thread)).toBe(true);
    expect(sig()).toBeUndefined();
    expect(p.signals().some(s => s.kind === 'hushed')).toBe(true);
  });

  it('a completed step stops churning by definition', () => {
    const m = churnGoal(4);
    expect(sig()).toBeTruthy();
    p.completeStep(m.goal, m.thread, m.step);
    expect(sig()).toBeUndefined();
  });

  it('is one chip per kind under the five-chip cap, like every other kind', () => {
    for (let i = 0; i < 7; i++) churnGoal(4);
    expect(p.SIG_KIND.reschedule).toBe('kept getting moved');
    p.renderSignals();
    const groups = h.$$('#signals [data-grp]');
    expect(groups.length).toBeLessThanOrEqual(p.SIG_MAX);
    expect(groups.filter(g => g.dataset.grp === 'reschedule').length).toBeLessThanOrEqual(1);
  });

  it('snoozes like every other kind rather than nagging through it', () => {
    churnGoal(4);
    p.snoozeSignals([sig().key]);
    expect(sig()).toBeUndefined();
  });
});

d('the churn resolver — never a bare count [' + TARGET + ']', () => {
  const churnGoal = n => {
    const m = makeGoal(p);
    for (let i = 0; i <= n; i++) p.CAL.anchor(m.goal, m.thread, m.step, D(i + 1), 9*60, 45, 'manual');
    p.save(); return m;
  };

  it('is fixable, and offers all four doors', () => {
    churnGoal(4);
    const s = p.signals().find(x => x.kind === 'reschedule');
    expect(p.FIXABLE.has('reschedule')).toBe(true);
    const html = p.sigResolverHTML(s);
    for (const act of ['schedule','churn-block','churn-cadence','drop'])
      expect(html, act + ' missing').toContain('data-fix="' + act + '"');
  });

  it('"mark blocked" silences it for the right reason, not by snoozing', () => {
    const m = churnGoal(4);
    const s = p.signals().find(x => x.kind === 'reschedule');
    p.SIGFIX = s.key; p.renderSignals();
    const input = h.$('#fxBlock'); if (input) input.value = 'the landlord';
    p.sigFixAct('churn-block', h.$('[data-fix="churn-block"]'));
    expect(m.thread.status).toBe('blocked');
    expect(m.thread.blockedOn).toBe('the landlord');
    expect(p.signals().some(x => x.kind === 'reschedule')).toBe(false);
    expect((p.DB.meta.snoozed || []).length).toBe(0);
  });

  it('"move it again" books it and counts as one more push', () => {
    const m = churnGoal(4);
    const before = m.goal.reschedule.count;
    const s = p.signals().find(x => x.kind === 'reschedule');
    p.SIGFIX = s.key; p.renderSignals();
    const when = h.$('#fxWhen'); if (when) when.value = D(20);
    p.sigFixAct('schedule', h.$('[data-fix="schedule"]'));
    expect(m.goal.reschedule.count).toBe(before + 1);
  });
});

d('drift feeds Prompt 4’s gate — one gate, two kinds of evidence [' + TARGET + ']', () => {
  /* A habit on a template, pushed consistently later. */
  const drifting = (deltas, {type = 'habit', tmpl = 'gym'} = {}) => {
    const m = makeGoal(p, {type, goal:{cadenceDays:7}});
    p.ensureFootprint(m.step); p.fp(m.step).tmpl = tmpl;
    let day = 1;
    p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual');
    for (const dd of deltas) { day += dd; p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual'); }
    p.save(); return m;
  };
  const gate = () => p.tmplGates().find(g => g.tmpl === 'gym');
  const withDuration = m => {
    for (const n of [95, 100, 98]) p.recordSample('gym', n);
    p.proposeFromDuration('gym');
  };

  it('a tight, consistent drift proposes a cadence correction', () => {
    p.fpMeta().learnAfter = 3;
    drifting([2, 2, 2]);
    expect(p.rescheduleDrift('gym', p.DB, 3).length).toBe(1);
    const g = gate();
    expect(g).toBeTruthy();
    expect(g.proposes[0]).toMatchObject({target:'goal', field:'cadenceDays', from:7, to:9});
    expect(g.because.kind).toBe('drift');
  });

  it('scattered pushes are noise, and noise proposes nothing', () => {
    p.fpMeta().learnAfter = 3;
    drifting([6, -5, 7, -6]);
    expect(p.rescheduleDrift('gym', p.DB, 3).length).toBe(0);
    expect(gate()).toBeUndefined();
  });

  it('a drift under a day is not worth an interruption', () => {
    const stats = p.driftStats([0.4, 0.5, 0.4]);
    expect(stats.tight).toBe(true);
    expect(Math.abs(stats.avg) < p.DRIFT_MIN_DAYS).toBe(true);
  });

  it('spread wider than the mean reads as noise, not a pattern', () => {
    expect(p.driftStats([5, -4, 6, -5]).tight).toBe(false);
    expect(p.driftStats([2, 2, 3, 2]).tight).toBe(true);
  });

  it('too few moves is not yet evidence', () => {
    p.fpMeta().learnAfter = 5;
    drifting([2, 2]);
    expect(gate()).toBeUndefined();
  });

  it('a goal with no cadence is not indicted — a deadline has nothing to stretch', () => {
    p.fpMeta().learnAfter = 3;
    drifting([2, 2, 2], {type:'deadline'});
    expect(gate()).toBeUndefined();
  });

  it('extends the open duration gate rather than opening a second one', () => {
    const m = makeGoal(p, {type:'habit', goal:{cadenceDays:7}});
    p.ensureFootprint(m.step); p.fp(m.step).tmpl = 'gym';
    p.fpMeta().learnAfter = 3;
    withDuration(m);
    const first = gate();
    expect(first.proposes.map(x => x.field)).toEqual(['dur']);

    let day = 1;
    p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual');
    for (const dd of [2, 2, 2]) { day += dd; p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual'); }

    const both = p.tmplGates().filter(g => g.tmpl === 'gym');
    expect(both.length, 'one gate, not two').toBe(1);
    expect(both[0].id, 'same gate, sharpened').toBe(first.id);
    expect(both[0].proposes.map(x => x.field).sort()).toEqual(['cadenceDays','dur']);
    expect(both[0].because.kind).toBe('mixed');
    expect(both[0].because.parts.map(x => x.kind).sort()).toEqual(['drift','duration']);
  });

  it('accepting writes both targets in one action', () => {
    const m = makeGoal(p, {type:'habit', goal:{cadenceDays:7}});
    p.ensureFootprint(m.step); p.fp(m.step).tmpl = 'gym';
    p.fpMeta().learnAfter = 3;
    withDuration(m);
    let day = 1;
    p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual');
    for (const dd of [2, 2, 2]) { day += dd; p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual'); }
    p.acceptTmplGate(gate().id);
    expect(p.tmplGet('gym').dur).toBe(98);
    expect(m.goal.cadenceDays).toBe(9);
    expect(gate()).toBeUndefined();
  });

  it('declining uses the same mechanics and does not re-ask from the same evidence', () => {
    p.fpMeta().learnAfter = 3;
    const m = drifting([2, 2, 2]);
    const before = m.goal.cadenceDays;
    p.declineTmplGate(gate().id);
    expect(gate()).toBeUndefined();
    expect(m.goal.cadenceDays).toBe(before);
  });

  it('the chip names both reasons when it is carrying both', () => {
    const m = makeGoal(p, {type:'habit', goal:{cadenceDays:7}});
    p.ensureFootprint(m.step); p.fp(m.step).tmpl = 'gym';
    p.fpMeta().learnAfter = 3;
    withDuration(m);
    let day = 1;
    p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual');
    for (const dd of [2, 2, 2]) { day += dd; p.CAL.anchor(m.goal, m.thread, m.step, D(day), 19*60, 45, 'manual'); }
    p.save();
    const s = p.signals().find(x => x.kind === 'tmpl');
    const html = p.sigResolverHTML(s);
    expect(html).toContain('cadence');
    expect(html).toContain('timed completions');
    expect(html).toContain('moves');
  });
});

d('the two display lines [' + TARGET + ']', () => {
  const withChurn = n => {
    const m = makeGoal(p, {type:'milestone'});
    for (let i = 0; i <= n; i++) p.CAL.anchor(m.goal, m.thread, m.step, D(i + 1), 9*60, 45, 'manual');
    p.save(); return m;
  };

  it('the List row shows the line, and only when there is one to show', () => {
    const m = withChurn(3);
    p.DB.meta.zoom = 'list'; p.render();
    expect(h.$("#view").textContent).toContain('rescheduled 3×');
    m.goal.reschedule = {count:0, lastAt:null, avgDeltaDays:0};
    p.save(); p.render();
    expect(h.$("#view").textContent).not.toContain('rescheduled');
  });

  it('the Quarter goal detail shows the same phrase, from the same function', () => {
    const m = withChurn(3);
    p.DB.meta.zoom = 'quarter'; p.render();
    expect(h.$("#view").textContent).toContain(p.rescheduleLine(m.goal));
  });

  it('neither view invents a second phrasing', () => {
    withChurn(3);
    p.DB.meta.zoom = 'list'; p.render();
    const list = h.$('.lchurn') && h.$('.lchurn').textContent;
    p.DB.meta.zoom = 'quarter'; p.render();
    const quarter = h.$('.qchurn') && h.$('.qchurn').textContent;
    expect(list).toBeTruthy();
    expect(list).toBe(quarter);
  });
});

/* FOLLOW-UPS.md #8: 'unblock' was a reserved AnchorSource with no call site.
   unblockThread() is the one function all three unblock sites (the ribbon
   resolver, the check-in, the goal editor) now share, so the condition for
   whether to re-book lives in one place. */
d('unblockThread() — conditional re-book [' + TARGET + ']', () => {
  it('a cyclical goal with no slot at all gets one, one cadence out, tagged unblock', () => {
    const m = makeGoal(p, { title: 'Gym', type: 'habit', rel: 'cyclical',
      thread: { status: 'blocked', blockedOn: 'knee' } });
    m.goal.cadenceDays = 7;
    const s = p.unblockThread(m.goal, m.thread);
    expect(m.thread.status).toBe('active');
    expect(m.thread.blockedOn).toBe('');
    expect(m.thread.blockedSince).toBe(null);
    expect(s.eventId).toBeTruthy();
    expect(p.eventById(s.eventId).dateKey).toBe(D(7));
    expect(trail(s.id)).toEqual([{source:'unblock', dateKey:D(7)}]);
  });

  it('the re-book is not churn — the point of tagging it separately from manual/drag/checkin', () => {
    const m = makeGoal(p, { type: 'maintenance', rel: 'cyclical',
      thread: { status: 'blocked' } });
    m.goal.cadenceDays = 3;
    p.unblockThread(m.goal, m.thread);
    expect(m.goal.reschedule.count).toBe(0);  // a first booking, not a push
  });

  it('a non-cyclical goal is reactivated but left unscheduled — there is no date to invent', () => {
    const m = makeGoal(p, { type: 'task', thread: { status: 'blocked' } });
    const s = p.unblockThread(m.goal, m.thread);
    expect(m.thread.status).toBe('active');
    expect(s.eventId).toBeFalsy();
    expect(trail(s.id)).toEqual([]);
  });

  it('a cyclical goal whose step is already on the calendar is left exactly where it was', () => {
    const m = makeGoal(p, { type: 'threshold', rel: 'cyclical',
      thread: { status: 'blocked' } });
    m.goal.cadenceDays = 14;
    p.CAL.anchor(m.goal, m.thread, m.step, D(2), 9*60, 60, 'manual');
    const before = m.step.eventId;
    p.unblockThread(m.goal, m.thread);
    expect(m.step.eventId).toBe(before);
    expect(p.eventById(before).dateKey).toBe(D(2));
    expect(trail(m.step.id).map(x => x.source)).toEqual(['manual']);  // no second row
  });

  it('a thread with no live step at all is just reactivated — nothing to book', () => {
    const m = makeGoal(p, { type: 'habit', rel: 'cyclical', step: null,
      thread: { status: 'blocked' } });
    m.goal.cadenceDays = 7;
    const s = p.unblockThread(m.goal, m.thread);
    expect(m.thread.status).toBe('active');
    expect(s).toBeNull();
  });
});

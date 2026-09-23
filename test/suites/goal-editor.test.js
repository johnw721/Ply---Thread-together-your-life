import { describe, it, expect, beforeEach } from 'vitest';
import { boot, makeGoal, TARGET, isLegacy } from '../harness.js';

/* The goal editor, pinned from the outside before it stops being a string.

   dialogs.test.js already drives the inline-add fields, arm-to-confirm, the
   scheduling row, the block row and branches; subtasks.test.js drives the subtask
   list. This covers the rest of what the editor does — every field it reads back,
   every action in geAct() that nothing else reaches, the keyboard contract, and
   the one property the string version was careful about: a rename commits on
   change without rebuilding the dialog under the caret.

   The footprint row postdates the monolith (schema 9), so that block is [src]
   only, the same way footprint.test.js is. */
const srcOnly = isLegacy ? describe.skip : describe;

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; h.forbidNatives(); });

const open = g => { p.openGoal(g.goal ? g.goal.id : g.id); };

describe('goal editor — the SMART fields [' + TARGET + ']', () => {
  it('shows what the goal holds', () => {
    const g = makeGoal(p, { title: 'Run a 10k', type: 'milestone' });
    Object.assign(g.goal.smart, { outcome: 'finish under 60', metricName: 'km', current: 3, target: 10,
      deadline: p.addDays(p.today(), 30) });
    g.goal.why = 'because'; g.goal.notes = 'some notes';
    open(g);
    expect(h.$('#geTitle').value).toBe('Run a 10k');
    expect(h.$('#geType').value).toBe('milestone');
    expect(h.$('#geOut').value).toBe('finish under 60');
    expect(h.$('#geMet').value).toBe('km');
    expect(h.$('#geCur').value).toBe('3');
    expect(h.$('#geTgt').value).toBe('10');
    expect(h.$('#geDL').value).toBe(p.addDays(p.today(), 30));
    expect(h.$('#geWhy').value).toBe('because');
    expect(h.$('#geNotes').value).toBe('some notes');
    expect(h.$('.modal h3 .pill').textContent).toBe('Milestone');
  });

  it('Save reads every field back, closes, and is one undo step', async () => {
    const g = makeGoal(p, { title: 'old title' });
    open(g);
    h.type('#geTitle', 'new title');
    h.type('#geCad', '5');
    h.type('#geDL', p.addDays(p.today(), 9));
    h.type('#geOut', 'it is true');
    h.type('#geMet', 'reps');
    h.type('#geCur', '4');
    h.type('#geTgt', '12');
    h.type('#geWhy', 'a reason');
    h.type('#geNotes', 'a note');
    h.click('[data-ge="save"]');
    await h.settle();

    expect(g.goal.title).toBe('new title');
    expect(g.goal.cadenceDays).toBe(5);
    expect(g.goal.smart.deadline).toBe(p.addDays(p.today(), 9));
    expect(g.goal.smart.outcome).toBe('it is true');
    expect(g.goal.smart.metricName).toBe('reps');
    expect(g.goal.smart.current).toBe(4);
    expect(g.goal.smart.target).toBe(12);
    expect(g.goal.why).toBe('a reason');
    expect(g.goal.notes).toBe('a note');
    expect(h.$('.modal')).toBe(null);
    expect(h.lastToast()).toMatch(/saved/i);
    p.undo();
    expect(p.goalById(g.goal.id).title).toBe('old title');
  });

  it('a blank title keeps the old one; blank cadence and target clear to null', async () => {
    const g = makeGoal(p, { title: 'keep me' });
    g.goal.cadenceDays = 4; g.goal.smart.target = 7;
    open(g);
    h.type('#geTitle', '   ');
    h.type('#geCad', '');
    h.type('#geTgt', '');
    h.click('[data-ge="save"]');
    await h.settle();
    expect(g.goal.title).toBe('keep me');
    expect(g.goal.cadenceDays).toBe(null);
    expect(g.goal.smart.target).toBe(null);
  });

  it('retyping to a deadline goal with no date queues the question, and teaches the classifier', async () => {
    const g = makeGoal(p, { title: 'file the taxes', type: 'milestone' });
    open(g);
    h.type('#geType', 'deadline');
    h.click('[data-ge="save"]');
    await h.settle();
    expect(g.goal.type).toBe('deadline');
    expect(g.goal.gates.some(x => x.kind === 'deadline')).toBe(true);
    expect((p.DB.meta.learned || []).some(e => e.type === 'deadline')).toBe(true);
  });

  it('a contingent goal shows its trigger, and saves it', async () => {
    const g = makeGoal(p, { title: 'if the offer lands', type: 'contingent' });
    g.goal.trigger = 'offer letter';
    open(g);
    expect(h.$('#geTrig').value).toBe('offer letter');
    h.type('#geTrig', 'signed offer');
    h.click('[data-ge="save"]');
    await h.settle();
    expect(g.goal.trigger).toBe('signed offer');
  });

  it('queued check-in questions are shown', () => {
    const g = makeGoal(p, { title: 'gated' });
    g.goal.gates = [{ id: 'q1', kind: 'deadline', q: 'What is the hard date?' }];
    open(g);
    expect(h.$('.modal').textContent).toContain('Queued for the next check-in');
    expect(h.$('.modal').textContent).toContain('What is the hard date?');
  });

  it('a goal that is gone says so rather than throwing', () => {
    p.openGoal('no-such-goal');
    expect(h.$('.modal h3').textContent).toContain('Gone');
    h.click('[data-close]');
    expect(h.$('.modal')).toBe(null);
  });
});

describe('goal editor — renames commit in place [' + TARGET + ']', () => {
  it('a step rename saves on change without rebuilding the dialog', async () => {
    const g = makeGoal(p, { title: 'rename host' });
    open(g);
    const field = h.$('.steptitle');
    const body = h.$('.mbody[data-goal]');
    h.change(field, 'renamed step');
    await h.settle();
    expect(g.step.title).toBe('renamed step');
    expect(p.UNDO.length).toBe(1);
    // the very same nodes — nothing was rewritten under the caret
    expect(h.$('.steptitle')).toBe(field);
    expect(h.$('.mbody[data-goal]')).toBe(body);
  });

  it('a rename also keeps whatever else was typed but not yet saved', async () => {
    const g = makeGoal(p, { title: 'half typed' });
    open(g);
    h.type('#geOut', 'typed, not saved');
    h.change(h.$('.steptitle'), 'another name');
    await h.settle();
    expect(g.goal.smart.outcome).toBe('typed, not saved');
    expect(h.$('#geOut').value).toBe('typed, not saved');
  });

  it('a blank step rename is ignored', async () => {
    const g = makeGoal(p, { title: 'blank rename', step: 'the step' });
    open(g);
    h.change(h.$('.steptitle'), '  ');
    await h.settle();
    expect(g.step.title).toBe('the step');
  });

  it('Enter in a rename field commits it by blurring', () => {
    const g = makeGoal(p, { title: 'enter commits' });
    open(g);
    const f = h.$('.steptitle');
    f.focus();
    expect(h.document.activeElement).toBe(f);
    h.key(f, 'Enter');
    expect(h.document.activeElement).not.toBe(f);
  });

  it('thread name and relation are read back on save', async () => {
    const g = makeGoal(p, { title: 'threads', thread: { name: 'Main' } });
    open(g);
    const th = h.$(`.thread[data-thread="${g.thread.id}"]`);
    h.type(th.querySelector('.tname'), 'Research');
    h.type(th.querySelector('.trel'), 'parallel');
    h.click('[data-ge="save"]');
    await h.settle();
    expect(g.thread.name).toBe('Research');
    expect(g.thread.rel).toBe('parallel');
  });

  it('backlog items rename in place and delete', async () => {
    const g = makeGoal(p, { title: 'backlogged', type: 'milestone', goal: { backlog: ['one', 'two'] } });
    open(g);
    expect(h.$$('.backtitle').map(x => x.value)).toEqual(['one', 'two']);
    h.change(h.$('.backtitle[data-i="1"]'), 'TWO');
    await h.settle();
    expect(g.goal.backlog).toEqual(['one', 'TWO']);
    h.click('[data-ge="backlog-del"][data-i="0"]');
    await h.settle();
    expect(g.goal.backlog).toEqual(['TWO']);
    expect(h.$$('.backtitle').map(x => x.value)).toEqual(['TWO']);
  });

  it('an empty backlog says what completing will do instead', () => {
    const g = makeGoal(p, { title: 'empty backlog', type: 'milestone', goal: { backlog: [] } });
    open(g);
    expect(h.$('.modal').textContent).toMatch(/Empty\. Completing a step will ask you/);
  });
});

describe('goal editor — threads and steps [' + TARGET + ']', () => {
  it('+ thread adds a parallel thread and shows it', async () => {
    const g = makeGoal(p, { title: 'more threads' });
    open(g);
    h.click('[data-ge="thread-add"]');
    await h.settle();
    expect(g.goal.threads.length).toBe(2);
    expect(g.goal.threads[1].name).toBe('Thread 2');
    expect(g.goal.threads[1].rel).toBe('parallel');
    expect(h.$$('.modal .thread').length).toBe(2);
  });

  it('removing a thread arms first, then goes', async () => {
    const g = makeGoal(p, { title: 'two threads' });
    const t2 = p.newThread({ name: 'Second', rel: 'parallel' });
    t2.steps.push(p.newStep('second step'));
    g.goal.threads.push(t2);
    open(g);
    const del = () => h.$(`[data-ge="thread-del"][data-t="${t2.id}"]`);
    h.click(del());
    await h.settle();
    expect(g.goal.threads.length).toBe(2);
    expect(del().textContent).toMatch(/remove thread\?/);
    h.click(del());
    await h.settle();
    expect(g.goal.threads.map(t => t.id)).toEqual([g.thread.id]);
    expect(h.$$('.modal .thread').length).toBe(1);
  });

  it('done pulls the next step from the backlog and redraws in place', async () => {
    const g = makeGoal(p, { title: 'pull next', type: 'milestone', step: 'first', goal: { backlog: ['second'] } });
    open(g);
    h.click(`[data-ge="complete"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(g.step.done).toBe(true);
    expect(p.currentStep(g.thread).title).toBe('second');
    expect(h.$('.steptitle').value).toBe('second');
    expect(h.$('.stepline.hist').textContent).toContain('first');
  });

  it('done with nothing next asks for the next step', async () => {
    const g = makeGoal(p, { title: 'define next', type: 'milestone', goal: { backlog: [] } });
    open(g);
    h.click(`[data-ge="complete"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(h.$('#dnStep')).toBeTruthy();
    expect(h.$('.modal').textContent).toContain('Next step required');
  });

  it('a thread with no current step says so, and offers the field', () => {
    const g = makeGoal(p, { title: 'stepless', step: null });
    open(g);
    expect(h.$('.modal').textContent).toMatch(/no next step/);
    expect(h.$(`.newin[data-new="step"][data-t="${g.thread.id}"]`)).toBeTruthy();
  });

  it('the scheduling row opens, shows the current slot, and cancels', async () => {
    const g = makeGoal(p, { title: 'slotted' });
    p.CAL.anchor(g.goal, g.thread, g.step, p.addDays(p.today(), 3), 9 * 60 + 30, 45);
    open(g);
    expect(h.$(`[data-ge="sched"][data-s="${g.step.id}"]`).textContent).toBe('reslot');
    h.click(`[data-ge="sched"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(h.$('.schd').value).toBe(p.addDays(p.today(), 3));
    expect(h.$('.schtm').value).toBe('09:30');
    expect(h.$('[data-ge="sched-save"]').textContent).toBe('reslot');
    expect(h.$(`[data-ge="sched"][data-s="${g.step.id}"]`).classList.contains('primary')).toBe(true);
    h.click('[data-ge="sched-cancel"]');
    await h.settle();
    expect(h.$('.schd')).toBe(null);
    expect(p.GEROW).toBe(null);
  });

  it('the scheduling row can book all day', async () => {
    const g = makeGoal(p, { title: 'all day' });
    open(g);
    expect(h.$(`[data-ge="sched"][data-s="${g.step.id}"]`).textContent).toBe('slot it');
    h.click(`[data-ge="sched"][data-s="${g.step.id}"]`);
    h.type('.schd', p.addDays(p.today(), 1));
    h.type('.schall', true);
    h.click('[data-ge="sched-save"]');
    await h.settle();
    const ev = p.eventById(p.currentStep(g.thread).eventId);
    expect(ev.allDay).toBe(true);
    expect(ev.dateKey).toBe(p.addDays(p.today(), 1));
  });

  it('opening an inline row keeps what was typed in the SMART fields', async () => {
    const g = makeGoal(p, { title: 'keep typing' });
    open(g);
    h.type('#geNotes', 'mid-thought');
    h.click(`[data-ge="sched"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(g.goal.notes).toBe('mid-thought');
    expect(h.$('#geNotes').value).toBe('mid-thought');
  });

  it('Enter in the block row commits it', async () => {
    const g = makeGoal(p, { title: 'enter blocks' });
    open(g);
    h.click(`[data-ge="block"][data-t="${g.thread.id}"]`);
    await h.settle();
    const who = h.$('.blockwho');
    who.value = 'the landlord';
    h.key(who, 'Enter');
    await h.settle();
    expect(g.thread.status).toBe('blocked');
    expect(g.thread.blockedOn).toBe('the landlord');
    expect(h.$('.tblock').value).toBe('the landlord');
  });

  it('block-cancel closes the row without blocking', async () => {
    const g = makeGoal(p, { title: 'never mind' });
    open(g);
    h.click(`[data-ge="block"][data-t="${g.thread.id}"]`);
    await h.settle();
    expect(h.$('.blockwho')).toBeTruthy();
    h.click('[data-ge="block-cancel"]');
    await h.settle();
    expect(h.$('.blockwho')).toBe(null);
    expect(g.thread.status).not.toBe('blocked');
  });

  it('a blocked thread shows who it waits on, and unblocks', async () => {
    const g = makeGoal(p, { title: 'blocked', thread: { status: 'blocked', blockedOn: 'Dana',
      blockedSince: new Date().toISOString() } });
    open(g);
    expect(h.$('.tblock').value).toBe('Dana');
    expect(h.$(`[data-ge="block"][data-t="${g.thread.id}"]`)).toBe(null);
    h.click(`[data-ge="unblock"][data-t="${g.thread.id}"]`);
    await h.settle();
    expect(g.thread.status).toBe('active');
    expect(h.$('.tblock')).toBe(null);
  });

  it('a dormant contingent thread fires, and its trigger gate clears', async () => {
    const g = makeGoal(p, { title: 'waiting', type: 'contingent', step: null, thread: { status: 'dormant' } });
    g.goal.trigger = 'the call comes';
    g.goal.gates = [{ id: 'tg', kind: 'trigger', q: 'did it happen?' }];
    open(g);
    expect(h.$('.modal').textContent).toContain('Dormant until: the call comes');
    expect(h.$(`.newin[data-new="step"][data-t="${g.thread.id}"]`)).toBe(null);
    h.click(`[data-ge="fire"][data-t="${g.thread.id}"]`);
    await h.settle();
    expect(g.thread.status).toBe('active');
    expect(p.currentStep(g.thread)).toBeTruthy();
    expect(g.goal.gates.filter(x => x.kind === 'trigger')).toEqual([]);
  });

  it('branches list, and delete', async () => {
    const g = makeGoal(p, { title: 'branches', rel: 'conditional',
      thread: { branches: [{ condition: 'yes', next: 'go' }, { condition: 'no', next: 'stop' }] } });
    open(g);
    expect(h.$('.modal').textContent).toContain('yes');
    h.click(`[data-ge="branch-del"][data-t="${g.thread.id}"][data-i="0"]`);
    await h.settle();
    expect(g.thread.branches).toEqual([{ condition: 'no', next: 'stop' }]);
  });

  it('a pipeline entry becomes its own thread at the first stage', async () => {
    const g = makeGoal(p, { title: 'job hunt', type: 'pipeline' });
    open(g);
    const f = h.$('.newin[data-new="entry"]');
    f.value = 'Acme'; h.key(f, 'Enter');
    await h.settle();
    const th = g.goal.threads.find(t => t.name === 'Acme');
    expect(th).toBeTruthy();
    expect(th.stage).toBeTruthy();
    expect(h.$$('.modal .thread').length).toBe(2);
  });

  it('Escape in an inline add field clears it', () => {
    const g = makeGoal(p, { title: 'escape' });
    open(g);
    const f = h.$('.newin[data-new="step"]');
    f.value = 'never mind';
    h.key(f, 'Escape');
    expect(f.value).toBe('');
  });

  it('an inline step add clears and keeps focus', async () => {
    const g = makeGoal(p, { title: 'add steps', step: null });
    open(g);
    const f = h.$('.newin[data-new="step"]');
    f.value = 'step one'; h.key(f, 'Enter');
    await h.settle();
    expect(p.currentStep(g.thread).title).toBe('step one');
    const again = h.$('.newin[data-new="step"]');
    expect(again.value).toBe('');
    expect(h.document.activeElement).toBe(again);
  });

  it('space on a subtask checkbox ticks it', async () => {
    const g = makeGoal(p, { title: 'keyboard sub' });
    g.step.subs = [p.newSub('a'), p.newSub('b')];
    open(g);
    h.key(h.$('.modal .subchk'), ' ');
    await h.settle();
    expect(p.subs(g.step).filter(s => s.done).length).toBe(1);
    expect(h.$$('.modal .subchk').map(x => x.getAttribute('aria-checked') + x.dataset.sub)).toEqual(p.subs(g.step).map(s => String(s.done) + s.id));
  });

  it('ordering arrows are disabled at the ends', () => {
    const g = makeGoal(p, { title: 'ends', type: 'milestone', goal: { backlog: ['a', 'b', 'c'] } });
    open(g);
    const ups = h.$$('[data-ge="backlog-up"]'), downs = h.$$('[data-ge="backlog-down"]');
    expect(ups.map(b => b.disabled)).toEqual([true, false, false]);
    expect(downs.map(b => b.disabled)).toEqual([false, false, true]);
  });

  it('backlog reorders both ways', async () => {
    const g = makeGoal(p, { title: 'reorder', type: 'milestone', goal: { backlog: ['a', 'b', 'c'] } });
    open(g);
    h.click('[data-ge="backlog-down"][data-i="0"]');
    await h.settle();
    expect(g.goal.backlog).toEqual(['b', 'a', 'c']);
    h.click('[data-ge="backlog-up"][data-i="2"]');
    await h.settle();
    expect(g.goal.backlog).toEqual(['b', 'c', 'a']);
    expect(h.$$('.backtitle').map(x => x.value)).toEqual(['b', 'c', 'a']);
  });
});

describe('goal editor — the footer [' + TARGET + ']', () => {
  it('Mark complete saves the fields and closes the goal', async () => {
    const g = makeGoal(p, { title: 'finish me' });
    open(g);
    h.type('#geNotes', 'last words');
    h.click('[data-ge="finish"]');
    await h.settle();
    expect(g.goal.status).toBe('done');
    expect(g.goal.notes).toBe('last words');
    expect(h.$('.modal')).toBe(null);
    expect(h.lastToast()).toMatch(/moves to Completed/);
  });

  it('a decision offers conversion, which carries the why over', async () => {
    const g = makeGoal(p, { title: 'which job?', type: 'decision' });
    g.goal.why = 'ship the auth module';
    open(g);
    h.click('[data-ge="convert"]');
    await h.settle();
    expect(h.$('#cvT').value).toBe('ship the auth module');
  });

  it('only a decision offers conversion', () => {
    const g = makeGoal(p, { title: 'not a decision', type: 'milestone' });
    open(g);
    expect(h.$('[data-ge="convert"]')).toBe(null);
  });

  it('the follow-through panel is there', () => {
    const g = makeGoal(p, { title: 'stats' });
    open(g);
    const t = h.$('.modal').textContent;
    expect(t).toContain('done / planned');
    expect(t).toContain('day streak');
    expect(t).toContain('days since movement');
  });
});

/* What the conversion bought. The string version rebuilt every node on each
   refresh, so whatever had focus lost it; the monolith can't pass this, which is
   why it's [src] only rather than a behaviour the two targets share. */
srcOnly('goal editor — a refresh patches rather than rebuilds [' + TARGET + ']', () => {
  it('the focused field keeps focus, and its node, across a refresh', () => {
    const g = makeGoal(p, { title: 'stay focused' });
    open(g);
    const f = h.$('.tname');
    f.focus();
    p.refreshGoal(g.goal.id);
    expect(h.$('.tname')).toBe(f);
    expect(h.document.activeElement).toBe(f);
  });

  it('opening an inline row does not take focus away from the page', async () => {
    const g = makeGoal(p, { title: 'row focus' });
    open(g);
    const btn = h.$(`[data-ge="sched"][data-s="${g.step.id}"]`);
    btn.focus();
    h.click(btn);
    await h.settle();
    expect(h.$(`[data-ge="sched"][data-s="${g.step.id}"]`)).toBe(btn);
    expect(h.document.activeElement).toBe(btn);
  });
});

srcOnly('goal editor — the footprint row [' + TARGET + ']', () => {
  const openFoot = g => { open(g); h.click(`[data-ge="foot"][data-s="${g.step.id}"]`); };

  it('opens under the step and closes again', async () => {
    const g = makeGoal(p, { title: 'footprinted' });
    open(g);
    expect(h.$(`[data-ge="foot"][data-s="${g.step.id}"]`).textContent).toBe('footprint');
    h.click(`[data-ge="foot"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(h.$(`.footrow[data-s="${g.step.id}"]`)).toBeTruthy();
    expect(p.GEROW).toEqual({ kind: 'foot', id: g.step.id });
    h.click('[data-ge="foot-cancel"]');
    await h.settle();
    expect(h.$('.footrow')).toBe(null);
  });

  it('lead and lag are read back on save, and the button says so', async () => {
    const g = makeGoal(p, { title: 'lead lag' });
    openFoot(g);
    h.type('.fplead', '15');
    h.type('.fplag', '10');
    h.click('[data-ge="foot-save"]');
    await h.settle();
    expect(p.fp(g.step).lead).toBe(15);
    expect(p.fp(g.step).lag).toBe(10);
    expect(h.$('.footrow')).toBe(null);
    expect(h.$(`[data-ge="foot"][data-s="${g.step.id}"]`).textContent).toContain('+25m');
  });

  it('prerequisites add, toggle, edit and delete', async () => {
    const g = makeGoal(p, { title: 'prereqs' });
    openFoot(g);
    h.click('[data-ge="foot-pq-add"]');
    expect(h.lastToast()).toMatch(/name it/i);
    h.type('.fppqnew', 'book the table');
    h.click('[data-ge="foot-pq-add"]');
    await h.settle();
    const pq = p.fp(g.step).prereqs;
    expect(pq.map(x => x.title)).toEqual(['book the table']);
    expect(h.$('.fppqnew').value).toBe('');

    h.click(`[data-ge="foot-pq-toggle"][data-pq="${pq[0].id}"]`);
    await h.settle();
    expect(p.fp(g.step).prereqs[0].done).toBe(true);
    expect(h.$(`[data-ge="foot-pq-toggle"][data-pq="${pq[0].id}"]`).getAttribute('aria-checked')).toBe('true');

    h.type(`.fppqt[data-pq="${pq[0].id}"]`, 'book the big table');
    h.type(`.fppqd[data-pq="${pq[0].id}"]`, '3');
    h.click('[data-ge="foot-save"]');
    await h.settle();
    expect(p.fp(g.step).prereqs[0].title).toBe('book the big table');
    expect(p.fp(g.step).prereqs[0].leadDays).toBe(3);

    h.click(`[data-ge="foot"][data-s="${g.step.id}"]`);
    await h.settle();
    h.click(`[data-ge="foot-pq-del"][data-pq="${pq[0].id}"]`);
    await h.settle();
    expect(p.fp(g.step).prereqs).toEqual([]);
  });

  it('an open prerequisite shows on the button', async () => {
    const g = makeGoal(p, { title: 'first things' });
    openFoot(g);
    h.type('.fppqnew', 'pack');
    h.click('[data-ge="foot-pq-add"]');
    await h.settle();
    h.click('[data-ge="foot-cancel"]');
    await h.settle();
    expect(h.$(`[data-ge="foot"][data-s="${g.step.id}"]`).textContent).toContain('1 first');
  });

  it('cost lines add, edit, categorise and delete', async () => {
    const g = makeGoal(p, { title: 'costs' });
    p.DB.meta.budget = p.DB.meta.budget || {};
    p.DB.meta.budget.cats = [{ id: 'food', name: 'Food' }];
    openFoot(g);
    expect(h.$('.footrow').textContent).toMatch(/Estimates only/);
    h.type('.fpcnew', 'dinner');
    h.click('[data-ge="foot-cost-add"]');
    await h.settle();
    const c = p.fp(g.step).costs[0];
    expect(c.label).toBe('dinner');

    h.type(`.fpca[data-c="${c.id}"]`, '40');
    h.type(`.fpcc[data-c="${c.id}"]`, 'food');
    h.type(`.fpcl[data-c="${c.id}"]`, 'nice dinner');
    h.click('[data-ge="foot-save"]');
    await h.settle();
    const saved = p.fp(g.step).costs[0];
    expect(saved.amount).toBe(40);
    expect(saved.catId).toBe('food');
    expect(saved.label).toBe('nice dinner');
    expect(h.$(`[data-ge="foot"][data-s="${g.step.id}"]`).textContent).toContain(p.money(40));

    h.click(`[data-ge="foot"][data-s="${g.step.id}"]`);
    await h.settle();
    expect(h.$(`.fpcc[data-c="${c.id}"]`).value).toBe('food');
    expect(h.$('.footrow').textContent).toContain('Estimated at');
    h.click(`[data-ge="foot-cost-del"][data-c="${c.id}"]`);
    await h.settle();
    expect(p.fp(g.step).costs).toEqual([]);
  });

  it('timing starts, stops and clears', async () => {
    const g = makeGoal(p, { title: 'timed' });
    openFoot(g);
    h.click('[data-ge="foot-start"]');
    await h.settle();
    expect(p.timing(g.step)).toBeTruthy();
    expect(h.$('[data-ge="foot-stop"]')).toBeTruthy();
    h.click('[data-ge="foot-stop"]');
    await h.settle();
    expect(p.timing(g.step)).toBeFalsy();
    // under a minute may record as nothing; either way the row is back to a sensible state
    expect(h.$('[data-ge="foot-start"]') || h.$('[data-ge="foot-clear"]')).toBeTruthy();
    if (h.$('[data-ge="foot-clear"]')){
      h.click('[data-ge="foot-clear"]');
      await h.settle();
      expect(h.$('[data-ge="foot-start"]')).toBeTruthy();
    }
  });

  it('a template applies into the gaps and says what it did', async () => {
    const g = makeGoal(p, { title: 'dinner out' });
    openFoot(g);
    const sel = h.$('.fptmpl');
    const key = [...sel.options].map(o => o.value).find(Boolean);
    h.type(sel, key);
    h.click('[data-ge="foot-apply"]');
    await h.settle();
    expect(p.fp(g.step).tmpl).toBe(key);
    expect(h.lastToast()).toMatch(/filled in|Nothing to fill/);
    expect(h.$('.footrow')).toBeTruthy();       // the row stays open for more editing
    expect(h.$('.fptmpl').value).toBe(key);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, isLegacy } from '../harness.js';

/* Schema 11: "today I learned" notes, resurfaced on their own spaced-repetition
   schedule. Nothing in legacy/index.html to pin — the monolith predates it. */
const d = isLegacy ? describe.skip : describe;

let h, p;
/* The syntax tips (cards.test.js) queue ahead of due notes once any note exists;
   this suite is about the notes themselves, so they're switched off here. */
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; p.DB.meta.tips.off = true; });

d('capture — "til:" files a note, not a goal [' + TARGET + ']', () => {
  it('isTilCapture matches "til:" and "til " but not "till" or "tilth"', () => {
    expect(p.isTilCapture('til: closures capture references')).toBe(true);
    expect(p.isTilCapture('TIL closures capture references')).toBe(true);
    expect(p.isTilCapture('til - a thing')).toBe(true);
    expect(p.isTilCapture('till the well runs dry')).toBe(false);
    expect(p.isTilCapture('tilth is soil texture')).toBe(false);
    expect(p.isTilCapture('call the tiler about the floor')).toBe(false);
  });

  it('stripTil removes the prefix and trims', () => {
    expect(p.stripTil('til: closures capture references')).toBe('closures capture references');
    expect(p.stripTil('TIL   closures capture references  ')).toBe('closures capture references');
  });

  it('doCapture files a note and adds no goal', () => {
    p.doCapture('til: sets are unordered in Python');
    expect(p.DB.notes.length).toBe(1);
    expect(p.DB.notes[0].text).toBe('sets are unordered in Python');
    expect(p.DB.goals.length).toBe(0);
  });

  it('an empty TIL capture files nothing, same as capture never blocking', () => {
    p.doCapture('til:    ');
    expect(p.DB.notes.length).toBe(0);
  });

  it('a plain capture with no prefix still goes through the classifier', () => {
    p.doCapture('Ship the API docs');
    expect(p.DB.notes.length).toBe(0);
    expect(p.DB.goals.length).toBe(1);
  });
});

d('scheduling — a note is due the day after capture, not the same day [' + TARGET + ']', () => {
  it('newNote schedules its first review for tomorrow', () => {
    const n = p.newNote('a fact');
    expect(n.srs.dueAt).toBe(p.addDays(p.today(), 1));
    expect(n.srs.reps).toBe(0);
    expect(n.srs.ease).toBe(p.EASE_START);
  });

  it('dueNotes() is empty for a note captured today', () => {
    p.addNote('a fact');
    expect(p.dueNotes()).toEqual([]);
  });

  it('dueNotes() returns it once its dueAt arrives, oldest first', () => {
    const a = p.addNote('older fact');
    const b = p.addNote('newer fact');
    a.srs.dueAt = p.addDays(p.today(), -3);
    b.srs.dueAt = p.today();
    const due = p.dueNotes();
    expect(due.map(n => n.id)).toEqual([a.id, b.id]);
  });
});

d('review — SM-2, binary quality only [' + TARGET + ']', () => {
  it('remembered climbs 1 -> 6 -> ease-scaled, same ladder Anki starts from', () => {
    const n = p.addNote('a fact');
    p.reviewNote(n, true);
    expect(n.srs.reps).toBe(1);
    expect(n.srs.intervalDays).toBe(1);
    expect(n.srs.dueAt).toBe(p.addDays(p.today(), 1));

    p.reviewNote(n, true);
    expect(n.srs.reps).toBe(2);
    expect(n.srs.intervalDays).toBe(6);

    const easeAtThird = n.srs.ease;
    p.reviewNote(n, true);
    expect(n.srs.reps).toBe(3);
    expect(n.srs.intervalDays).toBe(Math.round(6 * easeAtThird));
  });

  it('forgetting resets reps and interval to 1 and lowers ease', () => {
    const n = p.addNote('a fact');
    p.reviewNote(n, true); p.reviewNote(n, true);          // reps=2, interval=6
    const easeBefore = n.srs.ease;
    p.reviewNote(n, false);
    expect(n.srs.reps).toBe(0);
    expect(n.srs.intervalDays).toBe(1);
    expect(n.srs.lapses).toBe(1);
    expect(n.srs.ease).toBeLessThan(easeBefore);
    expect(n.srs.dueAt).toBe(p.addDays(p.today(), 1));
  });

  it('ease never drops below EASE_MIN, no matter how many lapses', () => {
    const n = p.addNote('a fact');
    for (let i = 0; i < 20; i++) p.reviewNote(n, false);
    expect(n.srs.ease).toBeGreaterThanOrEqual(p.EASE_MIN);
    expect(n.srs.ease).toBe(p.EASE_MIN);
  });

  it('stamps lastReviewedAt and updatedAt', () => {
    const n = p.addNote('a fact');
    expect(n.lastReviewedAt).toBe(null);
    p.reviewNote(n, true);
    expect(n.lastReviewedAt).not.toBe(null);
    expect(n.updatedAt).toBe(n.lastReviewedAt);
  });

  it('reviewing takes the note back out of dueNotes()', () => {
    const n = p.addNote('a fact');
    n.srs.dueAt = p.today();
    expect(p.dueNotes().length).toBe(1);
    p.reviewNote(n, true);
    expect(p.dueNotes().length).toBe(0);
  });
});

d('deleteNote [' + TARGET + ']', () => {
  it('removes the note outright', () => {
    const n = p.addNote('not useful');
    expect(p.DB.notes.length).toBe(1);
    p.deleteNote(n.id);
    expect(p.DB.notes.length).toBe(0);
    expect(p.noteById(n.id)).toBe(null);
  });
});

d('the ribbon — a "til" signal when notes are due, and the resolver that clears it [' + TARGET + ']', () => {
  it('signals() carries no til chip when nothing is due', () => {
    p.addNote('a fact');                     // due tomorrow, not today
    expect(p.signals().find(s => s.kind === 'til')).toBeUndefined();
  });

  it('signals() carries one til chip, however many notes are due', () => {
    const a = p.addNote('fact one'); a.srs.dueAt = p.today();
    const b = p.addNote('fact two'); b.srs.dueAt = p.today();
    const sig = p.signals().filter(s => s.kind === 'til');
    expect(sig.length).toBe(1);
    expect(sig[0].sev).toBe('mute');
    expect(sig[0].goal).toBe(null);
    expect(sig[0].text).toContain('2 notes');
  });

  it('is FIXABLE, and the resolver shows the oldest due note as written', () => {
    expect(p.FIXABLE.has('til')).toBe(true);
    const a = p.addNote('older fact'); a.srs.dueAt = p.addDays(p.today(), -2);
    const b = p.addNote('newer fact'); b.srs.dueAt = p.today();
    const sig = p.signals().find(s => s.kind === 'til');
    const html = p.sigResolverHTML(sig);
    expect(html).toContain('older fact');
    expect(html).not.toContain('newer fact');
  });

  it('"Remembered" reschedules the note and, once nothing is left due, the signal disappears', () => {
    const n = p.addNote('a fact'); n.srs.dueAt = p.today();
    p.SIGFIX = 'til:til';
    p.sigFixAct('til-remembered', null);
    expect(n.srs.reps).toBe(1);
    expect(p.signals().find(s => s.kind === 'til')).toBeUndefined();
    expect(p.SIGFIX).toBe(null);
  });

  it('"Forgot it" keeps the note due again tomorrow', () => {
    const n = p.addNote('a fact'); n.srs.dueAt = p.today();
    p.SIGFIX = 'til:til';
    p.sigFixAct('til-forgot', null);
    expect(n.srs.lapses).toBe(1);
    expect(n.srs.dueAt).toBe(p.addDays(p.today(), 1));
  });

  it('"Not useful" deletes the note outright', () => {
    const n = p.addNote('a fact'); n.srs.dueAt = p.today();
    p.SIGFIX = 'til:til';
    p.sigFixAct('til-delete', null);
    expect(p.DB.notes.length).toBe(0);
    expect(p.signals().find(s => s.kind === 'til')).toBeUndefined();
  });

  it('reviewing is one undo step, same as any other fix', async () => {
    const n = p.addNote('a fact'); n.srs.dueAt = p.today();
    p.SIGFIX = 'til:til';
    p.sigFixAct('til-remembered', null);
    await h.settle();
    expect(p.DB.notes[0].srs.reps).toBe(1);
    p.undo();
    expect(p.DB.notes[0].srs.reps).toBe(0);
    expect(p.DB.notes[0].srs.dueAt).toBe(p.today());
  });
});

d('migrate 10 -> 11 — notes arrive absent, and a hand-edited file is rebuilt field by field [' + TARGET + ']', () => {
  const file = (notes) => ({
    schema: 10, log: [], goals: [], events: [],
    meta: { rescheduleAt: 3 },
    notes
  });

  it('backfills notes:[] on a pre-11 file with none at all', () => {
    const doc = { schema: 10, log: [], goals: [], events: [], meta: {} };
    expect(p.migrate(doc).ok).toBe(true);
    expect(doc.notes).toEqual([]);
    expect(doc.schema).toBe(p.SCHEMA);
  });

  it('keeps a well-formed note as-is', () => {
    const doc = file([{ id:'n1', text:'a real fact', createdAt:'2026-01-01T00:00:00.000Z',
      updatedAt:'2026-01-01T00:00:00.000Z', lastReviewedAt:null,
      srs:{ intervalDays:6, ease:2.6, reps:2, lapses:0, dueAt:'2026-02-01' } }]);
    p.migrate(doc);
    expect(doc.notes.length).toBe(1);
    expect(doc.notes[0]).toEqual({ id:'n1', text:'a real fact', createdAt:'2026-01-01T00:00:00.000Z',
      updatedAt:'2026-01-01T00:00:00.000Z', lastReviewedAt:null,
      srs:{ intervalDays:6, ease:2.6, reps:2, lapses:0, dueAt:'2026-02-01' } });
  });

  it('drops a note with empty or missing text rather than keeping a blank card', () => {
    const doc = file([{ id:'n1', text:'   ' }, { id:'n2' }]);
    p.migrate(doc);
    expect(doc.notes).toEqual([]);
  });

  it('coerces a malformed srs field by field instead of trusting the file', () => {
    const doc = file([{ id:'n1', text:'a fact',
      srs:{ intervalDays:'9', ease:0.1, reps:-4, lapses:'2', dueAt:'not-a-date' } }]);
    p.migrate(doc);
    const s = doc.notes[0].srs;
    expect(s.intervalDays).toBe(9);         // a numeric string is a number
    expect(s.ease).toBe(1.3);               // ease is floored at EASE_MIN
    expect(s.reps).toBe(0);                 // negative reps are not reps
    expect(s.lapses).toBe(2);
    expect(s.dueAt).toBe(p.today());        // an unreadable date falls back rather than sorting wrong forever
  });

  it('floors unrecoverable timestamps at EPOCH rather than trusting the file', () => {
    const doc = file([{ id:'n1', text:'a fact', createdAt:'not a date', updatedAt:123 }]);
    p.migrate(doc);
    expect(doc.notes[0].createdAt).toBe(p.EPOCH);
    expect(doc.notes[0].updatedAt).toBe(p.EPOCH);
  });
});

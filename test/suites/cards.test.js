import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET, isLegacy } from '../harness.js';

/* TIL notes as cards without a model: " :: " Q/A, {brace} and `code` blanks,
   tap-to-hide editing, and the temporary syntax tips. No schema bump — the
   markup lives in the note's own text and only meta.tips is new. Nothing in
   legacy/index.html to pin against. */
const d = isLegacy ? describe.skip : describe;

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });
const due = (text) => { const n = p.addNote(text); n.srs.dueAt = p.today(); return n; };
const open = () => { p.SIGFIX = 'til:til'; return p.sigResolverHTML(p.signals().find(s => s.kind === 'til')); };

d('parseCard — the markup is the card [' + TARGET + ']', () => {
  it('" :: " splits a question from its answer', () => {
    expect(p.parseCard("etcd's client port :: 2379")).toEqual({ kind:'qa', front:"etcd's client port", back:'2379' });
  });
  it('an unspaced :: never splits — std::vector, Class::method, ::1', () => {
    expect(p.parseCard('std::vector grows geometrically').kind).toBe('plain');
    expect(p.parseCard('Class::method is static').kind).toBe('plain');
    expect(p.parseCard('::1 is IPv6 loopback').kind).toBe('plain');
  });
  it('a " :: " inside backticks is code, not a separator', () => {
    const c = p.parseCard('`f :: Int -> Int` is a type signature');
    expect(c.kind).toBe('cloze');
    expect(c.parts[0]).toEqual({ text:'f :: Int -> Int', code:true, blank:true });
  });
  it('" :: " with nothing on one side is not a card', () => {
    expect(p.parseCard('dangling :: ').kind).toBe('plain');
  });
  it('braces and backticks are blanks, counted', () => {
    const c = p.parseCard('kube-proxy runs on {every node} via `iptables`');
    expect(c.kind).toBe('cloze');
    expect(c.blanks).toBe(2);
    expect(c.parts.map(x => x.text)).toEqual(['kube-proxy runs on ', 'every node', ' via ', 'iptables']);
  });
  it('"{ }" and escaped \\{ \\` are literal, not blanks', () => {
    expect(p.parseCard('an empty { } is a typo').kind).toBe('plain');
    const c = p.parseCard('JSON objects start with \\{ and end with \\}');
    expect(c.kind).toBe('plain');
    expect(c.parts[0].text).toBe('JSON objects start with { and end with }');
  });
  it('a plain note stays plain', () => {
    expect(p.parseCard('sets are unordered').kind).toBe('plain');
    expect(p.isCard('sets are unordered')).toBe(false);
    expect(p.cardLabel('a {b} `c`')).toBe('2 blanks');
    expect(p.cardLabel('q :: a')).toBe('Q/A');
  });
});

d('cardHTML — hidden until revealed, and escaped either way [' + TARGET + ']', () => {
  it('a cloze hides every blank at once, then shows them', () => {
    const t = 'runs on {every node} via `iptables`';
    const shut = p.cardHTML(t, false);
    expect(shut).not.toContain('every node');
    expect(shut).not.toContain('iptables');
    expect(shut.match(/cloze gap/g).length).toBe(2);
    const shown = p.cardHTML(t, true);
    expect(shown).toContain('every node');
    expect(shown).toContain('<code>iptables</code>');
  });
  it('a Q/A shows the front only, then the back', () => {
    expect(p.cardHTML('port :: 2379', false)).not.toContain('2379');
    expect(p.cardHTML('port :: 2379', true)).toContain('2379');
  });
  it('escapes HTML inside a blank', () => {
    expect(p.cardHTML('{<b>x</b>}', true)).toContain('&lt;b&gt;');
  });
});

d('toggleHide — the Edit box\'s Hide button [' + TARGET + ']', () => {
  it('wraps a selection, trimming its edge whitespace', () => {
    const r = p.toggleHide('runs on every node', 7, 18);   // " every node"
    expect(r).toEqual({ ok:true, text:'runs on {every node}', start:8, end:20 });
  });
  it('a bare caret takes the word under it', () => {
    expect(p.toggleHide('runs on every node', 10, 10).text).toBe('runs on {every} node');
  });
  it('selecting inside a blank, or the blank itself, brings it back out', () => {
    expect(p.toggleHide('on {every node}', 4, 14).text).toBe('on every node');
    expect(p.toggleHide('on {every node}', 3, 15).text).toBe('on every node');
    expect(p.toggleHide('on {every} node', 5, 5).text).toBe('on every node');     // a caret inside a blank brings it back out
  });
  it('refuses a selection spanning a line break or another blank', () => {
    expect(p.toggleHide('a\nb', 0, 3).ok).toBe(false);
    expect(p.toggleHide('x {y} z', 0, 7).ok).toBe(false);
  });
});

d('review — Show answer, then grade [' + TARGET + ']', () => {
  beforeEach(() => { p.DB.meta.tips.off = true; });

  it('a card offers Show answer, not a grade, until revealed', () => {
    due('port :: 2379');
    const html = open();
    expect(html).toContain('data-fix="til-reveal"');
    expect(html).not.toContain('data-fix="til-remembered"');
    expect(html).not.toContain('2379');
  });
  it('revealing is not an undo step and changes nothing stored', async () => {
    const n = due('port :: 2379');
    open();
    const before = JSON.stringify(p.DB.notes);
    p.sigFixAct('til-reveal', null);
    await h.settle();
    expect(p.TIL_REVEAL).toBe(n.id);
    expect(JSON.stringify(p.DB.notes)).toBe(before);
    const html = p.sigResolverHTML(p.signals().find(s => s.kind === 'til'));
    expect(html).toContain('2379');
    expect(html).toContain('data-fix="til-remembered"');
  });
  it('the ribbon itself repaints — not just the HTML the resolver would produce', async () => {
    due('port :: 2379');
    open(); p.render(); await h.settle();
    const dom = () => h.document.querySelector('#signals .sigfix').innerHTML;
    expect(dom()).toContain('data-fix="til-reveal"');
    p.sigFixAct('til-reveal', null); await h.settle();
    expect(dom()).toContain('2379');
    expect(dom()).toContain('data-fix="til-remembered"');
    p.sigFixAct('til-edit', null); await h.settle();
    expect(h.document.querySelector('#fxNote')).toBeTruthy();
    p.sigFixAct('til-edit-cancel', null); await h.settle();
    expect(h.document.querySelector('#fxNote')).toBe(null);
  });
  it('a plain note still grades in one tap, as in v1', () => {
    due('sets are unordered');
    expect(open()).toContain('data-fix="til-remembered"');
  });
  it('grading keeps the resolver open on the next due item and clears the reveal', () => {
    const a = due('first :: 1'); a.srs.dueAt = p.addDays(p.today(), -1);
    due('second :: 2');
    open();
    p.sigFixAct('til-reveal', null);
    p.sigFixAct('til-remembered', null);
    expect(a.srs.reps).toBe(1);
    expect(p.SIGFIX).toBe('til:til');
    expect(p.TIL_REVEAL).toBe(null);
    const html = p.sigResolverHTML(p.signals().find(s => s.kind === 'til'));
    expect(html).toContain('second');
    expect(html).not.toContain('>2<');
  });
  it('Save rewrites the text and keeps the schedule', () => {
    const n = due('kube-proxy runs on every node');
    n.srs.reps = 3; n.srs.intervalDays = 15;
    open();
    p.sigFixAct('til-edit', null);
    expect(p.sigResolverHTML(p.signals().find(s => s.kind === 'til'))).toContain('id="fxNote"');
    h.document.querySelector('#fxNote').value = 'kube-proxy runs on {every node}';
    p.sigFixAct('til-save', null);
    expect(n.text).toBe('kube-proxy runs on {every node}');
    expect(n.srs.reps).toBe(3);
    expect(n.srs.intervalDays).toBe(15);
    expect(p.TIL_EDIT).toBe(null);
  });
  it('an edit is one undo step', async () => {
    const n = due('plain fact');
    open();
    p.sigFixAct('til-edit', null);
    h.document.querySelector('#fxNote').value = 'plain {fact}';
    p.sigFixAct('til-save', null);
    await h.settle();
    p.undo();
    expect(p.DB.notes[0].text).toBe('plain fact');
  });
  it('an emptied edit is refused, not saved as a blank note', () => {
    const n = due('a fact');
    open();
    p.sigFixAct('til-edit', null);
    h.document.querySelector('#fxNote').value = '   ';
    p.sigFixAct('til-save', null);
    expect(n.text).toBe('a fact');
  });
});

d('tips — temporary cards that teach the syntax [' + TARGET + ']', () => {
  it('nothing until the first note exists', () => {
    expect(p.pendingTips()).toEqual([]);
    expect(p.signals().find(s => s.kind === 'til')).toBeUndefined();
  });
  it('the first capture starts the clock and the chip appears the same day', () => {
    p.doCapture('til: a fact');
    expect(p.DB.meta.tips.since).toBe(p.today());
    expect(p.pendingTips().length).toBe(p.TIPS.length);
    const sig = p.signals().find(s => s.kind === 'til');
    expect(sig.text).toContain('tips on card syntax');
  });
  it('tips queue ahead of due notes', () => {
    due('a fact');
    expect(p.tilQueue()[0].tip).toBeTruthy();
    expect(open()).toContain('Tip');
  });
  it('a tip demo is a working card: Show answer, then Got it retires it', () => {
    p.addNote('a fact');
    expect(open()).not.toContain('2379');
    p.sigFixAct('til-reveal', null);
    expect(p.sigResolverHTML(p.signals().find(s => s.kind === 'til'))).toContain('2379');
    p.sigFixAct('tip-got', null);
    expect(p.DB.meta.tips.seen).toEqual(['qa']);
    expect(p.pendingTips().length).toBe(p.TIPS.length - 1);
  });
  it('tips are never notes — nothing about them lands in DB.notes', () => {
    p.addNote('a fact');
    open();
    p.sigFixAct('tip-got', null);
    expect(p.DB.notes.length).toBe(1);
  });
  it('"No more tips" retires them all and the chip goes when nothing is due', () => {
    p.addNote('a fact');
    open();
    p.sigFixAct('tip-off', null);
    expect(p.pendingTips()).toEqual([]);
    expect(p.signals().find(s => s.kind === 'til')).toBeUndefined();
    expect(p.SIGFIX).toBe(null);
  });
  it('they expire on their own TIP_DAYS after the clock starts', () => {
    p.addNote('a fact');
    p.DB.meta.tips.since = p.addDays(p.today(), -(p.TIP_DAYS + 1));
    expect(p.pendingTips()).toEqual([]);
  });
  it('the capture-bar syntax reminder retires after HINT_UNTIL notes use the syntax', () => {
    expect(p.wantsSyntaxHint()).toBe(true);
    for(let i = 0; i < p.HINT_UNTIL; i++) p.addNote('q' + i + ' :: a');
    expect(p.wantsSyntaxHint()).toBe(false);
  });
  it('capture names the card kind in its hint and its toast', () => {
    p.captureHint('til: port :: 2379');
    expect(h.document.querySelector('#captureHint').textContent).toContain('TIL card · Q/A');
    p.captureHint('til: plain fact');
    expect(h.document.querySelector('#captureHint').textContent).toContain('splits Q/A');
  });
});

d('meta.tips — backfilled and coerced, no schema bump [' + TARGET + ']', () => {
  it('a file without tips gets the default', () => {
    const doc = { schema: 11, log: [], goals: [], events: [], meta: {}, notes: [] };
    expect(p.migrate(doc).ok).toBe(true);
    expect(doc.meta.tips).toEqual({ seen:[], off:false, since:null });
  });
  it('a hand-edited tips field is rebuilt field by field', () => {
    const doc = { schema: 11, log: [], goals: [], events: [], notes: [],
      meta: { tips: { seen:['qa', 7, null], off:'yes', since:'soon' } } };
    p.migrate(doc);
    expect(doc.meta.tips).toEqual({ seen:['qa'], off:true, since:null });
  });
});

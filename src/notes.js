import { DB, save } from './store.js';
import { addDays, daysBetween, esc, today, uid } from './util.js';

/* ===================== [SECTION: NOTES] =====================
   "Today I learned" — a short capture with no goal behind it, on its own
   spaced-repetition schedule instead of resurfaced by an AI-written question.

   v1 stops at resurfacing the note exactly as written: dumb but reliable. A
   generated quiz question is a real v2, not built here — cost, latency and
   quality variance on a per-note LLM call are a second, separable bet, and
   nothing below assumes it's coming. See claude/ply-features-and-roadmap.md.

   Binary quality only, not Anki's five-point scale: "remembered" or "forgot" is
   the whole judgment a resurfaced note with no question asks for. That maps onto
   a plain SM-2 — ease moves by a fixed step instead of the graded formula,
   because a fixed step is all two inputs can support without inventing
   precision the answer never had.

   Deliberately NOT synced yet: notes rides in DB, so undo/redo and export/import
   already cover it for free, but it sits outside the per-record updatedAt/SHADOW
   machinery in store.ts — that machinery exists for the cross-device merge
   Prompt 4 hasn't built. Wiring it in is a few lines the day that merge needs it,
   not now.
------------------------------------------------------------------------ */
export const EASE_START = 2.5;
export const EASE_MIN = 1.3;
export const EASE_STEP = 0.15;
/* new notes don't nag the day they're captured — first review lands the day after */
export const FIRST_INTERVAL = 1;

export function blankSrs(){
  return { intervalDays:0, ease:EASE_START, reps:0, lapses:0, dueAt: addDays(today(), FIRST_INTERVAL) };
}
export function newNote(text){
  const now = new Date().toISOString();
  return { id:uid(), text:String(text||'').trim(), createdAt:now, updatedAt:now,
           lastReviewedAt:null, srs:blankSrs() };
}
/* Capture never blocks, same rule as a goal: an empty capture files nothing
   rather than a blank note nobody will ever be able to review meaningfully. */
export function addNote(text){
  const n = newNote(text);
  if(!n.text) return null;
  DB.notes.push(n);
  tipsClockStart();
  save();
  return n;
}
export function noteById(id){ return DB.notes.find(n=>n.id===id) || null; }
/* An edit changes what the card asks, not how well you know it — the schedule
   stays. Turning a plain note into a cloze card mid-life is the common case,
   and resetting it to day 1 would punish exactly the tidy-up this exists for. */
export function updateNote(id, text){
  const n = noteById(id), v = String(text||'').trim();
  if(!n || !v) return null;
  n.text = v;
  n.updatedAt = new Date().toISOString();
  save();
  return n;
}
export function deleteNote(id){
  DB.notes = DB.notes.filter(n=>n.id!==id);
  save();
}

/* Oldest-due first, so a backlog that built up clears in the order it built up
   rather than however DB.notes happens to be ordered. */
export function dueNotes(k=today()){
  return DB.notes.filter(n=>n.srs.dueAt<=k).sort((a,b)=>a.srs.dueAt.localeCompare(b.srs.dueAt));
}

/* SM-2, binary. Remembered climbs the same 1 -> 6 -> ×ease ladder Anki starts
   from; forgetting drops straight back to day 1 and nudges ease down — never
   below EASE_MIN, so a note that keeps getting forgotten still comes back
   inside a week rather than drifting toward "never asked again". */
export function reviewNote(note, remembered){
  if(!note) return null;
  const s = note.srs;
  if(remembered){
    s.reps++;
    s.intervalDays = s.reps===1 ? 1 : s.reps===2 ? 6 : Math.round(s.intervalDays*s.ease);
    s.ease = s.ease + EASE_STEP/2;    // a small climb — this isn't graded, so it shouldn't run away
  } else {
    s.lapses++; s.reps=0; s.intervalDays=1;
    s.ease = Math.max(EASE_MIN, s.ease - EASE_STEP);
  }
  s.dueAt = addDays(today(), s.intervalDays);
  note.lastReviewedAt = new Date().toISOString();
  note.updatedAt = note.lastReviewedAt;
  save();
  return note;
}

/* ---------- capture ----------
   A prefix on the one capture bar, not a second box: "til: <text>" or
   "til <text>" files a note instead of running it through the goal classifier.
   The separator has to follow "til" immediately so "till"/"tilth" never
   false-match — there's no word boundary between "til" and a real word that
   starts the same way otherwise. */
export const TIL_RE = /^til[:\-]?\s+/i;
export function isTilCapture(text){ return TIL_RE.test(String(text||'')); }
export function stripTil(text){ return String(text||'').replace(TIL_RE,'').trim(); }

/* ===================== [SECTION: CARDS] =====================
   Turning a note into a question without asking a model to write one. The note
   stays one raw string — the markup IS the card, parsed at review time — so
   editing can never drift from what gets asked, migrate() has nothing new to
   rebuild, and export/import round-trips byte for byte as before.

     front :: back           a question and its answer. Spaced on both sides so
                             `std::vector`, `Class::method` and `::1` never split.
     {hidden words}          a cloze blank
     `code`                  also a blank — in a DevOps note the command is
                             usually the thing worth recalling
     \{  \`                  a literal brace or backtick

   Every blank in a note is hidden at once and the note keeps ONE schedule. Per-
   blank sibling cards (Anki's c1/c2) would each need their own srs — a new
   sub-record collection and a schema bump — and the ask was "quick capture,
   quick review", not a deck. The day that changes, parseCard() already returns
   the blanks as separate parts to hang a schedule on.
------------------------------------------------------------------------ */
const CLOZE_RE = /(?<!\\)`([^`\n]+?)(?<!\\)`|(?<!\\)\{([^{}\n]+)(?<!\\)\}/g;
const QA_RE = /\s::\s/;
const unescape = t => t.replace(/\\([{}`])/g, '$1');

/* Backtick spans are masked before looking for " :: ", so a separator inside
   code (`a :: b` in a Haskell note) is code, not a question. */
function qaSplit(t){
  const masked = t.replace(/(?<!\\)`[^`\n]+?(?<!\\)`/g, m => 'x'.repeat(m.length));
  const m = QA_RE.exec(masked);
  if(!m) return null;
  const front = t.slice(0, m.index).trim(), back = t.slice(m.index + m[0].length).trim();
  return front && back ? {front, back} : null;
}
function clozeParts(t){
  const parts = []; let last = 0, m, blanks = 0;
  CLOZE_RE.lastIndex = 0;
  while((m = CLOZE_RE.exec(t))){
    const inner = m[1] != null ? m[1] : m[2];
    if(!inner.trim()) continue;                 // "{ }" is a typo, not a blank
    if(m.index > last) parts.push({text:unescape(t.slice(last, m.index))});
    parts.push({text:unescape(inner), code:m[1] != null, blank:true});
    last = m.index + m[0].length; blanks++;
  }
  if(last < t.length) parts.push({text:unescape(t.slice(last))});
  return {parts, blanks};
}

/** {kind:'qa', front, back} | {kind:'cloze', parts, blanks} | {kind:'plain', parts} */
export function parseCard(text){
  const t = String(text||'');
  const qa = qaSplit(t);
  if(qa) return {kind:'qa', front:qa.front, back:qa.back};
  const {parts, blanks} = clozeParts(t);
  return blanks ? {kind:'cloze', parts, blanks} : {kind:'plain', parts};
}
export const isCard = text => parseCard(text).kind !== 'plain';

/* Markup inside a Q/A side still reads as markup (code styled, braces gone) but
   nothing on the front is blanked — the back is the answer. */
function partsHTML(parts, reveal){
  return parts.map(p => {
    if(!p.blank) return esc(p.text);
    if(!reveal) return `<span class="cloze gap" aria-label="hidden">${p.code?'<code>…</code>':'…'}</span>`;
    return `<span class="cloze shown">${p.code?`<code>${esc(p.text)}</code>`:esc(p.text)}</span>`;
  }).join('');
}
export function cardHTML(text, reveal){
  const c = parseCard(text);
  if(c.kind === 'qa'){
    const front = partsHTML(clozeParts(c.front).parts, true);
    return reveal
      ? `${front}<div class="cardback">${partsHTML(clozeParts(c.back).parts, true)}</div>`
      : front;
  }
  return partsHTML(c.parts, reveal || c.kind === 'plain');
}
export function cardLabel(text){
  const c = parseCard(text);
  return c.kind === 'qa' ? 'Q/A' : c.kind === 'cloze' ? c.blanks + ' blank' + (c.blanks > 1 ? 's' : '') : '';
}

/* ---------- tap-to-hide ----------
   The edit box's Hide button. Pure on purpose: text + selection in, text +
   selection out, so the rule is testable without a DOM.
     - a bare caret expands to the word under it
     - a selection already inside {…} (or that is {…}) comes back out
     - otherwise it's trimmed and wrapped
   Anything spanning a line break or another blank is refused rather than
   guessed at — nested braces are exactly the case the parser can't read back. */
export function toggleHide(text, start, end){
  let a = Math.min(start, end), b = Math.max(start, end);
  const t = String(text||'');
  if(a === b){
    while(a > 0 && /[^\s{}`]/.test(t[a-1])) a--;
    while(b < t.length && /[^\s{}`]/.test(t[b])) b++;
    if(a === b) return {ok:false, text:t, start, end};
  }
  while(a < b && /\s/.test(t[a])) a++;
  while(b > a && /\s/.test(t[b-1])) b--;
  const sel = t.slice(a, b);
  if(t[a-1] === '{' && t[b] === '}')
    return {ok:true, text:t.slice(0, a-1) + sel + t.slice(b+1), start:a-1, end:b-1};
  if(/^\{[^{}]+\}$/.test(sel))
    return {ok:true, text:t.slice(0, a) + sel.slice(1, -1) + t.slice(b), start:a, end:b-2};
  if(!sel || /[{}\n`]/.test(sel)) return {ok:false, text:t, start, end};
  return {ok:true, text:t.slice(0, a) + '{' + sel + '}' + t.slice(b), start:a, end:b+2};
}

/* ===================== [SECTION: TIPS] =====================
   Temporary cards that teach the syntax above by being examples of it. They are
   not notes: they live in code, never in DB.notes, so they never export, never
   get a schedule and can never be mistaken for something you wrote.

   Temporary three ways: each retires on "Got it", "No more tips" retires the
   lot, and they stop on their own TIP_DAYS after the clock starts — which is the
   first TIL you capture, because a tip about notes before you've written one is
   noise. Only DB.meta.tips ({seen, off, since}) persists.
------------------------------------------------------------------------ */
export const TIP_DAYS = 14;
export const TIPS = [
  { id:'qa',    say:'Put " :: " between a question and its answer — the answer stays hidden until you ask for it.',
    demo:'til: etcd\'s default client port :: 2379' },
  { id:'cloze', say:'Wrap words in {braces} to blank them out. Several blanks in one note are hidden together.',
    demo:'til: kube-proxy runs on {every node} as a {DaemonSet}' },
  { id:'code',  say:'Backticks blank out code too — usually the command is the part worth recalling.',
    demo:'til: `kubectl drain` evicts pods before node maintenance' },
  { id:'edit',  say:'Captured one plain? Open it here, tap Edit, select the words and tap Hide. Its schedule is kept.',
    demo:null }
];
function tipsMeta(){
  const m = DB.meta;
  if(!m.tips || typeof m.tips !== 'object') m.tips = {seen:[], off:false, since:null};
  return m.tips;
}
function tipsClockStart(){ const tp = tipsMeta(); if(!tp.since) tp.since = today(); }
export function pendingTips(k=today()){
  const tp = tipsMeta();
  if(tp.off || !DB.notes.length) return [];
  if(tp.since && daysBetween(tp.since, k) > TIP_DAYS) return [];
  return TIPS.filter(t => !tp.seen.includes(t.id));
}
export function retireTip(id){
  const tp = tipsMeta(); tipsClockStart();
  if(!tp.seen.includes(id)) tp.seen.push(id);
  save();
}
export function tipsOff(){ tipsMeta().off = true; save(); }
/* Tips go first: there are at most four, and each makes the notes behind it
   easier to write. The demo is stripped of its "til:" so it renders as the card
   that capture would actually file. */
export function tilQueue(k=today()){
  return [...pendingTips(k).map(t => ({tip:t, id:'tip:'+t.id, text:t.demo?stripTil(t.demo):null})),
          ...dueNotes(k).map(n => ({note:n, id:n.id, text:n.text}))];
}
/* The capture-bar reminder has its own, quieter exit: once three notes use the
   syntax you evidently know it. */
export const HINT_UNTIL = 3;
export function wantsSyntaxHint(){
  return !tipsMeta().off && DB.notes.filter(n => isCard(n.text)).length < HINT_UNTIL;
}

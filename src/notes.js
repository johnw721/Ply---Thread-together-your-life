import { DB, save } from './store.js';
import { addDays, today, uid } from './util.js';

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
  save();
  return n;
}
export function noteById(id){ return DB.notes.find(n=>n.id===id) || null; }
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

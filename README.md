# Ply — thread your next move

A goal tracker built around one claim: goals don't fail because you forgot them,
they fail because they quietly stop having a next move. Ply makes that state
impossible to hold and hard to ignore.

*A ply is a strand twisted into a thread, a single move in a game tree, and the verb
for working at something steadily. All three are the app.*

Single file. Open `index.html` in a browser. No build step, no server, no network,
no dependencies. Data lives in `localStorage` under `ply.v1`; Export/Import JSON is
in the `⋮` menu. Data saved when this was called Thread is adopted on first load and
the old key is left in place as a backup rather than deleted.

Demo data loads on first run — all nine goal types, a blocked thread, a pending
branch, a repeating standup, two broken-down steps with subtask checklists, and a
four-category weekly budget. `⋮ → Erase everything` starts clean.

## Keyboard

| key | |
|---|---|
| `1` `2` `3` `4` | Day / Week / Quarter / List |
| `/` | focus capture |
| `c` | run the check-in |
| `t` | jump to today |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `Esc` | close a modal, or cancel a drag or an open resolver |

## The rules it enforces

Five ideas do most of the work. Everything below is an implementation of one of them.

1. **Capture never blocks.** A clarifying question is queued, never asked at the
   moment of typing.
2. **No thread is left without a next move.** Completing a step has to produce the
   successor, or the app says so and refuses to call the thread closed.
3. **If it isn't scheduled, it isn't real.** A next step with no calendar slot is a
   signal, and the check-in won't let one stay loose.
4. **Silence is a signal.** Nothing arrives to tell you a goal died; the absence of
   movement is the thing worth surfacing.
5. **Neglect makes it quieter, not louder.** Past a point, nagging has failed, and
   continuing only buries the signals that still matter.

## Data model

```
goal ── threads[] ── steps[] ── subs[]
 │        │            │
 │        │            └─ eventId → the calendar slot it's anchored to
 │        └─ rel: sequential | parallel | conditional | cyclical
 └─ type: one of nine, which decides cadence, gates and auto-successor
```

Nine goal **types**: habit, maintenance, threshold, pipeline, deadline, milestone,
decision, contingent, task. Type drives everything downstream — the cadence used for
silence detection, whether capture queues a gate, and what the next step is called
when one is generated.

Four thread **relationships**: sequential, parallel, conditional (branching),
cyclical (recurring). A goal with several threads is running genuine parallel
workstreams; a pipeline entry is one thread per candidate, carrying its own stage.

A **step** is the unit of work — the thing that gets a calendar slot and a matrix
card. Exactly one step per thread is live at a time. A **sub** is a checklist line
beneath a step, and nesting stops there.

Separate stores: `events` (calendar slots, some repeating), `log` (planned/done
history, capped at 4000 entries), and `meta` (settings, snoozes, learned type
corrections capped at 200, weekly budget, check-in progress, list filter).

## Capture and the classifier

Type a phrase, hit Enter. `classify()` scores it against a rule table and builds the
goal immediately. Gated types (deadline, contingent, decision) and borderline ones
(threshold) still get created — the clarifying question is *queued* rather than
interrupting.

**It learns from being corrected.** The `confirm-type` gate was already collecting
the right answer and `clearGate()` was throwing it away. Every correction — in the
check-in, in the goal editor, or a forced type on a decision conversion — now stores
the phrase's content words against the type you picked. `learnedScore()` runs
alongside the rules and votes; it never overrides them.

Similarity is Dice, deliberately. Scoring shared words against the stored lesson
alone means a short capture can never match a lesson taught by a long phrase.
Scoring against the shorter of the two means one incidental word drags in a long
lesson — "the board meeting" matching "reconcile the quarterly numbers before the
board meeting" — and a one-word lesson hijacks everything containing that word. Dice
penalises both directions. The contribution caps at 8, below the heaviest rule at 9,
so a correction tilts a close call rather than overruling an unambiguous phrase.
Eroding a conflicting older lesson needs a near-identical phrase too, otherwise
teaching it "guitar" would silently wipe what you'd already taught it about
"practice guitar".

The review gate stops asking only on a near-identical match — the case where being
asked again is the actual annoyance. A loose match still scores but still asks.
Capture marks a learned reading with a dot; Settings lists what's remembered and can
forget it all.

## Threads, steps and subtasks

**No thread starts dead.** Every non-dormant goal is created with a live next step.
Deadline-type gets `Map the steps back from <date>`; milestone-type pulls the backlog
head or `Break <goal> into a backlog`; habit / maintenance / threshold get their
cyclical step. Contingent-type is the one exception, by design — it stays dormant
until its trigger fires.

**Finishing something keeps it.** A completed goal used to disappear from every view,
which made completing it indistinguishable from deleting it — in an app whose whole
point is follow-through. Goals now carry a `doneAt`, `finishGoal()` is the one path
in, and the List view has a **Completed** toggle showing the archive newest-first with
what each one took. **Reopen** puts a goal back, and it doesn't come back dead: if it
has no live step it gets one, like everything else here.

**Completing a step produces the next one.** `completeStep()` generates the successor
by type. Where no sensible auto-successor exists — deadline chains, conditional
branches — it returns `needsDefine` and the UI opens a modal that says so. The thread
is not closed until it has a next step.

### Subtasks

Exactly one level: goal → thread → step → sub. Unbounded nesting would force
`currentStep()`, the item stream and every renderer to recurse, and would fill the
matrix with things that aren't really commitments. A sub never becomes a card, never
gets a calendar slot, and never competes to be the thread's next move.

- **Ticking the last one closes the step**, through `completeStep()` rather than
  around it, so the successor is generated, logged and re-booked as by any other route.
- **Unfinished subs carry forward** onto that successor as new records. An open sub is
  still work; dropping it because its parent got ticked is how a checklist quietly
  loses things. Finished ones stay on the closed step as history.
- Undone subs sort above done ones, stably, so a deliberate order survives.
- Progress counts the partial, so a half-ticked checklist moves the quarter bar rather
  than it jumping only when a step closes. Only where a milestone has no explicit
  metric, though — where a goal tracks a real number, subtasks don't inflate it.

## No browser dialogs

`prompt()` and `confirm()` are gone — there were 13 and 6 of them. They block the
whole page, can't be styled or carry context, land outside the app's own modal on a
phone, and give the keyboard nowhere sensible to go. Two shapes replaced them,
chosen by what's already on screen.

**Adding something is an inline field**, always present at the end of its list —
subtasks, backlog items, next steps, pipeline entries. Enter creates and clears
without moving focus, so several can be typed in a row; blank does nothing; Escape
clears. A branch is the same idea with two fields and an add button, because a
branch is a pair. Scheduling opens a date/time row in the step line — with that
day's remaining capacity beside it — instead of chaining two prompts that couldn't
show you either. Marking a thread blocked opens a field for the reason.

**Destructive actions ask in one of two ways.** If a modal is already open, the
button arms itself: the first click turns Delete into "Really delete? Click again",
and it disarms after four seconds, on any other action, or when the modal closes.
Stacking a second dialog over the first is exactly the jarring thing being fixed. If
nothing is open — the `⋮` menu, dropping a gone-quiet goal — there's room for a real
dialog, so `openConfirm()` gives one, and it says that ⌘Z undoes what you're about
to do.

The check-in's three prompts became fields on the wizard card itself: the cadence
number, the blocked reason, and the next step when completing a step that has no
automatic successor.

**Titles are live inputs.** Steps, subs and backlog items are renamed in place,
committed on blur so one edit is one undo step and the modal is never rebuilt under
the caret. Backlog items and subs reorder with up/down controls — arrows beat drag
here because the lists are short and arrows work with a keyboard and on a phone.

## The calendar

Everything reads through the `CAL` adapter (`list` / `on` / `anchor` / `loadOn` /
`loadWeek`). No view or engine function touches `DB.events` directly, which is the
seam a Google Calendar provider drops into later.

**Cyclical goals re-book themselves.** Complete an anchored habit / maintenance /
threshold step and the successor lands in the same slot, one cadence later. Without
it a daily habit is a scheduling chore forever — exactly the friction that makes
people stop opening the app.

**Standing commitments repeat properly.** Manual events carry `recur:{every,until}`,
stored once as a master and expanded into occurrences at read time by `eventsOn()`.
Editing an occurrence edits the series; **Skip this one** drops a single date onto
`skips`. Step anchors never repeat — a next step is a single commitment by
definition, which also keeps `activeItems()` and `signals()` looking only at real,
stored events.

**A day has a ceiling.** `loadOn()` was being computed and then only used to break
ties. There's a configurable budget now — 4h by default, all-day items exempt. Day
and Week show it as a bar, `suggestDay()` fills the first day with room instead of
the emptiest one, the check-in shows free time under each suggested date, and
"Schedule all as suggested" names any day it just pushed over.

## The four views

Three are altitudes over a calendar. The fourth isn't.

- **Day** — timed calendar strip with a now-line, then the Eisenhower matrix. Cards
  drag between quadrants; a card with subtasks shows an `n/m` pill that expands the
  checklist in place. Anything with no slot drops into the tray below.
- **Week** — 7 columns: timed events on top, untimed tasks beneath with quadrant
  colour dots, so priority survives calendar mode. The money budget sits underneath.
- **Quarter** — 13-week roadmap. One row per goal: target window as a band, progress
  fill, scheduled-step dots, deadline marker, today line. The current next step (or
  "waiting on X" / "dormant") reads down the left column. Week density bars sit on
  top; click one to jump to that week.
- **List** — the flat answer to "what have I actually got on". One row per goal:
  type, title, its live step, what it's waiting on, and its subtask checklist. Chips
  along the top toggle goal types on and off, with counts that keep showing what's
  hidden. Sorted worst-first — hard, then warn, then fine, then gone-quiet — so the
  top of the list is the part that needs you.

**Steps, week chips and subtasks all drag onto the calendar.** Anything that knows
which step it belongs to is a drag source: a matrix card, a list row, a week chip, or
a single subtask line. Targets are the quadrants (re-prioritise), the day strip
(schedule at the time it lands on) and — new — each **week column** (schedule on that
day at a sensible time), which was the one view with schedulable items and nowhere to
drop them.

**A subtask drop schedules its parent.** A sub has no calendar slot, by design; the
step is the unit of work. So dragging one books the step it belongs to and floats
that sub to the head of the checklist — the gesture means "this is the bit I'm doing
then", and the checklist order is where that intent lives. The toast says so plainly,
because the thing that moved is not the thing that was dragged. Both halves are one
undo. Dropping a sub on a quadrant re-files its parent the same way.

**Drag a row onto the strip to schedule it.** The List view carries the same
horizontal day strip the Day view uses, with its own day nav, and it's a drop target.
Drag a row onto it and the step is anchored at the time it lands on, snapped to the
quarter hour, on whichever day the strip is showing. A marker follows the pointer
naming the time before you let go. That's the shortest path there is from "this
exists" to "this is on the calendar" — the rule the whole app turns on — and it
replaces opening the goal, finding the step, and filling in a date field.

Only rows with a live step are draggable; a dormant or step-less goal has nothing to
schedule, so it has no grip. Dropping on an already-scheduled row re-slots it rather
than leaving the old slot behind. It's the same pointer-drag engine as the matrix,
extended with a second target type, so touch still starts from the grip and `Escape`
still cancels mid-flight.

The List view otherwise adds no new concepts. It reads the same state as everything
else, so a row can be acted on where it sits: tick a subtask, or click through to
the goal.
`goalState()` collapses a goal to one phrase using the same conditions `signals()`
uses — blocked, dormant, no next step, hushed, unscheduled, slipped, or a date. Type
swatches reuse the quarter view's band palette so a type looks the same wherever it
appears. The filter persists in `meta.listHidden`, and unknown type names are dropped
on load rather than being left to silently blank the list.

**Dragging works on a phone.** HTML5 drag-and-drop never fires on touch, so the
matrix was read-only on mobile despite having a layout for it. It's Pointer Events
now — one path for mouse, touch and pen. Touch drags start from the card's grip,
which carries `touch-action:none`; that removes the scroll-or-drag ambiguity the
browser otherwise resolves for itself. Mouse drags from anywhere on the card. A move
under 6px stays a tap, `Escape` and `pointercancel` bail cleanly, and the click that
ends a drag is swallowed so it doesn't also open the goal. Wiring happens once at
boot — `#view` outlives every render, so the old listeners were being re-added on
each one.

## Weekly money budget

A panel under the week grid. Set a weekly amount, add categories, type a number into
each — the stacked bar resizes live, each block sized to its share of the budget,
with the unallocated remainder hatched at the end. Allocation, not a ledger: one set
of numbers, no per-week history, no record of what was actually spent.

Going over doesn't clip. The bar rescales to the allocation and the budget becomes a
red line across it, so the overshoot is visible rather than hidden — the same
principle as the day capacity bar. With no weekly amount set, blocks fall back to a
relative split of whatever has been allocated.

**Categories can point at a threshold goal**, which is what stops this being a
calculator bolted onto the side. `catProjection()` reads the goal's target and
current, and the row says what the allocation actually buys — "$150/wk clears $5,850
in 39 weeks · Apr 26, 2027" — flagged against a hard deadline, or "needs $217/wk to
hit the deadline" when it's short. **Log** banks that week: it adds to
`smart.current`, completes the goal's contribution step, and lets the cyclical
machinery produce and re-book the next one. Only threshold goals are offered, and a
link left dangling by a retype or a deleted goal degrades to no projection rather
than reading someone else's units.

## Signals

`signals()` runs over every thread on each render and surfaces: quiet past its
cadence, no next step, unresolved branch, slipped past its slot, next step not on the
calendar, blocked too long, a queued gate, a deadline inside 14 days. That's the
ribbon under the header, sorted hard-first.

**One chip per *kind*, not per thread.** Twelve signals across six goals is a wall,
and a wall gets ignored — which would defeat the entire point. Kinds with several
threads behind them collapse to `6 threads · next step not on the calendar` and
expand on click. The row never exceeds five chips, with the rest behind `+n more`.

**Resolved where you find them.** The check-in used to be the only door to answering
a gate, resolving a branch, giving a dead thread a next step, or scheduling a loose
one. That made a weekly ritual load-bearing for the whole app — skip three Sundays
and it silently accumulates debt payable nowhere else.

A chip marked `fix` now opens a resolver under the ribbon: a date for a deadline
gate, a type select for a `confirm-type`, a step field for a thread with none, a
date/time with that day's remaining capacity for an unscheduled step, a button per
condition for a branch, unblock for a blocked thread. The markup is local but every
action calls the same engine functions `ckAct` calls, so there's one implementation
of each rule — answering a `confirm-type` inline teaches the classifier exactly as
the check-in would. `quiet` and `deadline` stay unfixable on purpose: judgment calls,
not data gaps.

**Neglect makes it quieter.** Past `3×` the quiet limit a thread goes hushed: it
stops emitting anything, drops off the check-in agenda, and collapses into one muted
chip offering the two honest options, revive or drop. The ladder is silent up to the
limit, warn to 2×, hard to 3×, then it gives up. `hushed()` is computed from
`lastMovement` rather than stored, so movement brings a thread back on its own and
there's no flag to get stuck. Blocked threads never hush — someone else's delay isn't
neglect — and a deadline inside 14 days still fires however long you've ignored it.

**Snoozing** mutes a chip for 7 days (undoable; expired entries pruned on load). It
mutes the *ribbon only* — `checkinAgenda()` doesn't consult `signals()`, so a snoozed
thread still gets asked about on Sunday. Quieting the nag is not the same as deciding.

**Contingent stays quiet.** Dormant threads are excluded from signals *and* the
agenda. Blocked threads are not — they show as "still waiting on X".

## Weekly check-in

`c` or the header button. A queue of cards, one decision each:

intro → queued gates → unresolved branches → threads with no next step → blocked
threads → threads with no logged movement → schedule everything loose → summary.

It's a flow, not a dashboard. Each card forces an answer: done-and-next, didn't
happen, blocked, or "the cadence is wrong". The last stage won't let a next step stay
off the calendar.

**It ends with the week, not a score.** The summary used to be a report card —
threads answered, percentage hit, what's still wrong. Grading someone at the end of a
chore is a poor reason to come back next week. It now opens with what's actually on
the calendar for the next seven days, day by day, the three things that carry the
week (urgent-important first, soonest first), and how many next steps are still
loose. The follow-through number survives as one line at the bottom.

**Bounded and resumable.** A ritual survives when its cost is known and small; an
unbounded queue is 3 cards one week and 30 the next, and the 30-card week is the one
that doesn't happen. Debt cards cap at `CK_MAX` (6) — the intro says how many were
deferred and points at the ribbon, where any of them can be fixed without coming back
here. Intro, scheduling and summary are never cut. Position persists to
`meta.checkinProgress` and resumes on reopen, but only within the same day: after
that the queue has moved on and resuming at card 4 of a different list would be
nonsense.

Cadence is switchable in Settings — fixed weekday (default Sunday) or every N days
since the last one. It nudges on load when due.

## Legibility, touch and focus

Three things were measured rather than eyeballed, and all three came back worse than
they looked.

**Contrast.** `--dim2` scored 3.09–3.61 against the app's surfaces — under the 4.5
WCAG asks for body text — and it was applied 32 times to the *smallest* type in the
app: dates, times, subtask counts, capacity readouts, budget projections, type
labels. The lowest-contrast colour was carrying the smallest text, which is exactly
backwards. `--dim` and `--dim2` now clear 4.5:1 on every surface, a separate
`--faint` exists for genuine decoration, and nothing renders below 10px.

**Touch targets.** The reorder arrows computed to about 13px tall and the list grip
had no vertical padding at all. A `@media (pointer:coarse)` block grows the target
without changing the ink, so the desktop layout is untouched; the few controls that
must stay visually small get an invisible thumb-sized hit area instead.

**The phone header.** Brand, four zoom buttons, capture, undo, redo, "Weekly
check-in" and a menu do not fit 375px — which I only found by rendering the real
markup and CSS at that width rather than trusting the breakpoint. Capture and the
zoom bar each take a full row now, the check-in label shortens, view nav wraps, and
the type chips scroll instead of stacking.

**Focus.** One `:focus-visible` rule existed, in a keyboard-first app. Everything
interactive shares a ring now, and modals are real dialogs: `role="dialog"`,
`aria-modal`, a Tab trap so focus can't walk out into the live page behind, and
focus returned to whatever opened them on close.

## Render

`render()` replaces `#view` wholesale on every mutation, which is simple and fast
enough — but it used to lose your place. Scroll position and the focused element
(with its caret) are captured before the swap and restored after, so completing
something halfway down a long list doesn't throw you back to the top, and an inline
field being typed into survives the re-render it triggers.

Inside a render pass, `activeItems()` and `signals()` are memoised and `eventById()`
reads an id-keyed map instead of scanning `DB.events` — `activeItems()` was running
4–8 times per render, and the quarter view did a linear scan per step. Roughly a
third off render time at scale.

The memo is deliberately null outside that pass. A cache that outlived the render
would hand stale answers to anything that mutated the DB and read back without
saving — a bug waiting to happen rather than a speed-up worth having. The test suite
caught exactly that when the first version cleared on `save()` instead.

## Safety nets

**Undo.** `⌘Z` reverses the last thing that changed data — capture, completing a
step, a drag, goal edits, a check-in answer, a budget edit, an import, even
`Erase everything`. Snapshots are whole-DB, 25 deep, in memory only.
`checkpoint(label)` runs at the top of a user action and commits on the next tick, so
an action that saves three times is still one undo step and a cancelled `prompt()`
leaves nothing on the stack. Restoring keeps *this tab's* zoom and cursor rather than
the snapshot's, so undo never yanks the view. It refuses while a modal is open, so it
can't rewind under an edit in progress.

> If you extend this: `undo()` swaps the entire object graph via `JSON.parse`, so any
> held reference to a goal, thread or step goes stale. The app keys off ids
> everywhere for exactly this reason.

**Two tabs don't clobber each other.** Each tab holds its own `DB`, so without a
listener the last `save()` silently wins. A `storage` event adopts the other tab's
state and re-renders — keeping this tab's zoom and cursor, and clearing the undo
stack, whose snapshots describe a history that no longer exists. If a modal or the
check-in is open the update is deferred until it closes.

**Schema and migration.** Exports carry a `schema` number (currently 5). Everything
entering the app — from `localStorage` or an imported file — goes through
`migrate()`, which backfills fields added since, coerces malformed structures rather
than trusting them, and refuses a file written by a newer build instead of
half-loading it. Unreadable stored data falls back to a clean DB.

## Decisions taken

1. **Google Calendar read-only or read/write? → read/write.** Deferred, but the seam
   is built and `CAL.writable` already gates whether `anchor()` may push remotely.
   Read-only breaks rule 3: if the app can't put the next step on the calendar, "if it
   isn't scheduled it isn't real" becomes a manual copy step, which is the friction
   that kills it.
2. **Threshold: auto-detect or gate? → auto-detect**, with a `confirm-type` question
   queued into the check-in. Capture stays fast and the borderline call gets reviewed
   later — and now only *once*, because the answer is kept and reused on phrases of
   the same shape.
3. **Check-in cadence → both**, switchable in Settings.
4. **Subtask depth → one level.** See above; unbounded nesting costs every renderer
   and buys a matrix full of non-commitments.
5. **Budget: allocation or ledger? → allocation.** Tracking actual spend is a
   different app; the goal link is what earns this one its place here.

## Known gaps

- **Mobile is verified by rendering, not by running.** The header, ribbon, strip,
  filter chips and list rows were rendered at 375px with the real stylesheet and
  fixed from what that showed. It has still never run on an actual phone, and the
  Day matrix, Week grid, budget rows and check-in cards were not part of that pass.
- **Drag hit-testing is untested.** jsdom has no layout, so `elementFromPoint` is
  stubbed in the suites — the handler logic is covered, the geometry isn't.
- Google Calendar is a seam, not an integration.
- The follow-through log is minimal: planned vs done per goal over 28 days, plus a
  streak.
- Pipeline stages are functional but plain — each entry is a parallel thread carrying
  its own stage.
- Editing a recurring event's date shifts the whole series; there's no "this and all
  future occurrences".
- No search across goals — the List view filters by type and completion, but there's
  no text search.
- No full accessibility audit. Contrast, focus rings, dialog semantics and the Tab
  trap are done; screen-reader flow, live-region announcements for the toast, and
  reduced-motion preferences are not.
- Arm-to-confirm has no visible countdown; the four-second lapse is silent.

## Verification

`node` + `jsdom`, seven suites, no page errors.

| suite | assertions | covers |
|---|---|---|
| core | 45 | classifier across all nine types, gate queueing, date extraction, auto-next-step, all four thread relationships, silence detection, agenda construction, three renderers, HTML escaping, a full check-in click-through, save/load round trip |
| undo · ribbon · tabs | 38 | undo/redo, no-op checkpoints staying off the stack, multi-save actions collapsing to one step, view state surviving a restore; ribbon grouping and the five-chip cap, snooze one/all, snoozed threads still reaching the agenda; `storage` adoption, malformed events ignored, deferral while a modal is open |
| repeats · capacity · learning · drag | 84 | migration accept/refuse paths, occurrence expansion, virtual ids, skipping an occurrence and the series head, cyclical re-anchoring; budget maths; learned corrections matching, reinforcing and suppressing the review gate; mouse drag, tap-is-not-a-drag, touch scroll vs grip drag, `Escape` cancel, listeners surviving re-renders |
| audit | 60 | export→import→export byte-identical, a hand-written v1 file migrated then actually rendered and walked, `localStorage` migration, unreadable data falling back clean, five habit completions booking exactly five follow-ups, classifier precision cases caught by a probe |
| money budget | 69 | proportional widths summing to 100%, live typing without DB writes, commit-on-change as one undo step, over-allocation rescaling and the budget line, add/remove undoable, projection maths, logging a contribution advancing the goal, malformed budget data coerced, a deleted goal degrading gracefully |
| check-in independence | 68 | the full escalation ladder at each boundary, hushed threads leaving the agenda, blocked and near-deadline exemptions, every inline resolver end to end, the queue cap, progress persisting and resuming, stale progress discarded |
| subtasks | 84 | 3→4 migration and coercion, subs staying off the matrix, last-tick closing the step through the normal path, carry-forward, ordering, partial progress, in-place renaming with blanks ignored, reorder both ways, the card pill and expansion, the checklist not hijacking the drag |
| list view | 54 | reachable by button and by `4`, one row per live goal with the type counts adding up, every `goalState()` branch including a blocked goal still reporting its step, worst-first sorting, toggling hiding and restoring rows undoably, the all-hidden empty state and its way back, the filter persisting and junk in it discarded, subtasks expanding and ticking from a row, rows opening the goal while the pill doesn't |
| no browser dialogs | 75 | a source scan proving zero `prompt`/`confirm`/`alert` remain, plus the natives stubbed to throw while every flow is driven: inline add for subtasks, backlog, steps and pipeline entries with blanks refused and focus retained; two-field branch add; the scheduling row saving date, time and all-day; the blocked reason with a fallback; arm-to-confirm arming, disarming on another action and on modal close, and refusing to remove a last thread; the in-app dialog cancelling, confirming and undoing; and the three check-in fields |
| drag to schedule | 52 | the shared strip appearing in both List and Day; only step-bearing rows draggable and gripped; a drop anchoring at the landed-on time, on the shown day, snapped to the quarter hour and clamped at the edges; re-slotting without orphaning the old event; the live marker and highlight; cancel and off-target drops changing nothing; tap still opening the goal while a drag doesn't; touch needing the grip; the matrix drag unaffected |
| archive · render · summary | 55 | schema 5→6 backfilling `doneAt`, finishing from three paths, the archive rendering with its date and a reopen that doesn't return a dead goal, the toggle and its count, scroll and caret surviving a re-render, and a summary that leads with the week ahead and demotes the score |
| escaping | 25 | a hostile string written into 20 user-writable fields and rendered across every surface — four views, ribbon, resolver, goal editor, settings, event modal, budget, convert, define-next and every check-in card — asserting zero injected nodes and that nothing executed |
| rename | 13 | data written under the old `thread.v1` key adopted on first load, migrated forward, rewritten under `ply.v1`, and the old key left intact as a backup; title, header, error messages and export stamp all renamed |
| legibility · touch · focus | 43 | every palette colour meeting 4.5:1 computed from the source, `--faint` staying rare, nothing under 10px, the coarse-pointer block resizing each named control, the phone header rules, the focus ring's reach, and the Tab trap wrapping at both ends while leaving the middle alone plus focus returning to the opener |
| step + subtask drops | 31 | subtask lines being drag sources in the card and the list with a grip, a sub drop scheduling the parent at the dropped time and floating that sub without adding, removing or re-doning anything, both halves undoing as one, week columns scheduling on their own day, a sub dropped on a quadrant re-filing its parent, and the checkbox still being a checkbox rather than a handle |
| **total** | **751** | |

What the suites can't tell you: anything about layout, reflow or how it actually
looks. Every visual claim above was checked by extracting the real markup and CSS and
rendering it, not by reading the code.

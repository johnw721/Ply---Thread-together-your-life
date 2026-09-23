# Follow-ups found during the Prompt 0 migration

Filed rather than fixed: Prompt 0 is a structural migration with zero intended behaviour
change, so anything below is out of scope for it. Each is pinned by a test named
`KNOWN GAP` where one exists, so the migration cannot change it silently in either
direction.

## 1. The check-in's inline fields only existed on the `quiet` card — fixed

`renderCheckin()` used to draw the `CKROW` inline row (cadence / waiting-on / next step)
only in the `quiet` branch. Two buttons elsewhere set `CKROW` and then re-rendered a card
that had no field for it:

- **`nostep` card → "Actually it's blocked"** set `CKROW='blocked'` but rendered no
  `#ckWho` and no `block-save`. The thread was never marked blocked.
- **`blocked` card → "Unblocked — define next"**, when the thread had no live step, set
  `CKROW='next'` and rendered no `#ckNextStep`. The thread was left active *and*
  step-less — the exact state rule 2 exists to prevent.

Both branches in `src/checkin.jsx` now check `CKROW` the same way the `quiet` branch
always has: when it's set, the body swaps to `<Row card={c} />` and the footer to
`<RowFoot />`, reusing the mechanism rather than adding a second one. The two
`KNOWN GAP` tests in `checkin.test.js` were replaced with real coverage (open the field,
type into it, save it, and — for the blocked→next path — confirm the thread ends up
active with a live step, not step-less) plus a cancel-path test. All four are gated
`isLegacy ? describe.skip : describe`: `legacy/index.html` is the pre-migration monolith
and never receives this fix, so they run on `[src]` only, same pattern `footprint.test.js`
and `reschedule.test.js` already use for schema-gated behaviour.

## 2. The README's schema number — fixed

The body text said "currently 5" while the code was at 6, then 7. It reads 7 now, and
`Schema` in `src/schema.ts` is a union of the versions this build knows how to read, so
the next drift is a compile error rather than a documentation one.

## 3. The weekly budget panel was still built as a string — fixed

`viewBudget()`, `budgetBarHTML()` and `budgetSummaryHTML()` are gone; the markup is
`<BudgetPanel>` in `src/budget.jsx`. Same contract the check-in and the goal editor
took: `wireView()` still routes input to `paintBudget()`, change to `commitBudget()` +
`save()` and clicks to `budAct()`, and `commitBudget()` still reads the fields out of the
DOM by class, so every selector survived.

The live repaint while typing is the part that needed care. `paintBudget()` no longer
rewrites the bar's and the summary's `innerHTML`; it reads the fields into a `BUD_DRAFT`
signal and the component redraws from that. The DB is still written only on change, so
one edit is still one undo step. The draft keeps the fields' raw strings, so an emptied
amount stays empty instead of being written back as `0` under the caret, and it records
the saved budget it was typed over, so an undo, an add or a sync that changes the budget
drops it and the panel shows the DB, as the string rebuild did. Projections and the Log
button still follow what is saved, not what is being typed. `budgetState()` is now
`budgetFigures()` applied to the DB, so the saved view and the typing view share one
calculation.

**Coverage first:** `test/suites/budget.test.js`, which replaces the 69-assertion
money-budget suite that could not be recovered. 59 assertions were green against the
string version on `[src]` and 49 on the monolith (committed spend and one other are
`[src]`-only) before any code changed. Deliberately breaking the string version showed
they catch it: writing on every keystroke fails 8, rebuilding the fields fails 11, and
rewriting an emptied amount to `0` fails 1. Four `footprint.test.js` assertions that
matched `viewBudget()`/`budgetBarHTML()` output now read the rendered DOM.

**Bug found and fixed:** tabbing between fields lost focus. The wrapper re-rendered after
every `save()`, and because a committed edit changes the html string, the whole panel's
`innerHTML` was replaced a tick later, destroying the field focus had just moved into.
The monolith never re-rendered on that path, so this came in with the migration. A 60th
assertion pins it: it fails on the string version, passes on the monolith and on the
component. Checked in real Chromium as well: on the string build, Tab out of an edited
amount left focus on `<body>`; after, it lands on the next control.

Real-Chromium screenshots of the demo panel, saved and mid-typing, before vs after: same
size, max per-pixel difference 42/255, from whitespace between text nodes; nothing
rearranged.

## 4. Two PWA assertions fail, on both targets

`hands the notification to the service worker when there is one`, and `the install hint is
dismissible, and stays dismissed`. They fail identically against `legacy/index.html` and
against `src/`, so they predate this migration and are not caused by it. They are left
failing rather than skipped or adjusted, because a suite that goes green by being edited
is worth nothing.

## 5. The goal editor was still built as a string — fixed

`goalEditorHTML()` and its row builders (`schedRowHTML`, `footRowHTML`, `subListHTML`,
`ordControls`) are gone; the markup is `<GoalEditor>` in `src/goal-editor.jsx`. Same
contract the check-in took: `geAct()` and `saveGoalFields()` are unchanged and still read
values out of the DOM by class and id, so every selector survived.

The dialogs suite covered the inline-add fields and arm-to-confirm, but not the footprint
row, reordering, rename-in-place, the SMART fields, the type-change gate, finish/convert,
unblock/fire or pipeline entries. `test/suites/goal-editor.test.js` pinned all of those
first, green against the monolith (37, footprint block skipped as it postdates it) and the
string version (44), before anything changed.

What's different: `refreshGoal()` re-renders instead of rewriting `innerHTML`, so the
focused field keeps its node and its focus. Two `[src]`-only assertions pin that — the
monolith can't pass them. Every field is still given its value explicitly, including the
empty ones, so a refresh resets typed-but-unsaved text exactly as the rebuild did; the
editor reads no signals, so it redraws only when `refreshGoal()` says so, never on a
`render()` of the views behind it.

The five string builders were dropped from `test/bridge.js` and `src/debug.js` — no suite
called them. `debug.js` was edited by hand rather than regenerated: `gen-debug` would drop
the TIL-notes exports (`parseCard`, `cardHTML`, `TIL_EDIT`, ...), which `c1b7d1f` added to
`debug.js` but never listed in `bridge.js`. Worth fixing at the source: add those names to
`BRIDGE_VALUES`/`BRIDGE_ACCESSORS` so the generator stops being a trap.

## 6. Deliberate deferrals from Prompt 4 (footprints)

Not gaps — decisions, recorded so the next pass doesn't rediscover them as bugs.

**No actual-spend capture.** There is an optional actual-*duration* capture on a step and
deliberately no money equivalent. An "actual spend" field is the first half of a ledger and
would want receipts, splits, refunds and a per-week history, none of which exist; the README
has always described the budget as an allocation. Time can be measured with one button
because a step already has a beginning and an end. Money can't.

**Shadows are summed, not merged.** `loadOn()` adds `lead + dur + lag` per event with no
interval union, so two back-to-back sessions read as the full width each even where one's
lag overlaps the next one's lead. Chosen for consistency with how `loadOn()` has always
summed overlapping slots, and to keep a day's total independent of the order things sit in.
If this ever becomes the wrong trade, the change is one interval-merge pass inside
`loadOn()` and nowhere else.

**`catProjection()` treats this week's committed spend as a standing rate.** There is no
per-week history to average, so the netting extrapolates one week. The row prints all three
numbers rather than only the result, which is what keeps the assumption visible.

**Template overrides replace whole arrays.** Editing a built-in stores only the fields that
changed, but `prereqs` and `costs` are stored whole rather than merged entry by entry.
Merging two lists of edits by index is a worse surprise than replacing one.

**Gap-fill treats zero as unset.** A lead deliberately set to `0` is indistinguishable from
one never set and will be filled by a template. Recording the difference needs a per-field
"the user touched this" set — a lot of bookkeeping to protect a value that means "no lead"
either way.

**The shadow is not pushed to Google Calendar.** Lead and lag are presentational plus their
share of capacity; they never become their own `DB.events` row and so never become their own
remote event. Whether a remote calendar should show them is a separate decision, noted in
Prompt 4's non-goals.

## 7. `stamp.test.js` had no legacy counterpart, and failed on that target — fixed

`npm run test:legacy` drives every suite against `legacy/index.html`, which is schema 7.
`stamp.test.js` (schema 8) used to fail there — not a regression, just a suite with
nothing to pin against. Gated the same way `footprint.test.js` (schema 9) and
`reschedule.test.js` (schema 10) already were: `const d = isLegacy ? describe.skip : describe;`,
every top-level `describe(` in the file swapped for `d(`. `[legacy]` now reads 18 skipped
rather than 12 failed.

## 8. `'unblock'` was a reserved `AnchorSource` with no call site — fixed, conditionally

Prompt 5's source taxonomy included `'unblock'`, but none of the three unblock paths
re-anchored anything: `resolver.js`, `checkin.js` and `goal-editor.js` (each `case
'unblock'`) all set `t.status='active'` and stopped. Wiring it unconditionally would have
meant inventing a date for a one-off task, which is worse than not scheduling it at all —
so the fix is conditional, and lives in one place: `unblockThread(g,t)` in `src/engine.js`,
which all three call sites now call instead of duplicating the state reset.

`unblockThread()` reactivates the thread always. It also re-anchors the current step —
one cadence out from today, tagged `source:'unblock'` — but only when both hold: the goal
is cyclical (`habit`/`maintenance`/`threshold`, the same set `proposeFromDrift()` already
singles out) *and* the step has no event at all (`!s.eventId`). A one-off task has no
cadence to fall back on, so it's left exactly as active-and-unscheduled, same as before. A
step that's already on the calendar is left exactly where it is — a cleared block is not a
reason to move something that already has a date. `'unblock'` stays out of `CHURN_SOURCES`
(a circumstance changing isn't a person pushing something again), so the re-book shows up
in the step's history but never bumps `goal.reschedule.count`.

Five new assertions in `test/suites/reschedule.test.js`, skipped on the legacy target (no
call site existed there to pin against, same as the rest of that suite).

## 9. `goal.reschedule` loses pre-trim history across a merge

`adoptExternal()` — and, when Prompt 2 lands, the sync merge — recomputes the summary fresh
from whatever `log` rows survive on the merged document, per `ply-sync-design.md`. That is
the right call against LWW on the field, which would drop one device's offline pushes
outright. But it does mean the summary's whole reason for existing — outliving the 4000-row
trim — is undone by the first merge after a trim: a goal whose early rows were trimmed comes
back with the smaller, re-derived count.

Fixing it properly needs a merge-aware form the current design does not have: a per-device
contribution map (`{deviceId: {count, sumDelta}}`) merged field-wise, so each device's own
tally survives without either side being able to double-count the other's. That is a real
schema addition and a sync-design change, so it is filed rather than smuggled in here. Until
then the number is honest about what it can see, and the README says so.

## 10. Drift proposes only for a single cyclical goal

`proposeFromDrift()` fires only when exactly one goal using a template is drifting **and**
that goal's type carries a cadence (`habit`, `maintenance`, `threshold`). Two goals drifting
the same way on the same template currently propose nothing, even though that is arguably
stronger evidence about the template itself. The blocker is that a template has no
days-scale field to correct — `TMPL_FIELDS` is `lead`/`dur`/`lag`, all minutes — so there is
nothing to propose at the template level without inventing one. Adding a template
`leadDays` would give multi-goal drift a target, but it would be inert until something reads
it, so it was left out rather than added as decoration.

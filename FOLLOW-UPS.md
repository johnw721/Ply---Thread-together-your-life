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

## 3. The weekly budget panel is still built as a string

Every view, the ribbon and the check-in are components. The budget panel under the Week
grid is not: it is wrapped in one (`src/budget.jsx`) and still renders `viewBudget()`'s
markup.

It is the one surface with live feedback while typing — `paintBudget()` repaints the bar
and the percentages on every keystroke *without* writing to the DB, because the write
happens on `change` so that one edit is one undo step. Converting that needs component
state mirroring the inputs, and the money-budget suite (69 assertions in the original) was
among those that could not be recovered. Converting it unguarded is the one thing this
migration was set up not to do.

The wrapper is not a compromise on behaviour: Preact only touches the subtree when the
html string changes, and `viewBudget()` reads the DB rather than the inputs, so the string
is identical while someone is typing and the caret is never disturbed.

**To finish it:** write the budget suite first, against the string version, and get it
green on both targets. Then convert.

## 4. Two PWA assertions fail, on both targets

`hands the notification to the service worker when there is one`, and `the install hint is
dismissible, and stays dismissed`. They fail identically against `legacy/index.html` and
against `src/`, so they predate this migration and are not caused by it. They are left
failing rather than skipped or adjusted, because a suite that goes green by being edited
is worth nothing.

## 5. The goal editor is still built as a string

`goalEditorHTML()` and its `geAct()` router are unconverted. Nothing forces the issue —
the editor rebuilds itself through `refreshGoal()` and the renames commit on blur
deliberately so the modal is never rebuilt under the caret — but it is the largest
remaining string surface, and it is where the inline-add fields and arm-to-confirm live.
The dialogs suite covers those flows, so unlike the budget panel this one could be
converted now.

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

## 7. `stamp.test.js` has no legacy counterpart, and fails on that target

`npm run test:legacy` drives every suite against `legacy/index.html`, which is schema 7.
`stamp.test.js` (schema 8) therefore fails there — not a regression, just a suite with
nothing to pin against. `footprint.test.js` (schema 9) skips itself on the legacy target
instead, which is the pattern worth converging on: either gate `stamp.test.js` the same way,
or teach the legacy config to exclude suites newer than the monolith.

## 8. `'unblock'` is a reserved `AnchorSource` with no call site

Prompt 5's source taxonomy includes `'unblock'`, but none of the three unblock paths
re-anchors anything: `resolver.js` (`case 'unblock'`), `checkin.js` (`case 'unblock'`) and
`goal-editor.js` (`case 'unblock'`) all set `t.status='active'` and stop. The value stays in
the enum and in `migrate()`'s coercion set so a future unblock-and-re-book has somewhere to
go, and so a document written by such a build is readable by this one — but nothing emits it
today. Either wire an unblock to offer a re-book, or drop the value; leaving it indefinitely
is a bucket that looks meaningful in the type and never fills.

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

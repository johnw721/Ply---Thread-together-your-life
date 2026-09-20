# Follow-ups found during the Prompt 0 migration

Filed rather than fixed: Prompt 0 is a structural migration with zero intended behaviour
change, so anything below is out of scope for it. Each is pinned by a test named
`KNOWN GAP` where one exists, so the migration cannot change it silently in either
direction.

## 1. The check-in's inline fields only exist on the `quiet` card

`renderCheckin()` draws the `CKROW` inline row (cadence / waiting-on / next step) only in
the `quiet` branch. Two buttons elsewhere set `CKROW` and then re-render a card that has no
field for it, so they are dead ends:

- **`nostep` card → "Actually it's blocked"** sets `CKROW='blocked'`, renders no `#ckWho`
  and no `block-save`. The thread is never marked blocked.
- **`blocked` card → "Unblocked — define next"**, when the thread has no live step, sets
  `CKROW='next'` and renders no `#ckNextStep`. The thread is left active *and* step-less —
  which is the exact state rule 2 exists to prevent.

The fix is to render the same `CKROW` block in the `nostep` and `blocked` branches, as the
`quiet` branch already does. Pinned by the two `KNOWN GAP` tests in `checkin.test.js`.

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

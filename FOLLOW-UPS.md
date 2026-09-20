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

## 2. The README's schema number is stale

The body text says "Exports carry a `schema` number (currently 5)". The code is at
`SCHEMA=7` since the Google Calendar work. This is the drift the architecture doc predicted
a `Schema` type would catch at compile time.

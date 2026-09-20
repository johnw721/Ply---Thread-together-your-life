/* ---------------------------------------------------------------------------
   Reactive reads over a mutable database.

   The monolith memoised activeItems() and signals() for the duration of one
   render pass, with an explicit rule that the cache had to be null outside it —
   because a cache that outlived the render would hand stale answers to anything
   that mutated the DB and read back without saving.

   That rule exists because the cache had no idea when the data changed. A
   computed does: `rev` is bumped by save(), every computed reads it, and so each
   one recomputes exactly once after a change and is free on every read until the
   next one. The render-pass rule goes away with it — these are correct to read
   from anywhere, at any time.

   The DB itself stays a plain object graph. Making every goal and step a signal
   would be a data-model change, and undo swaps the whole graph anyway, so a
   single revision counter is both sufficient and honest about the granularity.
--------------------------------------------------------------------------- */
import { signal, computed } from '@preact/signals';
import { _activeItems, _signals } from './engine.js';

/** Bumped by save(), and by anything that replaces the graph (undo, import). */
export const rev = signal(0);
export function bumpRev(){ rev.value++; }

/* Transient view state — which checklists are expanded, which signal group is
   open — is not in the DB and never should be. It still has to be something a
   component can subscribe to: @preact/signals gives a component that reads a
   signal its own shouldComponentUpdate, so re-rendering the parent with the same
   props is correctly ignored. Without this, toggling a checklist open changed a
   Set and nothing redrew.

   render() bumps it, which keeps one explicit redraw entry point while views are
   half converted. As the remaining views become components, the individual
   actions can bump their own signals instead and this can go. */
export const uiRev = signal(0);
export function bumpUi(){ uiRev.value++; }

/** Current steps and tasks, in one shape the views can render. */
export const activeItemsC = computed(() => { rev.value; return _activeItems(); });

/** Everything drifting, strongest first. */
export const signalsC = computed(() => { rev.value; return _signals(); });

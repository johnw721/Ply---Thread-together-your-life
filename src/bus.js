/* ---------------------------------------------------------------------------
   The one place the lower layers are allowed to reach the UI.

   In the monolith everything shared a scope, so restoreSnapshot() could simply
   call closeModal() and render(). As modules that becomes a cycle — the store
   importing the views that import the store — and a cycle has an evaluation
   order: whichever module is entered second sees the other's `const` bindings as
   undefined. That is not theoretical here. It is how `SW_URL` ended up reading
   `sw.js?schema=undefined`.

   So the store, the engine and anything else beneath the UI call these hooks
   instead, and main.js supplies the real implementations at boot. The hooks are
   no-ops until then, which is also what makes the store importable on its own.
--------------------------------------------------------------------------- */
export const bus = {
  /* redraw everything */
  render(){},
  /* close whatever modal is open */
  closeModal(){},
  /* drop per-view state that a wholesale DB swap has invalidated: the check-in
     queue and the open signal group both point at threads that may be gone */
  resetTransientUI(){}
};

export function wireBus(impl){ Object.assign(bus, impl); }

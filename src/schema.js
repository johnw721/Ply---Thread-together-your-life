/* ---------------------------------------------------------------------------
   The stored-shape version. A leaf module on purpose.

   The service worker stamps its registration URL with this number so that new
   data means a new cache, and the store needs it in migrate(). If it lived in
   either of those it would put the other in a cycle — and the first symptom was
   a worker registering as `sw.js?schema=undefined`, because pwa.js evaluated
   while store.js was still resolving its own imports.

   Bump it whenever the shape changes; migrate() has to grow a step to match.
--------------------------------------------------------------------------- */
export const SCHEMA=7;   // bump whenever the shape changes; migrate() has to grow a step to match

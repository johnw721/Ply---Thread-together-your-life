/* ---------------------------------------------------------------------------
   The stored-shape version. A leaf module on purpose.

   The service worker stamps its registration URL with this number so that new
   data means a new cache, and the store needs it in migrate(). If it lived in
   either of those it would put the other in a cycle — and the first symptom was
   a worker registering as `sw.js?schema=undefined`, because pwa.js evaluated
   while store.js was still resolving its own imports.

   Bump it whenever the shape changes; migrate() has to grow a step to match.
--------------------------------------------------------------------------- */

/** Every version this build knows how to read. A file claiming anything else is
    refused rather than half-loaded — see migrate(). */
export type Schema = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const SCHEMA: Schema = 10;

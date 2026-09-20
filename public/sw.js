/* =============================================================================
   Ply's service worker.

   It precaches the shell so an installed Ply opens in a tunnel, and it shows the
   notifications the page schedules. It does not sync, it does not queue writes,
   and it never touches a cross-origin request — Google Calendar's own auth and
   API calls go straight past it, because a cached OAuth response is a bug with a
   long tail.

   THE CACHE NAME IS STAMPED WITH SCHEMA.
   The page registers this file as `sw.js?schema=<SCHEMA>&build=<BUILD>`, so the
   two constants that decide whether an old bundle is safe to serve are the two
   things the cache is named after. Bump SCHEMA in index.html and three things
   happen on the next load: the registration URL changes, the browser fetches
   this file again, and `activate` deletes every cache that isn't the new name —
   so a client can never run yesterday's bundle against today's data shape.
============================================================================= */

const PARAMS = new URL(self.location.href).searchParams;
const SCHEMA = PARAMS.get('schema') || '0';
const BUILD  = PARAMS.get('build')  || '0';
const CACHE  = `ply-s${SCHEMA}-b${BUILD}`;

/* The whole app is one file, so "the build output" is short. Each entry is
   fetched on its own: a missing icon should not fail the install and leave the
   app permanently un-cached. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(new Request(url, {cache: 'reload'})); }
      catch (_) { /* one missing asset is not a failed install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE && name.startsWith('ply-')) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

/* Navigations are network-first: a new build should land the moment there is a
   network, and the cache is the fallback rather than the source of truth.
   Same-origin assets are cache-first with a background refresh, because they
   only change when the build does. Everything else is left entirely alone. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // Google's APIs are not ours to cache

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               new Response('Ply is offline and has nothing cached yet.',
                            {status: 503, headers: {'Content-Type': 'text/plain'}});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
        } catch (_) {}
      })());
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        (await caches.open(CACHE)).put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      return new Response('', {status: 504});
    }
  })());
});

/* A notification is only worth sending if tapping it lands somewhere useful:
   focus the tab that is already open, or open one, and tell the page which
   notification it was so it can go to the check-in rather than the Day view. */
self.addEventListener('notificationclick', event => {
  const data = (event.notification && event.notification.data) || {};
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of all) {
      if (client.url.startsWith(self.location.origin)) {
        client.postMessage({ply: 'notificationclick', ...data});
        return client.focus();
      }
    }
    const to = data.kind === 'checkin' ? './?go=checkin' : './';
    return self.clients.openWindow(to);
  })());
});

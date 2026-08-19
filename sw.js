// =========================================================
// FORGE · Service Worker (self-destruct)
// =========================================================
// Phase 1 doesn't need offline caching, and the earlier SW's
// aggressive caching was serving stale JS. This SW installs,
// clears every cache, unregisters itself, and reloads open
// tabs so the app runs from network again.
//
// Offline support will come back in a later phase with a
// smarter cache strategy (network-first for JS).
// =========================================================

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((n) => caches.delete(n)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});


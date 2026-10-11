// Retirement worker for the former PicSetup paper studio. Keep this URL available:
// returning browsers update their existing /sw.js registration from this file.
// The new playground does not register a service worker.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // These are generated application assets, never saved circuits or notebooks.
    // Preserve every other cache and all localStorage/IndexedDB data.
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('picsetup-paper-studio-')).map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
    // No fetch handler and no forced navigation. Already-open work stays open;
    // the user's next navigation/reload receives the new site from the network.
  })());
});

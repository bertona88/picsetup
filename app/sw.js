const CACHE = 'picsetup-paper-studio-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './icon.svg',
  './manifest.webmanifest',
  './src/app.js',
  './src/complex.js',
  './src/geometry.js',
  './src/models.js',
  './src/physics.js',
  './src/bridge.js',
  './src/analysis.js',
  './src/plot.js',
  './src/export.js',
  './src/circuit.js',
  './src/coupler-view.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.ok && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
      return cached || network.catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

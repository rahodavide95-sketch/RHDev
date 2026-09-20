/* Service worker minimale: shell offline, API sempre da rete */
const CACHE = 'isrc-finder-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') !== -1) return; // API: rete diretta
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res && res.ok && url.origin === location.origin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});

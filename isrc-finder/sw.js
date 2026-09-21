/* Service worker: network-first per la pagina (mostra SEMPRE l'ultima versione),
   cache solo come ripiego offline. API sempre da rete. */
const CACHE = 'isrc-finder-V44';
const ASSETS = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.indexOf('/api/') !== -1) return; // API: rete diretta

  const isDoc = req.mode === 'navigate' || (req.destination === 'document') ||
    url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isDoc) {
    // network-first: prova la rete, ripiega sulla cache solo se offline
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok && url.origin === location.origin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', cp)); }
        return res;
      }).catch(() => caches.match('index.html'))
    );
    return;
  }
  // asset statici: cache-first (con aggiornamento in background)
  e.respondWith(caches.match(req).then((cached) => cached || fetch(req).then((res) => {
    if (res && res.ok && url.origin === location.origin) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => cached)));
});

/* Service worker di Lente: la pagina arriva sempre fresca dalla rete,
   la cache serve solo per aprire l'app senza connessione.
   Se cambi l'elenco dei file, alza VERSION. */
const VERSION = 'lente-v1';
const ASSETS = ['./', 'index.html', 'core.js', 'app.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('lente-') && k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // API di Meta, font, immagini: sempre dalla rete
  // rete prima di tutto (così si vede sempre l'ultima versione), cache solo se offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});

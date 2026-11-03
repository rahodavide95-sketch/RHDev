/* Fioritura: funziona anche senza internet e prende da sola gli aggiornamenti */
const VERSION = 'fioritura-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('fioritura-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  // Pagina: prima la rete (così arriva sempre l'ultima versione), poi la copia salvata
  if (isHTML && url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Icone e caratteri: subito dalla copia, aggiornata in sottofondo
  if (url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then(cached => {
        const fresh = fetch(req).then(res => {
          if (res && (res.status === 200 || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});

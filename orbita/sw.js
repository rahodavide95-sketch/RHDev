/* Orbita — service worker: funziona anche offline, si aggiorna da solo.
   Codice e pagina: prima la rete (così arriva sempre l'ultima versione), cache se offline.
   Librerie, font e dati geografici: dalla cache, aggiornati in sottofondo.
   Le chiamate al cloud (Supabase) non passano mai dalla cache. */
const VERSION = 'orbita-v2';
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/ctx.js', './js/util.js', './js/geo.js', './js/globe.js', './js/model.js', './js/stats.js',
  './js/store.js', './js/cloud.js', './js/config.js', './js/recap.js', './js/demo.js',
  './js/views/common.js', './js/views/home.js', './js/views/trips.js', './js/views/editor.js', './js/views/passport.js',
  './js/views/account.js', './js/views/auth.js', './js/views/share.js', './js/views/country.js',
  './vendor/globe.gl.min.js', './fonts/inter.woff2', './data/countries.json', './data/world.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('orbita-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // cloud e altri siti: mai in cache

  const path = url.pathname;
  const isCode = req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(path) && !path.includes('/vendor/');
  if (isCode) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => put(req, res))
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  e.respondWith(caches.match(req).then(cached => {
    const fresh = fetch(req).then(res => put(req, res)).catch(() => cached);
    return cached || fresh;
  }));
});

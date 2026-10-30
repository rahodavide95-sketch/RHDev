/* Analisi Finanziarie — funziona anche senza internet.
   Pagina e codice: prima la rete (così arriva subito l'ultima versione), la copia se offline.
   Font e icone: dalla copia, aggiornati in sottofondo.
   Nessun dato personale passa di qui: i dati sono cifrati in IndexedDB, non nella cache.
   Le richieste ad altri siti (quotazioni, cambi) non passano mai dalla cache.
   Attenzione: la cache è condivisa con le altre app del sito (alcune cancellano tutte le
   cache tranne la loro): per questo a ogni apertura la pagina chiede di ricompletarla ("refill"). */
const VERSION = 'rh-finance-v7';
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/boot.js', './js/app.js', './js/session.js', './js/store.js', './js/cloud.js', './js/core/merge.js', './js/core/xlsx.js', './js/core/invimport.js', './js/core/sheets.js', './js/actions.js', './js/market.js', './js/demo.js', './js/data/banks.js',
  './js/core/money.js', './js/core/dates.js', './js/core/finance.js', './js/core/model.js', './js/core/crypto.js', './js/core/csv.js',
  './js/ui/dom.js', './js/ui/icons.js', './js/ui/components.js', './js/ui/charts.js', './js/ui/fmt.js', './js/ui/theme.js',
  './js/data/markets.js',
  './js/views/gate.js', './js/views/common.js', './js/views/editors.js', './js/views/dashboard.js', './js/views/transactions.js',
  './js/views/importer.js', './js/views/invimport.js', './js/views/accounts.js', './js/views/networth.js', './js/views/budget.js', './js/views/recurring.js', './js/views/goals.js',
  './js/views/investments.js', './js/views/yearly.js', './js/views/categories.js', './js/views/reports.js', './js/views/sims.js', './js/views/markets.js', './js/views/settings.js', './js/views/palette.js',
  './fonts/inter.woff2', './fonts/inter-ext.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

const fill = () => caches.open(VERSION).then(async c => {
  const have = new Set((await c.keys()).map(r => new URL(r.url).pathname));
  const base = new URL('./', self.location).pathname;
  const missing = CORE.filter(u => !have.has(new URL(u, self.location).pathname) && !(u === './' && have.has(base)));
  await Promise.all(missing.map(u => fetch(u, { cache: 'no-cache' }).then(r => (r.ok ? c.put(u, r) : null)).catch(() => null)));
});

self.addEventListener('install', e => { e.waitUntil(fill().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('rh-finance-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data?.t === 'refill') e.waitUntil(fill());
});

const put = (req, res) => {
  if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  const isAsset = /\.(woff2|png|svg)$/.test(url.pathname);
  if (!isAsset) {
    // rete con un limite di 4 s (poco segnale), poi la copia
    e.respondWith(new Promise(resolve => {
      let done = false;
      const fallback = () => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null)).then(r => r || Response.error());
      const timer = setTimeout(() => { fallback().then(r => { if (!done && r.type !== 'error') { done = true; resolve(r); } }); }, 4000);
      fetch(req, { cache: 'no-cache' }).then(res => { clearTimeout(timer); put(req, res); if (!done) { done = true; resolve(res); } })
        .catch(() => { clearTimeout(timer); if (!done) { done = true; resolve(fallback()); } });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(cached => {
    const fresh = fetch(req).then(res => put(req, res)).catch(() => cached);
    return cached || fresh;
  }));
});

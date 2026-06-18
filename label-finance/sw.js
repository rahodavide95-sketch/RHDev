/* Service worker — offline-first leggero, network-first per evitare versioni vecchie */
const CACHE='lf-cache-v13';
const CORE=['./','index.html','style.css?v=13','app.js?v=13','config.js?v=13','sync.js?v=13','manifest.webmanifest','icon.png?v=3','pwa-192.png','pwa-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;            // CDN/Supabase: lascia passare
  e.respondWith(
    fetch(req).then(res=>{ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return res; })
              .catch(()=>caches.match(req))
  );
});

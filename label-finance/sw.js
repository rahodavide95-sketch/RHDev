/* Service worker — offline-first leggero, network-first per evitare versioni vecchie.
   La copia offline si cerca ignorando "?v=…", così le versioni dei file nelle pagine
   non devono essere ripetute qui. Cambia CACHE quando vuoi forzare una pulizia. */
const CACHE='lf-cache-v188';
const CORE=['./','index.html','app.html','artista.html','firma.html','style.css','core.js','app.js','config.js','i18n.js','sync.js',
  'theme-boot.js','landing.js','pwa-redirect.js','signature.js','firma.js','artista.js','vendor/supabase.min.js','html2pdf.bundle.min.js',
  'manifest.webmanifest','icon.png','pwa-192.png','pwa-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;            // Supabase/font: lascia passare
  e.respondWith(
    fetch(req).then(res=>{ if(res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); } return res; })
              .catch(()=>caches.match(req,{ignoreSearch:true}))
  );
});

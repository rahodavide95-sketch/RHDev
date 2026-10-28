/* [RH] Documents: works without internet too (in a club, on a plane).
   The page comes from the network when there is one, so updates arrive at once; otherwise from the copy kept here.
   The two PDF libraries and the fonts are kept too. Supabase (sync) and everything else are left alone.
   The cache is shared with the other tools on this site, and Label Finance deletes every cache but its own when it
   updates: so each time the page opens online it asks this worker to fill the copy again ("fill"). */
var CACHE = 'rh-documents-v1';
var LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
var FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Arimo:wght@400&family=Montserrat:wght@600&display=swap';
var FILES = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png', 'favicon-64.png'];
var PAGE = new URL('./', self.registration.scope).href;

function keep(c, url, opts){
  return c.match(url).then(function(hit){
    if (hit) return;
    return fetch(url, opts).then(function(r){ if (r.ok) return c.put(url, r); });
  }).catch(function(){});
}
// the font files the documents use (Latin only), so the PDFs look the same offline
function keepFonts(c){
  return c.match(FONTS).then(function(hit){
    return hit || fetch(FONTS, {mode:'cors'}).then(function(r){ if (!r.ok) return null; return c.put(FONTS, r.clone()).then(function(){ return r; }); });
  }).then(function(r){ return r ? r.text() : ''; }).then(function(css){
    var urls = [];
    String(css).split('/* ').forEach(function(block){
      if (!/^latin(-ext)? \*\//.test(block)) return;
      var m = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(block); if (m) urls.push(m[1]);
    });
    return Promise.all(urls.map(function(u){ return keep(c, u, {mode:'cors'}); }));
  }).catch(function(){});
}
function fill(){
  return caches.open(CACHE).then(function(c){
    return Promise.all(FILES.map(function(f){ return keep(c, new URL(f, PAGE).href); })
      .concat(LIBS.map(function(u){ return keep(c, u, {mode:'cors'}); }), [keepFonts(c)]));
  });
}

self.addEventListener('install', function(e){ e.waitUntil(fill()); self.skipWaiting(); });
self.addEventListener('activate', function(e){
  // only our own old copies: the other tools' caches are theirs
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k.indexOf('rh-documents-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('message', function(e){ if (e.data === 'fill') e.waitUntil(fill()); });

// the page: network first (4 s at most with a weak signal), then the kept copy
function page(req){
  return caches.open(CACHE).then(function(c){
    return new Promise(function(done){
      var sent = false, send = function(r){ if (!sent && r) { sent = true; done(r); } };
      var late = setTimeout(function(){ c.match(PAGE).then(send); }, 4000);
      fetch(req).then(function(r){
        clearTimeout(late);
        if (r.ok) c.put(PAGE, r.clone());
        send(r);
      }).catch(function(){
        clearTimeout(late);
        c.match(PAGE).then(function(hit){ send(hit || Response.error()); });
      });
    });
  });
}
// libraries, fonts, icons: the kept copy at once, refreshed in the background
function asset(req){
  return caches.open(CACHE).then(function(c){
    return c.match(req.url).then(function(hit){
      // libraries and fonts are asked with CORS, never kept as opaque answers (they would weigh megabytes in the quota)
      var ask = req.url.indexOf(PAGE) === 0 ? req : new Request(req.url, {mode:'cors', credentials:'omit'});
      var net = fetch(ask).then(function(r){ if (r && r.ok) c.put(req.url, r.clone()); return r; });
      if (hit) { net.catch(function(){}); return hit; }
      return net;
    });
  });
}
self.addEventListener('fetch', function(e){
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.mode === 'navigate') { if (req.url.indexOf(PAGE) === 0) e.respondWith(page(req)); return; }
  var ours = req.url.indexOf(PAGE) === 0, lib = LIBS.indexOf(req.url) !== -1, font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (ours || lib || font) e.respondWith(asset(req));
});

/* [RH] Documents: works without internet too (in a club, on a plane).
   The page comes from the network when there is one, so updates arrive at once; otherwise from the copy kept here.
   The two PDF libraries and the fonts are kept too. Supabase (sync) and everything else are left alone.
   Two copies: the cache, and a second one in IndexedDB. The cache is shared with the other tools on this site and
   Label Finance deletes every cache but its own when it updates: the IndexedDB copy survives that, puts the cache
   back without the network, and is what the page gets if the cache is gone. Each opening with the network also asks
   this worker to check both copies ("fill"). */
var CACHE = 'rh-documents-v1';   // the worker itself is checked by the browser at every opening; this name changes only to drop old copies
var LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
var FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Arimo:wght@400&family=Montserrat:wght@600&display=swap';
var FILES = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png', 'favicon-64.png'];
var PAGE = new URL('./', self.registration.scope).href;

// ---- the second copy, in IndexedDB ----
function db(){
  return new Promise(function(ok, no){
    var r = indexedDB.open('rh-documents-offline', 1);
    r.onupgradeneeded = function(){ r.result.createObjectStore('files'); };
    r.onsuccess = function(){ ok(r.result); }; r.onerror = function(){ no(r.error); };
  });
}
function store(url, r){
  return r.arrayBuffer().then(function(buf){
    return db().then(function(d){
      return new Promise(function(ok){
        var t = d.transaction('files', 'readwrite');
        t.objectStore('files').put({type: r.headers.get('content-type') || '', body: buf}, url);
        t.oncomplete = t.onerror = t.onabort = function(){ d.close(); ok(); };
      });
    });
  }).catch(function(){});
}
function stored(url){
  return db().then(function(d){
    return new Promise(function(ok){
      var q = d.transaction('files').objectStore('files').get(url);
      q.onsuccess = function(){ d.close(); var v = q.result; ok(v ? new Response(v.body, {headers: {'content-type': v.type}}) : null); };
      q.onerror = function(){ d.close(); ok(null); };
    });
  }).catch(function(){ return null; });
}
function save(c, url, r){ return Promise.all([c.put(url, r.clone()), store(url, r.clone())]).catch(function(){}); }
function kept(c, url){ return c.match(url).then(function(hit){ return hit || stored(url); }); }

// both copies there; the cache refilled from the second copy when another tool cleared it
function keep(c, url, opts){
  return Promise.all([c.match(url), stored(url)]).then(function(x){
    if (x[0] && x[1]) return;
    if (x[0]) return store(url, x[0]);
    if (x[1]) return c.put(url, x[1]);
    return fetch(url, opts).then(function(r){ if (r.ok) return save(c, url, r); });
  }).catch(function(){});
}
// the font files the documents use (Latin only), so the PDFs look the same offline
function keepFonts(c){
  return keep(c, FONTS, {mode:'cors'}).then(function(){ return kept(c, FONTS); }).then(function(r){ return r ? r.text() : ''; }).then(function(css){
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
// ready to work without internet: the page and the two libraries are kept
function ready(){
  return caches.open(CACHE).then(function(c){
    return Promise.all([PAGE].concat(LIBS).map(function(u){ return kept(c, u); }));
  }).then(function(rs){ return rs.every(Boolean); }).catch(function(){ return false; });
}

self.addEventListener('install', function(e){ e.waitUntil(fill()); self.skipWaiting(); });
self.addEventListener('activate', function(e){
  // only our own old copies: the other tools' caches are theirs
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k.indexOf('rh-documents-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('message', function(e){
  if (e.data === 'fill') e.waitUntil(fill());
  if (e.data === 'ready?' && e.ports && e.ports[0]) e.waitUntil(ready().then(function(ok){ e.ports[0].postMessage(ok); }));
});

// the page: network first (4 s at most with a weak signal), then the kept copy
function page(req){
  return caches.open(CACHE).then(function(c){
    return new Promise(function(done){
      var sent = false, send = function(r){ if (!sent && r) { sent = true; done(r); } };
      var late = setTimeout(function(){ kept(c, PAGE).then(send); }, 4000);
      // always ask the site whether the page changed (the browser would keep it up to 10 minutes): updates show at once
      fetch(req.url, {cache:'no-cache', credentials:'same-origin'}).then(function(r){
        clearTimeout(late);
        if (r.ok) save(c, PAGE, r);
        send(r);
      }).catch(function(){
        clearTimeout(late);
        kept(c, PAGE).then(function(hit){ send(hit || Response.error()); });
      });
    });
  });
}
// libraries and font files never change (versioned): the kept copy. Icons and the fonts list: kept copy, refreshed in the background.
function asset(req){
  var fixed = LIBS.indexOf(req.url) !== -1 || req.url.indexOf('https://fonts.gstatic.com/') === 0;
  return caches.open(CACHE).then(function(c){
    return kept(c, req.url).then(function(hit){
      // asked with CORS, never kept as opaque answers (they would weigh megabytes in the quota)
      var ask = req.url.indexOf(PAGE) === 0 ? req : new Request(req.url, {mode:'cors', credentials:'omit'});
      if (hit && fixed) return hit;
      var net = fetch(ask).then(function(r){ if (r && r.ok) { if (fixed) save(c, req.url, r); else c.put(req.url, r.clone()); } return r; });
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

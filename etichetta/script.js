/* ============================================================
   SUBCONSCIOUS Culture — script.js
   Legge tutti i contenuti da content.js (oggetto SITE).
   Nessun audio sul sito: ogni uscita e ogni traccia apre il suo link.
   ============================================================ */
(function () {
'use strict';

var S = (typeof SITE !== 'undefined' && SITE) ? SITE : {};
var LABEL = S.label || {}, CONTACT = S.contact || {}, VIS = S.sections || {};

/* ------------------------------------------------------------ utilità */
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
function pad(n, l) { n = '' + n; while (n.length < l) n = '0' + n; return n; }
function ok(u) { return u && u !== '#' ? u : ''; }
function mailify(t) { return esc(t).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, function (m) { return '<a href="mailto:' + m + '">' + m + '</a>'; }); }
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/* Versione leggera dell'immagine in una cartella "thumbs" accanto all'originale;
   se non esiste, il sito ripiega da solo sull'originale. */
function thumb(p) { return encodeURI(String(p).replace(/([^\/]+)$/, 'thumbs/$1')); }
function img(path, cls, rid) {
  if (!path) return '';
  return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + thumb(path) + '" data-full="' + esc(encodeURI(path)) + '"' +
    (rid != null ? ' data-rid="' + rid + '"' : '') + ' alt="" loading="lazy" decoding="async">';
}
document.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG') {
    var f = t.getAttribute('data-full');
    if (f) { t.removeAttribute('data-full'); t.src = f; } else { t.style.visibility = 'hidden'; }
  }
}, true);

/* ------------------------------------------------------------ dati */
var now = new Date(), TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());
var MONO = [[.03, .035, .047], [.23, .24, .275], [.79, .79, .79]];
var BED  = [[.008, .012, .02], [.063, .1, .18], [.23, .275, .345]];
var PH_BIO = "Breve descrizione dell'artista.", PH_ORG = 'Città, Paese';

var REL = (S.releases || []).map(function (r, i) {
  var p = String(r.date || '').split('/').map(Number);
  var date = (p.length === 3 && p[2]) ? new Date(p[2], p[1] - 1, p[0]) : new Date(2000, 0, 1);
  var va = /^various/i.test(r.artist || '') || /^SSSCLTRS/i.test(r.catalog || '');
  return {
    i: i, id: slug(r.catalog || r.title), a: r.artist || '', t: r.title || '', d: r.date || '', date: date,
    c: r.catalog || '', fmt: r.format || '', cover: r.cover || '', l: ok(r.link), k: va ? 'va' : 'ep',
    kind: va ? 'Compilation' : /\bEP\b/i.test(r.title || '') ? 'EP' : /\b(LP|album)\b/i.test(r.title || '') ? 'Album' : 'Release',
    tracks: Array.isArray(r.tracks) ? r.tracks : [], names: Array.isArray(r.artists) ? r.artists : [], pal: null
  };
});
var seenPhoto = {};
var ART = (S.artists || []).map(function (a, i) {
  var ph = a.photo || '';
  if (ph && seenPhoto[ph]) ph = ''; else if (ph) seenPhoto[ph] = 1;   // foto ripetuta = segnaposto
  return {
    i: i, id: slug(a.name), n: a.name || '', photo: ph,
    bio: a.bio && a.bio !== PH_BIO ? a.bio : '', org: a.origin && a.origin !== PH_ORG ? a.origin : '',
    ig: ok(a.instagram), sc: ok(a.soundcloud)
  };
});
function dz(r) { return Math.round((TODAY - r.date) / 864e5); }
function desc(a, b) { return b.date - a.date; }
function relById(id) { for (var i = 0; i < REL.length; i++) if (REL[i].id === id) return REL[i]; return null; }
function artById(id) { for (var i = 0; i < ART.length; i++) if (ART[i].id === id) return ART[i]; return null; }
function relsOf(a) {
  var n = a.n.toLowerCase();
  return REL.filter(function (r) {
    return r.a.toLowerCase() === n || r.names.some(function (x) { return String(x).toLowerCase() === n; }) ||
      r.tracks.some(function (t) { return String(t.artist || '').toLowerCase() === n; });
  }).sort(desc);
}
var PAGES = [['releases', 'Releases'], ['artists', 'Artists']];
if (VIS.podcast) PAGES.push(['podcast', 'Podcast']);
if (VIS.events)  PAGES.push(['events', 'Events']);
if (VIS.merch)   PAGES.push(['store', 'Store']);
PAGES.push(['contact', 'Contact']);
/* Pagine informative: ognuna a sé, raggiungibili dalla barra in fondo e dal menu */
var FAQ = (S.faq || []).filter(function (f) { return f && f.q && f.a; });
var INFO = [['about', 'About']].concat(FAQ.length ? [['faq', 'FAQ']] : [], [['credits', 'Credits']]);

/* ------------------------------------------------------------ pezzi ricorrenti */
var st = { page: 'home', arg: null, q: '', type: 'all', year: 'all', sort: 'new', mode: 'grid', aq: '', gq: '' };
var site = $('site'), pageEl = $('page'), gauge = $('gauge'), canvas = $('gl'), menu = $('menu'), menuBtn = $('menuBtn');

function cover(r) { return img(r.cover, '', r.i); }
function depthText(r) { var d = dz(r); return d < 0 ? 'Above the surface · surfaces in ' + plural(-d, 'day') : d === 0 ? 'At the surface · out today' : 'Depth · ' + plural(d, 'day'); }
function listen(r, pri) { return r.l ? '<a class="btn' + (pri ? ' pri' : '') + '" href="' + esc(r.l) + '" target="_blank" rel="noopener">' + (dz(r) < 0 ? 'Pre-save' : 'Listen') + '</a>' : ''; }
function card(r) {
  var d = dz(r);
  return '<a class="card" href="#/release/' + r.id + '" data-hov="' + r.i + '"><span class="cv">' + cover(r) +
    (d < 0 ? '<span class="tag">In ' + plural(-d, 'day') + '</span>' : '') + '</span><span class="cat">' + esc(r.c) + ' · ' + esc(r.d) +
    '</span><b>' + esc(r.t) + '</b><span class="a">' + esc(r.a) + '</span></a>';
}
function lrow(r) {
  return '<a class="lrow" href="#/release/' + r.id + '" data-hov="' + r.i + '"><span class="cv">' + cover(r) + '</span><b>' + esc(r.t) + '</b><span>' + esc(r.a) +
    '</span><span class="hs">' + esc(r.c) + '</span><span class="hs">' + esc(r.d) + '</span><span class="hs">' + (dz(r) < 0 ? 'Upcoming' : r.kind) + '</span></a>';
}
function sec(t, more, p) { return '<div class="sec"><h2>' + t + '</h2>' + (more ? '<a href="#/' + p + '">' + more + '</a>' : '') + '</div>'; }
function avatar(a) { return a.photo ? img(a.photo, 'av') : '<span class="av">' + esc(a.n.charAt(0)) + '</span>'; }
function person(a) { return '<a class="person" href="#/artist/' + a.id + '">' + avatar(a) + '<span>' + esc(a.n) + '</span></a>'; }
function extLink(u, label) { return '<a class="btn" href="' + esc(u) + '" target="_blank" rel="noopener">' + label + '</a>'; }

/* ------------------------------------------------------------ pagine */
var P = {};
P.home = function () {
  var L = REL.slice().sort(desc), up = L.filter(function (r) { return dz(r) < 0; }), out = L.filter(function (r) { return dz(r) >= 0; });
  var show = up.concat(out.slice(0, 6)), rest = out.length - Math.min(6, out.length);
  var faces = ART.filter(function (a) { return a.photo; }).slice(0, 12);
  var extras = '';
  if (VIS.podcast && (S.podcast || []).length) extras += '<div>' + sec('Podcast', 'All episodes', 'podcast') + S.podcast.slice(0, 3).map(function (e) { return '<div class="mini"><b>' + esc(e.title) + '</b><span>' + esc(e.date || '') + '</span></div>'; }).join('') + '</div>';
  if (VIS.events && (S.events || []).length)   extras += '<div>' + sec('Events', 'All dates', 'events') + S.events.slice(0, 3).map(function (e) { return '<div class="mini"><b>' + esc(e.name) + '</b><span>' + esc(e.date || '') + '</span></div>'; }).join('') + '</div>';
  if (VIS.merch && (S.merch || []).length)     extras += '<div>' + sec('Store', 'Open store', 'store') + S.merch.slice(0, 3).map(function (e) { return '<div class="mini"><b>' + esc(e.name) + '</b><span>' + esc(e.price || '') + '</span></div>'; }).join('') + '</div>';
  return '<section class="hero stop" data-pal="mono" data-g="Surface"><div class="lockup"><img src="images/logo.png" alt="" width="200" height="200"><h1><span><b>SUBCONSCIOUS</b></span> <span>Culture</span></h1></div>' +
    (LABEL.tagline ? '<p class="sh">' + LABEL.tagline.split('\n').map(function (l) { return '<span class="tl">' + esc(l) + '</span>'; }).join('') + '</p>' : '') +
    '<div class="hint"><i></i><span class="hl"><span class="tl">Scroll to descend</span><span class="tl">Depth is measured in days since release</span></span></div></section>' +
    show.map(function (r) {
      var d = dz(r);
      return '<section class="layer stop" data-pal="' + r.i + '" data-g="' + (d < 0 ? '+' + (-d) : '−' + d) + ' d · ' + esc(r.t) + '">' +
        '<div class="meta"><span>' + esc(r.c) + '</span><span>' + esc(r.d) + '</span><span>' + r.kind + '</span>' + (d < 0 ? '<span class="up">Upcoming</span>' : '') + '</div>' +
        '<h2 class="big"><a href="#/release/' + r.id + '">' + esc(r.t) + '</a></h2><div class="by">' + esc(r.a) + '</div>' +
        '<div class="row"><a class="cvbig" href="#/release/' + r.id + '" aria-label="Open ' + esc(r.t) + '">' + cover(r) + '</a><div class="side"><span class="depth">' + depthText(r) +
        '</span><div class="cta">' + listen(r, true) + '<a class="btn" href="#/release/' + r.id + '">Open release</a></div></div></div></section>';
    }).join('') +
    (rest > 0 ? '<section class="deeper stop" data-pal="' + out[6].i + '" data-g="Deeper · ' + plural(rest, 'release') + '"><div class="meta"><b>Deeper</b><span>down to −' + dz(out[out.length - 1]) +
      ' days</span></div><h2 class="big">' + plural(rest, 'more release') + ' below</h2><a class="btn pri" href="#/releases">Descend into the catalogue</a></section>' : '') +
    '<section class="bed stop" data-pal="bed" data-g="Seabed">' +
      (ART.length ? sec('The seabed · Artists', 'All ' + plural(ART.length, 'artist'), 'artists') + '<div class="faces">' + faces.map(function (a) { return '<a class="face" href="#/artist/' + a.id + '">' + img(a.photo) + esc(a.n) + '</a>'; }).join('') + '</div>' : '') +
      (extras ? '<div class="three">' + extras + '</div>' : '') +
    '</section>';
};

function relResults() {
  var q = st.q.toLowerCase();
  var L = REL.filter(function (r) {
    return (st.type === 'all' || r.k === st.type) && (st.year === 'all' || r.date.getFullYear() === +st.year) &&
      (!q || (r.t + ' ' + r.a + ' ' + r.c).toLowerCase().indexOf(q) >= 0);
  });
  L.sort(st.sort === 'old' ? function (a, b) { return a.date - b.date; }
    : st.sort === 'az' ? function (a, b) { return a.t.localeCompare(b.t) || b.date - a.date; }
    : st.sort === 'artist' ? function (a, b) { return a.a.localeCompare(b.a) || b.date - a.date; } : desc);
  if (!L.length) return '<p class="empty">No release matches. Try a different search or clear the filters.</p>';
  var item = st.mode === 'list' ? lrow : card, open = st.mode === 'list' ? '<div>' : '<div class="grid">';
  if (st.sort === 'az' || st.sort === 'artist') return '<p class="count">' + plural(L.length, 'release') + '</p>' + open + L.map(item).join('') + '</div>';
  var h = '', y = null, buf = [];
  function flush() {
    if (!buf.length) return;
    h += '<div class="yh" data-g="' + y + '">' + y + '<small>' + plural(buf.length, 'release') + '</small></div>' + open + buf.map(item).join('') + '</div>';
    buf = [];
  }
  L.forEach(function (r) { var yy = r.date.getFullYear(); if (yy !== y) { flush(); y = yy; } buf.push(r); });
  flush();
  return h;
}
P.releases = function () {
  var years = [];
  REL.forEach(function (r) { var y = r.date.getFullYear(); if (years.indexOf(y) < 0) years.push(y); });
  years.sort().reverse();
  var hasVa = REL.some(function (r) { return r.k === 'va'; }), hasEp = REL.some(function (r) { return r.k === 'ep'; });
  function chip(k, v, l) { return '<button class="chip" data-f="' + k + '" data-v="' + v + '" aria-pressed="' + (String(st[k]) === String(v)) + '">' + l + '</button>'; }
  return '<div class="head"><div class="meta"><b>Catalogue</b><span>' + plural(REL.length, 'release') + '</span></div><h1 class="big">Releases</h1></div>' +
    '<div class="tools"><input class="in" id="rq" type="search" placeholder="Title, artist or catalogue no." aria-label="Filter releases" value="' + esc(st.q) + '" autocomplete="off"></div>' +
    '<div class="tools">' + (hasVa && hasEp ? '<div>' + chip('type', 'all', 'All') + chip('type', 'ep', 'EPs &amp; albums') + chip('type', 'va', 'Compilations') + '</div>' : '') +
    (years.length > 1 ? '<div>' + chip('year', 'all', 'All years') + years.map(function (y) { return chip('year', y, y); }).join('') + '</div>' : '') +
    '<div class="right"><select class="sel" id="sort" aria-label="Sort">' + [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'Title A–Z'], ['artist', 'Artist A–Z']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
    '</select>' + chip('mode', 'grid', 'Covers') + chip('mode', 'list', 'List') + '</div></div><div id="res">' + relResults() + '</div>';
};

P.release = function () {
  var r = relById(st.arg), d = dz(r), L = REL.slice().sort(desc), i = L.indexOf(r), above = L[i - 1], below = L[i + 1];
  var tracks = r.tracks.filter(function (t) { return t && t.title; });
  return '<a class="back" href="#/releases">All releases</a><section class="rel">' +
    '<div class="meta"><span>' + esc(r.c) + '</span><span>' + esc(r.d) + '</span><span>' + r.kind + (r.fmt ? ' · ' + esc(r.fmt) : '') + '</span>' + (d < 0 ? '<span class="up">Upcoming</span>' : '') + '</div>' +
    '<h1 class="big">' + esc(r.t) + '</h1><div class="by">' + esc(r.a) + '</div>' +
    '<div class="row"><span class="cvbig">' + cover(r) + '</span><div class="side"><span class="depth">' + depthText(r) + '</span><div class="cta">' + listen(r, true) + '</div></div></div></section>' +
    (tracks.length ? sec('Tracks') + tracks.map(function (t, n) {
      return '<div class="trk"><i>' + (n + 1) + '</i><div><b>' + esc(t.title) + '</b>' + (t.artist ? '<small>' + esc(t.artist) + '</small>' : '') + '</div>' + (ok(t.link) ? extLink(t.link, 'Listen') : '<span></span>') + '</div>';
    }).join('') : '') +
    '<div class="pn">' +
      (below ? '<a href="#/release/' + below.id + '" data-hov="' + below.i + '"><small>Keep descending · ' + esc(below.d) + '</small><b>' + esc(below.t) + '</b></a>'
             : '<a href="#/artists"><small>You reached the seabed</small><b>Meet the artists</b></a>') +
      (above ? '<a href="#/release/' + above.id + '" data-hov="' + above.i + '"><small>↑ Back towards the surface · ' + esc(above.d) + '</small><b>' + esc(above.t) + '</b></a>' : '') +
    '</div>';
};

function artResults() {
  var q = st.aq.toLowerCase(), L = ART.filter(function (a) { return !q || a.n.toLowerCase().indexOf(q) >= 0; });
  L.sort(function (x, y) { return x.n.localeCompare(y.n); });
  if (!L.length) return '<p class="empty">No artist matches that name.</p>';
  var groups = {}, keys = [];
  L.forEach(function (a) {
    var k = slug(a.n).charAt(0).toUpperCase();
    if (!/[A-Z]/.test(k)) k = '#';
    if (!groups[k]) { groups[k] = []; keys.push(k); }
    groups[k].push(a);
  });
  return '<div class="az" aria-label="Jump to letter">' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(function (c) { return '<button data-az="' + c + '"' + (groups[c] ? '' : ' disabled') + '>' + c + '</button>'; }).join('') + '</div>' +
    keys.map(function (k) { return '<div class="lh" data-g="' + k + '" id="L-' + (k === '#' ? 'x' : k) + '">' + k + '</div><div class="people">' + groups[k].map(person).join('') + '</div>'; }).join('');
}
P.artists = function () {
  return '<div class="head"><div class="meta"><b>The seabed</b><span>' + plural(ART.length, 'artist') + '</span></div><h1 class="big">Artists</h1></div>' +
    '<div class="tools"><input class="in" id="aq" type="search" placeholder="Artist name" aria-label="Filter artists" value="' + esc(st.aq) + '" autocomplete="off"></div><div id="res">' + artResults() + '</div>';
};
P.artist = function () {
  var a = artById(st.arg), rels = relsOf(a);
  return '<a class="back" href="#/artists">All artists</a><div class="arthead">' + avatar(a) + '<div><div class="meta"><b>Artist</b>' + (a.org ? '<span>' + esc(a.org) + '</span>' : '') + '</div><h1 class="big">' + esc(a.n) + '</h1>' +
    (a.ig || a.sc ? '<div class="cta">' + (a.ig ? extLink(a.ig, 'Instagram') : '') + (a.sc ? extLink(a.sc, 'SoundCloud') : '') + '</div>' : '') + '</div></div>' +
    (a.bio ? '<p class="bio sh">' + esc(a.bio).replace(/\n/g, '<br>') + '</p>' : '') +
    (rels.length ? sec('Releases on <span class="nm">SUBCONSCIOUS Culture</span>') + '<div class="grid">' + rels.map(card).join('') + '</div>' : '');
};

P.podcast = function () {
  var L = S.podcast || [];
  return '<div class="head"><div class="meta"><b>Mix series</b><span>' + plural(L.length, 'episode') + '</span></div><h1 class="big">Podcast</h1></div>' +
    L.map(function (e, i) {
      return '<div class="ep"><span class="n">' + pad(L.length - i, 3) + '</span><div><b>' + esc(e.title) + '</b><small>' + [e.date, e.duration].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
        (ok(e.link) ? extLink(e.link, 'Listen') : '<span></span>') + '</div>';
    }).join('');
};
P.events = function () {
  var L = S.events || [];
  return '<div class="head"><div class="meta"><b>Label nights</b><span>' + plural(L.length, 'date') + '</span></div><h1 class="big">Events</h1></div>' +
    L.map(function (e, i) {
      return '<div class="ep"><span class="n">' + pad(i + 1, 2) + '</span><div><b>' + esc(e.name) + '</b><small>' + [e.date, e.venue].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
        (e.ticketLink ? (ok(e.ticketLink) ? extLink(e.ticketLink, 'Tickets') : '<span class="btn off">Tickets soon</span>') : '<span class="btn off">Sold out</span>') + '</div>';
    }).join('');
};
P.store = function () {
  var L = S.merch || [];
  return '<div class="head"><div class="meta"><b>Merch &amp; records</b><span>' + plural(L.length, 'item') + '</span></div><h1 class="big">Store</h1></div><div class="grid">' +
    L.map(function (m) {
      var inner = '<span class="cv">' + (m.image ? '<img src="' + esc(encodeURI(m.image)) + '" alt="" loading="lazy">' : '') + '</span><b>' + esc(m.name) + '</b><span class="cat">' + esc(m.price || '') + '</span>';
      return ok(m.buyLink) ? '<a class="card prod" href="' + esc(m.buyLink) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<div class="card prod">' + inner + '</div>';
    }).join('') + '</div>';
};
P.contact = function () {
  /* Solo l'email principale dell'etichetta: gli altri indirizzi di content.js non sono mai stati pubblicati. */
  var rows = [['Email', LABEL.email || CONTACT.email]].filter(function (m) { return m[1]; });
  var ig = CONTACT.instagramUrl || LABEL.instagram;
  return '<div class="head"><div class="meta"><b class="nm">SUBCONSCIOUS Culture</b></div><h1 class="big">Contact</h1></div><div class="contact"><div>' +
    rows.map(function (m) { return '<div class="mail"><small>' + m[0] + '</small><a href="mailto:' + esc(m[1]) + '">' + esc(m[1]) + '</a></div>'; }).join('') +
    (ig ? '<div class="mail"><small>Instagram</small><a href="' + esc(ig) + '" target="_blank" rel="noopener">' + esc(CONTACT.instagram || 'Instagram') + '</a></div>' : '') +
    '</div></div>';
};
P.about = function () {
  return '<div class="head"><div class="meta"><b class="nm">SUBCONSCIOUS Culture</b></div><h1 class="big">About</h1></div><div class="info">' +
    (LABEL.tagline ? '<p class="lead">' + esc(LABEL.tagline).replace(/\n/g, '<br>') + '</p>' : '') +
    (LABEL.about ? '<p>' + mailify(LABEL.about) + '</p>' : '') + '</div>';
};
P.faq = function () {
  return '<div class="head"><div class="meta"><b class="nm">SUBCONSCIOUS Culture</b><span>' + plural(FAQ.length, 'question') + '</span></div><h1 class="big">FAQ</h1></div><dl class="faq">' +
    FAQ.map(function (f) { return '<div class="qa"><dt>' + esc(f.q) + '</dt><dd>' + mailify(f.a) + '</dd></div>'; }).join('') + '</dl>';
};
P.credits = function () {
  var L = (S.credits || []).filter(Boolean).concat([plural(REL.length, 'release') + ' · ' + plural(ART.length, 'artist')]);
  return '<div class="head"><div class="meta"><b class="nm">SUBCONSCIOUS Culture</b></div><h1 class="big">Credits</h1></div><ul class="credits">' +
    L.map(function (c) { return '<li>' + mailify(c) + '</li>'; }).join('') + '</ul>';
};
P.search = function () {
  var q = st.gq.toLowerCase();
  var R = REL.filter(function (r) { return (r.t + ' ' + r.a + ' ' + r.c).toLowerCase().indexOf(q) >= 0; }).sort(desc);
  var As = ART.filter(function (a) { return a.n.toLowerCase().indexOf(q) >= 0; });
  return '<div class="head"><div class="meta"><b>Search</b><span>' + plural(R.length, 'release') + ' · ' + plural(As.length, 'artist') + '</span></div><h1 class="big">' + esc(st.gq) + '</h1></div>' +
    (R.length || As.length ? '' : '<p class="empty">Nothing found. Try a title, an artist or a catalogue number.</p>') +
    (As.length ? sec('Artists') + '<div class="people">' + As.slice(0, 30).map(person).join('') + '</div>' : '') +
    (R.length ? sec('Releases') + '<div class="grid">' + R.slice(0, 48).map(card).join('') + '</div>' : '');
};

/* ------------------------------------------------------------ colori presi dalle copertine */
function extract(im) {
  try {
    var N = 24, c = document.createElement('canvas'); c.width = c.height = N;
    var x = c.getContext('2d'); x.drawImage(im, 0, 0, N, N);
    var d = x.getImageData(0, 0, N, N).data, px = [];
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      px.push({ c: [r, g, b], l: .3 * r + .59 * g + .11 * b, s: Math.max(r, g, b) - Math.min(r, g, b) });
    }
    px.sort(function (a, b) { return a.l - b.l; });
    var avg = function (arr, w) {
      var o = [0, 0, 0], t = 0;
      arr.forEach(function (p) { var k = w ? w(p) : 1; o[0] += p.c[0] * k; o[1] += p.c[1] * k; o[2] += p.c[2] * k; t += k; });
      return t ? [o[0] / t, o[1] / t, o[2] / t] : [0, 0, 0];
    };
    var n = px.length, dark = avg(px.slice(0, Math.round(n * .25))), light = avg(px.slice(Math.round(n * .92)));
    var mid = avg(px.filter(function (p) { return p.l > .08 && p.l < .85; }), function (p) { return p.s * p.s + .0005; });
    var md = Math.max(dark[0], dark[1], dark[2], .001); if (md > .1) dark = dark.map(function (v) { return v * .1 / md; });
    var mm = Math.max(mid[0], mid[1], mid[2], .001); if (mm < .5) mid = mid.map(function (v) { return v * Math.min(1.9, .5 / mm); });
    var ml = Math.max(light[0], light[1], light[2], .001); if (ml < .7) light = light.map(function (v) { return v * .7 / ml; });
    return [dark, mid, light];
  } catch (e) { return null; }
}
document.addEventListener('load', function (e) {
  var t = e.target;
  if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-rid')) return;
  var r = REL[+t.getAttribute('data-rid')];
  if (r && !r.pal) { r.pal = extract(t) || MONO; syncPals(); measure(); }
}, true);

/* ------------------------------------------------------------ misuratore + colore del fluido */
var gItems = [], stops = [], stopPals = [], hoverRel = null, tgt = MONO, cur = MONO.map(function (c) { return c.slice(); });
var depth = 0, dimT = .66, dim = .66, accStr = '', raf = 0;
function palOf(key) { return key === 'mono' ? MONO : key === 'bed' ? BED : (REL[+key].pal || MONO); }
function bright(c) {
  var m = Math.max(c[0], c[1], c[2], .01), k = Math.min(2.6, .8 / m);
  c = mix([c[0] * k, c[1] * k, c[2] * k].map(function (v) { return Math.min(1, v); }), [1, 1, 1], .22);
  return 'rgb(' + c.map(function (v) { return Math.round(v * 255); }).join(',') + ')';
}
function syncPals() { stopPals = stops.map(function (s) { return palOf(s.getAttribute('data-pal')); }); }
function syncGauge() {
  stops = [].slice.call(pageEl.querySelectorAll('.stop')); syncPals();
  gItems = [].slice.call(pageEl.querySelectorAll('[data-g]'));
  gauge.className = 'gauge' + (st.page === 'artists' ? ' all' : '');
  hapAct = null;
  gauge.innerHTML = gItems.map(function (e, i) { var l = esc(e.getAttribute('data-g')); return '<button' + (e.classList.contains('layer') ? ' class="r"' : '') + ' data-gi="' + i + '" aria-label="' + l + '"><i></i><span>' + l + '</span></button>'; }).join('');
  measure();
}
gauge.addEventListener('click', function (e) {
  var b = e.target.closest('[data-gi]');
  if (b) gItems[+b.getAttribute('data-gi')].scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: st.page === 'home' ? 'center' : 'start' });
});
function measure() {
  var mid = window.innerHeight * .5, act = -1, base;
  depth = window.scrollY / Math.max(1, window.innerHeight) * .5;
  if (stops.length) {
    var cs = stops.map(function (s) { var r = s.getBoundingClientRect(); return r.top + r.height / 2; }), f = 0;
    if (mid <= cs[0]) f = 0; else if (mid >= cs[cs.length - 1]) f = cs.length - 1;
    else for (var i = 0; i < cs.length - 1; i++) if (mid >= cs[i] && mid < cs[i + 1]) { f = i + (mid - cs[i]) / (cs[i + 1] - cs[i]); break; }
    var i0 = Math.floor(f), i1 = Math.min(cs.length - 1, i0 + 1), k = f - i0;
    act = k < .5 ? i0 : i1; k = k * k * (3 - 2 * k);
    base = [mix(stopPals[i0][0], stopPals[i1][0], k), mix(stopPals[i0][1], stopPals[i1][1], k), mix(stopPals[i0][2], stopPals[i1][2], k)];
  } else {
    gItems.forEach(function (e, i) { if (e.getBoundingClientRect().top <= window.innerHeight * .45) act = i; });
    if (act < 0 && gItems.length) act = 0;
    var p = null;
    if (st.page === 'release') { var rr = relById(st.arg); p = rr && rr.pal; }
    else [.5, .3, .7].some(function (fx) {
      var e = document.elementFromPoint(window.innerWidth * fx, mid), h = e && e.closest && e.closest('[data-hov]');
      if (h) { p = REL[+h.getAttribute('data-hov')].pal; return !!p; }
      return false;
    });
    base = p || MONO;
  }
  tgt = (hoverRel && hoverRel.pal) || base;
  var a = bright(tgt[1]);
  if (a !== accStr) { accStr = a; document.documentElement.style.setProperty('--acc', a); }
  [].forEach.call(gauge.children, function (b, i) { b.setAttribute('aria-current', i === act ? 'true' : 'false'); });
  site.classList.toggle('moved', window.scrollY > 8);
  site.classList.toggle('in-rel', act >= 0 && !!gItems[act] && gItems[act].classList.contains('layer'));
  chapter(act);
  kick();
}

/* ------------------------------------------------------------ navigazione (indirizzi tipo #/release/sssc… ) */
var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ movimento morbido */
/* Cambio pagina: la vecchia sfuma, la nuova affiora dal basso */
var swapped = false, leaving = null;
function swap(fn) {
  if (!swapped || reduce || !pageEl.animate) { swapped = true; fn(); enter(); return; }
  if (leaving) leaving.cancel();
  var a = leaving = pageEl.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px)' }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
  a.onfinish = function () { if (leaving !== a) return; leaving = null; fn(); a.cancel(); enter(); };
}
function enter() {
  if (reduce || !pageEl.animate) return;
  pageEl.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 750, easing: 'cubic-bezier(.22,.61,.36,1)' });
}
/* Le immagini compaiono in dissolvenza quando sono pronte */
document.addEventListener('load', function (e) { var t = e.target; if (t && t.tagName === 'IMG') t.classList.add('ld'); }, true);
/* Ogni capitolo della Home affiora quando entra nello schermo */
var revealIO = ('IntersectionObserver' in window) && !reduce ? new IntersectionObserver(function (es) {
  es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('seen'); revealIO.unobserve(e.target); } });
}, { threshold: .18 }) : null;

/* ------------------------------------------------------------ vibrazione: un tocco leggerissimo a ogni capitolo della Home */
var touchy = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
var hapAct = null, hapT = 0;
function buzz() {
  var t = Date.now();
  if (!touchy || t - hapT < 120) return;
  hapT = t;
  if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) {} return; }
  /* iPhone: Safari non ha la vibrazione per i siti; un interruttore nativo (iOS 18)
     che cambia stato durante un gesto del dito dà un piccolo tocco */
  var l = document.createElement('label');
  l.setAttribute('aria-hidden', 'true'); l.style.display = 'none';
  l.innerHTML = '<input type="checkbox" switch>';
  document.head.appendChild(l); l.click(); document.head.removeChild(l);
}
/* I browser dei telefoni lasciano vibrare un sito solo durante un gesto del dito:
   il tocco parte quando il dito si stacca dopo lo scorrimento (il capitolo sta per cambiare),
   non dopo, quando il capitolo arriva e il gesto è già finito. */
var touchY = null, touchBuzzT = 0, tLastY = 0, tLastT = 0, tVel = 0, tFrom = null;
window.addEventListener('touchstart', function (e) {
  if (st.page !== 'home' || !e.touches[0]) { touchY = null; return; }
  touchY = tLastY = e.touches[0].clientY; tLastT = e.timeStamp; tVel = 0;
  /* da dove parte il gesto: su un'uscita, in cima alla Home, o in fondo alla pagina */
  tFrom = { rel: site.classList.contains('in-rel'), top: window.scrollY < 4,
            end: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 };
}, { passive: true });
window.addEventListener('touchmove', function (e) {
  if (touchY === null || !e.touches[0]) return;
  var y = e.touches[0].clientY, dt = e.timeStamp - tLastT;
  if (dt > 0) tVel = (tLastY - y) / dt;
  tLastY = y; tLastT = e.timeStamp;
}, { passive: true });
window.addEventListener('touchend', function (e) {
  if (touchY === null || st.page !== 'home') return;
  var end = e.changedTouches[0] ? e.changedTouches[0].clientY : tLastY, dy = touchY - end; touchY = null;
  if (e.timeStamp - tLastT > 90) tVel = 0;                       /* dito fermo prima di staccarsi: nessuno slancio */
  /* il capitolo cambia se il dito ha fatto metà strada o se è partito con slancio */
  var moves = Math.abs(dy) > window.innerHeight * 0.4 || (Math.abs(dy) > 20 && Math.abs(tVel) > 0.3 && (tVel > 0) === (dy > 0));
  if (!moves) return;
  var down = dy > 0;
  if ((down && (tFrom.rel || tFrom.top) && !tFrom.end) || (!down && tFrom.rel)) { buzz(); touchBuzzT = Date.now(); }
}, { passive: true });
function chapter(act) {
  if (st.page !== 'home' || hapAct === null) { hapAct = act; return; }
  if (act !== hapAct) { hapAct = act; if (Date.now() - touchBuzzT > 900) buzz(); }
}
var TITLES = { home: '', releases: 'Releases', artists: 'Artists', podcast: 'Podcast', events: 'Events', store: 'Store', contact: 'Contact', search: 'Search', about: 'About', faq: 'FAQ', credits: 'Credits' };
function navLinks(L) { return L.map(function (p) { return '<a href="#/' + p[0] + '" data-p="' + p[0] + '">' + p[1] + '</a>'; }).join(''); }
/* Sezioni non ancora attive: nel menu compaiono con "soon" e non si aprono.
   Quando le attivi in content.js (sections) diventano voci normali. */
var SOON = [['Events', VIS.events], ['Podcast', VIS.podcast], ['Merch', VIS.merch]].filter(function (s) { return !s[1]; });
function navHtml(withHome) {
  if (!withHome) return navLinks(PAGES);
  /* menu del telefono: tutte le voci nello stesso formato, About · FAQ · Credits comprese */
  var main = PAGES.filter(function (p) { return p[0] !== 'contact'; }), contact = PAGES.filter(function (p) { return p[0] === 'contact'; });
  return '<a href="#/" data-p="home">Surface</a>' + navLinks(main) +
    SOON.map(function (s) { return '<a class="soon" aria-disabled="true">' + s[0] + '<small>soon</small></a>'; }).join('') +
    navLinks(contact.concat(INFO));
}
var menuT = 0;
function setMenu(open) {
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
  clearTimeout(menuT);
  if (open) { menu.hidden = false; void menu.offsetWidth; menu.classList.add('open'); }
  else if (!menu.hidden) { menu.classList.remove('open'); menuT = setTimeout(function () { menu.hidden = true; }, reduce ? 0 : 500); }
}
/* Frasi sotto al titolo: ogni frase su una sola riga. Se non ci sta, il testo si
   rimpicciolisce quanto basta; se diventerebbe troppo piccolo, va a capo bilanciato. */
function fitLines(p, min) {
  if (!p) return;
  p.classList.remove('wrap'); p.style.fontSize = '';
  var hero = p.closest('.hero'), cs = getComputedStyle(hero);
  var avail = hero.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  var base = parseFloat(getComputedStyle(p).fontSize), widest = p.scrollWidth;
  if (!widest || widest <= avail) return;
  var size = Math.floor(base * avail / widest * 10) / 10;
  if (size >= min) p.style.fontSize = size + 'px'; else p.classList.add('wrap');
}
function fitTag() {
  fitLines(pageEl.querySelector('.hero .sh'), 11.5);
  fitLines(pageEl.querySelector('.hero .hl'), 9.5);
}
function render(keep) {
  site.setAttribute('data-page', st.page);
  document.documentElement.classList.toggle('chapters', st.page === 'home');
  pageEl.innerHTML = P[st.page]();
  [].forEach.call(pageEl.querySelectorAll('img'), function (im) { if (im.complete && im.naturalWidth) im.classList.add('ld'); });
  if (revealIO) [].forEach.call(pageEl.querySelectorAll('.layer, .deeper, .bed'), function (s) { s.classList.add('rv'); revealIO.observe(s); });
  var topP = st.page === 'release' ? 'releases' : st.page === 'artist' ? 'artists' : st.page;
  [].forEach.call(document.querySelectorAll('.links a, .menu a, .foot-nav a'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-p') === topP ? 'true' : 'false'); });
  var name = st.page === 'release' ? relById(st.arg).t : st.page === 'artist' ? artById(st.arg).n : TITLES[st.page];
  document.title = (name ? name + ' · ' : '') + 'SUBCONSCIOUS Culture';
  dimT = (st.page === 'home' || st.page === 'release') ? .66 : .4;
  hoverRel = null;
  if (!keep) window.scrollTo(0, 0);
  if (st.page === 'home') fitTag();
  syncGauge();
}
function route() {
  var h = location.hash.replace(/^#\/?/, '').split('/'), p = h[0] || 'home', arg = h[1] ? decodeURIComponent(h[1]) : null;
  if (p === 'merch') p = 'store';
  if (p === 'release' && !relById(arg)) p = 'releases';
  if (p === 'artist' && !artById(arg)) p = 'artists';
  var allowed = p === 'home' || p === 'release' || p === 'artist' || PAGES.concat(INFO).some(function (x) { return x[0] === p; });
  if (!allowed || !P[p]) p = 'home';
  st.page = p; st.arg = arg; st.gq = ''; $('q').value = '';
  setMenu(false); setSearch(false);
  swap(function () {
    var smooth = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    render();
    document.documentElement.style.scrollBehavior = smooth;
  });
}
window.addEventListener('hashchange', route);
menuBtn.addEventListener('click', function () { setSearch(false); setMenu(!menu.classList.contains('open')); });
/* Su telefono la ricerca si apre dalla lente e si richiude da sola quando non serve più */
var topEl = document.querySelector('.top'), searchBtn = $('searchBtn');
function setSearch(open) {
  topEl.classList.toggle('searching', open);
  searchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) $('q').focus();
}
searchBtn.addEventListener('click', function () { setMenu(false); setSearch(!topEl.classList.contains('searching')); });
$('q').addEventListener('blur', function () { if (!$('q').value) setTimeout(function () { if (document.activeElement !== $('q')) setSearch(false); }, 150); });
menu.addEventListener('click', function (e) { if (e.target.closest('a[href]')) setMenu(false); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setMenu(false); setSearch(false); } });

site.addEventListener('click', function (e) {
  var t, T = e.target;
  if ((t = T.closest('[data-f]'))) { st[t.getAttribute('data-f')] = t.getAttribute('data-v'); render(true); return; }
  if ((t = T.closest('[data-az]'))) { var h = $('L-' + t.getAttribute('data-az')); if (h) h.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
});
site.addEventListener('input', function (e) {
  var id = e.target.id;
  if (id === 'rq') { st.q = e.target.value; $('res').innerHTML = relResults(); syncGauge(); }
  else if (id === 'aq') { st.aq = e.target.value; $('res').innerHTML = artResults(); syncGauge(); }
  else if (id === 'q') {
    st.gq = e.target.value.trim();
    if (st.gq) { st.page = 'search'; render(true); }
    else if (st.page === 'search') { var open = topEl.classList.contains('searching'); route(); if (open) setSearch(true); }
  }
});
site.addEventListener('change', function (e) { if (e.target.id === 'sort') { st.sort = e.target.value; $('res').innerHTML = relResults(); syncGauge(); } });
site.addEventListener('pointerover', function (e) {
  if (e.pointerType === 'touch') return;
  var t = e.target.closest('[data-hov]'), r = t ? REL[+t.getAttribute('data-hov')] : null;
  if (r !== hoverRel) { hoverRel = r; measure(); }
});

/* ------------------------------------------------------------ fluido (WebGL) */
var FRAG = 'precision highp float;uniform vec2 uRes,uM;uniform float uT,uDepth,uDim;uniform vec3 uA,uB,uC;' +
'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}' +
'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}' +
'float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return s;}' +
'void main(){float mn=min(uRes.x,uRes.y);vec2 p=(gl_FragCoord.xy-.5*uRes)/mn;vec2 o=p;vec2 m=(uM-.5*uRes)/mn;' +
'vec2 d=p-m;float w=1.4*exp(-dot(d,d)*7.);float c=cos(w),s=sin(w);p=m+mat2(c,-s,s,c)*d;' +
'p=p*1.25+vec2(0.,uDepth);float t=uT*.03;' +
'vec2 q=vec2(fbm(p+vec2(0.,t)),fbm(p+vec2(5.2,1.3)-t));' +
'vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.7),fbm(p+3.*q+vec2(8.3,2.8)-t*.5));float f=fbm(p+3.2*r);' +
'vec3 col=mix(uA,uB,smoothstep(.28,.68,f));col=mix(col,uC,smoothstep(.5,.86,r.x)*.7);' +
'col*=.92+.08*sin(f*36.+r.y*9.);col*=uDim;col*=1.-.3*dot(o,o);' +
'col+=(hash(gl_FragCoord.xy+fract(uT))-.5)*.03;gl_FragColor=vec4(col,1.);}';
var G = (function () {
  var gl = null;
  try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch (e) {}
  if (!gl) return null;
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {};
  return { gl: gl, u: function (n) { return U[n] || (U[n] = gl.getUniformLocation(pr, n)); } };
})();
var t0 = performance.now(), mouse = [.5, .5], mt = [.5, .5];
window.addEventListener('pointermove', function (e) { mt = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight]; }, { passive: true });
function frame() {
  raf = 0;
  if (!G) return;
  var moving = Math.abs(dim - dimT) > .004, i, k;
  for (i = 0; i < 3; i++) {
    for (k = 0; k < 3; k++) if (Math.abs(cur[i][k] - tgt[i][k]) > .004) moving = true;
    cur[i] = mix(cur[i], tgt[i], reduce ? 1 : .08);
  }
  dim += (dimT - dim) * (reduce ? 1 : .08);
  mouse = [mouse[0] + (mt[0] - mouse[0]) * .06, mouse[1] + (mt[1] - mouse[1]) * .06];
  /* il fluido è morbido: si disegna a bassa risoluzione, con un tetto di pixel per i telefoni */
  var cw = canvas.clientWidth, ch = canvas.clientHeight, sc = Math.min(.55, Math.sqrt(320000 / Math.max(1, cw * ch)));
  var w = Math.max(2, Math.round(cw * sc)), h = Math.max(2, Math.round(ch * sc)), gl = G.gl;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.uniform2f(G.u('uRes'), w, h); gl.uniform2f(G.u('uM'), mouse[0] * w, mouse[1] * h);
  gl.uniform1f(G.u('uT'), reduce ? 12 : (performance.now() - t0) / 1000);
  gl.uniform1f(G.u('uDepth'), depth); gl.uniform1f(G.u('uDim'), dim);
  gl.uniform3fv(G.u('uA'), cur[0]); gl.uniform3fv(G.u('uB'), cur[1]); gl.uniform3fv(G.u('uC'), cur[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (!document.hidden && (!reduce || moving)) raf = requestAnimationFrame(frame);
}
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
window.addEventListener('scroll', measure, { passive: true });
window.addEventListener('resize', measure);
window.addEventListener('resize', fitTag);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTag);
document.addEventListener('visibilitychange', kick);

/* ------------------------------------------------------------ avvio */
$('links').innerHTML = navHtml(false);
menu.innerHTML = navHtml(true);
$('footCopy').innerHTML = '© ' + (LABEL.foundedYear && +LABEL.foundedYear < now.getFullYear() ? LABEL.foundedYear + '–' : '') + now.getFullYear() + ' <span class="nm">SUBCONSCIOUS Culture</span>';
$('footNav').innerHTML = navLinks(PAGES.concat(INFO));
/* Social: icone (il nome resta per chi usa lo screen reader) */
var ICON = {
  instagram: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147a.272.272 0 0 1-.542 0a27.955 27.955 0 0 1 0-7.147a.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"/></svg>',
  bandcamp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/></svg>',
  ra: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><text x="2" y="17" font-size="13" font-weight="700" font-family="sans-serif" letter-spacing="-0.5">RA</text></svg>'
};
$('footSocial').innerHTML = [['Instagram', LABEL.instagram, 'instagram'], ['SoundCloud', LABEL.soundcloud, 'soundcloud'], ['Bandcamp', LABEL.bandcamp, 'bandcamp'], ['Resident Advisor', LABEL.ra, 'ra']]
  .filter(function (s) { return ok(s[1]); }).map(function (s) { return '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener" aria-label="' + s[0] + '" title="' + s[0] + '">' + ICON[s[2]] + '</a>'; }).join('');
route();
})();

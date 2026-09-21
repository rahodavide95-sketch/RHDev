// ============================================================================
//  api/discography — ISRC & metadati, tutto automatico, con suggerimenti.
//
//  mode:
//    • "suggest" → suggerimenti live (kind: "artist" | "track") con immagini
//    • "artist"  → discografia completa dell'artista, con ISRC  (q oppure id)
//    • "track"   → una traccia con TUTTE le info possibili       (q oppure id)
//
//  Fonte: Spotify (completa e veloce). Su Vercel imposta:
//     SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
//  Ripiego senza chiavi: MusicBrainz (dati base, niente immagini),
//  chiamato lato server con User-Agent corretto (dal browser dà 503).
// ============================================================================

export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const UA = 'ISRCFinder/1.0 ( https://github.com/rahodavide95-sketch/rhdev )';
const MB = 'https://musicbrainz.org/ws/2';
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const enc = encodeURIComponent;
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const smallImg = (imgs) => { const a = imgs || []; return (a[a.length - 1] || a[0] || {}).url || ''; };
const bigImg = (imgs) => { const a = imgs || []; return (a[1] || a[0] || {}).url || ''; };

// ================================ Spotify ==================================
let _tok = { v: '', exp: 0 };
async function spToken(id, secret) {
  const now = Date.now();
  if (_tok.v && _tok.exp > now + 5000) return { tok: _tok.v, err: null };
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(`${id}:${secret}`) },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) { let t = ''; try { t = await r.text(); } catch (_) {} return { tok: '', err: `token HTTP ${r.status} ${t.slice(0, 100)}` }; }
  const d = await r.json();
  if (d.access_token) _tok = { v: d.access_token, exp: now + (d.expires_in || 3600) * 1000 };
  return { tok: d.access_token || '', err: d.access_token ? null : 'no access_token' };
}
const bearer = (tok) => ({ Authorization: 'Bearer ' + tok });

// ------------------------------ suggerimenti -------------------------------
async function spSuggest(kind, q, auth) {
  const type = kind === 'track' ? 'track' : 'artist';
  const r = await fetch(`https://api.spotify.com/v1/search?q=${enc(q)}&type=${type}&limit=${type === 'track' ? 8 : 6}`,
    { headers: auth, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { suggestions: [], err: `search HTTP ${r.status}` };
  const d = await r.json();
  if (type === 'artist') {
    const items = d.artists?.items || [];
    return {
      suggestions: items.map((a) => ({
        id: a.id, kind: 'artist', label: a.name,
        sub: [(a.genres || [])[0], a.followers?.total ? (a.followers.total.toLocaleString('it-IT') + ' follower') : ''].filter(Boolean).join(' · '),
        image: smallImg(a.images), round: true,
      })), err: null,
    };
  }
  const items = d.tracks?.items || [];
  return {
    suggestions: items.map((t) => ({
      id: t.id, kind: 'track', label: t.name,
      sub: (t.artists || []).map((x) => x.name).join(', ') + (t.album?.name ? ' · ' + t.album.name : ''),
      image: smallImg(t.album?.images), round: false,
    })), err: null,
  };
}

// --------------------------- costruzione traccia ---------------------------
function buildTrack(f, al, artistMap) {
  const genres = [...new Set((f.artists || []).flatMap((a) => artistMap.get(a.id)?.genres || []))];
  return {
    title: f.name || '',
    artists: (f.artists || []).map((a) => a.name).join(', '),
    isrc: f.external_ids?.isrc || '',
    album: al.name || '',
    albumType: al.album_type || '',
    upc: al.external_ids?.upc || '',
    label: al.label || '',
    releaseDate: al.release_date || f.album?.release_date || '',
    totalTracks: al.total_tracks || f.album?.total_tracks || '',
    trackNumber: f.track_number || '',
    discNumber: f.disc_number || '',
    duration: fmtDur(f.duration_ms || 0),
    durationMs: f.duration_ms || 0,
    explicit: !!f.explicit,
    popularity: (f.popularity ?? ''),
    genres: genres.join(', '),
    markets: (f.available_markets || []).length,
    spotifyUrl: f.external_urls?.spotify || '',
    previewUrl: f.preview_url || '',
    image: bigImg(al.images || f.album?.images),
    source: 'spotify',
  };
}
async function enrichTracks(tracks, auth) {
  const albumIds = [...new Set(tracks.map((t) => t.album?.id).filter(Boolean))];
  const albumMap = new Map();
  for (let i = 0; i < albumIds.length; i += 20) {
    const r = await fetch(`https://api.spotify.com/v1/albums?ids=${albumIds.slice(i, i + 20).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue; const d = await r.json();
    for (const a of d.albums || []) if (a) albumMap.set(a.id, a);
  }
  const artistIds = [...new Set(tracks.flatMap((t) => (t.artists || []).map((a) => a.id)).filter(Boolean))];
  const artistMap = new Map();
  for (let i = 0; i < artistIds.length; i += 50) {
    const r = await fetch(`https://api.spotify.com/v1/artists?ids=${artistIds.slice(i, i + 50).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue; const d = await r.json();
    for (const a of d.artists || []) if (a) artistMap.set(a.id, a);
  }
  return tracks.map((t) => buildTrack(t, albumMap.get(t.album?.id) || t.album || {}, artistMap));
}

async function spTrackSearch(q, auth) {
  const r = await fetch(`https://api.spotify.com/v1/search?q=${enc(q)}&type=track&limit=10`, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { results: [], err: `search HTTP ${r.status}` };
  const d = await r.json();
  const items = d.tracks?.items || [];
  if (!items.length) return { results: [], err: null };
  const ids = items.map((x) => x.id).filter(Boolean);
  const fulls = [];
  for (let i = 0; i < ids.length; i += 50) {
    const rr = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids.slice(i, i + 50).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!rr.ok) continue; const dd = await rr.json();
    for (const x of dd.tracks || []) if (x) fulls.push(x);
  }
  return { results: await enrichTracks(fulls.length ? fulls : items, auth), err: null };
}
async function spTrackById(id, auth) {
  const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { results: [], err: `track HTTP ${r.status}` };
  const t = await r.json();
  return { results: await enrichTracks([t], auth), err: null };
}
// Album da link diretto → tutte le tracce con ISRC (formato "rows" come la discografia)
async function spAlbumById(id, auth) {
  const r = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { rows: [], artist: '', err: `album HTTP ${r.status}` };
  const a = await r.json();
  const items = [...(a.tracks?.items || [])];
  let next = a.tracks?.next;
  while (next) {
    const nr = await fetch(next, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!nr.ok) break; const nd = await nr.json();
    items.push(...(nd.items || [])); next = nd.next;
  }
  const rows = []; const trackIndex = new Map();
  for (const tk of items) {
    const obj = { artist: (tk.artists || []).map((x) => x.name).join(', '), title: tk.name || '', isrc: '',
      release: a.name || '', date: a.release_date || '', sources: ['spotify'], url: tk.external_urls?.spotify || '', _tid: tk.id };
    rows.push(obj); if (tk.id) trackIndex.set(tk.id, obj);
  }
  const tids = [...trackIndex.keys()];
  for (let i = 0; i < tids.length; i += 50) {
    const tr = await fetch(`https://api.spotify.com/v1/tracks?ids=${tids.slice(i, i + 50).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!tr.ok) continue; const td = await tr.json();
    for (const tk of td.tracks || []) { const o = tk && trackIndex.get(tk.id); if (o) o.isrc = tk.external_ids?.isrc || ''; }
  }
  rows.forEach((o) => delete o._tid);
  return { rows, artist: (a.artists || []).map((x) => x.name).join(', ') + ' — ' + (a.name || ''), err: null };
}

// ------------------------------- discografia -------------------------------
async function spArtistId(name, auth) {
  const r = await fetch(`https://api.spotify.com/v1/search?q=${enc(name)}&type=artist&limit=5`, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { id: '', name: '', err: `search HTTP ${r.status}` };
  const d = await r.json();
  const items = d.artists?.items || [];
  if (!items.length) return { id: '', name: '', err: null };
  const pick = items.find((a) => norm(a.name) === norm(name)) || items[0];
  return { id: pick.id, name: pick.name, err: null };
}
// Fetch JSON da Spotify con retry sul rate-limit (429) e sui 5xx.
async function spJson(url, auth, tries = 3) {
  let last429 = 0;
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(12000) }); }
    catch (_) { await sleep(500 * (i + 1)); continue; }
    if (r.status === 429) {
      const ra = parseInt(r.headers.get('retry-after') || '', 10);
      last429 = Number.isFinite(ra) ? ra : 0;
      if (i === tries - 1) break; // ultimo tentativo: non aspettare inutilmente
      // rispetta il tempo REALE richiesto da Spotify (con margine), fino a 8s per la edge function
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra : (i + 1), 8) * 1000 + 400);
      continue;
    }
    if (r.status >= 500) { await sleep(600 * (i + 1)); continue; }
    if (!r.ok) return { ok: false, status: r.status, data: null };
    try { return { ok: true, status: r.status, data: await r.json() }; }
    catch (_) { return { ok: false, status: r.status, data: null }; }
  }
  return { ok: false, status: 429, data: null, retryAfter: last429 };
}
async function spDiscography(name, artistId, auth) {
  let who = { id: artistId, name: name };
  if (!artistId) {
    const s = await spArtistId(name, auth);
    if (s.err) return { rows: [], artist: '', err: s.err };
    if (!s.id) return { rows: [], artist: '', err: null };
    who = s;
  }
  let artistInfo = { name: who.name, source: 'spotify' };
  try {
    const ar = await fetch(`https://api.spotify.com/v1/artists/${who.id}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (ar.ok) { const ad = await ar.json(); who.name = ad.name || who.name;
      artistInfo = { name: ad.name || who.name, image: bigImg(ad.images), followers: ad.followers?.total || 0, genres: (ad.genres || []).slice(0, 3).join(', '), link: ad.external_urls?.spotify || '', source: 'spotify' }; }
  } catch (_) {}

  const albums = []; const seen = new Set(); let albErr = '';
  for (let offset = 0; offset < 1000; offset += 50) {
    const rr = await spJson(`https://api.spotify.com/v1/artists/${who.id}/albums?include_groups=album,single,compilation,appears_on&limit=50&offset=${offset}`, auth);
    if (!rr.ok) { albErr = 'HTTP ' + rr.status + ' su /albums' + (rr.retryAfter ? ' (Spotify chiede ' + rr.retryAfter + 's)' : ''); break; }
    const items = rr.data.items || [];
    for (const a of items) if (a.id && !seen.has(a.id)) { seen.add(a.id); albums.push(a); }
    if (items.length < 50) break;
  }
  const rows = []; const trackIndex = new Map(); const seenKey = new Set();
  const keyOf = (tk, rel) => tk.id ? ('id:' + tk.id) : ('t:' + norm(tk.name) + '|' + norm(rel || ''));
  const meta = new Map(albums.map((a) => [a.id, a]));
  const ids = albums.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 20) {
    const rr = await spJson(`https://api.spotify.com/v1/albums?ids=${ids.slice(i, i + 20).join(',')}`, auth);
    if (!rr.ok) continue; const d = rr.data;
    for (const a of d.albums || []) {
      const m = meta.get(a.id) || a;
      for (const tk of (a.tracks?.items || [])) {
        const credited = (tk.artists || []).some((x) => x.id === who.id || norm(x.name) === norm(who.name));
        if (!credited) continue;
        const rel = m.name || a.name || ''; const key = keyOf(tk, rel); if (seenKey.has(key)) continue; seenKey.add(key);
        const obj = { artist: (tk.artists || []).map((x) => x.name).join(', '), title: tk.name || '', isrc: '',
          release: rel, date: m.release_date || a.release_date || '', sources: ['spotify'],
          url: tk.external_urls?.spotify || '', image: bigImg(m.images || a.images), tid: tk.id || '', _tid: tk.id };
        rows.push(obj);
        if (tk.id) trackIndex.set(tk.id, obj);
      }
    }
  }
  // FALLBACK ricerca (leggero): comparse/compilation non gia' coperte da appears_on.
  // Tenuto a 2 pagine per non sovraccaricare il rate-limit di Spotify.
  try {
    for (let offset = 0; offset < 100; offset += 50) {
      const rr = await spJson(`https://api.spotify.com/v1/search?q=${enc('artist:"' + who.name + '"')}&type=track&limit=50&offset=${offset}`, auth);
      if (!rr.ok) break; const its = rr.data.tracks?.items || [];
      for (const tk of its) {
        const credited = (tk.artists || []).some((x) => x.id === who.id || norm(x.name) === norm(who.name));
        if (!credited) continue;
        const rel = tk.album?.name || ''; const key = keyOf(tk, rel); if (seenKey.has(key)) continue; seenKey.add(key);
        rows.push({ artist: (tk.artists || []).map((x) => x.name).join(', '), title: tk.name || '', isrc: tk.external_ids?.isrc || '',
          release: rel, date: tk.album?.release_date || '', sources: ['spotify'], url: tk.external_urls?.spotify || '',
          image: bigImg(tk.album?.images), tid: tk.id || '' });
      }
      if (!rr.data.tracks?.next || its.length < 50) break;
    }
  } catch (_) {}
  const tids = [...trackIndex.keys()];
  for (let i = 0; i < tids.length; i += 50) {
    const rr = await spJson(`https://api.spotify.com/v1/tracks?ids=${tids.slice(i, i + 50).join(',')}`, auth);
    if (!rr.ok) continue; const d = rr.data;
    for (const tk of d.tracks || []) { const o = tk && trackIndex.get(tk.id); if (o) o.isrc = tk.external_ids?.isrc || ''; }
  }
  rows.forEach((o) => delete o._tid);
  // Deduplica per ISRC (stessa registrazione uscita in piu' release = 1 riga); le tracce senza ISRC restano tutte.
  const seenIsrc = new Set(); const out = [];
  for (const r of rows) { const code = (r.isrc || '').split('/')[0].trim().toUpperCase();
    if (code) { if (seenIsrc.has(code)) continue; seenIsrc.add(code); } out.push(r); }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.title || '').localeCompare(b.title || ''));
  return { rows: out, artist: who.name, artistInfo, err: (out.length ? null : (albErr || (albums.length ? 'nessuna traccia accreditata' : 'nessun album'))) };
}

// ============================== Deezer (senza chiavi) ======================
// API pubblica, nessuna chiave/login. Restituisce ISRC, UPC, etichetta, generi,
// anteprime e immagini. Chiamata lato server (nessun problema di CORS).
const DZ = 'https://api.deezer.com';
async function dzGet(url, tries = 4) {
  let lastErr = 'errore';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { lastErr = 'HTTP 429'; await sleep(700 * (i + 1)); continue; }
      if (!r.ok) { lastErr = 'HTTP ' + r.status; if (i < tries - 1) { await sleep(300); continue; } throw new Error('deezer ' + lastErr); }
      const d = await r.json();
      if (d && d.error) {
        // Deezer manda 200 con {error} anche per il rate limit (quota) → ritenta
        const msg = d.error.message || d.error.type || 'error';
        if ((d.error.code === 4 || /quota|limit|rate/i.test(msg)) && i < tries - 1) { lastErr = 'quota'; await sleep(700 * (i + 1)); continue; }
        throw new Error('deezer ' + msg);
      }
      return d;
    } catch (e) { lastErr = String(e?.message || e); if (i < tries - 1) await sleep(300); }
  }
  throw new Error('deezer ' + lastErr);
}
async function dzSuggest(kind, q) {
  if (kind === 'track') {
    const d = await dzGet(`${DZ}/search?q=${enc(q)}&limit=8`);
    return (d.data || []).map((t) => ({ id: String(t.id), kind: 'track', label: t.title,
      sub: [t.artist?.name, t.album?.title].filter(Boolean).join(' · '),
      image: t.album?.cover_small || t.album?.cover_medium || '', round: false }));
  }
  const d = await dzGet(`${DZ}/search/artist?q=${enc(q)}&limit=6`);
  return (d.data || []).map((a) => ({ id: String(a.id), kind: 'artist', label: a.name,
    sub: (a.nb_fan ? a.nb_fan.toLocaleString('it-IT') + ' fan' : ''),
    image: a.picture_small || a.picture_medium || '', round: true }));
}
function dzBuildTrack(t, album) {
  const al = album || t.album || {};
  const contributors = (t.contributors || []).map((c) => c.name).filter(Boolean);
  return {
    title: t.title || '', titleShort: t.title_short || '', version: t.title_version || '',
    artists: t.artist?.name || contributors.join(', '),
    contributors: contributors.join(', '),
    isrc: t.isrc || '', album: al.title || '', albumType: al.record_type || '', upc: al.upc || '', label: al.label || '',
    releaseDate: t.release_date || al.release_date || '', totalTracks: al.nb_tracks || '',
    trackNumber: t.track_position || '', discNumber: t.disk_number || '',
    duration: fmtDur((t.duration || 0) * 1000), durationMs: (t.duration || 0) * 1000,
    bpm: t.bpm ? Math.round(t.bpm) : '', gain: (t.gain != null && t.gain !== 0) ? t.gain : '',
    explicit: !!t.explicit_lyrics, popularity: t.rank ? Math.round(t.rank / 10000) : '',
    genres: (al.genres?.data || []).map((g) => g.name).join(', '),
    markets: (t.available_countries || []).length,
    deezerId: String(t.id || ''), albumId: String(al.id || t.album?.id || ''),
    spotifyUrl: t.link || '', previewUrl: t.preview || '',
    image: al.cover_xl || al.cover_big || al.cover_medium || t.album?.cover_big || t.album?.cover_medium || '',
    source: 'deezer',
  };
}
async function dzTrackById(id) {
  const t = await dzGet(`${DZ}/track/${id}`);
  let album = null; try { if (t.album?.id) album = await dzGet(`${DZ}/album/${t.album.id}`); } catch (_) {}
  return { results: [dzBuildTrack(t, album)], err: null };
}
async function dzTrackSearch(q) {
  const d = await dzGet(`${DZ}/search?q=${enc(q)}&limit=10`);
  const items = d.data || [];
  if (!items.length) return { results: [], err: null };
  const albumCache = new Map(); const results = [];
  for (const t of items) {
    let album = null; const aid = t.album?.id;
    if (aid) { if (albumCache.has(aid)) album = albumCache.get(aid);
      else { try { album = await dzGet(`${DZ}/album/${aid}`); } catch (_) { album = null; } albumCache.set(aid, album); } }
    results.push(dzBuildTrack(t, album));
  }
  return { results, err: null };
}
async function dzAlbumById(id) {
  const a = await dzGet(`${DZ}/album/${id}`);
  const cover = a.cover_small || a.cover_medium || '';
  const rows = (a.tracks?.data || []).map((t) => ({ tid: String(t.id || ''), artist: t.artist?.name || '', title: t.title || '', isrc: t.isrc || '',
    release: a.title || '', date: a.release_date || '', sources: ['deezer'], url: t.link || '', image: cover }));
  const need = rows.filter((p) => !p.isrc && p.tid);
  for (let i = 0; i < need.length; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async (p) => {
      try { const t = await dzGet(`${DZ}/track/${p.tid}`); p.isrc = t.isrc || ''; } catch (_) {}
    }));
  }
  return { rows, artist: (a.artist?.name || '') + ' — ' + (a.title || ''), err: null };
}
async function dzArtistId(name) {
  const d = await dzGet(`${DZ}/search/artist?q=${enc(name)}&limit=5`);
  const arr = d.data || []; if (!arr.length) return null;
  const pick = arr.find((a) => norm(a.name) === norm(name)) || arr[0];
  return { id: pick.id, name: pick.name };
}
async function dzDiscography(name, artistId) {
  let who, art = null;
  if (artistId) { try { art = await dzGet(`${DZ}/artist/${artistId}`); } catch (_) {} who = { id: artistId, name: art?.name || name }; }
  else { const s = await dzArtistId(name); if (!s) return { rows: [], artist: '', artistInfo: null, err: null }; who = s; try { art = await dzGet(`${DZ}/artist/${s.id}`); } catch (_) {} }
  const artistInfo = { name: art?.name || who.name, image: art ? (art.picture_xl || art.picture_big || art.picture_medium || '') : '',
    fans: art?.nb_fan || 0, albums: art?.nb_album || 0, link: art?.link || '', source: 'deezer' };
  const albums = []; let url = `${DZ}/artist/${who.id}/albums?limit=100`;
  for (let i = 0; i < 20 && url; i++) { const d = await dzGet(url); albums.push(...(d.data || [])); url = d.next || ''; }
  // raccogli le tracce dell'artista (filtrando le compilation altrui)
  const picked = []; const seen = new Set();
  for (const al of albums) {
    let ad; try { ad = await dzGet(`${DZ}/album/${al.id}`); } catch (_) { continue; }
    const rel = ad.title || al.title || ''; const date = ad.release_date || al.release_date || '';
    const cover = ad.cover_small || ad.cover_medium || al.cover_small || al.cover_medium || '';
    // Se l'album è del nostro artista, tieni TUTTE le sue tracce (anche i feat.);
    // se è una compilation di altri, tieni solo le tracce del nostro artista.
    const albumIsOurs = ad.artist && (String(ad.artist.id) === String(who.id) || norm(ad.artist.name) === norm(who.name));
    for (const t of (ad.tracks?.data || [])) {
      const credited = albumIsOurs || (t.artist && (String(t.artist.id) === String(who.id) || norm(t.artist.name) === norm(who.name)));
      if (!credited) continue;
      const key = norm(t.title) + '|' + norm(rel);
      if (seen.has(key)) continue; seen.add(key);
      picked.push({ id: t.id, artist: t.artist?.name || who.name, title: t.title || '', isrc: t.isrc || '', release: rel, date, image: cover, url: t.link || '' });
    }
  }
  // Passaggio supplementare: cerca le tracce dell'artista per ID esatto, così da
  // recuperare uscite non presenti nell'elenco album (apparizioni su VA, ecc.).
  try {
    let surl = `${DZ}/search?q=${enc('artist:"' + who.name + '"')}&limit=100`;
    for (let i = 0; i < 8 && surl; i++) {
      const sd = await dzGet(surl);
      for (const t of (sd.data || [])) {
        if (!t.artist || String(t.artist.id) !== String(who.id)) continue;
        const rel = t.album?.title || '';
        const key = norm(t.title) + '|' + norm(rel);
        if (seen.has(key)) continue; seen.add(key);
        picked.push({ id: t.id, artist: t.artist?.name || who.name, title: t.title || '', isrc: t.isrc || '', release: rel, date: '', image: t.album?.cover_small || '', url: t.link || '' });
      }
      surl = sd.next || '';
    }
  } catch (_) {}

  // ISRC / data / copertina mancanti: dal dettaglio traccia (a lotti)
  const need = picked.filter((p) => (!p.isrc || !p.date) && p.id);
  const CAP = 900;
  for (let i = 0; i < need.length && i < CAP; i += 8) {
    await Promise.all(need.slice(i, i + 8).map(async (p) => {
      try {
        const t = await dzGet(`${DZ}/track/${p.id}`);
        if (!p.isrc) p.isrc = t.isrc || '';
        if (!p.date) p.date = t.release_date || t.album?.release_date || '';
        if (!p.release) p.release = t.album?.title || '';
        if (!p.image) p.image = t.album?.cover_small || '';
      } catch (_) {}
    }));
  }
  const rows = picked.map((p) => ({ artist: p.artist, title: p.title, isrc: p.isrc, release: p.release, date: p.date, sources: ['deezer'], url: p.url, image: p.image, tid: String(p.id || '') }));
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.title || '').localeCompare(b.title || ''));
  return { rows, artist: who.name, artistInfo, err: null };
}

// ================================= Tidal ===================================
// Stesso schema "client credentials" di Spotify. API v2 (JSON:API). Se qualcosa
// non combacia, la funzione restituisce vuoto e si ripiega su Deezer.
const TD_AUTH = 'https://auth.tidal.com/v1/oauth2/token';
const TD_API = 'https://openapi.tidal.com/v2';
const TD_CC = 'US';
let _td = { v: '', exp: 0, fk: '', fu: 0, fe: '' };
async function tdToken(id, secret) {
  const now = Date.now(); const key = id + ':' + secret;
  if (_td.v && _td.exp > now + 5000) return { tok: _td.v, err: null };
  if (_td.fk === key && _td.fu > now) return { tok: '', err: _td.fe };
  const r = await fetch(TD_AUTH, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(key) },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15000) });
  if (!r.ok) { let t = ''; try { t = await r.text(); } catch (_) {} const e = `token HTTP ${r.status} ${t.slice(0, 90)}`; _td = { v: '', exp: 0, fk: key, fu: now + 60000, fe: e }; return { tok: '', err: e }; }
  const d = await r.json(); if (d.access_token) _td = { v: d.access_token, exp: now + (d.expires_in || 3600) * 1000, fk: '', fu: 0, fe: '' };
  return { tok: d.access_token || '', err: d.access_token ? null : 'no token' };
}
const tdHead = (tok) => ({ Authorization: 'Bearer ' + tok, Accept: 'application/vnd.api+json' });
async function tdGet(url, tok) { const r = await fetch(url, { headers: tdHead(tok), signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('tidal HTTP ' + r.status); return r.json(); }
const tdAttr = (x) => (x && x.attributes) || {};
function tdImg(at) { const l = at.imageLinks || at.picture || []; return (Array.isArray(l) && l[0] && (l[0].href || l[0].url)) || ''; }

async function tdArtistDisco(name, artistId, tok) {
  let aid = artistId;
  if (!aid) {
    const s = await tdGet(`${TD_API}/searchResults/${enc(name)}?countryCode=${TD_CC}&include=artists`, tok);
    const inc = (s.included || []).filter((x) => x.type === 'artists');
    const pick = inc.find((x) => norm(tdAttr(x).name) === norm(name)) || inc[0];
    aid = pick ? pick.id : '';
  }
  if (!aid) return { rows: [], artist: '', artistInfo: null, err: null };
  let artistInfo = null;
  try { const a = await tdGet(`${TD_API}/artists/${aid}?countryCode=${TD_CC}`, tok); const at = tdAttr(a.data); artistInfo = { name: at.name || name, image: tdImg(at), link: `https://tidal.com/browse/artist/${aid}`, source: 'tidal' }; } catch (_) {}
  const albumIds = [];
  try { let url = `${TD_API}/artists/${aid}/relationships/albums?countryCode=${TD_CC}`;
    for (let i = 0; i < 12 && url; i++) { const d = await tdGet(url, tok); for (const it of (d.data || [])) if (it.id) albumIds.push(it.id);
      url = d.links && d.links.next ? ('https://openapi.tidal.com' + d.links.next) : ''; }
  } catch (_) {}
  const rows = []; const seen = new Set();
  for (const alid of albumIds) {
    try {
      const al = await tdGet(`${TD_API}/albums/${alid}?countryCode=${TD_CC}&include=items`, tok);
      const at = tdAttr(al.data); const rel = at.title || ''; const date = at.releaseDate || ''; const cover = tdImg(at);
      for (const t of (al.included || []).filter((x) => x.type === 'tracks')) {
        const ta = tdAttr(t); const key = norm(ta.title) + '|' + norm(rel); if (!ta.title || seen.has(key)) continue; seen.add(key);
        rows.push({ artist: artistInfo?.name || name, title: ta.title, isrc: ta.isrc || '', release: rel, date, sources: ['tidal'], url: `https://tidal.com/browse/track/${t.id}`, image: cover, tid: String(t.id || '') });
      }
    } catch (_) {}
  }
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { rows, artist: artistInfo?.name || name, artistInfo, err: null };
}
async function tdTrackSearch(q, tok) {
  const s = await tdGet(`${TD_API}/searchResults/${enc(q)}?countryCode=${TD_CC}&include=tracks`, tok);
  const tracks = (s.included || []).filter((x) => x.type === 'tracks').slice(0, 10);
  const results = tracks.map((t) => { const a = tdAttr(t); return {
    title: a.title || '', artists: (a.artists || []).map((x) => x.name).join(', ') || '', isrc: a.isrc || '',
    album: '', albumType: '', upc: '', label: (a.copyright || ''), releaseDate: a.releaseDate || '', totalTracks: '',
    trackNumber: a.trackNumber || '', discNumber: a.volumeNumber || '', duration: a.duration || '', durationMs: 0,
    bpm: '', explicit: !!a.explicit, popularity: '', genres: '', markets: '', deezerId: '', albumId: '',
    spotifyUrl: `https://tidal.com/browse/track/${t.id}`, previewUrl: '', image: '', source: 'tidal' }; });
  return { results, err: null };
}

// ============================== MusicBrainz (ripiego) ======================
async function mbDiscography(name) {
  const s = await fetch(`${MB}/artist?query=${enc(name)}&fmt=json&limit=5`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!s.ok) return { rows: [], artist: '', err: `search HTTP ${s.status}` };
  const sd = await s.json(); const arr = sd.artists || [];
  if (!arr.length) return { rows: [], artist: '', err: null };
  const who = arr.find((a) => norm(a.name) === norm(name)) || arr[0];
  const rows = []; let offset = 0;
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`${MB}/recording?artist=${who.id}&inc=isrcs+artist-credits+releases&fmt=json&limit=100&offset=${offset}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { if (page === 0) return { rows, artist: who.name, err: `recordings HTTP ${r.status}` }; break; }
    const d = await r.json(); const recs = d.recordings || [];
    for (const rec of recs) {
      const rel = (rec.releases || [])[0] || {};
      rows.push({ artist: (rec['artist-credit'] || []).map((a) => a.name || a.artist?.name).filter(Boolean).join(', '),
        title: rec.title || '', isrc: (rec.isrcs || []).join(' / '), release: rel.title || '',
        date: rec['first-release-date'] || rel.date || '', sources: ['mb'], url: '', image: '' });
    }
    const total = d['recording-count'] || 0; offset += 100;
    if (offset >= total || !recs.length) break;
    await sleep(1000);
  }
  const map = new Map();
  for (const r of rows) { const k = (r.isrc || '').split('/')[0].trim().toUpperCase() || ('t:' + norm(r.title)); if (!map.has(k)) map.set(k, r); }
  return { rows: [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')), artist: who.name, err: null };
}
async function mbTrackSearch(q) {
  const r = await fetch(`${MB}/recording?query=${enc(q)}&fmt=json&limit=8`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { results: [], err: `search HTTP ${r.status}` };
  const d = await r.json(); const recs = (d.recordings || []).slice(0, 6); const results = [];
  for (const rec of recs) {
    let isrcs = rec.isrcs || [];
    if (!isrcs.length) {
      try { const lr = await fetch(`${MB}/recording/${rec.id}?inc=isrcs+releases+artist-credits&fmt=json`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (lr.ok) { const ld = await lr.json(); isrcs = ld.isrcs || []; rec.releases = ld.releases || rec.releases; } } catch (_) {}
      await sleep(1000);
    }
    const rel = (rec.releases || [])[0] || {};
    results.push({ title: rec.title || '', artists: (rec['artist-credit'] || []).map((a) => a.name || a.artist?.name).filter(Boolean).join(', '),
      isrc: (isrcs || []).join(' / '), album: rel.title || '', albumType: '', upc: '', label: '',
      releaseDate: rec['first-release-date'] || rel.date || '', totalTracks: '', trackNumber: '', discNumber: '',
      duration: fmtDur(rec.length || 0), durationMs: rec.length || 0, explicit: false, popularity: '', genres: '',
      markets: '', spotifyUrl: '', previewUrl: '', image: '', source: 'mb' });
  }
  return { results, err: null };
}

// ================================== HTTP ===================================
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Diagnostica: apri /api/discography nel browser (GET) per verificare se
  // Vercel sta passando le chiavi Spotify alla function. Mostra solo sì/no,
  // MAI i valori dei segreti.
  if (req.method === 'GET') {
    const eId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
    const eSec = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    return json({
      ok: true,
      runtime: 'edge',
      env_spotify_configured: !!(eId && eSec),
      env_client_id: eId || '(vuoto)',          // il Client ID è pubblico
      env_secret_length: eSec.length,           // solo la lunghezza, mai il valore
      hint: (eId && eSec)
        ? 'Su Vercel ci sono queste env. Se il Client ID qui sopra NON è il tuo, sono chiavi vecchie/sbagliate: correggile o rimuovile, così il tool userà quelle incollate nell app.'
        : 'Nessuna env su Vercel: il tool usa le chiavi incollate nell app.',
    });
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body; try { body = await req.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  const mode = (body.mode || 'artist').trim();
  const q = (body.q || body.artist || '').trim();
  const id = (body.id || '').trim();
  if (mode !== 'suggest' && !q && !id) return json({ error: 'missing_query' }, 400);

  // Chiavi: prima quelle inviate dall'app (localStorage dell'utente),
  // poi le variabili d'ambiente di Vercel.
  const bodyId = (body.spotifyId || '').trim(), bodySecret = (body.spotifySecret || '').trim();
  const envId = (process.env.SPOTIFY_CLIENT_ID || '').trim(), envSecret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  const SP_ID = bodyId || envId;
  const SP_SECRET = bodySecret || envSecret;
  const hasSp = !!(SP_ID && SP_SECRET);
  const TD_ID = (body.tidalId || process.env.TIDAL_CLIENT_ID || '').trim();
  const TD_SECRET = (body.tidalSecret || process.env.TIDAL_CLIENT_SECRET || '').trim();
  const hasTd = !!(TD_ID && TD_SECRET);
  // Origine delle chiavi + info non sensibili per diagnosticare invalid_client.
  const keySrc = (bodyId && bodySecret) ? 'app(browser)' : (envId ? 'vercel(env)' : 'nessuna');
  const sameKey = !!(SP_SECRET && SP_SECRET === SP_ID);
  const dbg = ` [fonte: ${keySrc} · Client ID: ${SP_ID || '—'} · lunghezza secret: ${SP_SECRET.length}`
    + (sameKey ? ' · ⚠ IL SECRET È UGUALE AL CLIENT ID: hai incollato l\'ID due volte, serve il Client SECRET' : '') + ']';

  try {
    // Provenienza (da un suggerimento, da un link Spotify, o testo libero)
    const prov = (body.prov || '').trim();
    // Fonti scelte dall'utente (Deezer non è più predefinito): se assente, tutte.
    const use = Array.isArray(body.use) ? body.use.map(String) : null;
    const useDz = use ? use.includes('deezer') : true;
    const useSp = use ? use.includes('spotify') : true;
    const useTd = use ? use.includes('tidal') : true;
    const noSource = !useDz && !useSp && !useTd;
    // Token piattaforme (solo se abilitate e con chiavi) — servono anche per i suggerimenti e il CONFRONTO
    const spTokRes = (hasSp && useSp) ? await spToken(SP_ID, SP_SECRET) : { tok: '', err: 'not_configured' };
    const auth = spTokRes.tok ? bearer(spTokRes.tok) : null;
    let tdTok = '';
    if (hasTd && useTd) { try { tdTok = (await tdToken(TD_ID, TD_SECRET)).tok || ''; } catch (_) {} }
    const trySpotify = !!auth && prov !== 'deezer';
    const tryTidal = !!tdTok && prov !== 'deezer' && prov !== 'spotify';

    // -------- suggerimenti: seguono la fonte attiva (Spotify se abilitato, altrimenti Deezer) --------
    if (mode === 'suggest') {
      if (q.length < 2) return json({ suggestions: [] });
      if (useSp && auth) {
        try { const x = await spSuggest(body.kind || 'artist', q, auth);
          if ((x.suggestions || []).length) return json({ suggestions: x.suggestions.map((s) => ({ ...s, prov: 'spotify' })), source: 'spotify' }); } catch (_) {}
      }
      try { const s = await dzSuggest(body.kind || 'artist', q); return json({ suggestions: s.map((x) => ({ ...x, prov: 'deezer' })), source: 'deezer' }); }
      catch (e) { return json({ suggestions: [], err: 'deezer: ' + String(e?.message || e) }); }
    }

    // Nessuna fonte selezionata → chiedi all'utente di scegliere (nelle Impostazioni)
    if (noSource) return json({ needSource: true });

    // -------- album (da link diretto) --------
    if (mode === 'album') {
      if (!id) return json({ error: 'missing_id' }, 400);
      if (trySpotify) { const x = await spAlbumById(id, auth); if (!x.err) return json({ mode: 'artist', artist: x.artist, rows: x.rows, count: x.rows.length, source: 'spotify' }); }
      if (useDz) { try { const x = await dzAlbumById(id); return json({ mode: 'artist', artist: x.artist, rows: x.rows, count: x.rows.length, source: 'deezer' }); }
        catch (e) { return json({ mode: 'artist', rows: [], source: 'deezer', note: 'Deezer: ' + String(e?.message || e) }); } }
      return json({ needSource: true });
    }

    // -------- traccia --------
    if (mode === 'track') {
      if (trySpotify) {
        const x = id ? await spTrackById(id, auth) : await spTrackSearch(q, auth);
        if (!x.err && (x.results || []).length) return json({ mode, results: x.results, source: 'spotify' });
      }
      if (tryTidal && !id) { try { const x = await tdTrackSearch(q, tdTok); if ((x.results || []).length) return json({ mode, results: x.results, source: 'tidal' }); } catch (_) {} }
      if (useDz) { try { const dz = id ? await dzTrackById(id) : await dzTrackSearch(q); return json({ mode, results: dz.results, source: 'deezer' }); }
        catch (e) { const mb = await mbTrackSearch(q); return json({ mode, results: mb.results, source: 'mb', note: 'Deezer: ' + String(e?.message || e) }); } }
      return json({ mode, results: [], source: 'none' });
    }

    // -------- artista --------
    // Raccogli dalle fonti ABILITATE. Con ≥2 fonti restituisco un payload di CONFRONTO.
    {
      const avail = []; const diag = [];
      if (useDz) { try { const dz = await dzDiscography(q, prov === 'deezer' ? id : ''); if (dz.rows.length) avail.push({ name: 'deezer', rows: dz.rows, artist: dz.artist, artistInfo: dz.artistInfo }); else diag.push('Deezer: 0'); } catch (e) { diag.push('Deezer err: ' + String(e?.message || e)); } }
      if (auth) { try { const sp = await spDiscography(q, prov === 'spotify' ? id : '', auth); if (sp.rows.length) avail.push({ name: 'spotify', rows: sp.rows, artist: sp.artist, artistInfo: sp.artistInfo }); else diag.push('Spotify: 0 tracce (artist=' + (sp.artist || '?') + (sp.err ? ', ' + sp.err : '') + ')'); } catch (e) { diag.push('Spotify err: ' + String(e?.message || e)); } }
      if (tdTok) { try { const td = await tdArtistDisco(q, '', tdTok); if (td.rows.length) avail.push({ name: 'tidal', rows: td.rows, artist: td.artist, artistInfo: td.artistInfo }); } catch (_) {} }

      if (avail.length >= 2) {
        const info = avail.find((s) => s.artistInfo)?.artistInfo || null;
        return json({ mode: 'artist', compare: true, sources: avail, artist: avail[0].artist, artistInfo: info });
      }
      if (avail.length === 1) {
        const s = avail[0];
        return json({ mode: 'artist', artist: s.artist, artistInfo: s.artistInfo || null, rows: s.rows, count: s.rows.length, source: s.name });
      }
      // FALLBACK AFFIDABILE: se le fonti scelte non hanno prodotto nulla (es. Spotify in
      // penalita'/429), recupera da Deezer — gli ISRC sono UNIVERSALI, identici a Spotify.
      if (!useDz) {
        try {
          const dz = await dzDiscography(q, prov === 'deezer' ? id : '');
          if (dz.rows.length) return json({ mode: 'artist', artist: dz.artist, artistInfo: dz.artistInfo || null,
            rows: dz.rows, count: dz.rows.length, source: 'deezer',
            note: 'Spotify non disponibile ora (rate-limit) — stessa discografia con ISRC identici da Deezer.' });
          diag.push('Deezer(fallback): 0');
        } catch (e) { diag.push('Deezer(fallback) err: ' + String(e?.message || e)); }
      }
      const mb = await mbDiscography(q);
      return json({ mode: 'artist', artist: mb.artist, rows: mb.rows, count: mb.rows.length, source: 'mb', note: diag.length ? diag.join(' · ') : null });
    }
  } catch (e) {
    return json({ error: String(e?.message || e) }, 200);
  }
}

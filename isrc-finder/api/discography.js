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
async function spDiscography(name, artistId, auth) {
  let who = { id: artistId, name: name };
  if (!artistId) {
    const s = await spArtistId(name, auth);
    if (s.err) return { rows: [], artist: '', err: s.err };
    if (!s.id) return { rows: [], artist: '', err: null };
    who = s;
  } else {
    const ar = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (ar.ok) { const ad = await ar.json(); who.name = ad.name || name; }
  }

  const albums = []; const seen = new Set();
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await fetch(`https://api.spotify.com/v1/artists/${who.id}/albums?include_groups=album,single,compilation&limit=50&offset=${offset}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) break; const d = await r.json();
    const items = d.items || [];
    for (const a of items) if (a.id && !seen.has(a.id)) { seen.add(a.id); albums.push(a); }
    if (items.length < 50) break;
  }
  const rows = []; const trackIndex = new Map();
  const meta = new Map(albums.map((a) => [a.id, a]));
  const ids = albums.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 20) {
    const r = await fetch(`https://api.spotify.com/v1/albums?ids=${ids.slice(i, i + 20).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue; const d = await r.json();
    for (const a of d.albums || []) {
      const m = meta.get(a.id) || a;
      for (const tk of (a.tracks?.items || [])) {
        const credited = (tk.artists || []).some((x) => x.id === who.id || norm(x.name) === norm(who.name));
        if (!credited) continue;
        const obj = { artist: (tk.artists || []).map((x) => x.name).join(', '), title: tk.name || '', isrc: '',
          release: m.name || a.name || '', date: m.release_date || a.release_date || '', sources: ['spotify'],
          url: tk.external_urls?.spotify || '', image: bigImg(m.images || a.images), _tid: tk.id };
        rows.push(obj);
        if (tk.id) trackIndex.set(tk.id, obj);
      }
    }
  }
  const tids = [...trackIndex.keys()];
  for (let i = 0; i < tids.length; i += 50) {
    const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${tids.slice(i, i + 50).join(',')}`, { headers: auth, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue; const d = await r.json();
    for (const tk of d.tracks || []) { const o = tk && trackIndex.get(tk.id); if (o) o.isrc = tk.external_ids?.isrc || ''; }
  }
  rows.forEach((o) => delete o._tid);
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.title || '').localeCompare(b.title || ''));
  return { rows, artist: who.name, err: null };
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
  // Origine delle chiavi + info non sensibili per diagnosticare invalid_client.
  const keySrc = (bodyId && bodySecret) ? 'app(browser)' : (envId ? 'vercel(env)' : 'nessuna');
  const sameKey = !!(SP_SECRET && SP_SECRET === SP_ID);
  const dbg = ` [fonte: ${keySrc} · Client ID: ${SP_ID || '—'} · lunghezza secret: ${SP_SECRET.length}`
    + (sameKey ? ' · ⚠ IL SECRET È UGUALE AL CLIENT ID: hai incollato l\'ID due volte, serve il Client SECRET' : '') + ']';

  try {
    // Un solo token per richiesta; se le chiavi ci sono ma il token fallisce,
    // l'errore viene SEMPRE propagato (niente più fallimenti silenziosi).
    const t = hasSp ? await spToken(SP_ID, SP_SECRET) : { tok: '', err: 'not_configured' };
    const auth = t.tok ? bearer(t.tok) : null;
    const spNote = () => (t.err === 'not_configured' ? 'not_configured' : ('Spotify: ' + t.err + dbg));

    // -------- suggerimenti (solo Spotify: servono le immagini) --------
    if (mode === 'suggest') {
      if (!auth || q.length < 2) {
        const e = t.err ? (t.err === 'not_configured' ? 'not_configured' : (t.err + dbg)) : null;
        return json({ suggestions: [], err: e });
      }
      const x = await spSuggest(body.kind || 'artist', q, auth);
      return json({ suggestions: x.suggestions, err: x.err });
    }

    // -------- album (da link diretto) --------
    if (mode === 'album') {
      if (!auth) return json({ mode: 'artist', rows: [], source: 'mb', note: spNote() });
      if (!id) return json({ error: 'missing_id' }, 400);
      const x = await spAlbumById(id, auth);
      if (x.err) return json({ mode: 'artist', rows: [], artist: '', source: 'spotify', note: 'Spotify: ' + x.err });
      return json({ mode: 'artist', artist: x.artist, rows: x.rows, count: x.rows.length, source: 'spotify' });
    }

    // -------- traccia --------
    if (mode === 'track') {
      if (auth) {
        const x = id ? await spTrackById(id, auth) : await spTrackSearch(q, auth);
        if (!x.err && (x.results || []).length) return json({ mode, results: x.results, source: 'spotify' });
        const mb = await mbTrackSearch(q);
        const useSp = !x.err && (x.results || []).length;
        return json({ mode, results: useSp ? x.results : mb.results, source: useSp ? 'spotify' : 'mb', note: x.err ? ('Spotify: ' + x.err) : null });
      }
      const mb = await mbTrackSearch(q);
      return json({ mode, results: mb.results, source: 'mb', note: spNote(), err: mb.err });
    }

    // -------- artista --------
    if (auth) {
      const x = await spDiscography(q, id, auth);
      if (!x.err) return json({ mode: 'artist', artist: x.artist, rows: x.rows, count: x.rows.length, source: 'spotify' });
      const mb = await mbDiscography(q);
      return json({ mode: 'artist', artist: mb.artist, rows: mb.rows, count: mb.rows.length, source: 'mb', note: 'Spotify: ' + x.err });
    }
    const mb = await mbDiscography(q);
    return json({ mode: 'artist', artist: mb.artist, rows: mb.rows, count: mb.rows.length, source: 'mb', note: spNote(), err: mb.err });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 200);
  }
}

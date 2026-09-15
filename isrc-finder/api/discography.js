// ============================================================================
//  api/discography — recupera la discografia (tracce + ISRC) di un ARTISTA
//  da Spotify e/o Discogs. MusicBrainz viene chiamato direttamente dal browser
//  (CORS libero, nessuna chiave) e non passa da qui.
//
//  Ogni richiesta gestisce UNA sola fonte (source: "spotify" | "discogs") così
//  da restare entro i tempi della edge function; il browser fa le due chiamate
//  in parallelo e unisce i risultati con quelli di MusicBrainz.
//
//  Le credenziali possono arrivare da:
//    1) variabili d'ambiente Vercel  → SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
//                                       DISCOGS_TOKEN
//    2) corpo della richiesta        → spotifyId, spotifySecret, discogsToken
//       (utile per uso personale: la chiave resta nel browser dell'utente e
//        transita solo verso questa function, mai nel codice statico pubblicato)
//
//  Deploy: Vercel (runtime edge). Su GitHub Pages puro questa function non
//  esiste: in quel caso il tool funziona comunque con la sola MusicBrainz.
// ============================================================================

export const config = { runtime: 'edge', regions: ['iad1'] };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const UA = 'ISRCFinder/1.0 ( https://github.com/rahodavide95-sketch/rhdev )';
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// --------------------------------- Spotify ---------------------------------
async function spToken(id, secret) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${id}:${secret}`),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    let t = ''; try { t = await r.text(); } catch (_) {}
    return { tok: '', err: `token HTTP ${r.status} ${t.slice(0, 120)}` };
  }
  const d = await r.json();
  return { tok: d.access_token || '', err: d.access_token ? null : 'no access_token' };
}

async function spArtistId(name, tok) {
  const r = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=5`,
    { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { id: '', name: '', err: `search HTTP ${r.status}` };
  const d = await r.json();
  const items = d.artists?.items || [];
  if (!items.length) return { id: '', name: '', err: null };
  const exact = items.find((a) => norm(a.name) === norm(name));
  const pick = exact || items[0];
  return { id: pick.id, name: pick.name, err: null };
}

async function spFetch(name, tok) {
  const who = await spArtistId(name, tok);
  if (who.err) return { items: [], artist: '', err: who.err };
  if (!who.id) return { items: [], artist: '', err: null };

  // 1) tutti gli album/singoli/compilation dell'artista
  const albums = [];
  const seen = new Set();
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await fetch(
      `https://api.spotify.com/v1/artists/${who.id}/albums?include_groups=album,single,compilation&limit=50&offset=${offset}`,
      { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) break;
    const d = await r.json();
    const items = d.items || [];
    for (const a of items) {
      if (a.id && !seen.has(a.id)) { seen.add(a.id); albums.push(a); }
    }
    if (items.length < 50) break;
  }

  // 2) tracce di ogni album (batch da 20) — teniamo solo quelle in cui l'artista è accreditato
  const out = [];
  const trackIndex = new Map(); // id traccia -> oggetto (per l'ISRC)
  const albumIds = albums.map((a) => a.id);
  const albumMeta = new Map(albums.map((a) => [a.id, a]));
  for (let i = 0; i < albumIds.length; i += 20) {
    const ids = albumIds.slice(i, i + 20).join(',');
    const r = await fetch(`https://api.spotify.com/v1/albums?ids=${ids}`,
      { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const d = await r.json();
    for (const a of d.albums || []) {
      const meta = albumMeta.get(a.id) || a;
      const rel = meta.name || a.name || '';
      const date = meta.release_date || a.release_date || '';
      for (const t of (a.tracks?.items || [])) {
        const credited = (t.artists || []).some((x) => x.id === who.id) ||
          (t.artists || []).some((x) => norm(x.name) === norm(who.name));
        if (!credited) continue; // salta le tracce di altri artisti nelle compilation
        const obj = {
          artist: (t.artists || []).map((x) => x.name).join(', '),
          title: t.name || '',
          isrc: '',
          release: rel,
          date,
          sources: ['spotify'],
          _tid: t.id,
        };
        out.push(obj);
        if (t.id) trackIndex.set(t.id, obj);
      }
    }
  }

  // 3) ISRC delle tracce (batch da 50)
  const tids = [...trackIndex.keys()];
  for (let i = 0; i < tids.length; i += 50) {
    const ids = tids.slice(i, i + 50).join(',');
    const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}`,
      { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const d = await r.json();
    for (const t of d.tracks || []) {
      const o = t && trackIndex.get(t.id);
      if (o) o.isrc = t.external_ids?.isrc || '';
    }
  }
  out.forEach((o) => delete o._tid);
  return { items: out, artist: who.name, err: null };
}

// --------------------------------- Discogs ---------------------------------
// Discogs NON espone gli ISRC. Recuperiamo comunque le tracklist (titolo +
// artista) così da incrociarle con MusicBrainz/Spotify e far emergere le
// tracce che solo Discogs conosce (ISRC vuoto, da completare a mano).
async function dcArtistId(name, token) {
  const r = await fetch(
    `https://api.discogs.com/database/search?type=artist&q=${encodeURIComponent(name)}&per_page=5&token=${token}`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { id: '', err: `search HTTP ${r.status}` };
  const d = await r.json();
  const items = d.results || [];
  if (!items.length) return { id: '', err: null };
  const exact = items.find((a) => norm(a.title) === norm(name));
  return { id: String((exact || items[0]).id), err: null };
}

async function dcRelease(rid, token) {
  try {
    const r = await fetch(`https://api.discogs.com/releases/${rid}?token=${token}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { title: '', date: '', catalog: '', tracks: [] };
    const d = await r.json();
    const tracks = (d.tracklist || [])
      .filter((t) => (t.type_ ? t.type_ === 'track' : true) && (t.title || '').trim())
      .map((t) => ({
        artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
        title: t.title || '',
        isrc: '',
      }));
    return {
      title: d.title || '',
      date: d.released || (d.year ? String(d.year) : ''),
      catalog: (d.labels || []).map((l) => l.catno).filter(Boolean)[0] || '',
      tracks,
    };
  } catch (_) { return { title: '', date: '', catalog: '', tracks: [] }; }
}

async function dcFetch(name, token) {
  const who = await dcArtistId(name, token);
  if (who.err) return { items: [], err: who.err };
  if (!who.id) return { items: [], err: null };

  // elenco release dell'artista (solo ruolo "Main"), deduplicate per master
  const rels = [];
  const seenMaster = new Set();
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(
      `https://api.discogs.com/artists/${who.id}/releases?per_page=100&page=${page}&sort=year&token=${token}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) break;
    const d = await r.json();
    for (const x of (d.releases || [])) {
      if ((x.role || 'Main') !== 'Main') continue;
      const mkey = x.type === 'master' ? 'm' + x.id : (x.main_release ? 'm' + x.main_release : 'r' + x.id);
      if (seenMaster.has(mkey)) continue;
      seenMaster.add(mkey);
      rels.push({ id: x.main_release || x.id, title: x.title || '', year: x.year ? String(x.year) : '' });
    }
    const pages = d.pagination?.pages || 1;
    if (page >= pages) break;
    await sleep(300);
  }

  // dettaglio (tracklist) con tetto per restare nei tempi
  const DEEP_MAX = 20;
  const out = [];
  let deep = 0;
  for (const rel of rels) {
    if (deep >= DEEP_MAX || !rel.id) {
      out.push({ artist: name, title: '', isrc: '', release: rel.title, date: rel.year, sources: ['discogs'], _releaseOnly: true });
      continue;
    }
    const det = await dcRelease(String(rel.id), token);
    deep++;
    await sleep(700); // rate limit Discogs autenticato (~60/min)
    const relTitle = det.title || rel.title;
    const relDate = det.date || rel.year;
    if (!det.tracks.length) {
      out.push({ artist: name, title: '', isrc: '', release: relTitle, date: relDate, sources: ['discogs'], _releaseOnly: true });
      continue;
    }
    for (const t of det.tracks) {
      out.push({ artist: t.artist || name, title: t.title, isrc: '', release: relTitle, date: relDate, sources: ['discogs'] });
    }
  }
  return { items: out, err: null };
}

// ----------------------------------- HTTP ----------------------------------
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  const source = (body.source || '').trim();
  const artist = (body.artist || '').trim();
  if (!artist) return json({ error: 'missing_artist' }, 400);

  const SP_ID = body.spotifyId || process.env.SPOTIFY_CLIENT_ID || '';
  const SP_SECRET = body.spotifySecret || process.env.SPOTIFY_CLIENT_SECRET || '';
  const DISCOGS = body.discogsToken || process.env.DISCOGS_TOKEN || '';

  try {
    if (source === 'spotify') {
      if (!SP_ID || !SP_SECRET) return json({ items: [], err: 'not_configured' });
      const t = await spToken(SP_ID, SP_SECRET);
      if (!t.tok) return json({ items: [], err: t.err });
      const x = await spFetch(artist, t.tok);
      return json({ items: x.items, artist: x.artist, err: x.err });
    }
    if (source === 'discogs') {
      if (!DISCOGS) return json({ items: [], err: 'not_configured' });
      const x = await dcFetch(artist, DISCOGS);
      return json({ items: x.items, err: x.err });
    }
    return json({ error: 'bad_source' }, 400);
  } catch (e) {
    return json({ items: [], err: String(e?.message || e) }, 200);
  }
}

// ============================================================================
// catalog-search — ricerca e import del catalogo di un'etichetta da più fonti
//   Fonti: MusicBrainz (sempre, no key) + Discogs (token) + Spotify (client creds)
//   Segreti (Supabase → Edge Functions → Secrets), tutti FACOLTATIVI:
//     DISCOGS_TOKEN, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
//   Deploy:  supabase functions deploy catalog-search --no-verify-jwt
// ============================================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "LabelFinance/1.0 ( https://labelfinance.app )";
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ----------------------------- MusicBrainz --------------------------------
async function mbSearchLabels(q: string) {
  const r = await fetch(`https://musicbrainz.org/ws/2/label?query=${encodeURIComponent(q)}&fmt=json&limit=8`,
    { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) return { items: [], err: `HTTP ${r.status}` };
  const d = await r.json();
  return { items: (d.labels || []).map((l: any) => ({
    source: "mb", id: l.id, name: l.name,
    detail: ["MusicBrainz", l.country, l.disambiguation].filter(Boolean).join(" · "),
  })), err: null as string | null };
}
// Estrae la tracklist (titolo + ISRC + artista) da una release MusicBrainz.
function mbTracks(x: any) {
  const tracks: any[] = [];
  for (const md of (x.media || [])) {
    for (const tk of (md.tracks || [])) {
      const rec = tk.recording || {};
      const isrc = (rec.isrcs || [])[0] || "";
      const artist = (tk["artist-credit"] || rec["artist-credit"] || [])
        .map((a: any) => a.name || a.artist?.name).filter(Boolean).join(", ");
      const title = tk.title || rec.title || "";
      if (title || isrc) tracks.push({ title, isrc, artist });
    }
  }
  return tracks;
}
async function mbFetch(id: string) {
  const out: any[] = []; let offset = 0;
  // Includi le tracce (recordings) e i loro ISRC. Se la combinazione di "inc"
  // non viene accettata, si scala automaticamente a un set più semplice.
  const incLevels = ["artist-credits+recordings+isrcs", "artist-credits+recordings", "artist-credits"];
  let inc = incLevels[0];
  const mbUrl = (o: number) => `https://musicbrainz.org/ws/2/release?label=${id}&inc=${inc}&fmt=json&limit=100&offset=${o}`;
  for (let page = 0; page < 12; page++) {
    let r = await fetch(mbUrl(offset), { headers: { "User-Agent": UA } });
    if (!r.ok && page === 0) {
      for (const lvl of incLevels.slice(1)) {   // fallback progressivo solo alla prima pagina
        inc = lvl;
        r = await fetch(mbUrl(offset), { headers: { "User-Agent": UA } });
        if (r.ok) break;
      }
    }
    if (!r.ok) break;
    const d = await r.json();
    const rels = d.releases || [];
    for (const x of rels) {
      out.push({
        title: x.title || "",
        artist: (x["artist-credit"] || []).map((a: any) => a.name || a.artist?.name).filter(Boolean).join(", "),
        date: x.date || "",
        upc: x.barcode || "",
        catalog: (x["label-info"] || []).map((li: any) => li["catalog-number"]).filter(Boolean)[0] || "",
        tracks: mbTracks(x),
        source: "mb",
      });
    }
    const total = d["release-count"] || 0; offset += 100;
    if (offset >= total || !rels.length) break;
    await sleep(1100); // rate limit MB ~1/sec
  }
  return out;
}

// ------------------------------- Discogs ----------------------------------
async function dcSearchLabels(q: string, token: string) {
  const r = await fetch(`https://api.discogs.com/database/search?type=label&q=${encodeURIComponent(q)}&per_page=8&token=${token}`,
    { headers: { "User-Agent": UA } });
  if (!r.ok) return { items: [], err: `HTTP ${r.status}` };
  const d = await r.json();
  return { items: (d.results || []).map((l: any) => ({ source: "discogs", id: String(l.id), name: l.title, detail: "Discogs" })), err: null as string | null };
}
// Tracklist di una singola release Discogs (Discogs non espone gli ISRC).
async function dcRelease(rid: string, token: string) {
  try {
    const r = await fetch(`https://api.discogs.com/releases/${rid}?token=${token}`, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.tracklist || [])
      .filter((t: any) => (t.type_ ? t.type_ === "track" : true) && (t.title || "").trim())
      .map((t: any) => ({
        title: t.title || "",
        isrc: "",
        artist: (t.artists || []).map((a: any) => a.name).filter(Boolean).join(", "),
      }));
  } catch (_) { return []; }
}
async function dcFetch(id: string, token: string) {
  const out: any[] = [];
  let deep = 0; const DEEP_MAX = 60;   // tetto di chiamate di dettaglio per restare entro i tempi
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.discogs.com/labels/${id}/releases?per_page=100&page=${page}&token=${token}`,
      { headers: { "User-Agent": UA } });
    if (!r.ok) break;
    const d = await r.json();
    const rels = d.releases || [];
    for (const x of rels) {
      let tracks: any[] = [];
      const rid = x.id || x.main_release;
      if (rid && deep < DEEP_MAX) {
        tracks = await dcRelease(String(rid), token); deep++;
        await sleep(1000);  // ~60 richieste/min (rate limit Discogs autenticato)
      }
      out.push({ title: x.title || "", artist: x.artist || "", date: x.year ? String(x.year) : "",
        upc: "", catalog: x.catno || "", tracks, source: "discogs" });
    }
    const pages = d.pagination?.pages || 1;
    if (page >= pages || !rels.length) break;
    await sleep(300);
  }
  return out;
}

// ------------------------------- Spotify ----------------------------------
async function spToken(id: string, secret: string) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${secret}`) },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) { let t = ""; try { t = await r.text(); } catch (_) {} return { tok: "", err: `token HTTP ${r.status} ${t.slice(0, 120)}` }; }
  const d = await r.json();
  return { tok: d.access_token || "", err: d.access_token ? null : "no access_token" };
}
async function spFetch(name: string, tok: string) {
  const out: any[] = []; const albumIds: string[] = []; let err: string | null = null;
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent('label:"' + name + '"')}&type=album&limit=50&offset=${offset}`,
      { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) { if (offset === 0) { let t = ""; try { t = await r.text(); } catch (_) {} err = `search HTTP ${r.status} ${t.slice(0, 120)}`; } break; }
    const d = await r.json();
    const items = d.albums?.items || [];
    for (const a of items) {
      out.push({ title: a.name || "", artist: (a.artists || []).map((x: any) => x.name).join(", "),
        date: a.release_date || "", upc: "", catalog: "", source: "spotify", _id: a.id });
      if (a.id) albumIds.push(a.id);
    }
    if (items.length < 50) break;
  }
  const trackIndex = new Map<string, any>();   // id traccia -> oggetto traccia (per gli ISRC)
  for (let i = 0; i < albumIds.length; i += 20) {
    const ids = albumIds.slice(i, i + 20).join(",");
    const r = await fetch(`https://api.spotify.com/v1/albums?ids=${ids}`, { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) continue;
    const d = await r.json();
    for (const a of d.albums || []) {
      const upc = a?.external_ids?.upc || "";
      const m = out.find((o) => o._id === a.id); if (!m) continue;
      if (upc) m.upc = upc;
      m.tracks = (a.tracks?.items || []).map((t: any) => {
        const obj = { title: t.name || "", artist: (t.artists || []).map((x: any) => x.name).join(", "), isrc: "", _tid: t.id };
        if (t.id) trackIndex.set(t.id, obj);
        return obj;
      });
    }
  }
  // ISRC delle tracce, in batch da 50
  const tids = [...trackIndex.keys()];
  for (let i = 0; i < tids.length; i += 50) {
    const ids = tids.slice(i, i + 50).join(",");
    const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}`, { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) continue;
    const d = await r.json();
    for (const t of d.tracks || []) { const o = t && trackIndex.get(t.id); if (o) o.isrc = t.external_ids?.isrc || ""; }
  }
  out.forEach((o) => { delete o._id; (o.tracks || []).forEach((t: any) => delete t._tid); });
  return { items: out, err };
}

// ------------------------------- merge ------------------------------------
function merge(lists: any[][]) {
  const map = new Map<string, any>();
  const tkey = (t: any) => ((t.isrc || "").toLowerCase() || norm(t.title));
  for (const list of lists) for (const r of list) {
    if (!r.title && !r.upc) continue;
    const key = (r.upc || (norm(r.title) + "|" + norm(r.artist))).toLowerCase();
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...r, tracks: r.tracks || [] }); continue; }
    cur.upc = cur.upc || r.upc; cur.catalog = cur.catalog || r.catalog;
    cur.artist = cur.artist || r.artist; cur.date = cur.date || r.date;
    // unisci le tracklist delle varie fonti (dedup per ISRC o titolo)
    const incoming = r.tracks || [];
    if (incoming.length) {
      if (!cur.tracks || !cur.tracks.length) cur.tracks = incoming;
      else {
        const seen = new Set((cur.tracks as any[]).map(tkey).filter(Boolean));
        for (const t of incoming) { const k = tkey(t); if (k && !seen.has(k)) { seen.add(k); cur.tracks.push(t); } }
      }
    }
  }
  return [...map.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { action, query, picks } = await req.json();
    const DISCOGS = Deno.env.get("DISCOGS_TOKEN") || "";
    const SP_ID = Deno.env.get("SPOTIFY_CLIENT_ID") || "";
    const SP_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET") || "";

    if (action === "search") {
      const q = (query || "").trim();
      if (!q) return json({ candidates: [] });
      const [mb, dc] = await Promise.all([
        mbSearchLabels(q).catch((e) => ({ items: [], err: String(e?.message || e) })),
        DISCOGS ? dcSearchLabels(q, DISCOGS).catch((e) => ({ items: [], err: String(e?.message || e) })) : Promise.resolve({ items: [], err: "no token" }),
      ]);
      return json({
        candidates: [...mb.items, ...dc.items],
        spotify: !!(SP_ID && SP_SECRET),
        sources: { musicbrainz: { n: mb.items.length, err: mb.err }, discogs: { n: dc.items.length, err: dc.err }, spotify: !!(SP_ID && SP_SECRET) },
      });
    }

    if (action === "fetch") {
      const p = picks || {};
      const out: any[] = [];
      const sources: any = { musicbrainz: { n: 0, err: null }, discogs: { n: 0, err: null }, spotify: { n: 0, err: null } };
      for (const id of (p.mb || [])) { try { const x = await mbFetch(id); out.push(...x); sources.musicbrainz.n += x.length; } catch (e) { sources.musicbrainz.err = String(e?.message || e); } }
      if (DISCOGS) { for (const id of (p.discogs || [])) { try { const x = await dcFetch(id, DISCOGS); out.push(...x); sources.discogs.n += x.length; } catch (e) { sources.discogs.err = String(e?.message || e); } } }
      else if ((p.discogs || []).length) sources.discogs.err = "no token";
      if (p.spotifyName) {
        if (SP_ID && SP_SECRET) {
          const t = await spToken(SP_ID, SP_SECRET);
          if (!t.tok) sources.spotify.err = t.err;
          else { const x = await spFetch(p.spotifyName, t.tok); if (x.err) sources.spotify.err = x.err; out.push(...x.items); sources.spotify.n += x.items.length; }
        } else sources.spotify.err = "not configured";
      }
      const releases = merge([out]);
      return json({ releases, count: releases.length, sources });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

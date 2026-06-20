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
async function mbFetch(id: string) {
  const out: any[] = []; let offset = 0;
  for (let page = 0; page < 12; page++) {
    const r = await fetch(`https://musicbrainz.org/ws/2/release?label=${id}&inc=artist-credits&fmt=json&limit=100&offset=${offset}`,
      { headers: { "User-Agent": UA } });
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
async function dcFetch(id: string, token: string) {
  const out: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.discogs.com/labels/${id}/releases?per_page=100&page=${page}&token=${token}`,
      { headers: { "User-Agent": UA } });
    if (!r.ok) break;
    const d = await r.json();
    const rels = d.releases || [];
    for (const x of rels) {
      out.push({ title: x.title || "", artist: x.artist || "", date: x.year ? String(x.year) : "",
        upc: "", catalog: x.catno || "", source: "discogs" });
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
  if (!r.ok) return "";
  return (await r.json()).access_token || "";
}
async function spFetch(name: string, tok: string) {
  const out: any[] = []; const albumIds: string[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent('label:"' + name + '"')}&type=album&limit=50&offset=${offset}`,
      { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) break;
    const d = await r.json();
    const items = d.albums?.items || [];
    for (const a of items) {
      out.push({ title: a.name || "", artist: (a.artists || []).map((x: any) => x.name).join(", "),
        date: a.release_date || "", upc: "", catalog: "", source: "spotify", _id: a.id });
      if (a.id) albumIds.push(a.id);
    }
    if (items.length < 50) break;
  }
  // UPC dai dettagli album (batch da 20)
  for (let i = 0; i < albumIds.length; i += 20) {
    const ids = albumIds.slice(i, i + 20).join(",");
    const r = await fetch(`https://api.spotify.com/v1/albums?ids=${ids}`, { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) continue;
    const d = await r.json();
    for (const a of d.albums || []) {
      const upc = a?.external_ids?.upc || "";
      const m = out.find((o) => o._id === a.id); if (m && upc) m.upc = upc;
    }
  }
  out.forEach((o) => delete o._id);
  return out;
}

// ------------------------------- merge ------------------------------------
function merge(lists: any[][]) {
  const map = new Map<string, any>();
  for (const list of lists) for (const r of list) {
    if (!r.title && !r.upc) continue;
    const key = (r.upc || (norm(r.title) + "|" + norm(r.artist))).toLowerCase();
    const cur = map.get(key);
    if (!cur) { map.set(key, r); continue; }
    cur.upc = cur.upc || r.upc; cur.catalog = cur.catalog || r.catalog;
    cur.artist = cur.artist || r.artist; cur.date = cur.date || r.date;
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
      const tasks: Promise<any[]>[] = [];
      for (const id of (p.mb || [])) tasks.push(mbFetch(id).catch(() => []));
      if (DISCOGS) for (const id of (p.discogs || [])) tasks.push(dcFetch(id, DISCOGS).catch(() => []));
      if (p.spotifyName && SP_ID && SP_SECRET) {
        tasks.push((async () => { const t = await spToken(SP_ID, SP_SECRET); return t ? spFetch(p.spotifyName, t).catch(() => []) : []; })());
      }
      const lists = await Promise.all(tasks);
      const releases = merge(lists);
      return json({ releases, count: releases.length });
    }
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

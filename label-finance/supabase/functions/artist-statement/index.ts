// ============================================================================
// artist-statement — statement royalty in sola lettura per il portale artista
//   Riceve un token (link condiviso) e calcola, lato server, SOLO lo statement
//   di quell'artista: l'artista non vede mai gli altri dati dell'etichetta.
//   Deploy:  supabase functions deploy artist-statement --no-verify-jwt
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => (s ?? "").toString().trim().toLowerCase();
const digits = (s: unknown) => (s ?? "").toString().replace(/\D/g, "");

function toEur(label: any, n: unknown, cur: unknown) {
  const r = (label.rates && label.rates[(String(cur || "EUR")).toUpperCase()]) ?? 1;
  return (Number(n) || 0) * r;
}
function releaseFor(label: any, t: any) {
  const rels = label.releases || [];
  const cat = norm(t.catalog);
  let rel = cat ? rels.find((r: any) => norm(r.catalog) === cat) : null;
  if (!rel) { const u = digits(t.upc || t.code); if (u) rel = rels.find((r: any) => digits(r.upc) === u); }
  if (!rel) { const i = norm(t.isrc); if (i) rel = rels.find((r: any) => (r.tracks || []).some((x: any) => norm(x.isrc) === i)); }
  if (!rel) { const p = norm(t.product); if (p) rel = rels.find((r: any) => norm(r.title) === p); }
  return rel || null;
}
function splitsForTx(label: any, t: any) {
  const rel = releaseFor(label, t); const iso = norm(t.isrc);
  if (rel) {
    if (iso && rel.tracks) { const tr = rel.tracks.find((x: any) => norm(x.isrc) === iso && x.splits && x.splits.length); if (tr) return { rel, splits: tr.splits }; }
    return { rel, splits: rel.splits || [] };
  }
  if (iso) { for (const r of (label.releases || [])) { const tr = (r.tracks || []).find((x: any) => norm(x.isrc) === iso && x.splits && x.splits.length); if (tr) return { rel: r, splits: tr.splits }; } }
  return null;
}
function royFor(label: any, txs: any[], lc: string) {
  let tot = 0;
  for (const t of txs) {
    const eur = toEur(label, t.net, t.currency); const m = splitsForTx(label, t);
    if (!m || !m.splits) continue;
    for (const s of m.splits) if (norm(s.name) === lc) tot += eur * (+s.pct || 0) / 100;
  }
  return tot;
}
function computeStatement(label: any, name: string, from: string | null, to: string | null) {
  const inP = (d: string) => (!from && !to) ? true : ((!from || d >= from) && (!to || d <= to));
  const income = (label.transactions || []).filter((t: any) => t.kind === "income");
  const lc = norm(name); const lines: any[] = []; let total = 0;
  for (const t of income) {
    const d = (t.date || ""); if (!inP(d)) continue;
    const m = splitsForTx(label, t); if (!m || !m.splits) continue;
    const sp = m.splits.find((s: any) => norm(s.name) === lc); if (!sp) continue;
    const eur = toEur(label, t.net, t.currency); const pct = +sp.pct || 0; const share = eur * pct / 100; total += share;
    lines.push({ date: d, product: t.product || (m.rel && m.rel.title) || "", catalog: (m.rel && m.rel.catalog) || t.catalog || "", gross: +eur.toFixed(2), pct, share: +share.toFixed(2) });
  }
  lines.sort((a, b) => ("" + a.date).localeCompare("" + b.date));
  const recoupable = (label.recoup || []).filter((r: any) => norm(r.artist) === lc).reduce((s: number, r: any) => s + (+r.amount || 0), 0);
  const lifeRoy = royFor(label, income, lc);
  const beforeRoy = from ? royFor(label, income.filter((t: any) => ("" + (t.date || "")) < from), lc) : 0;
  const netPay = Math.max(0, Math.max(0, lifeRoy - recoupable) - Math.max(0, beforeRoy - recoupable));
  return {
    artist: name, from: from || null, to: to || null, lines,
    total: +total.toFixed(2), recoupable: +recoupable.toFixed(2),
    recouped: +Math.min(lifeRoy, recoupable).toFixed(2), residual: +Math.max(0, recoupable - lifeRoy).toFixed(2),
    netPay: +netPay.toFixed(2), currency: "EUR",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { token, from, to } = await req.json();
    if (!token) return json({ error: "no_token" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: share } = await sb.from("artist_shares").select("owner_id,label_id,artist_name,revoked").eq("token", token).maybeSingle();
    if (!share || share.revoked) return json({ error: "not_found" }, 404);
    const { data: st } = await sb.from("app_state").select("data").eq("user_id", share.owner_id).maybeSingle();
    const account: any = st?.data || {};
    const label = (account.labels || []).find((l: any) => l.id === share.label_id) || (account.labels || [])[0];
    if (!label) return json({ error: "no_label" }, 404);
    const statement = computeStatement(label, share.artist_name, from || null, to || null);
    return json({
      ok: true,
      label: { name: (label.profile && label.profile.label) || label.name || "Label", logo: (label.profile && label.profile.logo) || "" },
      statement,
    });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

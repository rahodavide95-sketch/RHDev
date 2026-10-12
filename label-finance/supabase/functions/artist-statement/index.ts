// ============================================================================
// artist-statement — statement royalty in sola lettura per il portale artista
//   Riceve un token (link condiviso) e calcola, lato server, SOLO lo statement
//   di quell'artista: l'artista non vede mai gli altri dati dell'etichetta.
//   I calcoli sono gli stessi dell'app: ../_shared/lfcore.js è una copia di
//   label-finance/core.js (un test controlla che siano identici).
//   Deploy:  supabase functions deploy artist-statement --no-verify-jwt
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import "../_shared/lfcore.js";

// deno-lint-ignore no-explicit-any
const LFCore = (globalThis as any).LFCore;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ymdOrNull = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { token, from, to } = await req.json();
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(token)) return json({ error: "not_found" }, 404);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: share } = await sb.from("artist_shares").select("owner_id,label_id,artist_name,revoked").eq("token", token).maybeSingle();
    if (!share || share.revoked) return json({ error: "not_found" }, 404);
    const { data: st } = await sb.from("app_state").select("data").eq("user_id", share.owner_id).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const account: any = st?.data || {};
    // solo l'etichetta del link: se è stata eliminata, il link non mostra nulla
    // deno-lint-ignore no-explicit-any
    const label = (account.labels || []).find((l: any) => l && l.id === share.label_id);
    if (!label) return json({ error: "no_label" }, 404);
    const s = LFCore.computeStatement(label, share.artist_name, ymdOrNull(from), ymdOrNull(to));
    return json({
      ok: true,
      label: {
        name: (label.profile && label.profile.label) || label.name || "Label",
        logo: LFCore.safeImgSrc((label.profile && label.profile.logo) || ""),
      },
      statement: {
        artist: share.artist_name, from: s.from, to: s.to, currency: "EUR",
        // deno-lint-ignore no-explicit-any
        lines: s.lines.map((l: any) => ({ date: l.date, product: l.product, catalog: l.catalog, gross: r2(l.gross), pct: l.pct, share: r2(l.share) })),
        total: r2(s.total), recoupable: r2(s.recoupable), recouped: r2(s.recouped), residual: r2(s.residual),
        netPay: r2(s.netPay), paidInPeriod: r2(s.paidInPeriod), paidToDate: r2(s.paidToDate), balance: r2(s.balance),
      },
    });
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});

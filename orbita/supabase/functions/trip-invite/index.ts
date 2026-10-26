// Supabase Edge Function — trip-invite
// Salva l'invito a un viaggio e manda l'email alla persona invitata.
//
// Sicurezza:
//  • lavora CON LE CREDENZIALI DI CHI INVITA (niente chiave service_role): le regole
//    RLS del database decidono, quindi si può invitare solo sui propri viaggi;
//  • richiede email verificata; limiti anti-abuso nel database (25 persone per
//    viaggio, 50 inviti al giorno);
//  • il link nell'email punta solo all'indirizzo dell'app autorizzato (APP_URL o
//    ALLOWED_ORIGINS), mai a un dominio scelto da chi chiama;
//  • nomi e titoli vengono "escapati" nell'HTML dell'email.
//
// Deploy:   supabase functions deploy trip-invite --project-ref <ref>
// Secret:   RESEND_API_KEY  (facoltativo: senza, l'invito si salva e l'app propone di mandarlo a mano)
//           INVITE_FROM     es. "Orbita <viaggi@tuodominio.it>" (dominio verificato su Resend)
//           APP_URL         es. "https://rahodavide95-sketch.github.io/RHDev/orbita/"
//           ALLOWED_ORIGINS facoltativo, origini extra separate da virgola (es. un dominio Vercel)

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const INVITE_FROM = Deno.env.get("INVITE_FROM") ?? "Orbita <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "";
const EXTRA_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const TRIP_RE = /^[A-Za-z0-9-]{6,64}$/;

function originAllowed(origin: string): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (APP_URL && new URL(APP_URL).origin === u.origin) return true;
    if (EXTRA_ORIGINS.includes(u.origin)) return true;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

function corsFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) ? origin : (APP_URL ? new URL(APP_URL).origin : "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function emailHtml(name: string, title: string, emoji: string, link: string, to: string, role: string): string {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#06071a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06071a;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:linear-gradient(160deg,#2a1f8f,#12123a);border-radius:28px;padding:32px">
      <tr><td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#a5a8ff;font-weight:700">Orbita</td></tr>
      <tr><td style="font-size:46px;padding-top:18px">${esc(emoji)}</td></tr>
      <tr><td style="font-size:24px;font-weight:700;padding-top:8px;line-height:1.25">${esc(name)} ti ha invitato a ${role === "editor" ? "vedere e modificare" : "vedere"} il viaggio <span style="color:#64D2FF">${esc(title)}</span></td></tr>
      <tr><td style="font-size:15px;color:rgba(235,235,245,.7);padding-top:12px;line-height:1.5">Apri il link ed entra (o registrati) con questo indirizzo: <b style="color:#fff">${esc(to)}</b>. Per proteggere la privacy, il viaggio si apre solo con l'email invitata.</td></tr>
      <tr><td style="padding-top:24px"><a href="${esc(link)}" style="display:inline-block;background:#0A84FF;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:999px">Apri il viaggio</a></td></tr>
      <tr><td style="font-size:12px;color:rgba(235,235,245,.45);padding-top:24px;line-height:1.5">Se non conosci ${esc(name)}, ignora questa email: senza accedere con il tuo indirizzo nessuno vede nulla.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = corsFor(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo non consentito" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Accesso richiesto" }, 401);

  // client con i permessi DI CHI CHIAMA: il database applica le sue regole
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userErr } = await supabase.auth.getUser(authHeader.slice(7));
  if (userErr || !user) return json({ error: "Sessione non valida, accedi di nuovo" }, 401);
  if (!user.email_confirmed_at) return json({ error: "Conferma prima la tua email" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  const tripId = String(body.trip_id ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = body.role === "editor" ? "editor" : "viewer";
  if (!TRIP_RE.test(tripId)) return json({ error: "Viaggio non valido" }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Indirizzo email non valido" }, 400);
  if (email === (user.email ?? "").toLowerCase()) return json({ error: "Non puoi invitare te stesso" }, 400);

  const { data: trip } = await supabase.from("orb_trips").select("id, title, data")
    .eq("id", tripId).eq("owner_id", user.id).maybeSingle();
  if (!trip) return json({ error: "Viaggio non trovato" }, 404);

  const { data: prof } = await supabase.from("orb_profiles").select("display_name").eq("id", user.id).maybeSingle();
  const name = String(prof?.display_name || user.user_metadata?.name || user.email || "Un amico").slice(0, 80);

  const { error: shareErr } = await supabase.from("orb_trip_shares")
    .upsert({ trip_id: tripId, email, role, inviter_name: name }, { onConflict: "trip_id,email" });
  if (shareErr) {
    const limit = /limite/i.test(shareErr.message);
    return json({ error: limit ? shareErr.message : "Impossibile salvare l'invito" }, limit ? 429 : 400);
  }

  if (!RESEND_API_KEY) return json({ ok: true, emailed: false });

  // link sicuro: APP_URL, oppure l'indirizzo dell'app solo se autorizzato
  let appUrl = APP_URL;
  const asked = String(body.app_url ?? "");
  if (!appUrl && asked && originAllowed(new URL(asked, "http://x").origin)) appUrl = asked;
  if (!appUrl) return json({ ok: true, emailed: false });
  const link = `${appUrl.replace(/#.*$/, "")}#/invito/${encodeURIComponent(tripId)}`;

  const data = (trip.data ?? {}) as Record<string, unknown>;
  const emoji = typeof data.emoji === "string" ? data.emoji.slice(0, 8) : "✈️";
  const title = String(trip.title).slice(0, 120);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: INVITE_FROM,
      to: [email],
      subject: `${name} ti ha invitato a "${title}" su Orbita`,
      html: emailHtml(name, title, emoji, link, email, role),
      text: `${name} ti ha invitato a vedere il viaggio "${title}" su Orbita.\n\nApri il link ed entra (o registrati) con ${email}:\n${link}\n\nSe non conosci chi ti ha invitato, ignora questa email.`,
    }),
  }).catch(() => null);

  if (!res || !res.ok) return json({ ok: true, emailed: false });
  return json({ ok: true, emailed: true });
});

// Supabase Edge Function — label-form-mail
// Le email di Label Form (con Resend). Il server NON legge mai i dati degli artisti: sono cifrati.
//
//   { action: "ping" }   → dice se le email sono attive (la pagina dell'artista mostra o no "copia via email")
//   { action: "flush" }  → spedisce all'etichetta gli avvisi in coda (invio, modifica, firma). Non ha
//                          parametri: chiamarla quante volte si vuole spedisce solo ciò che è in coda.
//   { action: "copy", token, verifier?, to, title, rows } → copia del modulo per l'artista, preparata nel
//                          SUO browser (i dati riservati arrivano già nascosti). Permessa solo entro 30
//                          minuti dall'invio o con la password, massimo 5 al giorno (lo decide il database).
//   { action: "test" }   → email di prova all'etichetta (serve l'accesso dell'etichetta con 2FA).
//
// Deploy:  supabase functions deploy label-form-mail --no-verify-jwt   (lo fa il workflow label-form.yml)
// Secret:  RESEND_API_KEY   (senza, nessuna email: gli avvisi restano visibili nell'app)
//          MAIL_FROM        es. "SUBCONSCIOUS Culture <invio@tuodominio.com>" (dominio verificato su Resend)
//          ADMIN_URL        indirizzo dell'area dell'etichetta (per il pulsante nelle email)
//          ALLOWED_ORIGINS  facoltativo, origini extra separate da virgola

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Label Form <onboarding@resend.dev>";
const ADMIN_URL = Deno.env.get("ADMIN_URL") ?? "https://rahodavide95-sketch.github.io/RHDev/label-form/";
const ORIGINS = ["https://rahodavide95-sketch.github.io", ...(Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)];

const EMAIL_RE = /^[^@\s<>"]{1,64}@[^@\s<>"]{1,190}\.[a-z]{2,}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9+/]{43}=$/;

function originAllowed(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (ORIGINS.includes(u.origin)) return true;
    try { if (new URL(ADMIN_URL).origin === u.origin) return true; } catch { /* */ }
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": originAllowed(origin) ? origin : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

async function send(to: string, subject: string, html: string, text: string, replyTo?: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text, ...(replyTo && EMAIL_RE.test(replyTo) ? { reply_to: replyTo } : {}) }),
  }).catch(() => null);
  return !!res && res.ok;
}

function shell(title: string, inner: string, label: string, lang = "it"): string {
  return `<!doctype html><html lang="${lang === "en" ? "en" : "it"}"><body style="margin:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f2f1f6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:28px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#16161d;border-radius:20px;padding:28px">
    <tr><td style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a78bfa;font-weight:700">${esc(label || "Label Form")}</td></tr>
    <tr><td style="font-size:22px;font-weight:700;padding-top:10px;line-height:1.3">${esc(title)}</td></tr>
    ${inner}
  </table></td></tr></table></body></html>`;
}

const KIND_TEXT: Record<string, string> = { submitted: "ha inviato i materiali", updated: "ha modificato il suo invio", signed: "ha firmato il contratto" };

async function flush(): Promise<Response> {
  if (!RESEND_API_KEY || !SERVICE) return Response.json({ ok: true, sent: 0, email: false });
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("labelform_mail_claim");
  if (error || !data) return Response.json({ ok: false }, { status: 500 });
  const to = String(data.to ?? "");
  const items = Array.isArray(data.items) ? data.items : [];
  let sent = 0;
  for (const it of items) {
    const kinds: string[] = Array.isArray(it.kinds) ? it.kinds.filter((k: string) => KIND_TEXT[k]) : [];
    if (!kinds.length || !EMAIL_RE.test(to)) continue;
    const changedIds: string[] = Array.isArray(it.changed) ? it.changed.slice(0, 60) : [];
    let changed: string[] = [];
    if (changedIds.length) {
      const r = await admin.rpc("labelform_field_labels", { p_invite: it.invite_id, p_ids: changedIds });
      changed = Array.isArray(r.data) ? r.data.map((s: string) => clip(s, 80)) : [];
    }
    const what = ["submitted", "updated", "signed"].filter((k) => kinds.includes(k)).map((k) => KIND_TEXT[k]).join(" e ");
    const rel = `${clip(it.release, 200)}${it.catalog ? ` (${clip(it.catalog, 60)})` : ""}`;
    const subject = `${clip(it.artist, 120)} ${what} — ${rel}`;
    const inner = `
      <tr><td style="font-size:15px;color:rgba(242,241,246,.75);padding-top:12px;line-height:1.55">Release: <b style="color:#fff">${esc(rel)}</b></td></tr>
      ${changed.length ? `<tr><td style="font-size:15px;color:rgba(242,241,246,.75);padding-top:10px;line-height:1.55">Campi cambiati: <b style="color:#fff">${esc(changed.join(", "))}</b></td></tr>` : ""}
      <tr><td style="font-size:13px;color:rgba(242,241,246,.5);padding-top:10px;line-height:1.5">Per sicurezza i dati non sono nell'email: sono cifrati e li vedi solo tu nell'area dell'etichetta.</td></tr>
      <tr><td style="padding-top:22px"><a href="${esc(ADMIN_URL)}" style="display:inline-block;background:#a78bfa;color:#1b1430;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px">Apri Label Form</a></td></tr>`;
    const text = `${subject}\n\n${changed.length ? "Campi cambiati: " + changed.join(", ") + "\n\n" : ""}Apri Label Form: ${ADMIN_URL}`;
    const ok = await send(to, subject, shell(`${clip(it.artist, 120)} ${what}`, inner, String(data.label ?? "")), text);
    if (ok) sent++;
    else await admin.rpc("labelform_mail_unclaim", { p_ids: it.event_ids });
  }
  return Response.json({ ok: true, sent, email: true });
}

async function copy(body: Record<string, unknown>): Promise<Response> {
  if (!RESEND_API_KEY || !SERVICE) return Response.json({ error: "email_off" }, { status: 400 });
  const token = String(body.token ?? "");
  const verifier = body.verifier ? String(body.verifier) : null;
  const to = String(body.to ?? "").trim().toLowerCase();
  if (!TOKEN_RE.test(token) || (verifier && !VERIFIER_RE.test(verifier))) return Response.json({ error: "invalid" }, { status: 400 });
  if (!EMAIL_RE.test(to)) return Response.json({ error: "bad_email" }, { status: 400 });
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
  if (JSON.stringify(rows).length > 120000) return Response.json({ error: "too_big" }, { status: 400 });

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("labelform_copy_ok", { p_token: token, p_verifier: verifier });
  if (error || !data) return Response.json({ error: "server" }, { status: 500 });
  if (data.error) return Response.json({ error: data.error }, { status: 403 });

  let html = "", text = "", lastSection = "";
  for (const r of rows as Array<Record<string, unknown>>) {
    const section = clip(r.s, 200), label = clip(r.l, 300), value = clip(r.v, 4000);
    if (section && section !== lastSection) {
      html += `<tr><td style="padding-top:18px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#a78bfa;font-weight:700">${esc(section)}</td></tr>`;
      text += `\n— ${section} —\n`;
      lastSection = section;
    }
    html += `<tr><td style="padding-top:8px;font-size:14px;line-height:1.5"><span style="color:rgba(242,241,246,.6)">${esc(label)}</span><br><span style="color:#fff;white-space:pre-wrap">${esc(value || "—")}</span></td></tr>`;
    text += `${label}: ${value || "—"}\n`;
  }
  const rel = `${clip(data.release, 200)}${data.catalog ? ` (${clip(data.catalog, 60)})` : ""}`;
  // lingua del modulo (la pagina dell'artista la manda): inglese salvo il modulo sia in italiano
  const en = body.lang !== "it";
  const title = en ? `Your copy — ${rel}` : `La tua copia — ${rel}`;
  const intro = en
    ? `Here is what you sent to ${esc(data.label)}. Private details (IBAN, tax ID…) are hidden for safety.`
    : `Ecco cosa hai inviato a ${esc(data.label)}. I dati riservati (IBAN, codice fiscale…) sono nascosti per sicurezza.`;
  const inner = `<tr><td style="font-size:14px;color:rgba(242,241,246,.7);padding-top:10px;line-height:1.5">${intro}</td></tr>${html}`;
  const ok = await send(to, title, shell(title, inner, String(data.label ?? ""), en ? "en" : "it"), `${title}\n${text}`, String(data.reply_to ?? ""));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "send_failed" }, { status: 502 });
}

async function testMail(req: Request): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return Response.json({ error: "login" }, { status: 401 });
  const user = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: owner } = await user.rpc("labelform_is_owner");
  if (owner !== true) return Response.json({ error: "not_owner" }, { status: 403 });
  if (!RESEND_API_KEY) return Response.json({ error: "email_off" }, { status: 400 });
  const { data: s } = await user.from("labelform_settings").select("notify_email, label_name").maybeSingle();
  const to = String(s?.notify_email ?? "");
  if (!EMAIL_RE.test(to)) return Response.json({ error: "bad_email" }, { status: 400 });
  const ok = await send(to, "Email di prova di Label Form", shell("Le email funzionano ✓", `<tr><td style="font-size:15px;color:rgba(242,241,246,.75);padding-top:12px;line-height:1.55">Da ora ricevi qui un avviso ogni volta che un artista invia, modifica o firma.</td></tr>`, String(s?.label_name ?? "")), "Le email di Label Form funzionano.");
  return ok ? Response.json({ ok: true }) : Response.json({ error: "send_failed" }, { status: 502 });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response("Metodo non consentito", { status: 405, headers: h });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corpo vuoto */ }
  let res: Response;
  try {
    switch (body.action) {
      case "ping": res = Response.json({ email: !!RESEND_API_KEY && !!SERVICE }); break;
      case "flush": res = await flush(); break;
      case "copy": res = await copy(body); break;
      case "test": res = await testMail(req); break;
      default: res = Response.json({ error: "action" }, { status: 400 });
    }
  } catch {
    res = Response.json({ error: "server" }, { status: 500 });
  }
  const out = new Headers(res.headers);
  for (const [k, v] of Object.entries(h)) out.set(k, v);
  return new Response(res.body, { status: res.status, headers: out });
});

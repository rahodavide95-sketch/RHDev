// Supabase Edge Function — Assistente AI per Label Finance
// Proxy sicuro verso l'API Anthropic (Claude): la chiave resta lato server.
// Deploy:  supabase functions deploy ai-advisor
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (opzionali) ANTHROPIC_MODEL=claude-opus-5-5
//                      AI_DAILY_LIMIT=30          richieste al giorno per utente
//                      AI_ALLOW_APPROVED=false    al lancio: solo abbonati (vedi sotto)
//
// Chi può usarla (deciso qui, mai dal browser):
//   - chi ha un abbonamento attivo Big Label/Company/Enterprise (tabella
//     subscriptions, scritta solo dal webhook Stripe);
//   - in fase beta, anche gli utenti approvati dal titolare (profiles.approved).
//     Al lancio imposta AI_ALLOW_APPROVED=false.
// Il piano salvato nei dati dell'app (app_state) NON conta: l'utente può modificarlo.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") ?? "30") || 30;
const ALLOW_APPROVED = (Deno.env.get("AI_ALLOW_APPROVED") ?? "true") !== "false";

const AI_PLANS = new Set(["biglabel", "studio", "agency"]);
const ACTIVE = new Set(["active", "trialing"]);
const LANGS: Record<string, string> = {
  it: "Italian", en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", nl: "Dutch",
};
const MAX_SUMMARY_CHARS = 30000;
const MAX_QUESTION_CHARS = 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ai_not_configured" }, 500);

  // 1) Autenticazione: ricava l'utente dal token Supabase
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // 2) Diritto di accesso: abbonamento attivo, oppure (beta) utente approvato
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan,status")
    .eq("user_id", userId)
    .maybeSingle();
  let allowed = !!sub && ACTIVE.has(sub.status) && AI_PLANS.has(sub.plan);
  if (!allowed && ALLOW_APPROVED) {
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .select("approved")
      .eq("id", userId)
      .maybeSingle();
    allowed = !profErr && !!prof?.approved;
  }
  if (!allowed) return json({ error: "upgrade_required" }, 403);

  // 3) Limite giornaliero per utente (protegge la chiave Anthropic)
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage, error: usageErr } = await admin
    .from("ai_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  const used = usage?.count ?? 0;
  if (!usageErr && used >= DAILY_LIMIT) return json({ error: "daily_limit", limit: DAILY_LIMIT }, 429);

  // 4) Richiesta del client (dimensioni limitate)
  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const summaryText = JSON.stringify(payload.summary ?? {}, null, 2);
  if (summaryText.length > MAX_SUMMARY_CHARS) return json({ error: "payload_too_large" }, 413);
  const question = String(payload.question ?? "").slice(0, MAX_QUESTION_CHARS).trim();
  const langName = LANGS[String(payload.lang ?? "it")] ?? "Italian";

  if (!usageErr) {
    await admin.from("ai_usage").upsert({ user_id: userId, day, count: used + 1 });
  }

  const system =
    `You are a financial advisor for independent record labels. Analyze the label's data and give concrete, ` +
    `prioritized, actionable advice. ALWAYS reply in ${langName}. Point out declining months, low-margin ` +
    `platforms, unrecouped artists, balances still to pay, anomalous expenses and concrete next steps. Use short ` +
    `paragraphs and bullet points. Never invent numbers that are not in the data; if data is missing, say so. ` +
    `Keep it under ~350 words.`;
  const userContent =
    (question ? `${question}\n\n` : "") +
    "Dati dell'etichetta (JSON):\n```json\n" + summaryText + "\n```";

  // 5) Chiamata a Claude. fallbacks "default": se il modello rifiuta, l'API riprova
  //    da sola sul modello consigliato per quel caso.
  try {
    const msg = await anthropic.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: userContent }],
    });
    if (msg.stop_reason === "refusal") return json({ error: "refused" }, 200);
    const text = msg.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => b.text ?? "")
      .join("\n");
    return json({ text, model: msg.model });
  } catch (err) {
    // restituisce 200 con il dettaglio così il client può mostrarlo (diagnostica)
    if (err instanceof Anthropic.APIError) {
      return json({ error: `ai_http_${err.status ?? "error"}`, status: err.status, detail: String(err.message).slice(0, 400) }, 200);
    }
    return json({ error: "ai_error", detail: String((err as Error)?.message ?? err).slice(0, 400) }, 200);
  }
});

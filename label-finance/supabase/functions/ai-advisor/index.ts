// Supabase Edge Function — Assistente AI per Label Finance
// Proxy sicuro verso l'API Anthropic (Claude): la chiave resta lato server.
// Deploy:  supabase functions deploy ai-advisor
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (opzionale) supabase secrets set ANTHROPIC_MODEL=claude-opus-4-8
//
// Il client invia un riassunto dei dati dell'etichetta; la funzione verifica
// che l'utente sia autenticato e abbia un piano Studio/Agency, poi chiede a
// Claude consigli concreti e li restituisce come testo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const AI_PLANS = new Set(["studio", "agency"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ai_not_configured" }, 500);

  // 1) Autenticazione: ricava l'utente dal token Supabase
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // 2) Gating piano: legge il piano dallo stato salvato dell'utente
  const { data: stateRow } = await admin
    .from("app_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  const plan = (stateRow?.data?.plan as string) || "free";
  if (!AI_PLANS.has(plan)) {
    return json({ error: "upgrade_required", plan }, 403);
  }

  // 3) Costruisce il prompt dal riassunto inviato dal client
  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const summary = payload.summary ?? {};
  const lang = (payload.lang as string) === "en" ? "en" : "it";
  const question = (payload.question as string) || "";

  const system =
    lang === "en"
      ? `You are a financial advisor for independent record labels. Analyze the label's data and give concrete, prioritized, actionable advice in clear English. Be specific and practical: point out declining months, low-margin platforms, unrecouped artists, anomalous expenses, and concrete next steps. Use short paragraphs and bullet points. Never invent numbers that are not in the data; if data is missing, say so. Keep it under ~350 words.`
      : `Sei un consulente finanziario per etichette discografiche indipendenti. Analizza i dati dell'etichetta e fornisci consigli concreti, prioritari e azionabili in italiano chiaro. Sii specifico e pratico: segnala mesi in calo, piattaforme a basso margine, artisti non recouped, spese anomale e i prossimi passi concreti. Usa paragrafi brevi ed elenchi puntati. Non inventare numeri che non sono nei dati; se mancano dati, dillo. Resta entro ~350 parole.`;

  const userContent =
    (question ? `${question}\n\n` : "") +
    `Dati dell'etichetta (JSON):\n` +
    "```json\n" +
    JSON.stringify(summary, null, 2) +
    "\n```";

  // 4) Chiamata all'API Anthropic (Messages API, non-streaming)
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return json({ error: "ai_error", status: resp.status, detail }, 502);
  }

  const data = await resp.json();
  if (data?.stop_reason === "refusal") {
    return json({ error: "refused" }, 200);
  }
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n")
    : "";

  return json({ text, model: data?.model ?? ANTHROPIC_MODEL });
});

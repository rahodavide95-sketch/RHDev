// Supabase Edge Function — create-checkout
// Crea una sessione di pagamento Stripe (abbonamento) per l'utente autenticato
// e restituisce l'URL a cui mandarlo. Stripe gestisce carta, IVA e fatture.
//
// Deploy:  supabase functions deploy create-checkout
// Secret necessari:
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_...        (poi sk_live_...)
//   supabase secrets set STRIPE_PRICE_BIGLABEL=price_...      (piano Big Label)
//   supabase secrets set STRIPE_PRICE_STUDIO=price_...        (piano Company)
//   supabase secrets set STRIPE_PRICE_AGENCY=price_...        (piano Enterprise, opzionale)
//   supabase secrets set APP_URL=https://il-tuo-dominio       (dove torna dopo il pagamento)
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già disponibili in automatico.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

// Mappa piano interno → Price ID di Stripe
const PRICE_BY_PLAN: Record<string, string> = {
  biglabel: Deno.env.get("STRIPE_PRICE_BIGLABEL") ?? "",
  studio: Deno.env.get("STRIPE_PRICE_STUDIO") ?? "",
  agency: Deno.env.get("STRIPE_PRICE_AGENCY") ?? "",
};

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

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return json({ error: "stripe_not_configured" }, 500);

  // 1) Autenticazione utente
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;
  const userId = user.id;

  // 2) Piano richiesto
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ok, vuoto */ }
  const plan = String(body.plan ?? "");
  const priceId = PRICE_BY_PLAN[plan];
  if (!priceId) return json({ error: "invalid_plan", plan }, 400);

  // 3) Cliente Stripe: riusa quello salvato o creane uno nuovo
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  let customerId = sub?.stripe_customer_id ?? "";
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: userId },
    });
    customerId = customer.id;
    await admin.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    });
  }

  // 4) Sessione di Checkout (abbonamento)
  const base = APP_URL || new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { supabase_user_id: userId, plan },
    subscription_data: { metadata: { supabase_user_id: userId, plan } },
    success_url: `${base}/app.html?checkout=success`,
    cancel_url: `${base}/app.html?checkout=cancel`,
    allow_promotion_codes: true,
  });

  return json({ url: session.url });
});
